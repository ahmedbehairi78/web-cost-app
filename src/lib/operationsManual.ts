/**
 * In-app operations manual — topic registry and permission-aware lookup.
 * Phase 0: structure + one demo topic (Actual Costs → purchase invoice).
 */

import type { PermissionKey, UserPermissions } from '../types';
import { canOpenModuleView } from './moduleViewPermissions';
import { canOpenModule } from './permissions';

export type ManualTopicId =
  | 'costs.invoice.purchase'
  | 'costs.invoice.indirect'
  | 'costs.invoice.fixed_asset'
  | 'costs.ipc.subcontractor'
  | 'costs.custody.settlement'
  | 'technical.projects.create'
  | 'technical.projects.contract'
  | 'technical.boq.add_item'
  | 'technical.boq.import'
  | 'technical.boq.materials'
  | 'technical.boq.vo'
  | 'technical.billing.qty_limits'
  | 'technical.billing.interim'
  | 'technical.billing.final'
  | 'technical.billing.mos'
  | 'inventory.materials.tree'
  | 'inventory.boq.link'
  | 'inventory.receipt.purchase'
  | 'inventory.consumption.issue'
  | 'inventory.consumption.multi_boq'
  | 'inventory.return'
  | 'inventory.transfer.project'
  | 'ledger.journal.filters'
  | 'ledger.journal.manual_entry'
  | 'ledger.journal.reverse'
  | 'ledger.statement'
  | 'ledger.overhead.close'
  | 'banks.movement.transfer'
  | 'banks.movement.income_expense'
  | 'banks.cheque.received'
  | 'banks.cheque.issued'
  | 'banks.cheque.reject'
  | 'assets.register.create'
  | 'assets.register.import'
  | 'assets.depreciation.quarterly'
  | 'payroll.employee.master'
  | 'payroll.employee.import'
  | 'payroll.run.create_edit'
  | 'payroll.run.sheet_import'
  | 'payroll.run.attendance'
  | 'payroll.run.cost_split'
  | 'payroll.run.accrue'
  | 'payroll.run.pay_reopen'
  | 'payroll.run.whatsapp'
  | 'payroll.leave.balances'
  | 'payroll.settings.rules'
  | 'reports.shared.filters_print'
  | 'reports.income'
  | 'reports.budget'
  | 'reports.balance'
  | 'reports.trial'
  | 'reports.time'
  | 'reports.liquidity'
  | 'reports.costs'
  | 'settings.display.preferences'
  | 'settings.print.company'
  | 'settings.database.backup'
  | 'settings.database.push_production'
  | 'settings.database.maintenance'
  | 'settings.users.manage'
  | 'settings.coa.tree'
  | 'settings.cost_centers.indirect'
  | 'tools.calculator.use'
  | 'tools.offline.sync';

export interface ManualTopicStep {
  titleKey: string;
  bodyKey: string;
}

export interface ManualTopicLink {
  moduleId: string;
  viewId?: string;
}

export interface ManualTopic {
  id: ManualTopicId;
  moduleId: string;
  viewId?: string;
  /** When set, checked in addition to module/view access. */
  permission?: PermissionKey;
  labelKey: string;
  summaryKey: string;
  steps: ManualTopicStep[];
  beforeYouStartKey?: string;
  commonMistakesKey?: string;
  relatedModule?: ManualTopicLink;
  tags?: string[];
  /** Dev traceability to markdown plans — not shown in UI by default. */
  sourceDoc?: string;
}

export interface ManualTopicFilter {
  moduleId?: string;
  viewId?: string;
  /** Matches topic id or tags (caller may also filter translated text client-side). */
  query?: string;
  permissions?: UserPermissions;
  isAdmin?: boolean;
}

export const MANUAL_TOPICS: ManualTopic[] = [
  {
    id: 'costs.invoice.purchase',
    moduleId: 'costs',
    viewId: 'invoice',
    permission: 'costs_invoice',
    labelKey: 'manual_costs_invoice_purchase_title',
    summaryKey: 'manual_costs_invoice_purchase_summary',
    beforeYouStartKey: 'manual_costs_invoice_purchase_before',
    commonMistakesKey: 'manual_costs_invoice_purchase_mistakes',
    steps: [
      {
        titleKey: 'manual_costs_invoice_purchase_step_1_title',
        bodyKey: 'manual_costs_invoice_purchase_step_1_body',
      },
      {
        titleKey: 'manual_costs_invoice_purchase_step_2_title',
        bodyKey: 'manual_costs_invoice_purchase_step_2_body',
      },
      {
        titleKey: 'manual_costs_invoice_purchase_step_3_title',
        bodyKey: 'manual_costs_invoice_purchase_step_3_body',
      },
      {
        titleKey: 'manual_costs_invoice_purchase_step_4_title',
        bodyKey: 'manual_costs_invoice_purchase_step_4_body',
      },
    ],
    relatedModule: { moduleId: 'costs', viewId: 'invoice' },
    tags: ['costs', 'invoice', 'inventory', 'gl', 'purchase'],
    sourceDoc: 'CLAUDE.md — Actual Costs purchase invoice golden path',
  },
  {
    id: 'costs.invoice.indirect',
    moduleId: 'costs',
    viewId: 'invoice',
    permission: 'costs_invoice',
    labelKey: 'manual_costs_invoice_indirect_title',
    summaryKey: 'manual_costs_invoice_indirect_summary',
    beforeYouStartKey: 'manual_costs_invoice_indirect_before',
    commonMistakesKey: 'manual_costs_invoice_indirect_mistakes',
    steps: [
      {
        titleKey: 'manual_costs_invoice_indirect_step_1_title',
        bodyKey: 'manual_costs_invoice_indirect_step_1_body',
      },
      {
        titleKey: 'manual_costs_invoice_indirect_step_2_title',
        bodyKey: 'manual_costs_invoice_indirect_step_2_body',
      },
      {
        titleKey: 'manual_costs_invoice_indirect_step_3_title',
        bodyKey: 'manual_costs_invoice_indirect_step_3_body',
      },
      {
        titleKey: 'manual_costs_invoice_indirect_step_4_title',
        bodyKey: 'manual_costs_invoice_indirect_step_4_body',
      },
    ],
    relatedModule: { moduleId: 'costs', viewId: 'invoice' },
    tags: ['costs', 'invoice', 'indirect', 'expense', 'gl'],
  },
  {
    id: 'costs.invoice.fixed_asset',
    moduleId: 'costs',
    viewId: 'invoice',
    permission: 'costs_invoice',
    labelKey: 'manual_costs_invoice_fixed_asset_title',
    summaryKey: 'manual_costs_invoice_fixed_asset_summary',
    beforeYouStartKey: 'manual_costs_invoice_fixed_asset_before',
    commonMistakesKey: 'manual_costs_invoice_fixed_asset_mistakes',
    steps: [
      {
        titleKey: 'manual_costs_invoice_fixed_asset_step_1_title',
        bodyKey: 'manual_costs_invoice_fixed_asset_step_1_body',
      },
      {
        titleKey: 'manual_costs_invoice_fixed_asset_step_2_title',
        bodyKey: 'manual_costs_invoice_fixed_asset_step_2_body',
      },
      {
        titleKey: 'manual_costs_invoice_fixed_asset_step_3_title',
        bodyKey: 'manual_costs_invoice_fixed_asset_step_3_body',
      },
      {
        titleKey: 'manual_costs_invoice_fixed_asset_step_4_title',
        bodyKey: 'manual_costs_invoice_fixed_asset_step_4_body',
      },
    ],
    relatedModule: { moduleId: 'costs', viewId: 'invoice' },
    tags: ['costs', 'invoice', 'assets', 'fixed', 'gl'],
  },
  {
    id: 'costs.ipc.subcontractor',
    moduleId: 'costs',
    viewId: 'ipc',
    permission: 'costs_ipc',
    labelKey: 'manual_costs_ipc_subcontractor_title',
    summaryKey: 'manual_costs_ipc_subcontractor_summary',
    beforeYouStartKey: 'manual_costs_ipc_subcontractor_before',
    commonMistakesKey: 'manual_costs_ipc_subcontractor_mistakes',
    steps: [
      {
        titleKey: 'manual_costs_ipc_subcontractor_step_1_title',
        bodyKey: 'manual_costs_ipc_subcontractor_step_1_body',
      },
      {
        titleKey: 'manual_costs_ipc_subcontractor_step_2_title',
        bodyKey: 'manual_costs_ipc_subcontractor_step_2_body',
      },
      {
        titleKey: 'manual_costs_ipc_subcontractor_step_3_title',
        bodyKey: 'manual_costs_ipc_subcontractor_step_3_body',
      },
      {
        titleKey: 'manual_costs_ipc_subcontractor_step_4_title',
        bodyKey: 'manual_costs_ipc_subcontractor_step_4_body',
      },
      {
        titleKey: 'manual_costs_ipc_subcontractor_step_5_title',
        bodyKey: 'manual_costs_ipc_subcontractor_step_5_body',
      },
    ],
    relatedModule: { moduleId: 'costs', viewId: 'ipc' },
    tags: ['costs', 'ipc', 'subcontractor', 'gl'],
  },
  {
    id: 'costs.custody.settlement',
    moduleId: 'costs',
    viewId: 'custody',
    permission: 'costs_custody',
    labelKey: 'manual_costs_custody_settlement_title',
    summaryKey: 'manual_costs_custody_settlement_summary',
    beforeYouStartKey: 'manual_costs_custody_settlement_before',
    commonMistakesKey: 'manual_costs_custody_settlement_mistakes',
    steps: [
      {
        titleKey: 'manual_costs_custody_settlement_step_1_title',
        bodyKey: 'manual_costs_custody_settlement_step_1_body',
      },
      {
        titleKey: 'manual_costs_custody_settlement_step_2_title',
        bodyKey: 'manual_costs_custody_settlement_step_2_body',
      },
      {
        titleKey: 'manual_costs_custody_settlement_step_3_title',
        bodyKey: 'manual_costs_custody_settlement_step_3_body',
      },
      {
        titleKey: 'manual_costs_custody_settlement_step_4_title',
        bodyKey: 'manual_costs_custody_settlement_step_4_body',
      },
    ],
    relatedModule: { moduleId: 'costs', viewId: 'custody' },
    tags: ['costs', 'custody', 'gl', '12102'],
  },
  {
    id: 'technical.projects.create',
    moduleId: 'technical',
    viewId: 'projects',
    permission: 'projects',
    labelKey: 'manual_technical_projects_create_title',
    summaryKey: 'manual_technical_projects_create_summary',
    beforeYouStartKey: 'manual_technical_projects_create_before',
    commonMistakesKey: 'manual_technical_projects_create_mistakes',
    steps: [
      { titleKey: 'manual_technical_projects_create_step_1_title', bodyKey: 'manual_technical_projects_create_step_1_body' },
      { titleKey: 'manual_technical_projects_create_step_2_title', bodyKey: 'manual_technical_projects_create_step_2_body' },
      { titleKey: 'manual_technical_projects_create_step_3_title', bodyKey: 'manual_technical_projects_create_step_3_body' },
    ],
    relatedModule: { moduleId: 'technical', viewId: 'projects' },
    tags: ['technical', 'projects', 'setup'],
  },
  {
    id: 'technical.projects.contract',
    moduleId: 'technical',
    viewId: 'projects',
    permission: 'projects',
    labelKey: 'manual_technical_projects_contract_title',
    summaryKey: 'manual_technical_projects_contract_summary',
    beforeYouStartKey: 'manual_technical_projects_contract_before',
    commonMistakesKey: 'manual_technical_projects_contract_mistakes',
    steps: [
      { titleKey: 'manual_technical_projects_contract_step_1_title', bodyKey: 'manual_technical_projects_contract_step_1_body' },
      { titleKey: 'manual_technical_projects_contract_step_2_title', bodyKey: 'manual_technical_projects_contract_step_2_body' },
      { titleKey: 'manual_technical_projects_contract_step_3_title', bodyKey: 'manual_technical_projects_contract_step_3_body' },
    ],
    relatedModule: { moduleId: 'technical', viewId: 'projects' },
    tags: ['technical', 'projects', 'contract', 'cost_center'],
  },
  {
    id: 'technical.boq.add_item',
    moduleId: 'technical',
    viewId: 'boq',
    permission: 'boq',
    labelKey: 'manual_technical_boq_add_item_title',
    summaryKey: 'manual_technical_boq_add_item_summary',
    beforeYouStartKey: 'manual_technical_boq_add_item_before',
    commonMistakesKey: 'manual_technical_boq_add_item_mistakes',
    steps: [
      { titleKey: 'manual_technical_boq_add_item_step_1_title', bodyKey: 'manual_technical_boq_add_item_step_1_body' },
      { titleKey: 'manual_technical_boq_add_item_step_2_title', bodyKey: 'manual_technical_boq_add_item_step_2_body' },
      { titleKey: 'manual_technical_boq_add_item_step_3_title', bodyKey: 'manual_technical_boq_add_item_step_3_body' },
      { titleKey: 'manual_technical_boq_add_item_step_4_title', bodyKey: 'manual_technical_boq_add_item_step_4_body' },
    ],
    relatedModule: { moduleId: 'technical', viewId: 'boq' },
    tags: ['technical', 'boq', 'item'],
  },
  {
    id: 'technical.boq.import',
    moduleId: 'technical',
    viewId: 'boq',
    permission: 'boq',
    labelKey: 'manual_technical_boq_import_title',
    summaryKey: 'manual_technical_boq_import_summary',
    beforeYouStartKey: 'manual_technical_boq_import_before',
    commonMistakesKey: 'manual_technical_boq_import_mistakes',
    steps: [
      { titleKey: 'manual_technical_boq_import_step_1_title', bodyKey: 'manual_technical_boq_import_step_1_body' },
      { titleKey: 'manual_technical_boq_import_step_2_title', bodyKey: 'manual_technical_boq_import_step_2_body' },
      { titleKey: 'manual_technical_boq_import_step_3_title', bodyKey: 'manual_technical_boq_import_step_3_body' },
    ],
    relatedModule: { moduleId: 'technical', viewId: 'boq' },
    tags: ['technical', 'boq', 'excel', 'import'],
  },
  {
    id: 'technical.boq.materials',
    moduleId: 'technical',
    viewId: 'boq',
    permission: 'boq',
    labelKey: 'manual_technical_boq_materials_title',
    summaryKey: 'manual_technical_boq_materials_summary',
    beforeYouStartKey: 'manual_technical_boq_materials_before',
    commonMistakesKey: 'manual_technical_boq_materials_mistakes',
    steps: [
      { titleKey: 'manual_technical_boq_materials_step_1_title', bodyKey: 'manual_technical_boq_materials_step_1_body' },
      { titleKey: 'manual_technical_boq_materials_step_2_title', bodyKey: 'manual_technical_boq_materials_step_2_body' },
      { titleKey: 'manual_technical_boq_materials_step_3_title', bodyKey: 'manual_technical_boq_materials_step_3_body' },
    ],
    relatedModule: { moduleId: 'technical', viewId: 'boq' },
    tags: ['technical', 'boq', 'materials', 'inventory'],
  },
  {
    id: 'technical.boq.vo',
    moduleId: 'technical',
    viewId: 'boq',
    permission: 'boq',
    labelKey: 'manual_technical_boq_vo_title',
    summaryKey: 'manual_technical_boq_vo_summary',
    beforeYouStartKey: 'manual_technical_boq_vo_before',
    commonMistakesKey: 'manual_technical_boq_vo_mistakes',
    steps: [
      { titleKey: 'manual_technical_boq_vo_step_1_title', bodyKey: 'manual_technical_boq_vo_step_1_body' },
      { titleKey: 'manual_technical_boq_vo_step_2_title', bodyKey: 'manual_technical_boq_vo_step_2_body' },
      { titleKey: 'manual_technical_boq_vo_step_3_title', bodyKey: 'manual_technical_boq_vo_step_3_body' },
      { titleKey: 'manual_technical_boq_vo_step_4_title', bodyKey: 'manual_technical_boq_vo_step_4_body' },
    ],
    relatedModule: { moduleId: 'technical', viewId: 'boq' },
    tags: ['technical', 'boq', 'vo', 'variation'],
  },
  {
    id: 'technical.billing.qty_limits',
    moduleId: 'technical',
    viewId: 'billing',
    permission: 'billing',
    labelKey: 'manual_technical_billing_qty_limits_title',
    summaryKey: 'manual_technical_billing_qty_limits_summary',
    beforeYouStartKey: 'manual_technical_billing_qty_limits_before',
    commonMistakesKey: 'manual_technical_billing_qty_limits_mistakes',
    steps: [
      { titleKey: 'manual_technical_billing_qty_limits_step_1_title', bodyKey: 'manual_technical_billing_qty_limits_step_1_body' },
      { titleKey: 'manual_technical_billing_qty_limits_step_2_title', bodyKey: 'manual_technical_billing_qty_limits_step_2_body' },
      { titleKey: 'manual_technical_billing_qty_limits_step_3_title', bodyKey: 'manual_technical_billing_qty_limits_step_3_body' },
      { titleKey: 'manual_technical_billing_qty_limits_step_4_title', bodyKey: 'manual_technical_billing_qty_limits_step_4_body' },
    ],
    relatedModule: { moduleId: 'technical', viewId: 'billing' },
    tags: ['technical', 'billing', 'ipc', 'mos', 'boq', 'vo', 'qty'],
  },
  {
    id: 'technical.billing.interim',
    moduleId: 'technical',
    viewId: 'billing',
    permission: 'billing',
    labelKey: 'manual_technical_billing_interim_title',
    summaryKey: 'manual_technical_billing_interim_summary',
    beforeYouStartKey: 'manual_technical_billing_interim_before',
    commonMistakesKey: 'manual_technical_billing_interim_mistakes',
    steps: [
      { titleKey: 'manual_technical_billing_interim_step_1_title', bodyKey: 'manual_technical_billing_interim_step_1_body' },
      { titleKey: 'manual_technical_billing_interim_step_2_title', bodyKey: 'manual_technical_billing_interim_step_2_body' },
      { titleKey: 'manual_technical_billing_interim_step_3_title', bodyKey: 'manual_technical_billing_interim_step_3_body' },
      { titleKey: 'manual_technical_billing_interim_step_4_title', bodyKey: 'manual_technical_billing_interim_step_4_body' },
      { titleKey: 'manual_technical_billing_interim_step_5_title', bodyKey: 'manual_technical_billing_interim_step_5_body' },
    ],
    relatedModule: { moduleId: 'technical', viewId: 'billing' },
    tags: ['technical', 'billing', 'ipc', 'interim', 'gl'],
  },
  {
    id: 'technical.billing.final',
    moduleId: 'technical',
    viewId: 'billing',
    permission: 'billing',
    labelKey: 'manual_technical_billing_final_title',
    summaryKey: 'manual_technical_billing_final_summary',
    beforeYouStartKey: 'manual_technical_billing_final_before',
    commonMistakesKey: 'manual_technical_billing_final_mistakes',
    steps: [
      { titleKey: 'manual_technical_billing_final_step_1_title', bodyKey: 'manual_technical_billing_final_step_1_body' },
      { titleKey: 'manual_technical_billing_final_step_2_title', bodyKey: 'manual_technical_billing_final_step_2_body' },
      { titleKey: 'manual_technical_billing_final_step_3_title', bodyKey: 'manual_technical_billing_final_step_3_body' },
    ],
    relatedModule: { moduleId: 'technical', viewId: 'billing' },
    tags: ['technical', 'billing', 'ipc', 'final'],
  },
  {
    id: 'technical.billing.mos',
    moduleId: 'technical',
    viewId: 'billing',
    permission: 'billing',
    labelKey: 'manual_technical_billing_mos_title',
    summaryKey: 'manual_technical_billing_mos_summary',
    beforeYouStartKey: 'manual_technical_billing_mos_before',
    commonMistakesKey: 'manual_technical_billing_mos_mistakes',
    steps: [
      { titleKey: 'manual_technical_billing_mos_step_1_title', bodyKey: 'manual_technical_billing_mos_step_1_body' },
      { titleKey: 'manual_technical_billing_mos_step_2_title', bodyKey: 'manual_technical_billing_mos_step_2_body' },
      { titleKey: 'manual_technical_billing_mos_step_3_title', bodyKey: 'manual_technical_billing_mos_step_3_body' },
      { titleKey: 'manual_technical_billing_mos_step_4_title', bodyKey: 'manual_technical_billing_mos_step_4_body' },
    ],
    relatedModule: { moduleId: 'technical', viewId: 'billing' },
    tags: ['technical', 'billing', 'mos', 'materials'],
  },
  {
    id: 'inventory.materials.tree',
    moduleId: 'inventory',
    viewId: 'materials',
    permission: 'inventory',
    labelKey: 'manual_inventory_materials_tree_title',
    summaryKey: 'manual_inventory_materials_tree_summary',
    beforeYouStartKey: 'manual_inventory_materials_tree_before',
    commonMistakesKey: 'manual_inventory_materials_tree_mistakes',
    steps: [
      { titleKey: 'manual_inventory_materials_tree_step_1_title', bodyKey: 'manual_inventory_materials_tree_step_1_body' },
      { titleKey: 'manual_inventory_materials_tree_step_2_title', bodyKey: 'manual_inventory_materials_tree_step_2_body' },
      { titleKey: 'manual_inventory_materials_tree_step_3_title', bodyKey: 'manual_inventory_materials_tree_step_3_body' },
    ],
    relatedModule: { moduleId: 'inventory', viewId: 'materials' },
    tags: ['inventory', 'materials', 'tree', 'excel'],
  },
  {
    id: 'inventory.boq.link',
    moduleId: 'inventory',
    viewId: 'balance',
    permission: 'inventory',
    labelKey: 'manual_inventory_boq_link_title',
    summaryKey: 'manual_inventory_boq_link_summary',
    beforeYouStartKey: 'manual_inventory_boq_link_before',
    commonMistakesKey: 'manual_inventory_boq_link_mistakes',
    steps: [
      { titleKey: 'manual_inventory_boq_link_step_1_title', bodyKey: 'manual_inventory_boq_link_step_1_body' },
      { titleKey: 'manual_inventory_boq_link_step_2_title', bodyKey: 'manual_inventory_boq_link_step_2_body' },
      { titleKey: 'manual_inventory_boq_link_step_3_title', bodyKey: 'manual_inventory_boq_link_step_3_body' },
    ],
    relatedModule: { moduleId: 'technical', viewId: 'boq' },
    tags: ['inventory', 'boq', 'materials', 'consumption'],
  },
  {
    id: 'inventory.receipt.purchase',
    moduleId: 'inventory',
    viewId: 'balance',
    permission: 'inventory',
    labelKey: 'manual_inventory_receipt_purchase_title',
    summaryKey: 'manual_inventory_receipt_purchase_summary',
    beforeYouStartKey: 'manual_inventory_receipt_purchase_before',
    commonMistakesKey: 'manual_inventory_receipt_purchase_mistakes',
    steps: [
      { titleKey: 'manual_inventory_receipt_purchase_step_1_title', bodyKey: 'manual_inventory_receipt_purchase_step_1_body' },
      { titleKey: 'manual_inventory_receipt_purchase_step_2_title', bodyKey: 'manual_inventory_receipt_purchase_step_2_body' },
      { titleKey: 'manual_inventory_receipt_purchase_step_3_title', bodyKey: 'manual_inventory_receipt_purchase_step_3_body' },
      { titleKey: 'manual_inventory_receipt_purchase_step_4_title', bodyKey: 'manual_inventory_receipt_purchase_step_4_body' },
    ],
    relatedModule: { moduleId: 'costs', viewId: 'invoice' },
    tags: ['inventory', 'purchase', '127', 'receipt', 'warehouse'],
  },
  {
    id: 'inventory.consumption.issue',
    moduleId: 'inventory',
    viewId: 'balance',
    permission: 'inventory',
    labelKey: 'manual_inventory_consumption_issue_title',
    summaryKey: 'manual_inventory_consumption_issue_summary',
    beforeYouStartKey: 'manual_inventory_consumption_issue_before',
    commonMistakesKey: 'manual_inventory_consumption_issue_mistakes',
    steps: [
      { titleKey: 'manual_inventory_consumption_issue_step_1_title', bodyKey: 'manual_inventory_consumption_issue_step_1_body' },
      { titleKey: 'manual_inventory_consumption_issue_step_2_title', bodyKey: 'manual_inventory_consumption_issue_step_2_body' },
      { titleKey: 'manual_inventory_consumption_issue_step_3_title', bodyKey: 'manual_inventory_consumption_issue_step_3_body' },
      { titleKey: 'manual_inventory_consumption_issue_step_4_title', bodyKey: 'manual_inventory_consumption_issue_step_4_body' },
    ],
    relatedModule: { moduleId: 'inventory', viewId: 'balance' },
    tags: ['inventory', 'consumption', 'issue', '127', 'gl', 'boq'],
  },
  {
    id: 'inventory.consumption.multi_boq',
    moduleId: 'inventory',
    viewId: 'balance',
    permission: 'inventory',
    labelKey: 'manual_inventory_consumption_multi_boq_title',
    summaryKey: 'manual_inventory_consumption_multi_boq_summary',
    beforeYouStartKey: 'manual_inventory_consumption_multi_boq_before',
    commonMistakesKey: 'manual_inventory_consumption_multi_boq_mistakes',
    steps: [
      { titleKey: 'manual_inventory_consumption_multi_boq_step_1_title', bodyKey: 'manual_inventory_consumption_multi_boq_step_1_body' },
      { titleKey: 'manual_inventory_consumption_multi_boq_step_2_title', bodyKey: 'manual_inventory_consumption_multi_boq_step_2_body' },
      { titleKey: 'manual_inventory_consumption_multi_boq_step_3_title', bodyKey: 'manual_inventory_consumption_multi_boq_step_3_body' },
    ],
    relatedModule: { moduleId: 'inventory', viewId: 'balance' },
    tags: ['inventory', 'consumption', 'allocation', 'boq', 'multi'],
  },
  {
    id: 'inventory.return',
    moduleId: 'inventory',
    viewId: 'history',
    permission: 'inventory',
    labelKey: 'manual_inventory_return_title',
    summaryKey: 'manual_inventory_return_summary',
    beforeYouStartKey: 'manual_inventory_return_before',
    commonMistakesKey: 'manual_inventory_return_mistakes',
    steps: [
      { titleKey: 'manual_inventory_return_step_1_title', bodyKey: 'manual_inventory_return_step_1_body' },
      { titleKey: 'manual_inventory_return_step_2_title', bodyKey: 'manual_inventory_return_step_2_body' },
      { titleKey: 'manual_inventory_return_step_3_title', bodyKey: 'manual_inventory_return_step_3_body' },
      { titleKey: 'manual_inventory_return_step_4_title', bodyKey: 'manual_inventory_return_step_4_body' },
    ],
    relatedModule: { moduleId: 'inventory', viewId: 'history' },
    tags: ['inventory', 'return', '127', 'gl', 'boq'],
  },
  {
    id: 'inventory.transfer.project',
    moduleId: 'inventory',
    viewId: 'transfers',
    permission: 'inventory',
    labelKey: 'manual_inventory_transfer_project_title',
    summaryKey: 'manual_inventory_transfer_project_summary',
    beforeYouStartKey: 'manual_inventory_transfer_project_before',
    commonMistakesKey: 'manual_inventory_transfer_project_mistakes',
    steps: [
      { titleKey: 'manual_inventory_transfer_project_step_1_title', bodyKey: 'manual_inventory_transfer_project_step_1_body' },
      { titleKey: 'manual_inventory_transfer_project_step_2_title', bodyKey: 'manual_inventory_transfer_project_step_2_body' },
      { titleKey: 'manual_inventory_transfer_project_step_3_title', bodyKey: 'manual_inventory_transfer_project_step_3_body' },
      { titleKey: 'manual_inventory_transfer_project_step_4_title', bodyKey: 'manual_inventory_transfer_project_step_4_body' },
    ],
    relatedModule: { moduleId: 'inventory', viewId: 'transfers' },
    tags: ['inventory', 'transfer', '127', 'gl', 'project'],
  },
  {
    id: 'ledger.journal.filters',
    moduleId: 'ledger',
    viewId: 'journal',
    permission: 'ledger',
    labelKey: 'manual_ledger_journal_filters_title',
    summaryKey: 'manual_ledger_journal_filters_summary',
    beforeYouStartKey: 'manual_ledger_journal_filters_before',
    commonMistakesKey: 'manual_ledger_journal_filters_mistakes',
    steps: [
      { titleKey: 'manual_ledger_journal_filters_step_1_title', bodyKey: 'manual_ledger_journal_filters_step_1_body' },
      { titleKey: 'manual_ledger_journal_filters_step_2_title', bodyKey: 'manual_ledger_journal_filters_step_2_body' },
      { titleKey: 'manual_ledger_journal_filters_step_3_title', bodyKey: 'manual_ledger_journal_filters_step_3_body' },
    ],
    relatedModule: { moduleId: 'ledger', viewId: 'journal' },
    tags: ['ledger', 'journal', 'filters', 'gl'],
  },
  {
    id: 'ledger.journal.manual_entry',
    moduleId: 'ledger',
    viewId: 'journal',
    permission: 'ledger',
    labelKey: 'manual_ledger_journal_manual_entry_title',
    summaryKey: 'manual_ledger_journal_manual_entry_summary',
    beforeYouStartKey: 'manual_ledger_journal_manual_entry_before',
    commonMistakesKey: 'manual_ledger_journal_manual_entry_mistakes',
    steps: [
      { titleKey: 'manual_ledger_journal_manual_entry_step_1_title', bodyKey: 'manual_ledger_journal_manual_entry_step_1_body' },
      { titleKey: 'manual_ledger_journal_manual_entry_step_2_title', bodyKey: 'manual_ledger_journal_manual_entry_step_2_body' },
      { titleKey: 'manual_ledger_journal_manual_entry_step_3_title', bodyKey: 'manual_ledger_journal_manual_entry_step_3_body' },
      { titleKey: 'manual_ledger_journal_manual_entry_step_4_title', bodyKey: 'manual_ledger_journal_manual_entry_step_4_body' },
    ],
    relatedModule: { moduleId: 'ledger', viewId: 'journal' },
    tags: ['ledger', 'journal', 'manual', 'gl', 'entry'],
  },
  {
    id: 'ledger.journal.reverse',
    moduleId: 'ledger',
    viewId: 'journal',
    permission: 'ledger',
    labelKey: 'manual_ledger_journal_reverse_title',
    summaryKey: 'manual_ledger_journal_reverse_summary',
    beforeYouStartKey: 'manual_ledger_journal_reverse_before',
    commonMistakesKey: 'manual_ledger_journal_reverse_mistakes',
    steps: [
      { titleKey: 'manual_ledger_journal_reverse_step_1_title', bodyKey: 'manual_ledger_journal_reverse_step_1_body' },
      { titleKey: 'manual_ledger_journal_reverse_step_2_title', bodyKey: 'manual_ledger_journal_reverse_step_2_body' },
      { titleKey: 'manual_ledger_journal_reverse_step_3_title', bodyKey: 'manual_ledger_journal_reverse_step_3_body' },
    ],
    relatedModule: { moduleId: 'ledger', viewId: 'journal' },
    tags: ['ledger', 'journal', 'reverse', 'maintenance', 'gl'],
  },
  {
    id: 'ledger.statement',
    moduleId: 'ledger',
    viewId: 'statement',
    permission: 'ledger',
    labelKey: 'manual_ledger_statement_title',
    summaryKey: 'manual_ledger_statement_summary',
    beforeYouStartKey: 'manual_ledger_statement_before',
    commonMistakesKey: 'manual_ledger_statement_mistakes',
    steps: [
      { titleKey: 'manual_ledger_statement_step_1_title', bodyKey: 'manual_ledger_statement_step_1_body' },
      { titleKey: 'manual_ledger_statement_step_2_title', bodyKey: 'manual_ledger_statement_step_2_body' },
      { titleKey: 'manual_ledger_statement_step_3_title', bodyKey: 'manual_ledger_statement_step_3_body' },
    ],
    relatedModule: { moduleId: 'ledger', viewId: 'statement' },
    tags: ['ledger', 'statement', 'account', 'gl'],
  },
  {
    id: 'ledger.overhead.close',
    moduleId: 'ledger',
    viewId: 'periods',
    permission: 'overhead',
    labelKey: 'manual_ledger_overhead_close_title',
    summaryKey: 'manual_ledger_overhead_close_summary',
    beforeYouStartKey: 'manual_ledger_overhead_close_before',
    commonMistakesKey: 'manual_ledger_overhead_close_mistakes',
    steps: [
      { titleKey: 'manual_ledger_overhead_close_step_1_title', bodyKey: 'manual_ledger_overhead_close_step_1_body' },
      { titleKey: 'manual_ledger_overhead_close_step_2_title', bodyKey: 'manual_ledger_overhead_close_step_2_body' },
      { titleKey: 'manual_ledger_overhead_close_step_3_title', bodyKey: 'manual_ledger_overhead_close_step_3_body' },
      { titleKey: 'manual_ledger_overhead_close_step_4_title', bodyKey: 'manual_ledger_overhead_close_step_4_body' },
      { titleKey: 'manual_ledger_overhead_close_step_5_title', bodyKey: 'manual_ledger_overhead_close_step_5_body' },
    ],
    relatedModule: { moduleId: 'ledger', viewId: 'periods' },
    tags: ['ledger', 'overhead', 'oha', '512', 'allocation', 'gl'],
  },
  {
    id: 'banks.movement.transfer',
    moduleId: 'banks',
    viewId: 'movements',
    permission: 'banks',
    labelKey: 'manual_banks_movement_transfer_title',
    summaryKey: 'manual_banks_movement_transfer_summary',
    beforeYouStartKey: 'manual_banks_movement_transfer_before',
    commonMistakesKey: 'manual_banks_movement_transfer_mistakes',
    steps: [
      { titleKey: 'manual_banks_movement_transfer_step_1_title', bodyKey: 'manual_banks_movement_transfer_step_1_body' },
      { titleKey: 'manual_banks_movement_transfer_step_2_title', bodyKey: 'manual_banks_movement_transfer_step_2_body' },
      { titleKey: 'manual_banks_movement_transfer_step_3_title', bodyKey: 'manual_banks_movement_transfer_step_3_body' },
      { titleKey: 'manual_banks_movement_transfer_step_4_title', bodyKey: 'manual_banks_movement_transfer_step_4_body' },
      { titleKey: 'manual_banks_movement_transfer_step_5_title', bodyKey: 'manual_banks_movement_transfer_step_5_body' },
      { titleKey: 'manual_banks_movement_transfer_step_6_title', bodyKey: 'manual_banks_movement_transfer_step_6_body' },
      { titleKey: 'manual_banks_movement_transfer_step_7_title', bodyKey: 'manual_banks_movement_transfer_step_7_body' },
    ],
    relatedModule: { moduleId: 'banks', viewId: 'movements' },
    tags: ['banks', 'transfer', 'instapay', '121', 'gl'],
  },
  {
    id: 'banks.movement.income_expense',
    moduleId: 'banks',
    viewId: 'movements',
    permission: 'banks',
    labelKey: 'manual_banks_movement_income_expense_title',
    summaryKey: 'manual_banks_movement_income_expense_summary',
    beforeYouStartKey: 'manual_banks_movement_income_expense_before',
    commonMistakesKey: 'manual_banks_movement_income_expense_mistakes',
    steps: [
      { titleKey: 'manual_banks_movement_income_expense_step_1_title', bodyKey: 'manual_banks_movement_income_expense_step_1_body' },
      { titleKey: 'manual_banks_movement_income_expense_step_2_title', bodyKey: 'manual_banks_movement_income_expense_step_2_body' },
      { titleKey: 'manual_banks_movement_income_expense_step_3_title', bodyKey: 'manual_banks_movement_income_expense_step_3_body' },
    ],
    relatedModule: { moduleId: 'banks', viewId: 'movements' },
    tags: ['banks', 'deposit', 'withdrawal', 'fee', '121', 'gl'],
  },
  {
    id: 'banks.cheque.received',
    moduleId: 'banks',
    viewId: 'cheques',
    permission: 'banks',
    labelKey: 'manual_banks_cheque_received_title',
    summaryKey: 'manual_banks_cheque_received_summary',
    beforeYouStartKey: 'manual_banks_cheque_received_before',
    commonMistakesKey: 'manual_banks_cheque_received_mistakes',
    steps: [
      { titleKey: 'manual_banks_cheque_received_step_1_title', bodyKey: 'manual_banks_cheque_received_step_1_body' },
      { titleKey: 'manual_banks_cheque_received_step_2_title', bodyKey: 'manual_banks_cheque_received_step_2_body' },
      { titleKey: 'manual_banks_cheque_received_step_3_title', bodyKey: 'manual_banks_cheque_received_step_3_body' },
      { titleKey: 'manual_banks_cheque_received_step_4_title', bodyKey: 'manual_banks_cheque_received_step_4_body' },
      { titleKey: 'manual_banks_cheque_received_step_5_title', bodyKey: 'manual_banks_cheque_received_step_5_body' },
      { titleKey: 'manual_banks_cheque_received_step_6_title', bodyKey: 'manual_banks_cheque_received_step_6_body' },
    ],
    relatedModule: { moduleId: 'banks', viewId: 'cheques' },
    tags: ['banks', 'cheque', 'received', '12203001', 'iss', 'clr', 'gl'],
  },
  {
    id: 'banks.cheque.issued',
    moduleId: 'banks',
    viewId: 'cheques',
    permission: 'banks',
    labelKey: 'manual_banks_cheque_issued_title',
    summaryKey: 'manual_banks_cheque_issued_summary',
    beforeYouStartKey: 'manual_banks_cheque_issued_before',
    commonMistakesKey: 'manual_banks_cheque_issued_mistakes',
    steps: [
      { titleKey: 'manual_banks_cheque_issued_step_1_title', bodyKey: 'manual_banks_cheque_issued_step_1_body' },
      { titleKey: 'manual_banks_cheque_issued_step_2_title', bodyKey: 'manual_banks_cheque_issued_step_2_body' },
      { titleKey: 'manual_banks_cheque_issued_step_3_title', bodyKey: 'manual_banks_cheque_issued_step_3_body' },
      { titleKey: 'manual_banks_cheque_issued_step_4_title', bodyKey: 'manual_banks_cheque_issued_step_4_body' },
      { titleKey: 'manual_banks_cheque_issued_step_5_title', bodyKey: 'manual_banks_cheque_issued_step_5_body' },
      { titleKey: 'manual_banks_cheque_issued_step_6_title', bodyKey: 'manual_banks_cheque_issued_step_6_body' },
    ],
    relatedModule: { moduleId: 'banks', viewId: 'cheques' },
    tags: ['banks', 'cheque', 'issued', '21601001', 'iss', 'clr', 'gl'],
  },
  {
    id: 'banks.cheque.reject',
    moduleId: 'banks',
    viewId: 'cheques',
    permission: 'banks',
    labelKey: 'manual_banks_cheque_reject_title',
    summaryKey: 'manual_banks_cheque_reject_summary',
    beforeYouStartKey: 'manual_banks_cheque_reject_before',
    commonMistakesKey: 'manual_banks_cheque_reject_mistakes',
    steps: [
      { titleKey: 'manual_banks_cheque_reject_step_1_title', bodyKey: 'manual_banks_cheque_reject_step_1_body' },
      { titleKey: 'manual_banks_cheque_reject_step_2_title', bodyKey: 'manual_banks_cheque_reject_step_2_body' },
      { titleKey: 'manual_banks_cheque_reject_step_3_title', bodyKey: 'manual_banks_cheque_reject_step_3_body' },
      { titleKey: 'manual_banks_cheque_reject_step_4_title', bodyKey: 'manual_banks_cheque_reject_step_4_body' },
      { titleKey: 'manual_banks_cheque_reject_step_5_title', bodyKey: 'manual_banks_cheque_reject_step_5_body' },
    ],
    relatedModule: { moduleId: 'banks', viewId: 'cheques' },
    tags: ['banks', 'cheque', 'reject', 'return', 'reverse', 'gl'],
  },
  {
    id: 'assets.register.create',
    moduleId: 'assets',
    viewId: 'register',
    permission: 'assets',
    labelKey: 'manual_assets_register_create_title',
    summaryKey: 'manual_assets_register_create_summary',
    beforeYouStartKey: 'manual_assets_register_create_before',
    commonMistakesKey: 'manual_assets_register_create_mistakes',
    steps: [
      { titleKey: 'manual_assets_register_create_step_1_title', bodyKey: 'manual_assets_register_create_step_1_body' },
      { titleKey: 'manual_assets_register_create_step_2_title', bodyKey: 'manual_assets_register_create_step_2_body' },
      { titleKey: 'manual_assets_register_create_step_3_title', bodyKey: 'manual_assets_register_create_step_3_body' },
      { titleKey: 'manual_assets_register_create_step_4_title', bodyKey: 'manual_assets_register_create_step_4_body' },
      { titleKey: 'manual_assets_register_create_step_5_title', bodyKey: 'manual_assets_register_create_step_5_body' },
    ],
    relatedModule: { moduleId: 'costs', viewId: 'invoice' },
    tags: ['assets', 'register', '11', '119', 'pending_setup', 'active'],
  },
  {
    id: 'assets.register.import',
    moduleId: 'assets',
    viewId: 'register',
    permission: 'assets',
    labelKey: 'manual_assets_register_import_title',
    summaryKey: 'manual_assets_register_import_summary',
    beforeYouStartKey: 'manual_assets_register_import_before',
    commonMistakesKey: 'manual_assets_register_import_mistakes',
    steps: [
      { titleKey: 'manual_assets_register_import_step_1_title', bodyKey: 'manual_assets_register_import_step_1_body' },
      { titleKey: 'manual_assets_register_import_step_2_title', bodyKey: 'manual_assets_register_import_step_2_body' },
      { titleKey: 'manual_assets_register_import_step_3_title', bodyKey: 'manual_assets_register_import_step_3_body' },
      { titleKey: 'manual_assets_register_import_step_4_title', bodyKey: 'manual_assets_register_import_step_4_body' },
    ],
    relatedModule: { moduleId: 'assets', viewId: 'register' },
    tags: ['assets', 'import', 'excel', 'opening', 'register'],
  },
  {
    id: 'assets.depreciation.quarterly',
    moduleId: 'assets',
    viewId: 'depreciation',
    permission: 'assets',
    labelKey: 'manual_assets_depreciation_quarterly_title',
    summaryKey: 'manual_assets_depreciation_quarterly_summary',
    beforeYouStartKey: 'manual_assets_depreciation_quarterly_before',
    commonMistakesKey: 'manual_assets_depreciation_quarterly_mistakes',
    steps: [
      { titleKey: 'manual_assets_depreciation_quarterly_step_1_title', bodyKey: 'manual_assets_depreciation_quarterly_step_1_body' },
      { titleKey: 'manual_assets_depreciation_quarterly_step_2_title', bodyKey: 'manual_assets_depreciation_quarterly_step_2_body' },
      { titleKey: 'manual_assets_depreciation_quarterly_step_3_title', bodyKey: 'manual_assets_depreciation_quarterly_step_3_body' },
      { titleKey: 'manual_assets_depreciation_quarterly_step_4_title', bodyKey: 'manual_assets_depreciation_quarterly_step_4_body' },
      { titleKey: 'manual_assets_depreciation_quarterly_step_5_title', bodyKey: 'manual_assets_depreciation_quarterly_step_5_body' },
    ],
    relatedModule: { moduleId: 'assets', viewId: 'depreciation' },
    tags: ['assets', 'depreciation', 'quarter', '119', '5', 'book_value'],
  },
  {
    id: 'payroll.employee.master',
    moduleId: 'payroll',
    viewId: 'employees',
    permission: 'payroll',
    labelKey: 'manual_payroll_employee_master_title',
    summaryKey: 'manual_payroll_employee_master_summary',
    beforeYouStartKey: 'manual_payroll_employee_master_before',
    commonMistakesKey: 'manual_payroll_employee_master_mistakes',
    steps: [
      { titleKey: 'manual_payroll_employee_master_step_1_title', bodyKey: 'manual_payroll_employee_master_step_1_body' },
      { titleKey: 'manual_payroll_employee_master_step_2_title', bodyKey: 'manual_payroll_employee_master_step_2_body' },
      { titleKey: 'manual_payroll_employee_master_step_3_title', bodyKey: 'manual_payroll_employee_master_step_3_body' },
      { titleKey: 'manual_payroll_employee_master_step_4_title', bodyKey: 'manual_payroll_employee_master_step_4_body' },
      { titleKey: 'manual_payroll_employee_master_step_5_title', bodyKey: 'manual_payroll_employee_master_step_5_body' },
      { titleKey: 'manual_payroll_employee_master_step_6_title', bodyKey: 'manual_payroll_employee_master_step_6_body' },
    ],
    tags: ['payroll', 'employee', '51102001', '52101001', 'cost_center', 'whatsapp'],
  },
  {
    id: 'payroll.employee.import',
    moduleId: 'payroll',
    viewId: 'employees',
    permission: 'payroll',
    labelKey: 'manual_payroll_employee_import_title',
    summaryKey: 'manual_payroll_employee_import_summary',
    beforeYouStartKey: 'manual_payroll_employee_import_before',
    commonMistakesKey: 'manual_payroll_employee_import_mistakes',
    steps: [
      { titleKey: 'manual_payroll_employee_import_step_1_title', bodyKey: 'manual_payroll_employee_import_step_1_body' },
      { titleKey: 'manual_payroll_employee_import_step_2_title', bodyKey: 'manual_payroll_employee_import_step_2_body' },
      { titleKey: 'manual_payroll_employee_import_step_3_title', bodyKey: 'manual_payroll_employee_import_step_3_body' },
      { titleKey: 'manual_payroll_employee_import_step_4_title', bodyKey: 'manual_payroll_employee_import_step_4_body' },
    ],
    tags: ['payroll', 'employee', 'import', 'excel', 'leave'],
  },
  {
    id: 'payroll.run.create_edit',
    moduleId: 'payroll',
    viewId: 'runs',
    permission: 'payroll',
    labelKey: 'manual_payroll_run_create_edit_title',
    summaryKey: 'manual_payroll_run_create_edit_summary',
    beforeYouStartKey: 'manual_payroll_run_create_edit_before',
    commonMistakesKey: 'manual_payroll_run_create_edit_mistakes',
    steps: [
      { titleKey: 'manual_payroll_run_create_edit_step_1_title', bodyKey: 'manual_payroll_run_create_edit_step_1_body' },
      { titleKey: 'manual_payroll_run_create_edit_step_2_title', bodyKey: 'manual_payroll_run_create_edit_step_2_body' },
      { titleKey: 'manual_payroll_run_create_edit_step_3_title', bodyKey: 'manual_payroll_run_create_edit_step_3_body' },
      { titleKey: 'manual_payroll_run_create_edit_step_4_title', bodyKey: 'manual_payroll_run_create_edit_step_4_body' },
      { titleKey: 'manual_payroll_run_create_edit_step_5_title', bodyKey: 'manual_payroll_run_create_edit_step_5_body' },
      { titleKey: 'manual_payroll_run_create_edit_step_6_title', bodyKey: 'manual_payroll_run_create_edit_step_6_body' },
    ],
    tags: ['payroll', 'run', 'draft', 'gross', 'net'],
  },
  {
    id: 'payroll.run.sheet_import',
    moduleId: 'payroll',
    viewId: 'runs',
    permission: 'payroll',
    labelKey: 'manual_payroll_run_sheet_import_title',
    summaryKey: 'manual_payroll_run_sheet_import_summary',
    beforeYouStartKey: 'manual_payroll_run_sheet_import_before',
    commonMistakesKey: 'manual_payroll_run_sheet_import_mistakes',
    steps: [
      { titleKey: 'manual_payroll_run_sheet_import_step_1_title', bodyKey: 'manual_payroll_run_sheet_import_step_1_body' },
      { titleKey: 'manual_payroll_run_sheet_import_step_2_title', bodyKey: 'manual_payroll_run_sheet_import_step_2_body' },
      { titleKey: 'manual_payroll_run_sheet_import_step_3_title', bodyKey: 'manual_payroll_run_sheet_import_step_3_body' },
      { titleKey: 'manual_payroll_run_sheet_import_step_4_title', bodyKey: 'manual_payroll_run_sheet_import_step_4_body' },
      { titleKey: 'manual_payroll_run_sheet_import_step_5_title', bodyKey: 'manual_payroll_run_sheet_import_step_5_body' },
    ],
    tags: ['payroll', 'run', 'import', 'excel', 'sheet'],
  },
  {
    id: 'payroll.run.attendance',
    moduleId: 'payroll',
    viewId: 'runs',
    permission: 'payroll',
    labelKey: 'manual_payroll_run_attendance_title',
    summaryKey: 'manual_payroll_run_attendance_summary',
    beforeYouStartKey: 'manual_payroll_run_attendance_before',
    commonMistakesKey: 'manual_payroll_run_attendance_mistakes',
    steps: [
      { titleKey: 'manual_payroll_run_attendance_step_1_title', bodyKey: 'manual_payroll_run_attendance_step_1_body' },
      { titleKey: 'manual_payroll_run_attendance_step_2_title', bodyKey: 'manual_payroll_run_attendance_step_2_body' },
      { titleKey: 'manual_payroll_run_attendance_step_3_title', bodyKey: 'manual_payroll_run_attendance_step_3_body' },
      { titleKey: 'manual_payroll_run_attendance_step_4_title', bodyKey: 'manual_payroll_run_attendance_step_4_body' },
      { titleKey: 'manual_payroll_run_attendance_step_5_title', bodyKey: 'manual_payroll_run_attendance_step_5_body' },
      { titleKey: 'manual_payroll_run_attendance_step_6_title', bodyKey: 'manual_payroll_run_attendance_step_6_body' },
    ],
    relatedModule: { moduleId: 'payroll', viewId: 'settings' },
    tags: ['payroll', 'attendance', 'fingerprint', 'overtime', 'penalties'],
  },
  {
    id: 'payroll.run.cost_split',
    moduleId: 'payroll',
    viewId: 'runs',
    permission: 'payroll',
    labelKey: 'manual_payroll_run_cost_split_title',
    summaryKey: 'manual_payroll_run_cost_split_summary',
    beforeYouStartKey: 'manual_payroll_run_cost_split_before',
    commonMistakesKey: 'manual_payroll_run_cost_split_mistakes',
    steps: [
      { titleKey: 'manual_payroll_run_cost_split_step_1_title', bodyKey: 'manual_payroll_run_cost_split_step_1_body' },
      { titleKey: 'manual_payroll_run_cost_split_step_2_title', bodyKey: 'manual_payroll_run_cost_split_step_2_body' },
      { titleKey: 'manual_payroll_run_cost_split_step_3_title', bodyKey: 'manual_payroll_run_cost_split_step_3_body' },
      { titleKey: 'manual_payroll_run_cost_split_step_4_title', bodyKey: 'manual_payroll_run_cost_split_step_4_body' },
      { titleKey: 'manual_payroll_run_cost_split_step_5_title', bodyKey: 'manual_payroll_run_cost_split_step_5_body' },
    ],
    tags: ['payroll', 'allocation', 'cost_center', '51102001', '52101001'],
  },
  {
    id: 'payroll.run.accrue',
    moduleId: 'payroll',
    viewId: 'runs',
    permission: 'payroll',
    labelKey: 'manual_payroll_run_accrue_title',
    summaryKey: 'manual_payroll_run_accrue_summary',
    beforeYouStartKey: 'manual_payroll_run_accrue_before',
    commonMistakesKey: 'manual_payroll_run_accrue_mistakes',
    steps: [
      { titleKey: 'manual_payroll_run_accrue_step_1_title', bodyKey: 'manual_payroll_run_accrue_step_1_body' },
      { titleKey: 'manual_payroll_run_accrue_step_2_title', bodyKey: 'manual_payroll_run_accrue_step_2_body' },
      { titleKey: 'manual_payroll_run_accrue_step_3_title', bodyKey: 'manual_payroll_run_accrue_step_3_body' },
      { titleKey: 'manual_payroll_run_accrue_step_4_title', bodyKey: 'manual_payroll_run_accrue_step_4_body' },
      { titleKey: 'manual_payroll_run_accrue_step_5_title', bodyKey: 'manual_payroll_run_accrue_step_5_body' },
      { titleKey: 'manual_payroll_run_accrue_step_6_title', bodyKey: 'manual_payroll_run_accrue_step_6_body' },
    ],
    relatedModule: { moduleId: 'ledger', viewId: 'journal' },
    tags: ['payroll', 'accrue', 'gl', '21501003', '21403001', 'preview'],
  },
  {
    id: 'payroll.run.pay_reopen',
    moduleId: 'payroll',
    viewId: 'runs',
    permission: 'payroll',
    labelKey: 'manual_payroll_run_pay_reopen_title',
    summaryKey: 'manual_payroll_run_pay_reopen_summary',
    beforeYouStartKey: 'manual_payroll_run_pay_reopen_before',
    commonMistakesKey: 'manual_payroll_run_pay_reopen_mistakes',
    steps: [
      { titleKey: 'manual_payroll_run_pay_reopen_step_1_title', bodyKey: 'manual_payroll_run_pay_reopen_step_1_body' },
      { titleKey: 'manual_payroll_run_pay_reopen_step_2_title', bodyKey: 'manual_payroll_run_pay_reopen_step_2_body' },
      { titleKey: 'manual_payroll_run_pay_reopen_step_3_title', bodyKey: 'manual_payroll_run_pay_reopen_step_3_body' },
      { titleKey: 'manual_payroll_run_pay_reopen_step_4_title', bodyKey: 'manual_payroll_run_pay_reopen_step_4_body' },
      { titleKey: 'manual_payroll_run_pay_reopen_step_5_title', bodyKey: 'manual_payroll_run_pay_reopen_step_5_body' },
    ],
    tags: ['payroll', 'pay', '121', '21501003', 'reopen'],
  },
  {
    id: 'payroll.run.whatsapp',
    moduleId: 'payroll',
    viewId: 'runs',
    permission: 'payroll',
    labelKey: 'manual_payroll_run_whatsapp_title',
    summaryKey: 'manual_payroll_run_whatsapp_summary',
    beforeYouStartKey: 'manual_payroll_run_whatsapp_before',
    commonMistakesKey: 'manual_payroll_run_whatsapp_mistakes',
    steps: [
      { titleKey: 'manual_payroll_run_whatsapp_step_1_title', bodyKey: 'manual_payroll_run_whatsapp_step_1_body' },
      { titleKey: 'manual_payroll_run_whatsapp_step_2_title', bodyKey: 'manual_payroll_run_whatsapp_step_2_body' },
      { titleKey: 'manual_payroll_run_whatsapp_step_3_title', bodyKey: 'manual_payroll_run_whatsapp_step_3_body' },
      { titleKey: 'manual_payroll_run_whatsapp_step_4_title', bodyKey: 'manual_payroll_run_whatsapp_step_4_body' },
    ],
    tags: ['payroll', 'whatsapp', 'notify', 'salary'],
  },
  {
    id: 'payroll.leave.balances',
    moduleId: 'payroll',
    viewId: 'employees',
    permission: 'payroll',
    labelKey: 'manual_payroll_leave_balances_title',
    summaryKey: 'manual_payroll_leave_balances_summary',
    beforeYouStartKey: 'manual_payroll_leave_balances_before',
    commonMistakesKey: 'manual_payroll_leave_balances_mistakes',
    steps: [
      { titleKey: 'manual_payroll_leave_balances_step_1_title', bodyKey: 'manual_payroll_leave_balances_step_1_body' },
      { titleKey: 'manual_payroll_leave_balances_step_2_title', bodyKey: 'manual_payroll_leave_balances_step_2_body' },
      { titleKey: 'manual_payroll_leave_balances_step_3_title', bodyKey: 'manual_payroll_leave_balances_step_3_body' },
      { titleKey: 'manual_payroll_leave_balances_step_4_title', bodyKey: 'manual_payroll_leave_balances_step_4_body' },
      { titleKey: 'manual_payroll_leave_balances_step_5_title', bodyKey: 'manual_payroll_leave_balances_step_5_body' },
    ],
    relatedModule: { moduleId: 'payroll', viewId: 'settings' },
    tags: ['payroll', 'leave', 'balance', 'annual'],
  },
  {
    id: 'payroll.settings.rules',
    moduleId: 'payroll',
    viewId: 'settings',
    permission: 'payroll',
    labelKey: 'manual_payroll_settings_rules_title',
    summaryKey: 'manual_payroll_settings_rules_summary',
    beforeYouStartKey: 'manual_payroll_settings_rules_before',
    commonMistakesKey: 'manual_payroll_settings_rules_mistakes',
    steps: [
      { titleKey: 'manual_payroll_settings_rules_step_1_title', bodyKey: 'manual_payroll_settings_rules_step_1_body' },
      { titleKey: 'manual_payroll_settings_rules_step_2_title', bodyKey: 'manual_payroll_settings_rules_step_2_body' },
      { titleKey: 'manual_payroll_settings_rules_step_3_title', bodyKey: 'manual_payroll_settings_rules_step_3_body' },
      { titleKey: 'manual_payroll_settings_rules_step_4_title', bodyKey: 'manual_payroll_settings_rules_step_4_body' },
      { titleKey: 'manual_payroll_settings_rules_step_5_title', bodyKey: 'manual_payroll_settings_rules_step_5_body' },
    ],
    tags: ['payroll', 'attendance', 'rules', 'holidays', 'settings'],
  },
  {
    id: 'reports.shared.filters_print',
    moduleId: 'reports',
    permission: 'reports',
    labelKey: 'manual_reports_shared_filters_print_title',
    summaryKey: 'manual_reports_shared_filters_print_summary',
    beforeYouStartKey: 'manual_reports_shared_filters_print_before',
    commonMistakesKey: 'manual_reports_shared_filters_print_mistakes',
    steps: [
      { titleKey: 'manual_reports_shared_filters_print_step_1_title', bodyKey: 'manual_reports_shared_filters_print_step_1_body' },
      { titleKey: 'manual_reports_shared_filters_print_step_2_title', bodyKey: 'manual_reports_shared_filters_print_step_2_body' },
      { titleKey: 'manual_reports_shared_filters_print_step_3_title', bodyKey: 'manual_reports_shared_filters_print_step_3_body' },
      { titleKey: 'manual_reports_shared_filters_print_step_4_title', bodyKey: 'manual_reports_shared_filters_print_step_4_body' },
      { titleKey: 'manual_reports_shared_filters_print_step_5_title', bodyKey: 'manual_reports_shared_filters_print_step_5_body' },
    ],
    relatedModule: { moduleId: 'settings', viewId: 'print' },
    tags: ['reports', 'print', 'excel', 'charts', 'filters', 'project', 'contract'],
  },
  {
    id: 'reports.income',
    moduleId: 'reports',
    viewId: 'income',
    permission: 'reports',
    labelKey: 'manual_reports_income_title',
    summaryKey: 'manual_reports_income_summary',
    beforeYouStartKey: 'manual_reports_income_before',
    commonMistakesKey: 'manual_reports_income_mistakes',
    steps: [
      { titleKey: 'manual_reports_income_step_1_title', bodyKey: 'manual_reports_income_step_1_body' },
      { titleKey: 'manual_reports_income_step_2_title', bodyKey: 'manual_reports_income_step_2_body' },
      { titleKey: 'manual_reports_income_step_3_title', bodyKey: 'manual_reports_income_step_3_body' },
      { titleKey: 'manual_reports_income_step_4_title', bodyKey: 'manual_reports_income_step_4_body' },
      { titleKey: 'manual_reports_income_step_5_title', bodyKey: 'manual_reports_income_step_5_body' },
    ],
    tags: ['reports', 'income', 'pl', 'gl', 'accrual', 'profit'],
  },
  {
    id: 'reports.budget',
    moduleId: 'reports',
    viewId: 'budget',
    permission: 'reports',
    labelKey: 'manual_reports_budget_title',
    summaryKey: 'manual_reports_budget_summary',
    beforeYouStartKey: 'manual_reports_budget_before',
    commonMistakesKey: 'manual_reports_budget_mistakes',
    steps: [
      { titleKey: 'manual_reports_budget_step_1_title', bodyKey: 'manual_reports_budget_step_1_body' },
      { titleKey: 'manual_reports_budget_step_2_title', bodyKey: 'manual_reports_budget_step_2_body' },
      { titleKey: 'manual_reports_budget_step_3_title', bodyKey: 'manual_reports_budget_step_3_body' },
      { titleKey: 'manual_reports_budget_step_4_title', bodyKey: 'manual_reports_budget_step_4_body' },
    ],
    tags: ['reports', 'budget', 'variance', 'boq', 'actual'],
  },
  {
    id: 'reports.balance',
    moduleId: 'reports',
    viewId: 'balance',
    permission: 'reports',
    labelKey: 'manual_reports_balance_title',
    summaryKey: 'manual_reports_balance_summary',
    beforeYouStartKey: 'manual_reports_balance_before',
    commonMistakesKey: 'manual_reports_balance_mistakes',
    steps: [
      { titleKey: 'manual_reports_balance_step_1_title', bodyKey: 'manual_reports_balance_step_1_body' },
      { titleKey: 'manual_reports_balance_step_2_title', bodyKey: 'manual_reports_balance_step_2_body' },
      { titleKey: 'manual_reports_balance_step_3_title', bodyKey: 'manual_reports_balance_step_3_body' },
      { titleKey: 'manual_reports_balance_step_4_title', bodyKey: 'manual_reports_balance_step_4_body' },
      { titleKey: 'manual_reports_balance_step_5_title', bodyKey: 'manual_reports_balance_step_5_body' },
    ],
    tags: ['reports', 'balance', 'sheet', 'equity', '127', 'ifrs'],
  },
  {
    id: 'reports.trial',
    moduleId: 'reports',
    viewId: 'trial',
    permission: 'reports',
    labelKey: 'manual_reports_trial_title',
    summaryKey: 'manual_reports_trial_summary',
    beforeYouStartKey: 'manual_reports_trial_before',
    commonMistakesKey: 'manual_reports_trial_mistakes',
    steps: [
      { titleKey: 'manual_reports_trial_step_1_title', bodyKey: 'manual_reports_trial_step_1_body' },
      { titleKey: 'manual_reports_trial_step_2_title', bodyKey: 'manual_reports_trial_step_2_body' },
      { titleKey: 'manual_reports_trial_step_3_title', bodyKey: 'manual_reports_trial_step_3_body' },
      { titleKey: 'manual_reports_trial_step_4_title', bodyKey: 'manual_reports_trial_step_4_body' },
    ],
    tags: ['reports', 'trial', 'balance', 'opening', '127', 'period'],
  },
  {
    id: 'reports.time',
    moduleId: 'reports',
    viewId: 'time',
    permission: 'reports',
    labelKey: 'manual_reports_time_title',
    summaryKey: 'manual_reports_time_summary',
    beforeYouStartKey: 'manual_reports_time_before',
    commonMistakesKey: 'manual_reports_time_mistakes',
    steps: [
      { titleKey: 'manual_reports_time_step_1_title', bodyKey: 'manual_reports_time_step_1_body' },
      { titleKey: 'manual_reports_time_step_2_title', bodyKey: 'manual_reports_time_step_2_body' },
      { titleKey: 'manual_reports_time_step_3_title', bodyKey: 'manual_reports_time_step_3_body' },
      { titleKey: 'manual_reports_time_step_4_title', bodyKey: 'manual_reports_time_step_4_body' },
    ],
    tags: ['reports', 'schedule', 'boq', 'gantt', 'time'],
  },
  {
    id: 'reports.liquidity',
    moduleId: 'reports',
    viewId: 'liquidity',
    permission: 'reports',
    labelKey: 'manual_reports_liquidity_title',
    summaryKey: 'manual_reports_liquidity_summary',
    beforeYouStartKey: 'manual_reports_liquidity_before',
    commonMistakesKey: 'manual_reports_liquidity_mistakes',
    steps: [
      { titleKey: 'manual_reports_liquidity_step_1_title', bodyKey: 'manual_reports_liquidity_step_1_body' },
      { titleKey: 'manual_reports_liquidity_step_2_title', bodyKey: 'manual_reports_liquidity_step_2_body' },
      { titleKey: 'manual_reports_liquidity_step_3_title', bodyKey: 'manual_reports_liquidity_step_3_body' },
      { titleKey: 'manual_reports_liquidity_step_4_title', bodyKey: 'manual_reports_liquidity_step_4_body' },
      { titleKey: 'manual_reports_liquidity_step_5_title', bodyKey: 'manual_reports_liquidity_step_5_body' },
    ],
    relatedModule: { moduleId: 'dashboard' },
    tags: ['reports', 'liquidity', 'collection', 'receivables', '12201', '21301'],
  },
  {
    id: 'reports.costs',
    moduleId: 'reports',
    viewId: 'costs',
    permission: 'reports',
    labelKey: 'manual_reports_costs_title',
    summaryKey: 'manual_reports_costs_summary',
    beforeYouStartKey: 'manual_reports_costs_before',
    commonMistakesKey: 'manual_reports_costs_mistakes',
    steps: [
      { titleKey: 'manual_reports_costs_step_1_title', bodyKey: 'manual_reports_costs_step_1_body' },
      { titleKey: 'manual_reports_costs_step_2_title', bodyKey: 'manual_reports_costs_step_2_body' },
      { titleKey: 'manual_reports_costs_step_3_title', bodyKey: 'manual_reports_costs_step_3_body' },
      { titleKey: 'manual_reports_costs_step_4_title', bodyKey: 'manual_reports_costs_step_4_body' },
      { titleKey: 'manual_reports_costs_step_5_title', bodyKey: 'manual_reports_costs_step_5_body' },
    ],
    relatedModule: { moduleId: 'inventory', viewId: 'consumption' },
    tags: ['reports', 'boq', 'costs', 'consumption', 'oha', 'local'],
  },
  {
    id: 'settings.display.preferences',
    moduleId: 'display',
    labelKey: 'manual_settings_display_preferences_title',
    summaryKey: 'manual_settings_display_preferences_summary',
    beforeYouStartKey: 'manual_settings_display_preferences_before',
    commonMistakesKey: 'manual_settings_display_preferences_mistakes',
    steps: [
      { titleKey: 'manual_settings_display_preferences_step_1_title', bodyKey: 'manual_settings_display_preferences_step_1_body' },
      { titleKey: 'manual_settings_display_preferences_step_2_title', bodyKey: 'manual_settings_display_preferences_step_2_body' },
      { titleKey: 'manual_settings_display_preferences_step_3_title', bodyKey: 'manual_settings_display_preferences_step_3_body' },
      { titleKey: 'manual_settings_display_preferences_step_4_title', bodyKey: 'manual_settings_display_preferences_step_4_body' },
    ],
    tags: ['settings', 'display', 'theme', 'language', 'startup'],
  },
  {
    id: 'settings.print.company',
    moduleId: 'display',
    permission: 'settings',
    labelKey: 'manual_settings_print_company_title',
    summaryKey: 'manual_settings_print_company_summary',
    beforeYouStartKey: 'manual_settings_print_company_before',
    commonMistakesKey: 'manual_settings_print_company_mistakes',
    steps: [
      { titleKey: 'manual_settings_print_company_step_1_title', bodyKey: 'manual_settings_print_company_step_1_body' },
      { titleKey: 'manual_settings_print_company_step_2_title', bodyKey: 'manual_settings_print_company_step_2_body' },
      { titleKey: 'manual_settings_print_company_step_3_title', bodyKey: 'manual_settings_print_company_step_3_body' },
      { titleKey: 'manual_settings_print_company_step_4_title', bodyKey: 'manual_settings_print_company_step_4_body' },
      { titleKey: 'manual_settings_print_company_step_5_title', bodyKey: 'manual_settings_print_company_step_5_body' },
    ],
    relatedModule: { moduleId: 'reports', viewId: 'income' },
    tags: ['settings', 'print', 'company', 'logo', 'reportPrintProfiles'],
  },
  {
    id: 'settings.database.backup',
    moduleId: 'settings',
    viewId: 'database',
    permission: 'settings',
    labelKey: 'manual_settings_database_backup_title',
    summaryKey: 'manual_settings_database_backup_summary',
    beforeYouStartKey: 'manual_settings_database_backup_before',
    commonMistakesKey: 'manual_settings_database_backup_mistakes',
    steps: [
      { titleKey: 'manual_settings_database_backup_step_1_title', bodyKey: 'manual_settings_database_backup_step_1_body' },
      { titleKey: 'manual_settings_database_backup_step_2_title', bodyKey: 'manual_settings_database_backup_step_2_body' },
      { titleKey: 'manual_settings_database_backup_step_3_title', bodyKey: 'manual_settings_database_backup_step_3_body' },
      { titleKey: 'manual_settings_database_backup_step_4_title', bodyKey: 'manual_settings_database_backup_step_4_body' },
    ],
    tags: ['settings', 'backup', 'restore', 'export', 'postgres', 'firestore'],
  },
  {
    id: 'settings.database.push_production',
    moduleId: 'settings',
    viewId: 'database',
    permission: 'settings',
    labelKey: 'manual_settings_database_push_title',
    summaryKey: 'manual_settings_database_push_summary',
    beforeYouStartKey: 'manual_settings_database_push_before',
    commonMistakesKey: 'manual_settings_database_push_mistakes',
    steps: [
      { titleKey: 'manual_settings_database_push_step_1_title', bodyKey: 'manual_settings_database_push_step_1_body' },
      { titleKey: 'manual_settings_database_push_step_2_title', bodyKey: 'manual_settings_database_push_step_2_body' },
      { titleKey: 'manual_settings_database_push_step_3_title', bodyKey: 'manual_settings_database_push_step_3_body' },
      { titleKey: 'manual_settings_database_push_step_4_title', bodyKey: 'manual_settings_database_push_step_4_body' },
      { titleKey: 'manual_settings_database_push_step_5_title', bodyKey: 'manual_settings_database_push_step_5_body' },
    ],
    tags: ['settings', 'push', 'railway', 'postgres', 'production', 'local'],
  },
  {
    id: 'settings.database.maintenance',
    moduleId: 'settings',
    viewId: 'database',
    permission: 'settings',
    labelKey: 'manual_settings_database_maintenance_title',
    summaryKey: 'manual_settings_database_maintenance_summary',
    beforeYouStartKey: 'manual_settings_database_maintenance_before',
    commonMistakesKey: 'manual_settings_database_maintenance_mistakes',
    steps: [
      { titleKey: 'manual_settings_database_maintenance_step_1_title', bodyKey: 'manual_settings_database_maintenance_step_1_body' },
      { titleKey: 'manual_settings_database_maintenance_step_2_title', bodyKey: 'manual_settings_database_maintenance_step_2_body' },
      { titleKey: 'manual_settings_database_maintenance_step_3_title', bodyKey: 'manual_settings_database_maintenance_step_3_body' },
      { titleKey: 'manual_settings_database_maintenance_step_4_title', bodyKey: 'manual_settings_database_maintenance_step_4_body' },
      { titleKey: 'manual_settings_database_maintenance_step_5_title', bodyKey: 'manual_settings_database_maintenance_step_5_body' },
    ],
    tags: ['settings', 'clear', 'purge', 'delete', 'admin', 'warehouse'],
  },
  {
    id: 'settings.users.manage',
    moduleId: 'settings',
    viewId: 'users',
    permission: 'settings',
    labelKey: 'manual_settings_users_manage_title',
    summaryKey: 'manual_settings_users_manage_summary',
    beforeYouStartKey: 'manual_settings_users_manage_before',
    commonMistakesKey: 'manual_settings_users_manage_mistakes',
    steps: [
      { titleKey: 'manual_settings_users_manage_step_1_title', bodyKey: 'manual_settings_users_manage_step_1_body' },
      { titleKey: 'manual_settings_users_manage_step_2_title', bodyKey: 'manual_settings_users_manage_step_2_body' },
      { titleKey: 'manual_settings_users_manage_step_3_title', bodyKey: 'manual_settings_users_manage_step_3_body' },
      { titleKey: 'manual_settings_users_manage_step_4_title', bodyKey: 'manual_settings_users_manage_step_4_body' },
      { titleKey: 'manual_settings_users_manage_step_5_title', bodyKey: 'manual_settings_users_manage_step_5_body' },
    ],
    tags: ['settings', 'users', 'permissions', 'role', 'project_accountant'],
  },
  {
    id: 'settings.coa.tree',
    moduleId: 'settings',
    viewId: 'coa',
    permission: 'ledger',
    labelKey: 'manual_settings_coa_tree_title',
    summaryKey: 'manual_settings_coa_tree_summary',
    beforeYouStartKey: 'manual_settings_coa_tree_before',
    commonMistakesKey: 'manual_settings_coa_tree_mistakes',
    steps: [
      { titleKey: 'manual_settings_coa_tree_step_1_title', bodyKey: 'manual_settings_coa_tree_step_1_body' },
      { titleKey: 'manual_settings_coa_tree_step_2_title', bodyKey: 'manual_settings_coa_tree_step_2_body' },
      { titleKey: 'manual_settings_coa_tree_step_3_title', bodyKey: 'manual_settings_coa_tree_step_3_body' },
      { titleKey: 'manual_settings_coa_tree_step_4_title', bodyKey: 'manual_settings_coa_tree_step_4_body' },
    ],
    relatedModule: { moduleId: 'ledger', viewId: 'journal' },
    tags: ['settings', 'coa', 'ledger', '127', 'isGroup', 'leaf'],
  },
  {
    id: 'settings.cost_centers.indirect',
    moduleId: 'settings',
    viewId: 'cost_centers',
    permission: 'settings',
    labelKey: 'manual_settings_cost_centers_title',
    summaryKey: 'manual_settings_cost_centers_summary',
    beforeYouStartKey: 'manual_settings_cost_centers_before',
    commonMistakesKey: 'manual_settings_cost_centers_mistakes',
    steps: [
      { titleKey: 'manual_settings_cost_centers_step_1_title', bodyKey: 'manual_settings_cost_centers_step_1_body' },
      { titleKey: 'manual_settings_cost_centers_step_2_title', bodyKey: 'manual_settings_cost_centers_step_2_body' },
      { titleKey: 'manual_settings_cost_centers_step_3_title', bodyKey: 'manual_settings_cost_centers_step_3_body' },
      { titleKey: 'manual_settings_cost_centers_step_4_title', bodyKey: 'manual_settings_cost_centers_step_4_body' },
    ],
    relatedModule: { moduleId: 'overhead' },
    tags: ['settings', 'cost_center', 'indirect', 'HO', 'oha'],
  },
  {
    id: 'tools.calculator.use',
    moduleId: 'calculator',
    labelKey: 'manual_tools_calculator_title',
    summaryKey: 'manual_tools_calculator_summary',
    beforeYouStartKey: 'manual_tools_calculator_before',
    commonMistakesKey: 'manual_tools_calculator_mistakes',
    steps: [
      { titleKey: 'manual_tools_calculator_step_1_title', bodyKey: 'manual_tools_calculator_step_1_body' },
      { titleKey: 'manual_tools_calculator_step_2_title', bodyKey: 'manual_tools_calculator_step_2_body' },
      { titleKey: 'manual_tools_calculator_step_3_title', bodyKey: 'manual_tools_calculator_step_3_body' },
      { titleKey: 'manual_tools_calculator_step_4_title', bodyKey: 'manual_tools_calculator_step_4_body' },
    ],
    tags: ['calculator', 'tools', 'keyboard', 'history'],
  },
  {
    id: 'tools.offline.sync',
    moduleId: 'general',
    labelKey: 'manual_tools_offline_title',
    summaryKey: 'manual_tools_offline_summary',
    beforeYouStartKey: 'manual_tools_offline_before',
    commonMistakesKey: 'manual_tools_offline_mistakes',
    steps: [
      { titleKey: 'manual_tools_offline_step_1_title', bodyKey: 'manual_tools_offline_step_1_body' },
      { titleKey: 'manual_tools_offline_step_2_title', bodyKey: 'manual_tools_offline_step_2_body' },
      { titleKey: 'manual_tools_offline_step_3_title', bodyKey: 'manual_tools_offline_step_3_body' },
      { titleKey: 'manual_tools_offline_step_4_title', bodyKey: 'manual_tools_offline_step_4_body' },
    ],
    tags: ['offline', 'sync', 'draft', 'queue', 'network'],
  },
];

export function getManualTopic(id: ManualTopicId): ManualTopic | undefined {
  return MANUAL_TOPICS.find((t) => t.id === id);
}

function topicAllowed(
  topic: ManualTopic,
  permissions: UserPermissions,
  isAdmin?: boolean,
): boolean {
  if (isAdmin) return true;

  if (topic.permission && !canOpenModule(permissions, topic.permission, { isAdmin })) {
    return false;
  }

  if (topic.viewId) {
    return canOpenModuleView(permissions, topic.moduleId, topic.viewId, { isAdmin });
  }

  return canOpenModule(permissions, topic.moduleId, { isAdmin });
}

/** Exported for help buttons and tests — same rules as the manual topic list. */
export function isManualTopicAllowed(
  topic: ManualTopic,
  permissions: UserPermissions,
  isAdmin?: boolean,
): boolean {
  return topicAllowed(topic, permissions, isAdmin);
}

export function collectManualTopicTranslationKeys(topic: ManualTopic): string[] {
  const keys = [topic.labelKey, topic.summaryKey];
  if (topic.beforeYouStartKey) keys.push(topic.beforeYouStartKey);
  if (topic.commonMistakesKey) keys.push(topic.commonMistakesKey);
  for (const step of topic.steps) {
    keys.push(step.titleKey, step.bodyKey);
  }
  return keys;
}

function matchesQuery(topic: ManualTopic, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (topic.id.toLowerCase().includes(q)) return true;
  if (topic.moduleId.toLowerCase().includes(q)) return true;
  if (topic.viewId?.toLowerCase().includes(q)) return true;
  return topic.tags?.some((tag) => tag.toLowerCase().includes(q)) ?? false;
}

/** Topics visible to the user after module/view/tag filtering. */
export function resolveManualTopics(filter: ManualTopicFilter = {}): ManualTopic[] {
  let list = MANUAL_TOPICS.slice();

  if (filter.moduleId) {
    list = list.filter((t) => t.moduleId === filter.moduleId);
  }
  if (filter.viewId) {
    list = list.filter((t) => !t.viewId || t.viewId === filter.viewId);
  }
  if (filter.permissions) {
    list = list.filter((t) =>
      topicAllowed(t, filter.permissions!, filter.isAdmin),
    );
  }
  if (filter.query) {
    list = list.filter((t) => matchesQuery(t, filter.query!));
  }

  return list;
}

export function getManualTopicsForModule(
  moduleId: string,
  viewId?: string,
  permissions?: UserPermissions,
  isAdmin?: boolean,
): ManualTopic[] {
  return resolveManualTopics({ moduleId, viewId, permissions, isAdmin });
}

/** Deep-link: open manual window scrolled to this topic (consumed by OperationsManual). */
let pendingManualTopicId: ManualTopicId | null = null;

export function setPendingManualTopic(id: ManualTopicId | null): void {
  pendingManualTopicId = id;
}

export function consumePendingManualTopic(): ManualTopicId | undefined {
  const id = pendingManualTopicId ?? undefined;
  pendingManualTopicId = null;
  return id;
}

export const MANUAL_OPEN_EVENT = 'app:manual-open';
export const SHELL_NAVIGATE_EVENT = 'app:shell-navigate';

export function requestOpenManual(topicId?: ManualTopicId): void {
  if (topicId) setPendingManualTopic(topicId);
  window.dispatchEvent(new CustomEvent(MANUAL_OPEN_EVENT, { detail: { topicId } }));
}

export function requestShellNavigation(moduleId: string, viewId?: string): void {
  window.dispatchEvent(
    new CustomEvent(SHELL_NAVIGATE_EVENT, { detail: { moduleId, viewId } }),
  );
}
