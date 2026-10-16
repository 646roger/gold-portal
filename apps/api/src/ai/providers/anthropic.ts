import { randomUUID } from 'node:crypto';
import { type LlmProvider, type LlmRequest, type LlmResponse, type Msg, ProviderError } from '../types';

interface Opts {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };

/** Provider-neutral history → Anthropic Messages API (consecutive tool results grouped in one user turn). */
export function toAnthropicMessages(messages: Msg[]): { role: 'user' | 'assistant'; content: Block[] }[] {
  const out: { role: 'user' | 'assistant'; content: Block[] }[] = [];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: [{ type: 'text', text: m.content }] });
    else if (m.role === 'assistant') {
      const content: Block[] = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls ?? []) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args ?? {} });
      if (content.length) out.push({ role: 'assistant', content });
    } else {
      const block: Block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
      const last = out[out.length - 1];
      if (last && last.role === 'user' && last.content.every((b) => b.type === 'tool_result')) last.content.push(block);
      else out.push({ role: 'user', content: [block] });
    }
  }
  return out;
}

/** Concrete tool-calling provider (Anthropic Messages API). The API key never leaves the server. */
export function createAnthropicProvider(opts: Opts): LlmProvider {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    name: `anthropic:${opts.model}`,
    mode: 'llm',
    async complete(req: LlmRequest): Promise<LlmResponse> {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
      try {
        const res = await doFetch(`${opts.baseUrl.replace(/\/$/, '')}/v1/messages`, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'content-type': 'application/json', 'x-api-key': opts.apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: opts.model,
            max_tokens: 1024,
            temperature: 0.2,
            system: req.system,
            messages: toAnthropicMessages(req.messages),
            tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
          }),
        });
        if (!res.ok) throw new ProviderError(`LLM request failed with HTTP ${res.status}`, res.status);
        const data = (await res.json()) as { content?: Block[] };
        let text = '';
        const toolCalls: LlmResponse['toolCalls'] = [];
        for (const b of data.content ?? []) {
          if (b.type === 'text') text += b.text;
          else if (b.type === 'tool_use') toolCalls.push({ id: b.id || randomUUID(), name: b.name, args: b.input });
        }
        return { text: text.trim(), toolCalls };
      } catch (e) {
        if (e instanceof ProviderError) throw e;
        if ((e as Error)?.name === 'AbortError') throw new ProviderError('LLM request timed out');
        throw new ProviderError('LLM request failed');
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
