import fs from 'node:fs';
import path from 'node:path';
import { generateApiKey, loadSettings, saveSettings } from '@bridgarr/core';

/** User-editable settings, persisted to <dataDir>/settings.json. */
export interface Settings {
  /** API key Sonarr presents to both the Newznab and SABnzbd endpoints. */
  apiKey: string;
  /** Directory for in-progress downloads. */
  downloadDir: string;
  /** Directory finished files are moved to (SABnzbd complete_dir). */
  completeDir: string;
  /** Preferred video quality passed to yt-dlp format selection. */
  quality: '1080p' | '720p' | 'best';
  /** Max simultaneous yt-dlp downloads. */
  concurrency: number;
  sonarrUrl: string;
  sonarrApiKey: string;
  radarrUrl: string;
  radarrApiKey: string;
  /**
   * Quality token stamped into release names. Flat search returns no
   * resolution, so a pessimistic fixed token never overpromises; Sonarr
   * re-detects actual media info on import.
   */
  releaseQuality: string;
  /** Drop TV results shorter than this many minutes (clips, trailers). */
  minTvMinutes: number;
  /** Drop movie results shorter than this many minutes. */
  minMovieMinutes: number;
  /** Require every word of the requested title in the upload title. */
  titleFilter: boolean;
  /** Netscape cookies file passed to yt-dlp (bot-check escape hatch); blank = off. */
  cookiesFile: string;
  /**
   * Optional app-key gate on the settings UI + state-changing browse POSTs; default off — LAN-trust model preserved.
   * When true, GET /, POST /settings, POST /settings/rotate-key, POST /browse/add,
   * POST /browse/add-movie, GET /browse/add, and GET /browse/add-movie require the app key
   * (via ?apikey= query param or a short-lived session cookie). /api, /nzb/:token, and
   * read-only GET /browse stay open regardless (D-05, D-07).
   */
  requireAuth: boolean;
}

export interface Config {
  host: string;
  port: number;
  dataDir: string;
  settings: Settings;
  /**
   * Operator override naming the real NAS hostname/IP for the DNS-rebinding
   * host-allowlist; parsed from the ALLOWED_HOSTS env var (comma-separated).
   * Unset → guards use their built-in localhost + private-LAN-IP default.
   */
  allowedHosts: string[];
}

const SETTINGS_FILE = 'settings.json';

function defaultSettings(dataDir: string): Settings {
  return {
    apiKey: generateApiKey(),
    downloadDir: path.join(dataDir, 'downloads'),
    completeDir: path.join(dataDir, 'complete'),
    quality: '1080p',
    concurrency: 2,
    sonarrUrl: '',
    sonarrApiKey: '',
    radarrUrl: '',
    radarrApiKey: '',
    releaseQuality: '480p',
    minTvMinutes: 10,
    minMovieMinutes: 45,
    titleFilter: true,
    cookiesFile: '',
    requireAuth: false,
  };
}

/**
 * Load config from environment + persisted settings. Creates the data dir and
 * a settings.json (with a freshly generated API key) on first run.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = path.resolve(env.DATA_DIR ?? 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const settingsPath = path.join(dataDir, SETTINGS_FILE);
  const settings = loadSettings<Settings>(settingsPath, defaultSettings(dataDir));
  saveSettings(settingsPath, settings);

  // ALLOWED_HOSTS: operator override for the DNS-rebinding host-allowlist (T-08-07 / T-08-08).
  // Comma-separated list of host[:port] entries the operator's real NAS hostname/IP.
  // When unset, the guards fall back to their built-in localhost + private-LAN-IP-literal default.
  const allowedHosts = env.ALLOWED_HOSTS
    ? env.ALLOWED_HOSTS.split(',')
        .map((h) => h.trim())
        .filter(Boolean)
    : [];

  return {
    host: env.HOST ?? '0.0.0.0',
    port: env.PORT ? Number(env.PORT) : 8485,
    dataDir,
    settings,
    allowedHosts,
  };
}

/** Merge a partial update into settings and persist. Returns the new settings. */
export function updateSettings(config: Config, patch: Partial<Settings>): Settings {
  config.settings = { ...config.settings, ...patch };
  saveSettings(path.join(config.dataDir, SETTINGS_FILE), config.settings);
  return config.settings;
}
