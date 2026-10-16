import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';
import { AppError, validationError } from '../lib/errors';
import { logger } from '../lib/logger';

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function sendError(res: Response, status: number, code: string, message: string, extra: { fields?: Record<string, string>; details?: Record<string, unknown> } = {}) {
  res.status(status).json({ error: { code, message, ...extra } });
}

export const notFound: RequestHandler = (_req, res) => sendError(res, 404, 'NOT_FOUND', 'Resource not found.');

const TRANSIENT_DB_CODES = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', '57P01', '08006', '08001', '08004', '53300', 'P1001', 'P1002', 'P1008', 'P1017', 'P2024']);

function isDbUnavailable(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  return Boolean(e && (TRANSIENT_DB_CODES.has(String(e.code)) || TRANSIENT_DB_CODES.has(String(e.cause?.code))));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return;
  if (err instanceof AppError) return sendError(res, err.status, err.code, err.message, { fields: err.fields, details: err.details });
  if (err instanceof ZodError) {
    const v = validationError(err);
    return sendError(res, 400, v.code, v.message, { fields: v.fields });
  }
  const type = (err as { type?: string } | null)?.type;
  if (type === 'entity.parse.failed') return sendError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON.');
  if (type === 'entity.too.large') return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
  if (isDbUnavailable(err)) {
    logger.error('database unavailable', { requestId: req.id });
    return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'The service is temporarily unavailable. Please try again shortly.');
  }
  // Unexpected: log the error class only (messages from drivers may echo query parameters / PII).
  logger.error('unhandled error', { requestId: req.id, name: (err as Error)?.name });
  return sendError(res, 500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
}

export function requestLogger(): RequestHandler {
  return (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => logger.info('request', { requestId: req.id, method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start }));
    next();
  };
}

const digest = (s: string) => createHash('sha256').update(s).digest();

/** Demo/local admin gate: constant-time comparison of `x-admin-key` against ADMIN_API_KEY. NOT production auth. */
export function adminAuth(adminKey: string): RequestHandler {
  const expected = digest(adminKey);
  return (req, _res, next) => {
    const provided = req.header('x-admin-key');
    if (!provided || !timingSafeEqual(digest(provided), expected)) {
      return next(new AppError(401, 'UNAUTHORIZED', 'Admin access key required.'));
    }
    next();
  };
}

export function limiter(enabled: boolean, limit: number, windowMs = 60_000): RequestHandler {
  if (!enabled) return (_req, _res, next) => next();
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => sendError(res, 429, 'RATE_LIMITED', 'Too many requests. Please slow down and try again shortly.'),
  });
}
