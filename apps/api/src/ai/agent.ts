import { logger } from '../lib/logger';
import type { Db } from '../lib/prisma';
import { findUngroundedFigures } from './figureGuard';
import { SYSTEM_PROMPT } from './prompt';
import { executeTool, TOOL_SPECS } from './tools';
import type { ChatUi, LlmProvider, Msg, SessionState, ToolCall } from './types';

export const HISTORY_WINDOW = 30;
const MAX_TOOL_CALLS_PER_RESPONSE = 4;

export interface AgentDeps {
  db: Db;
  llm: LlmProvider;
  now?: () => Date;
  maxIterations: number;
}

export interface AgentResult {
  text: string;
  appended: Msg[];
  ui: ChatUi;
  toolsUsed: string[];
}

/** Keep the most recent messages, always starting at a user message so tool_use/tool_result pairs stay intact. */
export function windowHistory(messages: Msg[], size = HISTORY_WINDOW): Msg[] {
  if (messages.length <= size) return messages;
  const tail = messages.slice(-size);
  const firstUser = tail.findIndex((m) => m.role === 'user');
  return firstUser === -1 ? [] : tail.slice(firstUser);
}

export const UNGROUNDED_FALLBACK_WITH_QUOTE = 'I can only share amounts calculated by our quotation service. The verified figures are in the quotation shown above.';
export const UNGROUNDED_FALLBACK = 'I can only share loan figures that come from our quotation service. Tell me your gold\'s net weight in grams and its purity in karats, and I will fetch an exact quote.';
export const LOOP_FALLBACK = 'I could not finish that request. Please try again, or rephrase what you need.';

/** One user turn: the bounded model ↔ tool loop. `session.messages` must already contain the new user message. */
export async function runAgent(deps: AgentDeps, session: SessionState): Promise<AgentResult> {
  const ui: ChatUi = {};
  const toolsUsed: string[] = [];
  const appended: Msg[] = [];
  const working: Msg[] = [...session.messages];
  let text = '';
  let finished = false;

  for (let i = 0; i < deps.maxIterations; i++) {
    const res = await deps.llm.complete({ system: SYSTEM_PROMPT, messages: windowHistory(working), tools: TOOL_SPECS, state: session.slots });
    const calls: ToolCall[] = res.toolCalls.slice(0, MAX_TOOL_CALLS_PER_RESPONSE);
    const assistant: Msg = { role: 'assistant', content: res.text, ...(calls.length ? { toolCalls: calls } : {}) };
    working.push(assistant);
    appended.push(assistant);
    if (!calls.length) {
      text = res.text;
      finished = true;
      break;
    }
    for (const call of calls) {
      toolsUsed.push(call.name);
      const result = await executeTool(call.name, call.args, { db: deps.db, now: deps.now, confirmation: session.confirmation, ui });
      const toolMsg: Msg = { role: 'tool', toolCallId: call.id, name: call.name, content: JSON.stringify(result) };
      working.push(toolMsg);
      appended.push(toolMsg);
    }
  }

  if (!text.trim()) {
    text = LOOP_FALLBACK;
    // Never leave history ending in a tool result (loop cap hit, or the model returned empty text).
    if (finished) appended[appended.length - 1] = { role: 'assistant', content: text };
    else appended.push({ role: 'assistant', content: text });
  }

  const bad = findUngroundedFigures(text, working);
  if (bad.length) {
    logger.warn('ungrounded figures blocked', { count: bad.length });
    text = ui.quote ? UNGROUNDED_FALLBACK_WITH_QUOTE : UNGROUNDED_FALLBACK;
    // Replace the offending assistant text so it never re-enters the conversation history.
    for (let j = appended.length - 1; j >= 0; j--) {
      const m = appended[j]!;
      if (m.role === 'assistant' && !m.toolCalls) {
        appended[j] = { role: 'assistant', content: text };
        break;
      }
    }
  }
  return { text, appended, ui, toolsUsed };
}
