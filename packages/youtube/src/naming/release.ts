import { normalizeShowTitle } from '@bridgarr/core';

/**
 * Release naming for YouTube uploads. The requested show/season/episode (or
 * movie title/year) is stamped so Sonarr/Radarr always map the result back to
 * what was searched; the sanitized upload title + duration are embedded so a
 * human can judge the result in Interactive Search. The channel rides as the
 * release group, e.g.
 * `Show.Name.S01E02.YT.The.Upload.Title.52min.480p.WEB-DL-SomeChannel`.
 */

/** Cap for the sanitized upload-title segment. */
const MAX_SEGMENT = 60;
/** Cap for the whole release name (it becomes a filename). */
const MAX_NAME = 140;

// Resolution/source/codec tokens inside upload titles would lie to the *arr
// parser about what we deliver ("...1080p WEBRip x264 AAC YTS MX" is a real
// recorded example) — strip them all; we stamp our own quality token.
const QUALITY_LIES =
  /\b(?:2160p|1440p|1080p|720p|480p|360p|4k|uhd|full\s*hd|hd|hq|webrip|web-?dl|bluray|blu-?ray|brrip|dvdrip|hdtv|x26[45]|h\.?26[45]|hevc|aac|ac3|yts(?:\s*mx)?)\b/gi;

// Episode markers in the upload title would hijack the parser away from the
// stamped SxxEyy (uploads like "... S5E5 Portia" come back for S01E02
// queries). "Part N" is deliberately kept — informative, not parsed as
// numbering.
const EPISODE_MARKERS = [
  /\bS\d{1,2}\s*E\d{1,3}\b/gi,
  /\b\d{1,2}x\d{1,3}\b/gi,
  /\bseason\s*\d{1,2}\b/gi,
  /\bepisode\s*\d{1,3}\b/gi,
  /\bep\.?\s*\d{1,3}\b/gi,
];

export interface SanitizeOpts {
  /** Strip this title when the upload title leads with it (avoids Show.Name.SxxEyy.YT.Show.Name...). */
  showTitle?: string;
  /** Movie mode: a second year in the name breaks Radarr's year parse. */
  stripYears?: boolean;
}

export function sanitizeUploadTitle(uploadTitle: string, opts: SanitizeOpts = {}): string {
  let text = uploadTitle;
  if (opts.showTitle) text = stripShowPrefix(text, opts.showTitle);
  for (const marker of EPISODE_MARKERS) text = text.replace(marker, ' ');
  text = text.replace(QUALITY_LIES, ' ');
  if (opts.stripYears) text = text.replace(/\b(?:19|20)\d{2}\b/g, ' ');

  let out = dotify(text);
  // A date-shaped Y.M.D sequence would trigger the daily-episode parser.
  out = collapse(out.replace(/(?:19|20)\d{2}\.\d{1,2}\.\d{1,2}/g, '.'));
  if (out.length > MAX_SEGMENT) out = truncateOnDot(out, MAX_SEGMENT);
  return out;
}

/** Channel as release group: everything after the final dash, so no dots/dashes. */
export function sanitizeChannel(channel: string): string {
  return channel
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .slice(0, 20);
}

export interface TvNameParts {
  /** The series title as Sonarr searched it (may carry a disambiguation year). */
  showTitle: string;
  /** Year-stripped variant used only for prefix-stripping the upload title. */
  searchTitle?: string;
  season: number;
  episode: number;
  uploadTitle: string;
  channel: string;
  durationSec: number;
  /** Quality token, e.g. `480p`. */
  quality: string;
}

export function tvReleaseName(p: TvNameParts): string {
  const ss = String(p.season).padStart(2, '0');
  const ee = String(p.episode).padStart(2, '0');
  const upload = sanitizeUploadTitle(p.uploadTitle, {
    showTitle: p.searchTitle ?? p.showTitle,
  });
  return assemble(
    [dotify(p.showTitle), `S${ss}E${ee}`, 'YT'],
    upload,
    [`${Math.round(p.durationSec / 60)}min`, p.quality, 'WEB-DL'],
    p.channel,
  );
}

export interface MovieNameParts {
  title: string;
  /** Radarr struggles with year-less names — include whenever known. */
  year?: number | null;
  uploadTitle: string;
  channel: string;
  durationSec: number;
  quality: string;
}

export function movieReleaseName(p: MovieNameParts): string {
  const head = [dotify(p.title)];
  if (p.year) head.push(String(p.year));
  head.push('YT');
  const upload = sanitizeUploadTitle(p.uploadTitle, { showTitle: p.title, stripYears: true });
  return assemble(
    head,
    upload,
    [`${Math.round(p.durationSec / 60)}min`, p.quality, 'WEB-DL'],
    p.channel,
  );
}

/** Join segments, fitting the upload segment into the overall name budget. */
function assemble(head: string[], upload: string, tail: string[], channel: string): string {
  const group = sanitizeChannel(channel);
  const suffix = group ? `-${group}` : '';
  const fixed = [...head, ...tail].join('.').length + suffix.length;
  let middle = upload;
  const budget = MAX_NAME - fixed - 1;
  if (middle.length > budget) middle = budget > 0 ? truncateOnDot(middle, budget) : '';
  const segments = middle ? [...head, middle, ...tail] : [...head, ...tail];
  return segments.join('.') + suffix;
}

/** Sanitize a name fragment into dot-separated scene style, preserving case. */
export function dotify(text: string): string {
  return collapse(
    text
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/['’]/g, '')
      .replace(/&/g, ' and ')
      .replace(/[^a-zA-Z0-9.]+/g, '.'),
  );
}

function collapse(text: string): string {
  return text.replace(/\.{2,}/g, '.').replace(/^\.+|\.+$/g, '');
}

function truncateOnDot(text: string, max: number): string {
  const cut = text.slice(0, max + 1);
  const lastDot = cut.lastIndexOf('.');
  return collapse(lastDot > 0 ? cut.slice(0, lastDot) : text.slice(0, max));
}

function stripShowPrefix(text: string, showTitle: string): string {
  const words = normalizeShowTitle(showTitle).split(' ').filter(Boolean);
  if (words.length === 0) return text;
  const pattern = new RegExp(
    `^[^a-z0-9]*${words.map(escapeRe).join('[^a-z0-9]+')}[\\s\\-–—:|.]*`,
    'i',
  );
  return text.replace(pattern, '');
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
