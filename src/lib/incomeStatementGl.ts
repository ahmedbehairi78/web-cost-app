import type { JournalEntry } from '../types';
import { resolveEntryCostCenterId } from './costCenterAttribution';

type TxLike = {
  entries?: JournalEntry[];
  costCenterId?: string | null;
  projectId?: string | null;
  isDeleted?: boolean;
  journalKind?: string | null;
  reference?: string | null;
};

function normCode(code: string | undefined): string {
  return String(code ?? '').trim();
}

/**
 * Year-end P&L close zeros class 4/5 company-wide. Income statement must show
 * period activity before that close — exclude from IS aggregation only (keep on BS/TB).
 */
export function isExcludedFromIncomeStatement(tx: {
  journalKind?: string | null;
  reference?: string | null;
}): boolean {
  const kind = String(tx.journalKind || '').trim();
  if (kind === 'fiscal_pl_close') return true;
  const ref = String(tx.reference || '').trim();
  return /^YE-PL-/i.test(ref);
}

/**
 * Match a GL transaction to a project filter via header projectId or cost centers
 * that belong to contracts of that project.
 */
export function transactionMatchesProjectFilter(
  tx: {
    projectId?: string | null;
    costCenterId?: string | null;
    entries?: Array<{ costCenterId?: string | null }>;
  },
  projectId: string,
  contractIdsForProject: ReadonlySet<string>,
): boolean {
  const target = String(projectId || '').trim();
  if (!target || target === 'all') return true;
  if (String(tx.projectId ?? '').trim() === target) return true;
  const headerCc = String(tx.costCenterId ?? '').trim();
  if (headerCc && contractIdsForProject.has(headerCc)) return true;
  return (tx.entries ?? []).some((e) => {
    const cc = resolveEntryCostCenterId(e, tx.costCenterId);
    return Boolean(cc && contractIdsForProject.has(cc));
  });
}

/**
 * When filtering by project, keep lines whose cost center belongs to the project
 * (or header projectId when the line has no cost center).
 */
export function entryMatchesProjectFilter(
  tx: { projectId?: string | null; costCenterId?: string | null },
  entry: { costCenterId?: string | null },
  projectId: string,
  contractIdsForProject: ReadonlySet<string>,
): boolean {
  const target = String(projectId || '').trim();
  if (!target || target === 'all') return true;
  const cc = resolveEntryCostCenterId(entry, tx.costCenterId);
  if (cc) return contractIdsForProject.has(cc);
  return String(tx.projectId ?? '').trim() === target;
}

export type IncomeStatementTotals = {
  revenue: number;
  contractCosts: number;
  grossContractProfit: number;
  gaExpenses: number;
  financeExpenses: number;
  profitBeforeTax: number;
  leafBalances: Record<string, number>;
};

/**
 * Sum net (debit − credit) per leaf account across all matching journal lines.
 * Must sum every line — never `.find()` one line per transaction (payroll / OHA
 * often post multiple lines on the same account code with different cost centers).
 */
export function buildIncomeStatementLeafBalances(
  transactions: TxLike[],
  leafAccountCodes: Iterable<string>,
  entryMatchesFilter: (tx: TxLike, entry: JournalEntry) => boolean = () => true,
): Record<string, number> {
  const leafBalances: Record<string, number> = {};
  for (const code of leafAccountCodes) {
    const key = normCode(code);
    if (key) leafBalances[key] = 0;
  }

  for (const t of transactions) {
    for (const e of t.entries || []) {
      const code = normCode(e.accountCode);
      if (!(code in leafBalances)) continue;
      if (!entryMatchesFilter(t, e)) continue;
      leafBalances[code] += Number(e.debit || 0) - Number(e.credit || 0);
    }
  }

  return leafBalances;
}

function sumPrefixFromLeaves(
  leafBalances: Record<string, number>,
  prefix: string,
  nature: 'debit' | 'credit',
): number {
  let sum = 0;
  for (const [code, net] of Object.entries(leafBalances)) {
    if (!code.startsWith(prefix)) continue;
    sum += nature === 'debit' ? net : -net;
  }
  return sum;
}

/** Build P&L totals from filtered transactions (caller must exclude fiscal_pl_close). */
export function buildIncomeStatementTotals(
  transactions: TxLike[],
  leafAccountCodes: Iterable<string>,
  entryMatchesFilter: (tx: TxLike, entry: JournalEntry) => boolean = () => true,
): IncomeStatementTotals {
  const leafBalances = buildIncomeStatementLeafBalances(
    transactions,
    leafAccountCodes,
    entryMatchesFilter,
  );
  const revenue = sumPrefixFromLeaves(leafBalances, '4', 'credit');
  const contractCosts = sumPrefixFromLeaves(leafBalances, '51', 'debit');
  const gaExpenses = sumPrefixFromLeaves(leafBalances, '52', 'debit');
  const financeExpenses = sumPrefixFromLeaves(leafBalances, '53', 'debit');
  const grossContractProfit = revenue - contractCosts;
  const profitBeforeTax = grossContractProfit - gaExpenses - financeExpenses;
  return {
    revenue,
    contractCosts,
    grossContractProfit,
    gaExpenses,
    financeExpenses,
    profitBeforeTax,
    leafBalances,
  };
}
