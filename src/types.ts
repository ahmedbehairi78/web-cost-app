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

// Minimal permissions for new users awaiting admin approval
export const DEFAULT_PERMISSIONS: UserPermissions = {
  dashboard: true,
  ledger: false,
  projects: false,
  boq: false,
  billing: false,
  costs: false,
  suppliers: false,
  reports: false,
  settings: false,
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

// ─── Domain types ──────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  projectCode: string;
  projectName: string;
  clientName: string;
  status: 'active' | 'completed' | 'suspended' | 'cancelled';
  createdAt: string;
  isDeleted?: boolean;
}

export interface Contract {
  id: string;
  projectId: string;
  contractNumber: string;
  contractValue: number;
  startDate: string;
  endDate?: string;
  isDeleted?: boolean;
}

export interface BOQItem {
  id: string;
  projectId: string;
  contractId?: string;
  itemCode: string;
  description: string;
  unit: string;
  quantity: number;
  unitRate: number;
  tenderAmount: number;
  isDeleted?: boolean;
  createdAt?: string;
}

export interface JournalEntry {
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
}

export interface Transaction {
  id: string;
  date: string;
  description: string;
  entries: JournalEntry[];
  isDeleted?: boolean;
  createdAt?: string;
  createdBy?: string;
  transactionType?: string;
}

export interface BillingRecord {
  id: string;
  projectId: string;
  contractId: string;
  billingNumber: string;
  date: string;
  submissionDate?: string;
  approvalDate?: string;
  paymentDate?: string;
  grossAmount: number;
  retentionPct?: number;
  retentionAmount?: number;
  whtPct?: number;
  whtAmount?: number;
  netPayable: number;
  status: 'draft' | 'submitted' | 'approved' | 'paid';
  transactionId?: string;
  isDeleted?: boolean;
}

export interface Supplier {
  id: string;
  supplierName: string;
  type: 'material' | 'labour' | 'equipment' | 'subcontractor';
  contact?: string;
  email?: string;
  address?: string;
  isDeleted?: boolean;
  createdAt?: string;
}

export interface PurchaseTransaction {
  id: string;
  supplierId: string;
  supplierName?: string;
  projectId?: string;
  contractId?: string;
  invoiceNumber: string;
  invoiceDate: string;
  amount: number;
  vatAmount?: number;
  totalAmount: number;
  whtPct?: number;
  whtAmount?: number;
  expenseAccountCode?: string;
  isDeleted?: boolean;
  createdAt?: string;
}

export interface ActualCost {
  id: string;
  projectId: string;
  description: string;
  amount: number;
  date: string;
  category?: string;
  isDeleted?: boolean;
  createdAt?: string;
}
