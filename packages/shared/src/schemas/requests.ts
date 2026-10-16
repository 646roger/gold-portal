import { z } from 'zod';
import {
  fullNameSchema, grossWeightSchema, karatSchema, mobileNumberSchema, netWeightSchema, planIdSchema,
} from './primitives';

/**
 * Relationship rule (the only one we define): if gross weight is supplied,
 * net gold weight must not exceed it. Net < gross is normal (stones, wax,
 * impurities), so e.g. 52 g net / 550 g gross is VALID.
 */
function netNotAboveGross(v: { netWeightGrams: string; grossWeightGrams?: string | undefined }, ctx: z.RefinementCtx) {
  if (v.grossWeightGrams !== undefined && Number(v.netWeightGrams) > Number(v.grossWeightGrams)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['netWeightGrams'],
      message: 'Net gold weight cannot be more than the gross weight.',
    });
  }
}

export const quoteRequestSchema = z
  .object({
    netWeightGrams: netWeightSchema,
    karat: karatSchema,
    grossWeightGrams: grossWeightSchema.optional(),
  })
  .superRefine(netNotAboveGross);

export const leadRequestSchema = z
  .object({
    fullName: fullNameSchema,
    mobileNumber: mobileNumberSchema,
    netWeightGrams: netWeightSchema,
    karat: karatSchema,
    grossWeightGrams: grossWeightSchema.optional(),
    planId: planIdSchema,
  })
  .superRefine(netNotAboveGross);

export const leadListQuerySchema = z.object({
  planId: z.string().trim().min(1).max(50).optional(),
  status: z.enum(['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED']).optional(),
  q: z.string().trim().min(1).max(60).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const chatMessageRequestSchema = z.object({
  sessionId: z.string().uuid().optional(),
  message: z.string().trim().min(1, 'Type a message.').max(1000, 'Message is too long (max 1000 characters).'),
});

export const chatConfirmRequestSchema = z.object({
  sessionId: z.string().uuid(),
  summaryHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export type QuoteRequest = z.infer<typeof quoteRequestSchema>;
export type LeadRequest = z.infer<typeof leadRequestSchema>;
export type LeadListQuery = z.infer<typeof leadListQuerySchema>;
