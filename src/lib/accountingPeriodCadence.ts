export type PeriodCadence = 'monthly' | 'quarterly' | 'semi_annual' | 'annual';

export type ClosingType = 'oha' | 'income_statement' | 'period_lock';

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Suggested period range + label for a closing cadence (calendar month / quarter / half / year). */
export function periodRangeForCadence(cadence: PeriodCadence, ref = new Date()): { start: string; end: string; label: string } {
  const y = ref.getFullYear();
  const m = ref.getMonth();

  switch (cadence) {
    case 'monthly': {
      const start = new Date(y, m, 1);
      const end = new Date(y, m + 1, 0);
      return { start: fmtDate(start), end: fmtDate(end), label: `${y}-${pad2(m + 1)}` };
    }
    case 'quarterly': {
      const q = Math.floor(m / 3);
      const startMonth = q * 3;
      const start = new Date(y, startMonth, 1);
      const end = new Date(y, startMonth + 3, 0);
      return { start: fmtDate(start), end: fmtDate(end), label: `Q${q + 1}-${y}` };
    }
    case 'semi_annual': {
      const half = m < 6 ? 0 : 1;
      const start = new Date(y, half * 6, 1);
      const end = new Date(y, half * 6 + 6, 0);
      return { start: fmtDate(start), end: fmtDate(end), label: half === 0 ? `H1-${y}` : `H2-${y}` };
    }
    case 'annual':
      return { start: `${y}-01-01`, end: `${y}-12-31`, label: String(y) };
    default:
      return periodRangeForCadence('quarterly', ref);
  }
}
