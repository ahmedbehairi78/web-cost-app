import type { Prisma } from '@prisma/client';
import { roundMoney } from './money.js';

function num(v: unknown): number {
  return Number(v ?? 0);
}

/** Recompute contractValue + project boqValue from active BOQ tender amounts. */
export async function syncBoqContractAndProjectTotals(
  client: Prisma.TransactionClient,
  projectId: string,
  contractId: string,
): Promise<void> {
  const contractAgg = await client.boqItem.aggregate({
    where: { contractId, isDeleted: false },
    _sum: { tenderAmount: true },
  });
  await client.contract.update({
    where: { id: contractId },
    data: { contractValue: roundMoney(num(contractAgg._sum.tenderAmount)) },
  });

  const projectAgg = await client.boqItem.aggregate({
    where: { projectId, isDeleted: false },
    _sum: { tenderAmount: true },
  });
  await client.project.update({
    where: { id: projectId },
    data: { boqValue: roundMoney(num(projectAgg._sum.tenderAmount)) },
  });
}
