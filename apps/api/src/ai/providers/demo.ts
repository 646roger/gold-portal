import { randomUUID } from 'node:crypto';
import type { LlmProvider, LlmRequest, LlmResponse, Slots } from '../types';

/**
 * DEMO MODE: a deterministic, rule-based slot filler. It is NOT an AI model and the UI says so.
 * It emits real tool calls through the same agent loop and tools as the LLM provider, and every
 * figure it prints is copied from a tool result.
 */
const inr = (s: string) => {
  const [int = '0', dec] = s.split('.');
  const neg = int.startsWith('-');
  const digits = neg ? int.slice(1) : int;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `₹${neg ? '-' : ''}${rest ? `${rest},${last3}` : last3}${dec && Number(dec) !== 0 ? `.${dec}` : ''}`;
};

const OFF_TOPIC = /\b(invest(?:ment|ing)?|stocks?|shares?|crypto|bitcoin|mutual funds?|sip|nifty|sensex|forex|trading|lottery|joke|weather|recipe|poem|movie|politics|football|cricket score)\b/i;
const LOAN_WORDS = /\b(loan|quote|apply|application)\b/i;
const GUARANTEE = /\b(guarantee|guaranteed|definitely approve|sure to (?:be )?approved?|will i (?:get|be approved))\b/i;
const SCHEME_Q = /\b(plans?|schemes?|differen(?:ce|t)|compare|comparison|bullet|emi|interest rate|rates?|tenure|ltv)\b/i;

const tc = (name: string, args: unknown) => ({ id: randomUUID(), name, args });
const say = (text: string): LlmResponse => ({ text, toolCalls: [] });

function parseSlots(text: string, s: Slots): void {
  const w = text.match(/(\d+(?:\.\d+)?)\s*(?:g|gm|gms|gram|grams)\b/i);
  if (w?.[1]) s.netWeightGrams = w[1];
  const k = text.match(/(\d{1,2})\s*(?:k|kt|karat|karats|carat|carats)\b/i);
  if (k?.[1]) s.karat = Number(k[1]);
  const m = text.match(/(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/);
  if (m) s.mobileNumber = m[0];
  // A plan is only chosen when we asked for it or the user clearly picks one (not when comparing).
  const comparing = /\b(differen(?:ce|t)|compare|comparison|versus|vs)\b/i.test(text);
  const picking = s.awaiting === 'plan' || /\b(choose|pick|select|go with|take|apply for|want|prefer|switch|change)\b/i.test(text);
  if (picking && !comparing) {
    if (/\bbullet\b/i.test(text)) s.planId = 'PLAN_BULLET_01';
    else if (/\b(emi|monthly)\b/i.test(text)) s.planId = 'PLAN_EMI_01';
  }
  const n = text.match(/(?:my name is|i am|i'm|this is|name[:\s]+)\s+([\p{L}][\p{L}\p{M} .'-]{1,60})/iu);
  if (n?.[1]) s.fullName = n[1].trim().replace(/[.\s]+$/, '');

  // bare answers to the question we just asked
  const bare = text.trim();
  if (s.awaiting === 'weight' && /^\d+(?:\.\d+)?$/.test(bare)) s.netWeightGrams = bare;
  if (s.awaiting === 'karat' && /^\d{1,2}$/.test(bare)) s.karat = Number(bare);
  if (s.awaiting === 'mobile' && /^[\d\s+()-]{5,20}$/.test(bare)) s.mobileNumber = bare;
  if (s.awaiting === 'name' && !s.fullName && bare.length <= 80 && !/\d/.test(bare)) s.fullName = bare;
}

function ask(s: Slots, prefix = ''): LlmResponse {
  const p = prefix ? `${prefix} ` : '';
  if (!s.netWeightGrams) { s.awaiting = 'weight'; return say(`${p}What is the net weight of your gold, in grams?`); }
  if (s.karat === undefined) { s.awaiting = 'karat'; return say(`${p}What is the purity of your gold in karats (for example 22K or 18K)?`); }
  if (!s.planId) { s.awaiting = 'plan'; return say(`${p}Which plan would you like to apply for: Bullet Repayment or Monthly EMI?`); }
  if (!s.fullName) { s.awaiting = 'name'; return say(`${p}What is your full name?`); }
  if (!s.mobileNumber) { s.awaiting = 'mobile'; return say(`${p}What is your mobile number?`); }
  s.awaiting = null;
  return { text: '', toolCalls: [tc('submit_application', { fullName: s.fullName, mobileNumber: s.mobileNumber, netWeightGrams: Number(s.netWeightGrams), karat: s.karat, planId: s.planId })] };
}

const FIELD_TO_SLOT: Record<string, (s: Slots) => void> = {
  netWeightGrams: (s) => { delete s.netWeightGrams; delete s.quotedKey; },
  karat: (s) => { delete s.karat; delete s.quotedKey; },
  fullName: (s) => { delete s.fullName; },
  mobileNumber: (s) => { delete s.mobileNumber; },
  planId: (s) => { delete s.planId; },
};

function afterTool(req: LlmRequest): LlmResponse {
  const s = req.state;
  const last = req.messages[req.messages.length - 1];
  if (!last || last.role !== 'tool') return say('How can I help with your gold loan?');
  const r = JSON.parse(last.content) as any;

  if (!r.ok) {
    if (r.error?.code === 'DUPLICATE_APPLICATION') {
      return say(`An application from this mobile number was already submitted in the last 7 days. Your original application ID is ${r.error.originalApplicationId}. A new one was not created.`);
    }
    if (r.error?.code === 'VALIDATION_ERROR' && r.error.fields) {
      const entries = Object.entries(r.error.fields as Record<string, string>);
      for (const [f] of entries) FIELD_TO_SLOT[f]?.(s);
      return ask(s, `That did not work: ${entries.map(([, m]) => m).join(' ')}`);
    }
    return say(`Sorry, I could not complete that (${r.error?.message ?? 'unexpected error'}). Nothing was submitted. Please try again in a moment.`);
  }

  if (last.name === 'get_loan_schemes') {
    const lines = (r.schemes as any[]).map((p) => `• ${p.name}: ${p.annualInterestRatePct}% a year, up to ${(Number(p.maxLtv) * 100).toFixed(0)}% of gold value, ${p.tenureMonths} months. ${p.repaymentDescription}`);
    return ask(s, `Here are the available plans:\n${lines.join('\n')}\nAmounts below are eligibility estimates, not an approval.`);
  }
  if (last.name === 'calculate_quote') {
    const q = r.quote;
    const per = (q.quotes as any[]).map((p) => `• ${p.planName}: eligible loan ${inr(p.eligibleLoanAmount)} at ${p.annualInterestRatePct}% a year`);
    const head = `For ${q.netWeightGrams} g at ${q.karat}K: pure gold ${q.pureGoldWeightGrams} g, gold value ${inr(q.goldValue)}.\n${per.join('\n')}\nThese are estimates and do not guarantee approval.`;
    return ask(s, head);
  }
  if (last.name === 'submit_application') {
    if (r.status === 'CONFIRMATION_REQUIRED') {
      const x = r.summary;
      return say(`Please review your application: ${x.fullName}, ${x.maskedMobile}; ${x.netWeightGrams} g at ${x.karat}K; ${x.planName}; gold value ${inr(x.goldValue)}; eligible loan ${inr(x.eligibleLoanAmount)} at ${x.annualInterestRatePct}% for ${x.tenureMonths} months. Nothing has been submitted yet. Press Confirm below, or reply "confirm" to submit. To change something, just tell me.`);
    }
    if (r.status === 'ALREADY_SUBMITTED') return say(`This application was already submitted. Your application ID is ${r.applicationId}.`);
  }
  return say('Done.');
}

export function createDemoProvider(): LlmProvider {
  return {
    name: 'demo-scripted',
    mode: 'demo',
    async complete(req: LlmRequest): Promise<LlmResponse> {
      const last = req.messages[req.messages.length - 1];
      if (last?.role === 'tool') return afterTool(req);
      const text = last?.role === 'user' ? last.content : '';
      const s = req.state;

      if (GUARANTEE.test(text)) {
        return say('I cannot guarantee approval. The amounts I show are eligibility estimates based on your gold and the plan terms, and the final decision rests with the lender.');
      }
      if (OFF_TOPIC.test(text) && !LOAN_WORDS.test(text)) {
        return say('I can only help with gold loan applications: plans, quotations and submitting an application. I cannot give investment advice or help with other topics. Shall we continue with your gold loan? What is the net weight of your gold, in grams?');
      }

      const hadWeightKarat = `${s.netWeightGrams}|${s.karat}`;
      const hadPlan = s.planId;
      const wasAwaitingPlan = s.awaiting === 'plan';
      parseSlots(text, s);
      const key = `${s.netWeightGrams}|${s.karat}`;
      const planJustPicked = wasAwaitingPlan && s.planId !== undefined && s.planId !== hadPlan;

      if (SCHEME_Q.test(text) && !planJustPicked && !(s.netWeightGrams && s.karat !== undefined && key !== hadWeightKarat)) {
        return { text: '', toolCalls: [tc('get_loan_schemes', {})] };
      }
      if (s.netWeightGrams && s.karat !== undefined && s.quotedKey !== key) {
        s.quotedKey = key;
        return { text: '', toolCalls: [tc('calculate_quote', { netWeightGrams: Number(s.netWeightGrams), karat: s.karat })] };
      }
      const fresh = !text || (!s.netWeightGrams && s.karat === undefined && !s.awaiting);
      return ask(s, fresh ? 'Hello! I can get you a gold loan quotation and help you apply. (Demo mode: scripted assistant.)' : '');
    },
  };
}
