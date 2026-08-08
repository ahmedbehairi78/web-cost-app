/** Usage: tsx server/src/scripts/boqEstimateTotal.ts <projectCode> <contractNumber> */
import 'dotenv/config';
import { initSqliteCore, closeSqliteCore } from '../sqlite/core.js';
import { getDb, rowToObj } from '../sqlite/appDb.js';
import { tenderAmountExcludingProfit } from '../../../src/lib/boqPricing.js';

const projectCode = process.argv[2] || 'PRJ-2026-001';
const contractNumber = process.argv[3] || 'Crt001';

initSqliteCore();
const db = getDb();

const contractRow = db
  .prepare(
    `SELECT c.id, c.contract_number, c.contract_name, p.project_code, p.project_name
     FROM contracts c
     JOIN projects p ON c.project_id = p.id
     WHERE COALESCE(c.is_deleted, 0) = 0
       AND (LOWER(TRIM(c.contract_number)) = LOWER(TRIM(?))
            OR LOWER(TRIM(c.contract_name)) = LOWER(TRIM(?)))
       AND (LOWER(TRIM(p.project_code)) = LOWER(TRIM(?))
            OR LOWER(TRIM(p.project_name)) LIKE '%' || ? || '%')`
  )
  .get(contractNumber, contractNumber, projectCode, projectCode) as Record<string, unknown> | undefined;

if (!contractRow) {
  console.log(
    JSON.stringify(
      {
        error: 'NOT_FOUND_IN_SQLITE',
        projectCode,
        contractNumber,
        hint: 'BOQ may exist only in Firestore. Use BOQ module or export from Firebase.',
      },
      null,
      2
    )
  );
  closeSqliteCore();
  process.exit(1);
}

const c = rowToObj(contractRow) as {
  id: string;
  contractNumber: string;
  contractName: string;
  projectCode: string;
  projectName: string;
};

const items = db
  .prepare(
    `SELECT id, item_code, description, tender_qty, tender_amount, unit_rate_total,
            rate_materials, rate_labour, rate_equipment, rate_overhead_pct, rate_profit_pct
     FROM boq_items
     WHERE contract_id = ? AND COALESCE(is_deleted, 0) = 0`
  )
  .all(c.id) as Record<string, unknown>[];

let sumTender = 0;
let sumEstCost = 0;
for (const row of items) {
  const item = rowToObj(row);
  sumTender += Number(item.tenderAmount || 0);
  sumEstCost += tenderAmountExcludingProfit({
    tenderQty: item.tenderQty,
    rateMaterials: item.rateMaterials,
    rateLabour: item.rateLabour,
    rateEquipment: item.rateEquipment,
    rateOverheadPct: item.rateOverheadPct,
    rateProfitPct: item.rateProfitPct,
    unitRateTotal: item.unitRateTotal,
    tenderAmount: item.tenderAmount,
  });
}

console.log(
  JSON.stringify(
    {
      projectCode: c.projectCode,
      projectName: c.projectName,
      contractNumber: c.contractNumber,
      contractName: c.contractName,
      itemCount: items.length,
      currency: 'EGP',
      totalTenderAmount: Math.round(sumTender * 100) / 100,
      totalEstimatedCostExcludingProfit: Math.round(sumEstCost * 100) / 100,
    },
    null,
    2
  )
);

closeSqliteCore();
