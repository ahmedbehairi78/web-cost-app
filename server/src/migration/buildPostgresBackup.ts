import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';
import { POSTGRES_BACKUP_COLLECTIONS } from './backupCollections.js';
import type { FirestoreBackupFile, FirestoreDoc } from './parseFirestoreBackup.js';

function mapRows(rows: unknown[]): FirestoreDoc[] {
  return (serialize(rows) as Record<string, unknown>[]).map((row) => ({
    _id: String(row.id ?? ''),
    ...row,
  }));
}

type PurchaseWithItems = Awaited<
  ReturnType<typeof prisma.purchaseTransaction.findMany<{ include: { items: true } }>>
>[number];

type CustodyWithItems = Awaited<
  ReturnType<typeof prisma.custodySettlement.findMany<{ include: { items: true } }>>
>[number];

function mapPurchaseTransactions(rows: PurchaseWithItems[]): FirestoreDoc[] {
  return rows.map((row) => {
    const base = serialize(row) as Record<string, unknown>;
    const { items: _items, ...rest } = base;
    const invoiceLines = row.items.flatMap((item) => {
      const payload = item.payload;
      return Array.isArray(payload) ? payload : [payload];
    });
    return {
      _id: row.id,
      ...rest,
      invoiceLines,
      items: invoiceLines,
    };
  });
}

function mapCustodySettlements(rows: CustodyWithItems[]): FirestoreDoc[] {
  return rows.map((row) => {
    const base = serialize(row) as Record<string, unknown>;
    const { items: _items, ...rest } = base;
    const settlementItems = row.items.flatMap((item) => {
      const payload = item.payload;
      return Array.isArray(payload) ? payload : [payload];
    });
    return {
      _id: row.id,
      ...rest,
      items: settlementItems,
    };
  });
}

function mapSettingsRows(rows: Awaited<ReturnType<typeof prisma.setting.findMany>>) {
  return rows.map((row) => ({
    _id: row.key,
    key: row.key,
    ...(serialize(row.value) as object),
    updatedAt: serialize(row.updatedAt),
  }));
}

/** Full Postgres snapshot in Firestore-backup-compatible shape (for export / push-to-production). */
export async function buildPostgresBackup(): Promise<
  FirestoreBackupFile & { source: 'postgres'; collectionNames: readonly string[] }
> {
  const [
    projects,
    contracts,
    costCenters,
    boqItems,
    variationOrders,
    variationOrderLines,
    documentRegistry,
    billing,
    billingItems,
    suppliers,
    chartOfAccounts,
    transactions,
    journalEntries,
    purchaseTransactions,
    purchaseTransactionItems,
    custodySettlements,
    custodySettlementItems,
    purchaseRequests,
    materialGroups,
    materialCategories,
    boqItemMaterials,
    purchaseInvoices,
    purchaseInvoiceLines,
    purchaseInvoiceAllocations,
    projectInventory,
    projectInventoryMovements,
    warehouseReceipts,
    warehouseReceiptLines,
    consumptionOrders,
    consumptionOrderLines,
    consumptionAllocationTemplates,
    returnOrders,
    returnOrderLines,
    projectInventoryTransfers,
    projectInventoryTransferLines,
    boqActualCosts,
    contractExpenseOrders,
    contractExpenseOrderLines,
    overheadAllocationPeriods,
    overheadAllocationLines,
    accountingPeriodLocks,
    fiscalPeriodClosings,
    contractInventory,
    inventoryTransfers,
    inventoryTransferLines,
    inventoryConsumption,
    subcontractors,
    subcontractAssignments,
    subcontractExtracts,
    materialOnSiteExtracts,
    mosCertificates,
    mosCertificateLines,
    fixedAssetGroups,
    fixedAssets,
    fixedAssetDepreciationEntries,
    payrollEmployees,
    payrollRuns,
    payrollRunLines,
    employeeCostCenterAllocations,
    payrollRunLineAllocations,
    employeeNotificationOutbox,
    attendanceRules,
    attendanceImports,
    attendanceImportLines,
    leaveTypes,
    officialHolidays,
    employeeLeaveBalances,
    bankAccounts,
    bankMovements,
    bankCheques,
    bankStatements,
    bankStatementLines,
    users,
    settingsRows,
    auditLog,
    notificationOutbox,
    approvalLinkTokens,
    userNotificationReads,
  ] = await Promise.all([
    prisma.project.findMany(),
    prisma.contract.findMany(),
    prisma.costCenter.findMany(),
    prisma.boqItem.findMany(),
    prisma.variationOrder.findMany(),
    prisma.variationOrderLine.findMany(),
    prisma.documentRegistry.findMany(),
    prisma.billing.findMany({ include: { items: true } }),
    prisma.billingItem.findMany(),
    prisma.supplier.findMany(),
    prisma.chartOfAccount.findMany(),
    prisma.transaction.findMany({ include: { entries: { orderBy: { lineNo: 'asc' } } } }),
    prisma.journalEntry.findMany({ orderBy: [{ transactionId: 'asc' }, { lineNo: 'asc' }] }),
    prisma.purchaseTransaction.findMany({ include: { items: true } }),
    prisma.purchaseTransactionItem.findMany(),
    prisma.custodySettlement.findMany({ include: { items: true } }),
    prisma.custodySettlementItem.findMany(),
    prisma.purchaseRequest.findMany(),
    prisma.materialGroup.findMany(),
    prisma.materialCategory.findMany(),
    prisma.boqItemMaterial.findMany(),
    prisma.purchaseInvoice.findMany(),
    prisma.purchaseInvoiceLine.findMany(),
    prisma.purchaseInvoiceAllocation.findMany(),
    prisma.projectInventory.findMany(),
    prisma.projectInventoryMovement.findMany(),
    prisma.warehouseReceipt.findMany(),
    prisma.warehouseReceiptLine.findMany(),
    prisma.consumptionOrder.findMany(),
    prisma.consumptionOrderLine.findMany(),
    prisma.consumptionAllocationTemplate.findMany(),
    prisma.returnOrder.findMany(),
    prisma.returnOrderLine.findMany(),
    prisma.projectInventoryTransfer.findMany(),
    prisma.projectInventoryTransferLine.findMany(),
    prisma.boqActualCost.findMany(),
    prisma.contractExpenseOrder.findMany(),
    prisma.contractExpenseOrderLine.findMany(),
    prisma.overheadAllocationPeriod.findMany(),
    prisma.overheadAllocationLine.findMany(),
    prisma.accountingPeriodLock.findMany(),
    prisma.fiscalPeriodClosing.findMany(),
    prisma.contractInventory.findMany(),
    prisma.inventoryTransfer.findMany(),
    prisma.inventoryTransferLine.findMany(),
    prisma.inventoryConsumption.findMany(),
    prisma.subcontractor.findMany(),
    prisma.subcontractAssignment.findMany(),
    prisma.subcontractExtract.findMany(),
    prisma.materialOnSiteExtract.findMany(),
    prisma.mosCertificate.findMany(),
    prisma.mosCertificateLine.findMany(),
    prisma.fixedAssetGroup.findMany(),
    prisma.fixedAsset.findMany(),
    prisma.fixedAssetDepreciationEntry.findMany(),
    prisma.payrollEmployee.findMany(),
    prisma.payrollRun.findMany(),
    prisma.payrollRunLine.findMany(),
    prisma.employeeCostCenterAllocation.findMany(),
    prisma.payrollRunLineAllocation.findMany(),
    prisma.employeeNotificationOutbox.findMany(),
    prisma.attendanceRule.findMany(),
    prisma.attendanceImport.findMany(),
    prisma.attendanceImportLine.findMany(),
    prisma.leaveType.findMany(),
    prisma.officialHoliday.findMany(),
    prisma.employeeLeaveBalance.findMany(),
    prisma.bankAccount.findMany(),
    prisma.bankMovement.findMany(),
    prisma.bankCheque.findMany(),
    prisma.bankStatement.findMany(),
    prisma.bankStatementLine.findMany(),
    prisma.user.findMany({
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        permissions: true,
        assignedContractIds: true,
        phoneE164: true,
        whatsappOptIn: true,
        preferredLanguage: true,
        whatsappNotifyTypes: true,
        isActive: true,
        passwordHash: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.setting.findMany(),
    prisma.auditLog.findMany(),
    prisma.notificationOutbox.findMany(),
    prisma.approvalLinkToken.findMany(),
    prisma.userNotificationRead.findMany(),
  ]);

  const collections: Record<string, FirestoreDoc[]> = {
    projects: mapRows(projects),
    contracts: mapRows(contracts),
    cost_centers: mapRows(costCenters),
    boq_items: mapRows(boqItems),
    variation_orders: mapRows(variationOrders),
    variation_order_lines: mapRows(variationOrderLines),
    document_registry: mapRows(documentRegistry),
    billing: mapRows(billing),
    billing_items: mapRows(billingItems),
    suppliers: mapRows(suppliers),
    chart_of_accounts: mapRows(chartOfAccounts),
    transactions: mapRows(transactions),
    journal_entries: mapRows(journalEntries),
    purchase_transactions: mapPurchaseTransactions(purchaseTransactions),
    purchase_transaction_items: mapRows(purchaseTransactionItems),
    custody_settlements: mapCustodySettlements(custodySettlements),
    custody_settlement_items: mapRows(custodySettlementItems),
    purchase_requests: mapRows(purchaseRequests),
    material_groups: mapRows(materialGroups),
    material_categories: mapRows(materialCategories),
    boq_item_materials: mapRows(boqItemMaterials),
    purchase_invoices: mapRows(purchaseInvoices),
    purchase_invoice_lines: mapRows(purchaseInvoiceLines),
    purchase_invoice_allocations: mapRows(purchaseInvoiceAllocations),
    project_inventory: mapRows(projectInventory),
    project_inventory_movements: mapRows(projectInventoryMovements),
    warehouse_receipts: mapRows(warehouseReceipts),
    warehouse_receipt_lines: mapRows(warehouseReceiptLines),
    consumption_orders: mapRows(consumptionOrders),
    consumption_order_lines: mapRows(consumptionOrderLines),
    consumption_allocation_templates: mapRows(consumptionAllocationTemplates),
    return_orders: mapRows(returnOrders),
    return_order_lines: mapRows(returnOrderLines),
    project_inventory_transfers: mapRows(projectInventoryTransfers),
    project_inventory_transfer_lines: mapRows(projectInventoryTransferLines),
    boq_actual_costs: mapRows(boqActualCosts),
    contract_expense_orders: mapRows(contractExpenseOrders),
    contract_expense_order_lines: mapRows(contractExpenseOrderLines),
    overhead_allocation_periods: mapRows(overheadAllocationPeriods),
    overhead_allocation_lines: mapRows(overheadAllocationLines),
    accounting_period_locks: mapRows(accountingPeriodLocks),
    fiscal_period_closings: mapRows(fiscalPeriodClosings),
    contract_inventory: mapRows(contractInventory),
    inventory_transfers: mapRows(inventoryTransfers),
    inventory_transfer_lines: mapRows(inventoryTransferLines),
    inventory_consumption: mapRows(inventoryConsumption),
    subcontractors: mapRows(subcontractors),
    subcontract_assignments: mapRows(subcontractAssignments),
    subcontract_extracts: mapRows(subcontractExtracts),
    material_on_site_extracts: mapRows(materialOnSiteExtracts),
    mos_certificates: mapRows(mosCertificates),
    mos_certificate_lines: mapRows(mosCertificateLines),
    fixed_asset_groups: mapRows(fixedAssetGroups),
    fixed_assets: mapRows(fixedAssets),
    fixed_asset_depreciation_entries: mapRows(fixedAssetDepreciationEntries),
    payroll_employees: mapRows(payrollEmployees),
    payroll_runs: mapRows(payrollRuns),
    payroll_run_lines: mapRows(payrollRunLines),
    employee_cost_center_allocations: mapRows(employeeCostCenterAllocations),
    payroll_run_line_allocations: mapRows(payrollRunLineAllocations),
    employee_notification_outbox: mapRows(employeeNotificationOutbox),
    attendance_rules: mapRows(attendanceRules),
    attendance_imports: mapRows(attendanceImports),
    attendance_import_lines: mapRows(attendanceImportLines),
    leave_types: mapRows(leaveTypes),
    official_holidays: mapRows(officialHolidays),
    employee_leave_balances: mapRows(employeeLeaveBalances),
    bank_accounts: mapRows(bankAccounts),
    bank_movements: mapRows(bankMovements),
    bank_cheques: mapRows(bankCheques),
    bank_statements: mapRows(bankStatements),
    bank_statement_lines: mapRows(bankStatementLines),
    users: mapRows(users),
    settings: mapSettingsRows(settingsRows),
    audit_log: mapRows(auditLog),
    notification_outbox: mapRows(notificationOutbox),
    approval_link_tokens: mapRows(approvalLinkTokens),
    user_notification_reads: mapRows(userNotificationReads),
  };

  for (const name of POSTGRES_BACKUP_COLLECTIONS) {
    if (!(name in collections)) {
      throw new Error(`Postgres backup is missing collection "${name}"`);
    }
  }

  return {
    exportedAt: new Date().toISOString(),
    version: 3,
    source: 'postgres',
    collectionNames: POSTGRES_BACKUP_COLLECTIONS,
    collections,
  };
}
