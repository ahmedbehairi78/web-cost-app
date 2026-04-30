import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

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
