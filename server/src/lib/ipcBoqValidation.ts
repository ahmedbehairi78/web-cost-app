import type { Prisma } from '@prisma/client';
import { buildMosPriorMaps } from './mosPriorMaps.js';

export const IPC_BOQ_QTY_TOLERANCE = 0.01;

export type IpcBoqExceedRow = {
  boqItemId: string;
  itemCode: string;
  description: string;
  tenderQty: number;
  totalQty: number;
  overBy: number;
};

type BillingLineInput = {
  boqItemId?: string | null;
  itemCode?: string;
  description?: string;
  previousQty?: unknown;
  currentQty?: unknown;
  totalQty?: unknown;
};

export type IpcMosConsistencyIssue = {
  code: 'ipc_line_qty_mismatch' | 'ipc_previous_qty_below_mos_billing';
  boqItemId: string;
  itemCode?: string;
  expectedPrevious?: number;
  actualPrevious?: number;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Compare IPC line totalQty against live BOQ tenderQty. */
export function findIpcItemsExceedingBoq(
  items: BillingLineInput[],
  boqById: Map<string, { itemCode: string; description: string; tenderQty: unknown }>,
  tolerance = IPC_BOQ_QTY_TOLERANCE,
): IpcBoqExceedRow[] {
  const out: IpcBoqExceedRow[] = [];
  for (const item of items) {
    const boqItemId = String(item.boqItemId ?? '').trim();
    if (!boqItemId) continue;
    const boq = boqById.get(boqItemId);
    if (!boq) continue;
    const tenderQty = num(boq.tenderQty);
    const totalQty = num(item.totalQty);
    if (tenderQty <= tolerance) continue;
    if (totalQty <= tenderQty + tolerance) continue;
    out.push({
      boqItemId,
      itemCode: String(item.itemCode ?? boq.itemCode ?? ''),
      description: String(item.description ?? boq.description ?? ''),
      tenderQty,
      totalQty,
      overBy: totalQty - tenderQty,
    });
  }
  return out;
}

export async function loadBoqMapForContract(
  tx: Prisma.TransactionClient,
  contractId: string,
  boqItemIds: string[],
): Promise<Map<string, { itemCode: string; description: string; tenderQty: unknown }>> {
  const ids = [...new Set(boqItemIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const rows = await tx.boqItem.findMany({
    where: { id: { in: ids }, contractId, isDeleted: false },
    select: { id: true, itemCode: true, description: true, tenderQty: true },
  });
  return new Map(rows.map((r) => [r.id, r]));
}

export async function validateIpcBoqQuantities(
  tx: Prisma.TransactionClient,
  contractId: string,
  items: BillingLineInput[],
): Promise<IpcBoqExceedRow[]> {
  const boqIds = items.map((i) => String(i.boqItemId ?? '')).filter(Boolean);
  const boqMap = await loadBoqMapForContract(tx, contractId, boqIds);
  return findIpcItemsExceedingBoq(items, boqMap);
}

export function assertIpcBoqQuantitiesForApprove(exceedRows: IpcBoqExceedRow[]): void {
  if (exceedRows.length === 0) return;
  const first = exceedRows[0];
  const err = new Error('ipc_total_qty_exceeds_tender') as Error & {
    code: string;
    exceedCount: number;
    boqItemId?: string;
    itemCode?: string;
    tenderQty?: number;
    totalQty?: number;
  };
  err.code = 'ipc_total_qty_exceeds_tender';
  err.exceedCount = exceedRows.length;
  err.boqItemId = first.boqItemId;
  err.itemCode = first.itemCode;
  err.tenderQty = first.tenderQty;
  err.totalQty = first.totalQty;
  throw err;
}

/** Ensure IPC previousQty reflects approved MOS + prior IPC billings (MOS→IPC chain). */
export async function validateIpcMosBillingConsistency(
  tx: Prisma.TransactionClient,
  contractId: string,
  excludeBillingId: string,
  items: BillingLineInput[],
): Promise<IpcMosConsistencyIssue[]> {
  const issues: IpcMosConsistencyIssue[] = [];
  const [mosMaps, otherBillings] = await Promise.all([
    buildMosPriorMaps(contractId, tx),
    tx.billing.findMany({
      where: {
        contractId,
        isDeleted: false,
        id: { not: excludeBillingId },
        status: { not: 'draft' },
      },
      include: { items: true },
    }),
  ]);

  const ipcBilledByBoq: Record<string, number> = {};
  for (const billing of otherBillings) {
    for (const line of billing.items) {
      const id = line.boqItemId;
      if (!id) continue;
      ipcBilledByBoq[id] = (ipcBilledByBoq[id] ?? 0) + num(line.currentQty);
    }
  }

  for (const item of items) {
    const boqItemId = String(item.boqItemId ?? '').trim();
    if (!boqItemId) continue;

    const previousQty = num(item.previousQty);
    const currentQty = num(item.currentQty);
    const totalQty = num(item.totalQty);

    if (Math.abs(previousQty + currentQty - totalQty) > IPC_BOQ_QTY_TOLERANCE) {
      issues.push({
        code: 'ipc_line_qty_mismatch',
        boqItemId,
        itemCode: item.itemCode ? String(item.itemCode) : undefined,
      });
      continue;
    }

    const expectedPrevious =
      num(ipcBilledByBoq[boqItemId] ?? 0) + num(mosMaps.equivalent[boqItemId] ?? 0);
    if (previousQty + IPC_BOQ_QTY_TOLERANCE < expectedPrevious) {
      issues.push({
        code: 'ipc_previous_qty_below_mos_billing',
        boqItemId,
        itemCode: item.itemCode ? String(item.itemCode) : undefined,
        expectedPrevious,
        actualPrevious: previousQty,
      });
    }
  }

  return issues;
}

export function assertIpcMosBillingConsistency(issues: IpcMosConsistencyIssue[]): void {
  if (issues.length === 0) return;
  const first = issues[0];
  const err = new Error(first.code) as Error & {
    code: string;
    issueCount: number;
    boqItemId?: string;
    itemCode?: string;
    expectedPrevious?: number;
    actualPrevious?: number;
  };
  err.code = first.code;
  err.issueCount = issues.length;
  err.boqItemId = first.boqItemId;
  err.itemCode = first.itemCode;
  err.expectedPrevious = first.expectedPrevious;
  err.actualPrevious = first.actualPrevious;
  throw err;
}
