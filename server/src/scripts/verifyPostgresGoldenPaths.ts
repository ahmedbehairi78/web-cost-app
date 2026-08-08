/**
 * Post-migration golden-path checks against Postgres (no auth required).
 *   npx tsx server/src/scripts/verifyPostgresGoldenPaths.ts
 */
import { prisma } from '../db.js';

let failed = 0;
const pass = (label: string) => console.log(`  ✓ ${label}`);
const fail = (label: string, detail?: string) => {
  failed += 1;
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
};

console.log('\n=== Postgres golden-path checks ===\n');

const projects = await prisma.project.count({ where: { isDeleted: false } });
projects >= 1 ? pass(`projects (${projects})`) : fail('projects', 'expected ≥ 1');

const materials = await prisma.materialGroup.count();
materials >= 1 ? pass(`material_groups (${materials})`) : fail('material_groups');

const inventory = await prisma.projectInventory.count();
inventory >= 1 ? pass(`project_inventory (${inventory})`) : fail('project_inventory');

const consumption = await prisma.consumptionOrder.count({ where: { status: 'confirmed' } });
consumption >= 1 ? pass(`confirmed consumption_orders (${consumption})`) : fail('confirmed consumption_orders');

const returns = await prisma.returnOrder.count();
returns >= 1 ? pass(`return_orders (${returns})`) : pass(`return_orders (${returns}) — optional`);

const txs = await prisma.transaction.findMany({
  where: { isDeleted: false },
  include: { entries: true },
});
let unbalanced = 0;
for (const tx of txs) {
  const debit = tx.entries.reduce((s, e) => s + Number(e.debit), 0);
  const credit = tx.entries.reduce((s, e) => s + Number(e.credit), 0);
  if (Math.abs(debit - credit) > 0.005) unbalanced += 1;
}
unbalanced === 0 ? pass(`GL balanced (${txs.length} transactions)`) : fail('GL balance', `${unbalanced} unbalanced`);

const users = await prisma.user.count({ where: { isActive: true } });
users >= 1 ? pass(`active users (${users})`) : fail('active users');

const billing = await prisma.billing.count({ where: { isDeleted: false } });
billing >= 1 ? pass(`billing IPCs (${billing})`) : fail('billing IPCs');

const multiLineOrders = await prisma.consumptionOrder.findMany({
  where: { status: 'confirmed' },
  include: { lines: true },
});
const multiLine = multiLineOrders.filter((o) => o.lines.length > 1);
if (multiLine.length >= 1) {
  pass(`multi-line consumption orders (${multiLine.length})`);
  const sample = multiLine[0]!;
  const ref = sample.orderNumber;
  const txRow = await prisma.transaction.findFirst({
    where: { reference: ref, isDeleted: false },
    include: { entries: true },
  });
  if (txRow) {
    const dr = txRow.entries.reduce((s, e) => s + Number(e.debit), 0);
    const cr = txRow.entries.reduce((s, e) => s + Number(e.credit), 0);
    if (Math.abs(dr - cr) <= 0.005) {
      pass(`CON GL balanced for ${ref} (${txRow.entries.length} lines)`);
    } else {
      fail(`CON GL balance for ${ref}`, `Dr ${dr} Cr ${cr}`);
    }
    if (txRow.costCenterId === sample.contractId) {
      pass(`CON costCenterId = contractId (${ref})`);
    } else {
      fail(`CON costCenterId (${ref})`, `expected ${sample.contractId}`);
    }
  } else {
    fail(`CON GL for multi-line order ${ref}`, 'transaction not found');
  }
} else {
  pass('multi-line consumption orders (0) — optional until G2 run');
}

const templateCount = await prisma.consumptionAllocationTemplate.count();
templateCount >= 0 ? pass(`consumption_allocation_templates (${templateCount})`) : fail('templates table');

const directCc = await prisma.costCenter.count({ where: { type: 'direct', isDeleted: false } });
const contractCount = await prisma.contract.count({ where: { isDeleted: false } });
if (directCc >= contractCount) {
  pass(`cost_centers direct (${directCc}) >= contracts (${contractCount})`);
} else {
  fail('cost_centers direct seed', `${directCc} direct vs ${contractCount} contracts`);
}

const ohaTx = await prisma.transaction.findFirst({
  where: { reference: { startsWith: 'OHA-' }, isDeleted: false },
  include: { entries: true },
});
if (ohaTx) {
  const dr = ohaTx.entries.reduce((s, e) => s + Number(e.debit), 0);
  const cr = ohaTx.entries.reduce((s, e) => s + Number(e.credit), 0);
  if (Math.abs(dr - cr) <= 0.005) pass(`OHA GL balanced (${ohaTx.reference})`);
  else fail(`OHA GL balance (${ohaTx.reference})`, `Dr ${dr} Cr ${cr}`);
  const lineCc = ohaTx.entries.filter((e) => e.costCenterId).length;
  if (lineCc >= 2) pass(`OHA line-level cost centers (${lineCc} lines)`);
  else fail('OHA line cost centers', `only ${lineCc} lines with costCenterId`);
} else {
  pass('OHA GL (0) — optional until overhead close run');
}

await prisma.userNotificationRead.count();
pass('user_notification_reads table ready');

console.log(`\nResult: ${failed === 0 ? 'PASS' : `${failed} check(s) failed`}`);
await prisma.$disconnect();
process.exitCode = failed > 0 ? 1 : 0;
