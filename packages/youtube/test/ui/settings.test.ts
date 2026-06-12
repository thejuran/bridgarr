import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, type Config } from '../../src/config.js';
import { createServer } from '../../src/server.js';

describe('settings ui', () => {
  let dataDir: string;
  let config: Config;
  let app: ReturnType<typeof createServer>;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytfortv-test-'));
    config = loadConfig({ DATA_DIR: dataDir });
    app = createServer(config);
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('renders the settings form with current values', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain(config.settings.apiKey);
    expect(res.text).toContain('name="downloadDir"');
    expect(res.text).toContain('name="quality"');
    expect(res.text).toContain('name="concurrency"');
    expect(res.text).toContain('name="sonarrUrl"');
    expect(res.text).toContain('name="radarrUrl"');
    expect(res.text).toContain('name="radarrApiKey"');
    expect(res.text).toContain('name="releaseQuality"');
    expect(res.text).toContain('name="minTvMinutes"');
    expect(res.text).toContain('name="minMovieMinutes"');
    expect(res.text).toContain('name="titleFilter"');
    expect(res.text).toContain('name="cookiesFile"');
  });

  it('escapes settings values in the page', async () => {
    const { updateSettings } = await import('../../src/config.js');
    updateSettings(config, { sonarrUrl: '"><script>alert(1)</script>' });

    const res = await request(app).get('/');

    expect(res.text).not.toContain('<script>alert(1)</script>');
  });

  it('saves valid settings and persists them', async () => {
    const res = await request(app).post('/settings').type('form').send({
      apiKey: config.settings.apiKey,
      downloadDir: '/tmp/dl',
      completeDir: '/tmp/done',
      quality: '720p',
      concurrency: '3',
      sonarrUrl: 'http://sonarr:8989',
      sonarrApiKey: 'abc123',
      radarrUrl: 'http://radarr:7878',
      radarrApiKey: 'def456',
    });

    expect(res.status).toBe(303);

    const reloaded = loadConfig({ DATA_DIR: dataDir });
    expect(reloaded.settings).toMatchObject({
      quality: '720p',
      concurrency: 3,
      downloadDir: '/tmp/dl',
      completeDir: '/tmp/done',
      sonarrUrl: 'http://sonarr:8989',
      sonarrApiKey: 'abc123',
      radarrUrl: 'http://radarr:7878',
      radarrApiKey: 'def456',
    });
  });

  it('saves search settings', async () => {
    const res = await request(app).post('/settings').type('form').send({
      quality: '1080p',
      concurrency: '2',
      releaseQuality: '720p',
      minTvMinutes: '15',
      minMovieMinutes: '60',
      titleFilter: 'off',
      cookiesFile: '/config/cookies.txt',
    });

    expect(res.status).toBe(303);
    const reloaded = loadConfig({ DATA_DIR: dataDir });
    expect(reloaded.settings).toMatchObject({
      releaseQuality: '720p',
      minTvMinutes: 15,
      minMovieMinutes: 60,
      titleFilter: false,
      cookiesFile: '/config/cookies.txt',
    });
  });

  it('rejects bad search settings', async () => {
    for (const body of [
      { releaseQuality: '4K' },
      { minTvMinutes: '-1' },
      { minTvMinutes: 'soon' },
      { minMovieMinutes: '-5' },
      { titleFilter: 'maybe' },
    ]) {
      const res = await request(app)
        .post('/settings')
        .type('form')
        .send({ quality: '1080p', concurrency: '2', ...body });
      expect(res.status).toBe(400);
    }
  });

  it('rejects an invalid quality', async () => {
    const res = await request(app)
      .post('/settings')
      .type('form')
      .send({ quality: '4k', concurrency: '2' });

    expect(res.status).toBe(400);
  });

  it('rejects a non-numeric or out-of-range concurrency', async () => {
    for (const concurrency of ['zero', '0', '-1']) {
      const res = await request(app)
        .post('/settings')
        .type('form')
        .send({ quality: '1080p', concurrency });
      expect(res.status).toBe(400);
    }
  });

  it('ignores attempts to blank the api key', async () => {
    const res = await request(app)
      .post('/settings')
      .type('form')
      .send({ quality: '1080p', concurrency: '2', apiKey: '' });

    expect(res.status).toBe(303);
    const reloaded = loadConfig({ DATA_DIR: dataDir });
    expect(reloaded.settings.apiKey).toBe(config.settings.apiKey);
  });
});
