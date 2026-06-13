import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '../config.js';
import { logger } from '../logger.js';
import type { DownloadJob, DownloadQueue } from '@bridgarr/core';

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

  /** Resolve once all in-flight finalizations have settled (for tests/shutdown). */
  async idle(): Promise<void> {
    while (this.pending.length > 0) {
      await Promise.all(this.pending.splice(0));
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
      fs.mkdirSync(jobDir, { recursive: true });
      proc = this.spawnFn(this.ytdlpPath, this.buildArgs(job, jobDir), {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      this.settle(nzoId, () => this.failJob(job, jobDir, message(err)));
      return;
    }

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
    args.push('-o', path.join(jobDir, `${job.payload.title}.%(ext)s`));
    args.push(job.payload.pageUrl);
    return args;
  }

  private async completeJob(job: DownloadJob, jobDir: string): Promise<void> {
    // Job deleted mid-download → discard the output silently.
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
    await move(file, dest);
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
