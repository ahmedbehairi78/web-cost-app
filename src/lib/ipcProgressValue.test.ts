import { describe, expect, it } from 'vitest';
import {
  ipcLinePeriodValue,
  ipcLinePriorToDateValue,
  ipcLineToDateValue,
  normalizeCompletionPct,
  sumIpcPeriodValues,
} from './ipcProgressValue';

describe('normalizeCompletionPct', () => {
  it('clamps to 0–100', () => {
    expect(normalizeCompletionPct(-5)).toBe(0);
    expect(normalizeCompletionPct(150)).toBe(100);
    expect(normalizeCompletionPct(70)).toBe(70);
    expect(normalizeCompletionPct('x', 12)).toBe(12);
  });
});

describe('ipcLineToDateValue', () => {
  it('matches plastering example: 120 × 50 × 70% = 4200', () => {
    expect(
      ipcLineToDateValue({
        previousQty: 100,
        currentQty: 20,
        rate: 50,
        completionPct: 70,
      }),
    ).toBe(4200);
  });

  it('raises value when only % increases (qty current 0)', () => {
    expect(
      ipcLineToDateValue({
        previousQty: 120,
        currentQty: 0,
        rate: 50,
        completionPct: 90,
        previousCompletionPct: 70,
      }),
    ).toBe(5400);
  });

  it('legacy without completionPct = qty × rate (100%)', () => {
    expect(
      ipcLineToDateValue({
        previousQty: 10,
        currentQty: 5,
        rate: 100,
      }),
    ).toBe(1500);
  });
});

describe('ipcLinePeriodValue', () => {
  it('period = to-date − prior when qty grows at same %', () => {
    // prior: 100×50×70% = 3500; to-date 4200 → period 700
    expect(
      ipcLinePeriodValue({
        previousQty: 100,
        currentQty: 20,
        rate: 50,
        completionPct: 70,
        previousCompletionPct: 70,
      }),
    ).toBe(700);
  });

  it('period from % lift only: 5400 − 4200 = 1200', () => {
    expect(
      ipcLinePeriodValue({
        previousQty: 120,
        currentQty: 0,
        rate: 50,
        completionPct: 90,
        previousCompletionPct: 70,
      }),
    ).toBe(1200);
  });

  it('first certificate prior is 0 when previousCompletionPct omitted with explicit pct', () => {
    expect(
      ipcLinePeriodValue({
        previousQty: 0,
        currentQty: 100,
        rate: 50,
        completionPct: 70,
      }),
    ).toBe(3500);
  });

  it('accepts explicit priorToDateValue override', () => {
    expect(
      ipcLinePeriodValue(
        { previousQty: 120, currentQty: 0, rate: 50, completionPct: 90 },
        4200,
      ),
    ).toBe(1200);
  });
});

describe('ipcLinePriorToDateValue', () => {
  it('uses previousCompletionPct', () => {
    expect(
      ipcLinePriorToDateValue({
        previousQty: 120,
        rate: 50,
        previousCompletionPct: 70,
        completionPct: 90,
      }),
    ).toBe(4200);
  });
});

describe('sumIpcPeriodValues', () => {
  it('sums period across lines', () => {
    expect(
      sumIpcPeriodValues([
        {
          previousQty: 120,
          currentQty: 0,
          rate: 50,
          completionPct: 90,
          previousCompletionPct: 70,
        },
        {
          previousQty: 0,
          currentQty: 10,
          rate: 100,
          completionPct: 100,
        },
      ]),
    ).toBe(2200);
  });
});
