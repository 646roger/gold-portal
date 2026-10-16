/** Display-only helpers. All numbers arrive from the API as decimal strings; we never do money maths here. */

/** "216562" → "₹2,16,562"; "25666.67" → "₹25,666.67" (Indian digit grouping, string based). */
export function inr(value: string | undefined | null): string {
  if (value === undefined || value === null || value === '') return '—';
  const neg = value.startsWith('-');
  const [intRaw = '0', dec] = (neg ? value.slice(1) : value).split('.');
  const last3 = intRaw.slice(-3);
  const rest = intRaw.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const grouped = rest ? `${rest},${last3}` : last3;
  const fraction = dec && Number(dec) !== 0 ? `.${dec}` : '';
  return `${neg ? '-' : ''}₹${grouped}${fraction}`;
}

/** "41.250000" → "41.25 g" (trailing zeros trimmed, max 4 decimals shown) */
export function grams(value: string | undefined | null): string {
  if (!value) return '—';
  const [i = '0', d = ''] = value.split('.');
  const trimmed = d.slice(0, 4).replace(/0+$/, '');
  return `${i}${trimmed ? `.${trimmed}` : ''} g`;
}

/** "0.7500" → "75%" ; "10.50" → "10.5%" */
export const pctFromFraction = (f: string) => `${parseFloat((Number(f) * 100).toFixed(2))}%`;
export const pct = (p: string) => `${parseFloat(Number(p).toFixed(2))}%`;

export function dateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}
