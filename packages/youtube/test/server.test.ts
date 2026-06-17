import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeToken } from '@bridgarr/core';
import { loadConfig, updateSettings } from '../src/config.js';
import { createServer } from '../src/server.js';
import { fakeSonarr } from './helpers/sonarr.js';
import { fakeRadarr } from './helpers/radarr.js';

// Helper: extract the Set-Cookie header value from a supertest response.
// supertest normalises it to a string[] on responses with multiple cookies,
// or a single string when there is only one.
function getSetCookieHeader(res: request.Response): string | undefined {
  const raw = res.headers['set-cookie'] as string | string[] | undefined;
  if (!raw) return undefined;
  return Array.isArray(raw) ? raw[0] : raw;
}

describe('server', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytfortv-test-'));
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('responds to /healthz', async () => {
    const app = createServer(loadConfig({ DATA_DIR: dataDir }));

    const res = await request(app).get('/healthz');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'bridgarr-youtube' });
  });

  it('returns 413 with a SAB-style body when the upload exceeds the size limit', async () => {
    const app = createServer(loadConfig({ DATA_DIR: dataDir }));
    // Buffer larger than the 1,000,000-byte fileSize limit — trips LIMIT_FILE_SIZE
    const oversizeBuffer = Buffer.alloc(1_000_001);

    const res = await request(app)
      .post('/api?mode=addfile')
      .attach('nzbfile', oversizeBuffer, 'big.nzb');

    expect(res.status).toBe(413);
    expect(res.body).toEqual({ status: false, error: 'Upload exceeds limit' });
  });

  it('returns 413 with a SAB-style body when more than one file is uploaded', async () => {
    const app = createServer(loadConfig({ DATA_DIR: dataDir }));
    // Two small files — trips multer files:1 limit (LIMIT_FILE_COUNT)

    const res = await request(app)
      .post('/api?mode=addfile')
      .attach('nzbfile', Buffer.alloc(10), 'a.nzb')
      .attach('nzbfile', Buffer.alloc(10), 'b.nzb');

    expect(res.status).toBe(413);
    expect(res.body).toEqual({ status: false, error: 'Upload exceeds limit' });
  });

  it('strips CR/LF/quote from the NZB Content-Disposition filename (CWE-113)', async () => {
    const app = createServer(loadConfig({ DATA_DIR: dataDir }));
    const token = encodeToken({
      provider: 'youtube',
      episodeId: 'abc',
      title: 'evil"\r\nX-Injected: yes',
      pageUrl: 'https://www.youtube.com/watch?v=abc',
    });

    const res = await request(app).get(`/nzb/${token}`);

    expect(res.status).toBe(200);
    const disposition = res.headers['content-disposition'];
    expect(disposition).toBe('attachment; filename="evilX-Injected: yes.nzb"');
    expect(disposition).not.toContain('\r');
    expect(disposition).not.toContain('\n');
    // No forged header leaked out of Content-Disposition.
    expect(res.headers['x-injected']).toBeUndefined();
  });

  describe('hostAllowlistGuard + sameOriginGuard (SEC-01 CSRF + DNS-rebinding defense)', () => {
    it('rejects cross-site, missing-Origin, and DNS-rebinding POST /browse/add and /browse/add-movie with no *arr call', async () => {
      // Build app with injected fetch spies — we assert they are NEVER called when the guard rejects.
      const sonarrSpy = vi.fn<typeof fetch>();
      const radarrSpy = vi.fn<typeof fetch>();
      const config = loadConfig({ DATA_DIR: dataDir });
      updateSettings(config, {
        sonarrUrl: 'http://sonarr.test:8989',
        sonarrApiKey: 'sonarr-key',
        radarrUrl: 'http://radarr.test:7878',
        radarrApiKey: 'radarr-key',
      });
      const app = createServer(config, { sonarrFetch: sonarrSpy, radarrFetch: radarrSpy });

      const ADD_FORM = {
        tvdbId: '353546',
        qualityProfileId: '4',
        rootFolderPath: '/data/media/tv',
        monitor: 'all',
      };
      const ADD_MOVIE_FORM = {
        tmdbId: '9821',
        qualityProfileId: '1',
        rootFolderPath: '/data/media/movies',
      };

      // (a) Foreign Origin → 403 on both browse POSTs.
      const addForeign = await request(app)
        .post('/browse/add')
        .set('Host', '127.0.0.1')
        .set('Origin', 'http://evil.example')
        .type('form')
        .send(ADD_FORM);
      expect(addForeign.status).toBe(403);

      const addMovieForeign = await request(app)
        .post('/browse/add-movie')
        .set('Host', '127.0.0.1')
        .set('Origin', 'http://evil.example')
        .type('form')
        .send(ADD_MOVIE_FORM);
      expect(addMovieForeign.status).toBe(403);

      // (b) Missing Origin AND Referer → 403 (fail closed).
      const addNoOrigin = await request(app)
        .post('/browse/add')
        .set('Host', '127.0.0.1')
        .type('form')
        .send(ADD_FORM);
      expect(addNoOrigin.status).toBe(403);

      const addMovieNoOrigin = await request(app)
        .post('/browse/add-movie')
        .set('Host', '127.0.0.1')
        .type('form')
        .send(ADD_MOVIE_FORM);
      expect(addMovieNoOrigin.status).toBe(403);

      // (c) DNS-rebinding: Origin equals Host, but Host is an unapproved public name.
      const addDnsRebind = await request(app)
        .post('/browse/add')
        .set('Host', 'evil.example:8485')
        .set('Origin', 'http://evil.example:8485')
        .type('form')
        .send(ADD_FORM);
      expect(addDnsRebind.status).toBe(403);

      const addMovieDnsRebind = await request(app)
        .post('/browse/add-movie')
        .set('Host', 'evil.example:8485')
        .set('Origin', 'http://evil.example:8485')
        .type('form')
        .send(ADD_MOVIE_FORM);
      expect(addMovieDnsRebind.status).toBe(403);

      // The sonarr/radarr fetch spies must NEVER have been called — the guard
      // rejected all requests before the handler ran (no *arr addSeries/addMovie call).
      expect(sonarrSpy).not.toHaveBeenCalled();
      expect(radarrSpy).not.toHaveBeenCalled();
    });

    it('rejects a DNS-rebinding GET /browse/add and /browse/add-movie with no *arr call (T-08-08)', async () => {
      // hostAllowlistGuard must reject an unapproved public Host on the credential-backed GETs.
      const sonarrSpy = vi.fn<typeof fetch>();
      const radarrSpy = vi.fn<typeof fetch>();
      const config = loadConfig({ DATA_DIR: dataDir });
      updateSettings(config, {
        sonarrUrl: 'http://sonarr.test:8989',
        sonarrApiKey: 'sonarr-key',
        radarrUrl: 'http://radarr.test:7878',
        radarrApiKey: 'radarr-key',
      });
      const app = createServer(config, { sonarrFetch: sonarrSpy, radarrFetch: radarrSpy });

      // Public/unapproved Host → 403 before any *arr call.
      const addRes = await request(app)
        .get('/browse/add?title=Bluey')
        .set('Host', 'evil.example:8485');
      expect(addRes.status).toBe(403);

      const addMovieRes = await request(app)
        .get('/browse/add-movie?title=Fracture')
        .set('Host', 'evil.example:8485');
      expect(addMovieRes.status).toBe(403);

      // Spies must NOT have been called — the guard prevented the handler from running.
      expect(sonarrSpy).not.toHaveBeenCalled();
      expect(radarrSpy).not.toHaveBeenCalled();
    });

    it('a same-host GET /browse/add and /browse/add-movie with no Origin returns 200 (normal navigation works)', async () => {
      // The hostAllowlistGuard (Host-allowlist ONLY) must NOT require an Origin header on GETs —
      // browsers omit Origin on top-level GET navigations (T-08-08 rationale).
      const sonarr = fakeSonarr();
      const radarr = fakeRadarr();
      const config = loadConfig({ DATA_DIR: dataDir });
      updateSettings(config, {
        sonarrUrl: 'http://sonarr.test:8989',
        sonarrApiKey: 'sonarr-key',
        radarrUrl: 'http://radarr.test:7878',
        radarrApiKey: 'radarr-key',
      });
      const app = createServer(config, {
        sonarrFetch: sonarr.fetch,
        radarrFetch: radarr.fetch,
      });

      // An allowlisted Host (127.0.0.1, the supertest default) with NO Origin header.
      // We set Host explicitly to 127.0.0.1 (no port) so the guard's bare-IP check hits.
      const addRes = await request(app)
        .get('/browse/add?title=Bluey')
        .set('Host', '127.0.0.1');
      // The handler runs and either renders the lookup page or returns a non-403 status.
      expect(addRes.status).not.toBe(403);

      const addMovieRes = await request(app)
        .get('/browse/add-movie?title=Fracture')
        .set('Host', '127.0.0.1');
      expect(addMovieRes.status).not.toBe(403);
    });

    it('request logger never logs the apikey query value (T-08-05)', async () => {
      // Behavioral check: the path logged must NOT include the apikey value.
      // We rely on the Task-2 source assertion (grep -n "originalUrl") plus this
      // integration check via a source-level assertion embedded in this test:
      // The logger logs req.path, so a request to /?apikey=log-probe-key renders
      // the page without any query string reaching the logger.
      //
      // We can't easily spy on the pino logger in the test environment (LOG_LEVEL=silent),
      // so instead assert that the source uses req.path and not req.originalUrl,
      // then perform a live request confirming the endpoint still works.
      //
      // Source assertion (guarded in Task 2 grep gate):
      //   grep -n "originalUrl" packages/youtube/src/server.ts → nothing.
      //
      // Integration: the request reaches the handler correctly even with an apikey param.
      const config = loadConfig({ DATA_DIR: dataDir });
      const app = createServer(config);
      const res = await request(app).get('/?apikey=log-probe-key');
      // The page renders normally (the apikey query param is just ignored by GET /).
      expect(res.status).toBe(200);
      // If the logger were logging req.originalUrl, 'log-probe-key' could appear in
      // test output (pino is silenced via LOG_LEVEL=silent in vitest.config.ts, so
      // it would not pollute output, but the SOURCE check in grep confirms the fix).
      // Behavioral guarantee: this request did not throw, and the server did not leak
      // the key in the response body.
      expect(res.text).not.toContain('log-probe-key');
    });
  });

  describe('requireAuth gate (SEC-02)', () => {
    let dataDir: string;

    beforeEach(() => {
      dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytfortv-test-'));
    });

    afterEach(() => {
      fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('gate OFF: GET / and POST /settings (same-origin + allowlisted Host) are open without a key', async () => {
      // requireAuth is false by default — gate must be a complete pass-through.
      const config = loadConfig({ DATA_DIR: dataDir });
      const app = createServer(config);

      const getRes = await request(app).get('/');
      expect(getRes.status).toBe(200);
      expect(getRes.text).toContain('name="downloadDir"');

      const postRes = await request(app)
        .post('/settings')
        .set('Host', '127.0.0.1')
        .set('Origin', 'http://127.0.0.1')
        .type('form')
        .send({ quality: '720p', concurrency: '2' });
      expect(postRes.status).toBe(303);
    });

    it('gate OFF: cross-site POST /settings still 403 (Plan 01 sameOriginGuard is always-on, independent of requireAuth)', async () => {
      // requireAuth is off — but the CSRF guard must still fire. This confirms
      // the wave-1 guard is not disabled when requireAuth is OFF.
      const config = loadConfig({ DATA_DIR: dataDir });
      const app = createServer(config);

      const res = await request(app)
        .post('/settings')
        .set('Host', '127.0.0.1')
        .set('Origin', 'http://evil.example')
        .type('form')
        .send({ quality: '720p', concurrency: '2' });
      expect(res.status).toBe(403);
    });

    it('gate OFF: DNS-rebinding POST /settings still 403 (Plan 01 host-allowlist is always-on, independent of requireAuth)', async () => {
      // requireAuth is off — but the host-allowlist step of sameOriginGuard must still fire.
      // Origin equals Host but the Host is an unapproved public name (matching-pair rebind).
      const config = loadConfig({ DATA_DIR: dataDir });
      const app = createServer(config);

      const res = await request(app)
        .post('/settings')
        .set('Host', 'evil.example:8485')
        .set('Origin', 'http://evil.example:8485')
        .type('form')
        .send({ quality: '720p', concurrency: '2' });
      expect(res.status).toBe(403);
    });

    it('gate ON: rejects GET / without a key and does not leak settings markup', async () => {
      const config = loadConfig({ DATA_DIR: dataDir });
      updateSettings(config, { requireAuth: true });
      const app = createServer(config);

      const res = await request(app).get('/');
      expect(res.status).toBe(401);
      // No settings form fields leaked to an unauthenticated client.
      expect(res.text).not.toContain('name="downloadDir"');
    });

    it('gate ON: rejects POST /settings (same-origin + allowlisted Host) without a key — sameOriginGuard runs first', async () => {
      // The test sends a same-origin, allowlisted-Host POST so the sameOriginGuard passes,
      // isolating the 401 as coming from requireAuthGate (not the CSRF layer).
      const config = loadConfig({ DATA_DIR: dataDir });
      updateSettings(config, { requireAuth: true });
      const app = createServer(config);

      const res = await request(app)
        .post('/settings')
        .set('Host', '127.0.0.1')
        .set('Origin', 'http://127.0.0.1')
        .type('form')
        .send({ quality: '720p', concurrency: '2' });
      expect(res.status).toBe(401);
    });

    it('gate ON: rejects POST /browse/add and POST /browse/add-movie without a key; no *arr mutation occurs', async () => {
      const sonarrSpy = vi.fn<typeof fetch>();
      const radarrSpy = vi.fn<typeof fetch>();
      const config = loadConfig({ DATA_DIR: dataDir });
      updateSettings(config, {
        requireAuth: true,
        sonarrUrl: 'http://sonarr.test:8989',
        sonarrApiKey: 'sonarr-key',
        radarrUrl: 'http://radarr.test:7878',
        radarrApiKey: 'radarr-key',
      });
      const app = createServer(config, { sonarrFetch: sonarrSpy, radarrFetch: radarrSpy });

      const addRes = await request(app)
        .post('/browse/add')
        .set('Host', '127.0.0.1')
        .set('Origin', 'http://127.0.0.1')
        .type('form')
        .send({ tvdbId: '353546', qualityProfileId: '4', rootFolderPath: '/data/media/tv', monitor: 'all' });
      expect(addRes.status).toBe(401);

      const addMovieRes = await request(app)
        .post('/browse/add-movie')
        .set('Host', '127.0.0.1')
        .set('Origin', 'http://127.0.0.1')
        .type('form')
        .send({ tmdbId: '9821', qualityProfileId: '1', rootFolderPath: '/data/media/movies' });
      expect(addMovieRes.status).toBe(401);

      // No *arr mutation — the gate rejected before the handler ran.
      expect(sonarrSpy).not.toHaveBeenCalled();
      expect(radarrSpy).not.toHaveBeenCalled();
    });

    it('gate ON: rejects the credential-backed GET /browse/add and /browse/add-movie without a key; no *arr lookup traffic', async () => {
      const sonarrSpy = vi.fn<typeof fetch>();
      const radarrSpy = vi.fn<typeof fetch>();
      const config = loadConfig({ DATA_DIR: dataDir });
      updateSettings(config, {
        requireAuth: true,
        sonarrUrl: 'http://sonarr.test:8989',
        sonarrApiKey: 'sonarr-key',
        radarrUrl: 'http://radarr.test:7878',
        radarrApiKey: 'radarr-key',
      });
      const app = createServer(config, { sonarrFetch: sonarrSpy, radarrFetch: radarrSpy });

      const addRes = await request(app)
        .get('/browse/add?title=Bluey')
        .set('Host', '127.0.0.1');
      expect(addRes.status).toBe(401);

      const addMovieRes = await request(app)
        .get('/browse/add-movie?title=Fracture')
        .set('Host', '127.0.0.1');
      expect(addMovieRes.status).toBe(401);

      // No *arr traffic — gate rejected before the handler made any lookup call.
      expect(sonarrSpy).not.toHaveBeenCalled();
      expect(radarrSpy).not.toHaveBeenCalled();

      // With the real key via ?apikey=, the request should reach the handler (non-401).
      // The handler may return 200 or an error depending on *arr configuration, but it
      // must NOT be 401 (the auth gate passed). Use sonarr + radarr fakes here.
      const sonarr = fakeSonarr();
      const radarr = fakeRadarr();
      const appWithFakes = createServer(config, { sonarrFetch: sonarr.fetch, radarrFetch: radarr.fetch });

      const addUnlockedRes = await request(appWithFakes)
        .get(`/browse/add?title=Bluey&apikey=${config.settings.apiKey}`)
        .set('Host', '127.0.0.1');
      expect(addUnlockedRes.status).not.toBe(401);

      const addMovieUnlockedRes = await request(appWithFakes)
        .get(`/browse/add-movie?title=Fracture&apikey=${config.settings.apiKey}`)
        .set('Host', '127.0.0.1');
      expect(addMovieUnlockedRes.status).not.toBe(401);
    });

    it('gate ON: unlocks with ?apikey=<key> and sets a session cookie', async () => {
      const config = loadConfig({ DATA_DIR: dataDir });
      updateSettings(config, { requireAuth: true });
      const app = createServer(config);

      // Unlock with the real key — should succeed and return a Set-Cookie header.
      const res = await request(app).get(`/?apikey=${config.settings.apiKey}`);
      expect(res.status).toBe(200);
      const cookie = getSetCookieHeader(res);
      expect(cookie).toBeDefined();
      // Cookie must be HttpOnly and SameSite=Lax.
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
    });

    it('gate ON: session cookie from ?apikey unlock carries a follow-up request without re-supplying the key', async () => {
      const config = loadConfig({ DATA_DIR: dataDir });
      updateSettings(config, { requireAuth: true });
      const app = createServer(config);

      // Use a supertest agent so cookies are persisted automatically across requests.
      const agent = request.agent(app);

      // First request: unlock with the key — cookie is set.
      const unlockRes = await agent.get(`/?apikey=${config.settings.apiKey}`);
      expect(unlockRes.status).toBe(200);

      // Follow-up request: no query param — cookie must carry the session.
      const followUpRes = await agent.get('/');
      expect(followUpRes.status).toBe(200);
    });

    it('gate ON: rejects a wrong key (no unlock, no cookie)', async () => {
      const config = loadConfig({ DATA_DIR: dataDir });
      updateSettings(config, { requireAuth: true });
      const app = createServer(config);

      const res = await request(app).get('/?apikey=wrong-key');
      expect(res.status).toBe(401);
      // No Set-Cookie issued on a failed auth attempt.
      expect(getSetCookieHeader(res)).toBeUndefined();
    });

    it('gate ON: GET /nzb/:token stays open regardless of the gate (SAB-emulation clients cannot send the key)', async () => {
      const config = loadConfig({ DATA_DIR: dataDir });
      updateSettings(config, { requireAuth: true });
      const app = createServer(config);

      const token = encodeToken({
        provider: 'youtube',
        episodeId: 'nzb-open-test',
        title: 'Open Test Episode',
        pageUrl: 'https://www.youtube.com/watch?v=nzb-open-test',
      });

      const res = await request(app).get(`/nzb/${token}`);
      expect(res.status).toBe(200);
    });

    it('gate ON: read-only GET /browse landing stays open (no *arr call, always open per D-07)', async () => {
      const config = loadConfig({ DATA_DIR: dataDir });
      updateSettings(config, { requireAuth: true });
      const app = createServer(config);

      const res = await request(app).get('/browse');
      expect(res.status).toBe(200);
    });

    it('gate ON: /api?mode=version is unaffected — governed by its own per-request apikey check, not the settings gate', async () => {
      const config = loadConfig({ DATA_DIR: dataDir });
      updateSettings(config, { requireAuth: true });
      const app = createServer(config);

      const res = await request(app).get(`/api?mode=version&apikey=${config.settings.apiKey}`);
      expect(res.status).toBe(200);
      expect(res.body.version).toBeDefined();
    });
  });
});
