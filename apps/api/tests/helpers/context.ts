import { loadEnv, type Env } from '../../src/config/env';
import { createApp } from '../../src/app';
import { createPrisma, type Db } from '../../src/lib/prisma';
import type { LlmProvider } from '../../src/ai/types';
import { createDemoProvider } from '../../src/ai/providers/demo';
import { SEED_PLANS, seed } from '../../prisma/seed';

export const ADMIN_KEY = 'test-admin-key-0123456789';

export function makeContext(overrides: Partial<NodeJS.ProcessEnv> = {}, now?: () => Date, llm: LlmProvider = createDemoProvider()) {
  const env: Env = loadEnv({ ...process.env, ...overrides });
  const db: Db = createPrisma(env.DATABASE_URL);
  const app = createApp({ db, env, now, llm });
  return { env, db, app };
}

export async function resetDatabase(db: Db) {
  await db.loanApplication.deleteMany();
  await db.chatSession.deleteMany();
  await db.loanPlan.deleteMany({ where: { id: { notIn: SEED_PLANS.map((p) => p.id) } } });
  await db.marketRate.deleteMany({ where: { ratePerGramPaise: { not: 700000n } } });
  await seed(db);
}

export const validLead = (over: Record<string, unknown> = {}) => ({
  fullName: 'Asha Verma',
  mobileNumber: '9876543210',
  netWeightGrams: 45,
  karat: 22,
  planId: 'PLAN_EMI_01',
  ...over,
});
