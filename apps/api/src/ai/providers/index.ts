import type { Env } from '../../config/env';
import type { LlmProvider } from '../types';
import { createAnthropicProvider } from './anthropic';
import { createDemoProvider } from './demo';
import { createOpenAiCompatibleProvider } from './openaiCompatible';

export const OLLAMA_DEFAULT_URL = 'http://localhost:11434/v1';
export const OLLAMA_DEFAULT_MODEL = 'llama3.1';

/**
 * Default is FREE: no key is ever required.
 *  - LLM_PROVIDER=openai (or auto + LLM_BASE_URL set): any OpenAI-compatible tool-calling server —
 *    local Ollama (no key), or a free tier of Groq / Gemini / OpenRouter.
 *  - LLM_PROVIDER=anthropic: optional paid provider, only when explicitly selected.
 *  - otherwise: clearly labelled deterministic demo mode.
 */
export function selectProvider(env: Env): LlmProvider {
  const kind = env.LLM_PROVIDER === 'auto' ? (env.LLM_BASE_URL ? 'openai' : 'demo') : env.LLM_PROVIDER;
  if (kind === 'openai') {
    return createOpenAiCompatibleProvider({
      baseUrl: env.LLM_BASE_URL ?? OLLAMA_DEFAULT_URL,
      model: env.LLM_MODEL ?? OLLAMA_DEFAULT_MODEL,
      apiKey: env.llmApiKey,
      timeoutMs: env.LLM_TIMEOUT_MS,
    });
  }
  if (kind === 'anthropic') {
    if (!env.llmApiKey) throw new Error('LLM_PROVIDER=anthropic requires LLM_API_KEY.');
    return createAnthropicProvider({ apiKey: env.llmApiKey, model: env.LLM_MODEL ?? 'claude-sonnet-5-5', baseUrl: env.LLM_BASE_URL ?? 'https://api.anthropic.com', timeoutMs: env.LLM_TIMEOUT_MS });
  }
  return createDemoProvider();
}
