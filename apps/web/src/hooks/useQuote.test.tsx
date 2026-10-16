import type { QuoteDto } from '@goldloan/shared';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUOTE_DEBOUNCE_MS, useQuote } from './useQuote';

const pending: { body: { netWeightGrams: string; karat: number }; resolve: (q: QuoteDto) => void; signal?: AbortSignal }[] = [];
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  api: { quote: (body: never, signal?: AbortSignal) => new Promise<QuoteDto>((resolve) => pending.push({ body, resolve, signal })) },
}));

const q = (goldValue: string): QuoteDto => ({ netWeightGrams: '1', karat: 22, pureGoldWeightGrams: '1', marketRatePerGram: '7000.00', goldValue, maxPermittedLtv: '0.7500', quotes: [] });

beforeEach(() => { vi.useFakeTimers(); pending.length = 0; });
afterEach(() => vi.useRealTimers());

describe('useQuote', () => {
  it('debounces ~300 ms and sends only the final input', async () => {
    const { rerender } = renderHook(({ w }) => useQuote(w, '22'), { initialProps: { w: '4' } });
    rerender({ w: '45' });
    await act(async () => { vi.advanceTimersByTime(QUOTE_DEBOUNCE_MS - 1); });
    expect(pending).toHaveLength(0);
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(pending).toHaveLength(1);
    expect(pending[0]!.body).toEqual({ netWeightGrams: '45', karat: 22 });
    expect(QUOTE_DEBOUNCE_MS).toBe(300);
  });

  it('never lets a stale response overwrite a newer quotation', async () => {
    const { result, rerender } = renderHook(({ w }) => useQuote(w, '22'), { initialProps: { w: '10' } });
    await act(async () => { vi.advanceTimersByTime(300); });
    rerender({ w: '20' });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(pending).toHaveLength(2);
    expect(pending[0]!.signal?.aborted).toBe(true); // superseded request is aborted…
    await act(async () => { pending[1]!.resolve(q('NEW')); });
    expect(result.current.quote?.goldValue).toBe('NEW');
    await act(async () => { pending[0]!.resolve(q('STALE')); }); // …and even if it still resolves late, it is ignored
    expect(result.current.quote?.goldValue).toBe('NEW');
    expect(result.current.loading).toBe(false);
  });

  it('makes no request and clears the quote while the input is invalid', async () => {
    const { result } = renderHook(() => useQuote('abc', '22'));
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(pending).toHaveLength(0);
    expect(result.current).toEqual({ quote: null, loading: false, error: null });
  });
});
