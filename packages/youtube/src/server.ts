import crypto from 'node:crypto';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import type { Config } from './config.js';
import { DownloadQueue } from '@bridgarr/core';
import { logger } from './logger.js';
import { handleNewznab, type AppContext } from './newznab/router.js';
import { buildNzb, decodeToken, generateApiKey, handleSab, healthzHandler } from '@bridgarr/core';
import {
  handleAddMoviePage,
  handleAddMovieSubmit,
  handleAddPage,
  handleAddSubmit,
  handleBrowsePage,
  type BrowseContext,
  type BrowseSearchFn,
} from './ui/browse.js';
import { handleSettingsSave, renderRotatedPage, renderSettingsPage } from './ui/settings.js';
import { updateSettings } from './config.js';
import type { SourceBridge } from '@bridgarr/core';

/**
 * NZB wire token. Single source of truth for the round-trip: buildNzb stamps it
 * and handleSab/parseNzb match it. Build-side and parse-side MUST reference this
 * one constant so they cannot drift (a mismatch silently rejects every grab).
 * This is the internal wire identity, distinct from the human-facing display
 * identity ("bridgarr-youtube" in the UI / healthz / startup log).
 */
const META_TYPE = 'bridgarr-youtube';

export interface ServerDeps {
  /** YouTube search backend; injectable for tests. */
  source?: SourceBridge;
  queue?: DownloadQueue;
  /** Raw flat search for the browse page; injectable for tests. */
  browseSearch?: BrowseSearchFn;
  /** Fetches used for Sonarr/Radarr API calls (browse add flows); injectable for tests. */
  sonarrFetch?: typeof fetch;
  radarrFetch?: typeof fetch;
}

/**
 * isAllowedHost — single source of truth for the trusted-host allowlist.
 *
 * Returns true if `host` is:
 *   - a localhost form (localhost, 127.0.0.1, ::1/[::1]), with or without :<port>
 *   - a private-LAN IPv4 literal in RFC1918 (10.x, 172.16–31.x, 192.168.x) or
 *     the Tailscale CGNAT range (100.64.0.0/10), with or without :<port>
 *   - an exact match against an entry in config.allowedHosts (the ALLOWED_HOSTS env)
 *
 * This anchors the client-supplied Host to a trusted allowlist so a DNS-rebinding
 * attacker cannot reach a credential-backed route under a public hostname (e.g.
 * evil.example) — the standard DNS-rebinding defense, matching Sonarr/Radarr/Pi-hole.
 * This is the ONE place the trusted-host set is defined; both guards below call it.
 */
function isAllowedHost(host: string | undefined, config: Config): boolean {
  if (!host) return false;

  // Strip optional port to get the bare hostname/IP for pattern checks.
  // IPv6 literals arrive as [::1] or [::1]:port — handle the bracket form.
  let bare: string;
  if (host.startsWith('[')) {
    // IPv6 bracket form: [::1] or [::1]:8485
    const closeBracket = host.indexOf(']');
    bare = closeBracket === -1 ? host : host.slice(1, closeBracket);
  } else {
    const lastColon = host.lastIndexOf(':');
    bare = lastColon === -1 ? host : host.slice(0, lastColon);
  }

  // Operator-specified allowlist (ALLOWED_HOSTS env): match against BOTH the
  // full host string (e.g. nas.local:8485) AND the port-stripped bare host
  // (e.g. nas.local). The documented form is a bare hostname, but the browser
  // sends Host with the port — matching only the full string would 403 the
  // operator under their own documented hostname (and vice-versa).
  if (config.allowedHosts.includes(host) || config.allowedHosts.includes(bare)) return true;

  // Localhost forms.
  if (bare === 'localhost' || bare === '127.0.0.1' || bare === '::1') return true;

  // Tailscale IPv6 ULA: each node gets an fd7a:115c:a1e0::/48 ULA v6 address in
  // addition to its 100.64/10 CGNAT v4 (handled below). A browser preferring IPv6
  // over Tailscale sends Host: [fd7a:...]; accept the documented Tailscale /48
  // prefix, mirroring the CGNAT rationale. Match case-insensitively (v6 is hex).
  if (bare.toLowerCase().startsWith('fd7a:115c:a1e0:')) return true;

  // Private-LAN IPv4 + Tailscale CGNAT (RFC1918: 10/8, 172.16–31/12, 192.168/16; CGNAT: 100.64/10).
  // Parse as IPv4 only (4 decimal octets).
  const octets = bare.split('.');
  if (octets.length === 4) {
    // Validate each octet as a CANONICAL decimal string before Number(). Number()
    // silently accepts hex ('0xa'→10), exponent ('1e1'→10), leading zeros
    // ('010'→10), and whitespace (' 10'→10), so '0xa.0.0.1' would otherwise
    // classify as 10/8 private. Browsers never emit these; rejecting them keeps
    // the DNS-rebinding trusted set from over-accepting non-canonical forms.
    if (octets.every((o) => /^(0|[1-9][0-9]{0,2})$/.test(o))) {
      const parts = octets.map(Number);
      if (parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
        const [a, b] = parts as [number, number, number, number];
        if (a === 10) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 192 && b === 168) return true;
        // Tailscale CGNAT: 100.64.0.0/10 → first octet 100, second octet 64–127.
        if (a === 100 && b >= 64 && b <= 127) return true;
      }
    }
  }

  return false;
}

/**
 * hostAllowlistGuard — Host-allowlist ONLY, for the credential-backed browse lookup GETs.
 *
 * Applied to GET /browse/add and GET /browse/add-movie which call the operator's
 * Sonarr/Radarr via stored keys (lookup/qualityProfiles/rootFolders) and render
 * profile names + root-folder paths. A DNS-rebinding page under a public hostname
 * must not be able to read those responses or drive attacker-controlled *arr traffic.
 *
 * This guard intentionally does NOT check Origin/Referer: browsers do not reliably
 * send an Origin header on top-level GET navigations, so requiring it would break
 * normal navigation to the lookup page. The Origin/Referer equality check is a CSRF
 * defense scoped to state-changing POSTs only (see sameOriginGuard).
 */
function hostAllowlistGuard(config: Config) {
  return function (req: Request, res: Response, next: NextFunction): void {
    if (!isAllowedHost(req.get('host'), config)) {
      res.status(403).send('forbidden');
      return;
    }
    next();
  };
}

/**
 * sameOriginGuard — Host-allowlist FIRST, then Origin/Host equality, for state-changing POSTs.
 *
 * This host-allowlist + strict same-origin check is the SINGLE CSRF/DNS-rebinding
 * defense for state-changing POSTs (no token — there is no server-side session to
 * bind a token to). Applied to ALL four state-changing POSTs regardless of requireAuth.
 *
 * Enforcement order (fail-closed):
 *   1. HOST ALLOWLIST FIRST (DNS-rebinding anchor): rejects any public hostname not
 *      in the trusted allowlist BEFORE any Origin/Referer check or mutation.
 *      Reuses the SAME isAllowedHost helper as hostAllowlistGuard — allowlist defined once.
 *   2. ORIGIN/HOST EQUALITY SECOND (CSRF layer): if Origin present, its host must
 *      equal the Host header; if Origin absent, Referer host must match; if BOTH
 *      absent → 403 (fail closed). Malformed URL → treated as mismatch → 403.
 *   3. Only if BOTH layers pass → next().
 */
function sameOriginGuard(config: Config) {
  return function (req: Request, res: Response, next: NextFunction): void {
    // 1. Host-allowlist check (DNS-rebinding anchor) — runs before any Origin logic.
    if (!isAllowedHost(req.get('host'), config)) {
      res.status(403).send('forbidden');
      return;
    }

    // 2. Origin/Host equality (CSRF layer).
    const origin = req.get('origin');
    const reqHost = req.get('host');
    if (origin !== undefined) {
      // Origin header is present — compare its host to the request Host.
      try {
        const url = new URL(origin);
        if (url.host !== reqHost) {
          res.status(403).send('forbidden');
          return;
        }
      } catch {
        // Malformed Origin → treat as mismatch → 403.
        res.status(403).send('forbidden');
        return;
      }
    } else {
      // Origin absent — fall back to Referer.
      const referer = req.get('referer');
      if (referer !== undefined) {
        try {
          const url = new URL(referer);
          if (url.host !== reqHost) {
            res.status(403).send('forbidden');
            return;
          }
        } catch {
          // Malformed Referer → treat as mismatch → 403.
          res.status(403).send('forbidden');
          return;
        }
      } else {
        // BOTH Origin and Referer absent → fail closed.
        res.status(403).send('forbidden');
        return;
      }
    }

    next();
  };
}

/**
 * Derive a stable unlock token from the app key.
 *
 * The token stored in the session cookie is the SHA-256 hex digest of the raw key.
 * This means:
 *   1. The raw key is never placed in a cookie — only a one-way hash of it is.
 *   2. Rotating the key (Plan 01) immediately invalidates all outstanding cookies
 *      because the expected token (sha256 of the NEW key) no longer matches the
 *      cookie value (sha256 of the OLD key).
 *   3. No server-side session store is needed — the comparison is stateless.
 */
function unlockToken(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Parse a single named cookie from the raw Cookie header string.
 * Returns undefined if the header is absent or the cookie is not found.
 * Does NOT depend on cookie-parser — parsed inline to avoid adding a dependency.
 */
function parseCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === name) return v;
  }
  return undefined;
}

/**
 * Constant-time string comparison using crypto.timingSafeEqual.
 *
 * Returns true only if `a` and `b` are the same length AND have the same bytes.
 * The length guard is essential: timingSafeEqual throws if buffers differ in
 * length, so we return false (not throw) on a length mismatch — but we must
 * NOT short-circuit on mismatched length in a way that creates a timing oracle,
 * since returning immediately on length mismatch leaks the expected value's length.
 * Acceptable here because the key length (sha256 hex = 64 chars; raw key = 32 chars)
 * is a publicly known constant for this application, not secret itself.
 */
function safeEqual(a: string, b: string): boolean {
  // Cheap fast-path on JS string length (UTF-16 units). NOT sufficient on its
  // own: a multibyte input (e.g. 'ñ') can share the same .length as the
  // expected value yet differ in BYTE length, and timingSafeEqual throws a
  // RangeError when its two buffers differ in byte length. So encode first and
  // compare BYTE lengths before calling timingSafeEqual — a mismatched input
  // must return false (→ 401), never throw (→ 500 + error-log spam).
  if (a.length !== b.length) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Cookie name used for the unlock session. Not a secret — the VALUE is the secret
 * (sha256 of the api key). HttpOnly; SameSite=Lax; Path=/; Max-Age=28800 (8 hours).
 * No Secure flag: the LAN app serves plain HTTP by design (not HTTPS) — documented.
 */
const AUTH_COOKIE = 'bridgarr_session';
/** Session lifetime in seconds (8 hours). */
const AUTH_COOKIE_MAX_AGE = 8 * 60 * 60;

/**
 * requireAuthGate — optional authentication gate for the state-changing surface.
 *
 * When config.settings.requireAuth is false: pass-through (no-op). Plan 01's
 * sameOriginGuard/hostAllowlistGuard are the ONLY guards in that case.
 *
 * When true:
 *   - Accept if ?apikey=KEY matches the stored key (constant-time compare). On
 *     success, set a short-lived HttpOnly session cookie carrying sha256(key).
 *   - Accept if the session cookie carries sha256(current key) (constant-time).
 *   - Otherwise: respond 401 with a minimal unlock prompt. Never echo the key.
 *
 * Applied AFTER Plan 01's guards on the relevant routes:
 *   - sameOriginGuard → requireAuthGate on the four state-changing POSTs
 *   - hostAllowlistGuard → requireAuthGate on the two credential-backed GET lookups
 *   - requireAuthGate (first middleware, no guard before it) on GET /
 *
 * T-08-07: timingSafeEqual with length guard — no timing oracle on the key.
 * T-08-08: HttpOnly + SameSite=Lax + no Secure (LAN plain HTTP).
 * T-08-13: logger logs req.path (not query string) — the ?apikey value is not logged.
 */
function requireAuthGate(config: Config) {
  return function (req: Request, res: Response, next: NextFunction): void {
    if (!config.settings.requireAuth) {
      next();
      return;
    }

    const key = config.settings.apiKey;
    const expectedToken = unlockToken(key);

    // Check ?apikey= query param first.
    const supplied = typeof req.query.apikey === 'string' ? req.query.apikey : undefined;
    if (supplied !== undefined && safeEqual(supplied, key)) {
      // Valid key supplied — set the unlock session cookie and allow.
      res.setHeader(
        'Set-Cookie',
        `${AUTH_COOKIE}=${expectedToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${AUTH_COOKIE_MAX_AGE}`,
      );
      next();
      return;
    }

    // Check session cookie.
    const cookieVal = parseCookie(req.headers.cookie, AUTH_COOKIE);
    if (cookieVal !== undefined && safeEqual(cookieVal, expectedToken)) {
      next();
      return;
    }

    // Neither valid key nor valid cookie — reject.
    res.status(401).type('text').send('Locked. Append ?apikey=YOUR_KEY to unlock.');
  };
}

export function createServer(config: Config, deps: ServerDeps = {}): Express {
  const queue = deps.queue ?? new DownloadQueue();
  const ctx: AppContext = {
    config,
    source: deps.source ?? null,
  };

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  // Log req.path (strips query string) so a ?apikey=KEY value is never written
  // to the debug log — CLAUDE.md: never log secrets (T-08-05).
  app.use((req, _res, next) => {
    logger.debug({ method: req.method, path: req.path }, 'request');
    next();
  });

  app.get('/healthz', healthzHandler('bridgarr-youtube'));

  // GET /: requireAuthGate is first (no sameOriginGuard — GET is not state-changing).
  // When requireAuth is off, the gate is a pass-through; behavior unchanged (D-05).
  app.get('/', requireAuthGate(config), (req, res) => {
    res.type('html').send(renderSettingsPage(config, req.query.saved === '1'));
  });

  // State-changing POSTs: sameOriginGuard (Host-allowlist FIRST, then Origin/Host equality)
  // enforced on all four routes regardless of requireAuth (T-08-04 / T-08-07 / D-07).
  // requireAuthGate sits AFTER sameOriginGuard and BEFORE urlencoded+handler (T-08-06 ordering).
  app.post(
    '/settings',
    sameOriginGuard(config),
    requireAuthGate(config),
    express.urlencoded({ extended: false }),
    (req, res) => {
      handleSettingsSave(config, req, res);
    },
  );

  // Rotate route: generates a fresh app key, persists it, reveals it exactly once
  // in the response body (one-time reveal, SEC-01 / D-02 / T-08-03). No redirect to
  // GET / (which must never show the key). Old key immediately stops authenticating
  // against /api — operator must update Sonarr AND Radarr (T-08-06).
  // requireAuthGate sits AFTER sameOriginGuard (T-08-10: rotate is auth-gated when ON).
  app.post(
    '/settings/rotate-key',
    sameOriginGuard(config),
    requireAuthGate(config),
    express.urlencoded({ extended: false }),
    (req, res) => {
      const newKey = generateApiKey();
      updateSettings(config, { apiKey: newKey });
      res.type('html').send(renderRotatedPage(newKey, config));
    },
  );

  const browseCtx: BrowseContext = {
    config,
    searchFn: deps.browseSearch,
    sonarrFetch: deps.sonarrFetch,
    radarrFetch: deps.radarrFetch,
  };
  // GET /browse: search landing — makes NO *arr call (no sonarrClient/radarrClient),
  // so it stays open (no guard required). Read-only; not auth-gated (D-07).
  app.get('/browse', (req, res) => handleBrowsePage(browseCtx, req, res));

  // Credential-backed browse lookup GETs: hostAllowlistGuard (Host-allowlist ONLY,
  // no Origin check — browsers omit Origin on top-level GET navigations) to block
  // DNS-rebinding reads of *arr metadata (T-08-08 / D-07).
  // requireAuthGate sits AFTER hostAllowlistGuard on these two routes (T-08-06 / T-08-12).
  app.get('/browse/add', hostAllowlistGuard(config), requireAuthGate(config), (req, res) =>
    handleAddPage(browseCtx, req, res),
  );
  // Credential-backed browse POSTs: full sameOriginGuard (Host + Origin/Host equality),
  // then requireAuthGate, then urlencoded parser, then handler (T-08-12 ordering).
  app.post(
    '/browse/add',
    sameOriginGuard(config),
    requireAuthGate(config),
    express.urlencoded({ extended: false }),
    (req, res) => handleAddSubmit(browseCtx, req, res),
  );
  app.get('/browse/add-movie', hostAllowlistGuard(config), requireAuthGate(config), (req, res) =>
    handleAddMoviePage(browseCtx, req, res),
  );
  app.post(
    '/browse/add-movie',
    sameOriginGuard(config),
    requireAuthGate(config),
    express.urlencoded({ extended: false }),
    (req, res) => handleAddMovieSubmit(browseCtx, req, res),
  );

  // Sonarr talks to one /api endpoint for both roles: Newznab requests carry
  // ?t=..., SABnzbd requests carry ?mode=...
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1_000_000, files: 1 } });
  const apiDispatch = async (req: Request, res: Response) => {
    if (typeof req.query.t === 'string') {
      await handleNewznab(ctx, req, res);
      return;
    }
    if (typeof req.query.mode === 'string') {
      handleSab({ settings: { apiKey: config.settings.apiKey, completeDir: config.settings.completeDir, metaType: META_TYPE }, queue, logger }, req, res);
      return;
    }
    res.status(400).json({ error: 'unknown api request' });
  };
  app.get('/api', apiDispatch);
  app.post('/api', upload.any(), apiDispatch);

  // Fake-NZB endpoint referenced by Newznab enclosure URLs.
  app.get('/nzb/:token', (req, res) => {
    let payload;
    try {
      payload = decodeToken(req.params.token);
    } catch {
      res.status(404).send('not found');
      return;
    }
    res.type('application/x-nzb');
    // Strip CR/LF/quote from the (token-derived) title before it enters the
    // header — prevents Content-Disposition header injection (CWE-113). The
    // filename is cosmetic, so dropping these characters is safe.
    const safeName = payload.title.replace(/[\r\n"]/g, '');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.nzb"`);
    res.send(buildNzb(payload, { metaType: META_TYPE }));
  });

  // Trailing global error-handling middleware (HARD-01). Registered AFTER every
  // route (/api AND /nzb/:token) so it is the true global error boundary covering
  // all of them — Express only routes errors to a 4-arg handler declared after the
  // route that threw.
  // Catches ANY multer.MulterError (LIMIT_FILE_SIZE for oversize, LIMIT_FILE_COUNT for >1 file)
  // and returns 413 with a SAB-style body so Sonarr can parse it like every other SAB error.
  // Non-multer errors get a generic 500 — no internal detail leaked to the client (CLAUDE.md).
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      res.status(413).json({ status: false, error: 'Upload exceeds limit' });
      return;
    }
    logger.error({ err }, 'unhandled error');
    res.status(500).json({ status: false, error: 'Internal server error' });
  });

  return app;
}
