/**
 * One-time GL backfill: create missing Postgres journal entries from operational data
 * + Firestore backup (IPC, cheques). Idempotent — skips existing references/ids.
 *
 *   npm run local:backfill-gl
 *   npm run local:backfill-gl -- --dry-run
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { AccountCodes } from '../accounting/accountCodes.js';
import { createTransaction, getTransactionByReference } from '../accounting/journal.js';
import { buildIpcEntries } from '../accounting/journalShared.js';
import type { JournalEntryInput, TransactionInput } from '../accounting/journalShared.js';
import { ensureMissingCoaAccounts } from '../accounting/ensureCoaSeed.js';
import { resolveProjectWarehouseAccount } from '../accounting/projectWarehouseGl.js';
import { loadFirestoreBackup } from '../migration/parseFirestoreBackup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const parentRoot = path.resolve(__dirname, '../../../..');
const DEFAULT_BACKUP = path.join(
  parentRoot,
  'backups',
  '20260614-055130',
  'firestore',
  'backup_2026-06-14.json',
);

const BILLING_GL_STATUSES = new Set(['submitted', 'approved', 'paid', 'review']);

type Report = { created: string[]; skipped: string[]; errors: string[] };

const dryRun = process.argv.includes('--dry-run');
const backupArg = process.argv.find((a) => a.endsWith('.json') && !a.startsWith('-'));
const backupPath = backupArg ? path.resolve(backupArg) : DEFAULT_BACKUP;

const report: Report = { created: [], skipped: [], errors: [] };

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'object' && v !== null && 'toNumber' in v) {
    return (v as Prisma.Decimal).toNumber();
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function logCreated(msg: string) {
  report.created.push(msg);
  console.log(`  + ${msg}`);
}

function logSkipped(msg: string) {
  report.skipped.push(msg);
  console.log(`  · skip: ${msg}`);
}

function logError(msg: string, err: unknown) {
  const detail = err instanceof Error ? err.message : String(err);
  report.errors.push(`${msg}: ${detail}`);
  console.error(`  ! ${msg}: ${detail}`);
}

async function hasReference(ref: string): Promise<boolean> {
  const row = await getTransactionByReference(ref);
  return Boolean(row);
}

async function hasTxId(id: string): Promise<boolean> {
  const row = await prisma.transaction.findFirst({ where: { id, isDeleted: false } });
  return Boolean(row);
}

type CoaMaps = {
  byId: Map<string, { accountCode: string; accountName: string }>;
  byCode: Map<string, { accountCode: string; accountName: string }>;
};

async function loadCoaMaps(firestoreCoa: Array<Record<string, unknown>>): Promise<CoaMaps> {
  await ensureMissingCoaAccounts({
    codes: [
      AccountCodes.RECEIVED_CHEQUES_CLEARING,
      AccountCodes.ISSUED_CHEQUES_PAYABLE,
      AccountCodes.BANK,
      AccountCodes.RECEIVABLES,
      AccountCodes.ADVANCE_PAYMENT,
      AccountCodes.WHT_PAYABLE,
    ],
  });

  const rows = await prisma.chartOfAccount.findMany({
    select: { id: true, accountCode: true, accountName: true, isGroup: true, status: true },
  });
  const byId = new Map<string, { accountCode: string; accountName: string }>();
  const byCode = new Map<string, { accountCode: string; accountName: string }>();
  for (const r of rows) {
    if (r.isGroup) continue;
    const leaf = { accountCode: r.accountCode, accountName: r.accountName };
    byId.set(r.id, leaf);
    byCode.set(r.accountCode, leaf);
  }
  // Cheque backup docs reference Firestore COA doc ids — map them to Postgres leaves by accountCode.
  for (const doc of firestoreCoa) {
    const fsId = String(doc._id ?? '').trim();
    const code = String(doc.accountCode ?? '').trim();
    if (!fsId || !code || doc.isGroup === true) continue;
    const leaf = byCode.get(code);
    if (leaf) byId.set(fsId, leaf);
  }
  return { byId, byCode };
}

function coaLeaf(maps: CoaMaps, idOrCode: string | null | undefined, label: string) {
  const key = String(idOrCode ?? '').trim();
  if (!key) throw new Error(`${label}: missing account`);
  const byId = maps.byId.get(key);
  if (byId) return byId;
  const byCode = maps.byCode.get(key);
  if (byCode) return byCode;
  throw new Error(`${label}: COA not found (${key})`);
}

async function postTx(input: TransactionInput, label: string) {
  const ref = input.reference?.trim();
  if (ref && (await hasReference(ref))) {
    logSkipped(`${label} — reference exists (${ref})`);
    return null;
  }
  if (input.id && (await hasTxId(input.id))) {
    logSkipped(`${label} — id exists (${input.id})`);
    return null;
  }
  if (dryRun) {
    logCreated(`[dry-run] ${label} ref=${ref ?? '—'} id=${input.id ?? '—'}`);
    return null;
  }
  const tx = await createTransaction({ ...input, skipPeriodLock: true }, 'backfill-gl');
  logCreated(`${label} → ${tx.id} (${ref ?? 'no-ref'})`);
  return tx;
}

function chequeIssueRef(chequeId: string, direction: 'issued' | 'received') {
  return `CH-${direction.toUpperCase()}-${chequeId}-ISS`;
}

function chequeClearRef(chequeId: string, direction: 'issued' | 'received') {
  return `CH-${direction.toUpperCase()}-${chequeId}-CLR`;
}

function buildReceivedIssueEntries(
  maps: CoaMaps,
  amount: number,
  offsetId: string | null | undefined,
  credits: Array<{ amount: number; offsetChartOfAccountId: string }> | null | undefined,
): JournalEntryInput[] {
  const clr = coaLeaf(maps, AccountCodes.RECEIVED_CHEQUES_CLEARING, '12203001');
  if (Array.isArray(credits) && credits.length >= 2) {
    let sum = 0;
    const creditLines: JournalEntryInput[] = credits.map((c) => {
      const leaf = coaLeaf(maps, c.offsetChartOfAccountId, 'cheque credit');
      sum += num(c.amount);
      return { accountCode: leaf.accountCode, accountName: leaf.accountName, debit: 0, credit: num(c.amount) };
    });
    if (Math.abs(sum - amount) > 0.005) {
      throw new Error(`Cheque credit split ${sum} != ${amount}`);
    }
    return [{ accountCode: clr.accountCode, accountName: clr.accountName, debit: amount, credit: 0 }, ...creditLines];
  }
  const off = coaLeaf(maps, offsetId, 'cheque offset');
  return [
    { accountCode: clr.accountCode, accountName: clr.accountName, debit: amount, credit: 0 },
    { accountCode: off.accountCode, accountName: off.accountName, debit: 0, credit: amount },
  ];
}

function buildIssuedIssueEntries(maps: CoaMaps, amount: number, offsetId: string | null | undefined): JournalEntryInput[] {
  const off = coaLeaf(maps, offsetId, 'cheque payee');
  const pay = coaLeaf(maps, AccountCodes.ISSUED_CHEQUES_PAYABLE, '21601001');
  return [
    { accountCode: off.accountCode, accountName: off.accountName, debit: amount, credit: 0 },
    { accountCode: pay.accountCode, accountName: pay.accountName, debit: 0, credit: amount },
  ];
}

async function backfillConsumption(maps: CoaMaps) {
  console.log('\n[1] Consumption orders (CON-*)');
  const orders = await prisma.consumptionOrder.findMany({
    where: { status: 'confirmed' },
    include: { lines: true },
  });
  for (const order of orders) {
    const ref = order.orderNumber.startsWith('CON-') ? order.orderNumber : `CON-${order.orderNumber}`;
    try {
      if (await hasReference(ref)) {
        logSkipped(`consumption ${ref}`);
        continue;
      }
      const projectId = order.projectId ?? undefined;
      if (!projectId) throw new Error('missing projectId');
      const warehouse = await resolveProjectWarehouseAccount(prisma, projectId);
      if (!warehouse) throw new Error('warehouse 127 not found');
      const totalCost = order.lines.reduce((s, l) => s + num(l.totalCost), 0);
      if (totalCost <= 0) {
        logSkipped(`consumption ${ref} — zero cost`);
        continue;
      }
      const expenseCode = String(order.expenseAccountCode ?? '').trim() || AccountCodes.EXPENSE_MATERIALS;
      const expenseName = order.expenseAccountName ?? 'مواد البناء';
      await postTx(
        {
          date: order.orderDate,
          description: `صرف مخزن — ${ref}`,
          reference: ref,
          projectId,
          costCenterId: order.contractId,
          entries: [
            { accountCode: expenseCode, accountName: expenseName, debit: totalCost, credit: 0 },
            { accountCode: warehouse.accountCode, accountName: warehouse.accountName, debit: 0, credit: totalCost },
          ],
        },
        `consumption ${ref}`,
      );
    } catch (err) {
      logError(`consumption ${ref}`, err);
    }
  }
}

async function backfillReturns(maps: CoaMaps) {
  console.log('\n[2] Return orders (RET-*)');
  const orders = await prisma.returnOrder.findMany({
    where: { status: 'confirmed' },
    include: {
      lines: {
        include: {
          consumptionOrderLine: {
            include: { order: true },
          },
        },
      },
    },
  });
  for (const order of orders) {
    const ref = order.returnNumber;
    try {
      if (await hasReference(ref)) {
        logSkipped(`return ${ref}`);
        continue;
      }
      const warehouse = await resolveProjectWarehouseAccount(prisma, order.projectId);
      if (!warehouse) throw new Error('warehouse 127 not found');
      const totalCost = order.lines.reduce((s, l) => s + num(l.totalCost), 0);
      if (totalCost <= 0) {
        logSkipped(`return ${ref} — zero cost`);
        continue;
      }
      const conOrder = order.lines[0]?.consumptionOrderLine?.order;
      const expenseCode =
        String(conOrder?.expenseAccountCode ?? '').trim() || AccountCodes.EXPENSE_MATERIALS;
      const expenseName = conOrder?.expenseAccountName ?? 'مواد البناء';
      await postTx(
        {
          date: order.returnDate,
          description: `إرجاع مخزن — ${ref}`,
          reference: ref,
          projectId: order.projectId,
          costCenterId: order.contractId,
          entries: [
            { accountCode: warehouse.accountCode, accountName: warehouse.accountName, debit: totalCost, credit: 0 },
            { accountCode: expenseCode, accountName: expenseName, debit: 0, credit: totalCost },
          ],
        },
        `return ${ref}`,
      );
    } catch (err) {
      logError(`return ${ref}`, err);
    }
  }
}

async function backfillBilling(maps: CoaMaps, firestoreBilling: Map<string, Record<string, unknown>>) {
  console.log('\n[3] IPC / Billing');
  const billings = await prisma.billing.findMany({
    where: { isDeleted: false },
    include: { contract: { select: { contractName: true } } },
  });
  for (const b of billings) {
    if (!BILLING_GL_STATUSES.has(b.status)) {
      logSkipped(`billing ${b.billingNumber} — status=${b.status}`);
      continue;
    }
    const fsDoc = firestoreBilling.get(b.id);
    const presetId =
      b.transactionId ??
      (fsDoc?.transactionId ? String(fsDoc.transactionId) : undefined);
    try {
      let ref = `IPC-${b.billingNumber}`;
      if (presetId && (await hasTxId(presetId))) {
        if (!b.transactionId && !dryRun) {
          await prisma.billing.update({ where: { id: b.id }, data: { transactionId: presetId } });
        }
        logSkipped(`billing ${b.billingNumber} — tx id exists`);
        continue;
      }
      if (await hasReference(ref)) {
        if (presetId) {
          ref = `${ref}-${b.id.slice(0, 8)}`;
          if (await hasReference(ref)) {
            logSkipped(`billing ${b.billingNumber} — reference taken (orphan tx id ${presetId})`);
            continue;
          }
        } else {
          logSkipped(`billing ${b.billingNumber} — reference exists`);
          continue;
        }
      }
      const entries = buildIpcEntries({
        worksValue: num(b.worksValueExVat),
        vatAmount: num(b.vatAmount),
        netPayable: num(b.netPayable),
        execGuarantee: num(b.execGuaranteeAmount),
        whtAmount: num(b.whtAmount),
        labourInsurance: num(b.labourInsuranceAmount),
        manpowerLevy: num(b.manpowerLevyAmount),
        advancePaymentRecovery: num(b.advancePaymentRecovery),
        contractName: b.contract.contractName,
      });
      const tx = await postTx(
        {
          id: presetId,
          date: b.date,
          description: `مستخلص ${b.billingNumber}`,
          reference: ref,
          projectId: b.projectId,
          costCenterId: b.contractId,
          entries,
        },
        `IPC ${b.billingNumber}`,
      );
      if (tx && !dryRun) {
        await prisma.billing.update({ where: { id: b.id }, data: { transactionId: tx.id } });
      } else if (presetId && dryRun) {
        logCreated(`[dry-run] link billing ${b.billingNumber} → ${presetId}`);
      }
    } catch (err) {
      logError(`billing ${b.billingNumber}`, err);
    }
  }
}

async function backfillTransfers() {
  console.log('\n[4] Project inventory transfers (PTRF-*)');
  const transfers = await prisma.projectInventoryTransfer.findMany({
    where: { status: 'approved' },
    include: { lines: true, fromProject: true, toProject: true },
  });
  for (const tr of transfers) {
    const ref = tr.transferNumber.startsWith('PTRF-') ? tr.transferNumber : `PTRF-${tr.transferNumber}`;
    try {
      if (await hasReference(ref)) {
        logSkipped(`transfer ${ref}`);
        continue;
      }
      const totalCost = tr.lines.reduce((s, l) => s + num(l.totalCost), 0);
      if (totalCost <= 0) {
        logSkipped(`transfer ${ref} — zero cost`);
        continue;
      }
      const fromWh = await resolveProjectWarehouseAccount(prisma, tr.fromProjectId);
      const toWh = await resolveProjectWarehouseAccount(prisma, tr.toProjectId);
      if (!fromWh || !toWh) throw new Error('warehouse accounts missing');
      const tx = await postTx(
        {
          id: tr.transactionId ?? undefined,
          date: tr.transferDate,
          description: `تحويل مخزن — ${tr.fromProject.projectName} → ${tr.toProject.projectName} (${ref})`,
          reference: ref,
          projectId: tr.fromProjectId,
          entries: [
            { accountCode: toWh.accountCode, accountName: toWh.accountName, debit: totalCost, credit: 0 },
            { accountCode: fromWh.accountCode, accountName: fromWh.accountName, debit: 0, credit: totalCost },
          ],
        },
        `transfer ${ref}`,
      );
      if (tx && !dryRun && !tr.transactionId) {
        await prisma.projectInventoryTransfer.update({
          where: { id: tr.id },
          data: { transactionId: tx.id },
        });
      }
    } catch (err) {
      logError(`transfer ${ref}`, err);
    }
  }
}

type ChequeDoc = Record<string, unknown> & { _id?: string };
type BankDoc = Record<string, unknown> & { _id?: string; code?: string; nameAr?: string; nameEn?: string };

async function backfillCheques(maps: CoaMaps, cheques: ChequeDoc[], banks: Map<string, BankDoc>) {
  console.log('\n[5] Bank cheques (ISS / CLR)');
  for (const ch of cheques) {
    const id = String(ch._id ?? '');
    if (!id) continue;
    const direction = String(ch.direction ?? 'received') as 'issued' | 'received';
    const status = String(ch.status ?? '').toLowerCase();
    if (status === 'rejected') {
      logSkipped(`cheque ${ch.chequeNo ?? id} — rejected`);
      continue;
    }
    const amount = num(ch.amount);
    if (amount <= 0) continue;
    const issRef = String(ch.postedIssueReference ?? chequeIssueRef(id, direction));
    const clrRef = String(ch.postedClearReference ?? chequeClearRef(id, direction));
    const issueDate = String(ch.issueDate ?? ch.createdAt ?? '2026-01-01').slice(0, 10);
    const bank = banks.get(String(ch.bankAccountId ?? ''));
    const bankCode = String(bank?.code ?? AccountCodes.BANK);
    const bankName = String(bank?.nameAr ?? bank?.nameEn ?? 'Bank');
    const projectId = ch.projectId ? String(ch.projectId) : undefined;
    const contractId = ch.contractId ? String(ch.contractId) : undefined;

    try {
      let issueTx = await getTransactionByReference(issRef);
      if (!issueTx && !(await hasTxId(String(ch.glIssueTransactionId ?? '')))) {
        const issueEntries =
          direction === 'issued'
            ? buildIssuedIssueEntries(maps, amount, String(ch.offsetChartOfAccountId ?? ''))
            : buildReceivedIssueEntries(
                maps,
                amount,
                String(ch.offsetChartOfAccountId ?? ''),
                ch.receivedIssueCredits as Array<{ amount: number; offsetChartOfAccountId: string }> | null,
              );
        issueTx = await postTx(
          {
            id: ch.glIssueTransactionId ? String(ch.glIssueTransactionId) : undefined,
            date: issueDate,
            description: `${direction === 'received' ? 'شيك وارد' : 'شيك صادر'} ${ch.chequeNo ?? ''}`.trim(),
            reference: issRef,
            projectId,
            costCenterId: contractId,
            entries: issueEntries,
          },
          `cheque ISS ${ch.chequeNo ?? id}`,
        );
      } else {
        logSkipped(`cheque ISS ${ch.chequeNo ?? id}`);
      }

      if (status !== 'cleared') continue;

      if (await hasReference(clrRef)) {
        logSkipped(`cheque CLR ${ch.chequeNo ?? id}`);
        continue;
      }

      const issueForClr =
        issueTx ??
        (await getTransactionByReference(issRef)) ??
        (ch.glIssueTransactionId
          ? await prisma.transaction.findFirst({
              where: { id: String(ch.glIssueTransactionId), isDeleted: false },
              include: { entries: { orderBy: { lineNo: 'asc' } } },
            })
          : null);

      let issueEntries: JournalEntryInput[];
      if (issueForClr && 'entries' in issueForClr && issueForClr.entries) {
        issueEntries = issueForClr.entries;
      } else if (dryRun) {
        issueEntries =
          direction === 'issued'
            ? buildIssuedIssueEntries(maps, amount, String(ch.offsetChartOfAccountId ?? ''))
            : buildReceivedIssueEntries(
                maps,
                amount,
                String(ch.offsetChartOfAccountId ?? ''),
                ch.receivedIssueCredits as Array<{ amount: number; offsetChartOfAccountId: string }> | null,
              );
      } else {
        throw new Error('missing issue leg for CLR');
      }
      let clrEntries: JournalEntryInput[];
      if (direction === 'issued') {
        const payLine = issueEntries.find((e) => num(e.credit) > 0);
        if (!payLine) throw new Error('issued issue has no credit line');
        clrEntries = [
          { accountCode: payLine.accountCode, accountName: payLine.accountName ?? payLine.accountCode, debit: amount, credit: 0 },
          { accountCode: bankCode, accountName: bankName, debit: 0, credit: amount },
        ];
      } else {
        const clrLine = issueEntries.find((e) => num(e.debit) > 0);
        if (!clrLine) throw new Error('received issue has no debit line');
        clrEntries = [
          { accountCode: bankCode, accountName: bankName, debit: amount, credit: 0 },
          { accountCode: clrLine.accountCode, accountName: clrLine.accountName ?? clrLine.accountCode, debit: 0, credit: amount },
        ];
      }

      await postTx(
        {
          id: ch.glClearTransactionId ? String(ch.glClearTransactionId) : undefined,
          date: issueDate,
          description: `${direction === 'received' ? 'تحصيل' : 'صرف'} شيك ${ch.chequeNo ?? ''}`.trim(),
          reference: clrRef,
          projectId,
          costCenterId: contractId,
          entries: clrEntries,
        },
        `cheque CLR ${ch.chequeNo ?? id}`,
      );
    } catch (err) {
      logError(`cheque ${ch.chequeNo ?? id}`, err);
    }
  }
}

async function backfillPurchaseInvoices(maps: CoaMaps) {
  console.log('\n[6] Purchase invoices (127…)');
  const rows = await prisma.purchaseTransaction.findMany({
    where: { isDeleted: false, type: 'invoice' },
  });
  for (const p of rows) {
    if (p.status === 'draft') continue;
    try {
      if (p.transactionId && (await hasTxId(p.transactionId))) {
        logSkipped(`purchase ${p.referenceNumber ?? p.id}`);
        continue;
      }
      const ref = p.referenceNumber ? `INV-${p.referenceNumber}` : `INV-${p.id}`;
      if (await hasReference(ref)) {
        logSkipped(`purchase ref ${ref}`);
        continue;
      }
      const projectId = p.projectId ?? undefined;
      if (!projectId) throw new Error('missing projectId');
      const invCode = String(p.inventoryAccountCode ?? '').trim();
      if (!invCode) throw new Error('missing inventoryAccountCode');
      const invRow = coaLeaf(maps, invCode, 'inventory');
      const supplierCode = AccountCodes.SUPPLIERS;
      const base = num(p.amount);
      const vat = num(p.vatAmount);
      const wht = num(p.whtAmount);
      const total = num(p.totalAmount);
      const tx = await postTx(
        {
          id: p.transactionId ?? undefined,
          date: p.date,
          description: p.description || `فاتورة ${p.referenceNumber ?? p.id}`,
          reference: ref,
          projectId,
          costCenterId: p.contractId ?? undefined,
          entries: [
            { accountCode: invRow.accountCode, accountName: invRow.accountName, debit: base + vat, credit: 0 },
            { accountCode: supplierCode, accountName: `موردين - ${p.supplierName ?? ''}`, debit: 0, credit: total },
            { accountCode: AccountCodes.WHT_PAYABLE, accountName: 'مصلحة الضرائب - خصم وإضافة', debit: 0, credit: wht },
          ].filter((e) => e.debit > 0 || e.credit > 0),
        },
        `purchase ${p.referenceNumber ?? p.id}`,
      );
      if (tx && !dryRun && !p.transactionId) {
        await prisma.purchaseTransaction.update({ where: { id: p.id }, data: { transactionId: tx.id } });
      }
    } catch (err) {
      logError(`purchase ${p.referenceNumber ?? p.id}`, err);
    }
  }
}

console.log(`\n=== GL backfill ${dryRun ? '(DRY RUN) ' : ''}===`);
console.log(`Backup: ${backupPath}`);

if (!fs.existsSync(backupPath)) {
  console.error('Firestore backup not found.');
  process.exit(1);
}

const backup = await loadFirestoreBackup(backupPath);
const fsBilling = new Map<string, Record<string, unknown>>();
for (const doc of backup.collections?.billing ?? []) {
  if (doc._id) fsBilling.set(String(doc._id), doc as Record<string, unknown>);
}
const fsCheques = (backup.collections?.bank_cheques ?? []) as ChequeDoc[];
const fsBanks = new Map<string, BankDoc>();
for (const doc of backup.collections?.bank_accounts ?? []) {
  if (doc._id) fsBanks.set(String(doc._id), doc as BankDoc);
}

const fsCoa = (backup.collections?.chart_of_accounts ?? []) as Array<Record<string, unknown>>;
const coaMaps = await loadCoaMaps(fsCoa);

await backfillConsumption(coaMaps);
await backfillReturns(coaMaps);
await backfillBilling(coaMaps, fsBilling);
await backfillTransfers();
await backfillCheques(coaMaps, fsCheques, fsBanks);
await backfillPurchaseInvoices(coaMaps);

const totalTx = await prisma.transaction.count({ where: { isDeleted: false } });
console.log(`\n=== Summary ===`);
console.log(`Created: ${report.created.length}`);
console.log(`Skipped: ${report.skipped.length}`);
console.log(`Errors:  ${report.errors.length}`);
console.log(`Postgres GL transactions now: ${totalTx}`);

await prisma.$disconnect();

if (report.errors.length > 0) process.exitCode = 1;
