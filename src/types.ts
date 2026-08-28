import type { Timestamp } from 'firebase/firestore';

export type ModuleCrudPermission = {
  view: boolean;
  create: boolean;
  edit: boolean;
};

export type UserRole = 'admin' | 'projects_manager' | 'project_accountant' | 'user';

export type CrudModuleKey =
  | 'ledger'
  | 'projects'
  | 'boq'
  | 'billing'
  | 'costs'
  | 'costs_invoice'
  | 'costs_ipc'
  | 'costs_custody'
  | 'suppliers'
  | 'banks'
  | 'inventory'
  | 'subcontractor'
  | 'overhead'
  | 'assets'
  | 'payroll'
  | 'purchase_requests'
  | 'cash_budget';

export type PermissionKey = CrudModuleKey | 'dashboard' | 'reports' | 'settings';

export type UserPermissions = {
  dashboard: boolean;
  ledger: ModuleCrudPermission;
  projects: ModuleCrudPermission;
  boq: ModuleCrudPermission;
  billing: ModuleCrudPermission;
  /** Virtual/derived — union of costs_invoice|costs_ipc|costs_custody. Used by server route guards for backward compat. */
  costs: ModuleCrudPermission;
  costs_invoice: ModuleCrudPermission;
  costs_ipc: ModuleCrudPermission;
  costs_custody: ModuleCrudPermission;
  suppliers: ModuleCrudPermission;
  banks: ModuleCrudPermission;
  inventory: ModuleCrudPermission;
  subcontractor: ModuleCrudPermission;
  overhead: ModuleCrudPermission;
  assets: ModuleCrudPermission;
  payroll: ModuleCrudPermission;
  purchase_requests: ModuleCrudPermission;
  cash_budget: ModuleCrudPermission;
  reports: boolean;
  settings: boolean;
};

const allCrud = (): ModuleCrudPermission => ({ view: true, create: true, edit: true });
const noCrud = (): ModuleCrudPermission => ({ view: false, create: false, edit: false });

export const ALL_PERMISSIONS: UserPermissions = {
  dashboard: true,
  ledger: allCrud(),
  projects: allCrud(),
  boq: allCrud(),
  billing: allCrud(),
  costs: allCrud(),
  costs_invoice: allCrud(),
  costs_ipc: allCrud(),
  costs_custody: allCrud(),
  suppliers: allCrud(),
  banks: allCrud(),
  inventory: allCrud(),
  subcontractor: allCrud(),
  overhead: allCrud(),
  assets: allCrud(),
  payroll: allCrud(),
  purchase_requests: allCrud(),
  cash_budget: allCrud(),
  reports: true,
  settings: true,
};

// Minimal permissions for new users awaiting admin approval
export const DEFAULT_PERMISSIONS: UserPermissions = {
  dashboard: false,
  ledger: noCrud(),
  projects: noCrud(),
  boq: noCrud(),
  billing: noCrud(),
  costs: noCrud(),
  costs_invoice: noCrud(),
  costs_ipc: noCrud(),
  costs_custody: noCrud(),
  suppliers: noCrud(),
  banks: noCrud(),
  inventory: noCrud(),
  subcontractor: noCrud(),
  overhead: noCrud(),
  assets: noCrud(),
  payroll: noCrud(),
  // Available to all signed-in users (create requests; status edit for managers)
  purchase_requests: { view: true, create: true, edit: false },
  cash_budget: noCrud(),
  reports: false,
  settings: false,
};

export const BOOLEAN_MODULES: { id: 'dashboard' | 'reports' | 'settings'; ar: string; en: string }[] = [
  { id: 'dashboard', ar: 'لوحة التحكم', en: 'Dashboard' },
  { id: 'reports', ar: 'التقارير', en: 'Reports' },
  { id: 'settings', ar: 'الإعدادات', en: 'Settings' },
];

export const CRUD_MODULES: { id: CrudModuleKey; ar: string; en: string; group?: string }[] = [
  { id: 'ledger', ar: 'الأستاذ العام', en: 'General Ledger' },
  { id: 'projects', ar: 'المشاريع', en: 'Projects' },
  { id: 'boq', ar: 'جداول الكميات', en: 'BOQ' },
  { id: 'billing', ar: 'المستخلصات', en: 'Billing' },
  { id: 'costs_invoice', ar: 'فاتورة مشتريات', en: 'Purchase Invoice', group: 'costs' },
  { id: 'costs_ipc', ar: 'مستخلص مقاول', en: 'Subcontractor IPC', group: 'costs' },
  { id: 'costs_custody', ar: 'تسوية عهدة', en: 'Custody Settlement', group: 'costs' },
  { id: 'suppliers', ar: 'الموردون', en: 'Suppliers' },
  { id: 'banks', ar: 'البنوك', en: 'Banks' },
  { id: 'cash_budget', ar: 'موازنة نقدية', en: 'Cash budget' },
  { id: 'inventory', ar: 'إدارة المخازن', en: 'Inventory' },
  { id: 'purchase_requests', ar: 'أوامر الشراء', en: 'Purchase Requests' },
  { id: 'assets', ar: 'الأصول الثابتة', en: 'Fixed Assets' },
  { id: 'payroll', ar: 'الموارد البشرية', en: 'HR & Payroll' },
  { id: 'subcontractor', ar: 'مقاولو الباطن', en: 'Subcontractors' },
  { id: 'overhead', ar: 'الفترات المحاسبية', en: 'Accounting Periods' },
];

export interface AppUser {
  id: string;
  email: string;
  displayName?: string | null;
  role: UserRole;
  permissions: UserPermissions;
  assignedContractIds?: string[];
  assignedProjectIds?: string[];
  phoneE164?: string | null;
  whatsappOptIn?: boolean;
  preferredLanguage?: 'ar' | 'en';
  isPending?: boolean;
}

export type AppNotificationPriority = 'urgent' | 'normal' | 'low';

export interface AppNotificationItem {
  key: string;
  type: string;
  priority: AppNotificationPriority;
  titleAr: string;
  titleEn: string;
  moduleId: string;
  entityId?: string;
  contractId?: string;
  projectId?: string;
  createdAt: string;
  dueAt?: string;
  read: boolean;
}

export type NotificationActionType = 'approve' | 'reject';

export interface NotificationItemDetail {
  key: string;
  type: string;
  priority: string;
  titleAr: string;
  titleEn: string;
  moduleId: string;
  entityId?: string;
  allowedActions: NotificationActionType[];
  summary: Record<string, string>;
}

// ─── Domain types ──────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  projectCode: string;
  projectName: string;
  clientName: string;
  status: 'active' | 'completed' | 'suspended' | 'cancelled';
  createdAt: string;
  inventoryAccountCode?: string;
  coverLogoLeft?: string | null;
  coverLogoCenter?: string | null;
  coverLogoRight?: string | null;
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
  costCenterId?: string | null;
}

export interface Transaction {
  id: string;
  date: string;
  description: string;
  descriptionEn?: string | null;
  reference?: string;
  projectId?: string;
  costCenterId?: string;
  entries: JournalEntry[];
  isDeleted?: boolean;
  createdAt?: string;
  createdBy?: string;
  transactionType?: string;
  /** fiscal_pl_close | fiscal_opening — opening excluded from rolling report totals */
  journalKind?: string | null;
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
  type: 'material' | 'labour' | 'equipment' | 'subcontractor' | 'supplier';
  serviceKind?: 'works' | 'labour' | 'equipment' | 'vehicles' | 'housing' | null;
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

// ─── مستخلصات التشوين (Material On-Site — MOS) ──────────────────────────────────

export type MosStatus = 'draft' | 'approved' | 'superseded';

export type MosPhase = 'initial' | 'periodic';

export interface MosCertificateLine {
  id: string;
  certificateId: string;
  boqItemId: string;
  suppliedQtyThisPeriod: number;
  suppliedQtyCumulative: number;
  onSitePercentage: number;
  equivalentQty: number;
  equivalentCumulative: number;
  unitPrice: number;
  claimedAmount: number;
  boqItemDescription?: string | null;
  boqItemUnit?: string | null;
  boqItemCode?: string | null;
  tenderQty?: number | null;
}

export interface MosCertificate {
  id: string;
  contractId: string;
  certificateNo: string;
  sequenceNo: number;
  phase: MosPhase;
  extractDate?: string | null;
  deliveryNoteRef?: string | null;
  notes?: string | null;
  status: MosStatus;
  totalClaimed: number;
  transactionId?: string | null;
  createdBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
  lines: MosCertificateLine[];
}

export type VoLineType = 'new_item' | 'adjust' | 'delete_item';
export type VoStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export interface VariationOrderLine {
  id: string;
  variationOrderId: string;
  lineType: VoLineType;
  boqItemId?: string | null;
  createdBoqItemId?: string | null;
  itemCode?: string | null;
  description?: string | null;
  unit?: string | null;
  chapterCode?: string | null;
  chapterName?: string | null;
  workTypeCode?: string | null;
  sectionCode?: string | null;
  sectionName?: string | null;
  tenderQty?: number | null;
  unitRateTotal?: number | null;
  newTenderQty?: number | null;
  newUnitRate?: number | null;
  lineAmount: number;
  boqItemCode?: string | null;
  boqItemDescription?: string | null;
  boqItemUnit?: string | null;
  boqTenderQty?: number | null;
  boqUnitRate?: number | null;
}

export interface VariationOrder {
  id: string;
  contractId: string;
  projectId: string;
  voNumber: string;
  sequenceNo: number;
  voDate?: string | null;
  title: string;
  notes?: string | null;
  status: VoStatus;
  totalValue: number;
  createdBy?: string | null;
  approvedBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
  lines: VariationOrderLine[];
}

/** صف مستخلص تشوين كما يُرجَع من الـ SQLite backend (financial core). */
export interface MosExtract {
  id: string;
  firestoreId?: string;
  contractId: string;
  boqItemId: string;

  suppliedQuantity: number;
  onSitePercentage: number;
  equivalentQuantity: number;
  unitPrice: number;
  claimedAmount: number;

  deliveryNoteRef?: string;
  extractNumber?: string;
  extractDate?: string;
  notes?: string;

  status: MosStatus;
  transactionId?: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;

  // حقول مُدمجة من Firestore / SQL JOIN (للعرض فقط)
  boqItemDescription?: string;
  boqItemUnit?: string;
}

/** مستند مستخلص التشوين في Firestore — collection مستقلة عن billing. */
export interface MosFirestoreDoc {
  contractId: string;
  boqItemId: string;
  boqItemDescription?: string;
  boqItemUnit?: string;

  suppliedQuantity: number;
  onSitePercentage: number;
  equivalentQuantity: number;
  unitPrice: number;
  claimedAmount: number;

  deliveryNoteRef?: string;
  extractNumber?: string;
  extractDate?: string;
  notes?: string;

  status: MosStatus;
  sqliteId?: string;       // id في SQLite بعد الاعتماد
  transactionId?: string;  // قيد GL

  createdBy?: string;
  createdAt?: Timestamp | Date | string;
  updatedAt?: Timestamp | Date | string;
  isDeleted?: boolean;
}
