import { describe, expect, it } from 'vitest';
import { createOpenAiCompatibleProvider, toOpenAiMessages } from '../../src/ai/providers/openaiCompatible';
import { selectProvider } from '../../src/ai/providers';
import { loadEnv } from '../../src/config/env';
import { TOOL_SPECS } from '../../src/ai/tools';
import { ProviderError, type Msg } from '../../src/ai/types';

const REQ = { system: 'SYS', tools: TOOL_SPECS, state: {}, messages: [{ role: 'user', content: 'hi' }] as Msg[] };
const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const make = (fetchImpl: typeof fetch, extra: { apiKey?: string; timeoutMs?: number } = {}) =>
  createOpenAiCompatibleProvider({ baseUrl: 'http://localhost:11434/v1/', model: 'llama3.1', timeoutMs: extra.timeoutMs ?? 1000, fetchImpl, ...(extra.apiKey ? { apiKey: extra.apiKey } : {}) });

describe('OpenAI-compatible adapter (Ollama / Groq / Gemini / OpenRouter) — fake fetch', () => {
  it('works with NO api key (local Ollama): no authorization header', async () => {
    let init: RequestInit | undefined;
    const p = make(async (_u, i) => { init = i; return jsonRes({ choices: [{ message: { content: 'Hello' } }] }); });
    expect((await p.complete(REQ)).text).toBe('Hello');
    expect((init!.headers as Record<string, string>).authorization).toBeUndefined();
  });
  it('sends a key only as a bearer header when one is configured, plus the 3 tools', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const p = make(async (u, i) => { seen = { url: String(u), init: i! }; return jsonRes({ choices: [{ message: { content: '' } }] }); }, { apiKey: 'free-key-SECRET' });
    await p.complete(REQ);
    expect(seen!.url).toBe('http://localhost:11434/v1/chat/completions');
    expect((seen!.init.headers as Record<string, string>).authorization).toBe('Bearer free-key-SECRET');
    const body = JSON.parse(String(seen!.init.body));
    expect(JSON.stringify(body)).not.toContain('SECRET');
    expect(body.tools.map((t: { function: { name: string } }) => t.function.name)).toEqual(['get_loan_schemes', 'calculate_quote', 'submit_application']);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'SYS' });
  });
  it('parses tool_calls whether arguments are a JSON string or an object', async () => {
    const p = make(async () => jsonRes({ choices: [{ message: { content: null, tool_calls: [
      { id: 'c1', function: { name: 'calculate_quote', arguments: '{"netWeightGrams":45,"karat":22}' } },
      { id: 'c2', function: { name: 'get_loan_schemes', arguments: {} } },
    ] } }] }));
    expect((await p.complete(REQ)).toolCalls).toEqual([
      { id: 'c1', name: 'calculate_quote', args: { netWeightGrams: 45, karat: 22 } },
      { id: 'c2', name: 'get_loan_schemes', args: {} },
    ]);
  });
  it('malformed argument JSON from a small model becomes undefined args (tool validation rejects; nothing is guessed)', async () => {
    const p = make(async () => jsonRes({ choices: [{ message: { tool_calls: [{ id: 'x', function: { name: 'calculate_quote', arguments: '{"netWeightGrams": 45,' } }] } }] }));
    expect((await p.complete(REQ)).toolCalls[0]!.args).toBeUndefined();
  });
  it('converts history incl. assistant tool_calls and tool results', () => {
    const out = toOpenAiMessages('S', [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'calculate_quote', args: { karat: 22 } }] },
      { role: 'tool', toolCallId: 'a', name: 'calculate_quote', content: '{"ok":true}' },
    ]);
    expect(out[2]).toMatchObject({ role: 'assistant', content: null, tool_calls: [{ id: 'a', type: 'function', function: { name: 'calculate_quote', arguments: '{"karat":22}' } }] });
    expect(out[3]).toEqual({ role: 'tool', tool_call_id: 'a', content: '{"ok":true}' });
  });
  it('maps HTTP errors, empty responses, timeouts and network failures to ProviderError (no body leaked)', async () => {
    const e1 = await make(async () => jsonRes({ error: 'bad key SECRET' }, 401)).complete(REQ).catch((e) => e);
    expect(e1).toBeInstanceOf(ProviderError); expect(e1.status).toBe(401); expect(e1.message).not.toContain('SECRET');
    await expect(make(async () => jsonRes({ choices: [] })).complete(REQ)).rejects.toBeInstanceOf(ProviderError);
    await expect(make(async () => { throw new TypeError('ECONNREFUSED'); }).complete(REQ)).rejects.toBeInstanceOf(ProviderError);
    const slow = make((_u, i) => new Promise((_r, rej) => i!.signal!.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' })))), { timeoutMs: 30 });
    await expect(slow.complete(REQ)).rejects.toThrow(/timed out/);
  });
});

describe('free-first provider selection', () => {
  const base = { DATABASE_URL: 'x', ADMIN_API_KEY: 'a'.repeat(20) };
  it('no config → labelled demo mode (no key needed, no cost)', () => expect(selectProvider(loadEnv({ ...base })).mode).toBe('demo'));
  it('a stray paid key alone does NOT switch on a paid provider', () => expect(selectProvider(loadEnv({ ...base, LLM_API_KEY: 'k' })).mode).toBe('demo'));
  it('LLM_BASE_URL (e.g. Ollama) → real model, no key required', () => {
    const p = selectProvider(loadEnv({ ...base, LLM_BASE_URL: 'http://localhost:11434/v1', LLM_MODEL: 'qwen2.5' }));
    expect(p.mode).toBe('llm'); expect(p.name).toBe('openai-compatible:qwen2.5');
  });
  it('LLM_PROVIDER=openai defaults to local Ollama + llama3.1', () => expect(selectProvider(loadEnv({ ...base, LLM_PROVIDER: 'openai' })).name).toBe('openai-compatible:llama3.1'));
  it('empty values from a copied .env.example mean unset (still demo)', () => {
    expect(selectProvider(loadEnv({ ...base, LLM_BASE_URL: '', LLM_MODEL: '', LLM_API_KEY: '' })).mode).toBe('demo');
  });
  it('LLM_PROVIDER=demo forces demo', () => expect(selectProvider(loadEnv({ ...base, LLM_BASE_URL: 'http://x/v1', LLM_PROVIDER: 'demo' })).mode).toBe('demo'));
  it('paid Anthropic only when explicitly selected, and needs a key', () => {
    expect(() => selectProvider(loadEnv({ ...base, LLM_PROVIDER: 'anthropic' }))).toThrow(/LLM_API_KEY/);
    expect(selectProvider(loadEnv({ ...base, LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'k' })).name).toMatch(/^anthropic:/);
  });
});
