/**
 * تقرير: التكلفة التقديرية vs الفعلية لبنود BOQ (من SQLite المحلي).
 * التشغيل: npm run local:boq-report
 * اختياري: npm run local:boq-report -- <contractId>
 */
import 'dotenv/config';
import { initSqliteCore, closeSqliteCore } from '../sqlite/core.js';
import { getDb, rowToObj } from '../sqlite/appDb.js';
import { tenderAmountExcludingProfit } from '../../../src/lib/boqPricing.js';

initSqliteCore();

const contractFilter = process.argv[2] || null;

const db = getDb();

const contracts = db
  .prepare(
    `SELECT c.id, c.contract_number, c.contract_name, p.project_name
     FROM contracts c
     LEFT JOIN projects p ON c.project_id = p.id
     WHERE COALESCE(c.is_deleted, 0) = 0
     ${contractFilter ? 'AND c.id = ?' : ''}
     ORDER BY p.project_code, c.contract_number`
  )
  .all(...(contractFilter ? [contractFilter] : [])) as Record<string, unknown>[];

if (contracts.length === 0) {
  console.log('لا توجد عقود في SQLite.');
  process.exit(0);
}

for (const raw of contracts) {
  const c = rowToObj(raw) as {
    id: string;
    contractNumber: string;
    contractName: string;
    projectName: string;
  };

  const items = db
    .prepare(
      `SELECT id, item_code, description, tender_qty,
              rate_materials, rate_labour, rate_equipment,
              rate_overhead_pct, rate_profit_pct,
              unit_rate_total, tender_amount
       FROM boq_items
       WHERE contract_id = ? AND COALESCE(is_deleted, 0) = 0
       ORDER BY item_code`
    )
    .all(c.id) as Record<string, unknown>[];

  if (items.length === 0) {
    console.log(`\n[${c.contractNumber}] ${c.contractName} — لا بنود BOQ في SQLite (قد تكون في Firestore فقط).\n`);
    continue;
  }

  const purchaseRows = db
    .prepare(
      `SELECT pil.boq_item_id, SUM(pia.total_cost) AS total_purchased
       FROM purchase_invoice_lines pil
       JOIN purchase_invoices pi ON pil.invoice_id = pi.invoice_id
       LEFT JOIN purchase_invoice_allocations pia ON pia.line_id = pil.id
       WHERE pil.boq_item_id IS NOT NULL AND pia.contract_id = ?
       GROUP BY pil.boq_item_id`
    )
    .all(c.id) as { boq_item_id: string; total_purchased: number }[];

  const consumedRows = db
    .prepare(
      `SELECT boq_item_id, SUM(total_cost) AS total_consumed
       FROM boq_actual_costs
       WHERE contract_id = ?
       GROUP BY boq_item_id`
    )
    .all(c.id) as { boq_item_id: string; total_consumed: number }[];

  const purchaseByBoq = new Map(purchaseRows.map((r) => [r.boq_item_id, Number(r.total_purchased || 0)]));
  const consumedByBoq = new Map(consumedRows.map((r) => [r.boq_item_id, Number(r.total_consumed || 0)]));

  console.log(`\n${'='.repeat(90)}`);
  console.log(`عقد: ${c.contractNumber} — ${c.contractName}`);
  console.log(`مشروع: ${c.projectName || '—'}`);
  console.log(`${'='.repeat(90)}`);
  console.log(
    [
      'كود البند'.padEnd(12),
      'الوصف'.padEnd(28),
      'تقديري(عرض)'.padStart(14),
      'تقديري(تكلفة)'.padStart(14),
      'مشتريات'.padStart(12),
      'صرف'.padStart(12),
      'فعلي'.padStart(12),
      'فرق'.padStart(12),
    ].join(' | ')
  );
  console.log('-'.repeat(90));

  let sumTender = 0;
  let sumEstCost = 0;
  let sumPurch = 0;
  let sumCons = 0;
  let sumActual = 0;

  for (const row of items) {
    const item = rowToObj(row) as Record<string, unknown>;
    const id = String(item.id);
    const tender = Number(item.tenderAmount || 0);
    const estCost = tenderAmountExcludingProfit({
      tenderQty: item.tenderQty,
      rateMaterials: item.rateMaterials,
      rateLabour: item.rateLabour,
      rateEquipment: item.rateEquipment,
      rateOverheadPct: item.rateOverheadPct,
      rateProfitPct: item.rateProfitPct,
      unitRateTotal: item.unitRateTotal,
      tenderAmount: item.tenderAmount,
    });
    const purchased = purchaseByBoq.get(id) ?? 0;
    const consumed = consumedByBoq.get(id) ?? 0;
    const actual = purchased + consumed;
    const variance = estCost - actual;

    sumTender += tender;
    sumEstCost += estCost;
    sumPurch += purchased;
    sumCons += consumed;
    sumActual += actual;

    const desc = String(item.description || '').slice(0, 26);
    console.log(
      [
        String(item.itemCode || '').padEnd(12),
        desc.padEnd(28),
        tender.toFixed(2).padStart(14),
        estCost.toFixed(2).padStart(14),
        purchased.toFixed(2).padStart(12),
        consumed.toFixed(2).padStart(12),
        actual.toFixed(2).padStart(12),
        variance.toFixed(2).padStart(12),
      ].join(' | ')
    );
  }

  console.log('-'.repeat(90));
  console.log(
    [
      'الإجمالي'.padEnd(41),
      sumTender.toFixed(2).padStart(14),
      sumEstCost.toFixed(2).padStart(14),
      sumPurch.toFixed(2).padStart(12),
      sumCons.toFixed(2).padStart(12),
      sumActual.toFixed(2).padStart(12),
      (sumEstCost - sumActual).toFixed(2).padStart(12),
    ].join(' | ')
  );
}

console.log('\nملاحظات:');
console.log('- «تقديري(عرض)» = tenderAmount (يشمل ربح المقاول).');
console.log('- «تقديري(تكلفة)» = بدون ربح — للمقارنة بالفعلي.');
console.log('- «فعلي» = مشتريات مرتبطة ببند BOQ + تكلفة صرف مخزون مؤكد.');
console.log('- فواتير بدون boq_item_id أو عقود غير مزامنة لـ SQLite لن تظهر هنا.\n');

closeSqliteCore();
