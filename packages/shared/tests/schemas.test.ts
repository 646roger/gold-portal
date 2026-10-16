import { describe, expect, it } from 'vitest';
import { leadRequestSchema, maskMobile, normalizeIndianMobile, quoteRequestSchema } from '../src';

describe('normalizeIndianMobile', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['98765 43210', '+919876543210'],
    ['+91-98765-43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['09876543210', '+919876543210'],
  ])('normalises %s', (input, expected) => expect(normalizeIndianMobile(input)).toBe(expected));

  it.each(['12345', '5876543210', '98765432101', '+1 9876543210', 'abcdefghij', '', '+9198765'])(
    'rejects %s',
    (input) => expect(normalizeIndianMobile(input)).toBeNull(),
  );
  it('masks to last four digits', () => expect(maskMobile('+919876543210')).toBe('+91 XXXXXX3210'));
});

describe('quoteRequestSchema', () => {
  it('normalises number weights to decimal strings', () => {
    const r = quoteRequestSchema.parse({ netWeightGrams: 45, karat: 22 });
    expect(r.netWeightGrams).toBe('45');
  });
  it.each([0, -1, 5001, 'abc', '1.2345', null])('rejects weight %s', (w) => {
    expect(quoteRequestSchema.safeParse({ netWeightGrams: w, karat: 22 }).success).toBe(false);
  });
  it.each([0, 9, 25, 22.5, '22', null])('rejects karat %s', (k) => {
    expect(quoteRequestSchema.safeParse({ netWeightGrams: 10, karat: k }).success).toBe(false);
  });
  it('accepts 52 g net with 550 g gross (net < gross is valid)', () => {
    expect(quoteRequestSchema.safeParse({ netWeightGrams: 52, grossWeightGrams: 550, karat: 22 }).success).toBe(true);
  });
  it('rejects net above gross on the net weight field', () => {
    const r = quoteRequestSchema.safeParse({ netWeightGrams: 60, grossWeightGrams: 50, karat: 22 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['netWeightGrams']);
  });
});

describe('leadRequestSchema', () => {
  it('normalises mobile and strips client-supplied derived values', () => {
    const r = leadRequestSchema.parse({
      fullName: 'Asha Verma', mobileNumber: '98765 43210', netWeightGrams: 45, karat: 22,
      planId: 'PLAN_EMI_01', eligibleLoanAmount: 9999999, goldValue: '1',
    } as never);
    expect(r.mobileNumber).toBe('+919876543210');
    expect('eligibleLoanAmount' in r).toBe(false);
  });
});
