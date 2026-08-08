import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { createTransaction } from '../accounting/journal.js';
import { AccountCodes } from '../accounting/accountCodes.js';
import { roundMoney } from './money.js';
import { syncMosCertificateRegistry } from './documentRegistrySync.js';

function num(v: unknown): number {
  return Number(v ?? 0);
}

export async function approveMosCertificate(
  certificateId: string,
  userId: string | undefined,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const run = async (client: Prisma.TransactionClient) => {
    const row = await client.mosCertificate.findUnique({
      where: { id: certificateId },
      include: { lines: true },
    });
    if (!row) throw new Error('Not found');
    if (row.status !== 'draft') throw new Error(`Cannot approve certificate in status: ${row.status}`);

    const contract = await client.contract.findUnique({
      where: { id: row.contractId },
      select: { projectId: true },
    });
    if (!contract) throw new Error('Contract not found');

    const totalClaimed = roundMoney(num(row.totalClaimed));
    if (totalClaimed <= 0) throw new Error('totalClaimed must be positive');

    const certNo = String(row.certificateNo ?? '').trim();
    const lineCount = row.lines.length;

    const journal = await createTransaction(
      {
        date: String(row.extractDate ?? new Date().toISOString().slice(0, 10)),
        description: `تشوين - ${certNo} (${lineCount} ${lineCount === 1 ? 'بند' : 'بنود'})`,
        reference: certNo || undefined,
        costCenterId: row.contractId,
        projectId: contract.projectId || undefined,
        entries: [
          {
            accountCode: AccountCodes.RECEIVABLES,
            accountName: 'ح/ عملاء - مستخلصات تحت التحصيل',
            debit: totalClaimed,
            credit: 0,
          },
          {
            accountCode: AccountCodes.REVENUE,
            accountName: 'ح/ إيرادات عقود المقاولات',
            debit: 0,
            credit: totalClaimed,
          },
        ],
      },
      userId,
      client,
    );

    await client.mosCertificate.update({
      where: { id: certificateId },
      data: { status: 'approved', transactionId: journal.id },
    });
  };

  if (tx) {
    await run(tx);
    return;
  }
  await prisma.$transaction(run);
  await syncMosCertificateRegistry(certificateId);
}
