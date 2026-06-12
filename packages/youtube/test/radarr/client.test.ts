import { describe, expect, it } from 'vitest';
import { RadarrClient } from '../../src/radarr/client.js';
import { FRACTURE_2007, fakeRadarr, type FakeRadarr } from '../helpers/radarr.js';

function client(fake: FakeRadarr = fakeRadarr()): RadarrClient {
  return new RadarrClient('http://radarr.test:7878', 'radarr-key', { fetchFn: fake.fetch });
}

describe('RadarrClient', () => {
  it('looks up movies by term with the api key header', async () => {
    const results = await client().lookup('Fracture');

    expect(results).toMatchObject([
      { title: 'Fracture', year: 2007, tmdbId: 9821 },
      { title: 'Fracture', year: 2010, tmdbId: 55555 },
    ]);
  });

  it('rejects when the api key is wrong', async () => {
    const fake = fakeRadarr({ apiKey: 'something-else' });

    await expect(client(fake).lookup('Fracture')).rejects.toThrow(/Radarr 401/);
  });

  it('looks up a single movie by tmdb id', async () => {
    const movie = await client().lookupByTmdbId(55555);

    expect(movie).toMatchObject({ tmdbId: 55555, year: 2010 });
  });

  it('fetches quality profiles and root folders', async () => {
    const c = client();

    expect(await c.qualityProfiles()).toEqual([
      { id: 1, name: 'HD-1080p' },
      { id: 6, name: 'Any' },
    ]);
    expect(await c.rootFolders()).toEqual([{ path: '/data/media/movies' }]);
  });

  it('posts the looked-up movie plus add options when adding', async () => {
    const fake = fakeRadarr();

    await client(fake).addMovie(FRACTURE_2007, {
      qualityProfileId: 1,
      rootFolderPath: '/data/media/movies',
      searchForMovie: true,
    });

    expect(fake.addCalls).toHaveLength(1);
    expect(fake.addCalls[0]).toMatchObject({
      title: 'Fracture',
      tmdbId: 9821,
      titleSlug: 'fracture-9821',
      qualityProfileId: 1,
      rootFolderPath: '/data/media/movies',
      monitored: true,
      minimumAvailability: 'released',
      addOptions: { searchForMovie: true },
    });
  });

  it('surfaces radarr validation messages on failure', async () => {
    const fake = fakeRadarr({
      addFailure: { status: 400, body: [{ errorMessage: 'This movie has already been added.' }] },
    });

    await expect(
      client(fake).addMovie(FRACTURE_2007, {
        qualityProfileId: 1,
        rootFolderPath: '/data/media/movies',
        searchForMovie: false,
      }),
    ).rejects.toThrow(/already been added/);
  });
});
