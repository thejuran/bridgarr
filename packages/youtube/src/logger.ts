import { createRequire } from 'node:module';
import { pino } from 'pino';

/**
 * Probe whether pino-pretty is resolvable without importing it. ESM-safe:
 * `require.resolve` is undefined in "type":"module" packages, so we use
 * createRequire(import.meta.url) to get a sync resolver.
 *
 * Returns false when pino-pretty has been pruned (e.g. `npm prune --omit=dev`
 * in a prod-style non-Docker start) so we can fall back to plain JSON logging
 * without throwing at transport init time (REL-06).
 */
function prettyAvailable(): boolean {
  try {
    createRequire(import.meta.url).resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

/**
 * Pure transport-config decision function, exported for unit testing.
 * Returns the pino transport config to use, or undefined for plain JSON logging.
 */
export function transportConfig(
  nodeEnv: string | undefined,
  isTTY: boolean,
  prettyResolvable: boolean,
): { target: string; options: Record<string, unknown> } | undefined {
  if (nodeEnv === 'production' || !isTTY || !prettyResolvable) return undefined;
  return { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } };
}

const transport = transportConfig(
  process.env.NODE_ENV,
  process.stdout.isTTY,
  prettyAvailable(),
);

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport,
});
