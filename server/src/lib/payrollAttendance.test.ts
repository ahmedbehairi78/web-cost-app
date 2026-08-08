import { describe, expect, it } from 'vitest';
import { applyAttendanceRules, DEFAULT_ATTENDANCE_RULE } from './payrollAttendance.js';

describe('applyAttendanceRules — penalty days', () => {
  const rule = { ...DEFAULT_ATTENDANCE_RULE, workingDaysPerMonth: 30, dailyWorkHours: 8 };

  it('converts penalty days to money via daily rate and adds absence/late', () => {
    const basic = 9000; // daily = 300
    const r = applyAttendanceRules(
      {
        employeeCode: 'EMP-001',
        daysPresent: 28,
        daysAbsent: 1,
        lateMinutes: 0,
        overtimeHours: 0,
        directPenalties: 2, // 2 penalty days → 600
      },
      rule,
      basic,
    );
    expect(r.directPenalties).toBe(2);
    expect(r.penaltyDaysDeduction).toBe(600);
    expect(r.absenceDeduction).toBe(300);
    expect(r.lateDeduction).toBe(0);
    expect(r.penalties).toBe(900); // 300 + 600
  });

  it('does not invent penalty-day money when days are zero', () => {
    const r = applyAttendanceRules(
      {
        employeeCode: 'EMP-007',
        daysPresent: 26,
        daysAbsent: 0,
        lateMinutes: 0,
        overtimeHours: 4,
        directPenalties: 0,
      },
      rule,
      6000,
    );
    expect(r.penaltyDaysDeduction).toBe(0);
    expect(r.penalties).toBe(0);
    expect(r.overtime).toBeGreaterThan(0);
  });
});
