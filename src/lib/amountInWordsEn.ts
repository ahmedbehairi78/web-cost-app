/**
 * English amount-in-words for Egyptian pounds (Cover-JLL “IN WORDS” line).
 * Format: Only, {integer} Egyptian Pounds and {piastres} Piastres.
 */
const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
] as const;

const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
] as const;

function underThousand(n: number): string {
  if (n <= 0) return '';
  if (n < 20) return ONES[n];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const o = n % 10;
    return o ? `${TENS[t]}-${ONES[o]}` : TENS[t];
  }
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (!rest) return `${ONES[h]} Hundred`;
  // Cover-JLL style: “Two Hundred and Seventy-Eight”
  return `${ONES[h]} Hundred and ${underThousand(rest)}`;
}

/** Convert a non-negative integer (0 … 999_999_999_999) to English words. */
export function integerToWordsEn(n: number): string {
  const x = Math.floor(Math.abs(n));
  if (x === 0) return 'Zero';

  const parts: string[] = [];
  const billions = Math.floor(x / 1_000_000_000);
  const millions = Math.floor((x % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((x % 1_000_000) / 1_000);
  const rem = x % 1_000;

  if (billions) parts.push(`${underThousand(billions)} Billion`);
  if (millions) parts.push(`${underThousand(millions)} Million`);
  if (thousands) {
    // “Four Hundred Eighty-Six Thousand” (no “and” before Thousand in the sample)
    const th = underThousand(thousands).replace(' Hundred and ', ' Hundred ');
    parts.push(`${th} Thousand`);
  }
  if (rem) parts.push(underThousand(rem));

  return parts.join(', ');
}

/**
 * Cover-JLL IN WORDS line for an EGP amount (2 decimal places = piastres).
 * Example: Only, Fourteen Million, … Egyptian Pounds and Forty-Seven Piastres.
 */
export function amountInWordsEgyptianPounds(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.abs(amount) : 0;
  const totalPiastres = Math.round(safe * 100);
  const pounds = Math.floor(totalPiastres / 100);
  const piastres = totalPiastres % 100;

  const poundWords = integerToWordsEn(pounds);
  const poundUnit = pounds === 1 ? 'Egyptian Pound' : 'Egyptian Pounds';

  if (piastres === 0) {
    return `Only, ${poundWords} ${poundUnit}.`;
  }
  const piastreWords = integerToWordsEn(piastres);
  const piastreUnit = piastres === 1 ? 'Piastre' : 'Piastres';
  return `Only, ${poundWords} ${poundUnit} and ${piastreWords} ${piastreUnit}.`;
}
