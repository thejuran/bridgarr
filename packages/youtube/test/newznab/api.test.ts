import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, updateSettings, type Config } from '../../src/config.js';
import { DownloadQueue } from '../../src/downloads/queue.js';
import { parseNzb } from '../../src/nzb.js';
import { createServer } from '../../src/server.js';
import type { VideoSource, YtVideo } from '../../src/youtube/types.js';

const video = (over: Partial<YtVideo> = {}): YtVideo => ({
  videoId: 'MmWv4voPEwE',
  uploadTitle: 'Rumpole of the Bailey S1E2  the alternative society',
  channel: 'o p i u m 2',
  durationSec: 3099,
  viewCount: 215225,
  pageUrl: 'https://www.youtube.com/watch?v=MmWv4voPEwE',
  ...over,
});

describe('newznab api', () => {
  let dataDir: string;
  let config: Config;
  let queue: DownloadQueue;
  let source: { searchTv: ReturnType<typeof vi.fn>; searchMovie: ReturnType<typeof vi.fn> };
  let app: ReturnType<typeof createServer>;
  let key: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytfortv-test-'));
    config = loadConfig({ DATA_DIR: dataDir });
    key = config.settings.apiKey;
    queue = new DownloadQueue();
    source = {
      searchTv: vi.fn().mockResolvedValue([video()]),
      searchMovie: vi.fn().mockResolvedValue([video()]),
    };
    app = createServer(config, { source: source as unknown as VideoSource, queue });
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('rejects a wrong apikey with Newznab error 100', async () => {
    const res = await request(app).get('/api?t=caps&apikey=nope');
    expect(res.text).toContain('error code="100"');
  });

  it('advertises caps with q,season,ep tv-search', async () => {
    const res = await request(app).get(`/api?t=caps&apikey=${key}`);

    expect(res.headers['content-type']).toMatch(/xml/);
    expect(res.text).toContain('<server title="YTforTV"/>');
    expect(res.text).toContain('<tv-search available="yes" supportedParams="q,season,ep"/>');
    expect(res.text).toContain('<category id="5000"');
    expect(res.text).toContain('<category id="2000"');
  });

  describe('t=tvsearch', () => {
    it('stamps the requested numbering onto results', async () => {
      const res = await request(app).get(
        `/api?t=tvsearch&q=${encodeURIComponent('Rumpole of the Bailey')}&season=1&ep=2&apikey=${key}`,
      );

      expect(source.searchTv).toHaveBeenCalledWith('Rumpole of the Bailey', 1, 2);
      expect(res.text).toContain(
        'Rumpole.of.the.Bailey.S01E02.YT.the.alternative.society.52min.480p.WEB-DL-opium2',
      );
      expect(res.text).toContain('<newznab:attr name="season" value="1"/>');
      expect(res.text).toContain('<newznab:attr name="episode" value="2"/>');
      expect(res.text).toContain('<newznab:attr name="category" value="5000"/>');
    });

    it('sizes releases from duration so the Size column gauges length', async () => {
      const res = await request(app).get(
        `/api?t=tvsearch&q=Rumpole&season=1&ep=2&apikey=${key}`,
      );
      // 3099s × 250000 B/s
      expect(res.text).toContain(`<newznab:attr name="size" value="${3099 * 250000}"/>`);
    });

    it('strips a disambiguation year before searching, keeps it in the name', async () => {
      const res = await request(app).get(
        `/api?t=tvsearch&q=${encodeURIComponent('Bluey 2018')}&season=3&ep=5&apikey=${key}`,
      );

      expect(source.searchTv).toHaveBeenCalledWith('Bluey', 3, 5);
      expect(res.text).toContain('Bluey.2018.S03E05.YT.');
    });

    it('returns empty results for season-only searches', async () => {
      const res = await request(app).get(`/api?t=tvsearch&q=Rumpole&season=1&apikey=${key}`);

      expect(res.text).toContain('total="0"');
      expect(source.searchTv).not.toHaveBeenCalled();
    });

    it('returns empty results for daily-style numbering', async () => {
      const res = await request(app).get(
        `/api?t=tvsearch&q=News&season=2026&ep=${encodeURIComponent('06/12')}&apikey=${key}`,
      );

      expect(res.text).toContain('total="0"');
      expect(source.searchTv).not.toHaveBeenCalled();
    });

    it('answers the parameterless connection test with one synthetic release', async () => {
      const res = await request(app).get(`/api?t=tvsearch&apikey=${key}`);

      expect(res.text).toContain('total="1"');
      expect(res.text).toContain('YTforTV.Indexer.Test.S01E01.Connection.OK.480p.WEB-DL');
      expect(source.searchTv).not.toHaveBeenCalled();
    });

    it('uses HD categories when releaseQuality is 720p+', async () => {
      updateSettings(config, { releaseQuality: '720p' });
      const res = await request(app).get(
        `/api?t=tvsearch&q=Rumpole&season=1&ep=2&apikey=${key}`,
      );

      expect(res.text).toContain('720p.WEB-DL');
      expect(res.text).toContain('<newznab:attr name="category" value="5040"/>');
    });
  });

  describe('t=movie and t=search', () => {
    it('extracts the year from the query and stamps it', async () => {
      const res = await request(app).get(
        `/api?t=movie&q=${encodeURIComponent('The Mouse That Roared 1959')}&apikey=${key}`,
      );

      expect(source.searchMovie).toHaveBeenCalledWith('The Mouse That Roared', 1959);
      expect(res.text).toContain('The.Mouse.That.Roared.1959.YT.');
      expect(res.text).toContain('<newznab:attr name="category" value="2000"/>');
    });

    it('routes t=search with movie categories to the movie path', async () => {
      const res = await request(app).get(
        `/api?t=search&q=${encodeURIComponent('The Mouse That Roared 1959')}&cat=2000,2040&apikey=${key}`,
      );

      expect(source.searchMovie).toHaveBeenCalledWith('The Mouse That Roared', 1959);
      expect(res.text).toContain('The.Mouse.That.Roared.1959.YT.');
    });

    it('answers the parameterless movie test with one synthetic release', async () => {
      const res = await request(app).get(`/api?t=movie&apikey=${key}`);

      expect(res.text).toContain('YTforTV.Indexer.Test.1970.Connection.OK.480p.WEB-DL');
    });
  });

  it('round-trips a grab: search → NZB download → SAB addfile → queued job', async () => {
    const search = await request(app).get(
      `/api?t=tvsearch&q=${encodeURIComponent('Rumpole of the Bailey')}&season=1&ep=2&apikey=${key}`,
    );
    const enclosure = search.text.match(/<enclosure url="([^"]+)"/)?.[1];
    expect(enclosure).toBeTruthy();
    const nzbPath = new URL(enclosure!.replace(/&amp;/g, '&')).pathname;

    const nzb = await request(app).get(nzbPath);
    expect(nzb.headers['content-type']).toMatch(/x-nzb/);
    const payload = parseNzb(nzb.text);
    expect(payload).toMatchObject({
      provider: 'youtube',
      episodeId: 'MmWv4voPEwE',
      pageUrl: 'https://www.youtube.com/watch?v=MmWv4voPEwE',
    });

    const add = await request(app)
      .post(`/api?mode=addfile&apikey=${key}&cat=sonarr`)
      .attach('name', Buffer.from(nzb.text), 'release.nzb');
    expect(add.body.status).toBe(true);

    const job = queue.get(add.body.nzo_ids[0] as string)!;
    expect(job.payload.title).toContain('Rumpole.of.the.Bailey.S01E02.YT.');
    expect(job.payload.pageUrl).toBe('https://www.youtube.com/watch?v=MmWv4voPEwE');
  });

  it('returns empty results when no source is wired', async () => {
    const bare = createServer(config, { queue });
    const res = await request(bare).get(`/api?t=tvsearch&q=X&season=1&ep=2&apikey=${key}`);

    expect(res.text).toContain('total="0"');
  });
});
