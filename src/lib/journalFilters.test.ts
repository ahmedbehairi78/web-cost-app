import { describe, expect, it } from 'vitest';
import {
  isJournalDateInRange,
  journalDateKey,
  journalDateQueryUpperBound,
  normalizeGlTransactionDates,
  sortJournalByEntryTime,
} from './journalFilters';

describe('journalDateKey', () => {
  it('normalizes ISO datetime strings to YYYY-MM-DD', () => {
    expect(journalDateKey('2026-06-19T00:00:00.000Z')).toBe('2026-06-19');
  });

  it('keeps plain date strings', () => {
    expect(journalDateKey('2026-06-19')).toBe('2026-06-19');
  });

  it('normalizes Firestore Timestamp-like objects', () => {
    const ts = { toDate: () => new Date('2026-03-15T22:00:00.000Z') };
    expect(journalDateKey(ts)).toBe('2026-03-15');
  });
});

describe('isJournalDateInRange', () => {
  it('includes same-day ISO datetime within dateTo', () => {
    expect(isJournalDateInRange('2026-06-19T00:00:00.000Z', '2026-06-01', '2026-06-19')).toBe(true);
  });

  it('excludes dates after dateTo', () => {
    expect(isJournalDateInRange('2026-06-20', '2026-06-01', '2026-06-19')).toBe(false);
  });
});

describe('journalDateQueryUpperBound', () => {
  it('extends dateTo for string prefix queries', () => {
    expect(journalDateQueryUpperBound('2026-06-19')).toBe('2026-06-19\uf8ff');
  });
});

describe('normalizeGlTransactionDates', () => {
  it('maps transaction rows to normalized date keys', () => {
    const rows = normalizeGlTransactionDates([{ id: '1', date: '2026-01-02T12:00:00.000Z' }]);
    expect(rows[0]?.date).toBe('2026-01-02');
  });
});

describe('sortJournalByEntryTime', () => {
  it('orders by createdAt newest first', () => {
    const rows = sortJournalByEntryTime([
      { id: 'a', date: '2026-07-01', createdAt: '2026-07-01T10:00:00.000Z', entries: [] },
      { id: 'b', date: '2026-07-01', createdAt: '2026-07-01T12:00:00.000Z', entries: [] },
      { id: 'c', date: '2026-06-01', createdAt: '2026-07-01T11:00:00.000Z', entries: [] },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });
});
