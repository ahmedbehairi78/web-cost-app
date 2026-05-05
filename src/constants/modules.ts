export interface ModuleDefinition {
  id: string;
  ar: string;
  en: string;
}

/** All navigable modules, in sidebar display order. Excludes 'settings'. */
export const STARTUP_MODULES: ModuleDefinition[] = [
  { id: 'dashboard', ar: 'لوحة التحكم',     en: 'Dashboard' },
  { id: 'ledger',    ar: 'الأستاذ العام',    en: 'General Ledger' },
  { id: 'projects',  ar: 'المشاريع',         en: 'Projects' },
  { id: 'boq',       ar: 'جداول الكميات',    en: 'BOQ' },
  { id: 'costs',     ar: 'التكاليف الفعلية', en: 'Actual Costs' },
  { id: 'billing',   ar: 'المستخلصات',       en: 'Billing (IPC)' },
  { id: 'reports',   ar: 'التقارير',         en: 'Reports' },
  { id: 'liquidity', ar: 'تقرير السيولة',    en: 'Liquidity Report' },
  { id: 'settings',  ar: 'الإعدادات',        en: 'Settings' },
];

/** Keyed map for WindowManager labels. */
export const MODULE_LABELS: Record<string, { ar: string; en: string }> = Object.fromEntries(
  STARTUP_MODULES.map(({ id, ar, en }) => [id, { ar, en }])
);

/** Default module opened on first login. */
export const DEFAULT_MODULE = 'ledger';
