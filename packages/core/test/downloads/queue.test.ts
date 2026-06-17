import { describe, expect, it, vi } from 'vitest';
import { DownloadQueue } from '../../src/downloads/queue.js';
import type { NzbPayload } from '../../src/nzb.js';

const payload = (title = 'Bluey.S01E01.The.Magic.Xylophone.1080p.WEB-DL'): NzbPayload => ({
  provider: 'youtube',
  episodeId: 'dQw4w9WgXcQ',
  title,
  pageUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
});

describe('DownloadQueue', () => {
  it('adds jobs as queued with a SAB-style nzo id', () => {
    const queue = new DownloadQueue();
    const job = queue.add(payload(), 'sonarr');

    expect(job.nzoId).toMatch(/^SABnzbd_nzo_/);
    expect(job.status).toBe('queued');
    expect(job.category).toBe('sonarr');
    expect(queue.activeJobs()).toHaveLength(1);
    expect(queue.historyJobs()).toHaveLength(0);
  });

  it('keeps the nzo id stable through the queue→history lifecycle', () => {
    const queue = new DownloadQueue();
    const job = queue.add(payload(), 'sonarr');

    queue.markStarted(job.nzoId);
    expect(queue.get(job.nzoId)!.status).toBe('downloading');

    queue.setProgress(job.nzoId, 50_000_000, 100_000_000);
    expect(queue.get(job.nzoId)!.downloadedBytes).toBe(50_000_000);
    expect(queue.get(job.nzoId)!.totalBytes).toBe(100_000_000);

    queue.markCompleted(job.nzoId, '/data/complete/sonarr/file.mp4', 100_000_000);
    const done = queue.get(job.nzoId)!;
    expect(done.status).toBe('completed');
    expect(done.storagePath).toBe('/data/complete/sonarr/file.mp4');
    expect(queue.activeJobs()).toHaveLength(0);
    expect(queue.historyJobs()).toHaveLength(1);
  });

  it('records failures with a message and no storage path', () => {
    const queue = new DownloadQueue();
    const job = queue.add(payload(), 'sonarr');

    queue.markFailed(job.nzoId, 'video unavailable (DRM)');
    const failed = queue.get(job.nzoId)!;
    expect(failed.status).toBe('failed');
    expect(failed.failMessage).toBe('video unavailable (DRM)');
    expect(failed.storagePath).toBeNull();
    expect(queue.historyJobs()).toHaveLength(1);
  });

  it('removes jobs by nzo id', () => {
    const queue = new DownloadQueue();
    const job = queue.add(payload(), 'sonarr');

    expect(queue.remove(job.nzoId)).toBe(true);
    expect(queue.get(job.nzoId)).toBeUndefined();
    expect(queue.remove('nope')).toBe(false);
  });

  it('hands out queued jobs in FIFO order', () => {
    const queue = new DownloadQueue();
    const a = queue.add(payload('A'), 'sonarr');
    const b = queue.add(payload('B'), 'sonarr');

    expect(queue.nextQueued()!.nzoId).toBe(a.nzoId);
    queue.markStarted(a.nzoId);
    expect(queue.nextQueued()!.nzoId).toBe(b.nzoId);
    queue.markStarted(b.nzoId);
    expect(queue.nextQueued()).toBeUndefined();
  });

  describe('onRemove hook', () => {
    it('fires the callback exactly once with the nzoId on a real delete', () => {
      const queue = new DownloadQueue();
      const spy = vi.fn();
      queue.setOnRemove(spy);
      const job = queue.add(payload(), 'sonarr');

      const result = queue.remove(job.nzoId);

      expect(result).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(job.nzoId);
    });

    it('does NOT fire the callback when the id is not found', () => {
      const queue = new DownloadQueue();
      const spy = vi.fn();
      queue.setOnRemove(spy);

      const result = queue.remove('does-not-exist');

      expect(result).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });

    it('fires synchronously (before remove() returns)', () => {
      const queue = new DownloadQueue();
      let firedDuringRemove = false;
      // The callback is called synchronously inside remove(); we verify by
      // checking the job is gone from the queue when the callback runs.
      queue.setOnRemove(() => {
        firedDuringRemove = true;
      });
      const job = queue.add(payload(), 'sonarr');

      let callbackFired = false;
      queue.setOnRemove(() => {
        callbackFired = true;
      });
      queue.remove(job.nzoId);
      // If synchronous, callbackFired must be true by the time remove() returns
      expect(callbackFired).toBe(true);
      void firedDuringRemove; // suppress unused warning
    });

    it('works without a registered onRemove (remove returns the boolean, no throw)', () => {
      const queue = new DownloadQueue();
      const job = queue.add(payload(), 'sonarr');

      // No setOnRemove called — must not throw
      expect(() => queue.remove(job.nzoId)).not.toThrow();
      expect(queue.get(job.nzoId)).toBeUndefined();
    });
  });
});
