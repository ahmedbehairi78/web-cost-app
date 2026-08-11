import { describe, expect, it } from 'vitest';
import {
  businessTodayCompact,
  businessTodayYmd,
  businessYmdFromDate,
  resolveBusinessTimeZone,
} from './businessCalendar.js';

describe('businessCalendar', () => {
  it('defaults to Africa/Cairo', () => {
    expect(resolveBusinessTimeZone(null)).toBe('Africa/Cairo');
  });

  it('formats Cairo calendar day across UTC midnight edge', () => {
    // 2026-07-31 22:30 UTC = 2026-08-01 01:30 in Africa/Cairo (UTC+3 summer)
    const utcEvening = new Date('2026-07-31T22:30:00.000Z');
    expect(businessTodayYmd('Africa/Cairo', utcEvening)).toBe('2026-08-01');
    expect(businessTodayCompact('Africa/Cairo', utcEvening)).toBe('20260801');
    expect(utcEvening.toISOString().slice(0, 10)).toBe('2026-07-31');
  });

  it('formats midday UTC as same Cairo day in winter-ish offset', () => {
    const noonUtc = new Date('2026-01-15T12:00:00.000Z');
    expect(businessTodayYmd('Africa/Cairo', noonUtc)).toBe('2026-01-15');
    expect(businessYmdFromDate(noonUtc, 'Africa/Cairo')).toBe('2026-01-15');
  });
});
