export type UserPermissions = {
  dashboard: boolean;
  ledger: boolean;
  projects: boolean;
  boq: boolean;
  billing: boolean;
  costs: boolean;
  suppliers: boolean;
  reports: boolean;
  settings: boolean;
};

export const ALL_PERMISSIONS: UserPermissions = {
  dashboard: true,
  ledger: true,
  projects: true,
  boq: true,
  billing: true,
  costs: true,
  suppliers: true,
  reports: true,
  settings: true,
};

export const MODULES: { id: keyof UserPermissions; ar: string; en: string }[] = [
  { id: 'dashboard', ar: 'لوحة التحكم', en: 'Dashboard' },
  { id: 'ledger', ar: 'الأستاذ العام', en: 'General Ledger' },
  { id: 'projects', ar: 'المشاريع', en: 'Projects' },
  { id: 'boq', ar: 'جداول الكميات', en: 'BOQ' },
  { id: 'billing', ar: 'المستخلصات', en: 'Billing' },
  { id: 'costs', ar: 'التكاليف الفعلية', en: 'Costs' },
  { id: 'suppliers', ar: 'المشتريات', en: 'Purchases' },
  { id: 'reports', ar: 'التقارير', en: 'Reports' },
  { id: 'settings', ar: 'الإعدادات', en: 'Settings' },
];

export interface AppUser {
  id: string;
  email: string;
  role: 'admin' | 'user';
  permissions: UserPermissions;
  isPending?: boolean;
}
