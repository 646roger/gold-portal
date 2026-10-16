import { leadRequestSchema, quoteRequestSchema } from '@goldloan/shared';
import { z } from 'zod';
import { AppError, zodFields } from '../lib/errors';
import type { Db } from '../lib/prisma';
import { logger } from '../lib/logger';
import { createLead } from '../services/leadService';
import { findActivePlanTerms, listLoanSchemes } from '../services/planService';
import { getQuote } from '../services/quoteService';
import { buildSummary } from './confirmation';
import type { ChatUi, ConfirmationState, ToolSpec } from './types';

/* Strict argument schemas: unknown keys are rejected (the model must not smuggle derived amounts). */
const emptyArgs = z.object({}).strict();
const quoteArgsKeys = new Set(['netWeightGrams', 'karat']);
const submitArgsKeys = new Set(['fullName', 'mobileNumber', 'netWeightGrams', 'karat', 'planId', 'grossWeightGrams']);

function unknownKeys(args: unknown, allowed: Set<string>): string[] {
  return args && typeof args === 'object' && !Array.isArray(args) ? Object.keys(args).filter((k) => !allowed.has(k)) : [];
}

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'get_loan_schemes',
    description: 'Retrieve the currently active gold loan plans: ids, names, annual interest rates, maximum LTV, tenure and repayment structure. Always call this instead of quoting plan details from memory.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'calculate_quote',
    description: 'Calculate pure gold weight, gold value and the eligible loan amount for every active plan. This is the ONLY source of money figures; never calculate amounts yourself.',
    inputSchema: {
      type: 'object',
      properties: {
        netWeightGrams: { type: 'number', description: 'Net gold weight in grams (> 0, up to 3 decimals).' },
        karat: { type: 'integer', description: 'Gold purity in karats, e.g. 22 (10 to 24).' },
      },
      required: ['netWeightGrams', 'karat'],
      additionalProperties: false,
    },
  },
  {
    name: 'submit_application',
    description: 'Submit the loan application. The backend refuses to create a record until the borrower has explicitly confirmed the displayed summary. Calling this first returns CONFIRMATION_REQUIRED and a summary to show; only call it again after the user has confirmed.',
    inputSchema: {
      type: 'object',
      properties: {
        fullName: { type: 'string' },
        mobileNumber: { type: 'string', description: 'Indian mobile number' },
        netWeightGrams: { type: 'number' },
        karat: { type: 'integer' },
        planId: { type: 'string', description: 'A plan id returned by get_loan_schemes' },
        grossWeightGrams: { type: 'number', description: 'Optional gross weight; net must not exceed it.' },
      },
      required: ['fullName', 'mobileNumber', 'netWeightGrams', 'karat', 'planId'],
      additionalProperties: false,
    },
  },
];

export interface ToolContext {
  db: Db;
  now?: () => Date;
  confirmation: ConfirmationState;
  ui: ChatUi;
}

type ToolResult = Record<string, unknown> & { ok: boolean };

const fail = (code: string, message: string, extra: Record<string, unknown> = {}): ToolResult => ({ ok: false, error: { code, message, ...extra } });

function fromAppError(e: AppError): ToolResult {
  return fail(e.code, e.message, { ...(e.fields ? { fields: e.fields } : {}), ...(e.details ?? {}) });
}

/**
 * Executes a tool. Every tool delegates to the SAME services as the REST API. Results are plain
 * JSON; failures are returned as { ok:false, error } so the model can recover without inventing data.
 */
export async function executeTool(name: string, rawArgs: unknown, ctx: ToolContext): Promise<ToolResult> {
  try {
    switch (name) {
      case 'get_loan_schemes': {
        const p = emptyArgs.safeParse(rawArgs ?? {});
        if (!p.success) return fail('VALIDATION_ERROR', 'This tool takes no arguments.', { fields: zodFields(p.error) });
        return { ok: true, schemes: await listLoanSchemes(ctx.db) };
      }
      case 'calculate_quote': {
        const extra = unknownKeys(rawArgs, quoteArgsKeys);
        if (extra.length) return fail('VALIDATION_ERROR', 'Unexpected arguments.', { fields: Object.fromEntries(extra.map((k) => [k, 'Not allowed.'])) });
        const p = quoteRequestSchema.safeParse(rawArgs);
        if (!p.success) return fail('VALIDATION_ERROR', 'Please correct the highlighted fields.', { fields: zodFields(p.error) });
        const quote = await getQuote(ctx.db, p.data);
        ctx.ui.quote = quote;
        return { ok: true, quote };
      }
      case 'submit_application':
        return await submitApplication(rawArgs, ctx);
      default:
        return fail('UNKNOWN_TOOL', `Unknown tool "${name.slice(0, 40)}".`);
    }
  } catch (e) {
    if (e instanceof AppError) return fromAppError(e);
    logger.error('tool failed', { tool: name, name: (e as Error)?.name });
    return fail('TOOL_FAILED', 'The tool could not complete. Do not state any loan figures; tell the user to try again shortly.');
  }
}

async function submitApplication(rawArgs: unknown, ctx: ToolContext): Promise<ToolResult> {
  const extra = unknownKeys(rawArgs, submitArgsKeys);
  if (extra.length) return fail('VALIDATION_ERROR', 'Unexpected arguments.', { fields: Object.fromEntries(extra.map((k) => [k, 'Not allowed.'])) });
  const parsed = leadRequestSchema.safeParse(rawArgs);
  if (!parsed.success) return fail('VALIDATION_ERROR', 'Please correct the highlighted fields. No application was created.', { fields: zodFields(parsed.error) });
  const input = parsed.data;

  const plan = await findActivePlanTerms(ctx.db, input.planId);
  if (!plan) return fail('PLAN_NOT_FOUND', 'That loan plan does not exist or is no longer available. No application was created.');
  const quote = await getQuote(ctx.db, input, [plan]);
  const planQuote = quote.quotes[0];
  if (!planQuote) return fail('PLAN_UNAVAILABLE', 'That loan plan is currently unavailable. No application was created.');

  const summary = buildSummary(input, quote, planQuote);
  const conf = ctx.confirmation;

  // Idempotency: the same confirmed application is never created twice.
  if (conf.submittedHash === summary.hash && conf.submittedApplicationId) {
    ctx.ui.application = { applicationId: conf.submittedApplicationId, duplicate: false };
    return { ok: true, status: 'ALREADY_SUBMITTED', applicationId: conf.submittedApplicationId };
  }

  // SERVER-ENFORCED GATE: no explicit user confirmation of THIS exact summary → no database write.
  if (conf.confirmedHash !== summary.hash) {
    conf.pendingArgs = { ...input };
    conf.pendingHash = summary.hash;
    conf.pendingSummary = summary;
    ctx.ui.confirmation = summary;
    return {
      ok: true,
      status: 'CONFIRMATION_REQUIRED',
      summary,
      instruction:
        'NOT submitted. A review card with the summary and a Confirm button is now shown to the user. Briefly restate the summary using ONLY these figures and ask them to press Confirm or reply "confirm". Do not say the application was submitted.',
    };
  }

  // Confirmed for exactly this summary: consume the confirmation (single use) and submit.
  conf.confirmedHash = undefined;
  try {
    const created = await createLead({ db: ctx.db, now: ctx.now, source: 'AGENT' }, input);
    conf.submittedHash = summary.hash;
    conf.submittedApplicationId = created.applicationId;
    conf.pendingArgs = conf.pendingHash = conf.pendingSummary = undefined;
    ctx.ui.application = { applicationId: created.applicationId, duplicate: false };
    return { ok: true, status: 'SUBMITTED', applicationId: created.applicationId, eligibleLoanAmount: created.eligibleLoanAmount, planName: created.planName };
  } catch (e) {
    if (e instanceof AppError && e.code === 'DUPLICATE_APPLICATION') {
      const original = String(e.details?.originalApplicationId ?? '');
      conf.pendingArgs = conf.pendingHash = conf.pendingSummary = undefined;
      ctx.ui.application = { applicationId: original, duplicate: true };
      return fail('DUPLICATE_APPLICATION', e.message, { originalApplicationId: original });
    }
    throw e;
  }
}
