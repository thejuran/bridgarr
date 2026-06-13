# bridgarr

A typed, tested substrate for building \*arr source bridges — plus the YouTube reference bridge that lets Sonarr/Radarr search and "download" YouTube content via yt-dlp.

[![CI](https://github.com/thejuran/bridgarr/actions/workflows/ci.yml/badge.svg)](https://github.com/thejuran/bridgarr/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## Contents

- [What is bridgarr](#what-is-bridgarr)
- [How it works](#how-it-works)
- [Build your own bridge](#build-your-own-bridge)
- [Bridges](#bridges)
- [How is this different from other projects](#how-is-this-different-from-other-projects)
- [FAQ](#faq)
- [Known limitations](#known-limitations)
- [Contributing](#contributing)
- [License](#license)

---

## What is bridgarr

`@bridgarr/core` is a typed, tested TypeScript library — the shared substrate for building \*arr source bridges. It handles everything the \*arrs need: Newznab indexer emulation (caps, search, RSS feed), SABnzbd download-client emulation (queue, history, addfile), a fake-NZB token codec, title normalization and matching, and a `/healthz` endpoint. You write the bridge; core writes the \*arr wire format.

The repo also ships **bridgarr-youtube** (formerly ytfortv), the reference bridge. It pairs `@bridgarr/core` with yt-dlp to let Sonarr and Radarr search YouTube and "download" episodes through the normal grab flow — Interactive Search, queue, history, everything. It is both a usable self-hosted tool and the existence proof that the substrate works.

---

## How it works

Sonarr and Radarr talk to a bridge over two well-documented open protocols. A bridgarr-based bridge presents itself as both:

1. **A Newznab indexer** — Sonarr/Radarr send search requests with a `?t=` param (`t=caps` for the capabilities check and Test button, `t=tvsearch` / `t=movie` for searches). The bridge calls the bridge's `searchTv` or `searchMovie` method, maps results to Newznab RSS items, and responds with XML.

2. **A SABnzbd download client** — When Sonarr/Radarr grab a result they send a `?mode=` request (`mode=addfile` with the fake NZB, `mode=queue` to check status, etc.). The bridge decodes the NZB token to recover what to download, queues the job, and streams progress back.

Both roles share a **single `/api` endpoint**. A dispatcher branches on which query param is present: `req.query.t` for the Newznab indexer side, `req.query.mode` for the SABnzbd download side.

The boundary that makes this composable: *core knows how to talk to the \*arrs and how to compare titles; each bridge knows how its site organises content.*

---

## Build your own bridge

This walkthrough takes you from `npm install` to a type-checking, Sonarr-pointable bridge skeleton. The skeleton responds to Sonarr's indexer Test and can be pointed at a real site next.

### Install

```bash
npm install @bridgarr/core express multer
npm install --save-dev typescript @types/express @types/multer @types/node
```

`multer` is required because `handleSab`'s `addfile` mode reads the uploaded fake-NZB from `req.files` (a multer-shaped array of `{ buffer, originalname }`). Express's built-in body parsers — `express.raw`, `express.json`, `express.urlencoded` — do not populate `req.files`. The POST `/api` route needs a multipart parser with `upload.any()`.

### Implement SourceBridge

Implement the `SourceBridge` interface — two required methods, two reserved extension points.

```typescript
import type { SourceBridge, BridgeResult } from '@bridgarr/core';

class MySiteBridge implements SourceBridge {
  async searchTv(
    title: string,
    season: number,
    episode: number,
  ): Promise<BridgeResult[]> {
    // TODO: query your source site here.
    // stripSearchYear(title) removes the trailing year Sonarr sometimes appends.
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
    return []; // TV-only bridge
  }

  // infoUrl and releaseName are RESERVED optional hooks — not yet consumed
  // by the reference integration. Mention them as future extension points;
  // do not implement them yet (they have no effect today).
}
```

### Wire core into an Express app

Core ships no convenience server factory — there is no single function that builds and returns a ready-made bridge server. You assemble the parts yourself: instantiate the queue, construct the SAB context, write the dispatcher, and register the routes. This is the toolkit model; you own the Express app.

```typescript
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
  type ReleaseItem,
} from '@bridgarr/core';

const BRIDGE_META = 'my-bridge';
const API_KEY    = process.env.API_KEY    ?? 'change-me';
const COMPLETE_DIR = process.env.COMPLETE_DIR ?? '/data/complete';
const PORT       = Number(process.env.PORT) || 8080;

const queue  = new DownloadQueue();
const source = new MySiteBridge();
const app    = express();
app.disable('x-powered-by');
app.use(express.json());

app.get('/healthz', healthzHandler(BRIDGE_META));

// Build a SabContext once; pass it to handleSab on every SABnzbd request.
const sabCtx: SabContext = {
  settings: { apiKey: API_KEY, completeDir: COMPLETE_DIR, metaType: BRIDGE_META },
  queue,
};

// multer with memoryStorage() populates req.files for the addfile mode.
const upload = multer({ storage: multer.memoryStorage() });

// One /api endpoint, two roles:
//   ?t=...    → Newznab indexer (Sonarr/Radarr search + caps)
//   ?mode=... → SABnzbd download client (grab, queue, history)
const apiDispatch = async (req: Request, res: Response): Promise<void> => {
  if (typeof req.query.t === 'string') {
    // --- Newznab indexer side -------------------------------------------
    const t = req.query.t;

    if (t === 'caps') {
      // Sonarr's Test button hits ?t=caps. It MUST return caps XML or the
      // indexer test fails.
      res.type('application/xml').send(capsXml({ title: BRIDGE_META }));
      return;
    }

    let results: Awaited<ReturnType<typeof source.searchTv>> = [];
    const rawTitle = String(req.query.q ?? '');
    const season   = Number(req.query.season) || 1;
    const episode  = Number(req.query.ep)     || 1;

    if (t === 'tvsearch' || t === 'search') {
      results = await source.searchTv(rawTitle, season, episode);
    } else if (t === 'movie') {
      results = await source.searchMovie(rawTitle);
    } else {
      res.type('application/xml').send(errorXml(201, `Unknown function: ${t}`));
      return;
    }

    // Map each BridgeResult to the ReleaseItem shape searchRss expects.
    const baseUrl = `${req.protocol}://${req.get('host') ?? 'localhost'}`;
    const items: ReleaseItem[] = results.map((r) => ({
      title:      r.sourceTitle,
      nzbUrl:     `${baseUrl}/nzb/${encodeToken({
        provider:  BRIDGE_META,
        episodeId: r.itemId,
        title:     r.sourceTitle,
        pageUrl:   r.pageUrl,
      })}`,
      commentsUrl: r.pageUrl,
      sizeBytes:   r.durationSec * 500_000, // rough estimate: ~500 kB/s
      pubDate:     new Date(),
      season:      t === 'tvsearch' ? season : null,
      episode:     t === 'tvsearch' ? episode : null,
      categories:  [5000, 5040],
    }));

    res.type('application/xml').send(searchRss(items, BRIDGE_META));
    return;
  }

  if (typeof req.query.mode === 'string') {
    // --- SABnzbd download-client side ------------------------------------
    handleSab(sabCtx, req, res);
    return;
  }

  res.status(400).json({ error: 'unknown api request' });
};

app.get('/api',                    apiDispatch);
app.post('/api', upload.any(),     apiDispatch);

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

app.listen(PORT, () => console.log(`Bridge running on :${PORT}`));
```

This skeleton type-checks against the real `@bridgarr/core` exports (the repo keeps a committed type-checked copy at [`packages/core/test/walkthrough-skeleton.ts`](packages/core/test/walkthrough-skeleton.ts) so it cannot silently bitrot). Point Sonarr at `http://<host>:<port>` — it will use `/api` for both the indexer and download-client URLs. The `?t=caps` branch means Sonarr's **Test** button works immediately. Fill in `searchTv` with real site logic to get actual results.

For a fully worked example, see the **bridgarr-youtube** reference bridge (below) and its source at [`packages/youtube/`](packages/youtube/).

---

## Bridges

### bridgarr-youtube

The reference bridge — Sonarr/Radarr → YouTube, via yt-dlp. Self-hosters can run it today; bridge developers can use it as a worked example of `SourceBridge` in production.

See [`packages/youtube/README.md`](packages/youtube/README.md) for Docker Compose setup, self-hosted configuration, and Sonarr/Radarr wiring instructions.

---

## How is this different from other projects

Several projects tackle the "*arr + non-Usenet source" problem. They have different goals; here is where bridgarr fits.

| Project | Source | Integration model | For |
|---------|--------|-------------------|-----|
| bridgarr | YouTube (+ future) | Newznab indexer + SABnzbd client | Typed, tested, reusable TypeScript substrate for \*arr bridges |
| newznabarr | Any (plugin-based) | Same emulation pattern | Python plugin framework, early alpha |
| tgarr | Telegram | Same emulation pattern | Telegram-channel content |
| sonarr\_youtubedl | YouTube | Companion script (no Newznab/SABnzbd) | Automatic channel-based downloads, no interactive search |
| TubeSync / Pinchflat | YouTube | None (own archive system) | Channel archiving, not \*arr integration |

### newznabarr

[newznabarr](https://github.com/riffsphereha/newznabarr) is a Python plugin framework tackling the same Newznab + SABnzbd emulation pattern. It is at an early alpha stage with plugins for Readarr and Lidarr. If Python is your language or you need a plugin architecture, it is worth watching. Bridgarr's differentiator is a typed, tested TypeScript substrate with a clean `SourceBridge` interface and a YouTube reference bridge that passes a live Sonarr e2e.

### tgarr

[tgarr](https://github.com/tgarrpro/tgarr) bridges Telegram channels into Sonarr/Radarr using the same Newznab + SABnzbd emulation approach. It is built for content distributed through Telegram specifically, and is an early-stage project. If your content lives in Telegram channels, tgarr is the right tool; bridgarr targets YouTube and any source a bridge can scrape.

### sonarr\_youtubedl

[sonarr\_youtubedl](https://github.com/whatdaybob/sonarr_youtubedl) (and its forks) are companion scripts that bypass the Newznab/SABnzbd layer entirely: they read Sonarr's wanted list and download matching YouTube content automatically. The tradeoff is that you lose Interactive Search — every match is auto-grabbed. Bridgarr uses Interactive Search so you pick the right upload by eye, which matters for unstructured YouTube content where upload quality and accuracy varies.

### TubeSync and Pinchflat

[TubeSync](https://github.com/mmeyer2k/tubesync) and [Pinchflat](https://github.com/kieraneglin/pinchflat) are channel archivers: they subscribe to YouTube channels and sync uploads to your local library. If you want to treat a channel as a series — archiving everything — they are the right tool. Bridgarr is for the opposite use case: specific episodes of traditionally-broadcast shows that happen to have YouTube uploads, integrated into Sonarr/Radarr's interactive search so you retain full \*arr control over what gets grabbed.

---

## FAQ

### Why SABnzbd emulation instead of a real \*arr plugin?

Sonarr and Radarr have no plugin system — you cannot add a new download source by dropping in code. The integration points they expose are a pair of well-documented open protocols: **Newznab** (for indexing and search) and **SABnzbd** (for download management). Any service that speaks those protocols gets full \*arr support: search results appear in Interactive Search, grabs are routed correctly, and history shows up in the queue.

Bridgarr implements both protocols, which is why Sonarr treats it like any other indexer/downloader pair. This is not a workaround — every third-party source bridge in the ecosystem (iplayer-arr, tgarr, newznabarr, and others) independently chose the same approach, because it is the only stable integration surface the \*arrs expose.

### What does a bridge author need to implement?

Two methods: `searchTv(title, season, episode)` and `searchMovie(title, year?)`. Both return a list of `BridgeResult` objects. Core handles everything else — the Newznab XML format, the SABnzbd emulation, the fake-NZB token codec, and the download queue. See the walkthrough above.

### Does it work with Radarr for movies?

Yes. The `?t=movie` Newznab search type and the `searchMovie` bridge method cover movie lookups. The `ReleaseItem` shape and the SABnzbd grab flow are identical for movies and TV.

---

## Known limitations

### In-memory download queue

The download queue is held entirely in memory. If the bridge process restarts mid-download, queued and in-progress jobs disappear. Sonarr will retry automatically on the next search cycle, so this is a reliability nuance rather than a fatal limitation — but it means the bridge is not suited for very long downloads where a restart mid-job would be disruptive.

### The yt-dlp arms race

Each bridge contains knowledge of one source site. Sites change: yt-dlp extractors need updates, YouTube occasionally blocks extractors, and API shapes shift. `@bridgarr/core` itself is unaffected by any of this — the substrate only knows how to talk to the \*arrs. When the source site changes in a way yt-dlp cannot handle, only the bridge package needs an update; other bridges keep working.

The bridgarr-youtube container self-updates yt-dlp on every start to reduce this friction. When a deeper extractor fix is required, a container update is sufficient — core stays stable.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

MIT — see [LICENSE](LICENSE).
