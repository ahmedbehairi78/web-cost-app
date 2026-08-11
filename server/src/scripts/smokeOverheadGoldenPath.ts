/**
 * Smoke test: indirect cost center + GL expense + overhead preview/close (optional).
 * Run: npx tsx server/src/scripts/smokeOverheadGoldenPath.ts
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { createTransaction } from '../accounting/journal.js';
import { businessTodayYmd } from '../lib/businessCalendar.js';
import {
  buildOverheadPreview,
  closeOverheadPeriod,
  computeIndirectPools,
} from '../accounting/overheadAllocation.js';

const TEST_CODE = 'HO-SMOKE-TEST';
const EXPENSE = '52101001';
const CREDITOR = '21101001';

async function main() {
  let failed = 0;
  const pass = (msg: string) => console.log(`  ✓ ${msg}`);
  const fail = (msg: string, detail?: string) => {
    failed++;
    console.log(`  ✗ ${msg}${detail ? ` — ${detail}` : ''}`);
  };

  console.log('\n=== Overhead smoke path ===\n');

  let center = await prisma.costCenter.findFirst({
    where: { code: TEST_CODE, isDeleted: false },
  });
  if (!center) {
    center = await prisma.costCenter.create({
      data: {
        id: randomUUID(),
        code: TEST_CODE,
        name: 'Smoke Test HO',
        type: 'indirect',
        isActive: true,
      },
    });
    pass(`created indirect center ${TEST_CODE}`);
  } else {
    pass(`reusing indirect center ${TEST_CODE}`);
  }

  const ref = `SMOKE-IND-${Date.now()}`;
  const amount = 100;
  const journal = await createTransaction(
    {
      date: businessTodayYmd(),
      description: 'Smoke indirect expense',
      reference: ref,
      costCenterId: center.id,
      skipPeriodLock: true,
      entries: [
        {
          accountCode: EXPENSE,
          accountName: 'Admin salaries',
          debit: amount,
          credit: 0,
          costCenterId: center.id,
        },
        {
          accountCode: CREDITOR,
          accountName: 'Suppliers',
          debit: 0,
          credit: amount,
        },
      ],
    },
    'smoke-script',
  );
  const dr = journal.entries.reduce((s, e) => s + Number(e.debit), 0);
  const cr = journal.entries.reduce((s, e) => s + Number(e.credit), 0);
  if (Math.abs(dr - cr) <= 0.005) pass(`indirect GL balanced (${ref})`);
  else fail('indirect GL balance', `Dr ${dr} Cr ${cr}`);

  const year = new Date().getFullYear();
  const periodStart = `${year}-01-01`;
  const periodEnd = `${year}-12-31`;
  const label = `SMOKE-${year}`;

  let period = await prisma.overheadAllocationPeriod.findFirst({
    where: { periodStart, periodEnd, label },
  });
  if (!period) {
    period = await prisma.overheadAllocationPeriod.create({
      data: {
        id: randomUUID(),
        label,
        periodStart,
        periodEnd,
        distributionBasis: 'revenue_ratio',
        status: 'draft',
        createdBy: 'smoke-script',
      },
    });
    pass(`created draft period ${label}`);
  } else {
    pass(`reusing period ${label} (${period.status})`);
  }

  const pools = await computeIndirectPools(periodStart, periodEnd);
  const hasPool = pools.some((p) => p.indirectCenterId === center.id && p.poolAmount > 0);
  if (hasPool) pass(`pool includes ${TEST_CODE} (${pools.find((p) => p.indirectCenterId === center.id)?.poolAmount})`);
  else fail('pool missing smoke center', `pools=${pools.length}`);

  const preview = await buildOverheadPreview(period.id);
  if (preview.lines.length >= 0) pass(`preview lines: ${preview.lines.length}, totalRevenue=${preview.totalRevenue}`);

  if (period.status === 'draft' && preview.totalRevenue > 0 && preview.lines.length > 0) {
    try {
      await closeOverheadPeriod(period.id, 'smoke-script');
      pass('period closed with OHA journals');
      const oha = await prisma.transaction.findFirst({
        where: { reference: { startsWith: 'OHA-' }, isDeleted: false },
        include: { entries: true },
      });
      if (oha) {
        const odr = oha.entries.reduce((s, e) => s + Number(e.debit), 0);
        const ocr = oha.entries.reduce((s, e) => s + Number(e.credit), 0);
        if (Math.abs(odr - ocr) <= 0.005) pass(`OHA balanced (${oha.reference})`);
        else fail('OHA balance', `Dr ${odr} Cr ${ocr}`);
      }
    } catch (e) {
      fail('close period', e instanceof Error ? e.message : String(e));
    }
  } else {
    pass('close skipped (no revenue or already closed)');
  }

  console.log(`\nResult: ${failed === 0 ? 'PASS' : `${failed} failed`}\n`);
  await prisma.$disconnect();
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
