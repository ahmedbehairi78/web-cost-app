import { roundMoney } from './money';
import { NUMBER_LOCALE } from './numberLocale';

/** Quantity display — up to 2 decimals, no forced trailing zeros (always Western numerals). */
export function formatQuantity(n: number, _language?: string): string {
  const value = roundMoney(n);
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat(NUMBER_LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}
