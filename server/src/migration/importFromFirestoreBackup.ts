import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../db.js';
import { normalizeAccountCode } from './accountCodeMap.js';
import { collection, type FirestoreBackupFile, type FirestoreDoc, usesNormalizedChildTables } from './parseFirestoreBackup.js';
import { boqRateFieldsFromSource } from './boqRateFields.js';
import { isUniqueViolation } from './helpers.js';

export type ImportCounts = Record<string, number>;

export type ImportReport = {
  source: string;
  counts: ImportCounts;
  skipped: Record<string, number>;
  gl: {
    transactions: number;
    balanced: number;
    unbalanced: number;
    unbalancedIds: string[];
  };
};

function dec(n: unknown): Prisma.Decimal {
  const v = Number(n ?? 0);
  return new Prisma.Decimal(Number.isFinite(v) ? v : 0);
}

function num(n: unknown): number {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? v : 0;
}

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function nullIfEmpty(v: unknown): string | null {
  const s = str(v);
  return s || null;
}

function bool(v: unknown, fallback = false): boolean {
  return v === true || v === 'true' || (fallback && v !== false);
}

export type ImportOptions = {
  targetDb?: PrismaClient;
  skipCollections?: readonly string[];
};

export async function importFirestoreBackupToPostgres(
  backup: FirestoreBackupFile,
  sourceLabel: string,
  options?: ImportOptions,
): Promise<ImportReport> {
  const db = options?.targetDb ?? prisma;
  const skipColl = new Set(options?.skipCollections ?? []);
  const counts: ImportCounts = {};
  const skipped: Record<string, number> = {};
  const unbalancedIds: string[] = [];

  const bump = (key: string, n = 1) => {
    counts[key] = (counts[key] ?? 0) + n;
  };
  const skip = (key: string, n = 1) => {
    skipped[key] = (skipped[key] ?? 0) + n;
  };
  const shouldImport = (name: string) => !skipColl.has(name);
  const normalizedChildren = usesNormalizedChildTables(backup);

  // ── 1) projects ─────────────────────────────────────────────────────────────
  if (shouldImport('projects')) {
  for (const doc of collection(backup, 'projects')) {
    const id = str(doc._id);
    if (!id) continue;
    const projectCode = str(doc.projectCode) || id;
    const updateData = {
      projectName: str(doc.projectName) || str(doc.name) || 'Unnamed Project',
      projectNameEn: nullIfEmpty(doc.projectNameEn),
      clientName: str(doc.clientName) || '—',
      clientNameEn: nullIfEmpty(doc.clientNameEn),
      status: str(doc.status) || 'active',
      boqValue: dec(doc.boqValue),
      voValue: dec(doc.voValue),
      budget: dec(doc.budget ?? doc.boqValue),
      isDeleted: bool(doc.isDeleted),
      inventoryAccountCode: nullIfEmpty(doc.inventoryAccountCode),
    };
    try {
      const byId = await db.project.findUnique({ where: { id } });
      if (byId) {
        await db.project.update({ where: { id }, data: updateData });
        bump('projects');
        continue;
      }
      const byCode = await db.project.findUnique({ where: { projectCode } });
      if (byCode) {
        await db.project.update({ where: { id: byCode.id }, data: updateData });
        bump('projects');
        continue;
      }
      await db.project.create({
        data: { id, projectCode, ...updateData },
      });
      bump('projects');
    } catch (e) {
      if (isUniqueViolation(e)) skip('projects_unique');
      else throw e;
    }
  }
  }

  // ── 2) contracts ────────────────────────────────────────────────────────────
  if (shouldImport('contracts')) {
  for (const doc of collection(backup, 'contracts')) {
    const id = str(doc._id);
    const projectId = str(doc.projectId);
    if (!id || !projectId) {
      skip('contracts_no_project');
      continue;
    }
    try {
      await db.contract.upsert({
        where: { id },
        create: {
          id,
          projectId,
          contractName: str(doc.contractName) || str(doc.name) || 'Unnamed Contract',
          contractNameEn: nullIfEmpty(doc.contractNameEn),
          contractNumber: str(doc.contractNumber) || id,
          contractValue: dec(doc.contractValue),
          startDate: nullIfEmpty(doc.startDate),
          endDate: nullIfEmpty(doc.endDate),
          isDeleted: bool(doc.isDeleted),
        },
        update: {
          contractName: str(doc.contractName) || str(doc.name) || 'Unnamed Contract',
          isDeleted: bool(doc.isDeleted),
        },
      });
      bump('contracts');
    } catch (e) {
      if (isUniqueViolation(e)) skip('contracts_unique');
      else throw e;
    }
  }
  }

  // ── 2b) cost centers (direct + indirect) ────────────────────────────────────
  if (shouldImport('cost_centers')) {
  for (const doc of collection(backup, 'cost_centers')) {
    const id = str(doc._id);
    const code = str(doc.code);
    if (!id || !code) {
      skip('cost_centers_no_code');
      continue;
    }
    const updateData = {
      name: str(doc.name) || code,
      nameEn: nullIfEmpty(doc.nameEn),
      type: str(doc.type) || 'indirect',
      contractId: nullIfEmpty(doc.contractId),
      isActive: doc.isActive !== false,
      isDeleted: bool(doc.isDeleted),
    };
    try {
      const byId = await db.costCenter.findUnique({ where: { id } });
      if (byId) {
        await db.costCenter.update({ where: { id }, data: updateData });
        bump('cost_centers');
        continue;
      }
      const byCode = await db.costCenter.findUnique({ where: { code } });
      if (byCode) {
        await db.costCenter.update({ where: { id: byCode.id }, data: updateData });
        bump('cost_centers');
        continue;
      }
      await db.costCenter.create({ data: { id, code, ...updateData } });
      bump('cost_centers');
    } catch (e) {
      if (isUniqueViolation(e)) skip('cost_centers_unique');
      else throw e;
    }
  }
  }

  // ── 3) suppliers ────────────────────────────────────────────────────────────
  if (shouldImport('suppliers')) {
  for (const doc of collection(backup, 'suppliers')) {
    const id = doc._id;
    if (!id) continue;
    await db.supplier.upsert({
      where: { id },
      create: {
        id,
        name: str(doc.name) || str(doc.supplierName) || id,
        nameEn: nullIfEmpty(doc.nameEn),
        type: str(doc.type) || 'supplier',
        taxNumber: nullIfEmpty(doc.taxNumber),
        phone: nullIfEmpty(doc.phone),
        address: nullIfEmpty(doc.address),
        isDeleted: bool(doc.isDeleted),
      },
      update: {},
    });
    bump('suppliers');
  }
  }

  // ── 4) chart of accounts ────────────────────────────────────────────────────
  if (shouldImport('chart_of_accounts')) {
  for (const doc of collection(backup, 'chart_of_accounts')) {
    const id = str(doc._id);
    const accountCode = normalizeAccountCode(doc.accountCode);
    if (!id || !accountCode) continue;
    const accountData = {
      accountName: str(doc.accountName) || str(doc.name) || accountCode,
      accountNameEn: nullIfEmpty(doc.accountNameEn),
      parentCode: normalizeAccountCode(doc.parentCode || ''),
      type: str(doc.type) || 'asset',
      isGroup: doc.isGroup === true,
      statementType: nullIfEmpty(doc.statementType),
      status: str(doc.status) || 'active',
      supplierId: nullIfEmpty(doc.supplierId),
      projectId: nullIfEmpty(doc.projectId),
    };
    try {
      const byCode = await db.chartOfAccount.findUnique({ where: { accountCode } });
      const byId = await db.chartOfAccount.findUnique({ where: { id } });
      const target = byCode ?? byId;
      if (target) {
        await db.chartOfAccount.update({ where: { id: target.id }, data: accountData });
      } else {
        await db.chartOfAccount.create({ data: { id, accountCode, ...accountData } });
      }
      bump('chart_of_accounts');
    } catch (e) {
      if (isUniqueViolation(e)) skip('chart_of_accounts_unique');
      else throw e;
    }
  }
  }

  // ── 5) boq items ────────────────────────────────────────────────────────────
  if (shouldImport('boq_items')) {
  for (const doc of collection(backup, 'boq_items')) {
    const id = doc._id;
    const projectId = str(doc.projectId);
    if (!id || !projectId) {
      skip('boq_items_no_project');
      continue;
    }
    const rates = boqRateFieldsFromSource(doc);
    await db.boqItem.upsert({
      where: { id },
      create: {
        id,
        projectId,
        contractId: nullIfEmpty(doc.contractId),
        chapterCode: nullIfEmpty(doc.chapterCode),
        chapterName: nullIfEmpty(doc.chapterName),
        workTypeCode: nullIfEmpty(doc.workTypeCode),
        sectionCode: nullIfEmpty(doc.sectionCode),
        sectionName: nullIfEmpty(doc.sectionName),
        itemCode: str(doc.itemCode) || id,
        description: str(doc.description) || '—',
        unit: str(doc.unit) || 'EA',
        tenderQty: dec(doc.tenderQty),
        rateMaterials: dec(rates.rateMaterials),
        rateLabour: dec(rates.rateLabour),
        rateEquipment: dec(rates.rateEquipment),
        rateDirect: dec(rates.rateDirect),
        rateOverheadPct: dec(rates.rateOverheadPct),
        rateProfitPct: dec(rates.rateProfitPct),
        unitRateTotal: dec(doc.unitRateTotal),
        tenderAmount: dec(doc.tenderAmount),
        expectedDuration: doc.expectedDuration != null ? Number(doc.expectedDuration) : null,
        startDate: nullIfEmpty(doc.startDate),
        isDeleted: bool(doc.isDeleted),
      },
      update: {
        isDeleted: bool(doc.isDeleted),
        tenderAmount: dec(doc.tenderAmount),
        unitRateTotal: dec(doc.unitRateTotal),
        rateMaterials: dec(rates.rateMaterials),
        rateLabour: dec(rates.rateLabour),
        rateEquipment: dec(rates.rateEquipment),
        rateDirect: dec(rates.rateDirect),
        rateOverheadPct: dec(rates.rateOverheadPct),
        rateProfitPct: dec(rates.rateProfitPct),
      },
    });
    bump('boq_items');
  }
  }

  // ── 6) GL transactions (before billing / purchases that reference them) ─────
  let balanced = 0;
  let unbalanced = 0;
  if (shouldImport('transactions')) {
  for (const doc of collection(backup, 'transactions')) {
    const id = doc._id;
    if (!id) continue;
    const rawEntries = Array.isArray(doc.entries) ? doc.entries : [];
    const entries = rawEntries.map((entry, index) => {
      const row = entry as Record<string, unknown>;
      return {
        lineNo: index + 1,
        accountCode: normalizeAccountCode(row.accountCode),
        accountName: nullIfEmpty(row.accountName),
        debit: dec(row.debit),
        credit: dec(row.credit),
        costCenterId: nullIfEmpty(row.costCenterId),
      };
    });
    const debit = entries.reduce((s, e) => s + num(e.debit), 0);
    const credit = entries.reduce((s, e) => s + num(e.credit), 0);
    if (Math.abs(debit - credit) > 0.005) {
      unbalanced++;
      unbalancedIds.push(id);
      skip('transactions_unbalanced');
      continue;
    }
    balanced++;
    const headerData = {
      date: str(doc.date) || '2000-01-01',
      description: str(doc.description),
      reference: nullIfEmpty(doc.reference),
      projectId: nullIfEmpty(doc.projectId),
      costCenterId: nullIfEmpty(doc.costCenterId),
      createdBy: nullIfEmpty(doc.createdBy),
      reversesReference: nullIfEmpty(doc.reversesReference),
      undoesReversalReference: nullIfEmpty(doc.undoesReversalReference),
      isDeleted: bool(doc.isDeleted),
    };
    if (normalizedChildren) {
      await db.transaction.upsert({
        where: { id },
        create: { id, ...headerData },
        update: headerData,
      });
    } else {
      await db.transaction.upsert({
        where: { id },
        create: {
          id,
          ...headerData,
          entries: { create: entries },
        },
        update: {
          isDeleted: bool(doc.isDeleted),
        },
      });
    }
    bump('transactions');
    if (!normalizedChildren) {
      bump('journal_entries', entries.length);
    }
  }
  }

  // ── 7) billing + items ──────────────────────────────────────────────────────
  if (shouldImport('billing')) {
  for (const doc of collection(backup, 'billing')) {
    const id = doc._id;
    const projectId = str(doc.projectId);
    const contractId = str(doc.contractId);
    if (!id || !projectId || !contractId) {
      skip('billing_missing_refs');
      continue;
    }
    let resolvedTxId: string | null = null;
    const txId = nullIfEmpty(doc.transactionId);
    if (txId) {
      const tx = await db.transaction.findUnique({ where: { id: txId }, select: { id: true } });
      if (tx) resolvedTxId = txId;
      else skip('billing_missing_transaction');
    }
    await db.billing.upsert({
      where: { id },
      create: {
        id,
        projectId,
        contractId,
        billingNumber: str(doc.billingNumber) || id,
        date: str(doc.date) || '2000-01-01',
        worksValueExVat: dec(doc.worksValueExVat),
        vatAmount: dec(doc.vatAmount),
        execGuaranteeAmount: dec(doc.execGuaranteeAmount),
        whtAmount: dec(doc.whtAmount),
        labourInsuranceAmount: dec(doc.labourInsuranceAmount),
        manpowerLevyAmount: dec(doc.manpowerLevyAmount),
        advancePaymentRecovery: dec(doc.advancePaymentRecovery),
        netPayable: dec(doc.netPayable),
        status: str(doc.status) || 'draft',
        transactionId: resolvedTxId,
        isDeleted: bool(doc.isDeleted),
      },
      update: {
        status: str(doc.status) || 'draft',
        isDeleted: bool(doc.isDeleted),
      },
    });
    bump('billing');

    if (!normalizedChildren) {
      await db.billingItem.deleteMany({ where: { billingId: id } });
      const items = Array.isArray(doc.items) ? doc.items : [];
      for (const item of items) {
        const row = item as Record<string, unknown>;
        await db.billingItem.create({
          data: {
            id: randomUUID(),
            billingId: id,
            boqItemId: nullIfEmpty(row.boqItemId),
            itemCode: str(row.itemCode) || '—',
            description: str(row.description) || '—',
            unit: str(row.unit) || 'EA',
            rate: dec(row.rate),
            previousQty: dec(row.previousQty),
            currentQty: dec(row.currentQty),
            totalQty: dec(row.totalQty),
            amount: dec(row.amount),
            metadata: row as Prisma.InputJsonValue,
          },
        });
        bump('billing_items');
      }
    }
  }
  }

  // ── 8) purchase transactions ────────────────────────────────────────────────
  if (shouldImport('purchase_transactions')) {
  for (const doc of collection(backup, 'purchase_transactions')) {
    const id = doc._id;
    if (!id) continue;
    const supplierId = nullIfEmpty(doc.supplierId);
    if (supplierId) {
      const sup = await db.supplier.findUnique({ where: { id: supplierId }, select: { id: true } });
      if (!sup) skip('purchase_missing_supplier');
    }
    let resolvedTxId: string | null = null;
    const txId = nullIfEmpty(doc.transactionId);
    if (txId) {
      const tx = await db.transaction.findUnique({ where: { id: txId }, select: { id: true } });
      if (tx) resolvedTxId = txId;
      else skip('purchase_missing_transaction');
    }
    await db.purchaseTransaction.upsert({
      where: { id },
      create: {
        id,
        type: str(doc.type) || 'invoice',
        supplierId,
        supplierAccountId: nullIfEmpty(doc.supplierAccountId),
        supplierName: str(doc.supplierName) || '—',
        projectId: nullIfEmpty(doc.projectId),
        contractId: nullIfEmpty(doc.contractId),
        expenseAccountId: nullIfEmpty(doc.expenseAccountId),
        expenseAccountName: nullIfEmpty(doc.expenseAccountName),
        date: str(doc.date) || '2000-01-01',
        referenceNumber: nullIfEmpty(doc.referenceNumber),
        amount: dec(doc.amount),
        vatAmount: dec(doc.vatAmount),
        whtAmount: dec(doc.whtAmount),
        execGuaranteeAmount: dec(doc.execGuaranteeAmount),
        labourInsuranceAmount: dec(doc.labourInsuranceAmount),
        manpowerLevyAmount: dec(doc.manpowerLevyAmount),
        advancePaymentRecovery: dec(doc.advancePaymentRecovery),
        totalAmount: dec(doc.totalAmount),
        description: nullIfEmpty(doc.description),
        status: str(doc.status) || 'pending',
        transactionId: resolvedTxId,
        isDeleted: bool(doc.isDeleted),
      },
      update: {
        isDeleted: bool(doc.isDeleted),
        status: str(doc.status) || 'pending',
      },
    });
    bump('purchase_transactions');

    if (!normalizedChildren) {
      await db.purchaseTransactionItem.deleteMany({ where: { purchaseTransactionId: id } });
      const lineSource =
        (Array.isArray(doc.invoiceLines) && doc.invoiceLines) ||
        (Array.isArray(doc.items) && doc.items) ||
        (Array.isArray(doc.distributedLines) && doc.distributedLines) ||
        [];
      if (lineSource.length > 0) {
        await db.purchaseTransactionItem.create({
          data: {
            id: randomUUID(),
            purchaseTransactionId: id,
            payload: lineSource as Prisma.InputJsonValue,
          },
        });
        bump('purchase_transaction_items');
      }
    }
  }
  }

  if (shouldImport('bank_accounts') || shouldImport('bank_movements') || shouldImport('bank_cheques') || shouldImport('bank_statements')) {
    await importBanksFromFirestoreDocs(backup, bump, skip, db);
  }

  return {
    source: sourceLabel,
    counts,
    skipped,
    gl: {
      transactions: balanced + unbalanced,
      balanced,
      unbalanced,
      unbalancedIds,
    },
  };
}

type BumpFn = (key: string, n?: number) => void;
type SkipFn = (key: string, n?: number) => void;

/** Import bank_accounts / movements / cheques / statements from a Firestore backup slice. */
export async function importBanksFromFirestoreDocs(
  backup: FirestoreBackupFile,
  bump: BumpFn,
  skip: SkipFn,
  db: PrismaClient = prisma,
): Promise<void> {
  const bankAccountIds = new Set<string>();

  for (const doc of collection(backup, 'bank_accounts')) {
    const id = doc._id;
    if (!id) continue;
    const code = str(doc.code);
    if (!code) {
      skip('bank_accounts_no_code');
      continue;
    }
    await db.bankAccount.upsert({
      where: { id },
      create: {
        id,
        coaAccountId: nullIfEmpty(doc.coaAccountId),
        code,
        nameAr: str(doc.nameAr) || str(doc.name) || code,
        nameEn: nullIfEmpty(doc.nameEn),
        accountNumber: nullIfEmpty(doc.accountNumber),
        iban: nullIfEmpty(doc.iban),
        currency: str(doc.currency) || 'EGP',
        openingBalance: dec(doc.openingBalance),
        isActive: doc.isActive !== false,
      },
      update: {
        coaAccountId: nullIfEmpty(doc.coaAccountId),
        code,
        nameAr: str(doc.nameAr) || str(doc.name) || code,
        nameEn: nullIfEmpty(doc.nameEn),
        accountNumber: nullIfEmpty(doc.accountNumber),
        iban: nullIfEmpty(doc.iban),
        currency: str(doc.currency) || 'EGP',
        openingBalance: dec(doc.openingBalance),
        isActive: doc.isActive !== false,
      },
    });
    bankAccountIds.add(id);
    bump('bank_accounts');
  }

  for (const doc of collection(backup, 'bank_movements')) {
    const id = doc._id;
    const bankAccountId = str(doc.bankAccountId);
    if (!id || !bankAccountId) {
      skip('bank_movements_missing_refs');
      continue;
    }
    if (!bankAccountIds.has(bankAccountId)) {
      skip('bank_movements_missing_account');
      continue;
    }
    await db.bankMovement.upsert({
      where: { id },
      create: {
        id,
        documentNo: str(doc.documentNo),
        bankAccountId,
        movementType: str(doc.movementType) || 'deposit',
        amount: dec(doc.amount),
        date: str(doc.date) || '2000-01-01',
        currency: nullIfEmpty(doc.currency),
        reference: nullIfEmpty(doc.reference),
        note: nullIfEmpty(doc.note),
        descriptionAr: nullIfEmpty(doc.descriptionAr),
        descriptionEn: nullIfEmpty(doc.descriptionEn),
        projectId: nullIfEmpty(doc.projectId),
        contractId: nullIfEmpty(doc.contractId),
        offsetChartOfAccountId: nullIfEmpty(doc.offsetChartOfAccountId),
        offsetAccountCode: nullIfEmpty(doc.offsetAccountCode),
        offsetAccountName: nullIfEmpty(doc.offsetAccountName),
        toBankAccountId: nullIfEmpty(doc.toBankAccountId),
        adjustmentDirection: nullIfEmpty(doc.adjustmentDirection),
        status: str(doc.status) || 'draft',
        glTransactionId: nullIfEmpty(doc.glTransactionId),
        postedGlReference: nullIfEmpty(doc.postedGlReference),
        reversalTransactionId: nullIfEmpty(doc.reversalTransactionId),
      },
      update: {
        status: str(doc.status) || 'draft',
        amount: dec(doc.amount),
        date: str(doc.date) || '2000-01-01',
      },
    });
    bump('bank_movements');
  }

  for (const doc of collection(backup, 'bank_cheques')) {
    const id = doc._id;
    const bankAccountId = str(doc.bankAccountId);
    if (!id || !bankAccountId) {
      skip('bank_cheques_missing_refs');
      continue;
    }
    if (!bankAccountIds.has(bankAccountId)) {
      skip('bank_cheques_missing_account');
      continue;
    }
    const receivedIssueCredits =
      Array.isArray(doc.receivedIssueCredits) && doc.receivedIssueCredits.length > 0
        ? (doc.receivedIssueCredits as Prisma.InputJsonValue)
        : undefined;
    await db.bankCheque.upsert({
      where: { id },
      create: {
        id,
        direction: str(doc.direction) || 'issued',
        bankAccountId,
        chequeNo: str(doc.chequeNo) || id,
        payeeName: nullIfEmpty(doc.payeeName),
        amount: dec(doc.amount),
        issueDate: str(doc.issueDate) || '2000-01-01',
        dueDate: nullIfEmpty(doc.dueDate),
        status: str(doc.status) || 'draft',
        offsetChartOfAccountId: nullIfEmpty(doc.offsetChartOfAccountId),
        projectId: nullIfEmpty(doc.projectId),
        contractId: nullIfEmpty(doc.contractId),
        receivedIssueCredits,
        glIssueTransactionId: nullIfEmpty(doc.glIssueTransactionId),
        glClearTransactionId: nullIfEmpty(doc.glClearTransactionId),
        glRejectTransactionId: nullIfEmpty(doc.glRejectTransactionId),
        postedIssueReference: nullIfEmpty(doc.postedIssueReference),
        postedClearReference: nullIfEmpty(doc.postedClearReference),
      },
      update: {
        status: str(doc.status) || 'draft',
        amount: dec(doc.amount),
      },
    });
    bump('bank_cheques');
  }

  const statementIds = new Set<string>();
  for (const doc of collection(backup, 'bank_statements')) {
    const id = doc._id;
    const bankAccountId = str(doc.bankAccountId);
    if (!id || !bankAccountId) {
      skip('bank_statements_missing_refs');
      continue;
    }
    if (!bankAccountIds.has(bankAccountId)) {
      skip('bank_statements_missing_account');
      continue;
    }
    await db.bankStatement.upsert({
      where: { id },
      create: {
        id,
        bankAccountId,
        periodStart: str(doc.periodStart) || '2000-01-01',
        periodEnd: str(doc.periodEnd) || '2000-01-01',
        openingBalance: dec(doc.openingBalance),
        closingBalance: doc.closingBalance != null ? dec(doc.closingBalance) : null,
        sourceLabel: nullIfEmpty(doc.sourceLabel),
      },
      update: {
        periodStart: str(doc.periodStart) || '2000-01-01',
        periodEnd: str(doc.periodEnd) || '2000-01-01',
        openingBalance: dec(doc.openingBalance),
        closingBalance: doc.closingBalance != null ? dec(doc.closingBalance) : null,
        sourceLabel: nullIfEmpty(doc.sourceLabel),
      },
    });
    statementIds.add(id);
    bump('bank_statements');
  }

  for (const doc of collection(backup, 'bank_statement_lines')) {
    const id = doc._id;
    const statementId = str(doc.statementId);
    if (!id || !statementId) {
      skip('bank_statement_lines_missing_refs');
      continue;
    }
    if (!statementIds.has(statementId)) {
      skip('bank_statement_lines_missing_statement');
      continue;
    }
    await db.bankStatementLine.upsert({
      where: { id },
      create: {
        id,
        statementId,
        lineDate: str(doc.lineDate) || '2000-01-01',
        reference: nullIfEmpty(doc.reference),
        description: nullIfEmpty(doc.description),
        debit: dec(doc.debit),
        credit: dec(doc.credit),
        matchStatus: str(doc.matchStatus) || 'unmatched',
        matchedEntityType: nullIfEmpty(doc.matchedEntityType),
        matchedEntityId: nullIfEmpty(doc.matchedEntityId),
      },
      update: {
        lineDate: str(doc.lineDate) || '2000-01-01',
        debit: dec(doc.debit),
        credit: dec(doc.credit),
        matchStatus: str(doc.matchStatus) || 'unmatched',
        matchedEntityType: nullIfEmpty(doc.matchedEntityType),
        matchedEntityId: nullIfEmpty(doc.matchedEntityId),
      },
    });
    bump('bank_statement_lines');
  }
}

export async function printImportReport(report: ImportReport): Promise<void> {
  console.log('\n=== Firestore → Postgres import report ===');
  console.log(`Source: ${report.source}`);
  console.log('\nImported row counts:');
  for (const [k, v] of Object.entries(report.counts).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${k}: ${v}`);
  }
  if (Object.keys(report.skipped).length > 0) {
    console.log('\nSkipped:');
    for (const [k, v] of Object.entries(report.skipped)) {
      console.log(`  ${k}: ${v}`);
    }
  }
  console.log('\nGL balance check:');
  console.log(`  transactions scanned: ${report.gl.transactions}`);
  console.log(`  balanced imported:    ${report.gl.balanced}`);
  console.log(`  unbalanced skipped: ${report.gl.unbalanced}`);
  if (report.gl.unbalancedIds.length > 0) {
    console.log(`  unbalanced ids:     ${report.gl.unbalancedIds.slice(0, 5).join(', ')}${report.gl.unbalancedIds.length > 5 ? '…' : ''}`);
  }
}
