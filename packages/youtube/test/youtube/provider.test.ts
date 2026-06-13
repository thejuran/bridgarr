import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, updateSettings, type Config } from '../../src/config.js';
import { YouTubeSource, type SearchFn } from '../../src/youtube/provider.js';
import type { FlatEntry } from '../../src/youtube/search.js';

// Real recorded yt-dlp flat-search output (2026-06-12). The Rumpole set is the
// canonical noise sample: same-channel uploads of other shows (Blandings,
// Jeeves & Wooster era content) and a wrong-season Rumpole episode.
const fixture = (name: string): FlatEntry[] =>
  (
    JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'fixtures', 'youtube', name), 'utf8'),
    ) as { entries: FlatEntry[] }
  ).entries;

const rumpole = fixture('search-rumpole-s01e02.json');
const mouseMovie = fixture('search-mouse-that-roared-movie.json');

describe('YouTubeSource', () => {
  let dataDir: string;
  let config: Config;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytfortv-test-'));
    config = loadConfig({ DATA_DIR: dataDir });
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const sourceWith = (searchFn: SearchFn) => new YouTubeSource(config, searchFn);
  const alwaysRumpole: SearchFn = () => Promise.resolve(rumpole);

  describe('searchTv', () => {
    it('returns nothing for negative season/episode (guard against bad numbering)', async () => {
      const searchFn = vi.fn<SearchFn>().mockResolvedValue(rumpole);
      const source = sourceWith(searchFn);

      expect(await source.searchTv('Rumpole of the Bailey', -1, 2)).toEqual([]);
      expect(searchFn).not.toHaveBeenCalled();
    });

    it('searches season 0 Specials (S00) rather than dropping them', async () => {
      const searchFn = vi.fn<SearchFn>().mockResolvedValue([]);
      const source = sourceWith(searchFn);

      await source.searchTv('Rumpole of the Bailey', 0, 1);
      // Season 0 is a real Sonarr Specials request; it must reach the fan-out.
      expect(searchFn).toHaveBeenCalled();
    });

    it('fans out over all query variants', async () => {
      const searchFn = vi.fn<SearchFn>().mockResolvedValue([]);
      await sourceWith(searchFn).searchTv('Rumpole of the Bailey', 1, 2);

      const queries = searchFn.mock.calls.map((c) => c[0]);
      expect(queries).toEqual([
        'Rumpole of the Bailey S01E02',
        'Rumpole of the Bailey season 1 episode 2',
        'Rumpole of the Bailey 1x02',
        'Rumpole of the Bailey full episode',
      ]);
    });

    it('dedupes by video id when variants return overlapping results', async () => {
      const results = await sourceWith(alwaysRumpole).searchTv('Rumpole of the Bailey', 1, 2);

      const ids = results.map((v) => v.itemId);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBeGreaterThan(0);
    });

    it('filters out other shows returned by YouTube (the Blandings problem)', async () => {
      const results = await sourceWith(alwaysRumpole).searchTv('Rumpole of the Bailey', 1, 2);

      expect(results.length).toBeGreaterThan(0);
      for (const v of results) {
        expect(v.sourceTitle.toLowerCase()).toContain('rumpole');
      }
    });

    it('keeps other shows when the title filter is disabled', async () => {
      updateSettings(config, { titleFilter: false });
      const results = await sourceWith(alwaysRumpole).searchTv('Rumpole of the Bailey', 1, 2);

      expect(results.some((v) => v.sourceTitle.includes('Blandings'))).toBe(true);
    });

    it('ranks the upload matching the requested S/E above other episodes', async () => {
      const results = await sourceWith(alwaysRumpole).searchTv('Rumpole of the Bailey', 1, 2);

      expect(results[0]!.sourceTitle.toLowerCase()).toContain('s1e2');
    });

    it('drops results shorter than the TV duration floor', async () => {
      const entries: FlatEntry[] = [
        { id: 'clip', title: 'Rumpole of the Bailey best moments', duration: 240 },
        { id: 'full', title: 'Rumpole of the Bailey S01E02 full', duration: 3000 },
      ];
      const results = await sourceWith(() => Promise.resolve(entries)).searchTv(
        'Rumpole of the Bailey',
        1,
        2,
      );

      expect(results.map((v) => v.itemId)).toEqual(['full']);
    });

    it('drops livestreams, upcoming premieres, and null durations', async () => {
      const entries: FlatEntry[] = [
        { id: 'live', title: 'Rumpole of the Bailey marathon', duration: 9000, live_status: 'is_live' },
        { id: 'soon', title: 'Rumpole of the Bailey premiere', duration: 9000, live_status: 'is_upcoming' },
        { id: 'null', title: 'Rumpole of the Bailey', duration: null },
        { id: 'ok', title: 'Rumpole of the Bailey S01E02', duration: 3000, live_status: 'was_live' },
      ];
      const results = await sourceWith(() => Promise.resolve(entries)).searchTv(
        'Rumpole of the Bailey',
        1,
        2,
      );

      expect(results.map((v) => v.itemId)).toEqual(['ok']);
    });

    it('survives a failing search variant', async () => {
      let call = 0;
      const flaky: SearchFn = () =>
        call++ === 0 ? Promise.reject(new Error('boom')) : Promise.resolve(rumpole);
      const results = await sourceWith(flaky).searchTv('Rumpole of the Bailey', 1, 2);

      expect(results.length).toBeGreaterThan(0);
    });

    it('caps merged output at 50 results', async () => {
      const many: FlatEntry[] = Array.from({ length: 70 }, (_, i) => ({
        id: `v${i}`,
        title: `Rumpole of the Bailey upload ${i}`,
        duration: 3000,
      }));
      const results = await sourceWith(() => Promise.resolve(many)).searchTv(
        'Rumpole of the Bailey',
        1,
        2,
      );

      expect(results).toHaveLength(50);
    });

    it('maps flat entries to BridgeResult with a watch-page fallback URL', async () => {
      const entries: FlatEntry[] = [
        {
          id: 'xyz',
          title: 'Rumpole of the Bailey S01E02',
          uploader: 'Some Uploader',
          duration: 3099.4,
          view_count: 12,
        },
      ];
      const [v] = await sourceWith(() => Promise.resolve(entries)).searchTv(
        'Rumpole of the Bailey',
        1,
        2,
      );

      expect(v).toEqual({
        itemId: 'xyz',
        sourceTitle: 'Rumpole of the Bailey S01E02',
        channel: 'Some Uploader',
        durationSec: 3099,
        pageUrl: 'https://www.youtube.com/watch?v=xyz',
      });
    });
  });

  describe('searchMovie', () => {
    it('drops clips, trailers, and intros via the movie duration floor', async () => {
      const results = await sourceWith(() => Promise.resolve(mouseMovie)).searchMovie(
        'The Mouse That Roared',
        1959,
      );

      expect(results.length).toBeGreaterThan(0);
      for (const v of results) {
        expect(v.durationSec).toBeGreaterThanOrEqual(45 * 60);
      }
      expect(results.some((v) => /trailer/i.test(v.sourceTitle))).toBe(false);
    });

    it('ranks "full movie" uploads first', async () => {
      const entries: FlatEntry[] = [
        { id: 'plain', title: 'The Mouse That Roared 1080p', duration: 5000 },
        { id: 'full', title: 'The Mouse That Roared FULL MOVIE', duration: 5000 },
      ];
      const results = await sourceWith(() => Promise.resolve(entries)).searchMovie(
        'The Mouse That Roared',
        1959,
      );

      expect(results.map((v) => v.itemId)).toEqual(['full', 'plain']);
    });

    it('searches without year variants when no year is known', async () => {
      const searchFn = vi.fn<SearchFn>().mockResolvedValue([]);
      await sourceWith(searchFn).searchMovie('The Mouse That Roared');

      expect(searchFn).toHaveBeenCalledTimes(1);
      expect(searchFn.mock.calls[0]![0]).toBe('The Mouse That Roared full movie');
    });
  });
});
