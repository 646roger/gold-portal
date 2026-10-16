/**
 * Minimal structured logger. By design it is only ever given metadata (ids, status codes,
 * durations) – never request bodies, names or mobile numbers.
 */
type Level = 'info' | 'warn' | 'error';
const quiet = process.env.NODE_ENV === 'test';

function log(level: Level, msg: string, meta: Record<string, unknown> = {}) {
  if (quiet && level !== 'error') return;
  if (quiet) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...meta });
  (level === 'error' ? console.error : console.log)(line);
}

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => log('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log('error', msg, meta),
};
