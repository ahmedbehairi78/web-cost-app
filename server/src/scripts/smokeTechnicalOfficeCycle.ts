/**
 * Smoke test for Technical Office document cycle (Sprints 1–10).
 * Run: npx tsx server/src/scripts/smokeTechnicalOfficeCycle.ts
 */
import { prisma } from '../db.js';
import { buildContractDocumentCycle } from '../lib/contractDocumentCycle.js';
import { buildContractBillingProgress } from '../lib/contractBillingProgress.js';
import { buildMosPriorMaps } from '../lib/mosPriorMaps.js';
import {
  findIpcItemsExceedingBoq,
  validateIpcMosBillingConsistency,
  validateIpcBoqQuantities,
} from '../lib/ipcBoqValidation.js';
import { backfillDocumentRegistry } from '../lib/documentRegistrySync.js';

const results: { name: string; ok: boolean; detail?: string }[] = [];

function pass(name: string, detail?: string) {
  results.push({ name, ok: true, detail });
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name: string, detail: string) {
  results.push({ name, ok: false, detail });
  console.error(`  ✗ ${name} — ${detail}`);
}

async function main() {
  console.log('\n=== Technical Office smoke test ===\n');

  // Schema tables
  const tables = [
    'mosCertificate',
    'mosCertificateLine',
    'variationOrder',
    'variationOrderLine',
    'documentRegistry',
    'billing',
    'billingItem',
  ] as const;

  for (const model of tables) {
    try {
      // @ts-expect-error dynamic model access
      await prisma[model].findFirst({ select: { id: true } });
      pass(`prisma.${model} readable`);
    } catch (e) {
      fail(`prisma.${model}`, e instanceof Error ? e.message : String(e));
    }
  }

  // Registry backfill (idempotent)
  try {
    const counts = await backfillDocumentRegistry();
    pass('backfillDocumentRegistry', JSON.stringify(counts));
  } catch (e) {
    fail('backfillDocumentRegistry', e instanceof Error ? e.message : String(e));
  }

  const contract = await prisma.contract.findFirst({
    where: { isDeleted: false },
    select: { id: true, contractName: true, contractNumber: true },
  });

  if (!contract) {
    console.log('\n  ⚠ No contract in DB — skipping contract-scoped checks\n');
  } else {
    pass('sample contract', `${contract.contractNumber} (${contract.id})`);

    try {
      const cycle = await buildContractDocumentCycle(contract.id);
      pass('buildContractDocumentCycle', `MOS=${cycle.mos.total} VO=${cycle.vo.total} IPC=${cycle.ipc.total}`);
    } catch (e) {
      fail('buildContractDocumentCycle', e instanceof Error ? e.message : String(e));
    }

    try {
      const progress = await buildContractBillingProgress(contract.id);
      pass(
        'buildContractBillingProgress',
        `${progress.itemCount} items · ${progress.totals.progressPct.toFixed(1)}% · exceed=${progress.totals.itemsExceedingTender}`,
      );
    } catch (e) {
      fail('buildContractBillingProgress', e instanceof Error ? e.message : String(e));
    }

    try {
      const maps = await buildMosPriorMaps(contract.id);
      const keys = Object.keys(maps.equivalent).length;
      pass('buildMosPriorMaps', `${keys} BOQ item(s) with MOS equivalent`);
    } catch (e) {
      fail('buildMosPriorMaps', e instanceof Error ? e.message : String(e));
    }

    const registryRows = await prisma.documentRegistry.count({
      where: { contractId: contract.id, isDeleted: false },
    });
    pass('document_registry rows for contract', String(registryRows));
  }

  // Pure validation logic
  const boqMap = new Map([
    ['item-1', { itemCode: '1.1', description: 'Test', tenderQty: 100 }],
  ]);
  const exceed = findIpcItemsExceedingBoq([{ boqItemId: 'item-1', totalQty: 120 }], boqMap);
  if (exceed.length === 1 && exceed[0].overBy === 20) {
    pass('findIpcItemsExceedingBoq unit logic');
  } else {
    fail('findIpcItemsExceedingBoq unit logic', `unexpected ${JSON.stringify(exceed)}`);
  }

  // MOS consistency in transaction (empty billing id)
  if (contract) {
    try {
      const issues = await prisma.$transaction((tx) =>
        validateIpcMosBillingConsistency(tx, contract.id, '__none__', [
          { boqItemId: 'fake-boq', previousQty: 0, currentQty: 1, totalQty: 1 },
        ]),
      );
      pass('validateIpcMosBillingConsistency runs', `${issues.length} issue(s) on dummy line`);
    } catch (e) {
      fail('validateIpcMosBillingConsistency', e instanceof Error ? e.message : String(e));
    }

    const billing = await prisma.billing.findFirst({
      where: { contractId: contract.id, isDeleted: false, status: { not: 'draft' } },
      include: { items: true },
    });
    if (billing && billing.items.length > 0) {
      try {
        const warnings = await prisma.$transaction((tx) =>
          validateIpcBoqQuantities(tx, contract.id, billing.items),
        );
        pass('validateIpcBoqQuantities on live billing', `${warnings.length} exceed row(s)`);
      } catch (e) {
        fail('validateIpcBoqQuantities', e instanceof Error ? e.message : String(e));
      }
    } else {
      console.log('  ⚠ No non-draft billing with items — skipped validateIpcBoqQuantities on live data');
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===\n`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
