import { createHash } from 'node:crypto';
import type { ChatSummaryDto, LeadRequest, PlanQuoteDto, QuoteDto } from '@goldloan/shared';
import { maskMobile } from '@goldloan/shared';

/**
 * The hash binds a confirmation to EXACTLY what the borrower reviewed: their details, the plan,
 * and the server-computed amounts and market rate. If anything changes (including the market
 * rate or plan terms) the hash changes and a fresh confirmation is required.
 */
export function buildSummary(input: LeadRequest, quote: QuoteDto, plan: PlanQuoteDto): ChatSummaryDto {
  const canonical = JSON.stringify([
    input.fullName, input.mobileNumber, input.netWeightGrams, input.karat, input.grossWeightGrams ?? null, plan.planId,
    plan.eligibleLoanAmount, plan.goldValue, plan.pureGoldWeightGrams, quote.marketRatePerGram,
    plan.annualInterestRatePct, plan.appliedLtv, plan.tenureMonths,
  ]);
  return {
    fullName: input.fullName,
    maskedMobile: maskMobile(input.mobileNumber),
    netWeightGrams: input.netWeightGrams,
    karat: input.karat,
    planId: plan.planId,
    planName: plan.planName,
    pureGoldWeightGrams: plan.pureGoldWeightGrams,
    goldValue: plan.goldValue,
    eligibleLoanAmount: plan.eligibleLoanAmount,
    annualInterestRatePct: plan.annualInterestRatePct,
    tenureMonths: plan.tenureMonths,
    repaymentType: plan.repaymentType,
    hash: createHash('sha256').update(canonical).digest('hex'),
  };
}

const AFFIRMATIVE =
  /^\s*(?:yes[,.!\s]*)?(?:i\s+)?(?:please\s+)?(?:confirm(?:ed)?|submit|go\s+ahead|yes|yep|yeah|y)(?:\s+(?:it|this|my\s+application|the\s+application))?(?:\s+please)?\s*[.!]*\s*$/i;

/** True only when the USER's own message is an explicit confirmation (never the model's text). */
export const isExplicitConfirmation = (text: string): boolean => text.length <= 60 && AFFIRMATIVE.test(text);
