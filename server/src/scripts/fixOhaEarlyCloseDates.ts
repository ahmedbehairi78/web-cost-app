/**
 * One-shot: move early-closed OHA journals from future periodEnd into the close day
 * so Dashboard YTD filters see the credits.
 *
 * Usage: npx tsx server/src/scripts/_tmpUnallocDiag.ts
 */
import { closeDb, prisma as p } from '../db.js';
import { resolveOverheadCloseJournalDate } from '../accounting/overheadAllocation.js';

async function main() {
  const periods = await p.overheadAllocationPeriod.findMany({
    where: { status: 'closed' },
    select: { id: true, label: true, periodStart: true, periodEnd: true, closedAt: true },
  });

  for (const period of periods) {
    const asOf = period.closedAt ?? new Date();
    const target = resolveOverheadCloseJournalDate(period.periodStart, period.periodEnd, asOf);
    if (target === period.periodEnd.slice(0, 10)) {
      console.log(`skip ${period.label}: already at periodEnd ${target}`);
      continue;
    }
    const refs = await p.transaction.findMany({
      where: {
        isDeleted: false,
        reference: { startsWith: `OHA-${period.label}-` },
      },
      select: { id: true, reference: true, date: true },
    });
    for (const tx of refs) {
      const d = String(tx.date).slice(0, 10);
      if (d === target) continue;
      if (d !== period.periodEnd.slice(0, 10)) {
        console.log(`skip ${tx.reference}: date ${d} ≠ periodEnd`);
        continue;
      }
      await p.transaction.update({ where: { id: tx.id }, data: { date: target } });
      console.log(`updated ${tx.reference}: ${d} → ${target}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await closeDb();
  });
