/**
 * Unit tests for the logger transport-config decision function (REL-06).
 *
 * We test the pure `transportConfig()` function directly so the test does not
 * depend on actually pruning pino-pretty from node_modules or manipulating
 * process.env / process.stdout at module-load time.
 */
import { describe, expect, it } from 'vitest';
import { transportConfig } from '../src/logger.js';

describe('logger transportConfig (REL-06)', () => {
  it('returns undefined (JSON fallback) when NODE_ENV is production', () => {
    expect(transportConfig('production', true, true)).toBeUndefined();
  });

  it('returns undefined (JSON fallback) when stdout is not a TTY', () => {
    expect(transportConfig(undefined, false, true)).toBeUndefined();
  });

  it('returns undefined (JSON fallback) when pino-pretty is not resolvable', () => {
    // This is the core REL-06 fix: absent devDep must not crash, must fall back to JSON.
    const result = transportConfig(undefined, true, false);
    expect(result).toBeUndefined();
  });

  it('selects pino-pretty transport when non-prod, TTY, and pino-pretty resolvable', () => {
    const result = transportConfig(undefined, true, true);
    expect(result).not.toBeUndefined();
    expect(result?.target).toBe('pino-pretty');
  });

  it('selects pino-pretty transport when NODE_ENV is "development", TTY, and resolvable', () => {
    const result = transportConfig('development', true, true);
    expect(result?.target).toBe('pino-pretty');
  });

  it('returns undefined when both production and pino-pretty absent', () => {
    expect(transportConfig('production', true, false)).toBeUndefined();
  });

  it('returns undefined when prod + no TTY + pino-pretty absent', () => {
    expect(transportConfig('production', false, false)).toBeUndefined();
  });
});
