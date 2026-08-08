import { roundMoney } from './money';

/** Egyptian social insurance + salary income tax (employee withholdings), 2026 schedule. */
export const EGYPT_SI_EMPLOYEE_RATE = 0.11;
export const EGYPT_SI_WAGE_MIN_2026 = 2700;
export const EGYPT_SI_WAGE_MAX_2026 = 16700;
export const EGYPT_INCOME_TAX_ANNUAL_EXEMPTION = 20000;

/** Progressive annual brackets after personal exemption (Law 91 / updates through 2026). */
export const EGYPT_INCOME_TAX_BRACKETS: ReadonlyArray<{ upper: number; rate: number }> = [
  { upper: 40_000, rate: 0 },
  { upper: 55_000, rate: 0.1 },
  { upper: 70_000, rate: 0.15 },
  { upper: 200_000, rate: 0.2 },
  { upper: 400_000, rate: 0.225 },
  { upper: 1_200_000, rate: 0.25 },
  { upper: Number.POSITIVE_INFINITY, rate: 0.275 },
];

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

/**
 * Employee social insurance + monthly income-tax withholding from monthly gross.
 * Tax is computed on an annualized basis then ÷ 12 (common payroll practice).
 */
export function computeEgyptEmployeeStatutory(monthlyGross: number): {
  socialInsurance: number;
  incomeTax: number;
  insuredWage: number;
} {
  const gross = roundMoney(monthlyGross);
  const insuredWage = gross > 0
    ? clamp(gross, EGYPT_SI_WAGE_MIN_2026, EGYPT_SI_WAGE_MAX_2026)
    : 0;
  const socialInsurance = roundMoney(insuredWage * EGYPT_SI_EMPLOYEE_RATE);

  const taxableAnnual = Math.max(
    0,
    gross * 12 - socialInsurance * 12 - EGYPT_INCOME_TAX_ANNUAL_EXEMPTION,
  );
  let annualTax = 0;
  let prevUpper = 0;
  for (const b of EGYPT_INCOME_TAX_BRACKETS) {
    const inBand = taxableAnnual > prevUpper ? Math.min(taxableAnnual, b.upper) - prevUpper : 0;
    if (inBand <= 0) break;
    annualTax += inBand * b.rate;
    prevUpper = b.upper;
  }

  return {
    socialInsurance,
    incomeTax: roundMoney(annualTax / 12),
    insuredWage,
  };
}
