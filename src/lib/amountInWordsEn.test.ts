import { describe, expect, it } from 'vitest';
import { amountInWordsEgyptianPounds, integerToWordsEn } from './amountInWordsEn';

describe('integerToWordsEn', () => {
  it('handles zero and small numbers', () => {
    expect(integerToWordsEn(0)).toBe('Zero');
    expect(integerToWordsEn(47)).toBe('Forty-Seven');
    expect(integerToWordsEn(278)).toBe('Two Hundred and Seventy-Eight');
  });

  it('handles millions like Cover-JLL sample', () => {
    expect(integerToWordsEn(14_486_278)).toBe(
      'Fourteen Million, Four Hundred Eighty-Six Thousand, Two Hundred and Seventy-Eight',
    );
  });
});

describe('amountInWordsEgyptianPounds', () => {
  it('formats pounds and piastres', () => {
    expect(amountInWordsEgyptianPounds(14_486_278.47)).toBe(
      'Only, Fourteen Million, Four Hundred Eighty-Six Thousand, Two Hundred and Seventy-Eight Egyptian Pounds and Forty-Seven Piastres.',
    );
  });

  it('omits piastres when zero', () => {
    expect(amountInWordsEgyptianPounds(100)).toBe('Only, One Hundred Egyptian Pounds.');
  });
});
