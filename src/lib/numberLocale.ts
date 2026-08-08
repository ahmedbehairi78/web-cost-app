/** Western digits (0–9) for all numeric display — independent of UI language. */
export const NUMBER_LOCALE = 'en-US';

/** Date/time locale: Arabic labels with Latin numerals when UI is Arabic. */
export function displayLocale(language: string): string {
  return language === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US';
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return new Intl.NumberFormat(NUMBER_LOCALE, {
    maximumFractionDigits: 2,
    ...options,
  }).format(n);
}
