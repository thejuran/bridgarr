/**
 * Fake Radarr v3 API served over an injected fetch. "Fracture" mirrors the
 * real ambiguity the add flow must surface: same title, different years.
 */

export const FRACTURE_2007 = {
  title: 'Fracture',
  year: 2007,
  tmdbId: 9821,
  titleSlug: 'fracture-9821',
  studio: 'New Line Cinema',
  overview: 'A young attorney faces off against a man who shot his wife.',
};

export const FRACTURE_2010 = {
  title: 'Fracture',
  year: 2010,
  tmdbId: 55555,
  titleSlug: 'fracture-55555',
  studio: 'Indie Films',
  overview: 'An unrelated indie drama that happens to share the title.',
};

export interface FakeRadarrOptions {
  /** Expected X-Api-Key; requests with any other key get a 401. */
  apiKey?: string;
  /** Respond to POST /movie with this instead of 201. */
  addFailure?: { status: number; body: unknown };
}

export interface FakeRadarr {
  fetch: typeof fetch;
  /** JSON bodies of POST /api/v3/movie calls, in order. */
  addCalls: Record<string, unknown>[];
}

export function fakeRadarr(options: FakeRadarrOptions = {}): FakeRadarr {
  const apiKey = options.apiKey ?? 'radarr-key';
  const addCalls: Record<string, unknown>[] = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    if (headers.get('x-api-key') !== apiKey) return json(401, { error: 'Unauthorized' });

    if (url.pathname === '/api/v3/movie/lookup') {
      return json(200, lookupResults(url.searchParams.get('term') ?? ''));
    }
    if (url.pathname === '/api/v3/qualityprofile') {
      return json(200, [
        { id: 1, name: 'HD-1080p' },
        { id: 6, name: 'Any' },
      ]);
    }
    if (url.pathname === '/api/v3/rootfolder') {
      return json(200, [{ id: 1, path: '/data/media/movies' }]);
    }
    if (url.pathname === '/api/v3/movie' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      addCalls.push(body);
      if (options.addFailure) return json(options.addFailure.status, options.addFailure.body);
      return json(201, { ...body, id: 7 });
    }
    return json(404, { error: 'not found' });
  };

  return { fetch: fetchImpl, addCalls };
}

function lookupResults(term: string): unknown[] {
  if (term === 'tmdb:9821') return [FRACTURE_2007];
  if (term === 'tmdb:55555') return [FRACTURE_2010];
  if (term.toLowerCase().includes('fracture')) return [FRACTURE_2007, FRACTURE_2010];
  return [];
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
