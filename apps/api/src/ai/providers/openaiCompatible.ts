import { randomUUID } from 'node:crypto';
import { type LlmProvider, type LlmRequest, type LlmResponse, type Msg, ProviderError } from '../types';

interface Opts {
  baseUrl: string; // e.g. http://localhost:11434/v1 (Ollama), https://api.groq.com/openai/v1
  model: string;
  apiKey?: string | undefined; // optional: local Ollama needs none
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

type OaMsg =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
  | { role: 'tool'; tool_call_id: string; content: string };

/** Provider-neutral history → OpenAI Chat Completions messages. */
export function toOpenAiMessages(system: string, messages: Msg[]): OaMsg[] {
  const out: OaMsg[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: m.content || null,
        ...(m.toolCalls?.length
          ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } })) }
          : {}),
      });
    } else out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
  }
  return out;
}

function parseArgs(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw ?? {}; // some servers return an object
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return undefined; // malformed JSON from a small model → tool validation rejects it, nothing is guessed
  }
}

/**
 * Works with any OpenAI-compatible Chat Completions server that supports tool calling:
 * Ollama (free, local), llama.cpp server, LM Studio, and free tiers of Groq / Gemini / OpenRouter.
 * Any key is sent only as a server-side Authorization header.
 */
export function createOpenAiCompatibleProvider(opts: Opts): LlmProvider {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    name: `openai-compatible:${opts.model}`,
    mode: 'llm',
    async complete(req: LlmRequest): Promise<LlmResponse> {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
      try {
        const res = await doFetch(`${opts.baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'content-type': 'application/json', ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}) },
          body: JSON.stringify({
            model: opts.model,
            temperature: 0.2,
            max_tokens: 1024,
            stream: false,
            messages: toOpenAiMessages(req.system, req.messages),
            tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })),
            tool_choice: 'auto',
          }),
        });
        if (!res.ok) throw new ProviderError(`LLM request failed with HTTP ${res.status}`, res.status);
        const data = (await res.json()) as {
          choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[] } }[];
        };
        const msg = data.choices?.[0]?.message;
        if (!msg) throw new ProviderError('LLM returned no message');
        const toolCalls = (msg.tool_calls ?? [])
          .filter((c) => c.function?.name)
          .map((c) => ({ id: c.id || randomUUID(), name: c.function!.name!, args: parseArgs(c.function!.arguments) }));
        return { text: (msg.content ?? '').trim(), toolCalls };
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
