import { describe, expect, it } from 'vitest';
import { grams, inr, pct, pctFromFraction } from './format';

describe('format', () => {
  it.each([
    ['216562', '₹2,16,562'], ['288750.00', '₹2,88,750'], ['25666.67', '₹25,666.67'], ['999', '₹999'], ['1000', '₹1,000'],
    ['35000000.00', '₹3,50,00,000'], ['0', '₹0'],
  ])('inr(%s) → %s (Indian grouping, no float maths)', (i, o) => expect(inr(i)).toBe(o));
  it('shows an em dash when there is no value', () => { expect(inr(undefined)).toBe('—'); expect(inr('')).toBe('—'); });
  it('grams trims noise', () => { expect(grams('41.250000')).toBe('41.25 g'); expect(grams('7.500000')).toBe('7.5 g'); expect(grams('3.666667')).toBe('3.6666 g'); });
  it('percentages', () => { expect(pctFromFraction('0.7500')).toBe('75%'); expect(pct('10.50')).toBe('10.5%'); });
});
