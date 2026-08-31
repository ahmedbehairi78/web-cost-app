import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { roundMoney } from './money.js';

/** Exclude carry-forward opening memos from rolling TB/BS (same rule as Reports.tsx). */
export function isExcludedFiscalOpeningJournal(tx: {
  journalKind?: string | null;
  reference?: string | null;
}): boolean {
  const kind = String(tx.journalKind || '').trim();
  if (kind === 'fiscal_opening') return true;
  return /^OPEN-/i.test(String(tx.reference || '').trim());
}

export type GlTrialBalanceAggRow = {
  accountCode: string;
  openingNet: number;
  debitMovements: number;
  creditMovements: number;
  closingNet: number;
};

export type GlAccountNetRow = {
  accountCode: string;
  netDebit: number;
};

export type BalanceSheetSummary = {
  currentAssets: number;
  nonCurrentAssets: number;
  totalAssets: number;
  currentLiab: number;
  nonCurrentLiab: number;
  totalLiab: number;
  equityAccounts: number;
  allRevenue: number;
  allCosts: number;
  unclosedPeriodPl: number;
  totalEquity: number;
  totalLE: number;
  balanceGap: number;
  inventory127Net: number;
  isBalanced: boolean;
};

export function splitNetToDebitCredit(net: number): { debit: number; credit: number } {
  const n = Number(net) || 0;
  return { debit: n > 0 ? n : 0, credit: n < 0 ? -n : 0 };
}

export function trialRowsFromOpeningAndMovements(
  rows: Array<{
    accountCode: string;
    openingNet: number;
    debitMovements: number;
    creditMovements: number;
  }>,
): GlTrialBalanceAggRow[] {
  return rows
    .map((r) => {
      const accountCode = String(r.accountCode || '').trim();
      const openingNet = roundMoney(Number(r.openingNet) || 0);
      const debitMovements = roundMoney(Number(r.debitMovements) || 0);
      const creditMovements = roundMoney(Number(r.creditMovements) || 0);
      const closingNet = roundMoney(openingNet + debitMovements - creditMovements);
      return { accountCode, openingNet, debitMovements, creditMovements, closingNet };
    })
    .filter(
      (r) =>
        r.accountCode &&
        (r.openingNet !== 0 || r.debitMovements !== 0 || r.creditMovements !== 0 || r.closingNet !== 0),
    )
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
}

/** Prefix sums matching Reports.tsx balance-sheet presentation. */
export function computeBalanceSheetSummary(codeBalMap: Map<string, number> | Record<string, number>): BalanceSheetSummary {
  const get = (code: string) => {
    if (codeBalMap instanceof Map) return Number(codeBalMap.get(code) || 0);
    return Number(codeBalMap[code] || 0);
  };

  let nonCurrentAssets = 0;
  let currentAssets = 0;
  let currentLiabNet = 0;
  let nonCurrentLiabNet = 0;
  let equityNet = 0;
  let revenueNet = 0;
  let costsNet = 0;
  let inventory127Net = 0;

  const codes =
    codeBalMap instanceof Map ? [...codeBalMap.keys()] : Object.keys(codeBalMap);

  for (const code of codes) {
    const bal = roundMoney(get(code));
    if (!code) continue;
    if (code.startsWith('11')) nonCurrentAssets = roundMoney(nonCurrentAssets + bal);
    else if (code.startsWith('12')) currentAssets = roundMoney(currentAssets + bal);
    if (code.startsWith('21')) currentLiabNet = roundMoney(currentLiabNet + bal);
    else if (code.startsWith('22')) nonCurrentLiabNet = roundMoney(nonCurrentLiabNet + bal);
    if (code.startsWith('3')) equityNet = roundMoney(equityNet + bal);
    if (code.startsWith('4')) revenueNet = roundMoney(revenueNet + bal);
    if (code.startsWith('5')) costsNet = roundMoney(costsNet + bal);
    if (code.startsWith('127')) inventory127Net = roundMoney(inventory127Net + bal);
  }

  const totalAssets = roundMoney(currentAssets + nonCurrentAssets);
  const currentLiab = roundMoney(-currentLiabNet);
  const nonCurrentLiab = roundMoney(-nonCurrentLiabNet);
  const totalLiab = roundMoney(currentLiab + nonCurrentLiab);
  const equityAccounts = roundMoney(-equityNet);
  const allRevenue = roundMoney(-revenueNet);
  const allCosts = roundMoney(costsNet);
  const unclosedPeriodPl = roundMoney(allRevenue - allCosts);
  const totalEquity = equityAccounts;
  const totalLE = roundMoney(totalLiab + totalEquity);
  const balanceGap = roundMoney(totalAssets - totalLE);

  return {
    currentAssets,
    nonCurrentAssets,
    totalAssets,
    currentLiab,
    nonCurrentLiab,
    totalLiab,
    equityAccounts,
    allRevenue,
    allCosts,
    unclosedPeriodPl,
    totalEquity,
    totalLE,
    balanceGap,
    inventory127Net,
    isBalanced: Math.abs(balanceGap) <= 1,
  };
}

function buildRollingGlWhere(params: {
  projectId?: string | null;
  contractId?: string | null;
  /** Inclusive YYYY-MM-DD — omit for all dates */
  asOf?: string | null;
  /** null = unrestricted; [] = no access */
  allowedContractIds?: string[] | null;
}): Prisma.Sql | null {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`t.is_deleted = false`,
    // Prefer reference markers so reports still work if journal_kind was never backfilled.
    Prisma.sql`COALESCE(t.journal_kind, '') <> 'fiscal_opening'`,
    Prisma.sql`COALESCE(t.reference, '') !~* '^OPEN-'`,
  ];

  const asOf = String(params.asOf || '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    conditions.push(Prisma.sql`LEFT(t.date, 10) <= ${asOf}`);
  }

  const projectId = String(params.projectId || '').trim();
  if (projectId && projectId !== 'all') {
    // Company-wide fiscal close has no projectId — still include YE-PL / fiscal_pl_close.
    conditions.push(Prisma.sql`(
      t.project_id = ${projectId}
      OR COALESCE(t.journal_kind, '') = 'fiscal_pl_close'
      OR COALESCE(t.reference, '') ~* '^YE-PL-'
    )`);
  }

  const contractId = String(params.contractId || '').trim();
  if (contractId && contractId !== 'all') {
    conditions.push(Prisma.sql`(
      COALESCE(je.cost_center_id, t.cost_center_id) = ${contractId}
      OR COALESCE(t.journal_kind, '') = 'fiscal_pl_close'
      OR COALESCE(t.reference, '') ~* '^YE-PL-'
    )`);
  }

  if (params.allowedContractIds !== null && params.allowedContractIds !== undefined) {
    if (params.allowedContractIds.length === 0) return null;
    // Scoped users: keep their contract journals + company-wide P&L close (no cost center).
    conditions.push(Prisma.sql`(
      t.cost_center_id IN (${Prisma.join(params.allowedContractIds)})
      OR COALESCE(t.journal_kind, '') = 'fiscal_pl_close'
      OR COALESCE(t.reference, '') ~* '^YE-PL-'
    )`);
  }

  return Prisma.join(conditions, ' AND ');
}

type RawTrialRow = {
  accountCode: string;
  openingNet: unknown;
  debitMovements: unknown;
  creditMovements: unknown;
};

type RawNetRow = {
  accountCode: string;
  netDebit: unknown;
};

/**
 * Full-history trial balance aggregates (opening before periodStart + in-period movements).
 * Includes fiscal_pl_close / YE-PL so period close zeros class 4/5 into retained earnings.
 */
export async function queryTrialBalanceAggregates(params: {
  periodStart: string;
  /** Inclusive end date for movements/closing (default: no upper bound). */
  asOf?: string | null;
  projectId?: string | null;
  contractId?: string | null;
  allowedContractIds?: string[] | null;
}): Promise<GlTrialBalanceAggRow[]> {
  const periodStart = String(params.periodStart || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart)) {
    throw new Error('periodStart must be YYYY-MM-DD');
  }
  const asOfRaw = String(params.asOf || '').trim().slice(0, 10);
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(asOfRaw) ? asOfRaw : null;
  if (asOf && asOf < periodStart) {
    throw new Error('asOf must be >= periodStart');
  }

  const where = buildRollingGlWhere({ ...params, asOf });
  if (!where) return [];

  // buildRollingGlWhere already caps LEFT(date) <= asOf when set.
  const rows = await prisma.$queryRaw<RawTrialRow[]>`
    SELECT
      TRIM(je.account_code) AS "accountCode",
      COALESCE(
        SUM(
          CASE
            WHEN LEFT(t.date, 10) < ${periodStart}
            THEN (je.debit::numeric - je.credit::numeric)
            ELSE 0
          END
        ),
        0
      ) AS "openingNet",
      COALESCE(
        SUM(
          CASE
            WHEN LEFT(t.date, 10) >= ${periodStart}
            THEN je.debit::numeric
            ELSE 0
          END
        ),
        0
      ) AS "debitMovements",
      COALESCE(
        SUM(
          CASE
            WHEN LEFT(t.date, 10) >= ${periodStart}
            THEN je.credit::numeric
            ELSE 0
          END
        ),
        0
      ) AS "creditMovements"
    FROM journal_entries je
    INNER JOIN transactions t ON t.id = je.transaction_id
    WHERE ${where}
    GROUP BY TRIM(je.account_code)
  `;

  return trialRowsFromOpeningAndMovements(
    rows.map((r) => ({
      accountCode: String(r.accountCode || ''),
      openingNet: Number(r.openingNet),
      debitMovements: Number(r.debitMovements),
      creditMovements: Number(r.creditMovements),
    })),
  );
}

/**
 * Full-history leaf nets for rolling balance sheet (excludes fiscal_opening / OPEN-*).
 */
export async function queryBalanceSheetNets(params: {
  projectId?: string | null;
  contractId?: string | null;
  /** Inclusive as-of date — use fiscal close periodEnd to see post-close balanced BS */
  asOf?: string | null;
  allowedContractIds?: string[] | null;
} = {}): Promise<GlAccountNetRow[]> {
  const where = buildRollingGlWhere(params);
  if (!where) return [];

  const rows = await prisma.$queryRaw<RawNetRow[]>`
    SELECT
      TRIM(je.account_code) AS "accountCode",
      COALESCE(SUM(je.debit::numeric - je.credit::numeric), 0) AS "netDebit"
    FROM journal_entries je
    INNER JOIN transactions t ON t.id = je.transaction_id
    WHERE ${where}
    GROUP BY TRIM(je.account_code)
  `;

  return rows
    .map((r) => ({
      accountCode: String(r.accountCode || '').trim(),
      netDebit: roundMoney(Number(r.netDebit) || 0),
    }))
    .filter((r) => r.accountCode && Math.abs(r.netDebit) > 0)
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
}

export function netsToCodeBalMap(rows: GlAccountNetRow[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const row of rows) {
    map[row.accountCode] = row.netDebit;
  }
  return map;
}
