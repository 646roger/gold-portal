import type { RepaymentEstimateDto, RepaymentType } from '@goldloan/shared';
import { D, toFixed, type Dec } from './money';

export const ESTIMATE_DISCLAIMER =
  'Illustrative estimate only. Not a lender-approved amount, offer or repayment schedule.';

/**
 * INTEREST-ESTIMATION POLICY (labelled as an estimate everywhere it is shown)
 *  - EMI: standard reducing-balance formula, r = annualRate / 12 / 100,
 *      EMI = P * r * (1+r)^n / ((1+r)^n - 1)   (EMI rounded to 2 dp, half-up)
 *      total interest = EMI * n - P. If the rate is 0, EMI = P / n.
 *  - Bullet: simple interest, interest = P * annualRate/100 * tenureMonths/12, paid with the
 *    principal at maturity.
 *  No fees, penalties or processing charges are included (none are specified).
 */
export function estimateRepayment(args: {
  principal: Dec;
  annualRatePct: Dec;
  tenureMonths: number;
  type: RepaymentType;
}): RepaymentEstimateDto {
  const { principal: P, annualRatePct, tenureMonths: n, type } = args;
  if (type === 'EMI') {
    if (annualRatePct.isZero()) {
      // Interest-free: total repayable is exactly the principal; the displayed EMI is P/n rounded.
      return {
        isEstimate: true,
        method: 'Reducing-balance EMI over the plan tenure',
        monthlyInstalment: toFixed(P.div(n), 2),
        totalInterest: toFixed(new D(0), 2),
        totalRepayable: toFixed(P, 2),
        disclaimer: ESTIMATE_DISCLAIMER,
      };
    }
    const r = annualRatePct.div(12).div(100);
    const pow = new D(1).plus(r).pow(n);
    const emi: Dec = P.mul(r).mul(pow).div(pow.minus(1));
    const emiRounded = emi.toDecimalPlaces(2, D.ROUND_HALF_UP);
    const total = emiRounded.mul(n);
    return {
      isEstimate: true,
      method: 'Reducing-balance EMI over the plan tenure',
      monthlyInstalment: toFixed(emiRounded, 2),
      totalInterest: toFixed(total.minus(P), 2),
      totalRepayable: toFixed(total, 2),
      disclaimer: ESTIMATE_DISCLAIMER,
    };
  }
  const interest = P.mul(annualRatePct).div(100).mul(n).div(12);
  return {
    isEstimate: true,
    method: 'Simple interest on the full principal, paid with the principal at maturity',
    totalInterest: toFixed(interest, 2),
    totalRepayable: toFixed(P.plus(interest), 2),
    disclaimer: ESTIMATE_DISCLAIMER,
  };
}
