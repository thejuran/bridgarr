import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, updateSettings, type Config } from '../../src/config.js';
import { DownloadQueue, type NzbPayload } from '@bridgarr/core';
import { DownloadRunner, type SpawnLike } from '../../src/downloads/runner.js';

class FakeProc extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  kill() {
    this.killed = true;
    return true;
  }
}

interface SpawnCall {
  cmd: string;
  args: string[];
  proc: FakeProc;
}

const payload = (title: string): NzbPayload => ({
  provider: 'youtube',
  episodeId: 'dQw4w9WgXcQ',
  title,
  pageUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
});

describe('DownloadRunner', () => {
  let dataDir: string;
  let config: Config;
  let queue: DownloadQueue;
  let calls: SpawnCall[];
  let runner: DownloadRunner;

  const fakeSpawn: SpawnLike = (cmd, args) => {
    const proc = new FakeProc();
    calls.push({ cmd, args: [...args], proc });
    return proc as never;
  };

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytfortv-test-'));
    config = loadConfig({ DATA_DIR: dataDir });
    queue = new DownloadQueue();
    calls = [];
    runner = new DownloadRunner({ queue, config, spawnFn: fakeSpawn });
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  // The fake "download": drop a file where yt-dlp would have written it.
  const writeOutput = (nzoId: string, title: string): string => {
    const jobDir = path.join(config.settings.downloadDir, nzoId);
    const file = path.join(jobDir, `${title}.mp4`);
    fs.writeFileSync(file, Buffer.alloc(2048));
    return file;
  };

  it('spawns yt-dlp with the page url and job-scoped output template', () => {
    const job = queue.add(payload('Bluey.S01E01.Test.1080p.WEB-DL'), 'sonarr');
    runner.tick();

    expect(calls).toHaveLength(1);
    const { args } = calls[0]!;
    expect(args).toContain('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(args.join(' ')).toContain(path.join(job.nzoId, 'Bluey.S01E01.Test.1080p.WEB-DL'));
    expect(queue.get(job.nzoId)!.status).toBe('downloading');
  });

  it('forces progress lines despite the non-tty stdout pipe', () => {
    queue.add(payload('A'), 'sonarr');
    runner.tick();

    // yt-dlp ≥2024 suppresses progress on non-tty stdout unless --progress is
    // explicit; --newline alone is not enough (verified live 2026-06-10).
    expect(calls[0]!.args).toContain('--progress');
    expect(calls[0]!.args).toContain('--newline');
  });

  it('passes a resolution cap derived from the quality setting', () => {
    updateSettings(config, { quality: '720p' });
    queue.add(payload('A'), 'sonarr');
    runner.tick();

    const { args } = calls[0]!;
    expect(args.join(' ')).toContain('res:720');
  });

  it('passes the cookies file to yt-dlp when configured', () => {
    updateSettings(config, { cookiesFile: '/config/cookies.txt' });
    queue.add(payload('A'), 'sonarr');
    runner.tick();

    const { args } = calls[0]!;
    expect(args).toContain('--cookies');
    expect(args).toContain('/config/cookies.txt');
  });

  it('omits --cookies when no cookies file is configured', () => {
    queue.add(payload('A'), 'sonarr');
    runner.tick();

    expect(calls[0]!.args).not.toContain('--cookies');
  });

  it('tracks progress from yt-dlp output lines', () => {
    const job = queue.add(payload('A'), 'sonarr');
    runner.tick();

    calls[0]!.proc.stdout.emit(
      'data',
      Buffer.from('[download]  25.0% of ~ 100.00MiB at 1.20MiB/s ETA 01:02\n'),
    );

    const j = queue.get(job.nzoId)!;
    expect(j.totalBytes).toBe(104857600);
    expect(j.downloadedBytes).toBe(26214400);
  });

  it('moves the finished file to completeDir/<category> and completes the job', async () => {
    const title = 'Bluey.S01E01.Test.1080p.WEB-DL';
    const job = queue.add(payload(title), 'sonarr');
    runner.tick();
    writeOutput(job.nzoId, title);

    calls[0]!.proc.emit('close', 0);
    await runner.idle();

    const j = queue.get(job.nzoId)!;
    expect(j.status).toBe('completed');
    const expected = path.join(config.settings.completeDir, 'sonarr', `${title}.mp4`);
    expect(j.storagePath).toBe(expected);
    expect(fs.existsSync(expected)).toBe(true);
    expect(j.totalBytes).toBe(2048);
    // job temp dir cleaned up
    expect(fs.existsSync(path.join(config.settings.downloadDir, job.nzoId))).toBe(false);
  });

  it('marks the job failed when yt-dlp exits non-zero, keeping stderr context', async () => {
    const job = queue.add(payload('A'), 'sonarr');
    runner.tick();

    calls[0]!.proc.stderr.emit('data', Buffer.from('ERROR: This video is DRM protected\n'));
    calls[0]!.proc.emit('close', 1);
    await runner.idle();

    const j = queue.get(job.nzoId)!;
    expect(j.status).toBe('failed');
    expect(j.failMessage).toContain('DRM');
  });

  it('marks the job failed when yt-dlp produces no output file', async () => {
    const job = queue.add(payload('A'), 'sonarr');
    runner.tick();

    calls[0]!.proc.emit('close', 0);
    await runner.idle();

    expect(queue.get(job.nzoId)!.status).toBe('failed');
  });

  it('respects the concurrency limit', async () => {
    updateSettings(config, { concurrency: 1 });
    const a = queue.add(payload('A'), 'sonarr');
    queue.add(payload('B'), 'sonarr');

    runner.tick();
    expect(calls).toHaveLength(1);
    runner.tick();
    expect(calls).toHaveLength(1);

    writeOutput(a.nzoId, 'A');
    calls[0]!.proc.emit('close', 0);
    await runner.idle();

    runner.tick();
    expect(calls).toHaveLength(2);
  });

  it('survives spawn failures', async () => {
    const failingSpawn: SpawnLike = () => {
      throw new Error('yt-dlp not found');
    };
    runner = new DownloadRunner({ queue, config, spawnFn: failingSpawn });
    const job = queue.add(payload('A'), 'sonarr');

    runner.tick();
    await runner.idle();

    const j = queue.get(job.nzoId)!;
    expect(j.status).toBe('failed');
    expect(j.failMessage).toContain('yt-dlp not found');
  });

});
