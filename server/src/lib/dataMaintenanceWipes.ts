import { prisma } from '../db.js';

export type PostgresWipeGroupId =
  | 'financial'
  | 'warehouse'
  | 'custody'
  | 'payroll'
  | 'fixed_assets'
  | 'materials_tree'
  | 'subcontractors'
  | 'mos_vo'
  | 'billing'
  | 'purchases'
  | 'ledger'
  | 'projects'
  | 'contracts_boq'
  | 'coa'
  | 'suppliers'
  | 'cost_centers_indirect';

export const POSTGRES_WIPE_GROUP_IDS: PostgresWipeGroupId[] = [
  'financial',
  'warehouse',
  'custody',
  'payroll',
  'fixed_assets',
  'materials_tree',
  'subcontractors',
  'mos_vo',
  'billing',
  'purchases',
  'ledger',
  'projects',
  'contracts_boq',
  'coa',
  'suppliers',
  'cost_centers_indirect',
];

function mergeDeleted(into: Record<string, number>, part: Record<string, number>) {
  for (const [k, v] of Object.entries(part)) {
    into[k] = (into[k] ?? 0) + v;
  }
}

/** GL · billing · purchases · banks (operational) · inventory movements · OHA · custody · IPC extracts · depreciation postings */
export async function wipeFinancialMovementsPostgres(): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};

  await prisma.$transaction(async (tx) => {
    deleted.custody_settlement_items = (await tx.custodySettlementItem.deleteMany()).count;
    deleted.custody_settlements = (await tx.custodySettlement.deleteMany()).count;

    deleted.mos_certificate_lines = (await tx.mosCertificateLine.deleteMany()).count;
    deleted.mos_certificates = (await tx.mosCertificate.deleteMany()).count;
    deleted.material_on_site_extracts = (await tx.materialOnSiteExtract.deleteMany()).count;

    deleted.fixed_asset_depreciation_entries = (await tx.fixedAssetDepreciationEntry.deleteMany()).count;

    deleted.variation_order_lines = (await tx.variationOrderLine.deleteMany()).count;
    deleted.variation_orders = (await tx.variationOrder.deleteMany()).count;
    deleted.document_registry = (await tx.documentRegistry.deleteMany()).count;

    deleted.bank_statement_lines = (await tx.bankStatementLine.deleteMany()).count;
    deleted.bank_statements = (await tx.bankStatement.deleteMany()).count;
    deleted.bank_movements = (await tx.bankMovement.deleteMany()).count;
    deleted.bank_cheques = (await tx.bankCheque.deleteMany()).count;

    deleted.boq_actual_costs = (await tx.boqActualCost.deleteMany()).count;
    deleted.overhead_allocation_lines = (await tx.overheadAllocationLine.deleteMany()).count;
    deleted.overhead_allocation_periods = (await tx.overheadAllocationPeriod.deleteMany()).count;

    deleted.contract_expense_order_lines = (await tx.contractExpenseOrderLine.deleteMany()).count;
    deleted.contract_expense_orders = (await tx.contractExpenseOrder.deleteMany()).count;

    deleted.return_order_lines = (await tx.returnOrderLine.deleteMany()).count;
    deleted.return_orders = (await tx.returnOrder.deleteMany()).count;

    deleted.consumption_order_lines = (await tx.consumptionOrderLine.deleteMany()).count;
    deleted.consumption_orders = (await tx.consumptionOrder.deleteMany()).count;
    deleted.consumption_allocation_templates = (await tx.consumptionAllocationTemplate.deleteMany()).count;

    deleted.project_inventory_transfer_lines = (await tx.projectInventoryTransferLine.deleteMany()).count;
    deleted.project_inventory_transfers = (await tx.projectInventoryTransfer.deleteMany()).count;

    deleted.inventory_transfer_lines = (await tx.inventoryTransferLine.deleteMany()).count;
    deleted.inventory_transfers = (await tx.inventoryTransfer.deleteMany()).count;
    deleted.inventory_consumption = (await tx.inventoryConsumption.deleteMany()).count;

    deleted.project_inventory_movements = (await tx.projectInventoryMovement.deleteMany()).count;

    deleted.purchase_invoice_allocations = (await tx.purchaseInvoiceAllocation.deleteMany()).count;
    deleted.purchase_invoice_lines = (await tx.purchaseInvoiceLine.deleteMany()).count;
    deleted.purchase_invoices = (await tx.purchaseInvoice.deleteMany()).count;

    deleted.subcontract_extracts = (await tx.subcontractExtract.deleteMany()).count;

    deleted.billing_items = (await tx.billingItem.deleteMany()).count;
    deleted.billing = (await tx.billing.deleteMany()).count;

    deleted.purchase_transaction_items = (await tx.purchaseTransactionItem.deleteMany()).count;
    deleted.purchase_transactions = (await tx.purchaseTransaction.deleteMany()).count;

    deleted.fiscal_period_closings = (await tx.fiscalPeriodClosing.deleteMany()).count;
    deleted.accounting_period_locks = (await tx.accountingPeriodLock.deleteMany()).count;

    deleted.journal_entries = (await tx.journalEntry.deleteMany()).count;
    deleted.transactions = (await tx.transaction.deleteMany()).count;

    deleted.project_inventory = (await tx.projectInventory.deleteMany()).count;
    deleted.contract_inventory = (await tx.contractInventory.deleteMany()).count;
  });

  return deleted;
}

export async function wipeWarehousePostgres(): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  await prisma.$transaction(async (tx) => {
    deleted.return_order_lines = (await tx.returnOrderLine.deleteMany()).count;
    deleted.return_orders = (await tx.returnOrder.deleteMany()).count;
    deleted.boq_actual_costs = (await tx.boqActualCost.deleteMany()).count;
    deleted.consumption_order_lines = (await tx.consumptionOrderLine.deleteMany()).count;
    deleted.consumption_orders = (await tx.consumptionOrder.deleteMany()).count;
    deleted.consumption_allocation_templates = (await tx.consumptionAllocationTemplate.deleteMany()).count;
    deleted.inventory_transfer_lines = (await tx.inventoryTransferLine.deleteMany()).count;
    deleted.inventory_transfers = (await tx.inventoryTransfer.deleteMany()).count;
    deleted.project_inventory_transfer_lines = (await tx.projectInventoryTransferLine.deleteMany()).count;
    deleted.project_inventory_transfers = (await tx.projectInventoryTransfer.deleteMany()).count;
    deleted.project_inventory_movements = (await tx.projectInventoryMovement.deleteMany()).count;
    deleted.purchase_invoice_allocations = (await tx.purchaseInvoiceAllocation.deleteMany()).count;
    deleted.purchase_invoice_lines = (await tx.purchaseInvoiceLine.deleteMany()).count;
    deleted.purchase_invoices = (await tx.purchaseInvoice.deleteMany()).count;
    deleted.project_inventory = (await tx.projectInventory.deleteMany()).count;
    deleted.contract_inventory = (await tx.contractInventory.deleteMany()).count;
  });
  return deleted;
}

export async function wipeCustodyPostgres(): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  await prisma.$transaction(async (tx) => {
    deleted.custody_settlement_items = (await tx.custodySettlementItem.deleteMany()).count;
    deleted.custody_settlements = (await tx.custodySettlement.deleteMany()).count;
  });
  return deleted;
}

export async function wipePayrollPostgres(): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  await prisma.$transaction(async (tx) => {
    deleted.payroll_run_line_allocations = (await tx.payrollRunLineAllocation.deleteMany()).count;
    deleted.payroll_run_lines = (await tx.payrollRunLine.deleteMany()).count;
    deleted.payroll_runs = (await tx.payrollRun.deleteMany()).count;
    deleted.employee_cost_center_allocations = (await tx.employeeCostCenterAllocation.deleteMany()).count;
    deleted.employee_leave_balances = (await tx.employeeLeaveBalance.deleteMany()).count;
    deleted.attendance_import_lines = (await tx.attendanceImportLine.deleteMany()).count;
    deleted.attendance_imports = (await tx.attendanceImport.deleteMany()).count;
    deleted.employee_notification_outbox = (await tx.employeeNotificationOutbox.deleteMany()).count;
    deleted.payroll_employees = (await tx.payrollEmployee.deleteMany()).count;
    deleted.attendance_rules = (await tx.attendanceRule.deleteMany()).count;
    deleted.leave_types = (await tx.leaveType.deleteMany()).count;
    deleted.official_holidays = (await tx.officialHoliday.deleteMany()).count;
  });
  return deleted;
}

export async function wipeFixedAssetsPostgres(): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  await prisma.$transaction(async (tx) => {
    deleted.fixed_asset_depreciation_entries = (await tx.fixedAssetDepreciationEntry.deleteMany()).count;
    deleted.fixed_assets = (await tx.fixedAsset.deleteMany()).count;
    deleted.fixed_asset_groups = (await tx.fixedAssetGroup.deleteMany()).count;
  });
  return deleted;
}

export async function wipeMaterialsTreePostgres(): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  await prisma.$transaction(async (tx) => {
    deleted.boq_item_materials = (await tx.boqItemMaterial.deleteMany()).count;
    deleted.material_categories = (await tx.materialCategory.deleteMany()).count;
    deleted.material_groups = (await tx.materialGroup.deleteMany()).count;
  });
  return deleted;
}

export async function wipeSubcontractorsPostgres(): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  await prisma.$transaction(async (tx) => {
    deleted.subcontract_extracts = (await tx.subcontractExtract.deleteMany()).count;
    deleted.subcontract_assignments = (await tx.subcontractAssignment.deleteMany()).count;
    deleted.subcontractors = (await tx.subcontractor.deleteMany()).count;
  });
  return deleted;
}

export async function wipeMosVoPostgres(): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  await prisma.$transaction(async (tx) => {
    deleted.mos_certificate_lines = (await tx.mosCertificateLine.deleteMany()).count;
    deleted.mos_certificates = (await tx.mosCertificate.deleteMany()).count;
    deleted.material_on_site_extracts = (await tx.materialOnSiteExtract.deleteMany()).count;
    deleted.variation_order_lines = (await tx.variationOrderLine.deleteMany()).count;
    deleted.variation_orders = (await tx.variationOrder.deleteMany()).count;
    deleted.document_registry = (await tx.documentRegistry.deleteMany()).count;
  });
  return deleted;
}

export async function wipeBillingPostgres(): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  await prisma.$transaction(async (tx) => {
    deleted.billing_items = (await tx.billingItem.deleteMany()).count;
    deleted.billing = (await tx.billing.deleteMany()).count;
  });
  return deleted;
}

export async function wipePurchasesPostgres(): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  await prisma.$transaction(async (tx) => {
    deleted.purchase_transaction_items = (await tx.purchaseTransactionItem.deleteMany()).count;
    deleted.purchase_transactions = (await tx.purchaseTransaction.deleteMany()).count;
    deleted.purchase_invoice_allocations = (await tx.purchaseInvoiceAllocation.deleteMany()).count;
    deleted.purchase_invoice_lines = (await tx.purchaseInvoiceLine.deleteMany()).count;
    deleted.purchase_invoices = (await tx.purchaseInvoice.deleteMany()).count;
  });
  return deleted;
}

export async function wipeLedgerPostgres(): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  await prisma.$transaction(async (tx) => {
    deleted.bank_statement_lines = (await tx.bankStatementLine.deleteMany()).count;
    deleted.bank_statements = (await tx.bankStatement.deleteMany()).count;
    deleted.bank_movements = (await tx.bankMovement.deleteMany()).count;
    deleted.bank_cheques = (await tx.bankCheque.deleteMany()).count;
    deleted.fiscal_period_closings = (await tx.fiscalPeriodClosing.deleteMany()).count;
    deleted.accounting_period_locks = (await tx.accountingPeriodLock.deleteMany()).count;
    deleted.journal_entries = (await tx.journalEntry.deleteMany()).count;
    deleted.transactions = (await tx.transaction.deleteMany()).count;
  });
  return deleted;
}

export async function wipeProjectsPostgres(): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  await prisma.$transaction(async (tx) => {
    deleted.document_registry = (await tx.documentRegistry.deleteMany()).count;
    deleted.variation_order_lines = (await tx.variationOrderLine.deleteMany()).count;
    deleted.variation_orders = (await tx.variationOrder.deleteMany()).count;
    deleted.boq_item_materials = (await tx.boqItemMaterial.deleteMany()).count;
    deleted.boq_items = (await tx.boqItem.deleteMany()).count;
    deleted.contracts = (await tx.contract.deleteMany()).count;
    deleted.projects = (await tx.project.deleteMany()).count;
  });
  return deleted;
}

export async function wipeContractsBoqPostgres(): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  await prisma.$transaction(async (tx) => {
    deleted.boq_item_materials = (await tx.boqItemMaterial.deleteMany()).count;
    deleted.boq_items = (await tx.boqItem.deleteMany()).count;
    deleted.contracts = (await tx.contract.deleteMany()).count;
  });
  return deleted;
}

export async function wipeCoaPostgres(): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  deleted.chart_of_accounts = (await prisma.chartOfAccount.deleteMany()).count;
  return deleted;
}

export async function wipeSuppliersPostgres(): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  deleted.suppliers = (await prisma.supplier.deleteMany()).count;
  return deleted;
}

export async function wipeIndirectCostCentersPostgres(): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  deleted.cost_centers = (
    await prisma.costCenter.deleteMany({
      where: { type: 'indirect' },
    })
  ).count;
  return deleted;
}

const WIPE_HANDLERS: Record<PostgresWipeGroupId, () => Promise<Record<string, number>>> = {
  financial: wipeFinancialMovementsPostgres,
  warehouse: wipeWarehousePostgres,
  custody: wipeCustodyPostgres,
  payroll: wipePayrollPostgres,
  fixed_assets: wipeFixedAssetsPostgres,
  materials_tree: wipeMaterialsTreePostgres,
  subcontractors: wipeSubcontractorsPostgres,
  mos_vo: wipeMosVoPostgres,
  billing: wipeBillingPostgres,
  purchases: wipePurchasesPostgres,
  ledger: wipeLedgerPostgres,
  projects: wipeProjectsPostgres,
  contracts_boq: wipeContractsBoqPostgres,
  coa: wipeCoaPostgres,
  suppliers: wipeSuppliersPostgres,
  cost_centers_indirect: wipeIndirectCostCentersPostgres,
};

/** Recommended order when wiping multiple groups in one request. */
const WIPE_ORDER: PostgresWipeGroupId[] = [
  'financial',
  'warehouse',
  'custody',
  'payroll',
  'fixed_assets',
  'materials_tree',
  'subcontractors',
  'mos_vo',
  'billing',
  'purchases',
  'ledger',
  'contracts_boq',
  'projects',
  'suppliers',
  'cost_centers_indirect',
  'coa',
];

export async function wipePostgresDataGroups(
  groups: PostgresWipeGroupId[],
): Promise<{ deleted: Record<string, number>; total: number; groups: PostgresWipeGroupId[] }> {
  const unique = [...new Set(groups)].filter((g): g is PostgresWipeGroupId =>
    POSTGRES_WIPE_GROUP_IDS.includes(g as PostgresWipeGroupId),
  );
  const ordered = WIPE_ORDER.filter((g) => unique.includes(g));

  const deleted: Record<string, number> = {};
  for (const groupId of ordered) {
    mergeDeleted(deleted, await WIPE_HANDLERS[groupId]());
  }

  const total = Object.values(deleted).reduce((s, n) => s + n, 0);
  return { deleted, total, groups: ordered };
}
