import type { QuoteDto, QuoteRequest } from '@goldloan/shared';
import { AppError } from '../lib/errors';
import type { Db } from '../lib/prisma';
import { calculateQuote, type PlanTerms } from '../domain/quote';
import { paiseToRupees } from '../domain/money';
import { listActivePlanTerms } from './planService';

export async function currentMarketRate(db: Db): Promise<string> {
  const row = await db.marketRate.findFirst({ orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }] });
  if (!row) throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Market rate is not configured.');
  return paiseToRupees(row.ratePerGramPaise);
}

/**
 * THE quotation service. Used by POST /quotes, POST /leads (re-calculation), the assistant's
 * calculate_quote tool and submit_application. No writes.
 */
export async function getQuote(db: Db, input: Pick<QuoteRequest, 'netWeightGrams' | 'karat'>, plans?: PlanTerms[]): Promise<QuoteDto> {
  const [rate, activePlans] = await Promise.all([currentMarketRate(db), plans ?? listActivePlanTerms(db)]);
  return calculateQuote({ netWeightGrams: input.netWeightGrams, karat: input.karat, marketRatePerGram: rate, plans: activePlans });
}
