import type { Request, Response } from 'express';
import { updateSettings, type Config, type Settings } from '../config.js';
import { escapeHtml } from './html.js';

const QUALITIES: Settings['quality'][] = ['1080p', '720p', 'best'];
const RELEASE_QUALITIES = ['480p', '576p', '720p', '1080p'];

export function renderSettingsPage(config: Config, saved = false): string {
  const s = config.settings;
  const qualityOptions = QUALITIES.map(
    (q) => `<option value="${q}"${q === s.quality ? ' selected' : ''}>${q}</option>`,
  ).join('');
  const releaseQualityOptions = RELEASE_QUALITIES.map(
    (q) => `<option value="${q}"${q === s.releaseQuality ? ' selected' : ''}>${q}</option>`,
  ).join('');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>YTforTV</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; color: #222; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.1rem; margin-top: 2rem; }
  label { display: block; margin-top: 1rem; font-weight: 600; }
  input, select { width: 100%; padding: .45rem; margin-top: .25rem; box-sizing: border-box; font: inherit; }
  button { margin-top: 1.5rem; padding: .5rem 1.5rem; font: inherit; cursor: pointer; }
  .saved { background: #e6f4ea; border: 1px solid #b7dfc2; padding: .5rem .75rem; border-radius: 4px; }
  .hint { color: #666; font-size: .85rem; font-weight: 400; }
  code { background: #f4f4f4; padding: .1rem .3rem; border-radius: 3px; }
</style>
</head>
<body>
<h1>YTforTV</h1>
<p><a href="/browse">Search YouTube &amp; add shows →</a></p>
${saved ? '<p class="saved">Settings saved.</p>' : ''}
<form method="post" action="/settings">
  <label>API key <span class="hint">(used by Sonarr/Radarr for both the indexer and download client)</span>
    <input name="apiKey" value="${escapeHtml(s.apiKey)}">
  </label>
  <label>Download directory <span class="hint">(in-progress downloads)</span>
    <input name="downloadDir" value="${escapeHtml(s.downloadDir)}">
  </label>
  <label>Complete directory <span class="hint">(finished files; Sonarr imports from here)</span>
    <input name="completeDir" value="${escapeHtml(s.completeDir)}">
  </label>
  <label>Download quality <span class="hint">(yt-dlp resolution cap for the actual download)</span>
    <select name="quality">${qualityOptions}</select>
  </label>
  <label>Concurrent downloads
    <input name="concurrency" type="number" min="1" max="5" value="${s.concurrency}">
  </label>
  <h2>Search</h2>
  <label>Release quality tag <span class="hint">(stamped into release names — your Sonarr/Radarr quality profile must allow WEBDL at this resolution)</span>
    <select name="releaseQuality">${releaseQualityOptions}</select>
  </label>
  <label>Minimum TV result length (minutes) <span class="hint">(drops clips and trailers)</span>
    <input name="minTvMinutes" type="number" min="0" value="${s.minTvMinutes}">
  </label>
  <label>Minimum movie result length (minutes)
    <input name="minMovieMinutes" type="number" min="0" value="${s.minMovieMinutes}">
  </label>
  <label>Title filter <span class="hint">(require every word of the searched title in the upload title)</span>
    <select name="titleFilter">
      <option value="on"${s.titleFilter ? ' selected' : ''}>on</option>
      <option value="off"${s.titleFilter ? '' : ' selected'}>off</option>
    </select>
  </label>
  <label>Cookies file <span class="hint">(Netscape-format cookies passed to yt-dlp; escape hatch for YouTube bot checks. Blank = off)</span>
    <input name="cookiesFile" value="${escapeHtml(s.cookiesFile)}" placeholder="/config/cookies.txt">
  </label>
  <h2>Sonarr / Radarr</h2>
  <label>Sonarr URL <span class="hint">(enables “Add to Sonarr” in browse; optional)</span>
    <input name="sonarrUrl" value="${escapeHtml(s.sonarrUrl)}" placeholder="http://sonarr:8989">
  </label>
  <label>Sonarr API key <span class="hint">(optional)</span>
    <input name="sonarrApiKey" value="${escapeHtml(s.sonarrApiKey)}">
  </label>
  <label>Radarr URL <span class="hint">(enables “Add to Radarr” for movies; optional)</span>
    <input name="radarrUrl" value="${escapeHtml(s.radarrUrl)}" placeholder="http://radarr:7878">
  </label>
  <label>Radarr API key <span class="hint">(optional)</span>
    <input name="radarrApiKey" value="${escapeHtml(s.radarrApiKey)}">
  </label>
  <button type="submit">Save</button>
</form>
<h2>Hooking up Sonarr / Radarr</h2>
<p>Indexer (Newznab): URL <code>http://&lt;this-host&gt;:${config.port}</code>, API path <code>/api</code>, API key as above.
Turn <strong>off</strong> “Enable RSS” and “Enable Automatic Search” — this indexer is for Interactive Search.<br>
Download client (SABnzbd): host <code>&lt;this-host&gt;</code>, port <code>${config.port}</code>, API key as above,
category <code>sonarr</code> (Sonarr) or <code>radarr</code> (Radarr).</p>
</body>
</html>`;
}

export function handleSettingsSave(config: Config, req: Request, res: Response): void {
  const body = req.body as Record<string, unknown>;
  const str = (name: string): string | undefined => {
    const v = body[name];
    return typeof v === 'string' ? v.trim() : undefined;
  };

  const quality = str('quality');
  if (quality !== undefined && !QUALITIES.includes(quality as Settings['quality'])) {
    res.status(400).send('invalid quality');
    return;
  }
  const concurrencyRaw = str('concurrency');
  const concurrency = concurrencyRaw !== undefined ? Number(concurrencyRaw) : undefined;
  if (concurrency !== undefined && (!Number.isInteger(concurrency) || concurrency < 1)) {
    res.status(400).send('invalid concurrency');
    return;
  }

  const releaseQuality = str('releaseQuality');
  if (releaseQuality !== undefined && !RELEASE_QUALITIES.includes(releaseQuality)) {
    res.status(400).send('invalid releaseQuality');
    return;
  }
  const minutes: Partial<Record<'minTvMinutes' | 'minMovieMinutes', number>> = {};
  for (const field of ['minTvMinutes', 'minMovieMinutes'] as const) {
    const raw = str(field);
    if (raw === undefined) continue;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) {
      res.status(400).send(`invalid ${field}`);
      return;
    }
    minutes[field] = value;
  }
  const titleFilter = str('titleFilter');
  if (titleFilter !== undefined && titleFilter !== 'on' && titleFilter !== 'off') {
    res.status(400).send('invalid titleFilter');
    return;
  }

  const patch: Partial<Settings> = { ...minutes };
  if (quality !== undefined) patch.quality = quality as Settings['quality'];
  if (concurrency !== undefined) patch.concurrency = concurrency;
  if (releaseQuality !== undefined) patch.releaseQuality = releaseQuality;
  if (titleFilter !== undefined) patch.titleFilter = titleFilter === 'on';
  const apiKey = str('apiKey');
  if (apiKey) patch.apiKey = apiKey; // empty string would lock Sonarr out — ignore
  for (const field of [
    'downloadDir',
    'completeDir',
    'sonarrUrl',
    'sonarrApiKey',
    'radarrUrl',
    'radarrApiKey',
    'cookiesFile',
  ] as const) {
    const value = str(field);
    if (value !== undefined) patch[field] = value;
  }
  updateSettings(config, patch);
  res.redirect(303, '/?saved=1');
}
