import { loadConfig } from './config.js';
import { DownloadQueue } from './downloads/queue.js';
import { DownloadRunner } from './downloads/runner.js';
import { logger } from './logger.js';
import { createServer } from './server.js';

const config = loadConfig();
const queue = new DownloadQueue();
const runner = new DownloadRunner({ queue, config });
const app = createServer(config, { queue });

runner.start();

app.listen(config.port, config.host, () => {
  logger.info(`ytfortv listening on http://${config.host}:${config.port}`);
  logger.info(`data dir: ${config.dataDir}`);
});
