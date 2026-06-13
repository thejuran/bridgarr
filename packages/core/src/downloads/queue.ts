import crypto from 'node:crypto';
import type { NzbPayload } from '../nzb.js';

export type JobStatus = 'queued' | 'downloading' | 'completed' | 'failed';

export interface DownloadJob {
  /** SAB-style id, stable across queue → history (Sonarr tracks it). */
  nzoId: string;
  payload: NzbPayload;
  /** SABnzbd category the job was submitted under. */
  category: string;
  status: JobStatus;
  totalBytes: number | null;
  downloadedBytes: number;
  /** Absolute path of the finished file; null unless completed. */
  storagePath: string | null;
  failMessage: string | null;
  addedAt: number;
  startedAt: number | null;
  completedAt: number | null;
}

/**
 * In-memory job registry shared by the SABnzbd emulation (reads) and the
 * download runner (writes). History is kept for the process lifetime —
 * Sonarr expects retention, and jobs are cheap.
 */
export class DownloadQueue {
  private readonly jobs = new Map<string, DownloadJob>();

  add(payload: NzbPayload, category: string): DownloadJob {
    const job: DownloadJob = {
      nzoId: `SABnzbd_nzo_${crypto.randomUUID()}`,
      payload,
      category,
      status: 'queued',
      totalBytes: null,
      downloadedBytes: 0,
      storagePath: null,
      failMessage: null,
      addedAt: Date.now(),
      startedAt: null,
      completedAt: null,
    };
    this.jobs.set(job.nzoId, job);
    return job;
  }

  get(nzoId: string): DownloadJob | undefined {
    return this.jobs.get(nzoId);
  }

  /** Queued + downloading jobs, oldest first. */
  activeJobs(): DownloadJob[] {
    return [...this.jobs.values()].filter(
      (j) => j.status === 'queued' || j.status === 'downloading',
    );
  }

  /** Completed + failed jobs, most recent first. */
  historyJobs(): DownloadJob[] {
    return [...this.jobs.values()]
      .filter((j) => j.status === 'completed' || j.status === 'failed')
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  }

  remove(nzoId: string): boolean {
    return this.jobs.delete(nzoId);
  }

  /** Oldest job still waiting to start, if any. */
  nextQueued(): DownloadJob | undefined {
    return this.activeJobs().find((j) => j.status === 'queued');
  }

  markStarted(nzoId: string): void {
    const job = this.jobs.get(nzoId);
    if (!job) return;
    job.status = 'downloading';
    job.startedAt = Date.now();
  }

  setProgress(nzoId: string, downloadedBytes: number, totalBytes?: number): void {
    const job = this.jobs.get(nzoId);
    if (!job) return;
    job.downloadedBytes = downloadedBytes;
    if (totalBytes !== undefined) job.totalBytes = totalBytes;
  }

  markCompleted(nzoId: string, storagePath: string, bytes: number): void {
    const job = this.jobs.get(nzoId);
    if (!job) return;
    job.status = 'completed';
    job.storagePath = storagePath;
    job.totalBytes = bytes;
    job.downloadedBytes = bytes;
    job.completedAt = Date.now();
  }

  markFailed(nzoId: string, message: string): void {
    const job = this.jobs.get(nzoId);
    if (!job) return;
    job.status = 'failed';
    job.failMessage = message;
    job.completedAt = Date.now();
  }
}
