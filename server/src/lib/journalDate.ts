/** Normalize journal `date` values stored as YYYY-MM-DD, ISO datetime, or Firestore Timestamp. */
export function journalDateKey(raw: unknown): string {
  if (raw == null || raw === '') return '';
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const head = s.split('T')[0]?.trim() ?? '';
    return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : '';
  }
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  if (typeof raw === 'object' && raw !== null && 'toDate' in raw) {
    const toDate = (raw as { toDate?: () => Date }).toDate;
    if (typeof toDate === 'function') return toDate.call(raw).toISOString().slice(0, 10);
  }
  const fallback = String(raw).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(fallback) ? fallback.slice(0, 10) : '';
}

export function journalDateQueryUpperBound(dateTo: string): string {
  const d = dateTo.trim().slice(0, 10);
  return d ? `${d}\uf8ff` : '';
}

export function isJournalDateInRange(value: unknown, dateFrom: string, dateTo: string): boolean {
  const key = journalDateKey(value);
  if (!key) return false;
  const from = dateFrom.trim().slice(0, 10);
  const to = dateTo.trim().slice(0, 10);
  if (from && key < from) return false;
  if (to && key > to) return false;
  return true;
}
