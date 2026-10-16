import { describe, expect, it } from 'vitest';
import { createAnthropicProvider, toAnthropicMessages } from '../../src/ai/providers/anthropic';
import { loadEnv } from '../../src/config/env';
import { TOOL_SPECS } from '../../src/ai/tools';
import { ProviderError, type Msg } from '../../src/ai/types';

const REQ = { system: 'SYS', tools: TOOL_SPECS, state: {}, messages: [{ role: 'user', content: 'hi' }] as Msg[] };
const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const make = (fetchImpl: typeof fetch, timeoutMs = 1000) =>
  createAnthropicProvider({ apiKey: 'sk-test-SECRET', model: 'm-1', baseUrl: 'https://llm.example/', timeoutMs, fetchImpl });

describe('Anthropic tool-calling adapter (fake fetch — no network, no real key)', () => {
  it('sends the key only as a header, with tools, and parses text + tool_use blocks', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const p = make(async (url, init) => {
      seen = { url: String(url), init: init! };
      return jsonRes({ content: [{ type: 'text', text: ' Let me check. ' }, { type: 'tool_use', id: 'tu_1', name: 'calculate_quote', input: { netWeightGrams: 45, karat: 22 } }] });
    });
    const out = await p.complete(REQ);
    expect(out).toEqual({ text: 'Let me check.', toolCalls: [{ id: 'tu_1', name: 'calculate_quote', args: { netWeightGrams: 45, karat: 22 } }] });
    expect(seen!.url).toBe('https://llm.example/v1/messages');
    const headers = seen!.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-test-SECRET');
    const body = JSON.parse(String(seen!.init.body));
    expect(JSON.stringify(body)).not.toContain('sk-test-SECRET'); // never in the payload
    expect(body.tools.map((t: { name: string }) => t.name)).toEqual(['get_loan_schemes', 'calculate_quote', 'submit_application']);
    expect(body.system).toBe('SYS');
  });

  it('groups consecutive tool results into one user turn and pairs them with tool_use ids', () => {
    const msgs: Msg[] = [
      { role: 'user', content: 'quote' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'get_loan_schemes', args: {} }, { id: 'b', name: 'calculate_quote', args: { netWeightGrams: 1, karat: 22 } }] },
      { role: 'tool', toolCallId: 'a', name: 'get_loan_schemes', content: '{"ok":true}' },
      { role: 'tool', toolCallId: 'b', name: 'calculate_quote', content: '{"ok":true}' },
    ];
    const out = toAnthropicMessages(msgs);
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(out[2]!.content.map((b) => (b as { tool_use_id: string }).tool_use_id)).toEqual(['a', 'b']);
  });

  it('maps HTTP failures to ProviderError without leaking the response body', async () => {
    const p = make(async () => jsonRes({ error: { message: 'invalid x-api-key sk-test-SECRET' } }, 401));
    const err = await p.complete(REQ).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.status).toBe(401);
    expect(String(err.message)).not.toContain('SECRET');
  });

  it('times out slow providers', async () => {
    const p = make((_url, init) => new Promise((_res, rej) => init!.signal!.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' })))), 30);
    await expect(p.complete(REQ)).rejects.toThrow(/timed out/);
  });

  it('wraps network errors', async () => {
    await expect(make(async () => { throw new TypeError('fetch failed'); }).complete(REQ)).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('environment validation', () => {
  const base = { DATABASE_URL: 'x', ADMIN_API_KEY: 'a'.repeat(20) };
  it('rejects invalid environment at startup', () => {
    expect(() => loadEnv({ DATABASE_URL: 'x', ADMIN_API_KEY: 'short' })).toThrow(/ADMIN_API_KEY/);
    expect(() => loadEnv({ ADMIN_API_KEY: 'a'.repeat(20) })).toThrow(/DATABASE_URL/);
  });
});
