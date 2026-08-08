import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { createTransaction } from './journal.js';
import { AccountCodes } from './accountCodes.js';
import type { JournalEntryInput } from './journalShared.js';
import { isMoneyBalanced, roundMoney, MONEY_TOLERANCE } from '../lib/money.js';
import { businessTodayYmd } from '../lib/businessCalendar.js';
import { assertTransactionsPeriodUnlocked } from './periodLock.js';

const LIQUIDITY_BILLED_STATUSES = ['submitted', 'review', 'approved', 'paid'] as const;

export type DistributionBasis = 'billing_works' | 'contract_value' | 'equal' | 'revenue_ratio';
export type BoqLoadingBasis = 'boq_value' | 'boq_qty' | 'equal';

const OHA_PREFIX = 'OHA-';
const BALANCE_TOLERANCE = MONEY_TOLERANCE;
const OHA_CONTRACT_LOAD_ACCOUNT = AccountCodes.EXPENSE_INDIRECT_SITE;

function ohaAllocationDebitAccountName(indirectCenterName: string): string {
  return `توزيع مصروفات (${indirectCenterName})`;
}

function num(v: unknown): number {
  return Number(v) || 0;
}

function isExpenseAccount(code: string): boolean {
  return String(code).trim().startsWith('5');
}

export function normalizeDistributionBasis(raw: string | null | undefined): DistributionBasis {
  const v = String(raw ?? '').trim();
  if (v === 'revenue_ratio' || v === 'billing_works') return 'billing_works';
  if (v === 'contract_value' || v === 'equal') return v;
  return 'billing_works';
}

export function normalizeBoqLoadingBasis(raw: string | null | undefined): BoqLoadingBasis {
  const v = String(raw ?? '').trim();
  if (v === 'boq_qty' || v === 'equal') return v;
  return 'boq_value';
}

/**
 * Journal date for an OHA close: clamp the close day into [periodStart, periodEnd].
 * Avoid dating early-closed quarters at periodEnd (e.g. Q3 closed in July → 09-30),
 * which leaves payroll inside a YTD dashboard filter while the OHA credit sits outside it.
 */
export function resolveOverheadCloseJournalDate(
  periodStart: string,
  periodEnd: string,
  asOf: Date | string = new Date(),
): string {
  const start = String(periodStart || '').slice(0, 10);
  const end = String(periodEnd || '').slice(0, 10);
  const raw =
    typeof asOf === 'string'
      ? String(asOf).slice(0, 10)
      : businessTodayYmd(undefined, asOf);
  if (start && raw < start) return start;
  if (end && raw > end) return end;
  return raw || end || start;
}

/** Read BOQ loading basis from DB (works when Prisma client predates the column). */
export async function readPeriodBoqLoadingBasis(periodId: string): Promise<BoqLoadingBasis> {
  try {
    const rows = await prisma.$queryRaw<Array<{ boq_loading_basis: string }>>`
      SELECT boq_loading_basis FROM overhead_allocation_periods WHERE id = ${periodId} LIMIT 1
    `;
    return normalizeBoqLoadingBasis(rows[0]?.boq_loading_basis);
  } catch {
    return 'boq_value';
  }
}

export async function persistPeriodBoqLoadingBasis(
  periodId: string,
  basis: BoqLoadingBasis,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE overhead_allocation_periods SET boq_loading_basis = ${basis} WHERE id = ${periodId}
  `;
}

export type IndirectCenterSelectionRow = {
  id: string;
  code: string;
  name: string;
  nameEn: string | null;
  included: boolean;
  poolTotal: number;
};

export async function loadActiveIndirectCenterIds(): Promise<string[]> {
  const rows = await prisma.costCenter.findMany({
    where: { type: 'indirect', isDeleted: false, isActive: true },
    select: { id: true },
    orderBy: { code: 'asc' },
  });
  return rows.map((r) => r.id);
}

function parseIncludedCenterIds(raw: unknown): string[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return null;
  return raw.map(String).filter(Boolean);
}

export async function readPeriodIncludedCenterIdsRaw(periodId: string): Promise<string[] | null> {
  const period = await prisma.overheadAllocationPeriod.findUnique({ where: { id: periodId } });
  if (!period) throw new Error('Period not found');
  return parseIncludedCenterIds(period.includedIndirectCenterIds);
}

/** Stored selection, or all active centers when legacy/null. */
export async function resolvePeriodIncludedCenterIds(periodId: string): Promise<string[]> {
  const stored = await readPeriodIncludedCenterIdsRaw(periodId);
  const active = await loadActiveIndirectCenterIds();
  if (stored === null) return active;
  const activeSet = new Set(active);
  return stored.filter((id) => activeSet.has(id));
}

export async function persistPeriodIncludedCenterIds(periodId: string, ids: string[]): Promise<void> {
  const period = await prisma.overheadAllocationPeriod.findUnique({ where: { id: periodId } });
  if (!period) throw new Error('Period not found');
  if (period.status !== 'draft') throw new Error('Only draft periods can be edited');

  const activeSet = new Set(await loadActiveIndirectCenterIds());
  const normalized = [...new Set(ids.filter((id) => activeSet.has(String(id))))];

  await prisma.overheadAllocationPeriod.update({
    where: { id: periodId },
    data: { includedIndirectCenterIds: normalized },
  });
}

export async function buildIndirectCenterSelection(
  periodId: string,
  periodStart: string,
  periodEnd: string,
): Promise<{ rows: IndirectCenterSelectionRow[]; includedIds: string[]; excludedPoolTotal: number }> {
  const centers = await prisma.costCenter.findMany({
    where: { type: 'indirect', isDeleted: false, isActive: true },
    orderBy: { code: 'asc' },
  });
  const includedIds = await resolvePeriodIncludedCenterIds(periodId);
  const includedSet = new Set(includedIds);
  const allPools = await computeIndirectPools(periodStart, periodEnd);

  const poolByCenter = new Map<string, number>();
  for (const p of allPools) {
    poolByCenter.set(
      p.indirectCenterId,
      roundMoney((poolByCenter.get(p.indirectCenterId) ?? 0) + p.poolAmount),
    );
  }

  let excludedPoolTotal = 0;
  const rows: IndirectCenterSelectionRow[] = centers.map((c) => {
    const poolTotal = poolByCenter.get(c.id) ?? 0;
    const included = includedSet.has(c.id);
    if (!included && poolTotal > BALANCE_TOLERANCE) {
      excludedPoolTotal = roundMoney(excludedPoolTotal + poolTotal);
    }
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      nameEn: c.nameEn,
      included,
      poolTotal,
    };
  });

  return { rows, includedIds, excludedPoolTotal };
}

function filterPoolsByIncludedCenters(pools: OverheadPoolRow[], includedIds: string[]): OverheadPoolRow[] {
  const includedSet = new Set(includedIds);
  return pools.filter((p) => includedSet.has(p.indirectCenterId));
}

export type OverheadPoolRow = {
  indirectCenterId: string;
  indirectCenterCode: string;
  indirectCenterName: string;
  accountCode: string;
  accountName: string | null;
  poolAmount: number;
};

export type ContractWeightRow = {
  contractId: string;
  contractName: string;
  contractNumber: string;
  weight: number;
  ratio: number;
};

/** @deprecated use ContractWeightRow */
export type RevenueRatioRow = ContractWeightRow & { revenue: number };

export type OverheadPreviewLine = {
  indirectCenterId: string;
  indirectCenterCode: string;
  indirectCenterName?: string;
  accountCode: string;
  accountName?: string | null;
  contractId: string;
  contractName: string;
  contractNumber: string;
  weight: number;
  ratio: number;
  amount: number;
  computedAmount?: number;
  revenue: number;
};

export type ProposedLineInput = {
  indirectCenterId: string;
  contractId: string;
  accountCode: string;
  amount: number;
};

export type OverheadContractSummary = {
  contractId: string;
  contractName: string;
  contractNumber: string;
  totalAllocated: number;
  lineCount: number;
};

export type OverheadJournalPreviewEntry = {
  side: 'debit' | 'credit';
  accountCode: string;
  accountName?: string | null;
  amount: number;
  costCenterId: string;
  costCenterLabel: string;
};

export type OverheadJournalPreview = {
  indirectCenterId: string;
  indirectCenterCode: string;
  indirectCenterName: string;
  accountCode: string;
  accountName: string | null;
  reference: string;
  description: string;
  poolAmount: number;
  allocatedTotal: number;
  entries: OverheadJournalPreviewEntry[];
  /** Per expense account cleared on the indirect center (credit legs) */
  poolAccounts: Array<{ accountCode: string; accountName: string | null; poolAmount: number }>;
};

function groupPoolsByCenter(pools: OverheadPoolRow[]): Map<string, OverheadPoolRow[]> {
  const map = new Map<string, OverheadPoolRow[]>();
  for (const pool of pools) {
    const list = map.get(pool.indirectCenterId) ?? [];
    list.push(pool);
    map.set(pool.indirectCenterId, list);
  }
  return map;
}

export function centerOhaReference(periodLabel: string, indirectCenterCode: string): string {
  const labelSlug = periodLabel.replace(/\s+/g, '-');
  return `${OHA_PREFIX}${labelSlug}-${indirectCenterCode}`;
}

function resolvePoolContractAmounts(
  pool: OverheadPoolRow,
  useProposed: boolean,
  proposedDraft: ProposedLineInput[],
  weights: ContractWeightRow[],
): Map<string, number> {
  const amounts = new Map<string, number>();
  if (useProposed) {
    for (const line of proposedDraft) {
      if (line.indirectCenterId !== pool.indirectCenterId) continue;
      if (String(line.accountCode).trim() !== pool.accountCode) continue;
      const amt = roundMoney(Number(line.amount) || 0);
      if (amt <= BALANCE_TOLERANCE) continue;
      amounts.set(line.contractId, amt);
    }
  } else {
    const computed = distributePoolAmounts(pool.poolAmount, weights);
    for (const [contractId, amount] of computed) {
      amounts.set(contractId, amount);
    }
  }
  return amounts;
}

function poolKey(indirectCenterId: string, accountCode: string): string {
  return `${indirectCenterId}|${String(accountCode).trim()}`;
}

function buildComputedPreviewLines(
  pools: OverheadPoolRow[],
  weights: ContractWeightRow[],
  totalWeight: number,
): OverheadPreviewLine[] {
  const lines: OverheadPreviewLine[] = [];
  if (totalWeight <= 0) return lines;

  const weightMap = new Map(weights.map((w) => [w.contractId, w]));

  for (const pool of pools) {
    const amounts = distributePoolAmounts(pool.poolAmount, weights);
    for (const [contractId, amount] of amounts) {
      const w = weightMap.get(contractId);
      if (!w) continue;
      lines.push({
        indirectCenterId: pool.indirectCenterId,
        indirectCenterCode: pool.indirectCenterCode,
        indirectCenterName: pool.indirectCenterName,
        accountCode: pool.accountCode,
        accountName: pool.accountName,
        contractId,
        contractName: w.contractName,
        contractNumber: w.contractNumber,
        weight: w.weight,
        ratio: w.ratio,
        amount,
        computedAmount: amount,
        revenue: w.weight,
      });
    }
  }
  return lines;
}

export function validateProposedLinesAgainstPools(
  pools: OverheadPoolRow[],
  lines: ProposedLineInput[],
): { ok: true } | { ok: false; error: string } {
  const poolMap = new Map(pools.map((p) => [poolKey(p.indirectCenterId, p.accountCode), p]));
  const sums = new Map<string, number>();

  for (const line of lines) {
    const amount = roundMoney(Number(line.amount) || 0);
    if (amount <= BALANCE_TOLERANCE) continue;
    const key = poolKey(line.indirectCenterId, line.accountCode);
    const pool = poolMap.get(key);
    if (!pool) {
      return { ok: false, error: `Unknown pool for center/account: ${key}` };
    }
    sums.set(key, roundMoney((sums.get(key) ?? 0) + amount));
  }

  for (const pool of pools) {
    const key = poolKey(pool.indirectCenterId, pool.accountCode);
    const allocated = sums.get(key) ?? 0;
    if (Math.abs(allocated - pool.poolAmount) > BALANCE_TOLERANCE) {
      return {
        ok: false,
        error: `Pool ${pool.indirectCenterCode}/${pool.accountCode}: allocated ${allocated} ≠ pool ${pool.poolAmount}`,
      };
    }
  }

  for (const [key] of sums) {
    if (!poolMap.has(key)) {
      return { ok: false, error: `Allocation does not match any pool: ${key}` };
    }
  }

  return { ok: true };
}

async function loadProposedDraftLines(periodId: string): Promise<ProposedLineInput[]> {
  const rows = await prisma.overheadAllocationLine.findMany({
    where: { periodId, transactionId: null },
  });
  return rows.map((r) => ({
    indirectCenterId: r.indirectCenterId,
    contractId: r.contractId,
    accountCode: r.accountCode,
    amount: num(r.amount),
  }));
}

export async function saveProposedLines(
  periodId: string,
  lines: ProposedLineInput[],
): Promise<void> {
  const period = await prisma.overheadAllocationPeriod.findUnique({ where: { id: periodId } });
  if (!period) throw new Error('Period not found');
  if (period.status !== 'draft') throw new Error('Only draft periods can be edited');

  const pools = await computeIndirectPools(period.periodStart, period.periodEnd);
  const validation = validateProposedLinesAgainstPools(
    filterPoolsByIncludedCenters(pools, await resolvePeriodIncludedCenterIds(periodId)),
    lines,
  );
  if (validation.ok === false) throw new Error(validation.error);

  await prisma.$transaction(async (tx) => {
    await tx.overheadAllocationLine.deleteMany({ where: { periodId, transactionId: null } });
    for (const line of lines) {
      const amount = roundMoney(Number(line.amount) || 0);
      if (amount <= BALANCE_TOLERANCE) continue;
      await tx.overheadAllocationLine.create({
        data: {
          id: randomUUID(),
          periodId,
          indirectCenterId: line.indirectCenterId,
          contractId: line.contractId,
          accountCode: String(line.accountCode).trim(),
          amount,
          transactionId: null,
        },
      });
    }
  });
}

export async function clearProposedLines(periodId: string): Promise<void> {
  const period = await prisma.overheadAllocationPeriod.findUnique({ where: { id: periodId } });
  if (!period) throw new Error('Period not found');
  if (period.status !== 'draft') throw new Error('Only draft periods can be edited');
  await prisma.overheadAllocationLine.deleteMany({ where: { periodId, transactionId: null } });
}

function mergeLinesWithProposed(
  computed: OverheadPreviewLine[],
  proposed: ProposedLineInput[],
  weights: ContractWeightRow[],
  pools: OverheadPoolRow[],
): OverheadPreviewLine[] {
  if (!proposed.length) return computed;

  const weightMap = new Map(weights.map((w) => [w.contractId, w]));
  const poolMap = new Map(pools.map((p) => [poolKey(p.indirectCenterId, p.accountCode), p]));
  const computedMap = new Map(
    computed.map((l) => [`${poolKey(l.indirectCenterId, l.accountCode)}|${l.contractId}`, l]),
  );

  const result: OverheadPreviewLine[] = [];
  for (const p of proposed) {
    const amount = roundMoney(Number(p.amount) || 0);
    if (amount <= BALANCE_TOLERANCE) continue;
    const pk = poolKey(p.indirectCenterId, p.accountCode);
    const pool = poolMap.get(pk);
    const w = weightMap.get(p.contractId);
    const prev = computedMap.get(`${pk}|${p.contractId}`);
    result.push({
      indirectCenterId: p.indirectCenterId,
      indirectCenterCode: pool?.indirectCenterCode ?? '',
      indirectCenterName: pool?.indirectCenterName,
      accountCode: p.accountCode,
      accountName: pool?.accountName ?? prev?.accountName,
      contractId: p.contractId,
      contractName: w?.contractName ?? prev?.contractName ?? p.contractId,
      contractNumber: w?.contractNumber ?? prev?.contractNumber ?? '',
      weight: w?.weight ?? prev?.weight ?? 0,
      ratio: w?.ratio ?? prev?.ratio ?? 0,
      amount,
      computedAmount: prev?.amount,
      revenue: w?.weight ?? prev?.revenue ?? 0,
    });
  }
  return result.sort(
    (a, b) =>
      a.indirectCenterCode.localeCompare(b.indirectCenterCode) ||
      a.accountCode.localeCompare(b.accountCode) ||
      a.contractNumber.localeCompare(b.contractNumber),
  );
}

export function buildContractSummaries(lines: OverheadPreviewLine[]): OverheadContractSummary[] {
  const map = new Map<string, OverheadContractSummary>();
  for (const l of lines) {
    const prev = map.get(l.contractId);
    if (prev) {
      prev.totalAllocated = roundMoney(prev.totalAllocated + l.amount);
      prev.lineCount += 1;
    } else {
      map.set(l.contractId, {
        contractId: l.contractId,
        contractName: l.contractName,
        contractNumber: l.contractNumber,
        totalAllocated: l.amount,
        lineCount: 1,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.totalAllocated - a.totalAllocated);
}

export function buildJournalPreviews(
  periodLabel: string,
  pools: OverheadPoolRow[],
  lines: OverheadPreviewLine[],
  contractLabels: Map<string, { name: string; number: string }>,
): OverheadJournalPreview[] {
  const byPool = new Map<string, OverheadPreviewLine[]>();
  for (const l of lines) {
    const key = poolKey(l.indirectCenterId, l.accountCode);
    const arr = byPool.get(key) ?? [];
    arr.push(l);
    byPool.set(key, arr);
  }

  const previews: OverheadJournalPreview[] = [];

  for (const [_, centerPools] of groupPoolsByCenter(pools)) {
    const head = centerPools[0]!;
    const contractDebitTotals = new Map<string, number>();
    const poolAccounts: OverheadJournalPreview['poolAccounts'] = [];
    let totalPoolAmount = 0;

    for (const pool of centerPools) {
      const poolLines = byPool.get(poolKey(pool.indirectCenterId, pool.accountCode)) ?? [];
      for (const l of poolLines) {
        contractDebitTotals.set(
          l.contractId,
          roundMoney((contractDebitTotals.get(l.contractId) ?? 0) + l.amount),
        );
      }
      poolAccounts.push({
        accountCode: pool.accountCode,
        accountName: pool.accountName,
        poolAmount: pool.poolAmount,
      });
      totalPoolAmount = roundMoney(totalPoolAmount + pool.poolAmount);
    }

    const allocatedTotal = roundMoney([...contractDebitTotals.values()].reduce((s, v) => s + v, 0));
    const reference = centerOhaReference(periodLabel, head.indirectCenterCode);
    const entries: OverheadJournalPreviewEntry[] = [];

    for (const [contractId, amount] of contractDebitTotals) {
      if (amount <= BALANCE_TOLERANCE) continue;
      const ctr = contractLabels.get(contractId);
      entries.push({
        side: 'debit',
        accountCode: OHA_CONTRACT_LOAD_ACCOUNT,
        accountName: ohaAllocationDebitAccountName(head.indirectCenterName),
        amount,
        costCenterId: contractId,
        costCenterLabel: ctr ? `${ctr.number} ${ctr.name}` : contractId,
      });
    }

    for (const pool of centerPools) {
      entries.push({
        side: 'credit',
        accountCode: pool.accountCode,
        accountName: pool.accountName,
        amount: pool.poolAmount,
        costCenterId: head.indirectCenterId,
        costCenterLabel: `${head.indirectCenterCode} ${head.indirectCenterName}`,
      });
    }

    previews.push({
      indirectCenterId: head.indirectCenterId,
      indirectCenterCode: head.indirectCenterCode,
      indirectCenterName: head.indirectCenterName,
      accountCode: OHA_CONTRACT_LOAD_ACCOUNT,
      accountName: ohaAllocationDebitAccountName(head.indirectCenterName),
      reference,
      description: `Closing allocation ${periodLabel} — ${head.indirectCenterName}`,
      poolAmount: totalPoolAmount,
      allocatedTotal,
      entries,
      poolAccounts,
    });
  }

  return previews.sort((a, b) => a.indirectCenterCode.localeCompare(b.indirectCenterCode));
}

async function loadOpenContracts(): Promise<
  Array<{ id: string; contractName: string; contractNumber: string }>
> {
  return prisma.contract.findMany({
    where: { isDeleted: false },
    select: { id: true, contractName: true, contractNumber: true },
    orderBy: { contractNumber: 'asc' },
  });
}

export async function computeBillingWorksWeights(
  periodStart: string,
  periodEnd: string,
): Promise<{ rows: ContractWeightRow[]; totalWeight: number }> {
  const billings = await prisma.billing.findMany({
    where: {
      isDeleted: false,
      date: { gte: periodStart, lte: periodEnd },
      status: { in: [...LIQUIDITY_BILLED_STATUSES] },
    },
    include: {
      contract: { select: { id: true, contractName: true, contractNumber: true, isDeleted: true } },
    },
  });

  const byContract = new Map<string, ContractWeightRow>();
  for (const b of billings) {
    if (b.contract?.isDeleted) continue;
    const cid = b.contractId;
    const add = num(b.worksValueExVat);
    const prev = byContract.get(cid);
    if (prev) {
      prev.weight = roundMoney(prev.weight + add);
    } else {
      byContract.set(cid, {
        contractId: cid,
        contractName: b.contract?.contractName ?? cid,
        contractNumber: b.contract?.contractNumber ?? '',
        weight: roundMoney(add),
        ratio: 0,
      });
    }
  }

  return finalizeWeights([...byContract.values()]);
}

export async function computeContractValueWeights(): Promise<{ rows: ContractWeightRow[]; totalWeight: number }> {
  const contracts = await loadOpenContracts();
  const boqItems = await prisma.boqItem.findMany({
    where: { isDeleted: false, contractId: { in: contracts.map((c) => c.id) } },
    select: { contractId: true, tenderAmount: true },
  });

  const byContract = new Map<string, ContractWeightRow>();
  for (const c of contracts) {
    byContract.set(c.id, {
      contractId: c.id,
      contractName: c.contractName,
      contractNumber: c.contractNumber,
      weight: 0,
      ratio: 0,
    });
  }

  for (const item of boqItems) {
    const row = byContract.get(item.contractId);
    if (!row) continue;
    row.weight = roundMoney(row.weight + num(item.tenderAmount));
  }

  return finalizeWeights([...byContract.values()].filter((r) => r.weight > BALANCE_TOLERANCE));
}

export async function computeEqualContractWeights(): Promise<{ rows: ContractWeightRow[]; totalWeight: number }> {
  const contracts = await loadOpenContracts();
  const rows = contracts.map((c) => ({
    contractId: c.id,
    contractName: c.contractName,
    contractNumber: c.contractNumber,
    weight: 1,
    ratio: 0,
  }));
  return finalizeWeights(rows);
}

function finalizeWeights(rows: ContractWeightRow[]): { rows: ContractWeightRow[]; totalWeight: number } {
  const sorted = [...rows].sort((a, b) => b.weight - a.weight);
  const totalWeight = roundMoney(sorted.reduce((s, r) => s + r.weight, 0));
  for (const r of sorted) {
    r.ratio = totalWeight > 0 ? roundMoney((r.weight / totalWeight) * 100) : 0;
  }
  return { rows: sorted, totalWeight };
}

export async function computeContractWeights(
  basis: DistributionBasis,
  periodStart: string,
  periodEnd: string,
): Promise<{ rows: ContractWeightRow[]; totalWeight: number }> {
  const normalized = normalizeDistributionBasis(basis);
  if (normalized === 'contract_value') return computeContractValueWeights();
  if (normalized === 'equal') return computeEqualContractWeights();
  return computeBillingWorksWeights(periodStart, periodEnd);
}

/** @deprecated */
export async function computeRevenueRatios(
  periodStart: string,
  periodEnd: string,
): Promise<{ rows: RevenueRatioRow[]; totalRevenue: number }> {
  const { rows, totalWeight } = await computeBillingWorksWeights(periodStart, periodEnd);
  return {
    rows: rows.map((r) => ({ ...r, revenue: r.weight })),
    totalRevenue: totalWeight,
  };
}

export async function computeIndirectPools(
  periodStart: string,
  periodEnd: string,
): Promise<OverheadPoolRow[]> {
  const indirectCenters = await prisma.costCenter.findMany({
    where: { type: 'indirect', isDeleted: false, isActive: true },
  });
  if (!indirectCenters.length) return [];

  const centerIds = indirectCenters.map((c) => c.id);
  const centerMap = new Map(indirectCenters.map((c) => [c.id, c]));

  const txs = await prisma.transaction.findMany({
    where: {
      isDeleted: false,
      date: { gte: periodStart, lte: periodEnd },
      OR: [
        { costCenterId: { in: centerIds } },
        { entries: { some: { costCenterId: { in: centerIds } } } },
      ],
      NOT: { reference: { startsWith: OHA_PREFIX } },
    },
    include: { entries: true },
  });

  const poolMap = new Map<string, OverheadPoolRow>();

  for (const tx of txs) {
    for (const entry of tx.entries) {
      const code = String(entry.accountCode).trim();
      if (!isExpenseAccount(code)) continue;

      const lineCenter = String(entry.costCenterId ?? tx.costCenterId ?? '').trim();
      if (!lineCenter || !centerIds.includes(lineCenter)) continue;

      const center = centerMap.get(lineCenter)!;
      const net = roundMoney(num(entry.debit) - num(entry.credit));
      if (Math.abs(net) < BALANCE_TOLERANCE) continue;

      const key = `${lineCenter}|${code}`;
      const prev = poolMap.get(key);
      if (prev) {
        prev.poolAmount = roundMoney(prev.poolAmount + net);
      } else {
        poolMap.set(key, {
          indirectCenterId: lineCenter,
          indirectCenterCode: center.code,
          indirectCenterName: center.name,
          accountCode: code,
          accountName: entry.accountName,
          poolAmount: net,
        });
      }
    }
  }

  return [...poolMap.values()]
    .filter((p) => p.poolAmount > BALANCE_TOLERANCE)
    .sort((a, b) => a.indirectCenterCode.localeCompare(b.indirectCenterCode) || a.accountCode.localeCompare(b.accountCode));
}

export async function buildOverheadPreview(periodId: string): Promise<{
  pools: OverheadPoolRow[];
  weights: ContractWeightRow[];
  revenue: ContractWeightRow[];
  totalWeight: number;
  totalRevenue: number;
  distributionBasis: DistributionBasis;
  boqLoadingBasis: BoqLoadingBasis;
  lines: OverheadPreviewLine[];
  computedLines: OverheadPreviewLine[];
  hasProposedLines: boolean;
  isAdjusted: boolean;
  totalPoolAmount: number;
  totalAllocated: number;
  contractSummaries: OverheadContractSummary[];
  journalPreviews: OverheadJournalPreview[];
  indirectCenterSelection: IndirectCenterSelectionRow[];
  includedIndirectCenterIds: string[];
  excludedPoolTotal: number;
}> {
  const period = await prisma.overheadAllocationPeriod.findUnique({ where: { id: periodId } });
  if (!period) throw new Error('Period not found');

  const distributionBasis = normalizeDistributionBasis(period.distributionBasis);
  const boqLoadingBasis = await readPeriodBoqLoadingBasis(periodId);

  const { rows: indirectCenterSelection, includedIds, excludedPoolTotal } = await buildIndirectCenterSelection(
    periodId,
    period.periodStart,
    period.periodEnd,
  );
  const allPools = await computeIndirectPools(period.periodStart, period.periodEnd);
  const pools = filterPoolsByIncludedCenters(allPools, includedIds);
  const { rows: weights, totalWeight } = await computeContractWeights(
    distributionBasis,
    period.periodStart,
    period.periodEnd,
  );

  const computedLines = buildComputedPreviewLines(pools, weights, totalWeight);
  const proposedDraft = await loadProposedDraftLines(periodId);
  const hasProposedLines = proposedDraft.length > 0;
  const lines = hasProposedLines
    ? mergeLinesWithProposed(computedLines, proposedDraft, weights, pools)
    : computedLines;
  const isAdjusted = hasProposedLines && lines.some(
    (l) => l.computedAmount !== undefined && Math.abs(l.amount - l.computedAmount) > BALANCE_TOLERANCE,
  );

  const contractLabels = new Map(
    weights.map((w) => [w.contractId, { name: w.contractName, number: w.contractNumber }]),
  );
  const totalPoolAmount = roundMoney(pools.reduce((s, p) => s + p.poolAmount, 0));
  const totalAllocated = roundMoney(lines.reduce((s, l) => s + l.amount, 0));

  return {
    pools,
    weights,
    revenue: weights,
    totalWeight,
    totalRevenue: totalWeight,
    distributionBasis,
    boqLoadingBasis,
    lines,
    computedLines,
    hasProposedLines,
    isAdjusted,
    totalPoolAmount,
    totalAllocated,
    contractSummaries: buildContractSummaries(lines),
    journalPreviews: buildJournalPreviews(period.label, pools, lines, contractLabels),
    indirectCenterSelection,
    includedIndirectCenterIds: includedIds,
    excludedPoolTotal,
  };
}

export function distributePoolAmounts(poolAmount: number, weights: ContractWeightRow[]): Map<string, number> {
  const result = new Map<string, number>();
  if (poolAmount <= 0 || weights.length === 0) return result;

  const total = weights.reduce((s, r) => s + r.weight, 0);
  if (total <= 0) return result;

  let allocated = 0;
  const sorted = [...weights].sort((a, b) => b.weight - a.weight);
  for (let i = 0; i < sorted.length; i++) {
    const w = sorted[i]!;
    let amount: number;
    if (i === sorted.length - 1) {
      amount = roundMoney(poolAmount - allocated);
    } else {
      amount = roundMoney((poolAmount * w.weight) / total);
      allocated = roundMoney(allocated + amount);
    }
    if (amount > BALANCE_TOLERANCE) result.set(w.contractId, amount);
  }
  return result;
}

type BoqWeightRow = { boqItemId: string; weight: number };

async function computeBoqWeightsForContract(
  contractId: string,
  basis: BoqLoadingBasis,
): Promise<BoqWeightRow[]> {
  const items = await prisma.boqItem.findMany({
    where: { contractId, isDeleted: false },
    select: { id: true, tenderAmount: true, tenderQty: true },
  });
  if (!items.length) return [];

  const normalized = normalizeBoqLoadingBasis(basis);
  return items.map((item) => ({
    boqItemId: item.id,
    weight:
      normalized === 'equal'
        ? 1
        : normalized === 'boq_qty'
          ? Math.max(num(item.tenderQty), 0)
          : Math.max(num(item.tenderAmount), 0),
  })).filter((r) => r.weight > 0);
}

async function postBoqLoadingForContractAllocation(
  tx: Prisma.TransactionClient,
  periodId: string,
  contractId: string,
  totalAmount: number,
  boqLoadingBasis: BoqLoadingBasis,
): Promise<void> {
  const boqWeights = await computeBoqWeightsForContract(contractId, boqLoadingBasis);
  if (!boqWeights.length) return;

  const weightTotal = boqWeights.reduce((s, r) => s + r.weight, 0);
  if (weightTotal <= 0) return;

  let allocated = 0;
  for (let i = 0; i < boqWeights.length; i++) {
    const row = boqWeights[i]!;
    let slice: number;
    if (i === boqWeights.length - 1) {
      slice = roundMoney(totalAmount - allocated);
    } else {
      slice = roundMoney((totalAmount * row.weight) / weightTotal);
      allocated = roundMoney(allocated + slice);
    }
    if (slice <= BALANCE_TOLERANCE) continue;

    await tx.boqActualCost.create({
      data: {
        boqItemId: row.boqItemId,
        contractId,
        overheadPeriodId: periodId,
        quantity: 1,
        unitCost: slice,
        totalCost: slice,
        costElement: 'overhead',
      },
    });
  }
}

function zeroWeightError(basis: DistributionBasis): string {
  if (basis === 'equal') return 'Cannot close: no open contracts';
  if (basis === 'contract_value') return 'Cannot close: total contract BOQ value is zero';
  return 'Cannot close: total billing works in period is zero';
}

export async function closeOverheadPeriod(
  periodId: string,
  userId: string | undefined,
  client?: Prisma.TransactionClient,
): Promise<{ transactionIds: string[] }> {
  const run = async (tx: Prisma.TransactionClient) => {
    const period = await tx.overheadAllocationPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw new Error('Period not found');
    if (period.status === 'closed') throw new Error('Period is already closed');

    const distributionBasis = normalizeDistributionBasis(period.distributionBasis);
    const boqLoadingBasis = await readPeriodBoqLoadingBasis(periodId);

    const allPools = await computeIndirectPools(period.periodStart, period.periodEnd);
    const includedIds = await resolvePeriodIncludedCenterIds(periodId);
    const pools = filterPoolsByIncludedCenters(allPools, includedIds);
    const { rows: weights, totalWeight } = await computeContractWeights(
      distributionBasis,
      period.periodStart,
      period.periodEnd,
    );

    if (totalWeight <= BALANCE_TOLERANCE && pools.some((p) => p.poolAmount > BALANCE_TOLERANCE)) {
      throw new Error(zeroWeightError(distributionBasis));
    }

    const proposedDraft = await loadProposedDraftLines(periodId);
    const useProposed = proposedDraft.length > 0;
    if (useProposed) {
      const validation = validateProposedLinesAgainstPools(pools, proposedDraft);
      if (validation.ok === false) throw new Error(validation.error);
    }

    await tx.overheadAllocationLine.deleteMany({ where: { periodId } });
    await tx.boqActualCost.deleteMany({ where: { overheadPeriodId: periodId } });

    const transactionIds: string[] = [];

    for (const [indirectCenterId, centerPools] of groupPoolsByCenter(pools)) {
      const head = centerPools[0]!;
      const contractDebitTotals = new Map<string, number>();
      const creditEntries: JournalEntryInput[] = [];
      let totalPoolAmount = 0;
      const poolAmountMaps: Array<{ pool: OverheadPoolRow; amounts: Map<string, number> }> = [];

      for (const pool of centerPools) {
        const amounts = resolvePoolContractAmounts(pool, useProposed, proposedDraft, weights);
        poolAmountMaps.push({ pool, amounts });

        for (const [contractId, amount] of amounts) {
          contractDebitTotals.set(
            contractId,
            roundMoney((contractDebitTotals.get(contractId) ?? 0) + amount),
          );
          await postBoqLoadingForContractAllocation(tx, periodId, contractId, amount, boqLoadingBasis);
        }

        creditEntries.push({
          accountCode: pool.accountCode,
          accountName: pool.accountName ?? undefined,
          debit: 0,
          credit: roundMoney(pool.poolAmount),
          costCenterId: indirectCenterId,
        });
        totalPoolAmount = roundMoney(totalPoolAmount + pool.poolAmount);
      }

      const debitEntries: JournalEntryInput[] = [];
      let debitSum = 0;
      for (const [contractId, amount] of contractDebitTotals) {
        if (amount <= BALANCE_TOLERANCE) continue;
        debitEntries.push({
          accountCode: OHA_CONTRACT_LOAD_ACCOUNT,
          accountName: ohaAllocationDebitAccountName(head.indirectCenterName),
          debit: amount,
          credit: 0,
          costCenterId: contractId,
        });
        debitSum = roundMoney(debitSum + amount);
      }

      if (Math.abs(debitSum - totalPoolAmount) > BALANCE_TOLERANCE) {
        throw new Error(`Allocation rounding error for ${head.indirectCenterCode}`);
      }

      if (totalPoolAmount <= BALANCE_TOLERANCE) continue;

      const reference = centerOhaReference(period.label, head.indirectCenterCode);
      const existing = await tx.transaction.findFirst({
        where: { reference, isDeleted: false },
        select: { id: true },
      });
      if (existing) throw new Error(`Allocation reference already exists: ${reference}`);

      const journalDate = resolveOverheadCloseJournalDate(period.periodStart, period.periodEnd);
      const journal = await createTransaction(
        {
          date: journalDate,
          description: `Closing allocation ${period.label} — ${head.indirectCenterName}`,
          reference,
          entries: [...debitEntries, ...creditEntries],
        },
        userId,
        tx,
      );

      transactionIds.push(journal.id);

      for (const { pool, amounts } of poolAmountMaps) {
        for (const [contractId, amount] of amounts) {
          await tx.overheadAllocationLine.create({
            data: {
              id: randomUUID(),
              periodId,
              indirectCenterId: pool.indirectCenterId,
              contractId,
              accountCode: pool.accountCode,
              amount,
              transactionId: journal.id,
            },
          });
        }
      }
    }

    await tx.overheadAllocationPeriod.update({
      where: { id: periodId },
      data: { status: 'closed', closedAt: new Date(), closedBy: userId ?? null },
    });

    return { transactionIds };
  };

  if (client) return run(client);
  return prisma.$transaction((tx) => run(tx));
}

/**
 * Snapshot posted (closed) allocation lines as proposed-draft inputs.
 * Used on reopen so re-close can reuse the prior distribution instead of redistributing.
 */
export function snapshotClosedLinesAsProposed(
  lines: Array<{
    transactionId?: string | null;
    indirectCenterId: string;
    contractId: string;
    accountCode: string;
    amount: unknown;
  }>,
): ProposedLineInput[] {
  const byKey = new Map<string, ProposedLineInput>();
  for (const line of lines) {
    if (!line.transactionId) continue;
    const amount = roundMoney(num(line.amount));
    if (amount <= BALANCE_TOLERANCE) continue;
    const accountCode = String(line.accountCode).trim();
    const key = `${line.indirectCenterId}|${accountCode}|${line.contractId}`;
    const prev = byKey.get(key);
    if (prev) {
      prev.amount = roundMoney(prev.amount + amount);
    } else {
      byKey.set(key, {
        indirectCenterId: line.indirectCenterId,
        contractId: line.contractId,
        accountCode,
        amount,
      });
    }
  }
  return [...byKey.values()];
}

export async function reopenOverheadPeriod(periodId: string, userId: string | undefined): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const period = await tx.overheadAllocationPeriod.findUnique({
      where: { id: periodId },
      include: { lines: true },
    });
    if (!period) throw new Error('Period not found');
    if (period.status !== 'closed') throw new Error('Period is not closed');

    const txIds = [...new Set(period.lines.map((l) => l.transactionId).filter(Boolean))] as string[];
    await assertTransactionsPeriodUnlocked(tx, txIds, userId);
    for (const txId of txIds) {
      await tx.transaction.update({ where: { id: txId }, data: { isDeleted: true } });
    }

    await tx.boqActualCost.deleteMany({ where: { overheadPeriodId: periodId } });

    // Preserve prior closed split as proposed drafts (transactionId = null) so a
    // no-edit re-close posts the same contract/account amounts when the pool still matches.
    const preserved = snapshotClosedLinesAsProposed(period.lines);
    await tx.overheadAllocationLine.deleteMany({ where: { periodId } });
    for (const line of preserved) {
      await tx.overheadAllocationLine.create({
        data: {
          id: randomUUID(),
          periodId,
          indirectCenterId: line.indirectCenterId,
          contractId: line.contractId,
          accountCode: line.accountCode,
          amount: line.amount,
          transactionId: null,
        },
      });
    }

    await tx.overheadAllocationPeriod.update({
      where: { id: periodId },
      data: { status: 'draft', closedAt: null, closedBy: null },
    });
  });
}
