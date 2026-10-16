import type { ChatSummaryDto, QuoteDto } from '@goldloan/shared';

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
}

export type Msg =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Slots are only used by the deterministic demo provider; real LLMs track state in conversation. */
export interface Slots {
  fullName?: string;
  mobileNumber?: string;
  netWeightGrams?: string;
  karat?: number;
  planId?: string;
  awaiting?: 'weight' | 'karat' | 'plan' | 'name' | 'mobile' | null;
  quotedKey?: string;
}

export interface LlmRequest {
  system: string;
  messages: Msg[];
  tools: ToolSpec[];
  state: Slots;
}

export interface LlmResponse {
  text: string;
  toolCalls: ToolCall[];
}

export interface LlmProvider {
  readonly name: string;
  /** 'demo' = deterministic scripted assistant (NOT an AI model). */
  readonly mode: 'llm' | 'demo';
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export class ProviderError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
  }
}

/** The confirmation state machine persisted with each chat session. */
export interface ConfirmationState {
  pendingArgs?: Record<string, unknown>;
  pendingHash?: string;
  pendingSummary?: ChatSummaryDto;
  confirmedHash?: string;
  submittedHash?: string;
  submittedApplicationId?: string;
}

export interface ChatUi {
  quote?: QuoteDto;
  confirmation?: ChatSummaryDto;
  application?: { applicationId: string; duplicate: boolean };
}

export interface SessionState {
  messages: Msg[];
  slots: Slots;
  confirmation: ConfirmationState;
}
