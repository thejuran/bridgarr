import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '../config.js';
import { logger } from '../logger.js';
import { assertAllowedUrl, type DownloadJob, type DownloadQueue } from '@bridgarr/core';

export type SpawnLike = (
  cmd: string,
  args: string[],
  opts: { stdio: ['ignore', 'pipe', 'pipe'] },
) => ChildProcess;

export interface RunnerDeps {
  queue: DownloadQueue;
  config: Config;
  spawnFn?: SpawnLike;
  /** yt-dlp binary path; defaults to YTDLP_PATH or `yt-dlp` on PATH. */
  ytdlpPath?: string;
}

const PROGRESS_RE = /\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+)(KiB|MiB|GiB|B)/;
const UNIT_BYTES: Record<string, number> = {
  B: 1,
  KiB: 1024,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
};

/**
 * Validates that pageUrl is a YouTube URL with https: protocol.
 * Delegates to assertAllowedUrl (core) which also rejects embedded credentials.
 */
function assertYouTubeUrl(url: string): void {
  assertAllowedUrl(url, { protocols: ['https:'], hosts: ['youtube.com', 'youtu.be'] });
}

/**
 * Drives queued jobs through yt-dlp: spawn with a job-scoped temp dir, parse
 * progress lines, move the finished file to completeDir/<category>, and record
 * the outcome on the queue. Extractor failures surface as failed history
 * entries, never crashes.
 */
export class DownloadRunner {
  private readonly queue: DownloadQueue;
  private readonly config: Config;
  private readonly spawnFn: SpawnLike;
  private readonly ytdlpPath: string;

  private readonly running = new Set<string>();
  /** Tracks live ChildProcess per nzoId. Untracked on the FIRST of exit/close/error. */
  private readonly procByNzoId = new Map<string, ChildProcess>();
  private pending: Promise<void>[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(deps: RunnerDeps) {
    this.queue = deps.queue;
    this.config = deps.config;
    this.spawnFn = deps.spawnFn ?? (spawn as SpawnLike);
    this.ytdlpPath = deps.ytdlpPath ?? process.env.YTDLP_PATH ?? 'yt-dlp';
  }

  start(intervalMs = 1000): void {
    this.timer = setInterval(() => this.tick(), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Start queued jobs up to the concurrency limit. */
  tick(): void {
    while (this.running.size < this.config.settings.concurrency) {
      const job = this.queue.nextQueued();
      if (!job) break;
      this.launch(job);
    }
  }

  /**
   * Handle a job removal fired synchronously by DownloadQueue.remove().
   * Frees the concurrency slot, sends a guarded SIGTERM to the live process
   * (if any), and immediately schedules the next queued job via tick().
   *
   * This is the BLOCKER fix for REL-01: without this call, the next queued job
   * waits up to ~1s for the interval to fire. With it, the next job starts as
   * a direct consequence of the delete.
   */
  onRemove(nzoId: string): void {
    // (1) Free the slot immediately. Set.delete of an absent key is a no-op —
    //     safe against the case where the job was never in running (queued-only).
    this.running.delete(nzoId);

    // (2) SIGTERM the live process, guarded. Map membership is the liveness
    //     signal (NOT proc.killed): we untrack on the FIRST of exit/close/error,
    //     so if the proc is still in the map it has not yet exited.
    const proc = this.procByNzoId.get(nzoId);
    if (proc) {
      try {
        proc.kill('SIGTERM');
      } catch (err) {
        logger.warn({ nzoId, err }, 'SIGTERM on already-exited child');
      }
      this.procByNzoId.delete(nzoId);
    }

    // (3) Schedule the next queued job NOW. This is the core of the BLOCKER fix.
    this.tick();
  }

  /**
   * Sweep orphaned download temp dirs: any <downloadDir>/<name> directory that
   * has no matching active job in the queue is removed. Called at boot before
   * runner.start() so leftover dirs from a crashed/restarted process are cleaned
   * up. Errors are logged but never thrown — a failed sweep must not block
   * startup.
   */
  async sweepOrphans(): Promise<void> {
    try {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(this.config.settings.downloadDir, { withFileTypes: true });
      } catch {
        // downloadDir doesn't exist yet or isn't readable — nothing to sweep
        return;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        // Never follow symlinks — only remove plain directories
        if (!this.queue.get(entry.name)) {
          const dir = path.join(this.config.settings.downloadDir, entry.name);
          await fsp.rm(dir, { recursive: true, force: true });
        }
      }
    } catch (err) {
      logger.warn({ err }, 'orphan sweep failed');
    }
  }

  /** Resolve once all in-flight finalizations have settled (for tests/shutdown). */
  async idle(): Promise<void> {
    while (this.pending.length > 0) {
      // Await a snapshot of the current in-flight promises so self-eviction
      // racing idle()'s loop cannot strand a promise (REL-03).
      await Promise.all([...this.pending]);
    }
  }

  private launch(job: DownloadJob): void {
    const { nzoId } = job;
    this.queue.markStarted(nzoId);
    this.running.add(nzoId);
    const jobDir = path.join(this.config.settings.downloadDir, nzoId);
    this.spawnJob(job, jobDir);
  }

  private spawnJob(job: DownloadJob, jobDir: string): void {
    const { nzoId } = job;
    let proc: ChildProcess;
    try {
      assertYouTubeUrl(job.payload.pageUrl);
      fs.mkdirSync(jobDir, { recursive: true });
      proc = this.spawnFn(this.ytdlpPath, this.buildArgs(job, jobDir), {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      this.settle(nzoId, () => this.failJob(job, jobDir, message(err)));
      return;
    }

    // Track the proc immediately. Untrack on the FIRST of exit/close/error
    // (HIGH #2 fix): Node emits 'exit' before 'close', so untracking only on
    // close/error leaves the proc tracked across the exit→close gap during
    // which the PID may be reused.
    this.procByNzoId.set(nzoId, proc);
    proc.on('exit', () => {
      this.procByNzoId.delete(nzoId);
    });

    logger.info({ nzoId, title: job.payload.title, url: job.payload.pageUrl }, 'download started');

    let stderrTail = '';
    proc.stdout?.on('data', (chunk: Buffer) => {
      const match = chunk.toString().match(PROGRESS_RE);
      if (!match) return;
      const [, pct, size, unit] = match;
      const total = Math.round(Number(size) * UNIT_BYTES[unit!]!);
      this.queue.setProgress(nzoId, Math.round((Number(pct) / 100) * total), total);
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-1000);
    });

    let settled = false;
    const once = (fn: () => Promise<void>) => {
      if (settled) return;
      settled = true;
      // Also untrack here (first of close/error fires after exit untracked it,
      // Map.delete of an absent key is a no-op — idempotent).
      this.procByNzoId.delete(nzoId);
      this.settle(nzoId, fn);
    };
    proc.on('error', (err) => once(() => this.failJob(job, jobDir, message(err))));
    proc.on('close', (code) =>
      once(() =>
        code === 0
          ? this.completeJob(job, jobDir)
          : this.failJob(job, jobDir, failureMessage(stderrTail, code)),
      ),
    );
  }

  private settle(nzoId: string, fn: () => Promise<void>): void {
    const done = fn()
      .catch((err) => {
        logger.error({ nzoId, err }, 'download finalization failed');
        this.queue.markFailed(nzoId, message(err));
      })
      .finally(() => {
        this.running.delete(nzoId);
        this.tick();
        // REL-03: self-evict this settled promise from pending[] by identity
        const i = this.pending.indexOf(done);
        if (i !== -1) this.pending.splice(i, 1);
      });
    this.pending.push(done);
  }

  private buildArgs(job: DownloadJob, jobDir: string): string[] {
    // --progress: yt-dlp suppresses progress on non-tty stdout without it;
    // --newline turns the bar into parseable one-per-update lines.
    const args = ['--progress', '--newline', '--no-colors', '--no-playlist'];
    const { quality, cookiesFile } = this.config.settings;
    if (quality !== 'best') args.push('-S', `res:${quality.replace('p', '')}`);
    if (cookiesFile) args.push('--cookies', cookiesFile);
    args.push('-o', path.join(jobDir, '%(id)s.%(ext)s'));
    args.push(job.payload.pageUrl);
    return args;
  }

  private async completeJob(job: DownloadJob, jobDir: string): Promise<void> {
    // ENTRY guard: job deleted mid-download → discard the output silently.
    if (!this.queue.get(job.nzoId)) {
      await fsp.rm(jobDir, { recursive: true, force: true });
      return;
    }
    const file = await pickOutput(jobDir);
    if (!file) {
      await this.failJob(job, jobDir, 'yt-dlp produced no output file');
      return;
    }
    const destDir = path.join(this.config.settings.completeDir, job.category);
    await fsp.mkdir(destDir, { recursive: true });
    const dest = path.join(destDir, path.basename(file));

    // PRE-MOVE re-check (HIGH #1 fix — close the cheap window): if the job was
    // deleted between the entry check and here, discard before any write to
    // completeDir.
    if (!this.queue.get(job.nzoId)) {
      await fsp.rm(jobDir, { recursive: true, force: true });
      return;
    }

    await move(file, dest);

    // POST-MOVE re-check (HIGH #1 fix — close the residual TOCTOU window): if
    // the job was deleted WHILE the move was in flight, the file already exists
    // at dest (rename completed / EXDEV copyFile completed) — delete it and the
    // jobDir, and do NOT markCompleted.
    if (!this.queue.get(job.nzoId)) {
      await fsp.rm(dest, { force: true });
      await fsp.rm(jobDir, { recursive: true, force: true });
      return;
    }

    const { size } = await fsp.stat(dest);
    this.queue.markCompleted(job.nzoId, dest, size);
    await fsp.rm(jobDir, { recursive: true, force: true });
    logger.info({ nzoId: job.nzoId, dest, size }, 'download completed');
  }

  private async failJob(job: DownloadJob, jobDir: string, reason: string): Promise<void> {
    this.queue.markFailed(job.nzoId, reason);
    await fsp.rm(jobDir, { recursive: true, force: true });
    logger.warn({ nzoId: job.nzoId, reason }, 'download failed');
  }
}

/** Largest non-partial file in the job dir — yt-dlp's finished output. */
async function pickOutput(jobDir: string): Promise<string | null> {
  let names: string[];
  try {
    names = await fsp.readdir(jobDir);
  } catch {
    return null;
  }
  let best: { file: string; size: number } | null = null;
  for (const name of names) {
    if (name.endsWith('.part') || name.endsWith('.ytdl')) continue;
    const file = path.join(jobDir, name);
    const stat = await fsp.stat(file);
    if (stat.isFile() && (!best || stat.size > best.size)) best = { file, size: stat.size };
  }
  return best?.file ?? null;
}

async function move(src: string, dest: string): Promise<void> {
  try {
    await fsp.rename(src, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    await fsp.copyFile(src, dest);
    await fsp.unlink(src);
  }
}

function failureMessage(stderrTail: string, code: number | null): string {
  const lines = stderrTail.split('\n').map((l) => l.trim()).filter(Boolean);
  const error = lines.reverse().find((l) => l.startsWith('ERROR:')) ?? lines[0];
  return (error ?? `yt-dlp exited with code ${code}`).slice(0, 300);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
