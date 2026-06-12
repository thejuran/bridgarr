# YTforTV

Search YouTube from Sonarr and Radarr for **obscure or older broadcast TV shows and movies** that no usenet or torrent indexer carries — but that exist on YouTube as user uploads, often low quality, rarely labeled `S01E01`, frequently titled "… full episode". Better than nothing.

YTforTV is a bridge: it pretends to be a **Newznab indexer** and a **SABnzbd download client**. Sonarr/Radarr search it like any other indexer; grabs are downloaded with **yt-dlp** and imported normally.

## What it is — and is not

- **Is:** a last-resort source for *traditionally broadcast* content already in (or being added to) your Sonarr/Radarr library.
- **Is not:** a tool for native YouTube content. It does not treat channels as series. For that, use ytdl-sub or Tube Archivist.
- **Trust model:** built for **Interactive Search**. YouTube results are messy (clips, compilations, mislabeled uploads); you pick the right one by eye. Every release name carries the real upload title, length, and channel so you can judge:

  ```
  Roobarb.S01E01.YT.When.Roobarb.Made.a.Spike.5min.480p.WEB-DL-TannerandJessie
  └─ stamped from your search ┘└─ real upload title ┘└┘   └─ fixed tag ┘└ channel ┘
  ```

  The season/episode (or movie title/year) is **stamped from what you searched**, so Sonarr/Radarr always map results back to the right episode/movie. The Size column is derived from video length (~15 MB/min), so it doubles as a duration gauge.

## How a grab flows

1. Sonarr Interactive Search → YTforTV fans your query out over several YouTube search phrasings (`S01E02`, `season 1 episode 2`, `1x02`, `full episode`), merges and filters the results (clips below a duration floor, livestreams, other shows are dropped).
2. You pick a result → Sonarr downloads a fake NZB from YTforTV and hands it to the "SABnzbd" download client (also YTforTV).
3. yt-dlp downloads the actual video; the finished file lands in the complete dir; Sonarr imports it as usual.

## Setup

### Run it

```yaml
# docker-compose.yml (Synology/NAS)
ytfortv:
  image: ghcr.io/thejuran/ytfortv:dev
  container_name: ytfortv
  ports:
    - "8485:8485"
  environment:
    - DATA_DIR=/config
  volumes:
    - /volume1/docker/ytfortv:/config
    - /volume1/data:/data        # same path Sonarr/Radarr see, so imports need no remapping
  restart: unless-stopped
```

First run generates an API key — open `http://<host>:8485` to see it and adjust settings. Set the **complete directory** to a path that Sonarr/Radarr can also see at the *same* path (e.g. `/data/ytfortv/complete`).

### Sonarr

1. **Indexer** → add **Newznab**: URL `http://<host>:8485`, API path `/api`, API key from settings.
   - **Enable RSS: off. Enable Automatic Search: off. Enable Interactive Search: on.** This indexer is for hand-picked grabs only — automatic grabbing of YouTube results will eventually import a mislabeled upload.
2. **Download client** → add **SABnzbd**: host `<host>`, port `8485`, API key as above, category `sonarr`.
3. **Quality profile**: results are tagged with a fixed quality (default `480p`, a deliberate under-promise — YouTube search doesn't expose resolution). Your profile must *allow* WEBDL-480p or every result will be rejected.

### Radarr

Same as Sonarr (category `radarr`). Movie searches extract the year from Radarr's query and stamp it into release names.

### Browse UI

`http://<host>:8485/browse` — raw YouTube search for scouting ("does this show even exist on YouTube?") and adding a found show/movie to Sonarr/Radarr. Grabbing still happens in Sonarr/Radarr.

## Settings reference

| Setting | Default | Meaning |
|---|---|---|
| Download quality | `1080p` | yt-dlp resolution cap for the actual download |
| Release quality tag | `480p` | Quality token stamped into release names |
| Min TV result length | `10` min | Drops clips/trailers from TV searches |
| Min movie result length | `45` min | Drops clips/trailers/reviews from movie searches |
| Title filter | on | Require every word of the searched title in the upload title |
| Cookies file | _(blank)_ | Netscape-format cookies passed to yt-dlp — escape hatch if YouTube bot-checks your IP. Mount the file into the container and set the path (e.g. `/config/cookies.txt`) |

## Notes & limitations

- **Season packs and daily shows** are not supported (nothing sane to stamp); search episode-by-episode.
- **yt-dlp freshness:** YouTube breaks extractors regularly. The container self-updates yt-dlp on every start (`YTDLP_AUTOUPDATE=0` to disable); restart the container if downloads start failing.
- **The connection test release:** the indexer answers Sonarr/Radarr's parameterless test search with one synthetic release (`YTforTV.Indexer.Test...`) so the save-time test passes. It maps to no real series and can never be grabbed by accident.
- **Legal note:** uploads of broadcast content on YouTube are frequently unauthorized; whether downloading them is acceptable is on you.

## Development

```sh
npm ci
npm run dev        # tsx watch, port 8485
npm test           # vitest
npm run typecheck && npm run lint
```

Tests run against recorded yt-dlp fixtures — no network needed.
