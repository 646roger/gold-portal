import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_KEY, makeContext, resetDatabase, validLead } from '../helpers/context';

const clockBox = { now: new Date() };
const ctx = makeContext({}, () => new Date(clockBox.now));
const { app, db } = ctx;

beforeEach(async () => {
  clockBox.now = new Date();
  await resetDatabase(db);
});
afterAll(async () => db.$disconnect());

describe('GET /api/v1/loan-schemes', () => {
  it('returns both seeded plans from PostgreSQL', async () => {
    const res = await request(app).get('/api/v1/loan-schemes').expect(200);
    expect(res.body.schemes).toEqual([
      expect.objectContaining({ id: 'PLAN_BULLET_01', name: 'Bullet Repayment', annualInterestRatePct: '12.00', maxLtv: '0.7000', tenureMonths: 12, repaymentType: 'BULLET' }),
      expect.objectContaining({ id: 'PLAN_EMI_01', name: 'Monthly EMI', annualInterestRatePct: '10.50', maxLtv: '0.7500', tenureMonths: 12, repaymentType: 'EMI' }),
    ]);
  });
  it('omits inactive plans', async () => {
    await db.loanPlan.update({ where: { id: 'PLAN_BULLET_01' }, data: { isActive: false } });
    const res = await request(app).get('/api/v1/loan-schemes').expect(200);
    expect(res.body.schemes.map((s: { id: string }) => s.id)).toEqual(['PLAN_EMI_01']);
  });
});

describe('POST /api/v1/quotes', () => {
  it('returns the required figures for 45 g 22K for every active plan', async () => {
    const res = await request(app).post('/api/v1/quotes').send({ netWeightGrams: 45, karat: 22 }).expect(200);
    expect(res.body).toMatchObject({ pureGoldWeightGrams: '41.250000', goldValue: '288750.00', marketRatePerGram: '7000.00' });
    const by = Object.fromEntries(res.body.quotes.map((q: { planId: string }) => [q.planId, q]));
    expect(by.PLAN_EMI_01.eligibleLoanAmount).toBe('216562');
    expect(by.PLAN_BULLET_01.eligibleLoanAmount).toBe('202125');
    expect(by.PLAN_EMI_01.repaymentEstimate.isEstimate).toBe(true);
  });
  it('matches the 10 g 18K and 4 g 22K cases', async () => {
    const a = await request(app).post('/api/v1/quotes').send({ netWeightGrams: 10, karat: 18 }).expect(200);
    expect(a.body.quotes.find((q: { planId: string }) => q.planId === 'PLAN_EMI_01').eligibleLoanAmount).toBe('39375');
    const b = await request(app).post('/api/v1/quotes').send({ netWeightGrams: '4', karat: 22 }).expect(200);
    expect(b.body.pureGoldWeightGrams).toBe('3.666667');
    expect(b.body.quotes.find((q: { planId: string }) => q.planId === 'PLAN_EMI_01').eligibleLoanAmount).toBe('19250');
  });
  it('writes nothing to the database', async () => {
    await request(app).post('/api/v1/quotes').send({ netWeightGrams: 45, karat: 22 }).expect(200);
    expect(await db.loanApplication.count()).toBe(0);
  });
  it('ignores client-supplied derived values', async () => {
    const res = await request(app).post('/api/v1/quotes').send({ netWeightGrams: 45, karat: 22, goldValue: '1', eligibleLoanAmount: 99999999 }).expect(200);
    expect(res.body.goldValue).toBe('288750.00');
  });
  it.each([
    [{ netWeightGrams: 0, karat: 22 }, 'netWeightGrams'],
    [{ netWeightGrams: -5, karat: 22 }, 'netWeightGrams'],
    [{ netWeightGrams: 'abc', karat: 22 }, 'netWeightGrams'],
    [{ karat: 22 }, 'netWeightGrams'],
    [{ netWeightGrams: 10, karat: 30 }, 'karat'],
    [{ netWeightGrams: 10, karat: 22.5 }, 'karat'],
    [{ netWeightGrams: 10 }, 'karat'],
    [{ netWeightGrams: 60, grossWeightGrams: 50, karat: 22 }, 'netWeightGrams'],
  ])('rejects %j with a field-level 400', async (body, field) => {
    const res = await request(app).post('/api/v1/quotes').send(body).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields[field]).toEqual(expect.any(String));
  });
  it('accepts 52 g net with 550 g gross (no invented restriction)', async () => {
    await request(app).post('/api/v1/quotes').send({ netWeightGrams: 52, grossWeightGrams: 550, karat: 22 }).expect(200);
  });
  it('the database itself refuses a plan with LTV above 75% (CHECK max_ltv_percent <= 75)', async () => {
    await expect(
      db.loanPlan.create({ data: { id: 'PLAN_BAD', name: 'Bad', repaymentType: 'EMI', annualInterestRate: '10.00', maxLtvPercent: '90.00', tenureMonths: 12 } }),
    ).rejects.toThrow();
    // The domain-level 75% cap (defence in depth) is covered in tests/domain/quote.test.ts.
    const res = await request(app).post('/api/v1/quotes').send({ netWeightGrams: 45, karat: 22 }).expect(200);
    expect(res.body.quotes.every((q: { appliedLtv: string }) => Number(q.appliedLtv) <= 0.75)).toBe(true);
  });
  it('returns consistent errors for malformed JSON', async () => {
    const res = await request(app).post('/api/v1/quotes').set('Content-Type', 'application/json').send('{bad').expect(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });
  it('rejects oversized bodies with 413', async () => {
    const res = await request(app).post('/api/v1/quotes').send({ netWeightGrams: 1, karat: 22, junk: 'x'.repeat(20000) }).expect(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('POST /api/v1/leads', () => {
  it('creates an application (201) and stores a server-computed snapshot', async () => {
    const res = await request(app).post('/api/v1/leads').send(validLead()).expect(201);
    expect(res.body.applicationId).toMatch(/^GL-\d{4,}$/); // generated by the DB sequence
    expect(res.body).toMatchObject({ status: 'SUBMITTED', eligibleLoanAmount: '216562', goldValue: '288750.00' });
    const row = await db.loanApplication.findUniqueOrThrow({ where: { applicationId: res.body.applicationId } });
    expect(row.mobileNumber).toBe('9876543210'); // bare 10 digits in the DB
    expect(row.eligibleLoanPaise).toBe(21656200n); // ₹2,16,562 in paise
    expect(row.goldValuePaise).toBe(28875000n);
    expect(row.rate24kPerGramPaise).toBe(700000n);
    expect(row.pureGoldGrams.toString()).toBe('41.25');
    expect(row).toMatchObject({ planId: 'PLAN_EMI_01', source: 'FORM', status: 'SUBMITTED' });
    expect(row.interestRateSnapshot.toString()).toBe('10.5');
    expect(row.maxLtvPercentSnapshot.toString()).toBe('75');
  });
  it('recalculates server-side: tampered client amounts are ignored', async () => {
    const res = await request(app).post('/api/v1/leads').send(validLead({ eligibleLoanAmount: 9999999, goldValue: '9999999.00', pureGoldWeightGrams: '1', ltv: 0.99 })).expect(201);
    expect(res.body.eligibleLoanAmount).toBe('216562');
    const row = await db.loanApplication.findUniqueOrThrow({ where: { applicationId: res.body.applicationId } });
    expect(row.eligibleLoanPaise).toBe(21656200n);
  });
  it('uses the selected plan (Bullet → ₹2,02,125)', async () => {
    const res = await request(app).post('/api/v1/leads').send(validLead({ planId: 'PLAN_BULLET_01' })).expect(201);
    expect(res.body.eligibleLoanAmount).toBe('202125');
  });
  it.each(['12345', 'abcdefghij', '5876543210', '', '+1 9876543210'])('rejects invalid mobile %j with 400 + field error', async (mobile) => {
    const res = await request(app).post('/api/v1/leads').send(validLead({ mobileNumber: mobile })).expect(400);
    expect(res.body.error.fields.mobileNumber).toBeTruthy();
    expect(await db.loanApplication.count()).toBe(0);
  });
  it('rejects missing name / weight / purity / plan together', async () => {
    const res = await request(app).post('/api/v1/leads').send({}).expect(400);
    expect(Object.keys(res.body.error.fields)).toEqual(expect.arrayContaining(['fullName', 'mobileNumber', 'netWeightGrams', 'karat', 'planId']));
  });
  it('returns 404 for an unknown plan', async () => {
    const res = await request(app).post('/api/v1/leads').send(validLead({ planId: 'PLAN_NOPE_99' })).expect(404);
    expect(res.body.error.code).toBe('PLAN_NOT_FOUND');
    expect(await db.loanApplication.count()).toBe(0);
  });
  it('returns 404 for an inactive plan', async () => {
    await db.loanPlan.update({ where: { id: 'PLAN_EMI_01' }, data: { isActive: false } });
    await request(app).post('/api/v1/leads').send(validLead()).expect(404);
  });
  it('returns 409 + the original application ID for a repeat within 7 days (any phone format)', async () => {
    const first = await request(app).post('/api/v1/leads').send(validLead()).expect(201);
    const second = await request(app).post('/api/v1/leads').send(validLead({ mobileNumber: '+91 98765-43210', planId: 'PLAN_BULLET_01' })).expect(409);
    expect(second.body.error.code).toBe('DUPLICATE_APPLICATION');
    expect(second.body.error.details.originalApplicationId).toBe(first.body.applicationId);
    expect(await db.loanApplication.count()).toBe(1);
  });
  it('still blocks on day 6 and allows again after the 7-day window', async () => {
    clockBox.now = new Date('2026-10-01T10:00:00Z');
    const first = await request(app).post('/api/v1/leads').send(validLead()).expect(201);
    clockBox.now = new Date('2026-10-07T09:59:00Z');
    const blocked = await request(app).post('/api/v1/leads').send(validLead()).expect(409);
    expect(blocked.body.error.details.originalApplicationId).toBe(first.body.applicationId);
    clockBox.now = new Date('2026-10-08T10:01:00Z');
    await request(app).post('/api/v1/leads').send(validLead()).expect(201);
    expect(await db.loanApplication.count()).toBe(2);
  });
  it('different mobile numbers are independent', async () => {
    await request(app).post('/api/v1/leads').send(validLead()).expect(201);
    await request(app).post('/api/v1/leads').send(validLead({ mobileNumber: '9123456780' })).expect(201);
  });
  it('concurrent duplicate submissions: exactly one succeeds', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => request(app).post('/api/v1/leads').send(validLead())));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(11);
    expect(await db.loanApplication.count()).toBe(1);
    const winner = results.find((r) => r.status === 201)!.body.applicationId;
    for (const r of results.filter((x) => x.status === 409)) expect(r.body.error.details.originalApplicationId).toBe(winner);
  });
  it('historical snapshot is immutable when plan terms change later', async () => {
    const res = await request(app).post('/api/v1/leads').send(validLead()).expect(201);
    await db.loanPlan.update({ where: { id: 'PLAN_EMI_01' }, data: { annualInterestRate: '15.00', maxLtvPercent: '50.00' } });
    const row = await db.loanApplication.findUniqueOrThrow({ where: { applicationId: res.body.applicationId } });
    expect(row.interestRateSnapshot.toString()).toBe('10.5');
    expect(row.maxLtvPercentSnapshot.toString()).toBe('75');
    expect(row.eligibleLoanPaise).toBe(21656200n);
  });
});

describe('GET /api/v1/leads (admin)', () => {
  it('requires the admin key', async () => {
    await request(app).get('/api/v1/leads').expect(401);
    await request(app).get('/api/v1/leads').set('x-admin-key', 'wrong-key-wrong-key-1').expect(401);
  });
  it('lists newest first with masked mobiles and no full numbers anywhere', async () => {
    clockBox.now = new Date('2026-10-01T00:00:00Z');
    await request(app).post('/api/v1/leads').send(validLead({ fullName: 'First Person' })).expect(201);
    clockBox.now = new Date('2026-10-02T00:00:00Z');
    await request(app).post('/api/v1/leads').send(validLead({ fullName: 'Second Person', mobileNumber: '9123456780', planId: 'PLAN_BULLET_01' })).expect(201);
    const res = await request(app).get('/api/v1/leads').set('x-admin-key', ADMIN_KEY).expect(200);
    expect(res.body.items.map((i: { fullName: string }) => i.fullName)).toEqual(['Second Person', 'First Person']);
    expect(res.body.items[0]).toMatchObject({ maskedMobile: '+91 XXXXXX6780', planName: 'Bullet Repayment', status: 'SUBMITTED', eligibleLoanAmount: '202125' });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('9876543210');
    expect(raw).not.toContain('9123456780');
  });
  it('filters by plan and status, searches and paginates', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app).post('/api/v1/leads').send(validLead({ fullName: `Person ${'ABC'[i]}`, mobileNumber: `91234567${i}0`, planId: i === 0 ? 'PLAN_BULLET_01' : 'PLAN_EMI_01' })).expect(201);
    }
    await db.loanApplication.updateMany({ where: { fullName: 'Person C' }, data: { status: 'REJECTED' } });
    const get = (qs: string) => request(app).get(`/api/v1/leads?${qs}`).set('x-admin-key', ADMIN_KEY).expect(200);
    expect((await get('planId=PLAN_BULLET_01')).body.total).toBe(1);
    expect((await get('status=REJECTED')).body.items[0].fullName).toBe('Person C');
    expect((await get('q=person b')).body.total).toBe(1);
    const page = (await get('pageSize=2&page=2')).body;
    expect(page).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(page.items).toHaveLength(1);
  });
  it('rejects bad query params with 400', async () => {
    const res = await request(app).get('/api/v1/leads?status=BOGUS&pageSize=1000').set('x-admin-key', ADMIN_KEY).expect(400);
    expect(res.body.error.fields.status).toBeTruthy();
  });
});

describe('error handling & hardening', () => {
  it('unknown routes use the standard error shape', async () => {
    const res = await request(app).get('/api/v1/nope').expect(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });
  it('returns 503 (no stack, no SQL) when the database is down', async () => {
    const down = makeContext({ DATABASE_URL: 'postgresql://goldloan:goldloan@localhost:1/goldloan' });
    const res = await request(down.app).get('/api/v1/loan-schemes').expect(503);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toMatch(/stack|prisma|localhost|SELECT/i);
    await down.db.$disconnect();
  });
  it('sets security headers and hides x-powered-by', async () => {
    const res = await request(app).get('/api/v1/health').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
  it('only reflects configured CORS origins', async () => {
    const ok = await request(app).get('/api/v1/health').set('Origin', 'http://localhost:5173');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const bad = await request(app).get('/api/v1/health').set('Origin', 'https://evil.example');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('rate limits lead submissions with the standard error shape', async () => {
    const limited = makeContext({ RATE_LIMIT_ENABLED: 'true' });
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await request(limited.app).post('/api/v1/leads').send({})).status;
    expect(last).toBe(429);
    await limited.db.$disconnect();
  });
});
