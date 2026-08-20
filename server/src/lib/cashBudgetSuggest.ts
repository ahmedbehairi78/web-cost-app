import { prisma } from '../db.js';
import { roundMoney } from './money.js';
import { journalDateQueryUpperBound } from './journalDate.js';
import { resolveEntryCostCenterId } from './costCenterAttribution.js';
import {
  allocatePayableByCostCenter,
  computeCashBudgetSummary,
  custodyReplenishAmount,
  isBankLeafCode,
  isClientReceivableLeafCode,
  isCustodyCashLeafCode,
  isCustodyFundAccount,
  isEightDigitLeafCode,
  isSalariesPayableLeafCode,
  isSubcontractorLeafCode,
  isSupplierLeafCode,
  subAccountLabel,
  type CashBudgetPeriodType,
} from './cashBudget.js';

export type SuggestedLine = {
  side: 'obligation' | 'source';
  category: string;
  description: string;
  amount: number;
  dueDate: string | null;
  origin: 'auto';
  originType: string;
  originId: string;
  projectId: string | null;
  contractId: string | null;
  notes?: string | null;
  excluded: boolean;
  sortOrder: number;
};

const GL_PREFIXES = ['12101', '12102', '12201', '21101', '21102', '21501'] as const;

type LeafBucket = {
  net: number;
  byCenter: Map<string, number>;
};

function num(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && 'toNumber' in v && typeof (v as { toNumber: () => number }).toNumber === 'function') {
    return (v as { toNumber: () => number }).toNumber();
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function leafName(name: string | null | undefined, code: string): string {
  return subAccountLabel(name, code);
}

function centerKey(id: string | null): string {
  return id ?? '';
}

export type CostCenterDisplay = { name: string; nameEn: string | null };
export type ProjectDisplay = { id: string; name: string; nameEn: string | null };

export async function loadProjectNameMap(): Promise<Map<string, ProjectDisplay>> {
  const [projects, contracts, centers] = await Promise.all([
    prisma.project.findMany({
      where: { isDeleted: false },
      select: { id: true, projectName: true, projectNameEn: true },
    }),
    prisma.contract.findMany({
      where: { isDeleted: false },
      select: { id: true, projectId: true },
    }),
    prisma.costCenter.findMany({
      where: { isDeleted: false },
      select: { id: true, code: true, contractId: true },
    }),
  ]);
  const byProjectId = new Map<string, ProjectDisplay>();
  for (const row of projects) {
    byProjectId.set(row.id, { id: row.id, name: row.projectName, nameEn: row.projectNameEn });
  }
  const map = new Map<string, ProjectDisplay>();
  for (const row of byProjectId.values()) {
    map.set(row.id, row);
  }
  for (const row of contracts) {
    const project = byProjectId.get(row.projectId);
    if (project) map.set(row.id, project);
  }
  for (const row of centers) {
    const project =
      (row.contractId ? map.get(row.contractId) : undefined)
      ?? map.get(row.id);
    if (!project) continue;
    map.set(row.id, project);
    const code = String(row.code ?? '').trim();
    if (code) map.set(code, project);
  }
  return map;
}

export function lookupProjectName(
  map: Map<string, ProjectDisplay>,
  id: string | null | undefined,
): ProjectDisplay | null {
  const key = String(id ?? '').trim();
  if (!key || key === '_') return null;
  return map.get(key) ?? null;
}

export async function loadCostCenterNameMap(): Promise<Map<string, CostCenterDisplay>> {
  const [centers, contracts] = await Promise.all([
    prisma.costCenter.findMany({
      where: { isDeleted: false },
      select: { id: true, name: true, nameEn: true, code: true, contractId: true },
    }),
    prisma.contract.findMany({
      where: { isDeleted: false },
      select: { id: true, contractName: true, contractNameEn: true },
    }),
  ]);
  const map = new Map<string, CostCenterDisplay>();
  for (const row of contracts) {
    map.set(row.id, { name: row.contractName, nameEn: row.contractNameEn });
  }
  for (const row of centers) {
    const names: CostCenterDisplay = { name: row.name, nameEn: row.nameEn };
    map.set(row.id, names);
    const code = String(row.code ?? '').trim();
    if (code) map.set(code, names);
    const contractId = String(row.contractId ?? '').trim();
    if (contractId && !map.has(contractId)) map.set(contractId, names);
  }
  return map;
}

export function lookupCostCenterName(
  map: Map<string, CostCenterDisplay>,
  id: string | null | undefined,
): CostCenterDisplay | null {
  const key = String(id ?? '').trim();
  if (!key || key === '_') return null;
  return map.get(key) ?? null;
}

/** Net debit per 8-digit leaf, also split by resolved cost center. */
async function glLeafBucketsThrough(asOf: string): Promise<Map<string, LeafBucket>> {
  const upper = journalDateQueryUpperBound(asOf);
  const rows = await prisma.journalEntry.findMany({
    where: {
      OR: GL_PREFIXES.map((prefix) => ({ accountCode: { startsWith: prefix } })),
      transaction: {
        isDeleted: false,
        ...(upper ? { date: { lte: upper } } : {}),
      },
    },
    select: {
      accountCode: true,
      debit: true,
      credit: true,
      costCenterId: true,
      transaction: { select: { costCenterId: true } },
    },
  });
  const byCode = new Map<string, LeafBucket>();
  for (const row of rows) {
    const code = String(row.accountCode ?? '').trim();
    if (!isEightDigitLeafCode(code)) continue;
    const net = roundMoney(num(row.debit) - num(row.credit));
    const cc = resolveEntryCostCenterId(
      { costCenterId: row.costCenterId },
      row.transaction?.costCenterId,
    );
    const bucket = byCode.get(code) ?? { net: 0, byCenter: new Map<string, number>() };
    bucket.net = roundMoney(bucket.net + net);
    const key = centerKey(cc);
    bucket.byCenter.set(key, roundMoney((bucket.byCenter.get(key) ?? 0) + net));
    byCode.set(code, bucket);
  }
  return byCode;
}

function sumPositiveNets(byCode: Map<string, LeafBucket>, match: (code: string) => boolean): number {
  let total = 0;
  for (const [code, bucket] of byCode) {
    if (!match(code)) continue;
    total = roundMoney(total + Math.max(0, bucket.net));
  }
  return total;
}

function obligationCategory(code: string): 'supplier' | 'subcontractor' | 'payroll' | null {
  if (isSupplierLeafCode(code)) return 'supplier';
  if (isSubcontractorLeafCode(code)) return 'subcontractor';
  if (isSalariesPayableLeafCode(code)) return 'payroll';
  return null;
}

/**
 * Snapshot as of period end (no GL posting):
 * sources (KPI only) = banks 12101 + cash/treasury 12102 + uncollected IPCs 12201
 * obligations = supplier/subcontractor/payroll payables split by cost center
 *   + custody replenish when 12102 < min
 */
export async function buildCashBudgetSuggestion(input: {
  periodType: CashBudgetPeriodType;
  periodStart: string;
  periodEnd: string;
}): Promise<{ openingBank: number; openingCash: number; lines: SuggestedLine[] }> {
  const asOf = input.periodEnd;
  void input.periodType;
  void input.periodStart;
  const [buckets, settlements, accounts, projectNames] = await Promise.all([
    glLeafBucketsThrough(asOf),
    prisma.custodySettlement.findMany({
      where: { isDeleted: false, status: 'submitted' },
      select: { custodyAccountCode: true, totalAmount: true },
    }),
    prisma.chartOfAccount.findMany({
      where: { isGroup: false, status: { not: 'disabled' } },
      select: {
        id: true,
        accountCode: true,
        accountName: true,
        accountNameEn: true,
        minBalance: true,
        projectId: true,
      },
    }),
    loadProjectNameMap(),
  ]);

  const pendingByCustody = new Map<string, number>();
  for (const row of settlements) {
    const code = String(row.custodyAccountCode ?? '').trim();
    pendingByCustody.set(code, roundMoney((pendingByCustody.get(code) ?? 0) + num(row.totalAmount)));
  }

  const coaByCode = new Map(accounts.map((a) => [String(a.accountCode ?? '').trim(), a]));

  const lines: SuggestedLine[] = [];
  let sort = 0;
  const push = (line: Omit<SuggestedLine, 'origin' | 'excluded' | 'sortOrder'>) => {
    if (roundMoney(line.amount) <= 0) return;
    lines.push({ ...line, origin: 'auto', excluded: false, sortOrder: sort++ });
  };

  for (const [code, bucket] of [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const acc = coaByCode.get(code);
    const name = leafName(acc?.accountName, code);

    if (isBankLeafCode(code)) {
      push({
        side: 'source',
        category: 'opening_bank',
        description: name,
        amount: Math.max(0, bucket.net),
        dueDate: asOf,
        originType: 'gl_leaf',
        originId: `${code}::_`,
        projectId: acc?.projectId ?? null,
        contractId: null,
      });
      continue;
    }
    if (isCustodyCashLeafCode(code)) {
      const custody = isCustodyFundAccount({
        accountCode: code,
        minBalance: acc?.minBalance,
        accountName: acc?.accountName,
        accountNameEn: acc?.accountNameEn,
      });
      push({
        side: 'source',
        category: custody ? 'opening_custody' : 'opening_cash',
        description: name,
        amount: Math.max(0, bucket.net),
        dueDate: asOf,
        originType: 'gl_leaf',
        originId: `${code}::_`,
        projectId: acc?.projectId ?? null,
        contractId: null,
      });
      continue;
    }
    if (isClientReceivableLeafCode(code)) {
      push({
        side: 'source',
        category: 'collection',
        description: name,
        amount: Math.max(0, bucket.net),
        dueDate: asOf,
        originType: 'gl_leaf',
        originId: `${code}::_`,
        projectId: acc?.projectId ?? null,
        contractId: null,
      });
      continue;
    }

    const category = obligationCategory(code);
    if (!category) continue;
    const parts = allocatePayableByCostCenter(
      [...bucket.byCenter.entries()].map(([key, netDebit]) => ({
        costCenterId: key || null,
        netDebit,
      })),
    );
    for (const part of parts) {
      const project =
        lookupProjectName(projectNames, part.costCenterId)
        ?? lookupProjectName(projectNames, acc?.projectId);
      push({
        side: 'obligation',
        category,
        description: name,
        amount: part.amount,
        dueDate: asOf,
        originType: 'gl_leaf',
        originId: `${code}::${part.costCenterId || '_'}`,
        projectId: project?.id ?? acc?.projectId ?? null,
        contractId: part.costCenterId,
        notes: project?.name ?? null,
      });
    }
  }

  for (const acc of accounts) {
    const code = String(acc.accountCode ?? '').trim();
    if (!isCustodyCashLeafCode(code)) continue;
    const gl = buckets.get(code)?.net ?? 0;
    const pending = pendingByCustody.get(code) ?? 0;
    const replenish = custodyReplenishAmount(num(acc.minBalance), gl, pending);
    if (replenish <= 0) continue;
    const project = lookupProjectName(projectNames, acc.projectId);
    push({
      side: 'obligation',
      category: 'custody_replenish',
      description: leafName(acc.accountName, code),
      amount: replenish,
      dueDate: asOf,
      originType: 'custody_min',
      originId: acc.id || code,
      projectId: project?.id ?? acc.projectId,
      contractId: null,
      notes: project?.name ?? null,
    });
  }

  return {
    openingBank: sumPositiveNets(buckets, isBankLeafCode),
    openingCash: sumPositiveNets(buckets, isCustodyCashLeafCode),
    lines,
  };
}

export { computeCashBudgetSummary };
