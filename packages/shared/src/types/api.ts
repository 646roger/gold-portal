/**
 * API representation of money / quantities (documented in README):
 *  - every monetary amount and weight is a decimal STRING (never a JSON float)
 *  - eligibleLoanAmount: whole rupees, string ("216562")
 *  - goldValue, marketRatePerGram, emi, interest: rupees with 2 decimals
 *  - pureGoldWeightGrams: 6 decimals
 *  - annualInterestRatePct "12.00"; LTV as a fraction "0.7000"
 */
export type RepaymentType = 'BULLET' | 'EMI';

export interface LoanSchemeDto {
  id: string;
  name: string;
  repaymentType: RepaymentType;
  repaymentDescription: string;
  annualInterestRatePct: string;
  maxLtv: string;
  tenureMonths: number;
}

export interface RepaymentEstimateDto {
  isEstimate: true;
  method: string;
  monthlyInstalment?: string;
  totalInterest: string;
  totalRepayable: string;
  disclaimer: string;
}

export interface PlanQuoteDto {
  planId: string;
  planName: string;
  repaymentType: RepaymentType;
  annualInterestRatePct: string;
  maxLtv: string;
  appliedLtv: string;
  tenureMonths: number;
  pureGoldWeightGrams: string;
  goldValue: string;
  eligibleLoanAmount: string;
  repaymentEstimate: RepaymentEstimateDto;
}

export interface QuoteDto {
  netWeightGrams: string;
  karat: number;
  pureGoldWeightGrams: string;
  marketRatePerGram: string;
  goldValue: string;
  maxPermittedLtv: string;
  quotes: PlanQuoteDto[];
}

export interface LeadCreatedDto {
  applicationId: string;
  status: string;
  createdAt: string;
  planId: string;
  planName: string;
  eligibleLoanAmount: string;
  goldValue: string;
  pureGoldWeightGrams: string;
  annualInterestRatePct: string;
  tenureMonths: number;
}

export interface LeadListItemDto {
  applicationId: string;
  fullName: string;
  maskedMobile: string;
  netWeightGrams: string;
  karat: number;
  planId: string;
  planName: string;
  eligibleLoanAmount: string;
  status: string;
  createdAt: string;
}

export interface LeadListDto {
  items: LeadListItemDto[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    details?: Record<string, unknown>;
  };
}

/* ---------- chat ---------- */
export interface ChatSummaryDto {
  fullName: string;
  maskedMobile: string;
  netWeightGrams: string;
  karat: number;
  planId: string;
  planName: string;
  pureGoldWeightGrams: string;
  goldValue: string;
  eligibleLoanAmount: string;
  annualInterestRatePct: string;
  tenureMonths: number;
  repaymentType: RepaymentType;
  hash: string;
}

export interface ChatMessageDto {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatResponseDto {
  sessionId: string;
  mode: 'llm' | 'demo';
  messages: ChatMessageDto[];
  /** Structured, backend-sourced blocks the UI renders instead of trusting model prose. */
  quote?: QuoteDto;
  confirmation?: ChatSummaryDto;
  application?: { applicationId: string; duplicate: boolean };
  toolsUsed: string[];
}
