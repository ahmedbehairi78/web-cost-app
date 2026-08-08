import { prisma } from '../db.js';
import { createTransaction } from './journal.js';
import { roundMoney } from '../lib/money.js';

export type CustodySettlementLine = {
  id?: string;
  contractId?: string;
  accountCode: string;
  accountName?: string;
  amount: number;
  description?: string;
  /** Optional BOQ link — report allocation only; ignored by GL posting. */
  boqItemId?: string;
};

function isDirectContractId(contractId: string, contracts: { id: string; projectId: string }[]): boolean {
  return contracts.some((c) => c.id === contractId);
}

export async function postCustodySettlementJournals(params: {
  settlementNumber: string;
  projectId: string;
  custodyAccountCode: string;
  custodyAccountName: string;
  date: string;
  description: string;
  items: CustodySettlementLine[];
  userId: string;
  client?: Parameters<typeof createTransaction>[2];
}): Promise<string[]> {
  const db = params.client ?? prisma;
  const validItems = params.items.filter(
    (i) => i.accountCode.trim() && roundMoney(Number(i.amount)) > 0,
  );
  if (validItems.length === 0) {
    throw new Error('No valid settlement lines');
  }

  const contracts = await db.contract.findMany({
    where: { projectId: params.projectId, isDeleted: false },
    select: { id: true, projectId: true },
  });

  const groups = new Map<string, CustodySettlementLine[]>();
  for (const item of validItems) {
    const key = item.contractId?.trim() || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  const coaRows = await db.chartOfAccount.findMany({
    where: { status: { not: 'disabled' } },
    select: { accountCode: true, accountName: true },
  });
  const coaNameByCode = new Map(coaRows.map((r) => [String(r.accountCode).trim(), r.accountName]));

  const transactionIds: string[] = [];
  let groupIndex = 0;
  for (const [costCenterKey, items] of groups) {
    const groupTotal = roundMoney(items.reduce((s, i) => s + Number(i.amount), 0));
    if (groupTotal <= 0) continue;
    groupIndex += 1;
    const isDirect = costCenterKey && isDirectContractId(costCenterKey, contracts);
    const reference = `${params.settlementNumber}-${groupIndex}`;

    const tx = await createTransaction(
      {
        date: params.date,
        description: params.description.trim() || `تسوية عهدة ${params.settlementNumber}`,
        reference,
        ...(costCenterKey
          ? {
              costCenterId: costCenterKey,
              projectId: params.projectId,
            }
          : { projectId: params.projectId }),
        entries: [
          {
            accountCode: params.custodyAccountCode,
            accountName: params.custodyAccountName,
            debit: 0,
            credit: groupTotal,
          },
          ...items.map((item) => ({
            accountCode: item.accountCode.trim(),
            accountName:
              item.accountName?.trim()
              || coaNameByCode.get(item.accountCode.trim())
              || item.accountCode.trim(),
            debit: roundMoney(Number(item.amount)),
            credit: 0,
          })),
        ],
      },
      params.userId,
      params.client,
    );
    transactionIds.push(tx.id);
    void isDirect;
  }

  if (transactionIds.length === 0) {
    throw new Error('Settlement total must be greater than zero');
  }
  return transactionIds;
}
