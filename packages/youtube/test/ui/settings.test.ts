import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, updateSettings, type Config } from '../../src/config.js';
import { createServer } from '../../src/server.js';

// Same-origin headers for test POSTs that should succeed (SEC-01 / T-08-04).
// supertest's default Host includes a dynamic port; setting both Host and Origin
// to a fixed allowlisted value keeps the host-allowlist + same-origin checks happy.
const SAME_ORIGIN_HEADERS = {
  Host: '127.0.0.1',
  Origin: 'http://127.0.0.1',
};

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

  it('renders the settings form with current values — app key is masked (SEC-01)', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    // The app key must NOT appear in the rendered HTML (SEC-01 / T-08-01).
    expect(res.text).not.toContain(config.settings.apiKey);
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

  it('never renders any credential value in the page (SEC-01 — all three masked)', async () => {
    // Seed non-default *arr keys (placeholders only — never 32-char hex literals, gitleaks).
    updateSettings(config, { sonarrApiKey: 'sonarr-key', radarrApiKey: 'radarr-key' });

    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    // No credential value in the HTML.
    expect(res.text).not.toContain(config.settings.apiKey);
    expect(res.text).not.toContain('sonarr-key');
    expect(res.text).not.toContain('radarr-key');
    // No reveal endpoint and no CSRF token field anywhere.
    expect(res.text).not.toContain('/settings/apikey');
    expect(res.text).not.toContain('name="_csrf"');
    // Rotate affordance is present.
    expect(res.text).toContain('/settings/rotate-key');
  });

  it('escapes settings values in the page', async () => {
    updateSettings(config, { sonarrUrl: '"><script>alert(1)</script>' });

    const res = await request(app).get('/');

    expect(res.text).not.toContain('<script>alert(1)</script>');
  });

  it('saves valid settings and persists them', async () => {
    const res = await request(app)
      .post('/settings')
      .set(SAME_ORIGIN_HEADERS)
      .type('form')
      .send({
        downloadDir: '/tmp/dl',
        completeDir: '/tmp/done',
        quality: '720p',
        concurrency: '3',
        sonarrUrl: 'http://sonarr:8989',
        sonarrApiKey: 'new-sonarr-key',
        radarrUrl: 'http://radarr:7878',
        radarrApiKey: 'new-radarr-key',
      });

    expect(res.status).toBe(303);

    const reloaded = loadConfig({ DATA_DIR: dataDir });
    expect(reloaded.settings).toMatchObject({
      quality: '720p',
      concurrency: 3,
      downloadDir: '/tmp/dl',
      completeDir: '/tmp/done',
      sonarrUrl: 'http://sonarr:8989',
      sonarrApiKey: 'new-sonarr-key',
      radarrUrl: 'http://radarr:7878',
      radarrApiKey: 'new-radarr-key',
    });
  });

  it('saves search settings', async () => {
    const res = await request(app)
      .post('/settings')
      .set(SAME_ORIGIN_HEADERS)
      .type('form')
      .send({
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
        .set(SAME_ORIGIN_HEADERS)
        .type('form')
        .send({ quality: '1080p', concurrency: '2', ...body });
      expect(res.status).toBe(400);
    }
  });

  it('rejects an invalid quality', async () => {
    const res = await request(app)
      .post('/settings')
      .set(SAME_ORIGIN_HEADERS)
      .type('form')
      .send({ quality: '4k', concurrency: '2' });

    expect(res.status).toBe(400);
  });

  it('rejects a non-numeric or out-of-range concurrency', async () => {
    for (const concurrency of ['zero', '0', '-1']) {
      const res = await request(app)
        .post('/settings')
        .set(SAME_ORIGIN_HEADERS)
        .type('form')
        .send({ quality: '1080p', concurrency });
      expect(res.status).toBe(400);
    }
  });

  it('ignores attempts to blank the api key', async () => {
    const res = await request(app)
      .post('/settings')
      .set(SAME_ORIGIN_HEADERS)
      .type('form')
      .send({ quality: '1080p', concurrency: '2', apiKey: '' });

    expect(res.status).toBe(303);
    const reloaded = loadConfig({ DATA_DIR: dataDir });
    expect(reloaded.settings.apiKey).toBe(config.settings.apiKey);
  });

  it('does NOT set the app api key via POST /settings — rotate-only (D-02)', async () => {
    // A crafted same-origin POST with an apiKey body field must be ignored:
    // the app key changes ONLY via POST /settings/rotate-key.
    const before = config.settings.apiKey;

    const res = await request(app)
      .post('/settings')
      .set(SAME_ORIGIN_HEADERS)
      .type('form')
      .send({ quality: '1080p', concurrency: '2', apiKey: 'attacker-chosen-key' });

    expect(res.status).toBe(303);
    const reloaded = loadConfig({ DATA_DIR: dataDir });
    // The key is unchanged — the body field had no effect.
    expect(reloaded.settings.apiKey).toBe(before);
    expect(reloaded.settings.apiKey).not.toBe('attacker-chosen-key');
  });

  it('rotate reveals a new key once and invalidates the old one (SEC-01 / D-02)', async () => {
    const before = config.settings.apiKey;

    const res = await request(app)
      .post('/settings/rotate-key')
      .set(SAME_ORIGIN_HEADERS)
      .type('form')
      .send({});

    expect(res.status).toBe(200);
    // Response body contains the new 32-char hex key (one-time reveal).
    const match = res.text.match(/[0-9a-f]{32}/);
    expect(match).not.toBeNull();
    const revealedKey = match![0];
    expect(revealedKey).not.toBe(before);

    // Key is persisted to disk.
    const reloaded = loadConfig({ DATA_DIR: dataDir });
    expect(reloaded.settings.apiKey).toBe(revealedKey);

    // GET / after rotate does NOT contain the new key (one-time only).
    const pageRes = await request(app).get('/');
    expect(pageRes.text).not.toContain(revealedKey);
  });

  it('the old key stops authenticating after rotate (intentional — T-08-06)', async () => {
    const before = config.settings.apiKey;

    await request(app)
      .post('/settings/rotate-key')
      .set(SAME_ORIGIN_HEADERS)
      .type('form')
      .send({});

    // Old key should now fail the /api auth check.
    // SAB auth failure returns HTTP 200 with { status: false, error: 'API Key Incorrect' }
    // (mirroring the existing /api auth failure shape from the sabnzbd tests).
    const oldKeyRes = await request(app).get(`/api?mode=version&apikey=${before}`);
    expect(oldKeyRes.body).toMatchObject({ status: false, error: 'API Key Incorrect' });

    // New key (now in config.settings after rotate mutated config in-place) should pass.
    const newKeyRes = await request(app).get(`/api?mode=version&apikey=${config.settings.apiKey}`);
    expect(newKeyRes.status).toBe(200);
    expect(newKeyRes.body.version).toBeDefined();
  });

  it('rejects a cross-site POST to settings and rotate (CSRF defense — T-08-04)', async () => {
    const originalKey = config.settings.apiKey;

    // Foreign Origin → 403.
    const foreignRes = await request(app)
      .post('/settings')
      .set('Host', '127.0.0.1')
      .set('Origin', 'http://evil.example')
      .type('form')
      .send({ quality: '720p', concurrency: '2' });
    expect(foreignRes.status).toBe(403);

    // Missing Origin AND Referer → 403 (fail closed).
    const noOriginRes = await request(app)
      .post('/settings')
      .set('Host', '127.0.0.1')
      .type('form')
      .send({ quality: '720p', concurrency: '2' });
    expect(noOriginRes.status).toBe(403);

    // Same cross-site rejection for rotate.
    const rotateRes = await request(app)
      .post('/settings/rotate-key')
      .set('Host', '127.0.0.1')
      .set('Origin', 'http://evil.example')
      .type('form')
      .send({});
    expect(rotateRes.status).toBe(403);

    // Settings NOT mutated by either failed request.
    const reloaded = loadConfig({ DATA_DIR: dataDir });
    expect(reloaded.settings.quality).not.toBe('720p');
    expect(reloaded.settings.apiKey).toBe(originalKey);

    // Same-origin + allowlisted Host → 303 (happy path).
    const happyRes = await request(app)
      .post('/settings')
      .set(SAME_ORIGIN_HEADERS)
      .type('form')
      .send({ quality: '720p', concurrency: '2' });
    expect(happyRes.status).toBe(303);
  });

  it('rejects a DNS-rebinding POST where Origin matches an unapproved public Host (T-08-07)', async () => {
    const originalKey = config.settings.apiKey;

    // Origin equals Host, but the Host is a public name not on the allowlist.
    const dnsPOSTSettings = await request(app)
      .post('/settings')
      .set('Host', 'evil.example:8485')
      .set('Origin', 'http://evil.example:8485')
      .type('form')
      .send({ quality: '720p', concurrency: '2' });
    expect(dnsPOSTSettings.status).toBe(403);

    // Same for rotate.
    const dnsPOSTRotate = await request(app)
      .post('/settings/rotate-key')
      .set('Host', 'evil.example:8485')
      .set('Origin', 'http://evil.example:8485')
      .type('form')
      .send({});
    expect(dnsPOSTRotate.status).toBe(403);

    // Settings NOT mutated; key unchanged.
    const reloaded = loadConfig({ DATA_DIR: dataDir });
    expect(reloaded.settings.apiKey).toBe(originalKey);
  });

  it('a private-LAN-IP Host with a matching same-origin Origin passes the guard (allowlist positive case)', async () => {
    // 192.168.1.50 is in the RFC1918 private range — the default allowlist must allow it.
    const res = await request(app)
      .post('/settings')
      .set('Host', '192.168.1.50:8485')
      .set('Origin', 'http://192.168.1.50:8485')
      .type('form')
      .send({ quality: '720p', concurrency: '2' });

    expect(res.status).toBe(303);
    const reloaded = loadConfig({ DATA_DIR: dataDir });
    expect(reloaded.settings.quality).toBe('720p');
  });

  it('keeps the stored Sonarr/Radarr key when the field is blank (D-04)', async () => {
    updateSettings(config, { sonarrApiKey: 'sonarr-key', radarrApiKey: 'radarr-key' });

    const res = await request(app)
      .post('/settings')
      .set(SAME_ORIGIN_HEADERS)
      .type('form')
      .send({ quality: '1080p', concurrency: '2', sonarrApiKey: '', radarrApiKey: '' });

    expect(res.status).toBe(303);
    const reloaded = loadConfig({ DATA_DIR: dataDir });
    expect(reloaded.settings.sonarrApiKey).toBe('sonarr-key');
    expect(reloaded.settings.radarrApiKey).toBe('radarr-key');
  });
});
