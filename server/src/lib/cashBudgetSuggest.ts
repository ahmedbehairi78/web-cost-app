import { prisma } from '../db.js';
import { roundMoney } from './money.js';
import { journalDateQueryUpperBound } from './journalDate.js';
import { resolveEntryCostCenterId } from './costCenterAttribution.js';
import { isServiceIpcKind, periodLineAmount, SERVICE_IPC_TYPE } from './serviceContractor.js';
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
  ymdKey,
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
      select: { id: true, projectName: true, projectNameEn: true },
    }),
    prisma.contract.findMany({
      select: { id: true, projectId: true },
    }),
    prisma.costCenter.findMany({
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

export function resolveBudgetProjectId(
  map: Map<string, ProjectDisplay>,
  costCenterId: string | null | undefined,
  transactionProjectId: string | null | undefined,
): string | null {
  const fromCenter = lookupProjectName(map, costCenterId);
  if (fromCenter) return fromCenter.id;
  const fromTx = lookupProjectName(map, transactionProjectId);
  if (fromTx) return fromTx.id;
  const raw = String(transactionProjectId ?? '').trim();
  return raw || null;
}

/** Net debit per 8-digit leaf, also split by resolved project. */
async function glLeafLinesThrough(asOf: string): Promise<Array<{
  accountCode: string;
  net: number;
  costCenterId: string | null;
  projectId: string | null;
}>> {
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
      transaction: { select: { costCenterId: true, projectId: true } },
    },
  });
  return rows.map((row) => ({
    accountCode: String(row.accountCode ?? '').trim(),
    net: roundMoney(num(row.debit) - num(row.credit)),
    costCenterId: resolveEntryCostCenterId(
      { costCenterId: row.costCenterId },
      row.transaction?.costCenterId,
    ),
    projectId: String(row.transaction?.projectId ?? '').trim() || null,
  }));
}

function foldLeafBuckets(
  lines: Array<{ accountCode: string; net: number; costCenterId: string | null; projectId: string | null }>,
  projectMap: Map<string, ProjectDisplay>,
): Map<string, LeafBucket> {
  const byCode = new Map<string, LeafBucket>();
  for (const row of lines) {
    if (!isEightDigitLeafCode(row.accountCode)) continue;
    const projectId = resolveBudgetProjectId(projectMap, row.costCenterId, row.projectId);
    const bucket = byCode.get(row.accountCode) ?? { net: 0, byCenter: new Map<string, number>() };
    bucket.net = roundMoney(bucket.net + row.net);
    const key = centerKey(projectId);
    bucket.byCenter.set(key, roundMoney((bucket.byCenter.get(key) ?? 0) + row.net));
    byCode.set(row.accountCode, bucket);
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

export type CustodyFloorRow = {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountNameEn: string | null;
  projectId: string | null;
  minBalance: number;
  glBalance: number;
  pendingSettlements: number;
  replenish: number;
};

export function computeCustodyFloorRows(
  accounts: Array<{
    id?: string | null;
    accountCode?: string | null;
    accountName?: string | null;
    accountNameEn?: string | null;
    projectId?: string | null;
    minBalance?: unknown;
  }>,
  buckets: Map<string, LeafBucket>,
  pendingByCustody: Map<string, number>,
): CustodyFloorRow[] {
  const rows: CustodyFloorRow[] = [];
  for (const acc of accounts) {
    const code = String(acc.accountCode ?? '').trim();
    if (!isCustodyCashLeafCode(code)) continue;
    const gl = buckets.get(code)?.net ?? 0;
    const pending = pendingByCustody.get(code) ?? 0;
    const minBalance = num(acc.minBalance);
    rows.push({
      accountId: String(acc.id ?? code),
      accountCode: code,
      accountName: leafName(acc.accountName, code),
      accountNameEn: acc.accountNameEn ?? null,
      projectId: acc.projectId ?? null,
      minBalance,
      glBalance: roundMoney(gl),
      pendingSettlements: roundMoney(pending),
      replenish: custodyReplenishAmount(minBalance, gl, pending),
    });
  }
  return rows.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
}

export async function loadCustodyFloorRows(asOf: string): Promise<CustodyFloorRow[]> {
  const day = ymdKey(asOf);
  const [glLines, settlements, accounts, projectNames] = await Promise.all([
    glLeafLinesThrough(day || asOf),
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
  const buckets = foldLeafBuckets(glLines, projectNames);
  const pendingByCustody = new Map<string, number>();
  for (const row of settlements) {
    const code = String(row.custodyAccountCode ?? '').trim();
    pendingByCustody.set(code, roundMoney((pendingByCustody.get(code) ?? 0) + num(row.totalAmount)));
  }
  return computeCustodyFloorRows(accounts, buckets, pendingByCustody);
}

function obligationCategory(
  code: string,
  serviceLeafCodes: Set<string>,
): 'supplier' | 'subcontractor' | 'service' | 'payroll' | null {
  if (isSupplierLeafCode(code)) return 'supplier';
  if (isSubcontractorLeafCode(code)) {
    return serviceLeafCodes.has(code) ? 'service' : 'subcontractor';
  }
  if (isSalariesPayableLeafCode(code)) return 'payroll';
  return null;
}

/** 21102 leaves linked to suppliers with a service IPC kind (labour/equipment/…). */
async function loadServiceContractorLeafCodes(): Promise<Set<string>> {
  const [accounts, suppliers] = await Promise.all([
    prisma.chartOfAccount.findMany({
      where: { isGroup: false, supplierId: { not: null } },
      select: { accountCode: true, supplierId: true },
    }),
    prisma.supplier.findMany({
      where: { isDeleted: false, serviceKind: { not: null } },
      select: { id: true, serviceKind: true },
    }),
  ]);
  const serviceSupplierIds = new Set(
    suppliers.filter((s) => isServiceIpcKind(s.serviceKind)).map((s) => s.id),
  );
  const codes = new Set<string>();
  for (const acc of accounts) {
    const code = String(acc.accountCode ?? '').trim();
    if (!isSubcontractorLeafCode(code)) continue;
    if (acc.supplierId && serviceSupplierIds.has(acc.supplierId)) codes.add(code);
  }
  return codes;
}

/**
 * Snapshot as of period end (no GL posting):
 * sources (KPI only) = banks 12101 + cash/treasury 12102 + uncollected IPCs 12201
 * settlement pool after approve = banks 12101 only (never 12102 custody/cash)
 * obligations = supplier / subcontractor / service / payroll payables split by cost center
 *   + submitted (unposted) service IPCs
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
  const [glLines, settlements, accounts, projectNames, serviceLeafCodes, pendingServiceIpcs] = await Promise.all([
    glLeafLinesThrough(asOf),
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
    loadServiceContractorLeafCodes(),
    prisma.purchaseTransaction.findMany({
      where: {
        type: SERVICE_IPC_TYPE,
        status: 'submitted',
        transactionId: null,
        isDeleted: false,
        date: { lte: journalDateQueryUpperBound(asOf) || asOf },
      },
      include: { items: { select: { payload: true } } },
    }),
  ]);
  const buckets = foldLeafBuckets(glLines, projectNames);

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

    const category = obligationCategory(code, serviceLeafCodes);
    if (!category) continue;
    const parts = allocatePayableByCostCenter(
      [...bucket.byCenter.entries()].map(([key, netDebit]) => ({
        costCenterId: key || null,
        netDebit,
      })),
    );
    for (const part of parts) {
      const project = lookupProjectName(projectNames, part.costCenterId);
      push({
        side: 'obligation',
        category,
        description: name,
        amount: part.amount,
        dueDate: asOf,
        originType: 'gl_leaf',
        originId: `${code}::${part.costCenterId || '_'}`,
        projectId: project?.id ?? (part.costCenterId || null),
        contractId: part.costCenterId,
        notes: project?.name ?? null,
      });
    }
  }

  for (const ipc of pendingServiceIpcs) {
    const netPayable = roundMoney(num(ipc.totalAmount));
    if (netPayable <= 0) continue;
    const label = ipc.referenceNumber?.trim() || ipc.supplierName || ipc.id.slice(0, 8);
    const payload = ipc.items[0]?.payload;
    const rawItems =
      payload && typeof payload === 'object' && Array.isArray((payload as { items?: unknown }).items)
        ? ((payload as { items: Array<Record<string, unknown>> }).items)
        : Array.isArray(payload)
          ? (payload as Array<Record<string, unknown>>)
          : [];
    const weights = rawItems.map((item) => ({
      contractId: String(item.contractId ?? '').trim() || null,
      projectId: String(item.projectId ?? '').trim() || null,
      weight: Math.max(0, roundMoney(periodLineAmount({
        currentQty: Number(item.currentQty) || 0,
        rate: Number(item.rate) || 0,
      }))),
    }));
    const weightSum = weights.reduce((s, w) => roundMoney(s + w.weight), 0);

    if (weightSum <= 0 || weights.length === 0) {
      const project = lookupProjectName(projectNames, ipc.projectId ?? ipc.contractId);
      push({
        side: 'obligation',
        category: 'service',
        description: label,
        amount: netPayable,
        dueDate: ymdKey(ipc.date) || asOf,
        originType: 'service_ipc_pending',
        originId: ipc.id,
        projectId: project?.id ?? ipc.projectId ?? null,
        contractId: ipc.contractId,
        notes: project?.name ?? null,
      });
      continue;
    }

    let allocated = 0;
    weights.forEach((w, index) => {
      const isLast = index === weights.length - 1;
      const amount = isLast
        ? roundMoney(netPayable - allocated)
        : roundMoney((w.weight / weightSum) * netPayable);
      allocated = roundMoney(allocated + amount);
      if (amount <= 0) return;
      const project = lookupProjectName(projectNames, w.projectId || w.contractId);
      push({
        side: 'obligation',
        category: 'service',
        description: label,
        amount,
        dueDate: ymdKey(ipc.date) || asOf,
        originType: 'service_ipc_pending',
        originId: `${ipc.id}::${w.contractId || '_'}`,
        projectId: project?.id ?? w.projectId,
        contractId: w.contractId,
        notes: project?.name ?? null,
      });
    });
  }

  for (const floor of computeCustodyFloorRows(accounts, buckets, pendingByCustody)) {
    if (floor.replenish <= 0) continue;
    const project = lookupProjectName(projectNames, floor.projectId);
    push({
      side: 'obligation',
      category: 'custody_replenish',
      description: floor.accountName,
      amount: floor.replenish,
      dueDate: asOf,
      originType: 'custody_min',
      originId: floor.accountId || floor.accountCode,
      projectId: project?.id ?? floor.projectId,
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
