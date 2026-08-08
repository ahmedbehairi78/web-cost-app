/**
 * List (and optionally create) purchase_transactions rows for GL journals
 * that were posted without a matching invoice list row (offline multi-step bug).
 *
 * Usage:
 *   npx tsx server/src/scripts/linkOrphanPurchaseInvoiceJournals.ts
 *   npx tsx server/src/scripts/linkOrphanPurchaseInvoiceJournals.ts --live
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';

const live = process.argv.includes('--live');

async function main() {
  const journals = await prisma.transaction.findMany({
    where: {
      isDeleted: false,
      OR: [{ reference: { startsWith: 'INV-' } }, { description: { contains: 'فاتورة' } }],
    },
    include: { entries: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  const linkedIds = new Set(
    (
      await prisma.purchaseTransaction.findMany({
        where: { transactionId: { not: null }, isDeleted: false },
        select: { transactionId: true },
      })
    )
      .map((r) => r.transactionId)
      .filter(Boolean) as string[],
  );

  const orphans = journals.filter((j) => !linkedIds.has(j.id));
  console.log(`Found ${orphans.length} unlinked invoice-like journals (of ${journals.length} scanned)`);

  for (const j of orphans) {
    const debit = j.entries.reduce((s, e) => s + Number(e.debit), 0);
    const credit = j.entries.reduce((s, e) => s + Number(e.credit), 0);
    console.log(
      `- ${j.id}  ref=${j.reference ?? '(none)'}  date=${j.date}  Dr=${debit} Cr=${credit}  ${j.description ?? ''}`,
    );

    if (!live) continue;

    const refNum = j.reference?.startsWith('INV-') ? j.reference.slice(4) : j.reference ?? '';
    const created = await prisma.purchaseTransaction.create({
      data: {
        id: randomUUID(),
        type: 'invoice',
        supplierName: (j.description || 'Unknown').replace(/^.*?-\s*/, '').trim() || 'Unknown',
        projectId: j.projectId,
        contractId: j.costCenterId,
        date: j.date,
        referenceNumber: refNum || null,
        amount: debit,
        totalAmount: debit,
        description: j.description,
        status: 'pending',
        transactionId: j.id,
        isDeleted: false,
      },
    });
    console.log(`  → created purchase_transactions ${created.id}`);
  }

  if (!live && orphans.length > 0) {
    console.log('\nDry run only. Re-run with --live to create list rows (amounts are header totals from GL; lines/stock not rebuilt).');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
