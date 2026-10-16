import type { ApiErrorBody, ChatResponseDto, LeadCreatedDto, LeadListDto, LoanSchemeDto, QuoteDto } from '@goldloan/shared';

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

async function http<T>(path: string, init: RequestInit & { adminKey?: string } = {}): Promise<T> {
  const { adminKey, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/v1${path}`, {
      ...rest,
      headers: { 'Content-Type': 'application/json', ...(adminKey ? { 'x-admin-key': adminKey } : {}), ...(rest.headers ?? {}) },
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection and try again.');
  }
  const body = (await res.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  if (!res.ok) {
    const err = body?.error;
    throw new ApiError(res.status, err?.code ?? 'HTTP_ERROR', err?.message ?? 'Something went wrong. Please try again.', err?.fields, err?.details);
  }
  return body as T;
}

const post = (body: unknown, signal?: AbortSignal): RequestInit => ({ method: 'POST', body: JSON.stringify(body), signal });

export const api = {
  schemes: () => http<{ schemes: LoanSchemeDto[] }>('/loan-schemes').then((r) => r.schemes),
  quote: (body: { netWeightGrams: string; karat: number }, signal?: AbortSignal) => http<QuoteDto>('/quotes', post(body, signal)),
  createLead: (body: { fullName: string; mobileNumber: string; netWeightGrams: string; karat: number; planId: string }) =>
    http<LeadCreatedDto>('/leads', post(body)),
  leads: (qs: URLSearchParams, adminKey: string) => http<LeadListDto>(`/leads?${qs.toString()}`, { adminKey }),
  chatStatus: () => http<{ mode: 'llm' | 'demo' }>('/chat/status'),
  chat: (body: { message: string; sessionId?: string | undefined }) => http<ChatResponseDto>('/chat', post(body)),
  chatConfirm: (body: { sessionId: string; summaryHash: string }) => http<ChatResponseDto>('/chat/confirm', post(body)),
};
