import type { Config } from '../config.js';
import { logger } from '../logger.js';
import { normalizeShowTitle } from '@bridgarr/core';
import { buildMovieQueries, buildTvQueries } from './queries.js';
import { searchYouTube, type FlatEntry } from './search.js';
import type { VideoSource, YtVideo } from './types.js';

/** Injectable search backend — tests feed fixture entries per query. */
export type SearchFn = (query: string, n: number) => Promise<FlatEntry[]>;

const TV_RESULTS_PER_QUERY = 20;
const MOVIE_RESULTS_PER_QUERY = 25;
const MAX_RESULTS = 50;
const DROP_LIVE = new Set(['is_live', 'is_upcoming', 'post_live']);

/**
 * YouTube-backed VideoSource: fans a request out over several query
 * phrasings, merges by video id, then filters the noise YouTube search
 * returns (other shows, clips, trailers, livestreams) and ranks what's left.
 */
export class YouTubeSource implements VideoSource {
  private readonly config: Config;
  private readonly searchFn: SearchFn | undefined;

  constructor(config: Config, searchFn?: SearchFn) {
    this.config = config;
    this.searchFn = searchFn;
  }

  async searchTv(title: string, season?: number, episode?: number): Promise<YtVideo[]> {
    // No episode → nothing to stamp a release name with (season packs are a
    // later milestone); the Newznab layer handles the empty-q connection test.
    if (season === undefined || episode === undefined) return [];
    const entries = await this.fanOut(buildTvQueries(title, season, episode), TV_RESULTS_PER_QUERY);
    return this.pipeline(entries, title, this.config.settings.minTvMinutes, tvBoost(season, episode));
  }

  async searchMovie(title: string, year?: number): Promise<YtVideo[]> {
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
    boost: (v: YtVideo) => number,
  ): YtVideo[] {
    const floor = minMinutes * 60;
    let videos = entries.filter(usable).map(toVideo);
    videos = videos.filter((v) => v.durationSec >= floor);
    if (this.config.settings.titleFilter) {
      videos = videos.filter((v) => titleWordsMatch(title, v.uploadTitle));
    }
    return videos
      .map((v, i) => ({ v, i, score: boost(v) }))
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .slice(0, MAX_RESULTS)
      .map((x) => x.v);
  }
}

function usable(e: FlatEntry): boolean {
  if (!e.id || !e.title) return false;
  if (e.live_status && DROP_LIVE.has(e.live_status)) return false;
  return typeof e.duration === 'number' && e.duration > 0;
}

function toVideo(e: FlatEntry): YtVideo {
  return {
    videoId: e.id!,
    uploadTitle: e.title!,
    channel: e.channel ?? e.uploader ?? '',
    durationSec: Math.round(e.duration!),
    viewCount: e.view_count ?? null,
    pageUrl: e.url ?? `https://www.youtube.com/watch?v=${e.id!}`,
  };
}

/** Every normalized word of the requested title appears in the upload title. */
function titleWordsMatch(requested: string, uploadTitle: string): boolean {
  const wanted = normalizeShowTitle(requested).split(' ').filter(Boolean);
  if (wanted.length === 0) return true;
  const have = new Set(normalizeShowTitle(uploadTitle).split(' '));
  return wanted.every((w) => have.has(w));
}

/** +2 for an episode marker matching the requested S/E, +1 for "full episode". */
function tvBoost(season: number, episode: number): (v: YtVideo) => number {
  const markers = [
    new RegExp(`s0*${season}\\s*e0*${episode}(?!\\d)`, 'i'),
    new RegExp(`(?<!\\d)0*${season}x0*${episode}(?!\\d)`, 'i'),
  ];
  const seasonWord = new RegExp(`season\\s*0*${season}(?!\\d)`, 'i');
  const episodeWord = new RegExp(`episode\\s*0*${episode}(?!\\d)`, 'i');
  return (v) => {
    let score = 0;
    const t = v.uploadTitle;
    if (markers.some((m) => m.test(t)) || (seasonWord.test(t) && episodeWord.test(t))) score += 2;
    if (/full episode|complete/i.test(t)) score += 1;
    return score;
  };
}

/** +1 for "full movie". */
function movieBoost(): (v: YtVideo) => number {
  return (v) => (/full movie|complete/i.test(v.uploadTitle) ? 1 : 0);
}
