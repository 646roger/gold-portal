import type { ChatResponseDto } from '@goldloan/shared';
import { isExplicitConfirmation } from '../ai/confirmation';
import { runAgent, windowHistory, type AgentDeps } from '../ai/agent';
import { executeTool } from '../ai/tools';
import { ProviderError, type ChatUi, type ConfirmationState, type Msg, type SessionState } from '../ai/types';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

const PERSISTED_HISTORY = 60;

const locks = new Map<string, Promise<unknown>>();
/** Serialises turns within one session (in-process; use a DB/Redis lock if you scale to several API instances). */
async function withSessionLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  locks.set(id, run);
  try {
    return await run;
  } finally {
    if (locks.get(id) === run) locks.delete(id);
  }
}

async function loadSession(deps: AgentDeps, id: string | undefined): Promise<{ id: string; state: SessionState; isNew: boolean }> {
  if (id) {
    const row = await deps.db.chatSession.findUnique({ where: { id } });
    if (row) {
      return {
        id: row.id,
        isNew: false,
        state: {
          messages: (row.messages as unknown as Msg[]) ?? [],
          slots: (row.slots as SessionState['slots']) ?? {},
          confirmation: (row.confirmation as ConfirmationState) ?? {},
        },
      };
    }
  }
  const row = await deps.db.chatSession.create({ data: {} });
  return { id: row.id, isNew: true, state: { messages: [], slots: {}, confirmation: {} } };
}

async function saveSession(deps: AgentDeps, id: string, state: SessionState) {
  await deps.db.chatSession.update({
    where: { id },
    data: {
      messages: windowHistory(state.messages, PERSISTED_HISTORY) as never,
      slots: state.slots as never,
      confirmation: state.confirmation as never,
    },
  });
}

const response = (deps: AgentDeps, sessionId: string, text: string, ui: ChatUi, toolsUsed: string[]): ChatResponseDto => ({
  sessionId,
  mode: deps.llm.mode,
  messages: [{ role: 'assistant', content: text }],
  ...(ui.quote ? { quote: ui.quote } : {}),
  ...(ui.confirmation ? { confirmation: ui.confirmation } : {}),
  ...(ui.application ? { application: ui.application } : {}),
  toolsUsed,
});

export async function handleChatMessage(deps: AgentDeps, input: { sessionId?: string | undefined; message: string }): Promise<ChatResponseDto> {
  const session = await loadSession(deps, input.sessionId);
  return withSessionLock(session.id, async () => {
    // Re-load inside the lock so concurrent turns see each other's state.
    const { state } = session.isNew ? session : await loadSession(deps, session.id);
    const conf = state.confirmation;

    // Typed confirmation is judged on the USER's raw text, server-side — never on anything the model says.
    if (isExplicitConfirmation(input.message) && conf.pendingHash && conf.pendingArgs) {
      return confirmAndSubmit(deps, session.id, state, input.message, conf.pendingHash);
    }

    state.messages.push({ role: 'user', content: input.message });
    let result;
    try {
      result = await runAgent(deps, state);
    } catch (e) {
      if (e instanceof ProviderError) {
        logger.warn('llm failure', { status: e.status });
        throw new AppError(503, 'AI_UNAVAILABLE', 'The assistant is unavailable right now. You can continue with the guided form.');
      }
      throw e;
    }
    state.messages.push(...result.appended);
    await saveSession(deps, session.id, state);
    return response(deps, session.id, result.text, result.ui, result.toolsUsed);
  });
}

/** Button path: POST /chat/confirm. The summary hash must match the summary currently awaiting confirmation. */
export async function handleConfirm(deps: AgentDeps, input: { sessionId: string; summaryHash: string }): Promise<ChatResponseDto> {
  return withSessionLock(input.sessionId, async () => {
    const row = await deps.db.chatSession.findUnique({ where: { id: input.sessionId } });
    if (!row) throw new AppError(404, 'SESSION_NOT_FOUND', 'This chat session has expired. Please start again.');
    const { state } = await loadSession(deps, row.id);
    const conf = state.confirmation;
    if (!conf.pendingHash || !conf.pendingArgs || conf.pendingHash !== input.summaryHash) {
      throw new AppError(409, 'CONFIRMATION_STALE', 'That summary is out of date. Please review the latest summary before confirming.');
    }
    return confirmAndSubmit(deps, row.id, state, 'I confirm.', conf.pendingHash);
  });
}

async function confirmAndSubmit(deps: AgentDeps, sessionId: string, state: SessionState, userText: string, hash: string): Promise<ChatResponseDto> {
  const conf = state.confirmation;
  const ui: ChatUi = {};
  conf.confirmedHash = hash;
  let result: Record<string, unknown>;
  try {
    // Same guarded tool the model uses: it will itself re-verify that the confirmed hash matches the recomputed summary.
    result = await executeTool('submit_application', conf.pendingArgs, { db: deps.db, now: deps.now, confirmation: conf, ui });
  } finally {
    conf.confirmedHash = undefined;
  }

  let text: string;
  const err = result.error as { code?: string; message?: string; originalApplicationId?: string } | undefined;
  if (result.ok && (result.status === 'SUBMITTED' || result.status === 'ALREADY_SUBMITTED')) {
    text = `Your application has been submitted. Application ID: ${result.applicationId}. Please keep this ID for reference. Submission does not guarantee approval; the final decision rests with the lender.`;
    state.slots = {};
  } else if (result.ok && result.status === 'CONFIRMATION_REQUIRED') {
    text = 'Some figures changed since you last reviewed (for example the market rate). Nothing was submitted. Please review the updated summary and confirm again.';
  } else if (err?.code === 'DUPLICATE_APPLICATION') {
    text = `An application from this mobile number was already submitted in the last 7 days. Your original application ID is ${err.originalApplicationId}. A new one was not created.`;
    state.slots = {};
  } else {
    text = `I could not submit the application: ${err?.message ?? 'unexpected error'} Nothing was submitted.`;
  }
  state.messages.push({ role: 'user', content: userText }, { role: 'assistant', content: text });
  await saveSession(deps, sessionId, state);
  return response(deps, sessionId, text, ui, ['submit_application']);
}
