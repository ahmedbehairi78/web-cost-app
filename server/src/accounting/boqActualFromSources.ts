/**
 * Report-only BOQ actual cost writers for subcontractor IPC and custody settlement.
 * Does NOT post or alter GL journals — call alongside (after) existing approve GL paths.
 */
import { prisma } from '../db.js';
import { roundMoney } from '../lib/money.js';
import type { CustodySettlementLine } from './custodySettlementJournal.js';

export const BOQ_COST_ELEMENT_SUBCONTRACTOR = 'subcontractor';
export const BOQ_COST_ELEMENT_CUSTODY = 'custody';

export type IpcBoqLineInput = {
  /** Legacy / direct BOQ id — prefer clientBoqItemId when set. */
  boqItemId?: string | null;
  /** Client BOQ item that receives the cost load (subcontractor breakdown lines). */
  clientBoqItemId?: string | null;
  previousQty?: number | null;
  currentQty?: number | null;
  totalQty?: number | null;
  rate?: number | null;
  completionPct?: number | null;
  previousCompletionPct?: number | null;
  /** Explicit period amount (preferred when provided). */
  periodAmount?: number | null;
  amount?: number | null;
};

function parseRecordedAt(dateStr: string | null | undefined): Date {
  const key = String(dateStr ?? '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    return new Date(`${key}T12:00:00.000Z`);
  }
  return new Date();
}

function normalizePct(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

function lineTotalQty(line: IpcBoqLineInput): number {
  if (line.totalQty != null && Number.isFinite(Number(line.totalQty))) {
    return Number(line.totalQty);
  }
  return Number(line.previousQty || 0) + Number(line.currentQty || 0);
}

function lineToDateValue(line: IpcBoqLineInput): number {
  const qty = lineTotalQty(line);
  const rate = Number(line.rate || 0);
  const hasPct = line.completionPct != null && Number.isFinite(Number(line.completionPct));
  const pct = hasPct ? normalizePct(line.completionPct, 100) : 100;
  return roundMoney(qty * rate * (pct / 100));
}

function linePriorToDateValue(line: IpcBoqLineInput): number {
  const qty = Number(line.previousQty || 0);
  const rate = Number(line.rate || 0);
  const hasPrevPct =
    line.previousCompletionPct != null && Number.isFinite(Number(line.previousCompletionPct));
  const hasCurrPct =
    line.completionPct != null && Number.isFinite(Number(line.completionPct));
  if (!hasPrevPct && !hasCurrPct) {
    return roundMoney(qty * rate);
  }
  const pct = hasPrevPct ? normalizePct(line.previousCompletionPct, 0) : 0;
  return roundMoney(qty * rate * (pct / 100));
}

/**
 * Period cost for one IPC line.
 * Prefer explicit periodAmount; else qty×rate×% formula; else currentQty×rate; else amount.
 */
export function ipcLinePeriodCost(line: IpcBoqLineInput): number {
  const explicit = Number(line.periodAmount);
  if (Number.isFinite(explicit) && explicit > 0) return roundMoney(explicit);

  const hasPct =
    (line.completionPct != null && Number.isFinite(Number(line.completionPct)))
    || (line.previousCompletionPct != null && Number.isFinite(Number(line.previousCompletionPct)));
  if (hasPct) {
    return roundMoney(Math.max(0, lineToDateValue(line) - linePriorToDateValue(line)));
  }

  const qty = Number(line.currentQty);
  const rate = Number(line.rate);
  if (Number.isFinite(qty) && qty > 0 && Number.isFinite(rate) && rate >= 0) {
    return roundMoney(qty * rate);
  }
  const amount = Number(line.amount);
  if (Number.isFinite(amount) && amount > 0) return roundMoney(amount);
  return 0;
}

function resolveCostBoqItemId(line: IpcBoqLineInput): string {
  return String(line.clientBoqItemId || line.boqItemId || '').trim();
}

export function buildIpcBoqActualRows(params: {
  purchaseTransactionId: string;
  contractId: string;
  date: string;
  items: IpcBoqLineInput[];
}): Array<{
  boqItemId: string;
  contractId: string;
  purchaseTransactionId: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  costElement: string;
  recordedAt: Date;
}> {
  const contractId = String(params.contractId || '').trim();
  if (!contractId) return [];
  const recordedAt = parseRecordedAt(params.date);
  /** Aggregate period cost per client BOQ item (multiple sub-lines may share one). */
  const byBoq = new Map<string, number>();
  for (const line of params.items) {
    const boqItemId = resolveCostBoqItemId(line);
    if (!boqItemId) continue;
    const totalCost = ipcLinePeriodCost(line);
    if (totalCost <= 0) continue;
    byBoq.set(boqItemId, roundMoney((byBoq.get(boqItemId) ?? 0) + totalCost));
  }
  const out: ReturnType<typeof buildIpcBoqActualRows> = [];
  for (const [boqItemId, totalCost] of byBoq) {
    out.push({
      boqItemId,
      contractId,
      purchaseTransactionId: params.purchaseTransactionId,
      quantity: 1,
      unitCost: totalCost,
      totalCost,
      costElement: BOQ_COST_ELEMENT_SUBCONTRACTOR,
      recordedAt,
    });
  }
  return out;
}

/** Replace report rows for one approved IPC (idempotent). */
export async function syncBoqActualCostsForIpc(params: {
  purchaseTransactionId: string;
  contractId: string | null | undefined;
  date: string;
  items: IpcBoqLineInput[];
}): Promise<number> {
  const purchaseTransactionId = params.purchaseTransactionId;
  await prisma.boqActualCost.deleteMany({ where: { purchaseTransactionId } });
  const rows = buildIpcBoqActualRows({
    purchaseTransactionId,
    contractId: String(params.contractId ?? ''),
    date: params.date,
    items: params.items,
  });
  if (rows.length === 0) return 0;
  await prisma.boqActualCost.createMany({ data: rows });
  return rows.length;
}

export function buildCustodyBoqActualRows(params: {
  custodySettlementId: string;
  date: string;
  items: CustodySettlementLine[];
}): Array<{
  boqItemId: string;
  contractId: string;
  custodySettlementId: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  costElement: string;
  recordedAt: Date;
}> {
  const recordedAt = parseRecordedAt(params.date);
  const out: ReturnType<typeof buildCustodyBoqActualRows> = [];
  for (const line of params.items) {
    const boqItemId = String(line.boqItemId ?? '').trim();
    const contractId = String(line.contractId ?? '').trim();
    const totalCost = roundMoney(Number(line.amount) || 0);
    if (!boqItemId || !contractId || totalCost <= 0) continue;
    out.push({
      boqItemId,
      contractId,
      custodySettlementId: params.custodySettlementId,
      quantity: 1,
      unitCost: totalCost,
      totalCost,
      costElement: BOQ_COST_ELEMENT_CUSTODY,
      recordedAt,
    });
  }
  return out;
}

/** Replace report rows for one approved custody settlement (idempotent; skips unlinked lines). */
export async function syncBoqActualCostsForCustody(params: {
  custodySettlementId: string;
  date: string;
  items: CustodySettlementLine[];
}): Promise<number> {
  const custodySettlementId = params.custodySettlementId;
  await prisma.boqActualCost.deleteMany({ where: { custodySettlementId } });
  const rows = buildCustodyBoqActualRows({
    custodySettlementId,
    date: params.date,
    items: params.items,
  });
  if (rows.length === 0) return 0;
  await prisma.boqActualCost.createMany({ data: rows });
  return rows.length;
}
