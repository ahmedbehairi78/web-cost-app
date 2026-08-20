import { describe, expect, it } from 'vitest';
import {
  computeCashBudgetSummary,
  custodyReplenishAmount,
  isDateInRange,
  mergeSuggestedLines,
  payrollMonthOverlapsPeriod,
  periodEndFor,
} from './cashBudget';

describe('periodEndFor', () => {
  it('weekly is start + 6 days', () => {
    expect(periodEndFor('weekly', '2026-08-17')).toBe('2026-08-23');
  });

  it('biweekly is start + 13 days', () => {
    expect(periodEndFor('biweekly', '2026-08-17')).toBe('2026-08-30');
  });

  it('monthly ends on last calendar day of the start month', () => {
    expect(periodEndFor('monthly', '2026-02-10')).toBe('2026-02-28');
    expect(periodEndFor('monthly', '2026-08-01')).toBe('2026-08-31');
  });
});

describe('isDateInRange', () => {
  it('includes bounds and strips ISO time', () => {
    expect(isDateInRange('2026-08-17', '2026-08-17', '2026-08-23')).toBe(true);
    expect(isDateInRange('2026-08-23T15:00:00.000Z', '2026-08-17', '2026-08-23')).toBe(true);
    expect(isDateInRange('2026-08-16', '2026-08-17', '2026-08-23')).toBe(false);
  });
});

describe('payrollMonthOverlapsPeriod', () => {
  it('includes a weekly slice inside August', () => {
    expect(payrollMonthOverlapsPeriod(2026, 8, '2026-08-17', '2026-08-23')).toBe(true);
  });

  it('excludes a non-overlapping month', () => {
    expect(payrollMonthOverlapsPeriod(2026, 7, '2026-08-17', '2026-08-23')).toBe(false);
  });
});

describe('custodyReplenishAmount', () => {
  it('is max(0, min − (gl − pending))', () => {
    expect(custodyReplenishAmount(50_000, 20_000, 0)).toBe(30_000);
    expect(custodyReplenishAmount(50_000, 50_000, 10_000)).toBe(10_000);
    expect(custodyReplenishAmount(50_000, 80_000, 0)).toBe(0);
  });

  it('skips when min is zero', () => {
    expect(custodyReplenishAmount(0, 1_000, 500)).toBe(0);
  });
});

describe('computeCashBudgetSummary', () => {
  it('gap = banks + cash + period sources − obligations', () => {
    const summary = computeCashBudgetSummary({
      openingBank: 100_000,
      openingCash: 20_000,
      lines: [
        { side: 'source', category: 'opening_bank', amount: 100_000 },
        { side: 'source', category: 'opening_cash', amount: 20_000 },
        { side: 'source', category: 'collection', amount: 40_000 },
        { side: 'obligation', category: 'supplier', amount: 70_000 },
        { side: 'obligation', category: 'custody_replenish', amount: 10_000 },
      ],
    });
    expect(summary.availableLiquidity).toBe(120_000);
    expect(summary.periodSources).toBe(40_000);
    expect(summary.obligations).toBe(80_000);
    expect(summary.gap).toBe(80_000);
  });

  it('ignores excluded lines', () => {
    const summary = computeCashBudgetSummary({
      openingBank: 10,
      openingCash: 0,
      lines: [{ side: 'obligation', category: 'supplier', amount: 10, excluded: true }],
    });
    expect(summary.obligations).toBe(0);
    expect(summary.gap).toBe(10);
  });
});

describe('mergeSuggestedLines', () => {
  it('keeps manual rows and excluded flags on matching auto origins', () => {
    const merged = mergeSuggestedLines(
      [
        {
          side: 'obligation',
          category: 'supplier',
          description: 'old auto',
          amount: 1,
          origin: 'auto',
          originType: 'purchase_invoice',
          originId: 'inv-1',
          excluded: true,
        },
        {
          side: 'obligation',
          category: 'other',
          description: 'manual rent',
          amount: 500,
          origin: 'manual',
          originType: 'manual',
          originId: 'm1',
        },
      ],
      [
        {
          side: 'obligation',
          category: 'supplier',
          description: 'refreshed',
          amount: 9,
          originType: 'purchase_invoice',
          originId: 'inv-1',
        },
      ],
    );
    expect(merged).toHaveLength(2);
    expect(merged[0].amount).toBe(9);
    expect(merged[0].excluded).toBe(true);
    expect(merged[1].origin).toBe('manual');
    expect(merged[1].amount).toBe(500);
  });
});
