import { pino } from 'pino';

const usePretty = process.env.NODE_ENV !== 'production' && process.stdout.isTTY;

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: usePretty
    ? { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } }
    : undefined,
});
