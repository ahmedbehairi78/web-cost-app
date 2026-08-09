import { describe, expect, it } from 'vitest';
import { buildIpcCoverSchedule, formatContractCalendarDuration } from './ipcCoverSchedule';

describe('formatContractCalendarDuration', () => {
  it('formats calendar days between dates', () => {
    expect(formatContractCalendarDuration('2024-01-01', '2024-01-31', 'en')).toBe('30 Calendar days');
    expect(formatContractCalendarDuration('2024-01-01', '2024-01-31', 'ar')).toBe('30 يوم تقويمي');
  });

  it('returns dash when dates missing', () => {
    expect(formatContractCalendarDuration(null, '2024-01-01', 'en')).toBe('—');
  });
});

describe('buildIpcCoverSchedule', () => {
  it('always returns all five Cover-JLL schedule rows', () => {
    const s = buildIpcCoverSchedule({
      startDate: '2024-06-01',
      endDate: '2024-09-29',
      language: 'en',
    });
    expect(s.loaDate).toBe('2024-06-01');
    expect(s.commencementDate).toBe('2024-06-01');
    expect(s.durationLabel).toContain('Calendar day');
    expect(s.timeExtensionLabel).toBe('—');
    expect(s.completionDate).toBe('2024-09-29');
  });
});
