import type { LeadListDto, LoanSchemeDto } from '@goldloan/shared';
import { useEffect, useState, type CSSProperties } from 'react';
import { api, ApiError } from '../../lib/api';
import { dateTime, inr } from '../../lib/format';

const KEY = 'goldloan.adminKey';
const STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'];

export function AdminLeads() {
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem(KEY) ?? '');
  const [draftKey, setDraftKey] = useState('');
  const [schemes, setSchemes] = useState<LoanSchemeDto[]>([]);
  const [planId, setPlanId] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LeadListDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 15;

  useEffect(() => { api.schemes().then(setSchemes).catch(() => undefined); }, []);
  useEffect(() => { const t = setTimeout(() => { setQ(search.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [search]);

  useEffect(() => {
    if (!adminKey) return;
    let live = true;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (planId) qs.set('planId', planId);
    if (status) qs.set('status', status);
    if (q) qs.set('q', q);
    api.leads(qs, adminKey)
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) { setData(null); setError(e instanceof ApiError && e.status === 401 ? 'That access key was not accepted.' : e instanceof ApiError ? e.message : 'Could not load leads.'); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [adminKey, planId, status, q, page]);

  if (!adminKey) {
    return (
      <form className="panel panel--enter" style={{ maxWidth: 440 }} onSubmit={(e) => { e.preventDefault(); sessionStorage.setItem(KEY, draftKey); setAdminKey(draftKey); }}>
        <h2>Leads</h2>
        <p style={{ color: 'var(--muted)', marginBottom: 'var(--s-4)' }}>Enter the admin access key configured on the server (<code>ADMIN_API_KEY</code>). This is a local demo gate, not production authentication.</p>
        <div className="field">
          <label htmlFor="key">Admin access key</label>
          <input id="key" type="password" className="input" value={draftKey} onChange={(e) => setDraftKey(e.target.value)} autoComplete="off" />
        </div>
        <div className="actions"><span /><button className="btn" disabled={!draftKey}>Open leads</button></div>
      </form>
    );
  }

  const total = data?.total ?? 0;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <section aria-labelledby="leads-h">
      <div className="intro" style={{ marginBottom: 'var(--s-4)' }}><h1 id="leads-h" style={{ fontSize: 'var(--t-xl)' }}>Submitted leads</h1></div>
      <div className="toolbar">
        <div className="field grow"><label htmlFor="search">Search name or application ID</label><input id="search" className="input" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="field"><label htmlFor="plan">Plan</label>
          <select id="plan" className="input" value={planId} onChange={(e) => { setPlanId(e.target.value); setPage(1); }}>
            <option value="">All plans</option>
            {schemes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></div>
        <div className="field"><label htmlFor="status">Status</label>
          <select id="status" className="input" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select></div>
        <button className="btn btn--quiet" onClick={() => { sessionStorage.removeItem(KEY); setAdminKey(''); setData(null); }}>Lock</button>
      </div>

      {error && <p className="notice notice--err" role="alert">{error}</p>}
      {!error && (
        <div className="tablewrap" aria-busy={loading}>
          {loading && data && <div className="progress" role="progressbar" aria-label="Refreshing leads" />}
          <table>
            <thead><tr><th>Application</th><th>Borrower</th><th>Mobile</th><th className="num">Weight</th><th>Plan</th><th className="num">Eligible</th><th>Status</th><th>Submitted</th></tr></thead>
            <tbody>
              {loading && !data && Array.from({ length: 5 }, (_, i) => (
                <tr key={i} aria-hidden="true">{Array.from({ length: 8 }, (_, j) => <td key={j}><div className="skeleton" /></td>)}</tr>
              ))}
              {data?.items.map((r, i) => (
                <tr key={r.applicationId} className="row-in" style={{ '--i': i } as CSSProperties}>
                  <td data-label="Application" className="mono">{r.applicationId}</td>
                  <td data-label="Borrower">{r.fullName}</td>
                  <td data-label="Mobile" className="mono">{r.maskedMobile}</td>
                  <td data-label="Weight" className="num">{r.netWeightGrams} g · {r.karat}K</td>
                  <td data-label="Plan">{r.planName}</td>
                  <td data-label="Eligible" className="num"><b>{inr(r.eligibleLoanAmount)}</b></td>
                  <td data-label="Status"><span className={`status status--${r.status}`}>{r.status.replace('_', ' ')}</span></td>
                  <td data-label="Submitted">{dateTime(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.items.length === 0 && <p className="empty">{planId || status || q ? 'No leads match these filters.' : 'No applications yet. Submitted leads will appear here.'}</p>}
          <div className="pager">
            <span>{total === 0 ? '0 leads' : `Showing ${from}–${to} of ${total}`}</span>
            <span style={{ display: 'flex', gap: 'var(--s-2)' }}>
              <button className="btn btn--sm btn--quiet" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>Previous</button>
              <button className="btn btn--sm btn--quiet" disabled={to >= total || loading} onClick={() => setPage((p) => p + 1)}>Next</button>
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
