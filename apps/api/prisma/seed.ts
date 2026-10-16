import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import type { PrismaClient } from '../src/generated/prisma/client';

export const SEED_MARKET_RATE = '7000.00';
const SEED_MARKET_RATE_PAISE = 700000n; // ₹7,000.00 per gram of 24K, in paise

export const SEED_PLANS = [
  { id: 'PLAN_BULLET_01', name: 'Bullet Repayment', repaymentType: 'BULLET' as const, annualInterestRate: '12.00', maxLtvPercent: '70.00', tenureMonths: 12 },
  { id: 'PLAN_EMI_01', name: 'Monthly EMI', repaymentType: 'EMI' as const, annualInterestRate: '10.50', maxLtvPercent: '75.00', tenureMonths: 12 },
];

export async function seed(prisma: PrismaClient): Promise<void> {
  for (const p of SEED_PLANS) {
    await prisma.loanPlan.upsert({
      where: { id: p.id },
      update: { name: p.name, repaymentType: p.repaymentType, annualInterestRate: p.annualInterestRate, maxLtvPercent: p.maxLtvPercent, tenureMonths: p.tenureMonths, isActive: true },
      create: { ...p, isActive: true },
    });
  }
  if ((await prisma.marketRate.count()) === 0) {
    await prisma.marketRate.create({ data: { ratePerGramPaise: SEED_MARKET_RATE_PAISE } });
  }
}

// Run directly: `npm run db:seed`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { createPrisma } = await import('../src/lib/prisma');
  const prisma = createPrisma();
  try {
    await seed(prisma);
    console.log('Seeded plans:', SEED_PLANS.map((p) => p.id).join(', '), `| market rate ₹${SEED_MARKET_RATE}/g`);
  } finally {
    await prisma.$disconnect();
  }
}
