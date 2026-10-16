import type { LeadCreatedDto } from '@goldloan/shared';
import { fullNameSchema, karatSchema, mobileNumberSchema, netWeightSchema } from '@goldloan/shared';
import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { Field } from '../../components/Field';
import { StepIndicator } from '../../components/Shell';
import { useQuote } from '../../hooks/useQuote';
import { api, ApiError } from '../../lib/api';
import { grams, inr, pct, pctFromFraction, dateTime } from '../../lib/format';
import { EstimateLine, PlanChoice, repaymentText } from '../quotation/PlanChoice';
import { ValuationSlip } from '../quotation/ValuationSlip';

type Form = { fullName: string; mobile: string; weight: string; karat: string };
type Key = keyof Form;
const EMPTY: Form = { fullName: '', mobile: '', weight: '', karat: '' };
const KARATS = [18, 20, 22, 24];
const SPARKS = Array.from({ length: 22 }, (_, i) => ({ l: `${(i * 37 + 8) % 96}%`, x: `${((i * 53) % 90) - 45}px`, r: `${((i * 97) % 540) - 270}deg`, d: `${(i % 7) * 0.09 + 0.8}s` }));
const SERVER_FIELD: Record<string, Key> = { fullName: 'fullName', mobileNumber: 'mobile', netWeightGrams: 'weight', karat: 'karat' };

function validate(f: Form): Record<Key, string | undefined> {
  const msg = (r: { success: boolean; error?: { issues: { message: string }[] } }) => (r.success ? undefined : r.error?.issues[0]?.message);
  return {
    fullName: msg(fullNameSchema.safeParse(f.fullName)),
    mobile: msg(mobileNumberSchema.safeParse(f.mobile)),
    weight: msg(netWeightSchema.safeParse(f.weight.trim())),
    karat: msg(karatSchema.safeParse(f.karat === '' ? undefined : Number(f.karat))),
  };
}

export function ApplicationFlow() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [form, setForm] = useState<Form>(EMPTY);
  const [touched, setTouched] = useState<Partial<Record<Key, boolean>>>({});
  const [serverErrors, setServerErrors] = useState<Partial<Record<Key, string>>>({});
  const [planId, setPlanId] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'err' | 'warn'; text: string } | null>(null);
  const [done, setDone] = useState<LeadCreatedDto | null>(null);
  const dir = useRef<'fwd' | 'back'>('fwd');
  const go = (n: 1 | 2 | 3) => { dir.current = n > step ? 'fwd' : 'back'; setStep(n); };
  const enter = `panel--enter panel--${dir.current}`;

  const quoteState = useQuote(form.weight, form.karat);
  const { quote } = quoteState;
  const errors = useMemo(() => validate(form), [form]);
  const shown = (k: Key) => ((touched[k] || form[k] !== '') ? (errors[k] ?? serverErrors[k]) : serverErrors[k]);
  const set = (k: Key, v: string) => { setForm((f) => ({ ...f, [k]: v })); setServerErrors((s) => ({ ...s, [k]: undefined })); setNotice(null); };
  const blur = (k: Key) => setTouched((t) => ({ ...t, [k]: true }));

  const step1Valid = Object.values(errors).every((e) => !e);
  const chosen = quote?.quotes.find((q) => q.planId === planId) ?? null;
  const bestEligible = quote?.quotes.reduce<bigint | null>((m, q) => { const v = BigInt(q.eligibleLoanAmount); return m === null || v > m ? v : m; }, null);

  function next1() {
    setTouched({ fullName: true, mobile: true, weight: true, karat: true });
    if (step1Valid && quote) { go(2); window.scrollTo?.({ top: 0 }); }
  }

  async function submit() {
    if (!chosen || submitting) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const res = await api.createLead({ fullName: form.fullName.trim(), mobileNumber: form.mobile, netWeightGrams: form.weight.trim(), karat: Number(form.karat), planId: chosen.planId });
      setDone(res);
    } catch (e) {
      if (!(e instanceof ApiError)) setNotice({ kind: 'err', text: 'Something went wrong. Please try again.' });
      else if (e.code === 'DUPLICATE_APPLICATION') setNotice({ kind: 'warn', text: `You have already applied with this mobile number in the last 7 days. Your original application ID is ${String(e.details?.originalApplicationId ?? '')}. We have not created a new one.` });
      else if (e.code === 'PLAN_NOT_FOUND') { setPlanId(null); go(2); setNotice({ kind: 'err', text: 'That plan is no longer available. Please choose another.' }); }
      else if (e.fields) {
        const mapped: Partial<Record<Key, string>> = {};
        for (const [f, m] of Object.entries(e.fields)) { const k = SERVER_FIELD[f]; if (k) mapped[k] = m; }
        setServerErrors(mapped);
        go(1);
        setNotice({ kind: 'err', text: e.message });
      } else setNotice({ kind: 'err', text: e.message });
    } finally {
      setSubmitting(false);
    }
  }

  function reset() { setForm(EMPTY); setTouched({}); setServerErrors({}); setPlanId(null); setAgreed(false); setNotice(null); setDone(null); setStep(1); }

  if (done) {
    return (
      <div className="layout">
        <section className="panel success" aria-live="polite">
          <div aria-hidden="true">{SPARKS.map((s, i) => <span key={i} className="spark" style={{ '--l': s.l, '--x': s.x, '--r': s.r, '--d': s.d } as CSSProperties} />)}</div>
          <svg className="tick" viewBox="0 0 52 52" aria-hidden="true"><circle className="tick__c" cx="26" cy="26" r="24" fill="none" /><path className="tick__p" fill="none" d="M14 27l8 8 16-17" /></svg>
          <h2>Application received</h2>
          <p style={{ color: 'var(--muted)', marginBottom: 'var(--s-4)' }}>Keep this application ID for your records.</p>
          <p className="appid" data-testid="application-id">{done.applicationId}</p>
          <dl className="dl stagger" style={{ marginTop: 'var(--s-5)' }}>
            <div><dt>Plan</dt><dd>{done.planName}</dd></div>
            <div><dt>Gold value</dt><dd>{inr(done.goldValue)}</dd></div>
            <div className="em"><dt>Eligible loan amount</dt><dd>{inr(done.eligibleLoanAmount)}</dd></div>
            <div><dt>Interest rate</dt><dd>{pct(done.annualInterestRatePct)} a year</dd></div>
            <div><dt>Submitted</dt><dd>{dateTime(done.createdAt)}</dd></div>
          </dl>
          <p className="notice notice--warn" style={{ marginTop: 'var(--s-4)' }}>This is an application, not an approval. The amount shown is an eligibility estimate subject to the lender’s review.</p>
          <div className="actions"><button className="btn btn--quiet" onClick={reset}>Start another application</button></div>
        </section>
      </div>
    );
  }

  return (
    <>
      <div className="intro">
        <h1>Borrow against your gold.</h1>
        <p>See what your gold is worth at today’s rate and apply in three short steps.</p>
      </div>
      <div className="layout">
        <div>
          <StepIndicator step={step} labels={['Your details', 'Choose a plan', 'Review & confirm']} />

          {step === 1 && (
            <form className={`panel ${enter}`} noValidate onSubmit={(e) => { e.preventDefault(); next1(); }} aria-labelledby="s1">
              <h2 id="s1">Your details</h2>
              <div className="grid-2">
                <Field id="fullName" label="Full name" autoComplete="name" value={form.fullName} error={shown('fullName')} onChange={(e) => set('fullName', e.target.value)} onBlur={() => blur('fullName')} />
                <Field id="mobile" label="Mobile number" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="98765 43210" value={form.mobile} error={shown('mobile')} onChange={(e) => set('mobile', e.target.value)} onBlur={() => blur('mobile')} />
                <Field id="weight" label="Net gold weight" inputMode="decimal" autoComplete="off" affix="g" hint="Weight of the gold itself, excluding stones." value={form.weight} error={shown('weight')} onChange={(e) => set('weight', e.target.value)} onBlur={() => blur('weight')} />
                <Field id="karat" label="Gold purity" inputMode="numeric" autoComplete="off" affix="karat" value={form.karat} error={shown('karat')} onChange={(e) => set('karat', e.target.value.replace(/\D/g, '').slice(0, 2))} onBlur={() => blur('karat')}>
                  <div className="chips" role="group" aria-label="Common purities">
                    {KARATS.map((k) => (
                      <button key={k} type="button" className="chip" aria-pressed={form.karat === String(k)} onClick={() => { set('karat', String(k)); blur('karat'); }}>{k}K</button>
                    ))}
                  </div>
                </Field>
              </div>
              {notice && <p className={`notice notice--${notice.kind}`} role="alert" style={{ marginTop: 'var(--s-3)' }}>{notice.text}</p>}
              <div className="actions">
                {bestEligible != null && <p className="glance">Eligible up to <b>{inr(bestEligible.toString())}</b></p>}
                <span />
                <button className={`btn ${quote && step1Valid ? 'btn--ready' : ''}`} type="submit" disabled={!quote && step1Valid}>{!quote && step1Valid && <span className="spinner spinner--light" aria-hidden="true" />}Continue</button>
              </div>
            </form>
          )}

          {step === 2 && quote && (
            <section className={`panel ${enter}`} aria-labelledby="s2">
              <h2 id="s2">Choose a plan</h2>
              {notice && <p className={`notice notice--${notice.kind}`} role="alert" style={{ marginBottom: 'var(--s-3)' }}>{notice.text}</p>}
              <PlanChoice quotes={quote.quotes} value={planId} onChange={setPlanId} />
              <div className="actions">
                <button className="btn btn--quiet" onClick={() => go(1)}>Back</button>
                <button className={`btn ${chosen ? 'btn--ready' : ''}`} disabled={!chosen} onClick={() => { go(3); setAgreed(false); window.scrollTo?.({ top: 0 }); }}>Review application</button>
              </div>
            </section>
          )}

          {step === 3 && quote && chosen && (
            <section className={`panel ${enter}`} aria-labelledby="s3">
              <h2 id="s3">Review & confirm</h2>
              <dl className="dl stagger">
                <div><dt>Name</dt><dd>{form.fullName.trim()}</dd></div>
                <div><dt>Mobile</dt><dd>{form.mobile}</dd></div>
                <div><dt>Net gold weight</dt><dd>{form.weight} g · {form.karat}K</dd></div>
                <div><dt>Pure gold</dt><dd>{grams(chosen.pureGoldWeightGrams)}</dd></div>
                <div><dt>Gold value</dt><dd>{inr(chosen.goldValue)}</dd></div>
                <div><dt>Plan</dt><dd>{chosen.planName}</dd></div>
                <div><dt>Interest rate</dt><dd>{pct(chosen.annualInterestRatePct)} a year</dd></div>
                <div><dt>Tenure</dt><dd>{chosen.tenureMonths} months</dd></div>
                <div><dt>Repayment</dt><dd>{repaymentText(chosen)}</dd></div>
                <div><dt>Loan-to-value applied</dt><dd>{pctFromFraction(chosen.appliedLtv)}</dd></div>
                <div className="em"><dt>Eligible loan amount</dt><dd>{inr(chosen.eligibleLoanAmount)}</dd></div>
              </dl>
              <p className="hint" style={{ fontSize: 'var(--t-xs)', color: 'var(--muted)', marginTop: 'var(--s-2)' }}><EstimateLine p={chosen} /></p>
              <label className="confirm">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                <span>I confirm these details are correct and I want to submit this application. I understand the amount is an estimate and not an approval.</span>
              </label>
              {notice && <p className={`notice notice--${notice.kind}`} role="alert" style={{ marginTop: 'var(--s-3)' }}>{notice.text}</p>}
              <div className="actions">
                <button className="btn btn--quiet" onClick={() => go(2)} disabled={submitting}>Back</button>
                <button className={`btn ${submitting ? 'btn--loading' : agreed ? 'btn--ready' : ''}`} onClick={submit} disabled={!agreed || submitting}>{submitting && <span className="spinner spinner--light" aria-hidden="true" />}{submitting ? 'Submitting…' : 'Submit application'}</button>
              </div>
            </section>
          )}

          {(step === 2 || step === 3) && !quote && (
            <section className="panel"><p className="placeholder"><span className="working"><span className="spinner" aria-hidden="true" />Refreshing your quotation…</span></p><div className="actions"><button className="btn btn--quiet" onClick={() => go(1)}>Back</button></div></section>
          )}
        </div>
        <div className="sticky">
          <ValuationSlip state={quoteState} weight={form.weight.trim()} karat={form.karat} selectedPlanId={planId} />
        </div>
      </div>
    </>
  );
}
