import { z } from 'zod';

/** Validation rules (documented in README "Validation rules"). */
export const MAX_NET_WEIGHT_GRAMS = 5000;
export const MIN_KARAT = 10;
export const MAX_KARAT = 24;

/**
 * Weight is accepted as a JSON number or numeric string and is normalised to a
 * plain decimal STRING so that no binary floating point value ever reaches the
 * money maths. Up to 3 decimal places, > 0, <= MAX_NET_WEIGHT_GRAMS.
 */
const weightString = (label: string) =>
  z.preprocess(
    (v) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : v),
    z
      .string({ required_error: `${label} is required.`, invalid_type_error: `${label} must be a number.` })
      .trim()
      .regex(/^\d+(\.\d{1,3})?$/, `Enter ${label.toLowerCase()} in grams (up to 3 decimals).`)
      .refine((s) => Number(s) > 0, `${label} must be greater than zero.`)
      .refine((s) => Number(s) <= MAX_NET_WEIGHT_GRAMS, `${label} cannot exceed ${MAX_NET_WEIGHT_GRAMS} g.`),
  );

export const netWeightSchema = weightString('Net gold weight');
export const grossWeightSchema = weightString('Gross weight');

export const karatSchema = z
  .number({ required_error: 'Gold purity is required.', invalid_type_error: 'Gold purity must be a number.' })
  .int('Gold purity must be a whole number of karats.')
  .min(MIN_KARAT, `Purity must be between ${MIN_KARAT}K and ${MAX_KARAT}K.`)
  .max(MAX_KARAT, `Purity must be between ${MIN_KARAT}K and ${MAX_KARAT}K.`);

export const fullNameSchema = z
  .string({ required_error: 'Full name is required.', invalid_type_error: 'Full name is required.' })
  .trim()
  .min(2, 'Enter your full name.')
  .max(80, 'Name is too long.')
  .regex(/^\p{L}[\p{L}\p{M} .'-]*$/u, "Name can only contain letters, spaces, . ' and -.");

/**
 * Indian mobile normalisation. Accepts "98765 43210", "+91-98765-43210",
 * "919876543210", "09876543210". Canonical form: "+91XXXXXXXXXX" where the
 * first digit is 6-9. Used for validation, storage and duplicate detection.
 */
export function normalizeIndianMobile(input: string): string | null {
  const stripped = input.replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(stripped)) return null;
  const hasPlus = stripped.startsWith('+');
  let digits = hasPlus ? stripped.slice(1) : stripped;
  if (hasPlus && !digits.startsWith('91')) return null;
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return `+91${digits}`;
}

export const mobileNumberSchema = z
  .string({ required_error: 'Mobile number is required.', invalid_type_error: 'Mobile number is required.' })
  .max(20, 'Enter a valid 10-digit Indian mobile number.')
  .transform((v, ctx) => {
    const n = normalizeIndianMobile(v);
    if (!n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid 10-digit Indian mobile number.' });
      return z.NEVER;
    }
    return n;
  });

export const planIdSchema = z
  .string({ required_error: 'Select a loan plan.', invalid_type_error: 'Select a loan plan.' })
  .trim()
  .min(1, 'Select a loan plan.')
  .max(50, 'Select a loan plan.');

/** "+919876543210" -> "+91 XXXXXX3210" */
export function maskMobile(normalized: string): string {
  return `+91 XXXXXX${normalized.slice(-4)}`;
}
