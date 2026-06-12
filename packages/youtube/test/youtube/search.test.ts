import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { searchYouTube, type SpawnLike } from '../../src/youtube/search.js';

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

const spawner = () => {
  const calls: SpawnCall[] = [];
  const spawnFn: SpawnLike = (cmd, args) => {
    const proc = new FakeProc();
    calls.push({ cmd, args: [...args], proc });
    return proc as never;
  };
  return { calls, spawnFn };
};

const resultJson = JSON.stringify({
  entries: [
    { id: 'abc', title: 'Some Episode', channel: 'Chan', duration: 3000, view_count: 5 },
    { id: 'def', title: 'Another', channel: null, duration: null },
    { title: 'missing id — dropped' },
    'not an object',
  ],
});

describe('searchYouTube', () => {
  it('spawns yt-dlp with the ytsearchN pseudo-URL and flat-playlist JSON flags', async () => {
    const { calls, spawnFn } = spawner();
    const promise = searchYouTube('Rumpole of the Bailey S01E02', 20, { spawnFn });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toContain('ytsearch20:Rumpole of the Bailey S01E02');
    expect(calls[0]!.args).toContain('--flat-playlist');
    expect(calls[0]!.args).toContain('-J');
    calls[0]!.proc.stdout.emit('data', Buffer.from(resultJson));
    calls[0]!.proc.emit('close', 0);
    await promise;
  });

  it('passes a cookies file when configured', async () => {
    const { calls, spawnFn } = spawner();
    const promise = searchYouTube('q', 5, { spawnFn, cookiesFile: '/config/cookies.txt' });

    expect(calls[0]!.args).toContain('--cookies');
    expect(calls[0]!.args).toContain('/config/cookies.txt');
    calls[0]!.proc.emit('close', 1);
    await promise;
  });

  it('parses entries, keeping only objects with id and title', async () => {
    const { calls, spawnFn } = spawner();
    const promise = searchYouTube('q', 5, { spawnFn });

    calls[0]!.proc.stdout.emit('data', Buffer.from(resultJson));
    calls[0]!.proc.emit('close', 0);

    const entries = await promise;
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ id: 'abc', title: 'Some Episode', duration: 3000 });
  });

  it('handles chunked stdout', async () => {
    const { calls, spawnFn } = spawner();
    const promise = searchYouTube('q', 5, { spawnFn });

    const half = Math.floor(resultJson.length / 2);
    calls[0]!.proc.stdout.emit('data', Buffer.from(resultJson.slice(0, half)));
    calls[0]!.proc.stdout.emit('data', Buffer.from(resultJson.slice(half)));
    calls[0]!.proc.emit('close', 0);

    expect(await promise).toHaveLength(2);
  });

  it('returns [] when yt-dlp exits non-zero', async () => {
    const { calls, spawnFn } = spawner();
    const promise = searchYouTube('q', 5, { spawnFn });

    calls[0]!.proc.stderr.emit('data', Buffer.from('ERROR: nope'));
    calls[0]!.proc.emit('close', 1);

    expect(await promise).toEqual([]);
  });

  it('returns [] on unparseable JSON', async () => {
    const { calls, spawnFn } = spawner();
    const promise = searchYouTube('q', 5, { spawnFn });

    calls[0]!.proc.stdout.emit('data', Buffer.from('not json at all'));
    calls[0]!.proc.emit('close', 0);

    expect(await promise).toEqual([]);
  });

  it('returns [] when spawning fails', async () => {
    const spawnFn: SpawnLike = () => {
      throw new Error('yt-dlp not found');
    };
    expect(await searchYouTube('q', 5, { spawnFn })).toEqual([]);
  });

  it('kills the process and returns [] on timeout', async () => {
    const { calls, spawnFn } = spawner();
    const promise = searchYouTube('q', 5, { spawnFn, timeoutMs: 20 });

    // never emit close — the timeout must settle the promise
    expect(await promise).toEqual([]);
    expect(calls[0]!.proc.killed).toBe(true);
  });
});
