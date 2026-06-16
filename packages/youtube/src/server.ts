import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import type { Config } from './config.js';
import { DownloadQueue } from '@bridgarr/core';
import { logger } from './logger.js';
import { handleNewznab, type AppContext } from './newznab/router.js';
import { buildNzb, decodeToken, handleSab, healthzHandler } from '@bridgarr/core';
import {
  handleAddMoviePage,
  handleAddMovieSubmit,
  handleAddPage,
  handleAddSubmit,
  handleBrowsePage,
  type BrowseContext,
  type BrowseSearchFn,
} from './ui/browse.js';
import { handleSettingsSave, renderSettingsPage } from './ui/settings.js';
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

export function createServer(config: Config, deps: ServerDeps = {}): Express {
  const queue = deps.queue ?? new DownloadQueue();
  const ctx: AppContext = {
    config,
    source: deps.source ?? null,
  };

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  app.use((req, _res, next) => {
    logger.debug({ method: req.method, url: req.originalUrl }, 'request');
    next();
  });

  app.get('/healthz', healthzHandler('bridgarr-youtube'));

  app.get('/', (req, res) => {
    res.type('html').send(renderSettingsPage(config, req.query.saved === '1'));
  });
  app.post('/settings', express.urlencoded({ extended: false }), (req, res) => {
    handleSettingsSave(config, req, res);
  });

  const browseCtx: BrowseContext = {
    config,
    searchFn: deps.browseSearch,
    sonarrFetch: deps.sonarrFetch,
    radarrFetch: deps.radarrFetch,
  };
  app.get('/browse', (req, res) => handleBrowsePage(browseCtx, req, res));
  app.get('/browse/add', (req, res) => handleAddPage(browseCtx, req, res));
  app.post('/browse/add', express.urlencoded({ extended: false }), (req, res) =>
    handleAddSubmit(browseCtx, req, res),
  );
  app.get('/browse/add-movie', (req, res) => handleAddMoviePage(browseCtx, req, res));
  app.post('/browse/add-movie', express.urlencoded({ extended: false }), (req, res) =>
    handleAddMovieSubmit(browseCtx, req, res),
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

  // Error-handling middleware for multer upload-constraint violations (HARD-01).
  // Must be registered AFTER app.post('/api', ...) so Express routes multer errors here.
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

  return app;
}
