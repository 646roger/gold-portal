import type { PlanQuoteDto } from '@goldloan/shared';
import type { CSSProperties } from 'react';
import { CountUp } from '../../components/CountUp';
import { inr, pctFromFraction, pct } from '../../lib/format';

export function repaymentText(p: PlanQuoteDto): string {
  return p.repaymentType === 'BULLET'
    ? `Pay interest and principal together at the end of ${p.tenureMonths} months.`
    : `Pay ${p.tenureMonths} equal monthly instalments.`;
}

export function EstimateLine({ p }: { p: PlanQuoteDto }) {
  const e = p.repaymentEstimate;
  return (
    <>
      <span className="est">Estimate</span>{' '}
      {e.monthlyInstalment ? `${inr(e.monthlyInstalment)} a month · ` : ''}
      interest {inr(e.totalInterest)} · total repayable {inr(e.totalRepayable)}
    </>
  );
}

interface Props {
  quotes: PlanQuoteDto[];
  value: string | null;
  onChange: (id: string) => void;
}

export function PlanChoice({ quotes, value, onChange }: Props) {
  return (
    <fieldset className="plans">
      <legend className="sr-only">Loan plan</legend>
      {quotes.map((p, i) => (
        <label className="plan" key={p.planId} style={{ '--i': i } as CSSProperties}>
          <input type="radio" name="plan" value={p.planId} checked={value === p.planId} onChange={() => onChange(p.planId)} />
          <div>
            <div className="plan__top">
              <span className="plan__name">{p.planName}</span>
              <span className="plan__amt"><CountUp value={p.eligibleLoanAmount} format={inr} /></span>
            </div>
            <div className="plan__facts">
              <span>{pct(p.annualInterestRatePct)} a year</span>
              <span>{pctFromFraction(p.appliedLtv)} of gold value</span>
              <span>{p.tenureMonths} months</span>
            </div>
            <p className="plan__note">{repaymentText(p)}</p>
            <p className="plan__note" style={{ color: 'var(--muted)' }}><EstimateLine p={p} /></p>
          </div>
        </label>
      ))}
      <p className="hint" style={{ fontSize: 'var(--t-xs)', color: 'var(--muted)' }}>
        Loan-to-value (LTV) is the share of your gold’s value you can borrow. It is capped at 75% whatever the plan. Repayment figures are illustrative estimates, not lender-approved amounts.
      </p>
    </fieldset>
  );
}
