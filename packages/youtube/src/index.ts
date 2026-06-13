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

runner.start();

app.listen(config.port, config.host, () => {
  logger.info(`ytfortv listening on http://${config.host}:${config.port}`);
  logger.info(`data dir: ${config.dataDir}`);
});
