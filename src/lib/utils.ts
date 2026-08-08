import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { roundMoney as roundMoneyInt } from './money';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Normalizes any date value from Firestore (string | Date | Timestamp) to ISO date string YYYY-MM-DD
export function normalizeDate(date: string | Date | { toDate(): Date } | null | undefined): string {
  if (!date) return '';
  if (typeof date === 'string') return date.split('T')[0];
  if (date instanceof Date) return date.toISOString().split('T')[0];
  if (typeof (date as { toDate(): Date }).toDate === 'function') {
    return (date as { toDate(): Date }).toDate().toISOString().split('T')[0];
  }
  return '';
}

/** Coerce API / Prisma decimals to a finite number */
export function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (value == null || value === '') return fallback;
  if (typeof value === 'string') {
    const n = Number(value.replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : fallback;
  }
  if (typeof value === 'object' && value !== null && 'toString' in (value as object)) {
    const n = Number(String(value));
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

export function roundMoney2(value: unknown): number {
  return roundMoneyInt(toFiniteNumber(value));
}

/** Stable React list key — never returns empty string (avoids duplicate `key=""` warnings). */
export function listKey(
  id: string | number | null | undefined,
  index: number,
  prefix = 'row',
): string {
  const s = id == null ? '' : String(id).trim();
  return s !== '' ? s : `${prefix}-${index}`;
}

/** `key={a || b}` safe variant — tries primary then secondary; never returns empty. */
export function compositeListKey(
  primary: string | number | null | undefined,
  secondary: string | number | null | undefined,
  index: number,
  prefix = 'row',
): string {
  const a = primary == null ? '' : String(primary).trim();
  const b = secondary == null ? '' : String(secondary).trim();
  return listKey(a || b, index, prefix);
}
