import type { QuoteDto } from '@goldloan/shared';
import { quoteRequestSchema } from '@goldloan/shared';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';

export const QUOTE_DEBOUNCE_MS = 300;

export interface QuoteState {
  quote: QuoteDto | null;
  loading: boolean;
  error: string | null;
}

/**
 * Live quotation: validates locally with the SAME shared schema, debounces ~300 ms, aborts the
 * superseded request and ignores any response that is not for the latest input (no stale overwrite).
 */
export function useQuote(weight: string, karat: string): QuoteState {
  const [state, setState] = useState<QuoteState>({ quote: null, loading: false, error: null });
  const latest = useRef(0);

  useEffect(() => {
    const parsed = quoteRequestSchema.safeParse({ netWeightGrams: weight.trim(), karat: karat.trim() === '' ? undefined : Number(karat) });
    const ticket = ++latest.current;
    if (!parsed.success) {
      setState({ quote: null, loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const quote = await api.quote({ netWeightGrams: parsed.data.netWeightGrams, karat: parsed.data.karat }, controller.signal);
        if (ticket === latest.current) setState({ quote, loading: false, error: null });
      } catch (e) {
        if ((e as Error).name === 'AbortError' || ticket !== latest.current) return;
        setState({ quote: null, loading: false, error: e instanceof ApiError ? e.message : 'Could not fetch a quotation.' });
      }
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [weight, karat]);

  return state;
}
