/**
 * Fake Sonarr v3 API served over an injected fetch. The dataset mirrors the
 * real ambiguity the add flow must surface: "Bluey" matches both the 2018
 * kids' show (tvdb 353546) and the 1976 cop drama (tvdb 78097).
 */

export const BLUEY_2018 = {
  title: 'Bluey',
  year: 2018,
  tvdbId: 353546,
  titleSlug: 'bluey-2018',
  network: 'ABC (AU)',
  overview: 'Bluey is an inexhaustible six year-old Blue Heeler dog.',
  seasons: [{ seasonNumber: 1, monitored: true }],
};

export const BLUEY_1976 = {
  title: 'Bluey',
  year: 1976,
  tvdbId: 78097,
  titleSlug: 'bluey',
  network: 'Seven Network',
  overview: 'Bluey is a tough, fat detective.',
  seasons: [{ seasonNumber: 1, monitored: true }],
};

export interface FakeSonarrOptions {
  /** Expected X-Api-Key; requests with any other key get a 401. */
  apiKey?: string;
  /** Respond to POST /series with this instead of 201. */
  addFailure?: { status: number; body: unknown };
}

export interface FakeSonarr {
  fetch: typeof fetch;
  /** JSON bodies of POST /api/v3/series calls, in order. */
  addCalls: Record<string, unknown>[];
}

export function fakeSonarr(options: FakeSonarrOptions = {}): FakeSonarr {
  const apiKey = options.apiKey ?? 'sonarr-key';
  const addCalls: Record<string, unknown>[] = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    if (headers.get('x-api-key') !== apiKey) return json(401, { error: 'Unauthorized' });

    if (url.pathname === '/api/v3/series/lookup') {
      return json(200, lookupResults(url.searchParams.get('term') ?? ''));
    }
    if (url.pathname === '/api/v3/qualityprofile') {
      return json(200, [
        { id: 4, name: 'HD-1080p' },
        { id: 7, name: '1080p Balanced' },
      ]);
    }
    if (url.pathname === '/api/v3/rootfolder') {
      return json(200, [{ id: 1, path: '/data/media/tv' }]);
    }
    if (url.pathname === '/api/v3/series' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      addCalls.push(body);
      if (options.addFailure) return json(options.addFailure.status, options.addFailure.body);
      return json(201, { ...body, id: 42 });
    }
    return json(404, { error: 'not found' });
  };

  return { fetch: fetchImpl, addCalls };
}

function lookupResults(term: string): unknown[] {
  if (term === 'tvdb:353546') return [BLUEY_2018];
  if (term === 'tvdb:78097') return [BLUEY_1976];
  if (term.toLowerCase().includes('bluey')) return [BLUEY_2018, BLUEY_1976];
  return [];
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
