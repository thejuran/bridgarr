/** Strip diacritics, drop apostrophes, & → and, punctuation → spaces, lowercase. */
export function normalizeShowTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * True when two titles are the same show (normalized exact match). A trailing
 * disambiguation year is ignored — Sonarr searches "Bluey (2018)" as
 * "bluey 2018" while iView lists plain "Bluey".
 */
export function titlesMatch(a: string, b: string): boolean {
  const na = normalizeShowTitle(a);
  const nb = normalizeShowTitle(b);
  return na === nb || stripTrailingYear(na) === stripTrailingYear(nb);
}

function stripTrailingYear(title: string): string {
  return title.replace(/\s+(?:19|20)\d{2}$/, '');
}

/** Drop a trailing "(2018)" / "2018" from a raw search query. */
export function stripSearchYear(query: string): string {
  return query.replace(/\s*\(?(?:19|20)\d{2}\)?\s*$/, '').trim();
}

/** The trailing "(2018)" / "2018" of a raw search query, if any. */
export function extractSearchYear(query: string): number | null {
  const match = query.match(/\(?((?:19|20)\d{2})\)?\s*$/);
  return match ? Number(match[1]) : null;
}

/**
 * Loose search predicate: the query's normalized words appear as a contiguous
 * word sequence in the title. "bluey" matches both "Bluey" and "Bluey Tunes".
 */
export function queryMatches(query: string, title: string): boolean {
  const q = normalizeShowTitle(query);
  if (q === '') return true;
  const t = normalizeShowTitle(title);
  return ` ${t} `.includes(` ${q} `);
}
