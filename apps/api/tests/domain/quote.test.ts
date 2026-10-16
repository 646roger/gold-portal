import { describe, expect, it } from 'vitest';
import { calculateQuote, effectiveLtv, MAX_PERMITTED_LTV, type PlanTerms } from '../../src/domain/quote';

const BULLET: PlanTerms = { id: 'PLAN_BULLET_01', name: 'Bullet Repayment', repaymentType: 'BULLET', annualInterestRatePct: '12.00', maxLtv: '0.7000', tenureMonths: 12 };
const EMI: PlanTerms = { id: 'PLAN_EMI_01', name: 'Monthly EMI', repaymentType: 'EMI', annualInterestRatePct: '10.50', maxLtv: '0.7500', tenureMonths: 12 };
const RATE = '7000.00';
const q = (net: string, karat: number, plans = [BULLET, EMI]) =>
  calculateQuote({ netWeightGrams: net, karat, marketRatePerGram: RATE, plans });
const plan = (r: ReturnType<typeof q>, id: string) => r.quotes.find((x) => x.planId === id)!;

describe('required valuation cases @ ₹7,000/g', () => {
  it('1. 45 g 22K EMI → 41.25 g, ₹2,88,750, ₹2,16,562', () => {
    const r = q('45', 22);
    expect(r.pureGoldWeightGrams).toBe('41.250000');
    expect(r.goldValue).toBe('288750.00');
    expect(plan(r, 'PLAN_EMI_01').eligibleLoanAmount).toBe('216562'); // 216562.5 floored
  });
  it('2. 45 g 22K Bullet → ₹2,02,125', () => {
    const r = q('45', 22);
    expect(r.goldValue).toBe('288750.00');
    expect(plan(r, 'PLAN_BULLET_01').eligibleLoanAmount).toBe('202125');
  });
  it('3. 10 g 18K EMI → 7.5 g, ₹52,500, ₹39,375', () => {
    const r = q('10', 18);
    expect(r.pureGoldWeightGrams).toBe('7.500000');
    expect(r.goldValue).toBe('52500.00');
    expect(plan(r, 'PLAN_EMI_01').eligibleLoanAmount).toBe('39375');
  });
  it('4. 4 g 22K EMI → ≈3.666667 g, ≈₹25,666.67, exactly ₹19,250 (no float drift)', () => {
    const r = q('4', 22);
    expect(r.pureGoldWeightGrams).toBe('3.666667');
    expect(r.goldValue).toBe('25666.67');
    expect(plan(r, 'PLAN_EMI_01').eligibleLoanAmount).toBe('19250');
  });
});

describe('rounding & precision', () => {
  it('floors the loan amount from the UNROUNDED gold value', () => {
    // 1 g 22K: value 6416.666…; ×0.75 = 4812.5 → 4812
    expect(plan(q('1', 22), 'PLAN_EMI_01').eligibleLoanAmount).toBe('4812');
  });
  it('handles 3-decimal weights exactly', () => {
    // 0.001 g 24K → ₹7.00 value; ×0.7 = 4.9 → 4
    const r = q('0.001', 24);
    expect(r.goldValue).toBe('7.00');
    expect(plan(r, 'PLAN_BULLET_01').eligibleLoanAmount).toBe('4');
  });
  it('is exact where float math is not (0.1+0.2 style weights)', () => {
    expect(plan(q('0.3', 24), 'PLAN_EMI_01').eligibleLoanAmount).toBe('1575');
  });
  it('boundary: maximum weight 5000 g 24K', () => {
    const r = q('5000', 24);
    expect(r.goldValue).toBe('35000000.00');
    expect(plan(r, 'PLAN_EMI_01').eligibleLoanAmount).toBe('26250000');
  });
  it('returns a quote per active plan with plan terms', () => {
    const r = q('45', 22);
    expect(r.quotes.map((x) => x.planId)).toEqual(['PLAN_BULLET_01', 'PLAN_EMI_01']);
    expect(plan(r, 'PLAN_BULLET_01')).toMatchObject({ annualInterestRatePct: '12.00', maxLtv: '0.7000', appliedLtv: '0.7000', tenureMonths: 12 });
  });
});

describe('LTV ceiling', () => {
  it('caps a malformed plan at 75%', () => {
    const bad: PlanTerms = { ...EMI, id: 'PLAN_BAD', maxLtv: '0.9000' };
    const r = q('45', 22, [bad]);
    expect(r.quotes[0]!.appliedLtv).toBe('0.7500');
    expect(r.quotes[0]!.eligibleLoanAmount).toBe('216562');
  });
  it('caps even absurd LTV values', () => {
    expect(effectiveLtv('5')!.toString()).toBe(MAX_PERMITTED_LTV.toString());
  });
  it.each(['0', '-0.5', 'abc', 'NaN', 'Infinity'])('omits plans with unusable LTV %s', (ltv) => {
    expect(q('45', 22, [{ ...EMI, maxLtv: ltv }]).quotes).toHaveLength(0);
  });
  it('omits plans with non-positive tenure or negative rate', () => {
    expect(q('45', 22, [{ ...EMI, tenureMonths: 0 }]).quotes).toHaveLength(0);
    expect(q('45', 22, [{ ...EMI, annualInterestRatePct: '-1' }]).quotes).toHaveLength(0);
  });
  it('never yields a loan above 75% of gold value for any LTV input', () => {
    for (const ltv of ['0.1', '0.5', '0.75', '0.76', '0.99', '1']) {
      const r = q('37.5', 22, [{ ...EMI, maxLtv: ltv }]);
      const loan = Number(r.quotes[0]!.eligibleLoanAmount);
      expect(loan).toBeLessThanOrEqual(Math.floor(Number(r.goldValue) * 0.75));
    }
  });
});

describe('repayment estimates (labelled estimates, not authoritative)', () => {
  it('bullet: simple interest on principal at maturity', () => {
    const e = plan(q('45', 22), 'PLAN_BULLET_01').repaymentEstimate;
    // 202125 × 12% = 24255.00
    expect(e).toMatchObject({ isEstimate: true, totalInterest: '24255.00', totalRepayable: '226380.00' });
    expect(e.monthlyInstalment).toBeUndefined();
  });
  it('EMI: reducing balance, 12 equal instalments', () => {
    const e = plan(q('45', 22), 'PLAN_EMI_01').repaymentEstimate;
    expect(e.isEstimate).toBe(true);
    expect(Number(e.monthlyInstalment)).toBeGreaterThan(216562 / 12);
    expect(e.disclaimer).toMatch(/estimate/i);
    expect(Number(e.totalRepayable)).toBeCloseTo(Number(e.monthlyInstalment) * 12, 2);
  });
  it('EMI with 0% rate is principal / n', () => {
    const e = plan(q('45', 22, [{ ...EMI, annualInterestRatePct: '0' }]), 'PLAN_EMI_01').repaymentEstimate;
    expect(e.totalInterest).toBe('0.00');
  });
});
