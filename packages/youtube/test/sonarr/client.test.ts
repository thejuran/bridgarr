import { describe, expect, it } from 'vitest';
import { SonarrClient } from '../../src/sonarr/client.js';
import { BLUEY_2018, fakeSonarr, type FakeSonarr } from '../helpers/sonarr.js';
import { ArrHttp } from '../../src/arr/http.js';

function client(fake: FakeSonarr = fakeSonarr(), baseUrl = 'http://sonarr.test:8989'): SonarrClient {
  return new SonarrClient(baseUrl, 'sonarr-key', { fetchFn: fake.fetch });
}

describe('SonarrClient', () => {
  it('looks up series by term with the api key header', async () => {
    const results = await client().lookup('Bluey');

    expect(results).toMatchObject([
      { title: 'Bluey', year: 2018, tvdbId: 353546 },
      { title: 'Bluey', year: 1976, tvdbId: 78097 },
    ]);
  });

  it('rejects when the api key is wrong', async () => {
    const fake = fakeSonarr({ apiKey: 'something-else' });

    await expect(client(fake).lookup('Bluey')).rejects.toThrow(/Sonarr 401/);
  });

  it('tolerates a trailing slash in the base url', async () => {
    const results = await client(fakeSonarr(), 'http://sonarr.test:8989/').lookup('Bluey');

    expect(results).toHaveLength(2);
  });

  it('looks up a single series by tvdb id', async () => {
    const series = await client().lookupByTvdbId(78097);

    expect(series).toMatchObject({ tvdbId: 78097, year: 1976 });
  });

  it('fetches quality profiles and root folders', async () => {
    const c = client();

    expect(await c.qualityProfiles()).toEqual([
      { id: 4, name: 'HD-1080p' },
      { id: 7, name: '1080p Balanced' },
    ]);
    expect(await c.rootFolders()).toEqual([{ path: '/data/media/tv' }]);
  });

  it('posts the looked-up series plus add options when adding', async () => {
    const fake = fakeSonarr();

    await client(fake).addSeries(BLUEY_2018, {
      qualityProfileId: 4,
      rootFolderPath: '/data/media/tv',
      monitor: 'all',
      searchForMissingEpisodes: true,
    });

    expect(fake.addCalls).toHaveLength(1);
    expect(fake.addCalls[0]).toMatchObject({
      title: 'Bluey',
      tvdbId: 353546,
      titleSlug: 'bluey-2018',
      qualityProfileId: 4,
      rootFolderPath: '/data/media/tv',
      monitored: true,
      addOptions: { monitor: 'all', searchForMissingEpisodes: true },
    });
  });

  it('surfaces sonarr validation messages on failure', async () => {
    const fake = fakeSonarr({
      addFailure: { status: 400, body: [{ errorMessage: 'This series has already been added.' }] },
    });

    await expect(
      client(fake).addSeries(BLUEY_2018, {
        qualityProfileId: 4,
        rootFolderPath: '/data/media/tv',
        monitor: 'all',
        searchForMissingEpisodes: false,
      }),
    ).rejects.toThrow(/already been added/);
  });
});

describe('ArrHttp timeout signal (REL-04)', () => {
  it('passes an AbortSignal to the fetch function', async () => {
    let capturedSignal: AbortSignal | undefined;
    const capturingFetch: typeof fetch = (input, init) => {
      capturedSignal = init?.signal ?? undefined;
      // Resolve immediately with a valid response so the test is fast.
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    };
    const http = new ArrHttp('Sonarr', 'http://sonarr.test:8989', 'key', {
      fetchFn: capturingFetch,
    });
    await http.request('/series/lookup?term=Bluey');
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
  });

  it('rejects when the fetch rejects with a TimeoutError', async () => {
    let capturedSignal: AbortSignal | undefined;
    const timeoutFetch: typeof fetch = (_input, init) => {
      capturedSignal = init?.signal ?? undefined;
      return Promise.reject(
        new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
      );
    };
    const http = new ArrHttp('Sonarr', 'http://sonarr.test:8989', 'key', {
      fetchFn: timeoutFetch,
    });
    await expect(http.request('/series/lookup?term=Bluey')).rejects.toThrow();
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
  });
});
