import crypto from 'node:crypto';
import fs from 'node:fs';

/**
 * Generates a cryptographically random API key.
 * @returns A 32-character lowercase hex string (16 random bytes).
 */
export function generateApiKey(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Loads settings from a JSON file, merging with defaults.
 * If the file does not exist, returns `defaults` unchanged.
 * If the file exists, persisted keys override defaults; missing keys fall back to defaults.
 *
 * If the file exists but is unreadable or contains malformed JSON, logs a
 * warning and returns `defaults` rather than throwing — a corrupt or
 * half-written settings.json must not crash startup.
 *
 * @param settingsPath - Absolute path to the settings JSON file.
 * @param defaults - Default settings object; also determines the return type.
 * @returns Merged settings object.
 */
export function loadSettings<T extends object>(settingsPath: string, defaults: T): T {
  if (fs.existsSync(settingsPath)) {
    try {
      const persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Partial<T>;
      return { ...defaults, ...persisted };
    } catch (err) {
      // Corrupt or half-written settings file — fall back to defaults instead of
      // crashing the whole bridge at startup. Never swallow silently.
      console.warn(`loadSettings: failed to read or parse ${settingsPath}, using defaults`, err);
      return defaults;
    }
  }
  return defaults;
}

/**
 * Persists settings to a JSON file (pretty-printed, trailing newline).
 *
 * @param settingsPath - Absolute path to the settings JSON file.
 * @param settings - The settings object to write.
 */
export function saveSettings<T>(settingsPath: string, settings: T): void {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
}
