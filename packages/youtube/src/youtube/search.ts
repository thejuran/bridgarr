import { spawn, type ChildProcess } from 'node:child_process';
import { logger } from '../logger.js';

/** Subset of yt-dlp's flat-playlist entry JSON the bridge consumes. */
export interface FlatEntry {
  id?: string;
  title?: string;
  channel?: string | null;
  uploader?: string | null;
  /** Seconds; null for some lives/premieres. */
  duration?: number | null;
  view_count?: number | null;
  /** Watch-page URL. */
  url?: string | null;
  live_status?: string | null;
}

export type SpawnLike = (
  cmd: string,
  args: string[],
  opts: { stdio: ['ignore', 'pipe', 'pipe'] },
) => ChildProcess;

export interface YtSearchOpts {
  ytdlpPath?: string;
  spawnFn?: SpawnLike;
  timeoutMs?: number;
  cookiesFile?: string;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Flat YouTube search via yt-dlp's `ytsearchN:` pseudo-URL — no API key,
 * ~1–2.5s per query. Failures (spawn error, timeout, non-zero exit, bad JSON)
 * log a warning and return [] so one broken variant never sinks the fan-out.
 */
export function searchYouTube(
  query: string,
  n: number,
  opts: YtSearchOpts = {},
): Promise<FlatEntry[]> {
  const spawnFn = opts.spawnFn ?? (spawn as SpawnLike);
  const ytdlpPath = opts.ytdlpPath ?? process.env.YTDLP_PATH ?? 'yt-dlp';
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const args = [`ytsearch${n}:${query}`, '--flat-playlist', '-J', '--no-warnings'];
  if (opts.cookiesFile) args.push('--cookies', opts.cookiesFile);

  return new Promise((resolve) => {
    let proc: ChildProcess;
    try {
      proc = spawnFn(ytdlpPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      logger.warn({ query, err }, 'yt-dlp search spawn failed');
      resolve([]);
      return;
    }

    let stdout = '';
    let stderrTail = '';
    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-500);
    });

    let settled = false;
    const finish = (entries: FlatEntry[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(entries);
    };

    const timer = setTimeout(() => {
      logger.warn({ query, timeoutMs }, 'yt-dlp search timed out');
      proc.kill('SIGKILL');
      finish([]);
    }, timeoutMs);
    timer.unref();

    proc.on('error', (err) => {
      logger.warn({ query, err }, 'yt-dlp search failed to run');
      finish([]);
    });
    proc.on('close', (code) => {
      if (code !== 0) {
        logger.warn({ query, code, stderrTail }, 'yt-dlp search exited non-zero');
        finish([]);
        return;
      }
      finish(parseEntries(query, stdout));
    });
  });
}

function parseEntries(query: string, stdout: string): FlatEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    logger.warn({ query, err }, 'yt-dlp search produced unparseable JSON');
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const entries = (parsed as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return [];
  return entries.filter(
    (e): e is FlatEntry =>
      typeof e === 'object' &&
      e !== null &&
      typeof (e as FlatEntry).id === 'string' &&
      typeof (e as FlatEntry).title === 'string',
  );
}
