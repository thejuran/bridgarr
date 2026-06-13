/**
 * Source-bridge contract — the product of @bridgarr/core.
 *
 * A bridge knows how its source site organises content; core knows how to talk
 * to the *arrs. The bridge supplies discovery and (optionally) naming; yt-dlp
 * handles fetching.
 *
 * @module bridge
 */

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

/**
 * A single search result returned by a source bridge.
 *
 * Core uses this to build the Newznab RSS feed and to mint the fake-NZB token
 * that is later decoded by the SABnzbd-emulation layer. Every field maps to
 * something the *arrs display or act on — nothing here is source-specific.
 */
export interface BridgeResult {
  /**
   * Unique identifier for this item within this bridge (e.g. a video ID, slug,
   * or episode permalink). This value is carried verbatim inside the NZB token
   * so the bridge can recover it when the *arr sends the download request.
   * Must be stable and URL-safe.
   */
  itemId: string;

  /**
   * URL that the download runner will pass to yt-dlp (or the equivalent
   * extractor). Must be a watch-page or player URL that the extractor can
   * handle — NOT a direct media stream URL. Example:
   * `https://www.example-site.com/watch/abc123`.
   */
  pageUrl: string;

  /**
   * Human-readable title of this item as it appears on the source site.
   * Shown verbatim in Sonarr/Radarr's Interactive Search so the user can judge
   * the upload quality before grabbing. The naming layer transforms this into
   * the scene-format release name — keep it as the raw source title.
   */
  sourceTitle: string;

  /**
   * Duration of the item in whole seconds. Used to derive the release-size
   * estimate shown in Sonarr/Radarr (size ≈ durationSec × bitrate proxy). Set
   * to 0 when the source does not expose duration.
   */
  durationSec: number;

  /**
   * Channel, uploader, publisher, or network name from the source site. Stamped
   * as the release group in the scene-format release name (the `-Channel` suffix
   * after `WEB-DL`). May be an empty string when unavailable.
   */
  channel: string;
}

// ---------------------------------------------------------------------------
// Naming hook types
// ---------------------------------------------------------------------------

/**
 * The resolved identity of a search result — which episode or movie this
 * release corresponds to. Passed to {@link SourceBridge.releaseName} so the
 * bridge can format the scene-style name correctly.
 *
 * For TV: `kind === 'tv'` and `season`/`episode` carry the requested numbers.
 * For movies: `kind === 'movie'` and `year` carries the release year when
 * Radarr included one.
 */
export interface ReleaseIdentity {
  /** Whether this is a TV episode or a movie. */
  kind: 'tv' | 'movie';

  /**
   * Season number (1-based). Present when `kind === 'tv'`, `undefined` for
   * movies.
   */
  season?: number;

  /**
   * Episode number within the season (1-based). Present when `kind === 'tv'`,
   * `undefined` for movies.
   */
  episode?: number;

  /**
   * Release year. Present when `kind === 'movie'` and the *arr included a year
   * in the query, `undefined` otherwise. May also be set for TV if the search
   * carried a disambiguation year, though naming typically ignores it for TV.
   */
  year?: number;
}

// ---------------------------------------------------------------------------
// Source-bridge interface
// ---------------------------------------------------------------------------

/**
 * The contract every source bridge must implement to interoperate with
 * @bridgarr/core.
 *
 * **Required:** `searchTv` and `searchMovie`. A bridge that only handles movies
 * may return `[]` from `searchTv`; a TV-only bridge may return `[]` from
 * `searchMovie`.
 *
 * **Optional hooks:** `infoUrl` and `releaseName`. Omitting them does not break
 * core — defaults are applied automatically (see each hook's doc).
 *
 * **Boundary one-liner:** core knows how to talk to the *arrs and how to
 * compare titles; each bridge knows how its site organises content.
 *
 * @example Minimal implementation
 * ```ts
 * class MyBridge implements SourceBridge {
 *   async searchTv(title, season, episode) { return []; }
 *   async searchMovie(title, year?)       { return []; }
 * }
 * ```
 */
export interface SourceBridge {
  /**
   * Find items on the source site that match the requested TV episode.
   *
   * @param title   Show title as Sonarr sent it. May include a trailing
   *                disambiguation year (e.g. `"Bluey 2018"`). Strip the year
   *                before querying the source site if the year would confuse
   *                search results — use `stripSearchYear` from @bridgarr/core.
   * @param season  Season number (1-based).
   * @param episode Episode number within the season (1-based).
   * @returns Ranked list of candidates, best match first. Return `[]` if the
   *          source does not carry the requested episode. Never throw — return
   *          `[]` on non-fatal errors and log internally.
   */
  searchTv(title: string, season: number, episode: number): Promise<BridgeResult[]>;

  /**
   * Find items on the source site that match the requested movie.
   *
   * @param title Movie title as Radarr sent it (no year embedded — Radarr
   *              strips the year and sends it separately via `year`).
   * @param year  Release year, when Radarr included one in the query. May be
   *              `undefined`. Use it to disambiguate titles rather than to
   *              constrain results too aggressively.
   * @returns Ranked list of candidates, best match first. Return `[]` when not
   *          found.
   */
  searchMovie(title: string, year?: number): Promise<BridgeResult[]>;

  /**
   * **Optional.** Return the URL to display as the "info link" in
   * Sonarr/Radarr's Interactive Search (the globe icon that opens in the
   * browser). When omitted, core uses `result.pageUrl`.
   *
   * Override when the source has a separate human-browsable page that is
   * distinct from the yt-dlp-fetchable URL — for example, a series info page
   * versus a direct player URL.
   *
   * @param result The BridgeResult whose info URL is needed.
   * @returns A fully-qualified URL string.
   */
  infoUrl?(result: BridgeResult): string;

  /**
   * **Optional.** Produce the scene-style release name that Sonarr/Radarr
   * show in search results and use as the download filename.
   *
   * When omitted, core/app applies a default naming strategy derived from
   * `result.sourceTitle`, `result.channel`, and the identity
   * (season/episode numbers or year) — for example:
   * `Show.Name.S01E02.YT.Source.Title.52min.480p.WEB-DL-Channel`.
   *
   * Override this hook when your source site requires a different naming
   * convention (e.g. a different quality token, a different slug format, or
   * title sanitisation specific to that site's upload style).
   *
   * **Contract:**
   * - Return a dot-delimited scene-format name, e.g.
   *   `"Show.Name.S01E02.Source.Title.WEB-DL-Channel"`.
   * - Use `identity.kind` to branch between TV and movie formats.
   * - For TV: stamp `S{ss}E{ee}` using `identity.season` / `identity.episode`.
   * - For movies: include `identity.year` when present to help Radarr match.
   * - Do NOT embed user-supplied content without sanitisation — the name
   *   becomes a filename; avoid path-separator characters (`/`, `\`).
   *
   * @param result   The matched BridgeResult (provides sourceTitle, channel,
   *                 durationSec, pageUrl, itemId).
   * @param identity The resolved episode/movie identity (kind, season, episode,
   *                 year).
   * @returns The complete dot-delimited scene-style release name string.
   */
  releaseName?(result: BridgeResult, identity: ReleaseIdentity): string;
}
