import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import type { Env } from './config/env';
import type { LlmProvider } from './ai/types';
import type { Db } from './lib/prisma';
import { errorHandler, limiter, notFound, requestLogger } from './middleware/http';
import { buildApiRouter } from './routes';

export interface AppDeps {
  db: Db;
  env: Env;
  now?: () => Date;
  llm: LlmProvider;
}

export function createApp(deps: AppDeps) {
  const { env } = deps;
  const app = express();
  app.disable('x-powered-by');
  if (env.TRUST_PROXY) app.set('trust proxy', 1);

  app.use((req, res, next) => {
    req.id = randomUUID();
    res.setHeader('x-request-id', req.id);
    next();
  });
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || env.corsOrigins.includes(origin)),
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'x-admin-key'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '16kb' }));
  app.use(requestLogger());
  app.use('/api', limiter(env.RATE_LIMIT_ENABLED, 300));
  app.use('/api/v1', buildApiRouter(deps));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
