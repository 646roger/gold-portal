import type { PlanQuoteDto, QuoteDto, RepaymentType } from '@goldloan/shared';
import { D, floorRupees, toFixed, type Dec } from './money';
import { estimateRepayment } from './repayment';

/** Hard ceiling. Applies regardless of any plan configuration. */
export const MAX_PERMITTED_LTV = new D('0.75');

export interface PlanTerms {
  id: string;
  name: string;
  repaymentType: RepaymentType;
  annualInterestRatePct: string; // "12.00"
  maxLtv: string; // fraction, "0.7000"
  tenureMonths: number;
}

/**
 * ROUNDING POLICY
 *  - Intermediate values keep 40 significant digits; multiplication happens BEFORE the single
 *    division by 24 so no precision is lost (e.g. 4 g @22K must give exactly 19,250).
 *  - eligibleLoanAmount = floor(netWeight * karat * rate * min(planLtv, 0.75) / 24)  (whole ₹, DOWN).
 *  - Reported figures are quantised only at the API boundary: pure weight 6 dp, gold value 2 dp
 *    (half-up). The loan amount is computed from the UNROUNDED gold value, never the displayed one.
 */
export function effectiveLtv(planMaxLtv: string): Dec | null {
  let ltv: Dec;
  try {
    ltv = new D(planMaxLtv);
  } catch {
    return null;
  }
  if (!ltv.isFinite() || ltv.lte(0)) return null; // malformed plan → not offered
  return Dec_min(ltv, MAX_PERMITTED_LTV);
}

const Dec_min = (a: Dec, b: Dec): Dec => (a.lte(b) ? a : b);

export interface QuoteInput {
  netWeightGrams: string;
  karat: number;
  marketRatePerGram: string;
  plans: PlanTerms[];
}

export function calculateQuote(input: QuoteInput): QuoteDto {
  const net = new D(input.netWeightGrams);
  const karat = new D(input.karat);
  const rate = new D(input.marketRatePerGram);

  const pureWeightStr = toFixed(net.mul(karat).div(24), 6);
  const goldValueExact = net.mul(karat).mul(rate).div(24);
  const goldValueStr = toFixed(goldValueExact, 2);

  const quotes: PlanQuoteDto[] = [];
  for (const plan of input.plans) {
    const ltv = effectiveLtv(plan.maxLtv);
    if (!ltv) continue;
    const tenure = plan.tenureMonths;
    if (!Number.isInteger(tenure) || tenure <= 0) continue;
    const rateOk = (() => {
      try {
        const r = new D(plan.annualInterestRatePct);
        return r.isFinite() && r.gte(0);
      } catch {
        return false;
      }
    })();
    if (!rateOk) continue;

    // multiply first, divide once, then floor.
    const eligible = floorRupees(net.mul(karat).mul(rate).mul(ltv).div(24));
    quotes.push({
      planId: plan.id,
      planName: plan.name,
      repaymentType: plan.repaymentType,
      annualInterestRatePct: toFixed(new D(plan.annualInterestRatePct), 2),
      maxLtv: toFixed(new D(plan.maxLtv), 4),
      appliedLtv: toFixed(ltv, 4),
      tenureMonths: tenure,
      pureGoldWeightGrams: pureWeightStr,
      goldValue: goldValueStr,
      eligibleLoanAmount: eligible.toFixed(0),
      repaymentEstimate: estimateRepayment({
        principal: eligible,
        annualRatePct: new D(plan.annualInterestRatePct),
        tenureMonths: tenure,
        type: plan.repaymentType,
      }),
    });
  }

  return {
    netWeightGrams: net.toString(),
    karat: input.karat,
    pureGoldWeightGrams: pureWeightStr,
    marketRatePerGram: toFixed(rate, 2),
    goldValue: goldValueStr,
    maxPermittedLtv: toFixed(MAX_PERMITTED_LTV, 4),
    quotes,
  };
}
