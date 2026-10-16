import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { env } from '../config/env';

export type Db = PrismaClient;

export function createPrisma(connectionString = env.DATABASE_URL): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export const prisma = createPrisma();
