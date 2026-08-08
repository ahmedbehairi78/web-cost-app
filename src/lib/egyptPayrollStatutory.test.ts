import { describe, expect, it } from 'vitest';
import {
  computeEgyptEmployeeStatutory,
  EGYPT_SI_EMPLOYEE_RATE,
  EGYPT_SI_WAGE_MAX_2026,
  EGYPT_SI_WAGE_MIN_2026,
} from './egyptPayrollStatutory';

describe('computeEgyptEmployeeStatutory', () => {
  it('returns zeros for zero gross', () => {
    expect(computeEgyptEmployeeStatutory(0)).toEqual({
      socialInsurance: 0,
      incomeTax: 0,
      insuredWage: 0,
    });
  });

  it('clamps insured wage to the 2026 floor', () => {
    const r = computeEgyptEmployeeStatutory(2000);
    expect(r.insuredWage).toBe(EGYPT_SI_WAGE_MIN_2026);
    expect(r.socialInsurance).toBe(Math.round(EGYPT_SI_WAGE_MIN_2026 * EGYPT_SI_EMPLOYEE_RATE * 100) / 100);
  });

  it('clamps insured wage to the 2026 ceiling', () => {
    const r = computeEgyptEmployeeStatutory(50_000);
    expect(r.insuredWage).toBe(EGYPT_SI_WAGE_MAX_2026);
    expect(r.socialInsurance).toBe(Math.round(EGYPT_SI_WAGE_MAX_2026 * EGYPT_SI_EMPLOYEE_RATE * 100) / 100);
  });

  it('computes progressive monthly tax on mid-range salary', () => {
    const r = computeEgyptEmployeeStatutory(10_000);
    expect(r.insuredWage).toBe(10_000);
    expect(r.socialInsurance).toBe(1100);
    // annual taxable ≈ 10k*12 - 1100*12 - 20_000 = 86_800 → tax bands 0/10/15
    expect(r.incomeTax).toBeGreaterThan(0);
    expect(r.incomeTax).toBeLessThan(10_000);
  });
});
