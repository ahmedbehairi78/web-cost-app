import { toFiniteNumber } from './utils';
import { NUMBER_LOCALE } from './numberLocale';

/** EGP amounts — 2 decimal places in operations; tolerance for balance checks. */
export const MONEY_TOLERANCE = 0.005;

/**
 * Balance sheet A ≈ L+E tolerance (EGP).
 * Gaps at or below this are treated as rounding (Reports + fiscal closing).
 */
export const BS_BALANCE_TOLERANCE = 1;

export function roundMoney(value: unknown): number {
  const n = toFiniteNumber(value);
  return Math.round(n * 100) / 100;
}

/** Alias — any operational decimal (money or qty) to 2 places. */
export const roundDecimal2 = roundMoney;

export function isMoneyBalanced(debit: number, credit: number): boolean {
  return Math.abs(debit - credit) <= MONEY_TOLERANCE;
}

/** Display money with exactly 2 decimal places (always Western numerals). */
export function formatMoney(value: unknown, locale = NUMBER_LOCALE): string {
  const n = roundMoney(value);
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export { NUMBER_LOCALE, displayLocale, formatNumber } from './numberLocale';
