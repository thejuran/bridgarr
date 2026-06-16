import type { Request, Response } from 'express';
import type { Config } from '../config.js';
import { logger } from '../logger.js';
import { extractSearchYear, stripSearchYear } from '@bridgarr/core';
import { RadarrClient, type RadarrMovie } from '../radarr/client.js';
import {
  SonarrClient,
  type QualityProfile,
  type RootFolder,
  type SonarrSeries,
} from '../sonarr/client.js';
import { searchYouTube, type FlatEntry } from '../youtube/search.js';
import { escapeHtml } from './html.js';

/**
 * Scouting UI: raw flat YouTube search (no clip/title filtering — the point
 * is to see what exists) plus the add-to-Sonarr/Radarr flows so a found show
 * can be put in the library, after which grabbing happens via Interactive
 * Search.
 */

export type BrowseSearchFn = (query: string, n: number) => Promise<FlatEntry[]>;

export interface BrowseContext {
  config: Config;
  /** YouTube search; injectable for tests. */
  searchFn?: BrowseSearchFn;
  /** Fetches used for Sonarr/Radarr API calls; injectable for tests. */
  sonarrFetch?: typeof fetch;
  radarrFetch?: typeof fetch;
}

const BROWSE_RESULTS = 25;

const MONITOR_OPTIONS = [
  { value: 'all', label: 'All episodes' },
  { value: 'future', label: 'Future episodes only' },
  { value: 'none', label: 'None' },
];

export async function handleBrowsePage(
  ctx: BrowseContext,
  req: Request,
  res: Response,
): Promise<void> {
  const q = queryParam(req, 'q')?.trim() ?? '';
  let entries: FlatEntry[] | null = null;
  if (q) {
    const run =
      ctx.searchFn ??
      ((query: string, n: number) =>
        searchYouTube(query, n, { cookiesFile: ctx.config.settings.cookiesFile }));
    try {
      entries = await run(q, BROWSE_RESULTS);
    } catch (err) {
      logger.warn({ q, err }, 'browse search failed');
      entries = [];
    }
  }
  res.type('html').send(renderBrowsePage(q, entries, flashOf(req)));
}

export async function handleAddPage(
  ctx: BrowseContext,
  req: Request,
  res: Response,
): Promise<void> {
  const title = queryParam(req, 'title')?.trim();
  if (!title) {
    res
      .status(400)
      .type('html')
      .send(page('Add to Sonarr', '<p class="error">Missing show title.</p>'));
    return;
  }
  const client = sonarrClient(ctx);
  if (!client) {
    res.type('html').send(page('Add to Sonarr', notConfiguredHtml('Sonarr')));
    return;
  }

  try {
    const [candidates, profiles, rootFolders] = await Promise.all([
      client.lookup(title),
      client.qualityProfiles(),
      client.rootFolders(),
    ]);
    res.type('html').send(renderAddPage(title, candidates, profiles, rootFolders));
  } catch (err) {
    logger.warn({ title, err }, 'sonarr lookup failed');
    res
      .status(502)
      .type('html')
      .send(page('Add to Sonarr', `<p class="error">${escapeHtml(friendlyArrError(err, 'Sonarr'))}</p>`));
  }
}

export async function handleAddSubmit(
  ctx: BrowseContext,
  req: Request,
  res: Response,
): Promise<void> {
  const client = sonarrClient(ctx);
  if (!client) {
    res.status(400).type('html').send(page('Add to Sonarr', notConfiguredHtml('Sonarr')));
    return;
  }

  const body = req.body as Record<string, unknown>;
  const field = (name: string): string | undefined => {
    const v = body[name];
    return typeof v === 'string' ? v.trim() : undefined;
  };

  const tvdbId = Number(field('tvdbId'));
  const qualityProfileId = Number(field('qualityProfileId'));
  const rootFolderPath = field('rootFolderPath');
  const monitor = field('monitor') ?? 'all';
  const valid =
    Number.isInteger(tvdbId) &&
    tvdbId > 0 &&
    Number.isInteger(qualityProfileId) &&
    qualityProfileId > 0 &&
    !!rootFolderPath &&
    MONITOR_OPTIONS.some((o) => o.value === monitor);
  if (!valid) {
    res
      .status(400)
      .type('html')
      .send(page('Add to Sonarr', '<p class="error">Invalid add request.</p>'));
    return;
  }

  try {
    const series = await client.lookupByTvdbId(tvdbId);
    if (!series) {
      res
        .status(404)
        .type('html')
        .send(page('Add to Sonarr', '<p class="error">Series not found on TheTVDB.</p>'));
      return;
    }
    await client.addSeries(series, {
      qualityProfileId,
      rootFolderPath,
      monitor,
      searchForMissingEpisodes: field('searchForMissing') !== undefined,
    });
    res.redirect(303, `/browse?added=${encodeURIComponent(series.title ?? String(tvdbId))}&to=Sonarr`);
  } catch (err) {
    logger.warn({ tvdbId, err }, 'add to sonarr failed');
    res.redirect(303, `/browse?error=${encodeURIComponent(friendlyArrError(err, 'Sonarr'))}`);
  }
}

export async function handleAddMoviePage(
  ctx: BrowseContext,
  req: Request,
  res: Response,
): Promise<void> {
  const title = queryParam(req, 'title')?.trim();
  if (!title) {
    res
      .status(400)
      .type('html')
      .send(page('Add to Radarr', '<p class="error">Missing movie title.</p>'));
    return;
  }
  const client = radarrClient(ctx);
  if (!client) {
    res.type('html').send(page('Add to Radarr', notConfiguredHtml('Radarr')));
    return;
  }

  const yearRaw = Number(queryParam(req, 'year'));
  const knownYear = Number.isInteger(yearRaw) && yearRaw > 1900 ? yearRaw : null;

  try {
    const [candidates, profiles, rootFolders] = await Promise.all([
      client.lookup(title),
      client.qualityProfiles(),
      client.rootFolders(),
    ]);
    res.type('html').send(renderAddMoviePage(title, knownYear, candidates, profiles, rootFolders));
  } catch (err) {
    logger.warn({ title, err }, 'radarr lookup failed');
    res
      .status(502)
      .type('html')
      .send(
        page('Add to Radarr', `<p class="error">${escapeHtml(friendlyArrError(err, 'Radarr'))}</p>`),
      );
  }
}

export async function handleAddMovieSubmit(
  ctx: BrowseContext,
  req: Request,
  res: Response,
): Promise<void> {
  const client = radarrClient(ctx);
  if (!client) {
    res.status(400).type('html').send(page('Add to Radarr', notConfiguredHtml('Radarr')));
    return;
  }

  const body = req.body as Record<string, unknown>;
  const field = (name: string): string | undefined => {
    const v = body[name];
    return typeof v === 'string' ? v.trim() : undefined;
  };

  const tmdbId = Number(field('tmdbId'));
  const qualityProfileId = Number(field('qualityProfileId'));
  const rootFolderPath = field('rootFolderPath');
  const valid =
    Number.isInteger(tmdbId) &&
    tmdbId > 0 &&
    Number.isInteger(qualityProfileId) &&
    qualityProfileId > 0 &&
    !!rootFolderPath;
  if (!valid) {
    res
      .status(400)
      .type('html')
      .send(page('Add to Radarr', '<p class="error">Invalid add request.</p>'));
    return;
  }

  try {
    const movie = await client.lookupByTmdbId(tmdbId);
    if (!movie) {
      res
        .status(404)
        .type('html')
        .send(page('Add to Radarr', '<p class="error">Movie not found on TMDB.</p>'));
      return;
    }
    await client.addMovie(movie, {
      qualityProfileId,
      rootFolderPath,
      searchForMovie: field('searchForMovie') !== undefined,
    });
    res.redirect(303, `/browse?added=${encodeURIComponent(movie.title ?? String(tmdbId))}&to=Radarr`);
  } catch (err) {
    logger.warn({ tmdbId, err }, 'add to radarr failed');
    res.redirect(303, `/browse?error=${encodeURIComponent(friendlyArrError(err, 'Radarr'))}`);
  }
}

function sonarrClient(ctx: BrowseContext): SonarrClient | null {
  const { sonarrUrl, sonarrApiKey } = ctx.config.settings;
  if (!sonarrUrl || !sonarrApiKey) return null;
  return new SonarrClient(sonarrUrl, sonarrApiKey, { fetchFn: ctx.sonarrFetch });
}

function radarrClient(ctx: BrowseContext): RadarrClient | null {
  const { radarrUrl, radarrApiKey } = ctx.config.settings;
  if (!radarrUrl || !radarrApiKey) return null;
  return new RadarrClient(radarrUrl, radarrApiKey, { fetchFn: ctx.radarrFetch });
}

/** *arr API errors carry operator-useful messages; raw fetch failures don't. */
function friendlyArrError(err: unknown, service: 'Sonarr' | 'Radarr'): string {
  if (err instanceof Error && err.message.startsWith(`${service} `)) return err.message;
  return `Could not reach ${service} — check the URL and API key in settings.`;
}

function queryParam(req: Request, name: string): string | undefined {
  const value = req.query[name];
  return typeof value === 'string' ? value : undefined;
}

interface Flash {
  added?: string;
  /** Destination service the title was added to; allowlisted at parse time. */
  to?: string;
  error?: string;
}

function flashOf(req: Request): Flash {
  const to = queryParam(req, 'to');
  return {
    added: queryParam(req, 'added'),
    to: to === 'Sonarr' || to === 'Radarr' ? to : undefined,
    error: queryParam(req, 'error'),
  };
}

function flashHtml(flash: Flash): string {
  if (flash.added) {
    const dest = flash.to ? ` to ${flash.to}` : '';
    return `<p class="saved">Added “${escapeHtml(flash.added)}”${dest}.</p>`;
  }
  if (flash.error) return `<p class="error">${escapeHtml(flash.error)}</p>`;
  return '';
}

function renderBrowsePage(q: string, entries: FlatEntry[] | null, flash: Flash): string {
  let results = '';
  if (entries !== null) {
    const year = extractSearchYear(q);
    const movieTitle = stripSearchYear(q) || q;
    const addMovieUrl = `/browse/add-movie?title=${encodeURIComponent(movieTitle)}${
      year ? `&year=${year}` : ''
    }`;
    const actions = `<p class="actions">
  <a class="btn" href="/browse/add?title=${encodeURIComponent(q)}">Add “${escapeHtml(q)}” to Sonarr</a>
  <a class="btn" href="${escapeHtml(addMovieUrl)}">Add “${escapeHtml(movieTitle)}” to Radarr</a>
</p>`;

    if (entries.length === 0) {
      results = `${actions}<p class="empty">No YouTube results for “${escapeHtml(q)}”.</p>`;
    } else {
      const rows = entries
        .map((e) => {
          const url = e.url ?? `https://www.youtube.com/watch?v=${e.id ?? ''}`;
          const minutes =
            typeof e.duration === 'number' && e.duration > 0
              ? `${Math.round(e.duration / 60)} min`
              : '—';
          const views =
            typeof e.view_count === 'number' ? e.view_count.toLocaleString('en-US') : '—';
          return `<tr>
      <td><a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(e.title ?? '')}</a></td>
      <td>${escapeHtml(e.channel ?? e.uploader ?? '—')}</td>
      <td class="num">${minutes}</td>
      <td class="num">${views}</td>
    </tr>`;
        })
        .join('');
      results = `${actions}
<table>
  <thead><tr><th>Upload</th><th>Channel</th><th>Length</th><th>Views</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<p class="hint">Grabbing happens in Sonarr/Radarr: add the show/movie to the library, then use
Interactive Search there — results carry the upload title, length, and channel.</p>`;
    }
  }

  return page(
    'Browse',
    `${flashHtml(flash)}
<form method="get" action="/browse" class="search">
  <input name="q" value="${escapeHtml(q)}" placeholder="Search YouTube for a show or movie…" autofocus>
  <button type="submit">Search</button>
</form>
${results}`,
  );
}

function renderAddPage(
  title: string,
  candidates: SonarrSeries[],
  profiles: QualityProfile[],
  rootFolders: RootFolder[],
): string {
  const back = '<p><a href="/browse">← Back to search</a></p>';
  if (candidates.length === 0) {
    return page(
      'Add to Sonarr',
      `${back}<p class="empty">Sonarr found no TheTVDB matches for “${escapeHtml(title)}”.</p>`,
    );
  }

  const inLibrary = (c: SonarrSeries): boolean => typeof c.id === 'number' && c.id > 0;
  const firstSelectable = candidates.findIndex((c) => !inLibrary(c));
  const candidateRows = candidates
    .map((c, i) => {
      const year = c.year ? ` (${c.year})` : '';
      return `<label class="candidate">
    <input type="radio" name="tvdbId" value="${c.tvdbId}"${i === firstSelectable ? ' checked' : ''}${
      inLibrary(c) ? ' disabled' : ''
    }>
    <span>
      <strong>${escapeHtml(`${c.title ?? ''}${year}`)}</strong>
      <span class="hint">tvdb ${c.tvdbId}${c.network ? ` · ${escapeHtml(c.network)}` : ''}</span>
      ${inLibrary(c) ? '<span class="badge">already in Sonarr</span>' : ''}
      ${c.overview ? `<span class="overview">${escapeHtml(truncate(c.overview, 220))}</span>` : ''}
    </span>
  </label>`;
    })
    .join('');

  const profileOptions = profiles
    .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
    .join('');
  const folderOptions = rootFolders
    .map((f) => `<option value="${escapeHtml(f.path)}">${escapeHtml(f.path)}</option>`)
    .join('');
  const monitorOptions = MONITOR_OPTIONS.map(
    (o) => `<option value="${o.value}">${o.label}</option>`,
  ).join('');

  return page(
    'Add to Sonarr',
    `${back}
<h2>Add “${escapeHtml(title)}” to Sonarr</h2>
<p class="hint">Pick the right TheTVDB series — similarly named shows can differ wildly.</p>
<form method="post" action="/browse/add" class="add">
  <fieldset>${candidateRows}</fieldset>
  <label class="opt">Quality profile
    <select name="qualityProfileId">${profileOptions}</select>
  </label>
  <label class="opt">Root folder
    <select name="rootFolderPath">${folderOptions}</select>
  </label>
  <label class="opt">Monitor
    <select name="monitor">${monitorOptions}</select>
  </label>
  <label class="opt check">
    <input type="checkbox" name="searchForMissing" checked>
    Search for missing episodes after adding
  </label>
  <button type="submit">Add to Sonarr</button>
</form>`,
  );
}

function renderAddMoviePage(
  title: string,
  knownYear: number | null,
  candidates: RadarrMovie[],
  profiles: QualityProfile[],
  rootFolders: RootFolder[],
): string {
  const back = '<p><a href="/browse">← Back to search</a></p>';
  if (candidates.length === 0) {
    return page(
      'Add to Radarr',
      `${back}<p class="empty">Radarr found no TMDB matches for “${escapeHtml(title)}”.</p>`,
    );
  }

  const inLibrary = (m: RadarrMovie): boolean => typeof m.id === 'number' && m.id > 0;
  // Preselect the candidate matching the searched year when one was given.
  const yearMatch = knownYear
    ? candidates.findIndex((m) => m.year === knownYear && !inLibrary(m))
    : -1;
  const firstSelectable =
    yearMatch >= 0 ? yearMatch : candidates.findIndex((m) => !inLibrary(m));
  const candidateRows = candidates
    .map((m, i) => {
      const year = m.year ? ` (${m.year})` : '';
      return `<label class="candidate">
    <input type="radio" name="tmdbId" value="${m.tmdbId}"${i === firstSelectable ? ' checked' : ''}${
      inLibrary(m) ? ' disabled' : ''
    }>
    <span>
      <strong>${escapeHtml(`${m.title ?? ''}${year}`)}</strong>
      <span class="hint">tmdb ${m.tmdbId}${m.studio ? ` · ${escapeHtml(m.studio)}` : ''}</span>
      ${inLibrary(m) ? '<span class="badge">already in Radarr</span>' : ''}
      ${m.overview ? `<span class="overview">${escapeHtml(truncate(m.overview, 220))}</span>` : ''}
    </span>
  </label>`;
    })
    .join('');

  const profileOptions = profiles
    .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
    .join('');
  const folderOptions = rootFolders
    .map((f) => `<option value="${escapeHtml(f.path)}">${escapeHtml(f.path)}</option>`)
    .join('');

  return page(
    'Add to Radarr',
    `${back}
<h2>Add “${escapeHtml(title)}” to Radarr</h2>
<p class="hint">Pick the right TMDB movie — check the year carefully.</p>
<form method="post" action="/browse/add-movie" class="add">
  <fieldset>${candidateRows}</fieldset>
  <label class="opt">Quality profile
    <select name="qualityProfileId">${profileOptions}</select>
  </label>
  <label class="opt">Root folder
    <select name="rootFolderPath">${folderOptions}</select>
  </label>
  <label class="opt check">
    <input type="checkbox" name="searchForMovie" checked>
    Search for the movie after adding
  </label>
  <button type="submit">Add to Radarr</button>
</form>`,
  );
}

function notConfiguredHtml(service: 'Sonarr' | 'Radarr'): string {
  return `<p class="error">${service} is not configured — set the ${service} URL and API key in
<a href="/">settings</a> first.</p>`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — bridgarr-youtube</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 860px; margin: 2rem auto; padding: 0 1rem; color: #222; }
  h2 { font-size: 1.2rem; }
  nav { margin-bottom: 1.5rem; } nav a { margin-right: 1rem; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
  th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid #e3e3e3; }
  th { font-size: .85rem; text-transform: uppercase; color: #666; }
  td.num { white-space: nowrap; font-variant-numeric: tabular-nums; }
  input, select { padding: .45rem; font: inherit; box-sizing: border-box; }
  button { padding: .4rem 1rem; font: inherit; cursor: pointer; }
  .btn { padding: .15rem .6rem; font-size: .85rem; text-decoration: none; border: 1px solid #bbb; border-radius: 4px; color: #222; white-space: nowrap; }
  .search { display: flex; gap: .5rem; } .search input { flex: 1; }
  .actions { margin-top: 1rem; display: flex; gap: .5rem; }
  .saved { background: #e6f4ea; border: 1px solid #b7dfc2; padding: .5rem .75rem; border-radius: 4px; }
  .error { background: #fdecea; border: 1px solid #f5c2c0; padding: .5rem .75rem; border-radius: 4px; }
  .empty { color: #666; margin-top: 1.5rem; }
  .hint { color: #666; font-size: .85rem; font-weight: 400; }
  .candidate { display: flex; gap: .6rem; padding: .75rem; border: 1px solid #e3e3e3; border-radius: 6px; margin-top: .5rem; cursor: pointer; }
  .candidate > span { flex: 1; } .candidate > span > span { display: block; }
  .overview { color: #444; font-size: .9rem; margin-top: .25rem; }
  .badge { display: inline-block; background: #fff3cd; border: 1px solid #ffe69c; border-radius: 4px; padding: 0 .4rem; font-size: .8rem; }
  fieldset { border: none; padding: 0; margin: 0; }
  form.add .opt { display: block; margin-top: 1rem; font-weight: 600; }
  form.add select { display: block; margin-top: .25rem; min-width: 16rem; }
  form.add button { margin-top: 1.5rem; }
  .check { font-weight: 400; }
</style>
</head>
<body>
<nav><strong>bridgarr-youtube</strong> <a href="/browse">Browse</a> <a href="/">Settings</a></nav>
${body}
</body>
</html>`;
}
