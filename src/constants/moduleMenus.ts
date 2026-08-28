/** Sub-views per shell module — used by ERP top-nav dropdowns. */
export interface ModuleMenuView {
  viewId: string;
  labelKey: string;
}

export interface ModuleMenuDef {
  moduleId: string;
  defaultViewId: string;
  views: ModuleMenuView[];
}

// `manual` is a full workspace module in the ERP shell (single-module slot), not a floating utility.
export const ERP_UTILITY_MODULE_IDS = new Set(['calculator', 'general', 'display']);

export const MODULE_MENUS: Record<string, ModuleMenuDef> = {
  dashboard: {
    moduleId: 'dashboard',
    defaultViewId: 'main',
    views: [{ viewId: 'main', labelKey: 'dashboard' }],
  },
  ledger: {
    moduleId: 'ledger',
    defaultViewId: 'journal',
    views: [
      { viewId: 'journal', labelKey: 'gl_menu_journal' },
      { viewId: 'statement', labelKey: 'gl_menu_statement' },
      { viewId: 'periods', labelKey: 'gl_menu_periods' },
    ],
  },
  technical: {
    moduleId: 'technical',
    defaultViewId: 'projects',
    views: [
      { viewId: 'projects', labelKey: 'technical_menu_projects' },
      { viewId: 'boq', labelKey: 'technical_menu_boq' },
      { viewId: 'billing', labelKey: 'technical_menu_billing' },
      { viewId: 'documents', labelKey: 'technical_menu_documents' },
    ],
  },
  costs: {
    moduleId: 'costs',
    defaultViewId: 'invoice',
    views: [
      { viewId: 'invoice', labelKey: 'costs_menu_invoice' },
      { viewId: 'ipc', labelKey: 'costs_menu_ipc' },
      { viewId: 'service_ipc', labelKey: 'costs_menu_service_ipc' },
      { viewId: 'custody', labelKey: 'costs_menu_custody' },
    ],
  },
  inventory: {
    moduleId: 'inventory',
    defaultViewId: 'balance',
    views: [
      { viewId: 'materials', labelKey: 'inventory_menu_materials' },
      { viewId: 'balance', labelKey: 'inventory_menu_balance' },
      { viewId: 'receipts', labelKey: 'inventory_menu_receipts' },
      { viewId: 'transfers', labelKey: 'inventory_menu_transfers' },
      { viewId: 'history', labelKey: 'inventory_menu_history' },
    ],
  },
  banks: {
    moduleId: 'banks',
    defaultViewId: 'accounts',
    views: [
      { viewId: 'accounts', labelKey: 'banks_menu_accounts' },
      { viewId: 'transactions', labelKey: 'banks_menu_transactions' },
      { viewId: 'statements', labelKey: 'banks_menu_statements' },
    ],
  },
  reports: {
    moduleId: 'reports',
    defaultViewId: 'income',
    views: [
      { viewId: 'income', labelKey: 'reports_menu_income' },
      { viewId: 'budget', labelKey: 'reports_menu_budget' },
      { viewId: 'balance', labelKey: 'reports_menu_balance' },
      { viewId: 'trial', labelKey: 'reports_menu_trial' },
      { viewId: 'time', labelKey: 'reports_menu_time' },
      { viewId: 'liquidity', labelKey: 'reports_menu_liquidity' },
      { viewId: 'costs', labelKey: 'reports_menu_costs' },
    ],
  },
  settings: {
    moduleId: 'settings',
    defaultViewId: 'database',
    views: [
      { viewId: 'database', labelKey: 'database_settings' },
      { viewId: 'users', labelKey: 'user_settings' },
      { viewId: 'coa', labelKey: 'coa_setup_section' },
      { viewId: 'cost_centers', labelKey: 'indirect_centers_section' },
      { viewId: 'activity', labelKey: 'activity_log_section' },
    ],
  },
  assets: {
    moduleId: 'assets',
    defaultViewId: 'register',
    views: [
      { viewId: 'register', labelKey: 'assets_menu_register' },
      { viewId: 'depreciation', labelKey: 'assets_menu_depreciation' },
    ],
  },
  payroll: {
    moduleId: 'payroll',
    defaultViewId: 'runs',
    views: [
      { viewId: 'runs', labelKey: 'payroll_menu_runs' },
      { viewId: 'employees', labelKey: 'payroll_menu_employees' },
      { viewId: 'settings', labelKey: 'payroll_menu_settings' },
    ],
  },
  purchase_requests: {
    moduleId: 'purchase_requests',
    defaultViewId: 'open',
    views: [
      { viewId: 'create', labelKey: 'pr_menu_create' },
      { viewId: 'open', labelKey: 'pr_menu_open' },
      { viewId: 'executed', labelKey: 'pr_menu_executed' },
    ],
  },
  cash_budget: {
    moduleId: 'cash_budget',
    defaultViewId: 'main',
    views: [
      { viewId: 'main', labelKey: 'cash_budget' },
    ],
  },
};

export function getModuleMenu(moduleId: string): ModuleMenuDef | undefined {
  return MODULE_MENUS[moduleId];
}

export function resolveModuleViewId(moduleId: string, viewId?: string): string {
  const menu = getModuleMenu(moduleId);
  if (!menu) return viewId ?? 'main';
  if (viewId && menu.views.some((v) => v.viewId === viewId)) return viewId;
  return menu.defaultViewId;
}

export function moduleHasViewDropdown(moduleId: string): boolean {
  const menu = getModuleMenu(moduleId);
  return (menu?.views.length ?? 0) > 1;
}
