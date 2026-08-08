/** EGP amounts — 2 decimal places in operations; tolerance for balance checks. */
export const MONEY_TOLERANCE = 0.005;

/**
 * Balance sheet A ≈ L+E tolerance (EGP).
 * Gaps at or below this are treated as rounding and allow fiscal BS approve / opening.
 */
export const BS_BALANCE_TOLERANCE = 1;

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

/** Alias — any operational decimal (money or qty) to 2 places. */
export const roundDecimal2 = roundMoney;

/** @deprecated use roundMoney — kept for call-site compatibility */
export function toMoney(value: number): number {
  return roundMoney(value);
}

export function isMoneyBalanced(debit: number, credit: number): boolean {
  return Math.abs(debit - credit) <= MONEY_TOLERANCE;
}
