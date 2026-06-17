import { loadConfig } from './config.js';
import { DownloadQueue } from '@bridgarr/core';
import { DownloadRunner } from './downloads/runner.js';
import { logger } from './logger.js';
import { createServer } from './server.js';
import { YouTubeSource } from './youtube/provider.js';

const config = loadConfig();
const queue = new DownloadQueue();
const runner = new DownloadRunner({ queue, config });
const app = createServer(config, { queue, source: new YouTubeSource(config) });

// REL-01: wire the onRemove hook so a Sonarr delete → queue.remove() → runner.onRemove():
// frees the concurrency slot + SIGTERMs the live process + immediately schedules the next
// queued job (no ~1s interval wait). Arrow wrapper ensures `this` binds correctly.
queue.setOnRemove((nzoId) => runner.onRemove(nzoId));

// REL-02: sweep orphaned <downloadDir>/<nzoId> dirs left over from a previous process.
// The queue is empty at startup so all dirs are swept. Errors are logged, never thrown.
runner.sweepOrphans().catch((err) => logger.warn({ err }, 'orphan sweep rejected unexpectedly'));

runner.start();

app.listen(config.port, config.host, () => {
  logger.info(`bridgarr-youtube listening on http://${config.host}:${config.port}`);
  logger.info(`data dir: ${config.dataDir}`);
});
