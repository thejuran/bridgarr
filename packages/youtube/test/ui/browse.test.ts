import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, updateSettings, type Config } from '../../src/config.js';
import { createServer } from '../../src/server.js';
import type { BrowseSearchFn } from '../../src/ui/browse.js';
import type { FlatEntry } from '../../src/youtube/search.js';
import { fakeRadarr, type FakeRadarr } from '../helpers/radarr.js';
import { fakeSonarr, type FakeSonarr } from '../helpers/sonarr.js';

const ENTRIES: FlatEntry[] = [
  {
    id: 'MmWv4voPEwE',
    title: 'Rumpole of the Bailey S1E2  the alternative society',
    channel: 'o p i u m 2',
    duration: 3099,
    view_count: 215225,
    url: 'https://www.youtube.com/watch?v=MmWv4voPEwE',
  },
  {
    id: 'clip1',
    title: 'Rumpole best bits',
    channel: 'Clips R Us',
    duration: 240,
    view_count: 12,
    url: 'https://www.youtube.com/watch?v=clip1',
  },
];

const ADD_FORM = {
  tvdbId: '353546',
  qualityProfileId: '4',
  rootFolderPath: '/data/media/tv',
  monitor: 'all',
  searchForMissing: 'on',
};

const ADD_MOVIE_FORM = {
  tmdbId: '9821',
  qualityProfileId: '1',
  rootFolderPath: '/data/media/movies',
  searchForMovie: 'on',
};

// Same-origin headers for test POSTs that should succeed (SEC-01 / T-08-04).
// Setting both Host and Origin to a fixed allowlisted value keeps the
// host-allowlist + same-origin checks in sameOriginGuard happy.
const SAME_ORIGIN_HEADERS = {
  Host: '127.0.0.1',
  Origin: 'http://127.0.0.1',
};

describe('browse ui', () => {
  let dataDir: string;
  let config: Config;
  let sonarr: FakeSonarr;
  let radarr: FakeRadarr;
  let browseSearch: ReturnType<typeof vi.fn<BrowseSearchFn>>;
  let app: ReturnType<typeof createServer>;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytfortv-test-'));
    config = loadConfig({ DATA_DIR: dataDir });
    updateSettings(config, {
      sonarrUrl: 'http://sonarr.test:8989',
      sonarrApiKey: 'sonarr-key',
      radarrUrl: 'http://radarr.test:7878',
      radarrApiKey: 'radarr-key',
    });
    sonarr = fakeSonarr();
    radarr = fakeRadarr();
    browseSearch = vi.fn<BrowseSearchFn>().mockResolvedValue(ENTRIES);
    app = createServer(config, {
      browseSearch,
      sonarrFetch: sonarr.fetch,
      radarrFetch: radarr.fetch,
    });
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  describe('GET /browse', () => {
    it('renders the search form', async () => {
      const res = await request(app).get('/browse');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/html/);
      expect(res.text).toContain('name="q"');
      expect(browseSearch).not.toHaveBeenCalled();
    });

    it('lists raw YouTube results with channel, length, and views', async () => {
      const res = await request(app).get('/browse?q=rumpole');

      expect(browseSearch).toHaveBeenCalledWith('rumpole', 25);
      expect(res.text).toContain('Rumpole of the Bailey S1E2');
      expect(res.text).toContain('o p i u m 2');
      expect(res.text).toContain('52 min');
      expect(res.text).toContain('215,225');
      expect(res.text).toContain('https://www.youtube.com/watch?v=MmWv4voPEwE');
    });

    it('offers add-to-Sonarr and add-to-Radarr for the searched title', async () => {
      const res = await request(app).get('/browse?q=' + encodeURIComponent('The Mouse That Roared 1959'));

      expect(res.text).toContain('/browse/add?title=The%20Mouse%20That%20Roared%201959');
      expect(res.text).toContain('/browse/add-movie?title=The%20Mouse%20That%20Roared&amp;year=1959');
    });

    it('shows an empty state when nothing matches', async () => {
      browseSearch.mockResolvedValue([]);
      const res = await request(app).get('/browse?q=xyzzy');

      expect(res.status).toBe(200);
      expect(res.text).toContain('No YouTube results');
    });

    it('degrades to an empty state when the search fails', async () => {
      browseSearch.mockRejectedValue(new Error('boom'));
      const res = await request(app).get('/browse?q=rumpole');

      expect(res.status).toBe(200);
      expect(res.text).toContain('No YouTube results');
    });

    it('escapes the query in the page', async () => {
      const res = await request(app).get('/browse').query({ q: '"><script>alert(1)</script>' });

      expect(res.text).not.toContain('<script>alert(1)</script>');
    });

    it('renders flash messages escaped', async () => {
      const res = await request(app)
        .get('/browse')
        .query({ error: '<script>x</script> add failed' });

      expect(res.text).not.toContain('<script>x</script>');
      expect(res.text).toContain('add failed');
    });
  });

  describe('GET /browse/add', () => {
    it('prompts for configuration when sonarr is unset', async () => {
      updateSettings(config, { sonarrUrl: '', sonarrApiKey: '' });

      const res = await request(app).get('/browse/add?title=Bluey');

      expect(res.status).toBe(200);
      expect(res.text).toContain('not configured');
    });

    it('lists tvdb candidates with profile and folder pickers', async () => {
      const res = await request(app).get('/browse/add?title=Bluey');

      expect(res.status).toBe(200);
      expect(res.text).toContain('353546');
      expect(res.text).toContain('78097');
      expect(res.text).toContain('(2018)');
      expect(res.text).toContain('(1976)');
      expect(res.text).toContain('HD-1080p');
      expect(res.text).toContain('/data/media/tv');
    });

    it('shows an empty state when sonarr finds nothing', async () => {
      const res = await request(app).get('/browse/add?title=xyzzy');

      expect(res.status).toBe(200);
      expect(res.text).toContain('no TheTVDB matches');
    });

    it('400s without a title', async () => {
      const res = await request(app).get('/browse/add');

      expect(res.status).toBe(400);
    });
  });

  describe('POST /browse/add', () => {
    it('adds the chosen series to sonarr and redirects', async () => {
      const res = await request(app).post('/browse/add').set(SAME_ORIGIN_HEADERS).type('form').send(ADD_FORM);

      expect(res.status).toBe(303);
      expect(res.headers.location).toContain('/browse?added=');
      expect(sonarr.addCalls).toHaveLength(1);
      expect(sonarr.addCalls[0]).toMatchObject({
        tvdbId: 353546,
        title: 'Bluey',
        titleSlug: 'bluey-2018',
        qualityProfileId: 4,
        rootFolderPath: '/data/media/tv',
        monitored: true,
        addOptions: { monitor: 'all', searchForMissingEpisodes: true },
      });
    });

    it('omits the missing-episode search when unchecked', async () => {
      const { searchForMissing: _omitted, ...form } = ADD_FORM;

      await request(app).post('/browse/add').set(SAME_ORIGIN_HEADERS).type('form').send(form);

      expect(sonarr.addCalls[0]).toMatchObject({
        addOptions: { monitor: 'all', searchForMissingEpisodes: false },
      });
    });

    it('rejects an invalid tvdb id', async () => {
      const res = await request(app)
        .post('/browse/add')
        .set(SAME_ORIGIN_HEADERS)
        .type('form')
        .send({ ...ADD_FORM, tvdbId: 'abc' });

      expect(res.status).toBe(400);
      expect(sonarr.addCalls).toHaveLength(0);
    });

    it('rejects an unknown monitor mode', async () => {
      const res = await request(app)
        .post('/browse/add')
        .set(SAME_ORIGIN_HEADERS)
        .type('form')
        .send({ ...ADD_FORM, monitor: 'pilot-only' });

      expect(res.status).toBe(400);
      expect(sonarr.addCalls).toHaveLength(0);
    });

    it('rejects when sonarr is not configured', async () => {
      updateSettings(config, { sonarrUrl: '', sonarrApiKey: '' });

      const res = await request(app).post('/browse/add').set(SAME_ORIGIN_HEADERS).type('form').send(ADD_FORM);

      expect(res.status).toBe(400);
      expect(sonarr.addCalls).toHaveLength(0);
    });

    it('redirects with the sonarr error message on failure', async () => {
      const failing = fakeSonarr({
        addFailure: {
          status: 400,
          body: [{ errorMessage: 'This series has already been added.' }],
        },
      });
      const failApp = createServer(config, { sonarrFetch: failing.fetch });

      const res = await request(failApp).post('/browse/add').set(SAME_ORIGIN_HEADERS).type('form').send(ADD_FORM);

      expect(res.status).toBe(303);
      expect(decodeURIComponent(res.headers.location ?? '')).toContain('already been added');
    });
  });

  describe('GET /browse/add-movie', () => {
    it('prompts for configuration when radarr is unset', async () => {
      updateSettings(config, { radarrUrl: '', radarrApiKey: '' });

      const res = await request(app).get('/browse/add-movie?title=Fracture');

      expect(res.status).toBe(200);
      expect(res.text).toContain('not configured');
    });

    it('lists tmdb candidates with years for disambiguation', async () => {
      const res = await request(app).get('/browse/add-movie?title=Fracture');

      expect(res.status).toBe(200);
      expect(res.text).toContain('9821');
      expect(res.text).toContain('55555');
      expect(res.text).toContain('(2007)');
      expect(res.text).toContain('(2010)');
      expect(res.text).toContain('HD-1080p');
      expect(res.text).toContain('/data/media/movies');
    });

    it('shows an empty state when radarr finds nothing', async () => {
      const res = await request(app).get('/browse/add-movie?title=xyzzy');

      expect(res.status).toBe(200);
      expect(res.text).toContain('no TMDB matches');
    });

    it('preselects the candidate matching the searched year', async () => {
      const res = await request(app).get('/browse/add-movie?title=Fracture&year=2010');

      expect(res.text).toMatch(/value="55555" checked/);
      expect(res.text).not.toMatch(/value="9821" checked/);
    });
  });

  describe('POST /browse/add-movie', () => {
    it('adds the chosen movie to radarr and redirects', async () => {
      const res = await request(app).post('/browse/add-movie').set(SAME_ORIGIN_HEADERS).type('form').send(ADD_MOVIE_FORM);

      expect(res.status).toBe(303);
      expect(res.headers.location).toContain('/browse?added=');
      expect(radarr.addCalls).toHaveLength(1);
      expect(radarr.addCalls[0]).toMatchObject({
        tmdbId: 9821,
        title: 'Fracture',
        titleSlug: 'fracture-9821',
        qualityProfileId: 1,
        rootFolderPath: '/data/media/movies',
        monitored: true,
        minimumAvailability: 'released',
        addOptions: { searchForMovie: true },
      });
    });

    it('rejects an invalid tmdb id', async () => {
      const res = await request(app)
        .post('/browse/add-movie')
        .set(SAME_ORIGIN_HEADERS)
        .type('form')
        .send({ ...ADD_MOVIE_FORM, tmdbId: 'abc' });

      expect(res.status).toBe(400);
      expect(radarr.addCalls).toHaveLength(0);
    });

    it('rejects when radarr is not configured', async () => {
      updateSettings(config, { radarrUrl: '', radarrApiKey: '' });

      const res = await request(app).post('/browse/add-movie').set(SAME_ORIGIN_HEADERS).type('form').send(ADD_MOVIE_FORM);

      expect(res.status).toBe(400);
      expect(radarr.addCalls).toHaveLength(0);
    });

    it('redirects with the radarr error message on failure', async () => {
      const failing = fakeRadarr({
        addFailure: {
          status: 400,
          body: [{ errorMessage: 'This movie has already been added.' }],
        },
      });
      const failApp = createServer(config, { radarrFetch: failing.fetch });

      const res = await request(failApp).post('/browse/add-movie').set(SAME_ORIGIN_HEADERS).type('form').send(ADD_MOVIE_FORM);

      expect(res.status).toBe(303);
      expect(decodeURIComponent(res.headers.location ?? '')).toContain('already been added');
    });
  });
});
