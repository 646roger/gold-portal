import type { CSSProperties } from 'react';
import { CountUp } from '../../components/CountUp';
import type { QuoteState } from '../../hooks/useQuote';
import { grams, inr, pct } from '../../lib/format';

interface Props {
  state: QuoteState;
  weight: string;
  karat: string;
  selectedPlanId?: string | null;
}

/** The live "valuation slip": every figure shown is the server's quotation, nothing is computed here. */
export function ValuationSlip({ state, weight, karat, selectedPlanId }: Props) {
  const { quote, loading, error } = state;
  return (
    <section className="slip" aria-labelledby="slip-title">
      <div className="slip__head">
        <h2 id="slip-title">Valuation slip</h2>
        <span className="slip__status" aria-live="polite">{loading ? 'Updating…' : quote ? 'Live rate' : ''}</span>
      </div>
      {loading ? <div className="progress" role="progressbar" aria-label="Updating quotation" /> : <div style={{ height: 2 }} />}
      <div className="slip__body" aria-busy={loading} aria-live="polite">
        {error && <p className="err" role="alert">{error}</p>}
        <ul className="ledger">
          <li><span className="k">Net weight</span><span className="val">{weight ? `${weight} g` : '—'}</span></li>
          <li><span className="k">Purity</span><span className="val">{karat ? `${karat}K` : '—'}</span></li>
          <li><span className="k">Pure gold</span><span className="val">{quote ? grams(quote.pureGoldWeightGrams) : loading ? <span className="skeleton skeleton--val" aria-hidden="true" /> : '—'}</span></li>
          <li><span className="k">Rate (24K, per g)</span><span className="val">{quote ? inr(quote.marketRatePerGram) : loading ? <span className="skeleton skeleton--val" aria-hidden="true" /> : '—'}</span></li>
        </ul>
        <div className="slip__total">
          <div className="k">Gold value</div>
          <div className="big val">{quote ? <CountUp value={quote.goldValue} format={inr} /> : loading ? <div className="skeleton skeleton--big" aria-hidden="true" /> : '—'}</div>
        </div>
        {quote ? (
          <div className="slip__plans">
            {quote.quotes.map((p, i) => (
              <div className="row" key={p.planId} style={{ '--i': i } as CSSProperties}>
                <span className={p.planId === selectedPlanId ? 'sel' : undefined}>{p.planName}{p.planId === selectedPlanId ? ' ✓' : ''}</span>
                <span className="val"><b><CountUp value={p.eligibleLoanAmount} format={inr} /></b> <span style={{ color: 'var(--muted)' }}>· {pct(p.annualInterestRatePct)}</span></span>
              </div>
            ))}
          </div>
        ) : (
          !error && <p className="placeholder">Enter your gold’s net weight and purity to see what it is worth today.</p>
        )}
      </div>
      <p className="slip__foot">
        <span className="est">Estimate</span> Eligible amount = gold value × the plan’s loan-to-value (never above 75%), rounded down to whole rupees. Approval is subject to the lender’s review.
      </p>
    </section>
  );
}
