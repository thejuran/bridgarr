import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, updateSettings } from '../src/config.js';

describe('config', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytfortv-test-'));
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('creates settings.json with a generated API key on first run', () => {
    const config = loadConfig({ DATA_DIR: dataDir });

    expect(config.settings.apiKey).toMatch(/^[0-9a-f]{32}$/);
    const persisted = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'),
    );
    expect(persisted.apiKey).toBe(config.settings.apiKey);
  });

  it('uses defaults: port 8485, host 0.0.0.0, quality 1080p, concurrency 2', () => {
    const config = loadConfig({ DATA_DIR: dataDir });

    expect(config.port).toBe(8485);
    expect(config.host).toBe('0.0.0.0');
    expect(config.settings.quality).toBe('1080p');
    expect(config.settings.concurrency).toBe(2);
  });

  it('defaults the search knobs: 480p tag, clip floors, title filter on', () => {
    const config = loadConfig({ DATA_DIR: dataDir });

    expect(config.settings.releaseQuality).toBe('480p');
    expect(config.settings.minTvMinutes).toBe(10);
    expect(config.settings.minMovieMinutes).toBe(45);
    expect(config.settings.titleFilter).toBe(true);
    expect(config.settings.cookiesFile).toBe('');
  });

  it('defaults requireAuth to false (SEC-02 / D-05 — gate off, LAN-trust model preserved)', () => {
    const config = loadConfig({ DATA_DIR: dataDir });

    expect(config.settings.requireAuth).toBe(false);
  });

  it('an existing settings.json without requireAuth inherits false on reload (merge-over-defaults)', () => {
    // First run — creates settings.json on disk.
    loadConfig({ DATA_DIR: dataDir });
    // Simulate a pre-08-02 install: strip the requireAuth field and rewrite.
    const settingsPath = path.join(dataDir, 'settings.json');
    const existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
    delete existing.requireAuth;
    fs.writeFileSync(settingsPath, JSON.stringify(existing));

    // Reload — the merge-over-defaults should supply requireAuth: false.
    const reloaded = loadConfig({ DATA_DIR: dataDir });
    expect(reloaded.settings.requireAuth).toBe(false);
  });

  it('respects PORT and HOST env overrides', () => {
    const config = loadConfig({ DATA_DIR: dataDir, PORT: '9000', HOST: '127.0.0.1' });

    expect(config.port).toBe(9000);
    expect(config.host).toBe('127.0.0.1');
  });

  it('preserves the API key across reloads', () => {
    const first = loadConfig({ DATA_DIR: dataDir });
    const second = loadConfig({ DATA_DIR: dataDir });

    expect(second.settings.apiKey).toBe(first.settings.apiKey);
  });

  it('persists updated settings', () => {
    const config = loadConfig({ DATA_DIR: dataDir });
    updateSettings(config, { quality: '720p', sonarrUrl: 'http://sonarr:8989' });

    const reloaded = loadConfig({ DATA_DIR: dataDir });
    expect(reloaded.settings.quality).toBe('720p');
    expect(reloaded.settings.sonarrUrl).toBe('http://sonarr:8989');
  });
});
