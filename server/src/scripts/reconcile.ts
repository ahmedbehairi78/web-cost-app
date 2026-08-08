import { prisma } from '../db.js';
import { AccountCodes } from '../accounting/accountCodes.js';

const transactions = await prisma.transaction.findMany({
  where: { isDeleted: false },
  include: { entries: true },
});

let totalDebit = 0;
let totalCredit = 0;
const unbalanced: string[] = [];
let advanceBalance = 0;

for (const tx of transactions) {
  const debit = tx.entries.reduce((sum, entry) => sum + Number(entry.debit), 0);
  const credit = tx.entries.reduce((sum, entry) => sum + Number(entry.credit), 0);
  totalDebit += debit;
  totalCredit += credit;
  if (Math.abs(debit - credit) > 0.005) unbalanced.push(tx.id);
  for (const entry of tx.entries) {
    if (entry.accountCode === AccountCodes.ADVANCE_PAYMENT) {
      advanceBalance += Number(entry.credit) - Number(entry.debit);
    }
  }
}

const orphanBillings = await prisma.billing.findMany({
  where: { transactionId: { not: null }, transaction: null },
  select: { id: true, billingNumber: true, transactionId: true },
});

console.log(JSON.stringify({
  transactions: transactions.length,
  totalDebit,
  totalCredit,
  balanced: Math.abs(totalDebit - totalCredit) <= 0.005,
  unbalanced,
  orphanBillings,
  customerAdvanceCreditBalance: advanceBalance,
}, null, 2));

await prisma.$disconnect();
