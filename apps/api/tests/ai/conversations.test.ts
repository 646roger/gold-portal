import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { loadEnv } from '../../src/config/env';
import { createDemoProvider } from '../../src/ai/providers/demo';
import type { LlmProvider, Msg } from '../../src/ai/types';
import { createPrisma } from '../../src/lib/prisma';
import { resetDatabase, validLead } from '../helpers/context';
import { call, say, scripted, useTools } from '../helpers/scripted';

const env = loadEnv();
const db = createPrisma(env.DATABASE_URL);
const appWith = (llm: LlmProvider) => createApp({ db, env, llm });
beforeEach(async () => resetDatabase(db));
afterAll(async () => db.$disconnect());

const LEAD_ARGS = { fullName: 'Asha Verma', mobileNumber: '9876543210', netWeightGrams: 45, karat: 22, planId: 'PLAN_EMI_01' };

async function send(app: ReturnType<typeof appWith>, message: string, sessionId?: string) {
  const res = await request(app).post('/api/v1/chat').send({ message, sessionId }).expect(200);
  return res.body as import('@goldloan/shared').ChatResponseDto;
}
async function toolResults(sessionId: string): Promise<{ name: string; result: any }[]> {
  const row = await db.chatSession.findUniqueOrThrow({ where: { id: sessionId } });
  return (row.messages as unknown as Msg[]).filter((m) => m.role === 'tool').map((m) => ({ name: (m as any).name, result: JSON.parse((m as any).content) }));
}
const appCount = () => db.loanApplication.count();

describe('Conversation 1 — happy path: question → quote → review → explicit confirmation → submitted', () => {
  it('submits only after confirmation and returns the application ID', async () => {
    const { provider, calls } = scripted([
      useTools(call('get_loan_schemes', {}), call('calculate_quote', { netWeightGrams: 45, karat: 22 })),
      say('For 45 g at 22K your gold value is ₹2,88,750. Monthly EMI allows up to ₹2,16,562. Which plan would you like?'),
      useTools(call('submit_application', LEAD_ARGS)),
      say('Please review: Monthly EMI, eligible loan ₹2,16,562. Press Confirm to submit.'),
    ]);
    const app = appWith(provider);

    const t1 = await send(app, 'I want a loan against 45 g of 22K gold');
    expect(t1.mode).toBe('llm');
    expect(t1.toolsUsed).toEqual(['get_loan_schemes', 'calculate_quote']);
    expect(t1.quote).toMatchObject({ goldValue: '288750.00', pureGoldWeightGrams: '41.250000' });
    expect(t1.messages[0]!.content).toContain('₹2,16,562');

    const t2 = await send(app, "Monthly EMI. I'm Asha Verma, 9876543210", t1.sessionId);
    expect(t2.confirmation).toMatchObject({ planId: 'PLAN_EMI_01', eligibleLoanAmount: '216562', maskedMobile: '+91 XXXXXX3210' });
    expect(t2.application).toBeUndefined();
    expect(await appCount()).toBe(0); // reviewed, NOT submitted

    const t3 = await send(app, 'confirm', t2.sessionId); // typed confirmation, judged server-side
    expect(t3.application).toMatchObject({ duplicate: false, applicationId: expect.stringMatching(/^GL-/) });
    expect(t3.messages[0]!.content).toContain(t3.application!.applicationId);
    expect(await appCount()).toBe(1);
    const row = await db.loanApplication.findFirstOrThrow();
    expect(row).toMatchObject({ eligibleLoanPaise: 21656200n, mobileNumber: '9876543210', planId: 'PLAN_EMI_01', source: 'AGENT', applicationId: expect.stringMatching(/^GL-\d+$/) });
    expect(calls).toHaveLength(4); // the confirmation turn never needed (or trusted) the model
  });

  it('also works through the Confirm button endpoint', async () => {
    const { provider } = scripted([useTools(call('submit_application', LEAD_ARGS)), say('Please review and press Confirm.')]);
    const app = appWith(provider);
    const t1 = await send(app, 'please apply for me');
    const res = await request(app).post('/api/v1/chat/confirm').send({ sessionId: t1.sessionId, summaryHash: t1.confirmation!.hash }).expect(200);
    expect(res.body.application.applicationId).toMatch(/^GL-/);
    expect(await appCount()).toBe(1);
  });
});

describe('Conversation 2 — missing borrower information', () => {
  it('asks questions, rejects incomplete submit_application, creates nothing', async () => {
    const { provider } = scripted([
      say('Happy to help! What is the net weight of your gold in grams?'),
      useTools(call('submit_application', { fullName: 'Asha Verma', netWeightGrams: 45, karat: 22, planId: 'PLAN_EMI_01' })),
      say('I still need your mobile number. What is it?'),
    ]);
    const app = appWith(provider);
    const t1 = await send(app, 'I need a gold loan');
    expect(t1.toolsUsed).toEqual([]);
    const t2 = await send(app, 'Just submit it for me', t1.sessionId);
    const [submit] = await toolResults(t2.sessionId);
    expect(submit!.result).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fields: { mobileNumber: expect.any(String) } } });
    expect(t2.confirmation).toBeUndefined();
    expect(await appCount()).toBe(0);
  });
});

describe('Conversation 3 — invalid input (purity out of range; net weight above gross weight)', () => {
  it('surfaces tool validation errors without any quote or record', async () => {
    const { provider } = scripted([
      useTools(call('calculate_quote', { netWeightGrams: 20, karat: 30 })),
      say('Gold purity must be between 10K and 24K. What is the purity of your gold?'),
      useTools(call('submit_application', { ...LEAD_ARGS, netWeightGrams: 60, grossWeightGrams: 50 })),
      say('Net weight cannot be more than gross weight. Could you check both weights?'),
    ]);
    const app = appWith(provider);
    const t1 = await send(app, '20 grams of 30 karat gold');
    expect(t1.quote).toBeUndefined();
    const t2 = await send(app, 'net 60 g, gross 50 g, apply', t1.sessionId);
    const results = await toolResults(t2.sessionId);
    expect(results[0]!.result.error.fields.karat).toBeTruthy();
    expect(results[1]!.result.error.fields.netWeightGrams).toMatch(/gross/i);
    expect(t2.confirmation).toBeUndefined();
    expect(await appCount()).toBe(0);
  });
});

describe('Conversation 4 — duplicate application within seven days', () => {
  it('explains the duplicate using the original application ID and creates no second record', async () => {
    const first = await request(appWith(createDemoProvider())).post('/api/v1/leads').send(validLead()).expect(201);
    const { provider } = scripted([useTools(call('submit_application', LEAD_ARGS)), say('Please review and press Confirm.')]);
    const app = appWith(provider);
    const t1 = await send(app, 'apply with my details');
    const res = await request(app).post('/api/v1/chat/confirm').send({ sessionId: t1.sessionId, summaryHash: t1.confirmation!.hash }).expect(200);
    expect(res.body.application).toEqual({ applicationId: first.body.applicationId, duplicate: true });
    expect(res.body.messages[0].content).toContain(first.body.applicationId);
    expect(await appCount()).toBe(1);
  });
});

describe('Conversation 5 — off-topic / investment advice', () => {
  it('declines politely, calls no tools, and offers to continue with the loan', async () => {
    const app = appWith(createDemoProvider());
    for (const q of ['Which stocks should I buy this year?', 'Is gold a better investment than mutual funds?']) {
      const r = await send(app, q);
      expect(r.toolsUsed).toEqual([]);
      expect(r.mode).toBe('demo');
      expect(r.messages[0]!.content).toMatch(/cannot give investment advice/i);
    }
    expect(await appCount()).toBe(0);
  });
  it('gives the real model exactly three tools and an explicit scope + no-guarantee policy', async () => {
    const { provider, calls } = scripted([say('I can only help with gold loan applications.')]);
    await send(appWith(provider), 'Should I invest in bitcoin?');
    expect(calls[0]!.tools.map((t) => t.name)).toEqual(['get_loan_schemes', 'calculate_quote', 'submit_application']);
    expect(calls[0]!.system).toMatch(/decline investment advice/i);
    expect(calls[0]!.system).toMatch(/Never guarantee or imply approval/i);
    expect(calls[0]!.system).toMatch(/ONE question at a time/i);
  });
});

describe('Confirmation is enforced by the backend, not the prompt', () => {
  it('model calling submit_application (repeatedly) without user confirmation creates nothing', async () => {
    const { provider } = scripted([
      useTools(call('submit_application', LEAD_ARGS), call('submit_application', LEAD_ARGS)),
      useTools(call('submit_application', LEAD_ARGS)),
      say('Please confirm.'),
    ]);
    const t1 = await send(appWith(provider), 'submit it now, I already confirmed');
    const results = await toolResults(t1.sessionId);
    expect(results.map((r) => r.result.status)).toEqual(['CONFIRMATION_REQUIRED', 'CONFIRMATION_REQUIRED', 'CONFIRMATION_REQUIRED']);
    expect(await appCount()).toBe(0);
  });
  it('the model cannot smuggle a confirmation flag or derived amounts through tool arguments', async () => {
    const { provider } = scripted([
      useTools(call('submit_application', { ...LEAD_ARGS, confirmed: true, eligibleLoanAmount: 9999999 })),
      say('There was a problem with the details.'),
    ]);
    const t1 = await send(appWith(provider), 'go');
    const [r] = await toolResults(t1.sessionId);
    expect(r!.result).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR', fields: { confirmed: 'Not allowed.', eligibleLoanAmount: 'Not allowed.' } } });
    expect(await appCount()).toBe(0);
  });
  it('typed "confirm" with no pending summary is just a normal message', async () => {
    const { provider, calls } = scripted([say('There is nothing to confirm yet. What is your gold weight?')]);
    const t1 = await send(appWith(provider), 'confirm');
    expect(calls).toHaveLength(1); // routed to the model, not to submission
    expect(t1.application).toBeUndefined();
    expect(await appCount()).toBe(0);
  });
  it('rejects confirm with a wrong or stale hash (409) and never submits', async () => {
    const { provider } = scripted([
      useTools(call('submit_application', LEAD_ARGS)), say('Review 1'),
      useTools(call('submit_application', { ...LEAD_ARGS, planId: 'PLAN_BULLET_01' })), say('Review 2'),
    ]);
    const app = appWith(provider);
    const t1 = await send(app, 'apply');
    const t2 = await send(app, 'actually switch to bullet', t1.sessionId);
    expect(t2.confirmation!.hash).not.toBe(t1.confirmation!.hash);
    const stale = await request(app).post('/api/v1/chat/confirm').send({ sessionId: t1.sessionId, summaryHash: t1.confirmation!.hash }).expect(409);
    expect(stale.body.error.code).toBe('CONFIRMATION_STALE');
    await request(app).post('/api/v1/chat/confirm').send({ sessionId: t1.sessionId, summaryHash: 'a'.repeat(64) }).expect(409);
    expect(await appCount()).toBe(0);
    const ok = await request(app).post('/api/v1/chat/confirm').send({ sessionId: t1.sessionId, summaryHash: t2.confirmation!.hash }).expect(200);
    expect(ok.body.application.duplicate).toBe(false);
    expect((await db.loanApplication.findFirstOrThrow()).planId).toBe('PLAN_BULLET_01');
  });
  it('market rate change after review invalidates the confirmation (re-review required)', async () => {
    const { provider } = scripted([useTools(call('submit_application', LEAD_ARGS)), say('Review')]);
    const app = appWith(provider);
    const t1 = await send(app, 'apply');
    await db.marketRate.create({ data: { ratePerGramPaise: 710000n } });
    const res = await request(app).post('/api/v1/chat/confirm').send({ sessionId: t1.sessionId, summaryHash: t1.confirmation!.hash }).expect(200);
    expect(res.body.application).toBeUndefined();
    expect(res.body.confirmation.hash).not.toBe(t1.confirmation!.hash);
    expect(res.body.messages[0].content).toMatch(/Nothing was submitted/);
    expect(await appCount()).toBe(0);
  });
  it('repeated tool calls and concurrent confirms never create duplicates', async () => {
    const { provider } = scripted([useTools(call('submit_application', LEAD_ARGS)), say('Review'), useTools(call('submit_application', LEAD_ARGS), call('submit_application', LEAD_ARGS)), say('Done')]);
    const app = appWith(provider);
    const t1 = await send(app, 'apply');
    const body = { sessionId: t1.sessionId, summaryHash: t1.confirmation!.hash };
    const results = await Promise.all(Array.from({ length: 5 }, () => request(app).post('/api/v1/chat/confirm').send(body)));
    expect(results.filter((r) => r.status === 200 && r.body.application?.applicationId)).toHaveLength(1);
    expect(await appCount()).toBe(1);
    const again = await send(app, 'submit again please', t1.sessionId);
    const last = (await toolResults(again.sessionId)).slice(-2).map((r) => r.result.status);
    expect(last).toEqual(['ALREADY_SUBMITTED', 'ALREADY_SUBMITTED']);
    expect(await appCount()).toBe(1);
  });
});

describe('Tool argument validation and unknown tools', () => {
  it('rejects invalid calculate_quote arguments and unknown tool names', async () => {
    const { provider } = scripted([
      useTools(call('calculate_quote', { netWeightGrams: 'abc', karat: 22 }), call('calculate_quote', { netWeightGrams: 10, karat: 22, rate: 1 }), call('drop_tables', {})),
      say('Sorry, I could not calculate that.'),
    ]);
    const t1 = await send(appWith(provider), 'quote please');
    const r = await toolResults(t1.sessionId);
    expect(r[0]!.result.error.code).toBe('VALIDATION_ERROR');
    expect(r[1]!.result.error.fields.rate).toBe('Not allowed.');
    expect(r[2]!.result.error.code).toBe('UNKNOWN_TOOL');
    expect(t1.quote).toBeUndefined();
  });
});

describe('Monetary figures always originate from backend tool results', () => {
  it('blocks invented amounts and replaces them with safe text', async () => {
    const { provider } = scripted([say('Great news, you can get ₹5,00,000 today!')]);
    const t1 = await send(appWith(provider), 'how much can I get for 45g 22K?');
    expect(t1.messages[0]!.content).not.toContain('5,00,000');
    expect(t1.messages[0]!.content).toMatch(/quotation service/i);
    const row = await db.chatSession.findUniqueOrThrow({ where: { id: t1.sessionId } });
    expect(JSON.stringify(row.messages)).not.toContain('5,00,000'); // never re-enters history
  });
  it('blocks one wrong figure even when other figures are grounded', async () => {
    const { provider } = scripted([
      useTools(call('calculate_quote', { netWeightGrams: 45, karat: 22 })),
      say('Gold value ₹2,88,750; EMI plan loan ₹2,50,000.'),
    ]);
    const t1 = await send(appWith(provider), '45g 22k');
    expect(t1.messages[0]!.content).not.toContain('2,50,000');
    expect(t1.quote!.goldValue).toBe('288750.00'); // verified figures still delivered structurally
  });
  it('blocks an invented application ID', async () => {
    const { provider } = scripted([say('Submitted! Your application ID is GL-ABCDEFGH.')]);
    const t1 = await send(appWith(provider), 'did it go through?');
    expect(t1.messages[0]!.content).not.toContain('GL-ABCDEFGH');
  });
  it('a tool failure produces no invented numbers', async () => {
    const original = db.marketRate.findFirst;
    (db.marketRate as any).findFirst = async () => { throw new Error('boom'); };
    try {
      const { provider } = scripted([
        useTools(call('calculate_quote', { netWeightGrams: 45, karat: 22 })),
        say('It should be roughly ₹2,16,562.'), // model "guesses" after the failure
      ]);
      const t1 = await send(appWith(provider), 'quote for 45g 22k');
      const [r] = await toolResults(t1.sessionId);
      expect(r!.result).toMatchObject({ ok: false, error: { code: 'TOOL_FAILED' } });
      expect(t1.quote).toBeUndefined();
      expect(t1.messages[0]!.content).not.toContain('2,16,562');
    } finally {
      (db.marketRate as any).findFirst = original;
    }
  });
});

describe('Agent loop bounds and failure handling', () => {
  it('stops after the configured maximum number of tool iterations', async () => {
    const { provider, calls } = scripted(Array.from({ length: 20 }, () => useTools(call('get_loan_schemes', {}))));
    const t1 = await send(appWith(provider), 'loop forever');
    expect(calls).toHaveLength(env.LLM_MAX_TOOL_ITERATIONS);
    expect(t1.messages[0]!.content).toMatch(/could not finish/i);
    const row = await db.chatSession.findUniqueOrThrow({ where: { id: t1.sessionId } });
    expect((row.messages as any[]).at(-1).role).toBe('assistant');
  });
  it('returns 503 AI_UNAVAILABLE when the model provider fails, without persisting the turn', async () => {
    const { ProviderError } = await import('../../src/ai/types');
    const failing: LlmProvider = { name: 'down', mode: 'llm', complete: async () => { throw new ProviderError('timeout'); } };
    const res = await request(appWith(failing)).post('/api/v1/chat').send({ message: 'hello' }).expect(503);
    expect(res.body.error.code).toBe('AI_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toMatch(/timeout|stack/i);
  });
  it('validates chat input and caps message length', async () => {
    const app = appWith(createDemoProvider());
    const a = await request(app).post('/api/v1/chat').send({ message: '' }).expect(400);
    expect(a.body.error.fields.message).toBeTruthy();
    await request(app).post('/api/v1/chat').send({ message: 'x'.repeat(1001) }).expect(400);
    await request(app).post('/api/v1/chat').send({ message: 'hi', sessionId: 'not-a-uuid' }).expect(400);
  });
  it('an unknown (expired) sessionId starts a fresh session instead of failing', async () => {
    const r = await send(appWith(createDemoProvider()), 'hello', '00000000-0000-4000-8000-000000000000');
    expect(r.sessionId).not.toBe('00000000-0000-4000-8000-000000000000');
  });
});

describe('Demo mode (deterministic, clearly labelled) — full flow through the same tools', () => {
  it('goes from greeting to a submitted application', async () => {
    const app = appWith(createDemoProvider());
    const t1 = await send(app, 'Hi');
    expect(t1.mode).toBe('demo');
    expect(t1.messages[0]!.content).toMatch(/Demo mode/);
    const t2 = await send(app, '45 grams, 22K', t1.sessionId);
    expect(t2.quote!.quotes.find((q) => q.planId === 'PLAN_EMI_01')!.eligibleLoanAmount).toBe('216562');
    expect(t2.messages[0]!.content).toContain('₹2,16,562');
    expect(t2.messages[0]!.content).toContain('₹2,02,125');
    const t3 = await send(app, 'Monthly EMI', t2.sessionId);
    expect(t3.messages[0]!.content).toMatch(/full name/i);
    const t4 = await send(app, 'My name is Asha Verma', t3.sessionId);
    expect(t4.messages[0]!.content).toMatch(/mobile/i);
    const t5 = await send(app, '98765 43210', t4.sessionId);
    expect(t5.confirmation!.eligibleLoanAmount).toBe('216562');
    expect(await appCount()).toBe(0);
    const t6 = await send(app, 'yes, confirm', t5.sessionId);
    expect(t6.application!.applicationId).toMatch(/^GL-/);
    expect(await appCount()).toBe(1);
  });
  it('explains plans from live plan data and does not choose a plan when merely comparing', async () => {
    const app = appWith(createDemoProvider());
    const t1 = await send(app, 'What is the difference between bullet and EMI?');
    expect(t1.toolsUsed).toEqual(['get_loan_schemes']);
    expect(t1.messages[0]!.content).toContain('12.00%');
    expect(t1.messages[0]!.content).toContain('10.50%');
    const row = await db.chatSession.findUniqueOrThrow({ where: { id: t1.sessionId } });
    expect((row.slots as any).planId).toBeUndefined();
  });
  it('never guarantees approval', async () => {
    const t1 = await send(appWith(createDemoProvider()), 'Can you guarantee my loan will be approved?');
    expect(t1.messages[0]!.content).toMatch(/cannot guarantee approval/i);
  });
  it('recovers from invalid input by asking again', async () => {
    const app = appWith(createDemoProvider());
    const t1 = await send(app, '20 grams of 30 karat gold');
    expect(t1.quote).toBeUndefined();
    expect(t1.messages[0]!.content).toMatch(/between 10K and 24K/);
    expect(t1.messages[0]!.content).toMatch(/purity/i);
  });
  it('status endpoint reports the mode', async () => {
    const res = await request(appWith(createDemoProvider())).get('/api/v1/chat/status').expect(200);
    expect(res.body).toEqual({ mode: 'demo' });
  });
});
