import type { Request, Response } from 'express';
import type { DownloadJob, DownloadQueue } from '../downloads/queue.js';
import { parseNzb } from '../nzb.js';

/** Minimal uploaded-file shape that multer (and test stubs) satisfy. */
interface UploadedFile {
  buffer: Buffer;
  originalname: string;
}

/**
 * Minimal settings shape the SABnzbd router needs from the host app.
 * The bridge supplies apiKey, completeDir, and metaType — core encodes
 * no bridge-specific knowledge.
 */
export interface SabSettings {
  /** API key checked against every incoming SABnzbd request. */
  apiKey: string;
  /** Absolute path reported as SABnzbd complete_dir. */
  completeDir: string;
  /** Bridge identifier injected into NZB parsing (e.g. the bridge name string). */
  metaType: string;
}

/**
 * Optional injectable logger. When omitted, a no-op fallback is used.
 * Satisfied structurally by pino loggers.
 */
export interface SabLogger {
  warn(obj: object, msg: string): void;
  info(obj: object, msg: string): void;
}

/** Context passed to handleSab by the host app. */
export interface SabContext {
  settings: SabSettings;
  queue: DownloadQueue;
  logger?: SabLogger;
}

const VERSION = '4.3.0';
const CATEGORIES = ['*', 'sonarr', 'radarr', 'tv', 'movies'];

export function handleSab(ctx: SabContext, req: Request, res: Response): void {
  if (param(req, 'apikey') !== ctx.settings.apiKey) {
    res.json({ status: false, error: 'API Key Incorrect' });
    return;
  }

  switch (param(req, 'mode')) {
    case 'version':
      res.json({ version: VERSION });
      return;
    case 'get_config':
      res.json({
        config: {
          misc: {
            complete_dir: ctx.settings.completeDir,
            history_retention: 'all',
          },
          categories: CATEGORIES.map((name, order) => ({
            name,
            order,
            dir: '',
            pp: '',
            script: 'None',
            newzbin: '',
            priority: 0,
          })),
        },
      });
      return;
    case 'queue':
      handleQueue(ctx, req, res);
      return;
    case 'history':
      handleHistory(ctx, req, res);
      return;
    case 'addfile':
      handleAddFile(ctx, req, res);
      return;
    default:
      res.json({ status: false, error: `Unknown mode: ${param(req, 'mode') ?? ''}` });
  }
}

function handleQueue(ctx: SabContext, req: Request, res: Response): void {
  if (param(req, 'name') === 'delete') {
    res.json({ status: deleteJobs(ctx.queue, param(req, 'value')) });
    return;
  }
  res.json({
    queue: {
      paused: false,
      slots: ctx.queue.activeJobs().map(queueSlot),
    },
  });
}

function handleHistory(ctx: SabContext, req: Request, res: Response): void {
  if (param(req, 'name') === 'delete') {
    res.json({ status: deleteJobs(ctx.queue, param(req, 'value')) });
    return;
  }
  res.json({
    history: {
      slots: ctx.queue.historyJobs().map(historySlot),
    },
  });
}

function handleAddFile(ctx: SabContext, req: Request, res: Response): void {
  const log = ctx.logger ?? { warn: () => {}, info: () => {} };
  const files = ((req as unknown as Record<string, unknown>)['files'] ?? []) as UploadedFile[];
  const upload = files[0];
  if (!upload) {
    res.json({ status: false, error: 'no nzb file in request' });
    return;
  }
  let payload;
  try {
    payload = parseNzb(upload.buffer.toString('utf8'), { metaType: ctx.settings.metaType });
  } catch (err) {
    log.warn({ err, filename: upload.originalname }, 'addfile rejected: unparseable nzb');
    res.json({ status: false, error: `not a ${ctx.settings.metaType} nzb` });
    return;
  }
  // Validate the client-supplied category against the allowlist before it
  // reaches path.join(completeDir, category) in the runner — an unchecked value
  // like `../../tmp` would escape completeDir (CWE-22). Fall back to 'sonarr'.
  const requestedCat = param(req, 'cat');
  const category = requestedCat && CATEGORIES.includes(requestedCat) ? requestedCat : 'sonarr';
  const job = ctx.queue.add(payload, category);
  log.info({ nzoId: job.nzoId, title: payload.title }, 'queued download');
  res.json({ status: true, nzo_ids: [job.nzoId] });
}

function deleteJobs(queue: DownloadQueue, value: string | undefined): boolean {
  const ids = value?.split(',').filter(Boolean) ?? [];
  let ok = ids.length > 0;
  for (const id of ids) ok = queue.remove(id) && ok;
  return ok;
}

function queueSlot(job: DownloadJob, index: number) {
  const total = job.totalBytes ?? 0;
  const left = Math.max(total - job.downloadedBytes, 0);
  return {
    nzo_id: job.nzoId,
    status: job.status === 'downloading' ? 'Downloading' : 'Queued',
    index,
    filename: job.payload.title,
    cat: job.category,
    priority: 0,
    mb: mbString(total),
    mbleft: mbString(left),
    percentage: String(total > 0 ? Math.floor((job.downloadedBytes / total) * 100) : 0),
    timeleft: timeleft(job),
  };
}

function historySlot(job: DownloadJob, index: number) {
  return {
    nzo_id: job.nzoId,
    status: job.status === 'completed' ? 'Completed' : 'Failed',
    index,
    name: job.payload.title,
    nzb_name: `${job.payload.title}.nzb`,
    category: job.category,
    storage: job.storagePath,
    bytes: job.totalBytes ?? 0,
    fail_message: job.failMessage ?? '',
    download_time:
      job.completedAt && job.startedAt
        ? Math.round((job.completedAt - job.startedAt) / 1000)
        : 0,
    completed: job.completedAt ? Math.round(job.completedAt / 1000) : null,
  };
}

function mbString(bytes: number): string {
  return (bytes / 1048576).toFixed(2);
}

/** Estimated H:MM:SS remaining from the observed download rate. */
function timeleft(job: DownloadJob): string {
  if (
    job.status !== 'downloading' ||
    !job.startedAt ||
    !job.totalBytes ||
    job.downloadedBytes <= 0
  ) {
    return '0:00:00';
  }
  const elapsed = (Date.now() - job.startedAt) / 1000;
  const rate = job.downloadedBytes / Math.max(elapsed, 1);
  const remaining = Math.max(job.totalBytes - job.downloadedBytes, 0) / rate;
  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = Math.floor(remaining % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function param(req: Request, name: string): string | undefined {
  const value = req.query[name];
  return typeof value === 'string' ? value : undefined;
}
