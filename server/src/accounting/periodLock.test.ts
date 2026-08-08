import { describe, expect, it } from 'vitest';
import {
  PeriodLockedError,
  dateRangesOverlap,
  isActorAllowedForPeriod,
} from './periodLock.js';

describe('PeriodLockedError', () => {
  it('exposes 423 and Arabic message with label', () => {
    const err = new PeriodLockedError('Q2-2026');
    expect(err.statusCode).toBe(423);
    expect(err.label).toBe('Q2-2026');
    expect(err.message).toContain('Q2-2026');
    expect(err.message).toContain('مقفلة');
  });
});

describe('isActorAllowedForPeriod', () => {
  const period = { allowedUserIds: ['user-a', 'user-b'] };

  it('allows listed actor', () => {
    expect(isActorAllowedForPeriod(period, 'user-a')).toBe(true);
  });

  it('rejects missing or empty actor', () => {
    expect(isActorAllowedForPeriod(period, null)).toBe(false);
    expect(isActorAllowedForPeriod(period, undefined)).toBe(false);
    expect(isActorAllowedForPeriod(period, '')).toBe(false);
  });

  it('rejects actor not on the list', () => {
    expect(isActorAllowedForPeriod(period, 'user-c')).toBe(false);
  });

  it('handles non-array allowedUserIds', () => {
    expect(isActorAllowedForPeriod({ allowedUserIds: null }, 'user-a')).toBe(false);
  });
});

describe('dateRangesOverlap', () => {
  it('detects overlapping quarters', () => {
    expect(dateRangesOverlap('2026-04-01', '2026-06-30', '2026-06-01', '2026-08-31')).toBe(true);
  });

  it('detects identical ranges', () => {
    expect(dateRangesOverlap('2026-04-01', '2026-06-30', '2026-04-01', '2026-06-30')).toBe(true);
  });

  it('rejects adjacent non-overlapping ranges', () => {
    expect(dateRangesOverlap('2026-01-01', '2026-03-31', '2026-04-01', '2026-06-30')).toBe(false);
  });

  it('rejects empty dates', () => {
    expect(dateRangesOverlap('', '2026-06-30', '2026-04-01', '2026-06-30')).toBe(false);
  });
});
