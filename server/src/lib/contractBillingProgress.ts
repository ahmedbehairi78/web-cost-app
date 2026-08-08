import { prisma } from '../db.js';
import { buildMosPriorMaps } from './mosPriorMaps.js';

function num(v: unknown): number {
  return Number(v ?? 0);
}

export type ContractProgressRow = {
  boqItemId: string;
  itemCode: string;
  description: string;
  unit: string;
  tenderQty: number;
  mosEquivalentQty: number;
  ipcBilledQty: number;
  cumulativeQty: number;
  progressPct: number;
  exceedsTender: boolean;
};

export type ContractProgressSummary = {
  contractId: string;
  itemCount: number;
  rows: ContractProgressRow[];
  totals: {
    tenderQty: number;
    mosEquivalentQty: number;
    ipcBilledQty: number;
    cumulativeQty: number;
    progressPct: number;
    itemsExceedingTender: number;
  };
};

const BILLED_IPC_STATUSES = ['submitted', 'review', 'approved', 'paid'] as const;

export async function buildContractBillingProgress(contractId: string): Promise<ContractProgressSummary> {
  const [boqItems, billings, mosMaps] = await Promise.all([
    prisma.boqItem.findMany({
      where: { contractId, isDeleted: false },
      orderBy: [{ chapterCode: 'asc' }, { itemCode: 'asc' }],
      select: {
        id: true,
        itemCode: true,
        description: true,
        unit: true,
        tenderQty: true,
      },
    }),
    prisma.billing.findMany({
      where: {
        contractId,
        isDeleted: false,
        status: { in: [...BILLED_IPC_STATUSES] },
      },
      include: { items: true },
    }),
    buildMosPriorMaps(contractId),
  ]);

  const ipcBilledByBoq: Record<string, number> = {};
  for (const billing of billings) {
    for (const line of billing.items) {
      const id = line.boqItemId;
      if (!id) continue;
      ipcBilledByBoq[id] = (ipcBilledByBoq[id] ?? 0) + num(line.currentQty);
    }
  }

  let totalTender = 0;
  let totalMos = 0;
  let totalIpc = 0;
  let totalCumulative = 0;
  let itemsExceedingTender = 0;

  const rows: ContractProgressRow[] = boqItems.map((boq) => {
    const tenderQty = num(boq.tenderQty);
    const mosEquivalentQty = num(mosMaps.equivalent[boq.id] ?? 0);
    const ipcBilledQty = num(ipcBilledByBoq[boq.id] ?? 0);
    const cumulativeQty = mosEquivalentQty + ipcBilledQty;
    const progressPct = tenderQty > 0 ? Math.min(999.9, (cumulativeQty / tenderQty) * 100) : 0;
    const exceedsTender = tenderQty > 0 && cumulativeQty > tenderQty + 0.01;

    if (tenderQty > 0) {
      totalTender += tenderQty;
      totalMos += mosEquivalentQty;
      totalIpc += ipcBilledQty;
      totalCumulative += cumulativeQty;
      if (exceedsTender) itemsExceedingTender += 1;
    }

    return {
      boqItemId: boq.id,
      itemCode: boq.itemCode,
      description: boq.description,
      unit: boq.unit,
      tenderQty,
      mosEquivalentQty,
      ipcBilledQty,
      cumulativeQty,
      progressPct,
      exceedsTender,
    };
  });

  const progressPct = totalTender > 0 ? Math.min(999.9, (totalCumulative / totalTender) * 100) : 0;

  return {
    contractId,
    itemCount: rows.length,
    rows,
    totals: {
      tenderQty: totalTender,
      mosEquivalentQty: totalMos,
      ipcBilledQty: totalIpc,
      cumulativeQty: totalCumulative,
      progressPct,
      itemsExceedingTender,
    },
  };
}
