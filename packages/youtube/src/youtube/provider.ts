import type { BridgeResult, SourceBridge } from '@bridgarr/core';
import type { Config } from '../config.js';
import { logger } from '../logger.js';
import { normalizeShowTitle } from '@bridgarr/core';
import { buildMovieQueries, buildTvQueries } from './queries.js';
import { searchYouTube, type FlatEntry } from './search.js';

/** Injectable search backend — tests feed fixture entries per query. */
export type SearchFn = (query: string, n: number) => Promise<FlatEntry[]>;

const TV_RESULTS_PER_QUERY = 20;
const MOVIE_RESULTS_PER_QUERY = 25;
const MAX_RESULTS = 50;
const DROP_LIVE = new Set(['is_live', 'is_upcoming', 'post_live']);

/**
 * YouTube-backed SourceBridge: fans a request out over several query
 * phrasings, merges by video id, then filters the noise YouTube search
 * returns (other shows, clips, trailers, livestreams) and ranks what's left.
 */
export class YouTubeSource implements SourceBridge {
  private readonly config: Config;
  private readonly searchFn: SearchFn | undefined;

  constructor(config: Config, searchFn?: SearchFn) {
    this.config = config;
    this.searchFn = searchFn;
  }

  async searchTv(title: string, season: number, episode: number): Promise<BridgeResult[]> {
    // The Newznab router already gates absence (season/episode === null) and the
    // empty-q connection test before we get here, so season/episode are real,
    // non-negative numbers. Guard only against negatives — season 0 (Sonarr
    // Specials) and episode 0 are legitimate and must NOT be dropped.
    if (season < 0 || episode < 0) return [];
    const entries = await this.fanOut(buildTvQueries(title, season, episode), TV_RESULTS_PER_QUERY);
    return this.pipeline(entries, title, this.config.settings.minTvMinutes, tvBoost(season, episode));
  }

  async searchMovie(title: string, year?: number): Promise<BridgeResult[]> {
    const entries = await this.fanOut(buildMovieQueries(title, year), MOVIE_RESULTS_PER_QUERY);
    return this.pipeline(entries, title, this.config.settings.minMovieMinutes, movieBoost());
  }

  private search(query: string, n: number): Promise<FlatEntry[]> {
    if (this.searchFn) return this.searchFn(query, n);
    return searchYouTube(query, n, { cookiesFile: this.config.settings.cookiesFile });
  }

  /** Run all variants concurrently; merge in variant-priority order, dedupe by id. */
  private async fanOut(queries: string[], n: number): Promise<FlatEntry[]> {
    const results = await Promise.all(
      queries.map((q) =>
        this.search(q, n).catch((err: unknown) => {
          logger.warn({ query: q, err }, 'search variant failed');
          return [] as FlatEntry[];
        }),
      ),
    );
    const seen = new Set<string>();
    const merged: FlatEntry[] = [];
    for (const list of results) {
      for (const entry of list) {
        if (!entry.id || seen.has(entry.id)) continue;
        seen.add(entry.id);
        merged.push(entry);
      }
    }
    return merged;
  }

  private pipeline(
    entries: FlatEntry[],
    title: string,
    minMinutes: number,
    boost: (v: BridgeResult, viewCount: number | null) => number,
  ): BridgeResult[] {
    const floor = minMinutes * 60;
    // Keep viewCount alongside BridgeResult for internal ranking only.
    let ranked = entries.filter(usable).map(toRanked);
    ranked = ranked.filter((r) => r.result.durationSec >= floor);
    if (this.config.settings.titleFilter) {
      ranked = ranked.filter((r) => titleWordsMatch(title, r.result.sourceTitle));
    }
    return ranked
      .map((r, i) => ({ r, i, score: boost(r.result, r.viewCount) }))
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .slice(0, MAX_RESULTS)
      .map((x) => x.r.result);
  }
}

/** Internal shape: BridgeResult + viewCount for ranking only. */
interface RankedEntry {
  result: BridgeResult;
  viewCount: number | null;
}

function usable(e: FlatEntry): boolean {
  if (!e.id || !e.title) return false;
  if (e.live_status && DROP_LIVE.has(e.live_status)) return false;
  return typeof e.duration === 'number' && e.duration > 0;
}

function toRanked(e: FlatEntry): RankedEntry {
  return {
    result: {
      itemId: e.id!,
      sourceTitle: e.title!,
      channel: e.channel ?? e.uploader ?? '',
      durationSec: Math.round(e.duration!),
      pageUrl: e.url ?? `https://www.youtube.com/watch?v=${e.id!}`,
    },
    viewCount: e.view_count ?? null,
  };
}

/** Every normalized word of the requested title appears in the upload title. */
function titleWordsMatch(requested: string, sourceTitle: string): boolean {
  const wanted = normalizeShowTitle(requested).split(' ').filter(Boolean);
  if (wanted.length === 0) return true;
  const have = new Set(normalizeShowTitle(sourceTitle).split(' '));
  return wanted.every((w) => have.has(w));
}

/** +2 for an episode marker matching the requested S/E, +1 for "full episode". */
function tvBoost(season: number, episode: number): (v: BridgeResult, viewCount: number | null) => number {
  const markers = [
    new RegExp(`s0*${season}\\s*e0*${episode}(?!\\d)`, 'i'),
    new RegExp(`(?<!\\d)0*${season}x0*${episode}(?!\\d)`, 'i'),
  ];
  const seasonWord = new RegExp(`season\\s*0*${season}(?!\\d)`, 'i');
  const episodeWord = new RegExp(`episode\\s*0*${episode}(?!\\d)`, 'i');
  return (v, _viewCount) => {
    let score = 0;
    const t = v.sourceTitle;
    if (markers.some((m) => m.test(t)) || (seasonWord.test(t) && episodeWord.test(t))) score += 2;
    if (/full episode|complete/i.test(t)) score += 1;
    return score;
  };
}

/** +1 for "full movie". */
function movieBoost(): (v: BridgeResult, viewCount: number | null) => number {
  return (v, _viewCount) => (/full movie|complete/i.test(v.sourceTitle) ? 1 : 0);
}
