import 'dotenv/config';
import { prisma, closeDb } from '../server/src/db.js';

async function main() {
  const recentPurchases = await prisma.purchaseTransaction.findMany({
    where: { type: 'invoice', isDeleted: false },
    orderBy: { createdAt: 'desc' },
    take: 8,
    select: {
      id: true,
      referenceNumber: true,
      transactionId: true,
      amount: true,
      vatAmount: true,
      whtAmount: true,
      totalAmount: true,
      createdAt: true,
      projectId: true,
      description: true,
    },
  });
  console.log('=== purchases ===');
  for (const row of recentPurchases) {
    console.log(JSON.stringify(row));
    if (row.transactionId) {
      const tx = await prisma.transaction.findUnique({
        where: { id: row.transactionId },
        include: { entries: true },
      });
      console.log(
        '  GL',
        tx
          ? {
              id: tx.id,
              reference: tx.reference,
              isDeleted: tx.isDeleted,
              date: tx.date,
              entryCount: tx.entries.length,
              entries: tx.entries.map((e) => ({
                code: e.accountCode,
                dr: String(e.debit),
                cr: String(e.credit),
              })),
            }
          : 'MISSING TX ROW',
      );
    } else {
      console.log('  GL none');
    }
  }

  const recentWr = await prisma.warehouseReceipt.findMany({
    orderBy: { createdAt: 'desc' },
    take: 8,
    select: {
      id: true,
      receiptNumber: true,
      status: true,
      transactionId: true,
      purchaseTransactionId: true,
      createdAt: true,
      projectId: true,
    },
  });
  console.log('=== receipts ===');
  for (const wr of recentWr) {
    console.log(JSON.stringify(wr));
  }

  await closeDb();
}

main().catch(async (e) => {
  console.error(e);
  await closeDb();
  process.exit(1);
});
