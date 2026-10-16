import type { LlmProvider, LlmRequest, LlmResponse, ToolCall } from '../../src/ai/types';

type Step = LlmResponse | ((req: LlmRequest) => LlmResponse);

/** Deterministic mock LLM: replays a fixed script and records every request it receives. */
export function scripted(steps: Step[]) {
  const calls: LlmRequest[] = [];
  let i = 0;
  const provider: LlmProvider = {
    name: 'scripted-mock',
    mode: 'llm',
    async complete(req) {
      calls.push(structuredClone(req));
      const step = steps[i++];
      if (!step) throw new Error('mock LLM script exhausted');
      return typeof step === 'function' ? step(req) : step;
    },
  };
  return { provider, calls };
}

let n = 0;
export const call = (name: string, args: unknown): ToolCall => ({ id: `call_${++n}`, name, args });
export const say = (text: string): LlmResponse => ({ text, toolCalls: [] });
export const useTools = (...toolCalls: ToolCall[]): LlmResponse => ({ text: '', toolCalls });
