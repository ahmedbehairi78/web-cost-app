import { prisma } from '../db.js';

export type ContractDocumentCycleSummary = {
  contractId: string;
  mos: { total: number; approved: number; pending: number; latestNo: string | null };
  vo: { total: number; approved: number; pending: number; latestNo: string | null };
  ipc: { total: number; approved: number; pending: number; latestNo: string | null; billedAmount: number };
  pendingActions: number;
  suggestedNextStep: 'mos' | 'vo' | 'ipc' | 'none';
};

function latestNo(rows: { documentNo: string }[]): string | null {
  return rows.length > 0 ? rows[rows.length - 1]!.documentNo : null;
}

export async function buildContractDocumentCycle(contractId: string): Promise<ContractDocumentCycleSummary> {
  const rows = await prisma.documentRegistry.findMany({
    where: { contractId, isDeleted: false },
    orderBy: [{ documentDate: 'asc' }, { documentNo: 'asc' }],
    select: {
      docType: true,
      documentNo: true,
      status: true,
      amount: true,
      needsAction: true,
    },
  });

  const byType = (type: string) => rows.filter((r) => r.docType === type);
  const mosRows = byType('mos');
  const voRows = byType('vo');
  const ipcRows = byType('ipc');

  const approvedStatuses = new Set(['approved', 'paid']);
  const pending = (typeRows: typeof rows) =>
    typeRows.filter((r) => r.needsAction || r.status === 'draft' || r.status === 'submitted' || r.status === 'review').length;

  const billedAmount = ipcRows
    .filter((r) => approvedStatuses.has(r.status))
    .reduce((sum, r) => sum + Number(r.amount ?? 0), 0);

  const pendingActions = rows.filter((r) => r.needsAction).length;

  let suggestedNextStep: ContractDocumentCycleSummary['suggestedNextStep'] = 'none';
  if (pendingActions > 0) {
    const pendingMos = mosRows.some((r) => r.needsAction);
    const pendingVo = voRows.some((r) => r.needsAction);
    const pendingIpc = ipcRows.some((r) => r.needsAction);
    if (pendingMos) suggestedNextStep = 'mos';
    else if (pendingVo) suggestedNextStep = 'vo';
    else if (pendingIpc) suggestedNextStep = 'ipc';
  } else if (mosRows.length === 0) {
    suggestedNextStep = 'mos';
  } else if (ipcRows.filter((r) => approvedStatuses.has(r.status)).length === 0) {
    suggestedNextStep = 'ipc';
  }

  return {
    contractId,
    mos: {
      total: mosRows.length,
      approved: mosRows.filter((r) => approvedStatuses.has(r.status)).length,
      pending: pending(mosRows),
      latestNo: latestNo(mosRows),
    },
    vo: {
      total: voRows.length,
      approved: voRows.filter((r) => approvedStatuses.has(r.status)).length,
      pending: pending(voRows),
      latestNo: latestNo(voRows),
    },
    ipc: {
      total: ipcRows.length,
      approved: ipcRows.filter((r) => approvedStatuses.has(r.status)).length,
      pending: pending(ipcRows),
      latestNo: latestNo(ipcRows),
      billedAmount,
    },
    pendingActions,
    suggestedNextStep,
  };
}
