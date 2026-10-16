import Decimal from 'decimal.js';

/**
 * Isolated Decimal constructor: 40 significant digits, ROUND_HALF_UP for any
 * explicit quantisation. We never use JS floating point for money.
 */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;

/** Quantise to `dp` decimals (half-up) and serialise as a fixed-point string. */
export const toFixed = (v: Dec, dp: number): string => v.toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toFixed(dp);

/** Whole rupees, rounded DOWN (floor) – used only for the eligible loan amount. */
export const floorRupees = (v: Dec): Dec => v.toDecimalPlaces(0, Decimal.ROUND_FLOOR);

/** Rupee decimal string ("288750.00") → integer paise, exactly (no floats). */
export const rupeesToPaise = (rupees: string): bigint => BigInt(new D(rupees).mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));

/** Integer paise → rupee decimal string with `dp` decimals ("288750.00"). */
export const paiseToRupees = (paise: bigint | number | string, dp = 2): string => new D(paise.toString()).div(100).toFixed(dp);
