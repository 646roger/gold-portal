import type { ChatSummaryDto, QuoteDto } from '@goldloan/shared';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { grams, inr, pct, pctFromFraction } from '../../lib/format';

interface UiMsg {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  quote?: QuoteDto;
  confirmation?: ChatSummaryDto;
  application?: { applicationId: string; duplicate: boolean };
  error?: boolean;
  retry?: string;
}

let seq = 0;
const STARTERS = ['What is the difference between the two plans?', 'I want a quote for my gold'];

function QuoteBlock({ q }: { q: QuoteDto }) {
  return (
    <div className="block" aria-label="Quotation from the calculator">
      <h3>Quotation · <span>estimate</span></h3>
      <dl className="dl">
        <div><dt>Net weight · purity</dt><dd>{q.netWeightGrams} g · {q.karat}K</dd></div>
        <div><dt>Pure gold</dt><dd>{grams(q.pureGoldWeightGrams)}</dd></div>
        <div><dt>Gold value</dt><dd>{inr(q.goldValue)}</dd></div>
        {q.quotes.map((p) => (
          <div key={p.planId}><dt>{p.planName} · {pct(p.annualInterestRatePct)}</dt><dd>{inr(p.eligibleLoanAmount)}</dd></div>
        ))}
      </dl>
    </div>
  );
}

function ConfirmBlock({ s, active, busy, onConfirm, onChange }: { s: ChatSummaryDto; active: boolean; busy: boolean; onConfirm: () => void; onChange: () => void }) {
  return (
    <div className="block" role="group" aria-label="Application review">
      <h3>Review before submitting</h3>
      <dl className="dl">
        <div><dt>Name</dt><dd>{s.fullName}</dd></div>
        <div><dt>Mobile</dt><dd>{s.maskedMobile}</dd></div>
        <div><dt>Gold</dt><dd>{s.netWeightGrams} g · {s.karat}K ({grams(s.pureGoldWeightGrams)} pure)</dd></div>
        <div><dt>Gold value</dt><dd>{inr(s.goldValue)}</dd></div>
        <div><dt>Plan</dt><dd>{s.planName}</dd></div>
        <div><dt>Rate · tenure</dt><dd>{pct(s.annualInterestRatePct)} · {s.tenureMonths} months</dd></div>
        <div><dt>Eligible loan amount</dt><dd>{inr(s.eligibleLoanAmount)}</dd></div>
      </dl>
      <p style={{ color: 'var(--muted)', marginTop: 'var(--s-2)' }}>An estimate, not an approval. Nothing is submitted until you confirm.</p>
      {active && (
        <div className="block__actions">
          <button className={`btn btn--sm ${busy ? 'btn--loading' : 'btn--ready'}`} onClick={onConfirm} disabled={busy}>{busy && <span className="spinner spinner--light" aria-hidden="true" />}Confirm &amp; submit</button>
          <button className="btn btn--sm btn--quiet" onClick={onChange} disabled={busy}>Change something</button>
        </div>
      )}
    </div>
  );
}

export function AssistantPanel() {
  const [msgs, setMsgs] = useState<UiMsg[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [mode, setMode] = useState<'llm' | 'demo' | null>(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');
  const [inputError, setInputError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { api.chatStatus().then((r) => setMode(r.mode)).catch(() => undefined); }, []);
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'end' }); }, [msgs, busy]);

  const push = (m: Omit<UiMsg, 'id'>) => setMsgs((cur) => [...cur, { ...m, id: ++seq }]);
  const lastConfirmId = [...msgs].reverse().find((m) => m.confirmation)?.id;
  const submittedAfter = (id: number) => msgs.some((m) => m.id > id && m.application);

  async function run(call: () => Promise<import('@goldloan/shared').ChatResponseDto>, retry?: string) {
    setBusy(true);
    try {
      const r = await call();
      setSessionId(r.sessionId);
      setMode(r.mode);
      for (const m of r.messages) push({ role: m.role, content: m.content, quote: r.quote, confirmation: r.confirmation, application: r.application });
    } catch (e) {
      const text = e instanceof ApiError ? e.message : 'Something went wrong.';
      push({ role: 'assistant', content: text, error: true, ...(retry ? { retry } : {}) });
    } finally {
      setBusy(false);
    }
  }

  function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    if (t.length > 1000) { setInputError('Please keep messages under 1000 characters.'); return; }
    setInputError('');
    push({ role: 'user', content: t });
    setInput('');
    void run(() => api.chat({ message: t, sessionId }), t);
  }

  const confirm = (hash: string) => { if (sessionId) void run(() => api.chatConfirm({ sessionId, summaryHash: hash })); };

  return (
    <section className="chat" aria-labelledby="chat-title">
      <div className="chat__head">
        <h2 id="chat-title">Loan assistant</h2>
        {mode && <span className={`mode ${mode === 'demo' ? 'mode--demo' : ''}`}>{mode === 'demo' ? 'Demo mode · scripted, not AI' : 'AI assistant'}</span>}
      </div>
      {mode === 'demo' && (
        <p className="notice notice--warn" style={{ margin: 'var(--s-3) var(--s-4) 0' }}>
          Demo mode: this is a deterministic scripted assistant, not an AI model. It uses the same quotation and submission services as the form. To use a real model for free, point the server at local Ollama or a free-tier host (see README).
        </p>
      )}
      <div className="chat__log" role="log" aria-live="polite" aria-label="Conversation">
        {msgs.length === 0 && (
          <div>
            <p style={{ color: 'var(--muted)' }}>Ask about the loan plans, get a quotation, or apply. I will ask one question at a time, and every amount comes from the same calculator as the form.</p>
            <div className="chips" style={{ marginTop: 'var(--s-3)' }}>
              {STARTERS.map((s) => <button key={s} className="chip" onClick={() => send(s)} disabled={busy}>{s}</button>)}
            </div>
          </div>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={`msg msg--${m.role} ${m.error ? 'msg--error' : ''}`}>
            <div className="msg__bubble">{m.content}</div>
            {m.quote && <QuoteBlock q={m.quote} />}
            {m.confirmation && (
              <ConfirmBlock s={m.confirmation} busy={busy} active={m.id === lastConfirmId && !submittedAfter(m.id)} onConfirm={() => confirm(m.confirmation!.hash)} onChange={() => inputRef.current?.focus()} />
            )}
            {m.application && (
              <div className="block" role="status">
                <h3>{m.application.duplicate ? 'Existing application' : 'Application submitted'}</h3>
                <p className="appid">{m.application.applicationId}</p>
              </div>
            )}
            {m.retry && <button className="btn btn--sm btn--quiet" onClick={() => send(m.retry!)} disabled={busy}>Try again</button>}
          </div>
        ))}
        {busy && <div className="working" role="status"><span className="typing" aria-hidden="true"><i /><i /><i /></span>Checking live plan data and calculating…</div>}
        <div ref={endRef} />
      </div>
      <form className="chat__form" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <label htmlFor="chat-input" className="sr-only">Message</label>
        <input id="chat-input" ref={inputRef} className="input" value={input} maxLength={1000} autoComplete="off" placeholder="Type your message…" onChange={(e) => setInput(e.target.value)} aria-invalid={inputError ? true : undefined} aria-describedby="chat-err" />
        <button className={`btn ${busy ? 'btn--loading' : ''}`} type="submit" disabled={busy || !input.trim()}>{busy && <span className="spinner spinner--light" aria-hidden="true" />}Send</button>
      </form>
      <p id="chat-err" className="err" style={{ padding: '0 var(--s-4) var(--s-2)' }} role={inputError ? 'alert' : undefined}>{inputError}</p>
    </section>
  );
}
