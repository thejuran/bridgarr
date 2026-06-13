import type { Request, Response } from 'express';
import type { Config } from '../config.js';
import { logger } from '../logger.js';
import { extractSearchYear, stripSearchYear } from '@bridgarr/core';
import { movieReleaseName, tvReleaseName } from '../naming/release.js';
import { encodeToken } from '@bridgarr/core';
import type { VideoSource, YtVideo } from '../youtube/types.js';
import { capsXml, errorXml, searchRss, type ReleaseItem } from './xml.js';

export interface AppContext {
  config: Config;
  source: VideoSource | null;
}

// ~2 Mbps proxy rate: flat search has no size, so Size ≈ 15 MB/min and the
// Size column doubles as a duration gauge in Interactive Search.
const BYTES_PER_SEC = 250000;

export async function handleNewznab(ctx: AppContext, req: Request, res: Response): Promise<void> {
  res.type('application/xml');

  if (param(req, 'apikey') !== ctx.config.settings.apiKey) {
    res.send(errorXml(100, 'Incorrect user credentials'));
    return;
  }

  switch (param(req, 't')) {
    case 'caps':
      res.send(capsXml({ title: 'YTforTV' }));
      return;
    case 'tvsearch':
      res.send(await tvSearch(ctx, req));
      return;
    case 'movie':
      res.send(await movieSearch(ctx, req));
      return;
    // Generic search: Radarr text-searches send t=search (NOT t=movie) with
    // cat=2000,...; route movie-category (or uncategorized) requests to the
    // movie path. TV needs numbering to stamp, so it only works via tvsearch.
    case 'search': {
      const cats = (param(req, 'cat') ?? '')
        .split(',')
        .map(Number)
        .filter((n) => Number.isInteger(n) && n > 0);
      if (cats.length === 0 || cats.some((c) => c >= 2000 && c < 3000)) {
        res.send(await movieSearch(ctx, req));
        return;
      }
      res.send(emptyOrSynthetic(ctx, req, 'tv'));
      return;
    }
    default:
      res.send(errorXml(202, 'No such function'));
  }
}

async function tvSearch(ctx: AppContext, req: Request): Promise<string> {
  const q = param(req, 'q')?.trim() ?? '';
  if (!q) return emptyOrSynthetic(ctx, req, 'tv');

  const season = toInt(param(req, 'season'));
  const episode = toInt(param(req, 'ep'));
  // No numbering to stamp: season packs and daily (YYYY + MM/DD) searches are
  // out of scope for the MVP — Interactive Search on an episode sends both.
  if (season === null || episode === null) return searchRss([]);

  const searchTitle = stripSearchYear(q);
  const videos = await search(ctx, (s) => s.searchTv(searchTitle, season, episode));
  const { releaseQuality } = ctx.config.settings;
  const base = baseUrl(req);
  return searchRss(
    videos.map((v) => {
      const title = tvReleaseName({
        showTitle: q,
        searchTitle,
        season,
        episode,
        uploadTitle: v.uploadTitle,
        channel: v.channel,
        durationSec: v.durationSec,
        quality: releaseQuality,
      });
      return toItem(ctx, base, v, title, { season, episode, categories: tvCats(releaseQuality) });
    }),
  );
}

async function movieSearch(ctx: AppContext, req: Request): Promise<string> {
  const q = param(req, 'q')?.trim() ?? '';
  if (!q) return emptyOrSynthetic(ctx, req, 'movie');

  const year = extractSearchYear(q);
  const title = stripSearchYear(q) || q;
  const videos = await search(ctx, (s) => s.searchMovie(title, year ?? undefined));
  const { releaseQuality } = ctx.config.settings;
  const base = baseUrl(req);
  return searchRss(
    videos.map((v) => {
      const release = movieReleaseName({
        title,
        year,
        uploadTitle: v.uploadTitle,
        channel: v.channel,
        durationSec: v.durationSec,
        quality: releaseQuality,
      });
      return toItem(ctx, base, v, release, {
        season: null,
        episode: null,
        categories: movieCats(releaseQuality),
      });
    }),
  );
}

async function search(
  ctx: AppContext,
  run: (source: VideoSource) => Promise<YtVideo[]>,
): Promise<YtVideo[]> {
  if (!ctx.source) return [];
  try {
    return await run(ctx.source);
  } catch (err) {
    logger.warn({ err }, 'youtube search failed');
    return [];
  }
}

function toItem(
  ctx: AppContext,
  base: string,
  v: YtVideo,
  title: string,
  rest: Pick<ReleaseItem, 'season' | 'episode' | 'categories'>,
): ReleaseItem {
  const token = encodeToken({
    provider: 'youtube',
    episodeId: v.videoId,
    title,
    pageUrl: v.pageUrl,
  });
  return {
    title,
    nzbUrl: `${base}/nzb/${token}`,
    // Interactive Search's info link → the watch page, so the upload can be
    // previewed in a browser before grabbing.
    commentsUrl: v.pageUrl,
    sizeBytes: v.durationSec * BYTES_PER_SEC,
    // Flat search carries no upload date; Sonarr rejects items without one.
    pubDate: new Date(),
    ...rest,
  };
}

/**
 * Sonarr/Radarr run a parameterless test search when the indexer is saved and
 * can treat zero results as a failure. Return one synthetic, well-formed
 * release that maps to no real series/movie, so the test passes but nothing
 * can ever grab it.
 */
function emptyOrSynthetic(ctx: AppContext, req: Request, kind: 'tv' | 'movie'): string {
  const { releaseQuality } = ctx.config.settings;
  const tv = kind === 'tv';
  const title = tv
    ? `YTforTV.Indexer.Test.S01E01.Connection.OK.${releaseQuality}.WEB-DL`
    : `YTforTV.Indexer.Test.1970.Connection.OK.${releaseQuality}.WEB-DL`;
  const token = encodeToken({
    provider: 'youtube',
    episodeId: 'connection-test',
    title,
    pageUrl: 'https://www.youtube.com/',
  });
  return searchRss([
    {
      title,
      nzbUrl: `${baseUrl(req)}/nzb/${token}`,
      sizeBytes: 1800 * BYTES_PER_SEC,
      pubDate: new Date(),
      season: tv ? 1 : null,
      episode: tv ? 1 : null,
      categories: tv ? tvCats(releaseQuality) : movieCats(releaseQuality),
    },
  ]);
}

function isHd(quality: string): boolean {
  return /^(?:720|1080|1440|2160)p$/.test(quality);
}

function tvCats(quality: string): number[] {
  return [5000, isHd(quality) ? 5040 : 5030];
}

function movieCats(quality: string): number[] {
  return [2000, isHd(quality) ? 2040 : 2030];
}

function toInt(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  if (!/^\d+$/.test(value)) return null;
  return Number(value);
}

function param(req: Request, name: string): string | undefined {
  const value = req.query[name];
  return typeof value === 'string' ? value : undefined;
}

function baseUrl(req: Request): string {
  return `${req.protocol}://${req.get('host')}`;
}
