import express, { type Express, type Request, type Response } from 'express';
import multer from 'multer';
import type { Config } from './config.js';
import { DownloadQueue } from './downloads/queue.js';
import { logger } from './logger.js';
import { handleNewznab, type AppContext } from './newznab/router.js';
import { buildNzb, decodeToken } from './nzb.js';
import { handleSab } from './sabnzbd/router.js';
import { handleSettingsSave, renderSettingsPage } from './ui/settings.js';
import type { VideoSource } from './youtube/types.js';

export interface ServerDeps {
  /** YouTube search backend; injectable for tests. */
  source?: VideoSource;
  queue?: DownloadQueue;
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

  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', service: 'ytfortv' });
  });

  app.get('/', (req, res) => {
    res.type('html').send(renderSettingsPage(config, req.query.saved === '1'));
  });
  app.post('/settings', express.urlencoded({ extended: false }), (req, res) => {
    handleSettingsSave(config, req, res);
  });

  // Sonarr talks to one /api endpoint for both roles: Newznab requests carry
  // ?t=..., SABnzbd requests carry ?mode=...
  const upload = multer({ storage: multer.memoryStorage() });
  const apiDispatch = async (req: Request, res: Response) => {
    if (typeof req.query.t === 'string') {
      await handleNewznab(ctx, req, res);
      return;
    }
    if (typeof req.query.mode === 'string') {
      handleSab({ config, queue }, req, res);
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
    res.setHeader('Content-Disposition', `attachment; filename="${payload.title}.nzb"`);
    res.send(buildNzb(payload));
  });

  return app;
}
