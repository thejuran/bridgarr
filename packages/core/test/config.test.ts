import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateApiKey, loadSettings, saveSettings } from '../../src/config.js';

describe('generateApiKey', () => {
  it('returns a 32-character lowercase hex string', () => {
    const key = generateApiKey();
    expect(key).toMatch(/^[0-9a-f]{32}$/);
  });

  it('two successive calls produce different keys', () => {
    const k1 = generateApiKey();
    const k2 = generateApiKey();
    expect(k1).not.toBe(k2);
  });
});

describe('loadSettings', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgarr-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  interface TestSettings {
    apiKey: string;
    port: number;
    label?: string;
  }

  const defaults: TestSettings = { apiKey: 'default-key', port: 8485 };

  it('returns defaults when the settings file does not exist', () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    const result = loadSettings<TestSettings>(settingsPath, defaults);
    expect(result).toEqual(defaults);
  });

  it('returns defaults merged with persisted values (persisted keys win)', () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    const persisted = { apiKey: 'persisted-key' };
    fs.writeFileSync(settingsPath, JSON.stringify(persisted));

    const result = loadSettings<TestSettings>(settingsPath, defaults);
    expect(result.apiKey).toBe('persisted-key');
    // Missing keys fall back to defaults
    expect(result.port).toBe(8485);
  });

  it('falls back to default for keys absent in the persisted file', () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ label: 'hello' }));

    const result = loadSettings<TestSettings>(settingsPath, defaults);
    expect(result.apiKey).toBe('default-key');
    expect(result.port).toBe(8485);
    expect(result.label).toBe('hello');
  });
});

describe('saveSettings + loadSettings round-trip', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgarr-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saveSettings writes pretty-printed JSON with a trailing newline', () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    const obj = { apiKey: 'abc', port: 9000 };

    saveSettings(settingsPath, obj);

    const raw = fs.readFileSync(settingsPath, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(JSON.parse(raw)).toEqual(obj);
    // Pretty-printed: contains at least one newline inside the JSON body
    expect(raw.split('\n').length).toBeGreaterThan(2);
  });

  it('round-trips an object through saveSettings → loadSettings', () => {
    const settingsPath = path.join(tmpDir, 'settings.json');
    const obj = { apiKey: 'round-trip-key', port: 7777 };
    const defaults = { apiKey: 'default', port: 0 };

    saveSettings(settingsPath, obj);
    const result = loadSettings(settingsPath, defaults);

    expect(result).toMatchObject(obj);
  });
});
