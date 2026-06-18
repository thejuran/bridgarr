import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    // -o arg contains the job-scoped dir (not the title)
    expect(args.join(' ')).toContain(path.join(config.settings.downloadDir, job.nzoId));
    // -o template is the fixed %(id)s.%(ext)s form (no title in path)
    const oIdx = args.indexOf('-o');
    expect(args[oIdx + 1]).toMatch(/%\(id\)s\.%\(ext\)s$/);
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

  it('rejects a non-YouTube pageUrl and marks the job failed', async () => {
    const p = { ...payload('A'), pageUrl: 'https://evil.com/video' };
    const job = queue.add(p, 'sonarr');
    runner.tick();
    await runner.idle();

    const j = queue.get(job.nzoId)!;
    expect(j.status).toBe('failed');
    expect(j.failMessage).toContain('not allowed');
  });

  it('rejects a file:// pageUrl and marks the job failed', async () => {
    const p = { ...payload('A'), pageUrl: 'file:///etc/passwd' };
    const job = queue.add(p, 'sonarr');
    runner.tick();
    await runner.idle();

    expect(queue.get(job.nzoId)!.status).toBe('failed');
  });

  it('rejects a malformed (non-URL) pageUrl and marks the job failed', async () => {
    const p = { ...payload('A'), pageUrl: 'not-a-url' };
    const job = queue.add(p, 'sonarr');
    runner.tick();
    await runner.idle();

    expect(queue.get(job.nzoId)!.status).toBe('failed');
  });

  it('rejects file://youtube.com (allowlisted host, non-https protocol) and marks the job failed', async () => {
    const p = { ...payload('A'), pageUrl: 'file://youtube.com/etc/passwd' };
    const job = queue.add(p, 'sonarr');
    runner.tick();
    await runner.idle();

    expect(queue.get(job.nzoId)!.status).toBe('failed');
  });

  it('rejects ftp://youtube.com (allowlisted host, non-https protocol) and marks the job failed', async () => {
    const p = { ...payload('A'), pageUrl: 'ftp://youtube.com/x' };
    const job = queue.add(p, 'sonarr');
    runner.tick();
    await runner.idle();

    expect(queue.get(job.nzoId)!.status).toBe('failed');
  });

  it('rejects a pageUrl with embedded credentials and marks the job failed', async () => {
    const p = { ...payload('A'), pageUrl: 'https://user:pass@youtube.com/watch?v=abc' };
    const job = queue.add(p, 'sonarr');
    runner.tick();
    await runner.idle();

    const j = queue.get(job.nzoId)!;
    expect(j.status).toBe('failed');
    expect(j.failMessage).toContain('credentials');
  });

  it('accepts a www.youtu.be pageUrl (www-strip parity for every allowed host)', () => {
    const p = { ...payload('B'), pageUrl: 'https://www.youtu.be/abc' };
    const job = queue.add(p, 'sonarr');
    runner.tick();

    // Guard accepted the URL — spawn was called and the job is now downloading
    expect(queue.get(job.nzoId)!.status).toBe('downloading');
  });

  // ─── REL-01: delete-kill + slot-free + immediate re-schedule ───────────────

  it('(a) delete-while-queued: sends no SIGTERM and does not over-start', () => {
    updateSettings(config, { concurrency: 1 });
    queue.setOnRemove((id) => runner.onRemove(id));
    queue.add(payload('A'), 'sonarr');
    const b = queue.add(payload('B'), 'sonarr');

    runner.tick();
    expect(calls).toHaveLength(1); // only A running

    queue.remove(b.nzoId); // B was still queued, no proc
    expect(calls[0]!.proc.killed).toBe(false); // no SIGTERM sent to A
    expect(queue.get(calls[0]!.args[calls[0]!.args.length - 1]!)).toBeUndefined(); // B gone

    // A subsequent tick must not start a phantom extra job (B is gone)
    runner.tick();
    expect(calls).toHaveLength(1);
  });

  it('(b) IMMEDIATE re-schedule on delete-mid-download — no manual tick needed', () => {
    updateSettings(config, { concurrency: 1 });
    queue.setOnRemove((id) => runner.onRemove(id));
    const a = queue.add(payload('A'), 'sonarr');
    queue.add(payload('B'), 'sonarr');

    runner.tick();
    expect(calls).toHaveLength(1); // A running

    // Remove A — fires onRemove synchronously → SIGTERM + free slot + tick()
    queue.remove(a.nzoId);

    // BLOCKER assertion: B launched as a DIRECT consequence of the delete
    // NO manual runner.tick() between queue.remove and this assertion
    expect(calls[0]!.proc.killed).toBe(true);  // SIGTERM sent to A
    expect(calls).toHaveLength(2);             // B started immediately
  });

  it('(b-exactly-once) no double-free / phantom 3rd job after killed proc closes', async () => {
    updateSettings(config, { concurrency: 1 });
    queue.setOnRemove((id) => runner.onRemove(id));
    const a = queue.add(payload('A'), 'sonarr');
    queue.add(payload('B'), 'sonarr');

    runner.tick();
    queue.remove(a.nzoId); // B launched immediately
    expect(calls).toHaveLength(2);

    // A's proc emits 'close' — settle().finally runs (once/settled guard), tick() called again
    calls[0]!.proc.emit('close', null);
    await runner.idle();
    runner.tick();
    // B already occupies the slot, A is gone from running → NO phantom 3rd job
    expect(calls).toHaveLength(2);
  });

  it('(c) delete DURING the move — post-move re-check deletes dest file, no markCompleted', async () => {
    updateSettings(config, { concurrency: 1 });
    queue.setOnRemove((id) => runner.onRemove(id));
    const a = queue.add(payload('A'), 'sonarr');

    runner.tick();
    writeOutput(a.nzoId, 'A');

    // Spy on fsp.rename so the delete fires DURING the move (after the file is
    // written to dest by the real rename, but before move() resolves)
    const realRename = fsp.rename.bind(fsp);
    const renameSpy = vi.spyOn(fsp, 'rename').mockImplementation(async (src, dest) => {
      // Perform the real rename first — file now exists at dest
      await realRename(src as string, dest as string);
      // Now fire the delete mid-move (pre-move re-check already passed)
      queue.remove(a.nzoId);
      // move() resolves after this → post-move re-check must detect deletion and clean up
    });

    calls[0]!.proc.emit('close', 0);
    await runner.idle();

    renameSpy.mockRestore();

    const destFile = path.join(config.settings.completeDir, 'sonarr', 'A.mp4');
    // The post-move re-check must have deleted the moved file
    expect(fs.existsSync(destFile)).toBe(false);
    // jobDir also removed
    expect(fs.existsSync(path.join(config.settings.downloadDir, a.nzoId))).toBe(false);
    // job not marked completed
    expect(queue.get(a.nzoId)).toBeUndefined(); // was removed by queue.remove
    // no phantom job
    runner.tick();
    expect(calls).toHaveLength(1);
  });

  it('(c3) delete DURING the post-move stat — final re-check deletes dest, no markCompleted', async () => {
    // Closes the residual stat-window TOCTOU: a delete landing while fsp.stat(dest)
    // is in flight must still be caught by the re-check that now sits AFTER the stat
    // and immediately before markCompleted (no await between them).
    updateSettings(config, { concurrency: 1 });
    queue.setOnRemove((id) => runner.onRemove(id));
    const a = queue.add(payload('A'), 'sonarr');

    runner.tick();
    writeOutput(a.nzoId, 'A');

    // Spy on fsp.stat so the delete fires DURING the post-move stat ONLY — i.e.
    // the stat on the dest path inside completeDir, NOT the earlier pickOutput
    // stats on the jobDir (which would land in the pre-move window instead and
    // make this a vacuous test). Scope by checking the stat'd path is under
    // completeDir, so the delete reproduces the exact stat-window TOCTOU.
    const realStat = fsp.stat.bind(fsp);
    const destRoot = config.settings.completeDir;
    const statSpy = vi.spyOn(fsp, 'stat').mockImplementation(async (p) => {
      const result = await realStat(p as string);
      if (typeof p === 'string' && p.startsWith(destRoot)) {
        // We are inside the post-move stat(dest) await — fire the delete here.
        queue.remove(a.nzoId);
      }
      return result;
    });

    calls[0]!.proc.emit('close', 0);
    await runner.idle();

    statSpy.mockRestore();

    const destFile = path.join(config.settings.completeDir, 'sonarr', 'A.mp4');
    // The final re-check (after stat) must have deleted the moved file
    expect(fs.existsSync(destFile)).toBe(false);
    // jobDir also removed
    expect(fs.existsSync(path.join(config.settings.downloadDir, a.nzoId))).toBe(false);
    // job was removed; never marked completed
    expect(queue.get(a.nzoId)).toBeUndefined();
    // no phantom job
    runner.tick();
    expect(calls).toHaveLength(1);
  });

  it('(c2) delete between entry check and move — pre-move re-check discards cleanly', async () => {
    updateSettings(config, { concurrency: 1 });
    queue.setOnRemove((id) => runner.onRemove(id));
    const a = queue.add(payload('A'), 'sonarr');

    runner.tick();
    writeOutput(a.nzoId, 'A');

    // Emit close then synchronously remove the job BEFORE await runner.idle()
    // The pre-move re-check (between pickOutput and the rename) discards it
    calls[0]!.proc.emit('close', 0);
    queue.remove(a.nzoId); // lands before completeJob's pre-move check

    await runner.idle();

    const destFile = path.join(config.settings.completeDir, 'sonarr', 'A.mp4');
    expect(fs.existsSync(destFile)).toBe(false); // pre-move re-check prevented move
    expect(fs.existsSync(path.join(config.settings.downloadDir, a.nzoId))).toBe(false);
  });

  it('(HIGH #2) proc untracked on exit event — no kill attempted in exit→close gap', async () => {
    updateSettings(config, { concurrency: 1 });
    queue.setOnRemove((id) => runner.onRemove(id));
    const a = queue.add(payload('A'), 'sonarr');

    runner.tick();

    // OS process exits (stdio not yet flushed, 'close' not yet emitted)
    calls[0]!.proc.emit('exit', 0, null);

    // Delete lands in the exit→close window — proc should be untracked already
    queue.remove(a.nzoId);
    expect(calls[0]!.proc.killed).toBe(false); // NO kill attempted

    // onRemove must not have thrown
    // 'close' still drives finalization (settle timing unchanged)
    writeOutput(a.nzoId, 'A'); // put the file back so completeJob can complete
    // re-add job so completeJob doesn't just discard (queue was cleared by remove)
    // Actually — job was removed, so completeJob's entry guard discards it. That's fine.
    calls[0]!.proc.emit('close', 0);
    await runner.idle(); // finalization ran (job fails or discards — no crash)
  });

  it('guarded SIGTERM no-throw — kill throws but onRemove does not throw', () => {
    updateSettings(config, { concurrency: 1 });
    queue.setOnRemove((id) => runner.onRemove(id));
    const a = queue.add(payload('A'), 'sonarr');

    runner.tick();

    // Override kill to throw, simulating ESRCH or race
    calls[0]!.proc.kill = () => { throw new Error('ESRCH'); };

    // queue.remove (→ onRemove) must NOT throw even though kill throws
    expect(() => queue.remove(a.nzoId)).not.toThrow();
  });

  it('pending[] self-evicts to 0 after multiple complete/fail cycles', async () => {
    updateSettings(config, { concurrency: 3 });
    // cycle 1: complete
    const j1 = queue.add(payload('J1'), 'sonarr');
    runner.tick();
    writeOutput(j1.nzoId, 'J1');
    calls[0]!.proc.emit('close', 0);

    // cycle 2: fail (no output)
    const j2 = queue.add(payload('J2'), 'sonarr');
    runner.tick();
    calls[1]!.proc.emit('close', 1);

    // cycle 3: fail (no output)
    const j3 = queue.add(payload('J3'), 'sonarr');
    runner.tick();
    calls[2]!.proc.emit('close', 1);
    void j3;

    await runner.idle();

    // After all cycles settle, pending must be 0
    expect((runner as unknown as { pending: Promise<void>[] }).pending.length).toBe(0);
  });

  // ─── REL-02: sweepOrphans ─────────────────────────────────────────────────

  it('sweepOrphans removes orphaned dirs and leaves dirs matching active jobs', async () => {
    // Create an orphan dir (no matching job in queue)
    const orphanDir = path.join(config.settings.downloadDir, 'orphan-dir-no-job');
    fs.mkdirSync(orphanDir, { recursive: true });

    // Create a dir matching an active queued job
    const activeJob = queue.add(payload('ActiveJob'), 'sonarr');
    const activeDir = path.join(config.settings.downloadDir, activeJob.nzoId);
    fs.mkdirSync(activeDir, { recursive: true });

    await runner.sweepOrphans();

    expect(fs.existsSync(orphanDir)).toBe(false);    // orphan removed
    expect(fs.existsSync(activeDir)).toBe(true);     // active-job dir preserved
  });

  it('sweepOrphans resolves without throwing when fsp.rm rejects', async () => {
    // Create a dir to sweep
    const orphanDir = path.join(config.settings.downloadDir, 'orphan-2');
    fs.mkdirSync(orphanDir, { recursive: true });

    // Force fsp.rm to reject
    const rmSpy = vi.spyOn(fsp, 'rm').mockRejectedValue(new Error('EPERM'));

    // sweepOrphans must NOT reject even if rm fails
    await expect(runner.sweepOrphans()).resolves.toBeUndefined();

    rmSpy.mockRestore();
  });

  it('sweepOrphans resolves without throwing when downloadDir does not exist', async () => {
    // Point downloadDir to a non-existent path
    updateSettings(config, { downloadDir: path.join(dataDir, 'nonexistent') });
    const freshRunner = new DownloadRunner({ queue, config, spawnFn: fakeSpawn });

    await expect(freshRunner.sweepOrphans()).resolves.toBeUndefined();
  });

});
