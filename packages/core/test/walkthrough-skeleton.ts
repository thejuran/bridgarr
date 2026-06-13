// Mirror of the README.md "Build your own bridge" walkthrough skeleton — keep in sync. Exists to type-check the public walkthrough (incl. the Newznab + SABnzbd /api dispatch).

import express, { type Request, type Response } from 'express';
import multer from 'multer';
import {
  DownloadQueue,
  healthzHandler,
  handleSab,
  encodeToken,
  decodeToken,
  buildNzb,
  capsXml,
  searchRss,
  errorXml,
  type SabContext,
  type SourceBridge,
  type BridgeResult,
  type ReleaseItem,
} from '@bridgarr/core';

// ---------------------------------------------------------------------------
// Step 1: Implement SourceBridge
// ---------------------------------------------------------------------------

class MySiteBridge implements SourceBridge {
  async searchTv(
    title: string,
    season: number,
    episode: number,
  ): Promise<BridgeResult[]> {
    return [
      {
        itemId: 'example-id-001',
        pageUrl: 'https://www.example.com/watch/example-id-001',
        sourceTitle: `${title} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`,
        durationSec: 1800,
        channel: 'ExampleChannel',
      },
    ];
  }

  async searchMovie(title: string, year?: number): Promise<BridgeResult[]> {
    void year; // optional — may be undefined
    void title;
    return []; // TV-only bridge
  }

  // infoUrl and releaseName are RESERVED optional hooks — not yet consumed.
  // Do not implement them; they have no effect today.
}

// ---------------------------------------------------------------------------
// Step 2: Wire core into an Express app
// ---------------------------------------------------------------------------

export function buildBridge(): ReturnType<typeof express> {
  const BRIDGE_META  = 'my-bridge';
  const API_KEY      = process.env.API_KEY      ?? 'change-me';
  const COMPLETE_DIR = process.env.COMPLETE_DIR ?? '/data/complete';

  const queue  = new DownloadQueue();
  const source = new MySiteBridge();
  const app    = express();
  app.disable('x-powered-by');
  app.use(express.json());

  app.get('/healthz', healthzHandler(BRIDGE_META));

  const sabCtx: SabContext = {
    settings: { apiKey: API_KEY, completeDir: COMPLETE_DIR, metaType: BRIDGE_META },
    queue,
  };

  const upload = multer({ storage: multer.memoryStorage() });

  // One /api endpoint, two roles:
  //   ?t=...    → Newznab indexer side (capsXml / searchRss / errorXml)
  //   ?mode=... → SABnzbd download-client side (handleSab)
  const apiDispatch = async (req: Request, res: Response): Promise<void> => {
    if (typeof req.query.t === 'string') {
      const t = req.query.t;

      if (t === 'caps') {
        // Sonarr's Test button hits ?t=caps — MUST return caps XML.
        res.type('application/xml').send(capsXml({ title: BRIDGE_META }));
        return;
      }

      let results: BridgeResult[] = [];
      const rawTitle = String(req.query.q ?? '');
      // Use an explicit presence check, NOT `|| 1`: Sonarr searches Specials
      // with season=0, and `0 || 1` would wrongly coerce it to season 1.
      const season   = req.query.season !== undefined ? Number(req.query.season) : 1;
      const episode  = req.query.ep     !== undefined ? Number(req.query.ep)     : 1;

      if (t === 'tvsearch') {
        results = await source.searchTv(rawTitle, season, episode);
      } else if (t === 'movie' || t === 'search') {
        // Radarr text-searches send t=search (not t=movie) — route to movie.
        results = await source.searchMovie(rawTitle);
      } else {
        res.type('application/xml').send(errorXml(201, `Unknown function: ${t}`));
        return;
      }

      const baseUrl = `${req.protocol}://${req.get('host') ?? 'localhost'}`;
      const items: ReleaseItem[] = results.map((r) => ({
        title:       r.sourceTitle,
        nzbUrl:      `${baseUrl}/nzb/${encodeToken({
          provider:  BRIDGE_META,
          episodeId: r.itemId,
          title:     r.sourceTitle,
          pageUrl:   r.pageUrl,
        })}`,
        commentsUrl: r.pageUrl,
        sizeBytes:   r.durationSec * 500_000,
        pubDate:     new Date(),
        season:      t === 'tvsearch' ? season : null,
        episode:     t === 'tvsearch' ? episode : null,
        categories:  [5000, 5040],
      }));

      res.type('application/xml').send(searchRss(items, BRIDGE_META));
      return;
    }

    if (typeof req.query.mode === 'string') {
      handleSab(sabCtx, req, res);
      return;
    }

    res.status(400).json({ error: 'unknown api request' });
  };

  app.get('/api',                apiDispatch);
  app.post('/api', upload.any(), apiDispatch);

  // Fake-NZB endpoint — the nzbUrl values in the searchRss feed point here.
  app.get('/nzb/:token', (req, res) => {
    let payload;
    try {
      payload = decodeToken(req.params.token);
    } catch {
      res.status(404).send('not found');
      return;
    }
    const safeName = payload.title.replace(/[\r\n"]/g, '');
    res.type('application/x-nzb');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.nzb"`);
    res.send(buildNzb(payload, { metaType: BRIDGE_META }));
  });

  return app;
}
