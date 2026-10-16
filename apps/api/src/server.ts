import { selectProvider } from './ai/providers';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';

const llm = selectProvider(env);
const app = createApp({ db: prisma, env, llm });
const server = app.listen(env.PORT, () => logger.info('api listening', { port: env.PORT, env: env.NODE_ENV, assistant: llm.mode }));

const shutdown = () => {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
