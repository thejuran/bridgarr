import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, type Config } from '../../src/config.js';
import { DownloadQueue } from '../../src/downloads/queue.js';
import { buildNzb, type NzbPayload } from '../../src/nzb.js';
import { createServer } from '../../src/server.js';

const payload: NzbPayload = {
  provider: 'youtube',
  episodeId: 'dQw4w9WgXcQ',
  title: 'Bluey.S01E01.The.Magic.Xylophone.1080p.WEB-DL',
  pageUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
};

describe('sabnzbd api', () => {
  let dataDir: string;
  let config: Config;
  let queue: DownloadQueue;
  let app: ReturnType<typeof createServer>;
  let key: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytfortv-test-'));
    config = loadConfig({ DATA_DIR: dataDir });
    key = config.settings.apiKey;
    queue = new DownloadQueue();
    app = createServer(config, { queue });
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const addFile = () =>
    request(app)
      .post(`/api?mode=addfile&apikey=${key}&cat=sonarr&output=json`)
      .attach('name', Buffer.from(buildNzb(payload)), 'release.nzb');

  it('rejects a wrong apikey', async () => {
    const res = await request(app).get('/api?mode=version&apikey=wrong');
    expect(res.body).toMatchObject({ status: false, error: 'API Key Incorrect' });
  });

  it('reports a version', async () => {
    const res = await request(app).get(`/api?mode=version&apikey=${key}`);
    expect(res.body.version).toMatch(/^\d+\./);
  });

  it('returns complete_dir and categories in get_config', async () => {
    const res = await request(app).get(`/api?mode=get_config&apikey=${key}`);

    expect(res.body.config.misc.complete_dir).toBe(config.settings.completeDir);
    const names = res.body.config.categories.map((c: { name: string }) => c.name);
    expect(names).toEqual(expect.arrayContaining(['sonarr', 'tv', 'movies']));
  });

  it('accepts an NZB via addfile and queues a job', async () => {
    const res = await addFile();

    expect(res.body.status).toBe(true);
    expect(res.body.nzo_ids).toHaveLength(1);

    const q = await request(app).get(`/api?mode=queue&apikey=${key}`);
    const slot = q.body.queue.slots[0];
    expect(slot).toMatchObject({
      nzo_id: res.body.nzo_ids[0],
      status: 'Queued',
      filename: payload.title,
      cat: 'sonarr',
    });
    expect(slot.percentage).toBe('0');
    expect(slot.timeleft).toMatch(/^\d+:\d{2}:\d{2}$/);
    expect(typeof slot.mb).toBe('string');
    expect(typeof slot.mbleft).toBe('string');
  });

  it('rejects addfile uploads that are not ytfortv NZBs', async () => {
    const res = await request(app)
      .post(`/api?mode=addfile&apikey=${key}&cat=sonarr`)
      .attach('name', Buffer.from('<html>nope</html>'), 'junk.nzb');

    expect(res.body.status).toBe(false);
  });

  it('shows progress in the queue while downloading', async () => {
    const { body } = await addFile();
    const nzoId = body.nzo_ids[0];
    queue.markStarted(nzoId);
    queue.setProgress(nzoId, 75_000_000, 300_000_000);

    const q = await request(app).get(`/api?mode=queue&apikey=${key}`);
    const slot = q.body.queue.slots[0];
    expect(slot.status).toBe('Downloading');
    expect(slot.percentage).toBe('25');
    expect(slot.mb).toBe('286.10');
    expect(slot.mbleft).toBe('214.58');
  });

  it('moves completed jobs to history with absolute storage path', async () => {
    const { body } = await addFile();
    const nzoId = body.nzo_ids[0];
    queue.markStarted(nzoId);
    queue.markCompleted(nzoId, '/data/complete/sonarr/Bluey.S01E01.mp4', 300_000_000);

    const q = await request(app).get(`/api?mode=queue&apikey=${key}`);
    expect(q.body.queue.slots).toHaveLength(0);

    const h = await request(app).get(`/api?mode=history&apikey=${key}`);
    const slot = h.body.history.slots[0];
    expect(slot).toMatchObject({
      nzo_id: nzoId,
      status: 'Completed',
      storage: '/data/complete/sonarr/Bluey.S01E01.mp4',
      bytes: 300_000_000,
      category: 'sonarr',
      fail_message: '',
      nzb_name: `${payload.title}.nzb`,
      name: payload.title,
    });
    expect(typeof slot.download_time).toBe('number');
  });

  it('reports failed jobs with a fail message and null storage', async () => {
    const { body } = await addFile();
    const nzoId = body.nzo_ids[0];
    queue.markFailed(nzoId, 'geo-blocked');

    const h = await request(app).get(`/api?mode=history&apikey=${key}`);
    expect(h.body.history.slots[0]).toMatchObject({
      status: 'Failed',
      fail_message: 'geo-blocked',
      storage: null,
    });
  });

  it('deletes history entries', async () => {
    const { body } = await addFile();
    const nzoId = body.nzo_ids[0];
    queue.markFailed(nzoId, 'oops');

    const del = await request(app).get(
      `/api?mode=history&name=delete&value=${nzoId}&apikey=${key}`,
    );
    expect(del.body.status).toBe(true);

    const h = await request(app).get(`/api?mode=history&apikey=${key}`);
    expect(h.body.history.slots).toHaveLength(0);
  });

  it('deletes queued jobs from the queue', async () => {
    const { body } = await addFile();
    const nzoId = body.nzo_ids[0];

    const del = await request(app).get(
      `/api?mode=queue&name=delete&value=${nzoId}&apikey=${key}`,
    );
    expect(del.body.status).toBe(true);

    const q = await request(app).get(`/api?mode=queue&apikey=${key}`);
    expect(q.body.queue.slots).toHaveLength(0);
  });
});
