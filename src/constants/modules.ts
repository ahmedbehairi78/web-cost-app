export interface ModuleDefinition {
  id: string;
  ar: string;
  en: string;
}

/** All navigable modules, in sidebar display order. Excludes 'settings'. */
export const STARTUP_MODULES: ModuleDefinition[] = [
  { id: 'dashboard',     ar: 'لوحة التحكم',           en: 'Dashboard' },
  { id: 'ledger',        ar: 'الأستاذ العام',          en: 'General Ledger' },
  { id: 'technical',     ar: 'المكتب الفني',           en: 'Technical Office' },
  { id: 'costs',         ar: 'التكاليف الفعلية',       en: 'Actual Costs' },
  { id: 'inventory',     ar: 'إدارة المخازن',          en: 'Inventory' },
  // { id: 'subcontractor', ar: 'مستخلصات الباطن', en: 'Subcontractor Extracts' }, // hidden — use ActualCosts IPC tab instead
  { id: 'assets',        ar: 'الأصول الثابتة',         en: 'Fixed Assets' },
  { id: 'payroll',       ar: 'الموارد البشرية',        en: 'HR & Payroll' },
  { id: 'banks',         ar: 'البنوك',                 en: 'Banks' },
  { id: 'cash_budget',   ar: 'بدجيت الالتزامات',       en: 'Cash Budget' },
  { id: 'reports',       ar: 'التقارير',               en: 'Reports' },
  { id: 'settings',      ar: 'الإعدادات',              en: 'Settings' },
];

/** Keyed map for WindowManager labels. */
export const MODULE_LABELS: Record<string, { ar: string; en: string }> = {
  ...Object.fromEntries(STARTUP_MODULES.map(({ id, ar, en }) => [id, { ar, en }])),
  projects: { ar: 'المشاريع', en: 'Projects' },
  boq: { ar: 'جداول الكميات', en: 'BOQ' },
  billing: { ar: 'المستخلصات', en: 'Billing (IPC)' },
  overhead: { ar: 'الفترات المحاسبية', en: 'Accounting Periods' },
  general: { ar: 'إعدادات عامة', en: 'General Settings' },
  display: { ar: 'إعدادات عامة', en: 'General Settings' },
  purchase_requests: { ar: 'أوامر الشراء', en: 'Purchase Requests' },
  cash_budget: { ar: 'بدجيت الالتزامات', en: 'Cash Budget' },
  calculator: { ar: 'الآلة الحاسبة', en: 'Calculator' },
  manual: { ar: 'دليل الاستخدام', en: 'User Guide' },
};

/** Default module opened on first login. */
export const DEFAULT_MODULE = 'ledger';

/** User preference: do not open any module on login (empty desktop). */
export const NONE_DEFAULT_MODULE = 'none';

const STARTUP_MODULE_IDS = new Set(STARTUP_MODULES.map((m) => m.id));

const LEGACY_STARTUP_MODULE_IDS: Record<string, string> = {
  projects: 'technical',
  boq: 'technical',
  billing: 'technical',
  overhead: 'ledger',
};

export function isNoDefaultModule(id: string | undefined | null): boolean {
  return id === NONE_DEFAULT_MODULE;
}

/** Valid startup module ids (excludes settings utility modules). */
export function normalizeDefaultModule(id: string | undefined | null): string {
  if (isNoDefaultModule(id)) return NONE_DEFAULT_MODULE;
  if (id && LEGACY_STARTUP_MODULE_IDS[id]) return LEGACY_STARTUP_MODULE_IDS[id];
  if (id && STARTUP_MODULE_IDS.has(id) && id !== 'settings') return id;
  return DEFAULT_MODULE;
}
