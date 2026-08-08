import { normalizeDate } from './utils';
import { businessTodayYmd } from './businessCalendar';

export type JournalAccountScope = 'single' | 'range';

export interface JournalQueryFilters {
  projectIds: string[];
  dateFrom: string;
  dateTo: string;
  accountScope: JournalAccountScope;
  accountFrom: string;
  accountTo: string;
}

export function defaultJournalFilters(): JournalQueryFilters {
  const today = businessTodayYmd();
  const year = Number(today.slice(0, 4)) || new Date().getFullYear();
  return {
    projectIds: [],
    dateFrom: `${year}-01-01`,
    dateTo: `${year}-12-31`,
    accountScope: 'single',
    accountFrom: '',
    accountTo: '',
  };
}

interface JournalTx {
  date?: unknown;
  createdAt?: unknown;
  id?: string;
  projectId?: string | null;
  costCenterId?: string | null;
  entries: { accountCode: string }[];
}

function createdAtMs(value: unknown): number {
  if (value == null || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'object' && value !== null && 'toMillis' in value) {
    const fn = (value as { toMillis?: () => number }).toMillis;
    if (typeof fn === 'function') return fn.call(value);
  }
  if (typeof value === 'object' && value !== null && 'seconds' in value) {
    const s = Number((value as { seconds?: number }).seconds);
    if (Number.isFinite(s)) return s * 1000;
  }
  const t = new Date(value as string | Date).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Newest entry time first (then accounting date, then id). */
export function sortJournalByEntryTime<T extends JournalTx>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const tb = createdAtMs(b.createdAt);
    const ta = createdAtMs(a.createdAt);
    if (tb !== ta) return tb - ta;
    const db = journalDateKey(b.date);
    const da = journalDateKey(a.date);
    if (db !== da) return db.localeCompare(da);
    return String(b.id ?? '').localeCompare(String(a.id ?? ''));
  });
}

/** Normalize any journal date (string · ISO datetime · Firestore Timestamp) to YYYY-MM-DD. */
export function journalDateKey(value: unknown): string {
  return normalizeDate(value as Parameters<typeof normalizeDate>[0]);
}

/** Inclusive range check using normalized calendar dates (not raw string compare). */
export function isJournalDateInRange(value: unknown, dateFrom: string, dateTo: string): boolean {
  const key = journalDateKey(value);
  if (!key) return false;
  const from = dateFrom.trim().slice(0, 10);
  const to = dateTo.trim().slice(0, 10);
  if (from && key < from) return false;
  if (to && key > to) return false;
  return true;
}

/** Upper bound for Firestore / Postgres string range queries when rows may store ISO datetimes. */
export function journalDateQueryUpperBound(dateTo: string): string {
  const d = dateTo.trim().slice(0, 10);
  return d ? `${d}\uf8ff` : '';
}

export function normalizeGlTransactionDates<T extends { date: unknown }>(
  rows: T[],
): (Omit<T, 'date'> & { date: string })[] {
  return rows.map((row) => ({ ...row, date: journalDateKey(row.date) }));
}

export function accountCodeInRange(code: string, from: string, to: string): boolean {
  const c = String(code).trim();
  if (from && c < from) return false;
  if (to && c > to) return false;
  return true;
}

/** Client-side filter for Firestore results or post-API refinement. */
export function filterJournalTransactions<T extends JournalTx>(
  rows: T[],
  filters: JournalQueryFilters,
  projectIdByContractId?: Map<string, string>,
): T[] {
  const { projectIds, accountFrom, accountTo, dateFrom, dateTo } = filters;
  const scope = filters.accountScope ?? 'single';
  const hasProjectFilter = projectIds.length > 0;
  const hasAccountFilter = !!(accountFrom.trim() || (scope === 'range' && accountTo.trim()));
  const hasDateFilter = !!(dateFrom.trim() || dateTo.trim());
  const from = accountFrom.trim();
  const to = scope === 'range' ? accountTo.trim() : '';

  const filtered =
    !hasProjectFilter && !hasAccountFilter && !hasDateFilter
      ? rows
      : rows.filter((tx) => {
          if (hasDateFilter && !isJournalDateInRange(tx.date, dateFrom, dateTo)) return false;
          if (hasProjectFilter) {
            let pid = tx.projectId ? String(tx.projectId) : '';
            if (!pid && tx.costCenterId && projectIdByContractId) {
              pid = projectIdByContractId.get(String(tx.costCenterId)) ?? '';
            }
            if (!pid || !projectIds.includes(pid)) return false;
          }
          if (hasAccountFilter) {
            const match = tx.entries.some((e) => {
              const code = String(e.accountCode).trim();
              if (scope === 'single' && from) return code === from;
              return accountCodeInRange(code, from, to);
            });
            if (!match) return false;
          }
          return true;
        });

  return sortJournalByEntryTime(filtered);
}

export function validateJournalFilters(
  filters: JournalQueryFilters,
  language: 'ar' | 'en',
): string | null {
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
    return language === 'ar' ? 'تاريخ «من» يجب أن يكون قبل «إلى»' : '“From” date must be before “To” date';
  }
  const scope = filters.accountScope ?? 'single';
  const from = filters.accountFrom.trim();
  const to = scope === 'range' ? filters.accountTo.trim() : '';
  if (from && to && from > to) {
    return language === 'ar'
      ? 'كود الحساب «من» يجب أن يكون أصغر من أو يساوي «إلى»'
      : 'Account “from” code must be ≤ “to” code';
  }
  return null;
}
