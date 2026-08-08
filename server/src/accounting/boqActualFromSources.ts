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
  boqItemId?: string | null;
  currentQty?: number | null;
  rate?: number | null;
  amount?: number | null;
};

function parseRecordedAt(dateStr: string | null | undefined): Date {
  const key = String(dateStr ?? '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    return new Date(`${key}T12:00:00.000Z`);
  }
  return new Date();
}

/**
 * Period cost for one IPC line: currentQty × rate (ex-VAT).
 * Falls back to `amount` only when currentQty is missing (legacy rows).
 * Never uses cumulative (previous+current)×rate — that would inflate reports across extracts.
 */
export function ipcLinePeriodCost(line: IpcBoqLineInput): number {
  const qty = Number(line.currentQty);
  const rate = Number(line.rate);
  if (Number.isFinite(qty) && qty > 0 && Number.isFinite(rate) && rate >= 0) {
    return roundMoney(qty * rate);
  }
  const amount = Number(line.amount);
  if (Number.isFinite(amount) && amount > 0) return roundMoney(amount);
  return 0;
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
  const out: ReturnType<typeof buildIpcBoqActualRows> = [];
  for (const line of params.items) {
    const boqItemId = String(line.boqItemId ?? '').trim();
    if (!boqItemId) continue;
    const totalCost = ipcLinePeriodCost(line);
    if (totalCost <= 0) continue;
    const qty = Number(line.currentQty);
    const quantity = Number.isFinite(qty) && qty > 0 ? qty : 1;
    const unitCost = quantity > 0 ? roundMoney(totalCost / quantity) : totalCost;
    out.push({
      boqItemId,
      contractId,
      purchaseTransactionId: params.purchaseTransactionId,
      quantity,
      unitCost,
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
