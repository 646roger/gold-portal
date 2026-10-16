import type { LoanSchemeDto } from '@goldloan/shared';
import type { Db } from '../lib/prisma';
import type { PlanTerms } from '../domain/quote';

type PlanRow = Awaited<ReturnType<Db['loanPlan']['findMany']>>[number];

export function toPlanTerms(p: PlanRow): PlanTerms {
  return {
    id: p.id,
    name: p.name,
    repaymentType: p.repaymentType,
    annualInterestRatePct: p.annualInterestRate.toFixed(2),
    maxLtv: p.maxLtvPercent.div(100).toFixed(4), // DB stores a percent (70.00); the domain works in fractions (0.7000)
    tenureMonths: p.tenureMonths,
  };
}

export async function listActivePlanTerms(db: Db): Promise<PlanTerms[]> {
  const rows = await db.loanPlan.findMany({ where: { isActive: true }, orderBy: { id: 'asc' } });
  return rows.map(toPlanTerms);
}

export async function findActivePlanTerms(db: Db, id: string): Promise<PlanTerms | null> {
  const row = await db.loanPlan.findFirst({ where: { id, isActive: true } });
  return row ? toPlanTerms(row) : null;
}

const describe = (p: PlanTerms) =>
  p.repaymentType === 'BULLET'
    ? 'Interest and principal are paid together at maturity.'
    : `${p.tenureMonths} equal monthly instalments.`;

/** Shared by GET /loan-schemes and the assistant's get_loan_schemes tool. */
export async function listLoanSchemes(db: Db): Promise<LoanSchemeDto[]> {
  const plans = await listActivePlanTerms(db);
  return plans.map((p) => ({
    id: p.id,
    name: p.name,
    repaymentType: p.repaymentType,
    repaymentDescription: describe(p),
    annualInterestRatePct: Number(p.annualInterestRatePct).toFixed(2),
    maxLtv: Number(p.maxLtv).toFixed(4),
    tenureMonths: p.tenureMonths,
  }));
}
