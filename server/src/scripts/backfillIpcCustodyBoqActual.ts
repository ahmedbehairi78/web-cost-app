/**
 * One-shot: write boq_actual_costs for already-approved subcontractor IPCs
 * and custody settlements that have BOQ links (report-only; no GL changes).
 *
 * Usage:
 *   npx tsx server/src/scripts/backfillIpcCustodyBoqActual.ts
 *   npx tsx server/src/scripts/backfillIpcCustodyBoqActual.ts --dry-run
 */
import { prisma } from '../db.js';
import {
  syncBoqActualCostsForCustody,
  syncBoqActualCostsForIpc,
  type IpcBoqLineInput,
} from '../accounting/boqActualFromSources.js';
import type { CustodySettlementLine } from '../accounting/custodySettlementJournal.js';

const dryRun = process.argv.includes('--dry-run');

function parseIpcItems(payload: unknown): IpcBoqLineInput[] {
  if (!payload || typeof payload !== 'object') return [];
  const obj = payload as Record<string, unknown>;
  const items = Array.isArray(obj.items) ? obj.items : Array.isArray(payload) ? payload : [];
  return items.filter((x): x is IpcBoqLineInput => !!x && typeof x === 'object') as IpcBoqLineInput[];
}

function parseCustodyItems(payload: unknown): CustodySettlementLine[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((o) => ({
      id: o.id != null ? String(o.id) : undefined,
      contractId: o.contractId != null ? String(o.contractId) : '',
      accountCode: String(o.accountCode ?? '').trim(),
      accountName: o.accountName != null ? String(o.accountName) : undefined,
      amount: Number(o.amount) || 0,
      description: o.description != null ? String(o.description) : undefined,
      ...(o.boqItemId != null && String(o.boqItemId).trim()
        ? { boqItemId: String(o.boqItemId).trim() }
        : {}),
    }));
}

async function main() {
  const ipcs = await prisma.purchaseTransaction.findMany({
    where: { type: 'ipc', status: 'approved', isDeleted: false },
    include: { items: true },
  });

  let ipcRows = 0;
  let ipcDocs = 0;
  for (const row of ipcs) {
    const items = parseIpcItems(row.items[0]?.payload);
    if (dryRun) {
      const { buildIpcBoqActualRows } = await import('../accounting/boqActualFromSources.js');
      const built = buildIpcBoqActualRows({
        purchaseTransactionId: row.id,
        contractId: row.contractId ?? '',
        date: row.date,
        items,
      });
      if (built.length) {
        ipcDocs += 1;
        ipcRows += built.length;
      }
      continue;
    }
    const n = await syncBoqActualCostsForIpc({
      purchaseTransactionId: row.id,
      contractId: row.contractId,
      date: row.date,
      items,
    });
    if (n > 0) {
      ipcDocs += 1;
      ipcRows += n;
    }
  }

  const custodies = await prisma.custodySettlement.findMany({
    where: { status: 'approved', isDeleted: false },
    include: { items: true },
  });

  let custodyRows = 0;
  let custodyDocs = 0;
  for (const row of custodies) {
    const payload = row.items[0]?.payload;
    const items = Array.isArray(payload) ? parseCustodyItems(payload) : [];
    if (dryRun) {
      const { buildCustodyBoqActualRows } = await import('../accounting/boqActualFromSources.js');
      const built = buildCustodyBoqActualRows({
        custodySettlementId: row.id,
        date: row.date,
        items,
      });
      if (built.length) {
        custodyDocs += 1;
        custodyRows += built.length;
      }
      continue;
    }
    const n = await syncBoqActualCostsForCustody({
      custodySettlementId: row.id,
      date: row.date,
      items,
    });
    if (n > 0) {
      custodyDocs += 1;
      custodyRows += n;
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        ipc: { documents: ipcDocs, boqRows: ipcRows, scanned: ipcs.length },
        custody: { documents: custodyDocs, boqRows: custodyRows, scanned: custodies.length },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
