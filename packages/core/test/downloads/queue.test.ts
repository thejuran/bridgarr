import { describe, expect, it } from 'vitest';
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
});
