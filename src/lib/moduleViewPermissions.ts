import { getModuleMenu } from '../constants/moduleMenus';
import type { PermissionKey, UserPermissions } from '../types';
import { canOpenModule, hasModuleView } from './permissions';

/** Settings sidebar / ERP menu entries that require the `settings` permission. */
export const SETTINGS_ADMIN_VIEW_IDS = new Set(['cost_centers', 'activity', 'sample_data']);

/** Maps ERP menu sub-view → permission key(s). Settings uses a single `settings` flag for all views. */
export const MODULE_VIEW_PERMISSION_MAP: Record<
  string,
  Record<string, PermissionKey | readonly PermissionKey[]>
> = {
  ledger: {
    journal: 'ledger',
    statement: 'ledger',
    periods: 'overhead',
  },
  technical: {
    projects: 'projects',
    boq: 'boq',
    billing: 'billing',
    documents: 'billing',
  },
  costs: {
    invoice: 'costs_invoice',
    ipc: 'costs_ipc',
    custody: ['costs_custody', 'ledger'] as const,
  },
  inventory: {
    materials: 'inventory',
    balance: 'inventory',
    receipts: 'inventory',
    transfers: 'inventory',
    history: 'inventory',
  },
  banks: {
    accounts: 'banks',
    transactions: 'banks',
    movements: 'banks',
    cheques: 'banks',
    statements: 'banks',
    account_statement: 'banks',
  },
  reports: {
    income: 'reports',
    budget: 'reports',
    balance: 'reports',
    trial: 'reports',
    time: 'reports',
    liquidity: 'reports',
    costs: 'reports',
  },
  dashboard: {
    main: 'dashboard',
  },
  assets: {
    register: 'assets',
    depreciation: 'assets',
  },
  payroll: {
    runs: 'payroll',
    employees: 'payroll',
    settings: 'payroll',
  },
  purchase_requests: {
    create: 'purchase_requests',
    open: 'purchase_requests',
    executed: 'purchase_requests',
  },
  cash_budget: {
    main: 'cash_budget',
  },
};

/** Admin UI hints — which menu labels each CRUD/boolean permission unlocks. */
export const PERMISSION_MENU_HINTS: Partial<
  Record<PermissionKey, { ar: string; en: string }[]>
> = {
  ledger: [
    { ar: 'دفتر اليومية', en: 'Journal entries' },
    { ar: 'كشف حساب', en: 'Account statement' },
  ],
  overhead: [
    { ar: 'توزيع الأعباء (OHA)', en: 'Overhead allocation (OHA)' },
    { ar: 'قفل الفترة المحاسبية', en: 'Accounting period lock' },
    { ar: 'إقفال قائمة الدخل / الافتتاحي', en: 'Income close / opening entry' },
  ],
  projects: [{ ar: 'المشاريع (المكتب الفني)', en: 'Projects (Technical office)' }],
  boq: [{ ar: 'جداول الكميات (المكتب الفني)', en: 'BOQ (Technical office)' }],
  billing: [
    { ar: 'المستخلصات (المكتب الفني)', en: 'Billing (Technical office)' },
    { ar: 'مستندات المكتب الفني', en: 'Technical office documents' },
  ],
  costs_invoice: [{ ar: 'فاتورة مشتريات', en: 'Purchase invoice' }],
  costs_ipc: [{ ar: 'مستخلص مقاول', en: 'Subcontractor IPC' }],
  costs_custody: [{ ar: 'تسوية عهدة', en: 'Custody settlement' }],
  suppliers: [{ ar: 'الموردون (مرجع الفواتير والمستخلصات)', en: 'Suppliers (invoice & IPC reference)' }],
  subcontractor: [{ ar: 'مقاولو الباطن', en: 'Subcontractors' }],
  inventory: [
    { ar: 'الأصناف · الرصيد · التحويلات · الصرف والإرجاع', en: 'Materials · Balance · Transfers · Issues & returns' },
  ],
  banks: [
    { ar: 'كشف حساب بنكي', en: 'Bank account statement' },
    { ar: 'المعاملات (حركات وشيكات)', en: 'Transactions (movements & cheques)' },
    { ar: 'كشوف البنك', en: 'Bank statements' },
  ],
  reports: [
    { ar: 'قائمة الدخل', en: 'Income statement' },
    { ar: 'الميزانية vs الفعلي', en: 'Budget vs actual' },
    { ar: 'الميزانية العمومية', en: 'Balance sheet' },
    { ar: 'ميزان المراجعة', en: 'Trial balance' },
    { ar: 'الجدول الزمني', en: 'Timeline' },
    { ar: 'تقرير السيولة', en: 'Liquidity' },
    { ar: 'تكاليف BOQ', en: 'BOQ costs' },
  ],
  settings: [
    { ar: 'قاعدة البيانات', en: 'Database' },
    { ar: 'إدارة المستخدمين', en: 'User management' },
    { ar: 'شجرة الحسابات', en: 'Chart of accounts' },
    { ar: 'مراكز التكلفة · سجل النشاط · بيانات تجريبية', en: 'Cost centers · Activity · Sample data' },
  ],
  assets: [
    { ar: 'سجل الأصول الثابتة', en: 'Fixed assets register' },
    { ar: 'إهلاك الفترة', en: 'Period depreciation' },
  ],
  payroll: [
    { ar: 'سجل الموظفين', en: 'Employee register' },
    { ar: 'كشوف الرواتب الشهرية', en: 'Monthly payroll sheets' },
    { ar: 'إعدادات الموارد البشرية', en: 'HR settings' },
  ],
  purchase_requests: [
    { ar: 'إنشاء طلب', en: 'Create request' },
    { ar: 'الطلبات النشطة', en: 'Open requests' },
    { ar: 'الطلبات المنتهية', en: 'Executed requests' },
  ],
  cash_budget: [
    { ar: 'الموازنة النقدية الأسبوعية/الشهرية', en: 'Weekly / monthly cash budget' },
  ],
  dashboard: [{ ar: 'لوحة التحكم الرئيسية', en: 'Main dashboard' }],
};

function permissionKeysAllowView(
  permissions: UserPermissions,
  keys: PermissionKey | readonly PermissionKey[],
  _opts?: { isAdmin?: boolean },
): boolean {
  const list = Array.isArray(keys) ? keys : [keys];
  return list.some((key) => {
    if (key === 'dashboard' || key === 'reports' || key === 'settings') {
      return permissions[key] === true;
    }
    return canOpenModule(permissions, key);
  });
}

/** Whether the user may open a specific ERP menu sub-view. */
export function canOpenModuleView(
  permissions: UserPermissions,
  moduleId: string,
  viewId: string,
  _opts?: { isAdmin?: boolean },
): boolean {
  if (moduleId === 'purchase_requests') return true;

  if (moduleId === 'settings') {
    if (!hasModuleView(permissions, 'settings')) return false;
    if (viewId === 'coa' && !hasModuleView(permissions, 'ledger')) return false;
    return true;
  }

  const moduleMap = MODULE_VIEW_PERMISSION_MAP[moduleId];
  const keys = moduleMap?.[viewId];
  if (keys) return permissionKeysAllowView(permissions, keys);

  return canOpenModule(permissions, moduleId);
}

/** First sub-view the user may open for a shell module (for default navigation). */
export function firstPermittedModuleView(
  permissions: UserPermissions,
  moduleId: string,
  opts?: { isAdmin?: boolean },
): string | undefined {
  const menu = getModuleMenu(moduleId);
  if (!menu) return undefined;
  for (const view of menu.views) {
    if (canOpenModuleView(permissions, moduleId, view.viewId, opts)) return view.viewId;
  }
  return undefined;
}

/** Permission key to cite when denying a sub-view (for toast / tooltip). */
export function permissionKeyForModuleView(moduleId: string, viewId: string): PermissionKey {
  if (moduleId === 'settings') return 'settings';
  const keys = MODULE_VIEW_PERMISSION_MAP[moduleId]?.[viewId];
  if (!keys) return moduleId as PermissionKey;
  const first = Array.isArray(keys) ? (keys as readonly PermissionKey[])[0] : keys;
  return first as PermissionKey;
}
