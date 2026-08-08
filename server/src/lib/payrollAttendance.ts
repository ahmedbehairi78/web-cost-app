import { roundMoney } from './money.js';

export interface AttendanceRuleInput {
  workingDaysPerMonth: number;
  dailyWorkHours: number;
  overtimeMultiplier: number;
  lateGraceMins: number;
  lateTier1Mins: number;
  lateTier2Mins: number;
  lateTier3Mins: number;
  lateAboveTier3: string;
  absenceDeduction: string;
  absenceFixedAmount?: number | null;
}

export interface AttendanceLineInput {
  employeeCode: string;
  employeeName?: string | null;
  daysPresent?: number;
  /** Unpaid absence days — these are deducted. */
  daysAbsent?: number;
  /** Paid leave days (annual / casual / sick / official) — NOT deducted. */
  daysPaidLeave?: number;
  /** Per-leave-type day breakdown: { leaveTypeCode: days }. */
  leaveBreakdown?: Record<string, number> | null;
  lateMinutes?: number;
  overtimeHours?: number;
  /**
   * Disciplinary penalty **days** from the days sheet (أيام الجزاءات).
   * Converted to money via the same daily-rate rule as unpaid absence.
   * (Field name `directPenalties` is historical — value is days, not EGP.)
   */
  directPenalties?: number;
  notes?: string | null;
}

export interface AttendanceComputed {
  employeeCode: string;
  employeeName: string | null;
  daysPresent: number;
  daysAbsent: number;
  daysPaidLeave: number;
  lateMinutes: number;
  overtimeHours: number;
  basicSalary: number;
  overtime: number;
  /** Penalty days entered on the sheet (not money). */
  directPenalties: number;
  /** Money from penalty days only. */
  penaltyDaysDeduction: number;
  /** Total money: absence + late + penalty days. */
  penalties: number;
  absenceDeduction: number;
  lateDeduction: number;
  grossSalary: number;
  netSalary: number;
  notes: string | null;
  matched: boolean;
  warning?: string;
}

export const DEFAULT_ATTENDANCE_RULE: AttendanceRuleInput = {
  workingDaysPerMonth: 26,
  dailyWorkHours: 8,
  overtimeMultiplier: 1.25,
  lateGraceMins: 5,
  lateTier1Mins: 15,
  lateTier2Mins: 30,
  lateTier3Mins: 60,
  lateAboveTier3: 'full',
  absenceDeduction: 'daily_rate',
  absenceFixedAmount: 0,
};

function num(v: unknown): number {
  return Number(v) || 0;
}

/** Compute absence deduction for one employee line. */
export function computeAbsenceDeduction(
  daysAbsent: number,
  basicSalary: number,
  rule: AttendanceRuleInput,
): number {
  if (daysAbsent <= 0) return 0;
  if (rule.absenceDeduction === 'fixed') {
    return roundMoney(daysAbsent * num(rule.absenceFixedAmount));
  }
  const dailyRate = rule.workingDaysPerMonth > 0
    ? roundMoney(basicSalary / rule.workingDaysPerMonth)
    : 0;
  return roundMoney(daysAbsent * dailyRate);
}

/** Compute late penalty using graded tiers (monthly aggregate minutes). */
export function computeLateDeduction(
  lateMinutes: number,
  basicSalary: number,
  rule: AttendanceRuleInput,
): { deduction: number; tierLabel: string } {
  const effectiveLate = Math.max(0, lateMinutes - rule.lateGraceMins);
  if (effectiveLate <= 0) {
    return { deduction: 0, tierLabel: 'none' };
  }
  if (effectiveLate <= rule.lateTier1Mins) {
    return { deduction: 0, tierLabel: 'warning' };
  }

  const dailyRate = rule.workingDaysPerMonth > 0
    ? roundMoney(basicSalary / rule.workingDaysPerMonth)
    : 0;

  if (effectiveLate <= rule.lateTier2Mins) {
    return { deduction: roundMoney(dailyRate * 0.25), tierLabel: 'quarter_day' };
  }
  if (effectiveLate <= rule.lateTier3Mins) {
    return { deduction: roundMoney(dailyRate * 0.5), tierLabel: 'half_day' };
  }
  if (rule.lateAboveTier3 === 'full') {
    return { deduction: dailyRate, tierLabel: 'full_day' };
  }
  return { deduction: roundMoney(dailyRate * 0.5), tierLabel: 'half_day' };
}

/** Compute overtime amount from attendance hours. */
export function computeOvertimeAmount(
  overtimeHours: number,
  basicSalary: number,
  rule: AttendanceRuleInput,
): number {
  if (overtimeHours <= 0 || rule.workingDaysPerMonth <= 0 || rule.dailyWorkHours <= 0) return 0;
  const dailyRate = roundMoney(basicSalary / rule.workingDaysPerMonth);
  const hourlyRate = roundMoney(dailyRate / rule.dailyWorkHours);
  return roundMoney(overtimeHours * hourlyRate * rule.overtimeMultiplier);
}

export function applyAttendanceRules(
  att: AttendanceLineInput,
  rule: AttendanceRuleInput,
  basicSalary: number,
): Omit<AttendanceComputed, 'employeeCode' | 'employeeName' | 'matched' | 'warning'> & { tierLabel: string } {
  const daysPresent = num(att.daysPresent);
  const daysAbsent = num(att.daysAbsent);
  const daysPaidLeave = num(att.daysPaidLeave);
  const lateMinutes = num(att.lateMinutes);
  const overtimeHours = num(att.overtimeHours);
  /** Sheet column «أيام الجزاءات» — days, not money. */
  const penaltyDays = num(att.directPenalties);

  // Only unpaid absence days are deducted; paid leave (annual/casual/sick/official) is not.
  const absenceDeduction = computeAbsenceDeduction(daysAbsent, basicSalary, rule);
  const { deduction: lateDeduction, tierLabel } = computeLateDeduction(lateMinutes, basicSalary, rule);
  const overtime = computeOvertimeAmount(overtimeHours, basicSalary, rule);
  // Same daily-rate (or fixed) rule as unpaid absence.
  const penaltyDaysDeduction = computeAbsenceDeduction(penaltyDays, basicSalary, rule);
  const penalties = roundMoney(absenceDeduction + lateDeduction + penaltyDaysDeduction);

  const grossSalary = roundMoney(basicSalary + overtime);
  const netSalary = roundMoney(grossSalary - penalties);

  const noteParts: string[] = [];
  if (att.notes?.trim()) noteParts.push(att.notes.trim());
  if (daysAbsent > 0) noteParts.push(`غياب بدون أجر: ${daysAbsent} يوم`);
  if (daysPaidLeave > 0) noteParts.push(`إجازة مدفوعة: ${daysPaidLeave} يوم`);
  if (lateMinutes > 0) noteParts.push(`تأخير: ${lateMinutes} د`);
  if (overtimeHours > 0) noteParts.push(`إضافي: ${overtimeHours} س`);
  if (penaltyDays > 0) {
    noteParts.push(`أيام جزاءات: ${penaltyDays} → ${penaltyDaysDeduction}`);
  }
  if (tierLabel === 'warning') noteParts.push('تحذير تأخير');

  return {
    daysPresent,
    daysAbsent,
    daysPaidLeave,
    lateMinutes,
    overtimeHours,
    basicSalary: roundMoney(basicSalary),
    overtime,
    directPenalties: penaltyDays,
    penaltyDaysDeduction,
    penalties,
    absenceDeduction,
    lateDeduction,
    grossSalary,
    netSalary,
    notes: noteParts.length ? noteParts.join(' · ') : null,
    tierLabel,
  };
}
