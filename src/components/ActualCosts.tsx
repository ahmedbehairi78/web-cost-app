import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useErpModuleDraft, useErpModuleView } from '../hooks/useErpModuleView';
import {
  Plus, Search, ShoppingCart, X, FileText, Receipt, Loader2,
  Download, Upload, Trash2, AlertTriangle, CheckCircle2, Clock, Filter, Printer
} from 'lucide-react';
import { collection, query, addDoc, serverTimestamp, where, orderBy, limit, writeBatch, doc, getDoc, updateDoc } from 'firebase/firestore';
import { listenQuery } from '../lib/firestoreListen';
import { BILLING_DEFAULTS } from '../constants/billingDefaults';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { ApiError } from '../lib/apiClient';
import {
  accountingService,
  invalidateCoaCache,
  buildSubcontractorIpcEntries,
  buildPurchaseWithholdingJournalLines,
  type Account,
} from '../services/accountingService';
import { NetworkQueuedError } from '../lib/offline/offlineWrite';
import { ManualHelpButton } from './help/ManualHelpButton';
import type { ManualTopicId } from '../lib/operationsManual';
import { JournalPreviewModal, type JournalPreviewEntry } from './gl/JournalPreviewModal';
import { motion, AnimatePresence } from 'motion/react';
import { cn, roundMoney2 } from '../lib/utils';
import { roundMoney } from '../lib/money';
import { formatQuantity } from '../lib/formatQuantity';
import { useLanguage } from '../context/LanguageContext';
import { displayLocale, formatNumber } from '../lib/numberLocale';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import { SearchableSelect } from './ui/SearchableSelect';
import { SpreadsheetCellInput } from './ui/SpreadsheetCellInput';
import { chartLeafAccountOptions } from '../lib/chartOfAccountsPicker';
import { GLCustodySettlement } from './gl/GLCustodySettlement';
import { PurchaseTransactionDetail } from './actualCosts/PurchaseTransactionDetail';
import { useUserAccessScope } from '../hooks/useUserAccessScope';
import { usePermissions } from '../context/PermissionsContext';
import { isLocalBackend } from '../lib/dataBackend';
import {
  sqliteCoreApi,
  inventoryApi,
  materialsApi,
  purchaseTransactionsApi,
  glApi,
  suppliersApi,
  chartOfAccountsApi,
  boqApi,
  projectsApi,
  contractsApi,
  costCentersApi,
  settingsApi,
  type MaterialCategory,
} from '../services/local/modulesApi';
import { useIpcPrintPreview } from '../hooks/useIpcPrintPreview';
import {
  buildSubcontractorIpcPrintData,
  mapToIpcPrintItems,
  type CompanyPrintInfo,
} from '../lib/ipcPrintData';
import type { StoredReportPrintProfiles } from '../lib/reportPrintProfiles';
import {
  ensureLocalContractExists,
  ensureLocalProjectExists,
  nullIfEmpty,
} from '../lib/localEntitySync';
import { useFirestoreQuery } from '../hooks/useFirestoreQuery';
import { useApiQuery } from '../hooks/useApiQuery';
import { useChartOfAccountsRef } from '../hooks/useChartOfAccountsRef';
import type { Supplier, BOQItem } from '../types';
import {
  LISTENER_GL_TX_SCREEN_CAP,
  LISTENER_PURCHASE_TX_CAP,
} from '../constants/dataLimits';
import {
  isProjectWarehouseAccount,
  resolveProjectIdForWarehouse,
} from '../lib/projectWarehouse';
import {
  buildCostCenterSelectOptions,
  isDirectCostCenterId,
} from '../lib/costCenterPicker';
import {
  consumePendingCostsIpcId,
  consumePendingCustodySettlementId,
  consumePendingShellView,
  peekPendingShellView,
} from '../lib/shellNavigation';

// ─── Types ────────────────────────────────────────────────────────────────────

type InvoicePaymentType = 'credit' | 'cash';

function normalizeInvoicePaymentType(value: unknown): InvoicePaymentType {
  return value === 'cash' ? 'cash' : 'credit';
}

/** Active 8-digit custody / cash-on-hand leaves under 12102. */
function isCustodyOrCashFundAccount(account: { isGroup?: boolean; status?: string; accountCode?: string }): boolean {
  if (!account || account.isGroup || account.status === 'disabled') return false;
  const code = String(account.accountCode || '').trim();
  return code.startsWith('12102') && code.length === 8;
}

interface PurchaseTransaction {
  id: string;
  type: 'invoice' | 'ipc';
  supplierId: string;
  /** `chart_of_accounts` doc linked to creditor (fills when picker uses COA or after record). */
  supplierAccountId?: string;
  supplierName: string;
  /** `credit` (آجلة) · `cash` (نقدية via 12102). Missing → credit. */
  paymentType?: InvoicePaymentType | string | null;
  projectId: string;
  contractId: string;
  date: string;
  referenceNumber: string;
  amount: number;
  vatAmount: number;
  whtAmount?: number;
  execGuaranteeAmount?: number;
  labourInsuranceAmount?: number;
  manpowerLevyAmount?: number;
  advancePaymentRecovery?: number;
  totalAmount: number;
  description: string;
  status: 'pending' | 'approved' | 'paid' | 'draft' | 'submitted';
  items?: BillingItem[];
  whtPct?: number;
  execGuaranteePct?: number;
  expenseAccountId?: string;
  createdAt?: { toDate(): Date } | Date | string | null;
  transactionId?: string;
  isDeleted?: boolean;
  /** Firestore / extended API fields for invoice preview */
  invoiceLines?: InvoiceLineDraft[];
  warehouseAccountId?: string;
  inventoryAccountCode?: string;
  inventoryAccountName?: string;
}

type IpcSaveMode = 'draft' | 'submit' | 'approve';

function isIpcJournalPosted(tx: Pick<PurchaseTransaction, 'type' | 'status' | 'transactionId'>): boolean {
  if (tx.type !== 'ipc') return Boolean(tx.transactionId);
  return Boolean(tx.transactionId) || tx.status === 'approved';
}

function resolveIpcWorkflowStatus(tx: PurchaseTransaction): PurchaseTransaction['status'] {
  if (tx.type !== 'ipc') return tx.status;
  if (isIpcJournalPosted(tx)) return 'approved';
  if (tx.status === 'draft' || tx.status === 'submitted') return tx.status;
  if (tx.status === 'pending' && !tx.transactionId) return 'submitted';
  return tx.status;
}

function safePctFromAmount(part: number, whole: number, fallback: number): number {
  return whole > 0 ? Math.round((part / whole) * 10000) / 100 : fallback;
}

interface BillingItem {
  boqItemId: string;
  itemCode: string;
  description: string;
  unit: string;
  rate: number;
  previousQty: number;
  currentQty: number;
  totalQty: number;
  amount: number;
}

interface InvoiceLineDraft {
  id: string;
  materialCategoryId?: number;
  itemDescription: string;
  unit: string;
  quantity: number;
  unitCost: number;
  boqItemId?: string;
  boqItemIds?: string[]; // Multiple BOQ items per line
}

interface InventoryBalanceItem {
  id: number;
  projectId?: string;
  contractId?: string;
  contractName?: string;
  contractNumber?: string;
  materialCategoryId?: number;
  itemDescription: string;
  unit: string;
  quantityBalance: number;
  quantityAvailable: number;
  unitCost: number;
}

type ProjectRow = { id: string; projectName: string; inventoryAccountCode?: string; isDeleted?: boolean; [k: string]: unknown };
type ContractRow = { id: string; contractName: string; contractNumber: string; contractNameEn?: string | null; projectId?: string; isDeleted?: boolean; [k: string]: unknown };
type CustodyGlTransaction = {
  id: string;
  date: string;
  description: string;
  reference: string;
  costCenterId?: string;
  isDeleted?: boolean;
  entries: { accountCode: string; accountName: string; debit: number; credit: number }[];
  createdBy: string;
};

type ActiveTab = 'invoice' | 'ipc' | 'custody';

interface ActualCostsDraft {
  activeTab: ActiveTab;
}

function isActiveTab(value: string): value is ActiveTab {
  return value === 'invoice' || value === 'ipc' || value === 'custody';
}

type PurchaseStatusFilter = 'all' | 'draft' | 'submitted' | 'approved' | 'pending' | 'posted' | 'paid';

function matchesPurchaseStatusFilter(
  tx: PurchaseTransaction,
  tab: 'invoice' | 'ipc',
  filter: PurchaseStatusFilter,
): boolean {
  if (filter === 'all') return true;
  if (tab === 'ipc') {
    const st = resolveIpcWorkflowStatus(tx);
    if (filter === 'draft') return st === 'draft';
    if (filter === 'submitted') return st === 'submitted';
    if (filter === 'approved') return st === 'approved';
    if (filter === 'paid') return tx.status === 'paid';
    return false;
  }
  if (filter === 'posted') return Boolean(tx.transactionId);
  if (filter === 'pending') return !tx.transactionId && tx.status !== 'paid';
  if (filter === 'paid') return tx.status === 'paid';
  return false;
}

function purchaseStatusLabel(
  tx: PurchaseTransaction,
  tab: 'invoice' | 'ipc',
  language: string,
): string {
  const isAr = language === 'ar';
  if (tab === 'ipc') {
    const st = resolveIpcWorkflowStatus(tx);
    if (st === 'approved') return isAr ? 'معتمد' : 'Approved';
    if (st === 'submitted') return isAr ? 'بانتظار الاعتماد' : 'Awaiting approval';
    if (st === 'draft') return isAr ? 'مسودة' : 'Draft';
    if (tx.status === 'paid') return isAr ? 'تم السداد' : 'Paid';
    return isAr ? 'معلق' : 'Pending';
  }
  if (tx.transactionId) return isAr ? 'مرحّلة' : 'Posted';
  if (tx.status === 'paid') return isAr ? 'تم السداد' : 'Paid';
  return isAr ? 'معلق' : 'Pending';
}

const CREDITOR_PARENT_BY_TAB: Record<'invoice' | 'ipc', string> = {
  invoice: '21101',
  ipc: '21102',
};

function supplierDirectoryLabel(
  row: Supplier | undefined,
  language: string,
): string | undefined {
  if (!row) return undefined;
  const r = row as Supplier & { name?: string; nameEn?: string };
  if (language === 'ar') return r.name || r.supplierName;
  return r.nameEn || r.name || r.supplierName;
}

/** Leaf creditors for purchase invoice (suppliers) vs IPC (subcontractors), from COA only. */
function matchesCreditorLedgerForTab(account: any, tab: 'invoice' | 'ipc'): boolean {
  if (!account || account.isGroup || account.status === 'disabled') return false;
  const code = String(account.accountCode || '');
  const parent = String(account.parentCode || '');
  const requiredParent = CREDITOR_PARENT_BY_TAB[tab];
  if (!code && !parent) return false;
  if (tab === 'ipc' && code === '21102001') return false;
  return (
    code.startsWith(requiredParent) ||
    parent === requiredParent
  );
}

function toMoneySafe(value: number): number {
  return roundMoney(value);
}

/** Firestore rejects `undefined`; omit optional line fields when unset. */
function mapInvoiceLineForPersistence(line: {
  materialCategoryId?: number;
  itemDescription: string;
  unit: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  boqItemId?: string;
  boqItemIds?: string[];
}) {
  return {
    itemDescription: line.itemDescription,
    unit: line.unit,
    quantity: line.quantity,
    unitCost: toMoneySafe(line.unitCost),
    totalCost: toMoneySafe(line.totalCost),
    ...(line.materialCategoryId != null ? { materialCategoryId: line.materialCategoryId } : {}),
    ...(line.boqItemId ? { boqItemId: line.boqItemId } : {}),
    ...(line.boqItemIds && line.boqItemIds.length > 0 ? { boqItemIds: line.boqItemIds } : {}),
  };
}

/** Inventory unit cost = purchase price + proportional VAT. */
function unitCostInclVat(exVatUnitCost: number, vatPct: number): number {
  return toMoneySafe(exVatUnitCost * (1 + (Number(vatPct) || 0) / 100));
}

function makeDraftId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createInvoiceLineDraft(): InvoiceLineDraft {
  return {
    id: makeDraftId('line'),
    itemDescription: '',
    unit: 'EA',
    quantity: 0,
    unitCost: 0,
    boqItemId: '',
    boqItemIds: [],
  };
}

function buildIpcBoqSyncKey(projectId: string, contractId: string, boqItems: BOQItem[]): string {
  const contractBoq = boqItems.filter(
    (b) => String(b.projectId) === String(projectId) && String(b.contractId) === String(contractId),
  );
  const boqFinger = [...contractBoq.map((b) => b.id)].sort().join('|');
  return `${projectId}|${contractId}|${boqFinger}`;
}

function mapStoredInvoiceLines(raw: unknown): InvoiceLineDraft[] {
  if (!Array.isArray(raw) || raw.length === 0) return [createInvoiceLineDraft()];
  return raw.map((line) => {
    const o = line as Record<string, unknown>;
    const boqItemIds = Array.isArray(o.boqItemIds) 
      ? o.boqItemIds.map(id => String(id)).filter(id => id)
      : (o.boqItemId ? [String(o.boqItemId)] : []);
    
    return {
      id: String(o.id || makeDraftId('line')),
      materialCategoryId: o.materialCategoryId != null ? Number(o.materialCategoryId) : undefined,
      itemDescription: String(o.itemDescription ?? o.description ?? ''),
      unit: String(o.unit ?? 'EA'),
      quantity: Number(o.quantity) || 0,
      unitCost: Number(o.unitCost ?? o.rate) || 0,
      boqItemId: boqItemIds[0] || '', // Keep for backward compatibility
      boqItemIds: boqItemIds,
    };
  });
}

function apiLoadErrorToast(err: unknown, language: string, label: string) {
  const msg =
    err instanceof ApiError
      ? `${label}: ${err.message} (${err.status})`
      : `${label}: ${err instanceof Error ? err.message : String(err)}`;
  toast.error(language === 'ar' ? `فشل تحميل ${label} من الخادم` : `Failed to load ${label} from API`, {
    description: msg,
  });
}

async function fetchPurchaseTransactionsFromApi(): Promise<PurchaseTransaction[]> {
  const rows = (await purchaseTransactionsApi.list()) as PurchaseTransaction[];
  return rows
    .filter((tx) => !tx.isDeleted)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

function resolveInvoiceManualTopicId(isIndirect: boolean, isFixed: boolean): ManualTopicId {
  if (isFixed) return 'costs.invoice.fixed_asset';
  if (isIndirect) return 'costs.invoice.indirect';
  return 'costs.invoice.purchase';
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ActualCosts() {
  const { t, language, theme, dir, formatMoney } = useLanguage();
  const printLabels = useMemo(
    () => ({
      title: t('report_print_preview_title'),
      hint: t('report_print_preview_hint'),
      print: t('report_print_action'),
      cancel: t('cancel'),
    }),
    [t],
  );
  const { requestPrint, PrintHost } = useIpcPrintPreview(language, formatMoney, printLabels);

  const [companyInfo, setCompanyInfo] = useState<CompanyPrintInfo & { reportPrintProfiles?: StoredReportPrintProfiles }>({
    companyName: 'شركة النيل للمقاولات والاستثمار العقاري',
    companyNameEn: 'Nile Construction & Real Estate',
    headerLogo: '',
    taxId: '123-456-789',
    address: 'القاهرة، مصر',
    addressEn: 'Cairo, Egypt',
    footerText: 'نظام إدارة التكاليف',
    footerTextEn: 'Cost Management System',
  });

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        if (isLocalBackend) {
          const res = await settingsApi.getCompanyInfo();
          if (res.value) setCompanyInfo((prev) => ({ ...prev, ...res.value }));
          return;
        }
        const settingsDoc = await getDoc(doc(db, 'settings', 'company_info'));
        if (settingsDoc.exists()) {
          setCompanyInfo((prev) => ({ ...prev, ...(settingsDoc.data() as CompanyPrintInfo) }));
        }
      } catch {
        /* keep defaults */
      }
    };
    void fetchSettings();
  }, [language]);

  const { isProjectAccountant, isProjectsManager, assignedContractIds } = useUserAccessScope();
  const { can, isAdmin } = usePermissions();
  const canPostCustody = can('costs_custody').create || can('ledger').create;
  const canApproveCustody = isAdmin || can('ledger').create;

  const TAB_PERM_KEY: Record<ActiveTab, 'costs_invoice' | 'costs_ipc' | 'costs_custody'> = {
    invoice: 'costs_invoice',
    ipc: 'costs_ipc',
    custody: 'costs_custody',
  };
  const SCREEN_TITLE_KEY: Record<ActiveTab, 'costs_menu_invoice' | 'costs_menu_ipc' | 'costs_menu_custody'> = {
    invoice: 'costs_menu_invoice',
    ipc: 'costs_menu_ipc',
    custody: 'costs_menu_custody',
  };
  const SCREEN_SUBTITLE_KEY: Record<ActiveTab, 'costs_screen_invoice_subtitle' | 'costs_screen_ipc_subtitle' | 'costs_screen_custody_subtitle'> = {
    invoice: 'costs_screen_invoice_subtitle',
    ipc: 'costs_screen_ipc_subtitle',
    custody: 'costs_screen_custody_subtitle',
  };
  const canViewTab = (tab: ActiveTab) => can(TAB_PERM_KEY[tab]).view;
  const canCreateInTab = (tab: ActiveTab) => can(TAB_PERM_KEY[tab]).create;

  const [coaRefreshKey, setCoaRefreshKey] = useState(0);
  const [dataRefreshKey, setDataRefreshKey] = useState(0);
  const [purchaseRefreshKey, setPurchaseRefreshKey] = useState(0);
  const [glRefreshKey, setGlRefreshKey] = useState(0);

  // ── Tab state ──────────────────────────────────────────────────────────────
  const { isErpShell, activeViewId, erp } = useErpModuleView('costs', 'invoice');
  const draftHydrated = useRef(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    const pending = peekPendingShellView('costs');
    if (pending && isActiveTab(pending)) return pending;
    if (isActiveTab(activeViewId)) return activeViewId;
    return 'invoice';
  });
  const [pendingCustodyOpenId, setPendingCustodyOpenId] = useState<string | null>(null);
  const [pendingIpcOpenId, setPendingIpcOpenId] = useState<string | null>(
    () => consumePendingCostsIpcId() ?? null,
  );

  useEffect(() => {
    if (!isErpShell || !erp || draftHydrated.current) return;
    const saved = erp.getModuleDraft<ActualCostsDraft>('costs');
    if (saved?.activeTab) setActiveTab(saved.activeTab);
    draftHydrated.current = true;
  }, [isErpShell, erp]);

  useEffect(() => {
    if (!isErpShell || !isActiveTab(activeViewId)) return;
    setActiveTab(activeViewId);
  }, [activeViewId, isErpShell]);

  /** Sidebar / notification deep-link: apply pending sub-view once on mount. */
  useEffect(() => {
    const pendingView = consumePendingShellView('costs');
    if (pendingView && isActiveTab(pendingView)) setActiveTab(pendingView);
    const pendingCustody = consumePendingCustodySettlementId();
    if (pendingCustody) {
      setActiveTab('custody');
      setPendingCustodyOpenId(pendingCustody);
    }
  }, []);

  // If the current tab is not permitted, auto-switch to the first permitted one.
  useEffect(() => {
    if (!canViewTab(activeTab)) {
      const first = (['invoice', 'ipc', 'custody'] as ActiveTab[]).find((t) => canViewTab(t));
      if (first) setActiveTab(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useErpModuleDraft('costs', { activeTab }, isErpShell, erp);

  // ── Data state (cloud Firestore listeners) ───────────────────────────────────
  const [fsPurchaseTransactions, setFsPurchaseTransactions] = useState<PurchaseTransaction[]>([]);
  const [fsPurchaseLoading, setFsPurchaseLoading] = useState(true);
  const transactionsRef = useRef<PurchaseTransaction[]>([]);
  const ipcBoqSyncKeyRef = useRef('');

  const { data: fsSuppliers } = useFirestoreQuery<Supplier>(
    () => (!isLocalBackend ? query(collection(db, 'suppliers'), where('isDeleted', '==', false)) : null),
    [isLocalBackend],
    { mode: 'once', collectionName: 'suppliers' },
  );
  const { data: fsProjects } = useFirestoreQuery<ProjectRow>(
    () => (!isLocalBackend ? query(collection(db, 'projects'), where('isDeleted', '==', false)) : null),
    [isLocalBackend],
    { mode: 'once', collectionName: 'projects' },
  );
  const { data: fsContracts } = useFirestoreQuery<ContractRow>(
    () => (!isLocalBackend ? query(collection(db, 'contracts'), where('isDeleted', '==', false)) : null),
    [isLocalBackend],
    { mode: 'once', collectionName: 'contracts' },
  );
  const { data: fsBoqItems } = useFirestoreQuery<BOQItem>(
    () => (!isLocalBackend ? query(collection(db, 'boq_items'), where('isDeleted', '!=', true)) : null),
    [isLocalBackend],
    { mode: 'once', collectionName: 'boq_items' },
  );
  const { data: fsGlTransactions } = useFirestoreQuery<CustodyGlTransaction>(
    () => {
      if (isLocalBackend || activeTab !== 'custody') return null;
      const year = new Date().getFullYear();
      return query(
        collection(db, 'transactions'),
        where('isDeleted', '==', false),
        where('date', '>=', `${year}-01-01`),
        where('date', '<=', `${year}-12-31`),
        orderBy('date', 'desc'),
        limit(LISTENER_GL_TX_SCREEN_CAP),
      );
    },
    [isLocalBackend, activeTab],
    { mode: 'once', collectionName: 'transactions' },
  );

  const { data: apiSuppliers, error: apiSuppliersError } = useApiQuery<Supplier>(
    async () => (await suppliersApi.list() as Supplier[]).filter((s) => !s.isDeleted),
    [],
    { enabled: isLocalBackend, refreshKey: dataRefreshKey },
  );
  const { data: apiProjects, error: apiProjectsError } = useApiQuery<ProjectRow>(
    async () => (await projectsApi.list() as unknown as ProjectRow[]).filter((p) => !p.isDeleted),
    [],
    { enabled: isLocalBackend, refreshKey: dataRefreshKey },
  );
  const { data: apiContracts, error: apiContractsError } = useApiQuery<ContractRow>(
    async () => (await contractsApi.list() as unknown as ContractRow[]).filter((c) => !c.isDeleted),
    [],
    { enabled: isLocalBackend, refreshKey: dataRefreshKey },
  );
  const { data: apiBoqItems, error: apiBoqError } = useApiQuery<BOQItem>(
    async () => (await boqApi.list() as BOQItem[]).filter((b) => b.isDeleted !== true),
    [],
    { enabled: isLocalBackend, refreshKey: dataRefreshKey },
  );
  const {
    data: apiPurchaseTransactions,
    loading: apiPurchaseLoading,
    error: apiPurchaseError,
  } = useApiQuery<PurchaseTransaction>(
    fetchPurchaseTransactionsFromApi,
    [activeTab],
    {
      enabled: isLocalBackend && activeTab !== 'custody',
      refreshKey: purchaseRefreshKey,
    },
  );
  const { data: apiGlTransactions, error: apiGlError } = useApiQuery<CustodyGlTransaction>(
    () => glApi.transactions(new Date().getFullYear(), LISTENER_GL_TX_SCREEN_CAP) as Promise<CustodyGlTransaction[]>,
    [activeTab],
    { enabled: isLocalBackend && activeTab === 'custody', refreshKey: glRefreshKey },
  );

  const { accounts } = useChartOfAccountsRef({ leafOnly: true, refreshKey: coaRefreshKey });

  const suppliers = isLocalBackend ? apiSuppliers : (fsSuppliers ?? []);
  const projects = isLocalBackend ? apiProjects : (fsProjects ?? []);
  const contracts = isLocalBackend ? apiContracts : (fsContracts ?? []);
  const boqItems = isLocalBackend ? apiBoqItems : (fsBoqItems ?? []);
  const transactions = isLocalBackend ? apiPurchaseTransactions : fsPurchaseTransactions;
  const glTransactions = isLocalBackend ? apiGlTransactions : (fsGlTransactions ?? []);
  const loading = isLocalBackend
    ? (activeTab === 'custody' ? false : apiPurchaseLoading)
    : fsPurchaseLoading;

  transactionsRef.current = transactions;

  const refreshReferenceData = useCallback(() => {
    setDataRefreshKey((k) => k + 1);
    setCoaRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (apiSuppliersError) apiLoadErrorToast(apiSuppliersError, language, language === 'ar' ? 'الموردين' : 'suppliers');
  }, [apiSuppliersError, language]);
  useEffect(() => {
    if (apiProjectsError) apiLoadErrorToast(apiProjectsError, language, language === 'ar' ? 'المشاريع' : 'projects');
  }, [apiProjectsError, language]);
  useEffect(() => {
    if (apiContractsError) apiLoadErrorToast(apiContractsError, language, language === 'ar' ? 'العقود' : 'contracts');
  }, [apiContractsError, language]);
  useEffect(() => {
    if (apiBoqError) apiLoadErrorToast(apiBoqError, language, language === 'ar' ? 'بنود BOQ' : 'BOQ items');
  }, [apiBoqError, language]);
  useEffect(() => {
    if (apiPurchaseError) apiLoadErrorToast(apiPurchaseError, language, language === 'ar' ? 'معاملات المشتريات' : 'purchase transactions');
  }, [apiPurchaseError, language]);
  useEffect(() => {
    if (apiGlError) apiLoadErrorToast(apiGlError, language, language === 'ar' ? 'قيود اليومية' : 'journal entries');
  }, [apiGlError, language]);
  const [inventorySnapshot, setInventorySnapshot] = useState<InventoryBalanceItem[] | null>(null);
  const [materialCategories, setMaterialCategories] = useState<MaterialCategory[]>([]);
  /** مواد مُثبتة على BOQ (صرف/مرتجع) — لا تشمل فواتير المشتريات */
  const [boqSpentByContract, setBoqSpentByContract] = useState<Map<string, number>>(new Map());

  // ── UI state ───────────────────────────────────────────────────────────────
  const [showModal, setShowModal] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterProjectId, setFilterProjectId] = useState('');
  const [filterContractId, setFilterContractId] = useState('');
  const [purchaseStatusFilter, setPurchaseStatusFilter] = useState<PurchaseStatusFilter>('all');
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<string | null>(null);
  const [detailPurchase, setDetailPurchase] = useState<PurchaseTransaction | null>(null);
  const [detailPurchaseLoading, setDetailPurchaseLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [ipcPreviewEntries, setIpcPreviewEntries] = useState<{ entries: JournalPreviewEntry[]; description: string } | null>(null);
  const ipcPreviewConfirmedRef = useRef(false);
  const ipcSaveModeRef = useRef<IpcSaveMode>('submit');
  const ipcGridRefs = useRef<(HTMLInputElement | null)[][]>([]);
  const [editingPurchaseId, setEditingPurchaseId] = useState<string | null>(null);

  // ── Fixed asset toggle (invoice tab) ──
  const [isFixedAsset, setIsFixedAsset] = useState(false);
  const [fixedAssetName, setFixedAssetName] = useState('');
  const [fixedAssetAccountCode, setFixedAssetAccountCode] = useState('');
  const [fixedAssetAccountName, setFixedAssetAccountName] = useState('');

  // ── Form state (`supplierId` kept for field name compat = chart_of_accounts creditor doc id used in picker) ─
  const [formData, setFormData] = useState({
    supplierId: '',
    /** Invoice only: credit = supplier 21101… · cash = custody/cash 12102… */
    paymentType: 'credit' as InvoicePaymentType,
    projectId: '',
    contractId: '',
    costCenterId: '',
    warehouseAccountId: '',
    expenseAccountId: '',
    date: new Date().toISOString().split('T')[0],
    referenceNumber: '',
    amount: 0,
    invoiceLines: [createInvoiceLineDraft()] as InvoiceLineDraft[],
    invoiceVatPct: BILLING_DEFAULTS.VAT_PCT,
    vatPct: BILLING_DEFAULTS.VAT_PCT,
    whtPct: BILLING_DEFAULTS.WHT_PCT,
    execGuaranteePct: 5,
    labourInsurancePct: 0,
    manpowerLevyPct: 0,
    advancePaymentRecovery: 0,
    description: '',
    items: [] as BillingItem[],
  });

  const [newAccountData, setNewAccountData] = useState({
    accountName: '', accountNameEn: '', accountCode: '', parentCode: '511',
  });

  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean; title: string; message: string; onConfirm: () => void;
  }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });

  const [newSupplierData, setNewSupplierData] = useState({
    name: '', nameEn: '', taxNumber: '', phone: '', address: '',
    type: 'subcontractor' as 'supplier' | 'subcontractor',
  });
  const [indirectCenters, setIndirectCenters] = useState<
    Array<{ id: string; code: string; name: string; nameEn?: string | null; isActive?: boolean }>
  >([]);

  useEffect(() => {
    if (!isLocalBackend) return;
    void costCentersApi.list('indirect').then((rows) => {
      setIndirectCenters(rows as typeof indirectCenters);
    }).catch(() => setIndirectCenters([]));
  }, []);

  const isIndirectInvoice = useMemo(() => {
    const id = String(formData.costCenterId || '').trim();
    if (id.length > 0 && indirectCenters.some((c) => c.id === id)) return true;
    if (
      activeTab === 'invoice'
      && editingPurchaseId
      && Boolean(formData.expenseAccountId)
      && !formData.warehouseAccountId
      && !isFixedAsset
      && !formData.invoiceLines.some((l) => Number(l.quantity) > 0 && (l.itemDescription.trim() || l.materialCategoryId))
    ) {
      return true;
    }
    return false;
  }, [formData.costCenterId, formData.expenseAccountId, formData.warehouseAccountId, formData.invoiceLines, indirectCenters, activeTab, editingPurchaseId, isFixedAsset]);

  /** Indirect expense or fixed asset — single amount field, no material invoice lines. */
  const isSimpleAmountInvoice = isIndirectInvoice || isFixedAsset;

  const supplierTypeForActiveTab = activeTab === 'invoice' ? 'supplier' : 'subcontractor';
  const newSupplierType = showSupplierModal && activeTab !== 'custody'
    ? supplierTypeForActiveTab
    : newSupplierData.type;

  const computedSupplierCode = useMemo(() => {
    const parentCode = newSupplierType === 'supplier' ? '21101' : '21102';
    const defaultBase = newSupplierType === 'supplier' ? 21101001 : 21102001;
    const existingCodes = accounts
      .filter(a => a.parentCode === parentCode)
      .map(a => parseInt(a.accountCode, 10))
      .filter(n => !isNaN(n));
    const maxCode = existingCodes.length > 0 ? Math.max(...existingCodes) : defaultBase;
    return String(maxCode + 1);
  }, [newSupplierType, accounts]);

  const allowedContractSet = useMemo(() => new Set(assignedContractIds), [assignedContractIds]);
  const scopedContracts = useMemo(
    () => (isProjectAccountant ? contracts.filter((c) => allowedContractSet.has(String(c.id))) : contracts),
    [isProjectAccountant, contracts, allowedContractSet]
  );
  const scopedProjectSet = useMemo(() => new Set(scopedContracts.map((c) => String(c.projectId))), [scopedContracts]);
  const scopedProjects = useMemo(
    () => (isProjectAccountant ? projects.filter((p) => scopedProjectSet.has(String(p.id))) : projects),
    [isProjectAccountant, projects, scopedProjectSet]
  );
  const scopedTransactions = useMemo(
    () =>
      isProjectAccountant
        ? transactions.filter((tx) => {
            if (tx.projectId && scopedProjectSet.has(String(tx.projectId))) return true;
            return allowedContractSet.has(String(tx.contractId));
          })
        : transactions,
    [isProjectAccountant, transactions, allowedContractSet, scopedProjectSet]
  );
  const scopedBoqItems = useMemo(
    () =>
      isProjectAccountant
        ? boqItems.filter((item) => allowedContractSet.has(String(item.contractId || '')))
        : boqItems,
    [isProjectAccountant, boqItems, allowedContractSet]
  );

  // Filter BOQ items for invoice lines based on selected cost center or project
  const invoiceBoqItems = useMemo(() => {
    if (activeTab !== 'invoice') return scopedBoqItems;
    
    // If a cost center (contract) is selected, show only its BOQ items
    if (formData.costCenterId) {
      return scopedBoqItems.filter(item => 
        String(item.contractId || '') === String(formData.costCenterId)
      );
    }
    
    // If warehouse is selected, show BOQ items for that warehouse's project
    if (formData.warehouseAccountId) {
      const warehouseAccount = accounts.find(a => a.id === formData.warehouseAccountId);
      const warehouseProjectId = warehouseAccount?.projectId;
      if (warehouseProjectId) {
        return scopedBoqItems.filter(item => 
          String(item.projectId || '') === String(warehouseProjectId)
        );
      }
    }
    
    return scopedBoqItems;
  }, [activeTab, formData.costCenterId, formData.warehouseAccountId, scopedBoqItems, accounts]);

  const costCenterSelectOptions = useMemo(
    () =>
      buildCostCenterSelectOptions(
        scopedContracts,
        scopedProjects,
        indirectCenters.filter((c) => c.isActive !== false),
        language === 'en' ? 'en' : 'ar',
      ).map(({ value, label, secondary }) => ({ value, label, secondary })),
    [scopedContracts, scopedProjects, indirectCenters, language],
  );

  const handleCostCenterChange = useCallback(
    (costCenterId: string) => {
      const contract = scopedContracts.find((c) => c.id === costCenterId);
      if (contract) {
        setFormData((p) => ({
          ...p,
          costCenterId,
          projectId: String(contract.projectId || ''),
          contractId: contract.id,
          expenseAccountId: '',
        }));
      } else if (costCenterId) {
        setIsFixedAsset(false);
        setFormData((p) => ({
          ...p,
          costCenterId,
          projectId: '',
          contractId: '',
          warehouseAccountId: '',
        }));
      } else {
        setFormData((p) => ({
          ...p,
          costCenterId: '',
          projectId: '',
          contractId: '',
        }));
      }
    },
    [scopedContracts],
  );

  const resolveProjectIdFromInvoiceLines = (lines: InvoiceLineDraft[] = formData.invoiceLines): string => {
    const projectIds = new Set<string>();
    for (const line of lines) {
      const itemIds = line.boqItemIds && line.boqItemIds.length > 0 
        ? line.boqItemIds 
        : (line.boqItemId ? [line.boqItemId] : []);
      
      for (const boqId of itemIds) {
        const item = scopedBoqItems.find((b) => String(b.id) === String(boqId));
        const projectId = String(item?.projectId || '').trim();
        if (projectId) projectIds.add(projectId);
      }
    }
    return projectIds.size === 1 ? Array.from(projectIds)[0] : '';
  };

  useEffect(() => {
    if (!isProjectAccountant) return;
    if (formData.contractId && !allowedContractSet.has(String(formData.contractId))) {
      setFormData((prev) => ({ ...prev, contractId: '', projectId: '', costCenterId: '' }));
    }
  }, [isProjectAccountant, formData.contractId, allowedContractSet]);

  // ── Cloud Firestore purchase listener ───────────────────────────────────────

  useEffect(() => {
    if (isLocalBackend) return;
    if (activeTab === 'custody') {
      setFsPurchaseTransactions([]);
      setFsPurchaseLoading(false);
      return;
    }
    setFsPurchaseLoading(true);
    const unsubTx = listenQuery(
      query(
        collection(db, 'purchase_transactions'),
        where('isDeleted', '==', false),
        orderBy('createdAt', 'desc'),
        limit(LISTENER_PURCHASE_TX_CAP),
      ),
      (snap) => {
        setFsPurchaseTransactions(snap.docs.map(d => ({ ...d.data(), id: d.id } as PurchaseTransaction)));
        setFsPurchaseLoading(false);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'purchase_transactions');
        setFsPurchaseLoading(false);
      },
    );
    return () => {
      unsubTx();
    };
  }, [activeTab, isLocalBackend]);

  useEffect(() => {
    if (!isLocalBackend || activeTab !== 'invoice') return;
    materialsApi
      .lookupCategories()
      .then(setMaterialCategories)
      .catch(() => setMaterialCategories([]));
  }, [activeTab]);

  useEffect(() => {
    if (!isLocalBackend) {
      setBoqSpentByContract(new Map());
      return;
    }
    inventoryApi
      .spentByContract()
      .then((rows) => {
        const map = new Map<string, number>();
        for (const row of rows) map.set(row.contractId, row.totalSpent);
        setBoqSpentByContract(map);
      })
      .catch(() => setBoqSpentByContract(new Map()));
  }, [isLocalBackend]);

  // ── Auto-load BOQ items for IPC tab (avoid re-sync on every `transactions` tick — preserves row edits) ──
  useEffect(() => {
    if (activeTab !== 'ipc' || !formData.projectId || !formData.contractId) {
      if (activeTab !== 'ipc') ipcBoqSyncKeyRef.current = '';
      return;
    }
    const nextKey = buildIpcBoqSyncKey(formData.projectId, formData.contractId, scopedBoqItems);
    if (ipcBoqSyncKeyRef.current === nextKey) return;
    if (
      editingPurchaseId
      && formData.items.some((i) => Number(i.currentQty) > 0 || Number(i.amount) > 0)
    ) {
      ipcBoqSyncKeyRef.current = nextKey;
      return;
    }
    ipcBoqSyncKeyRef.current = nextKey;
    const contractBoq = scopedBoqItems.filter(
      (b) => b.projectId === formData.projectId && b.contractId === formData.contractId,
    );
    const txs = transactionsRef.current;
    const items = contractBoq.map(b => {
      const previousQty = txs
        .filter(
          (tx) =>
            tx.type === 'ipc'
            && tx.contractId === formData.contractId
            && isIpcJournalPosted(tx)
            && tx.id !== editingPurchaseId,
        )
        .reduce((sum, tx) => {
          const match = (tx as PurchaseTransaction).items?.find((i) => i.boqItemId === b.id);
          return sum + (match?.currentQty || 0);
        }, 0);
      return {
        boqItemId: b.id,
        itemCode: b.itemCode,
        description: b.description,
        unit: b.unit,
        tenderQty: b.tenderQty,
        rate: roundMoney2(b.unitRateTotal),
        previousQty,
        currentQty: 0,
        totalQty: previousQty,
        amount: 0,
      };
    });
    setFormData(prev => ({ ...prev, items }));
  }, [activeTab, formData.projectId, formData.contractId, scopedBoqItems, editingPurchaseId]);

  const editingPurchase = useMemo(
    () => (editingPurchaseId ? transactions.find((t) => t.id === editingPurchaseId) ?? null : null),
    [editingPurchaseId, transactions],
  );
  const editingIpcStatus = editingPurchase?.type === 'ipc' ? resolveIpcWorkflowStatus(editingPurchase) : null;
  const ipcFormReadOnly = activeTab === 'ipc' && editingPurchase != null && isIpcJournalPosted(editingPurchase);
  const invoiceFormReadOnly =
    activeTab === 'invoice' && editingPurchase?.type === 'invoice' && Boolean(editingPurchase.transactionId);
  const entryFormReadOnly = ipcFormReadOnly || invoiceFormReadOnly;
  const canApproveEditingIpc =
    (isAdmin || isProjectsManager)
    && editingPurchase?.type === 'ipc'
    && editingIpcStatus === 'submitted';

  const populatePurchaseForm = useCallback((tx: PurchaseTransaction) => {
    const whtPct = safePctFromAmount(Number(tx.whtAmount ?? 0), Number(tx.amount), BILLING_DEFAULTS.WHT_PCT);
    const invoiceVatPct = safePctFromAmount(Number(tx.vatAmount ?? 0), Number(tx.amount), BILLING_DEFAULTS.VAT_PCT);

    if (tx.type === 'ipc') {
      const lineItems = Array.isArray(tx.items) && tx.items.length > 0 ? tx.items : [];
      if (tx.projectId && tx.contractId) {
        ipcBoqSyncKeyRef.current = buildIpcBoqSyncKey(tx.projectId, tx.contractId, scopedBoqItems);
      } else {
        ipcBoqSyncKeyRef.current = '';
      }
      setActiveTab('ipc');
      setIsFixedAsset(false);
      setFixedAssetName('');
      setFixedAssetAccountCode('');
      setFixedAssetAccountName('');
      setFormData({
        supplierId: tx.supplierAccountId || tx.supplierId || '',
        paymentType: 'credit',
        projectId: tx.projectId || '',
        contractId: tx.contractId || '',
        costCenterId: tx.contractId || '',
        warehouseAccountId: '',
        expenseAccountId: tx.expenseAccountId || '',
        date: tx.date || new Date().toISOString().split('T')[0],
        referenceNumber: tx.referenceNumber || '',
        amount: Number(tx.amount) || 0,
        invoiceLines: [createInvoiceLineDraft()],
        invoiceVatPct: BILLING_DEFAULTS.VAT_PCT,
        vatPct: BILLING_DEFAULTS.VAT_PCT,
        whtPct: tx.whtPct ?? whtPct,
        execGuaranteePct: tx.execGuaranteePct ?? safePctFromAmount(Number(tx.execGuaranteeAmount ?? 0), Number(tx.amount), 5),
        labourInsurancePct: safePctFromAmount(Number(tx.labourInsuranceAmount ?? 0), Number(tx.amount), 0),
        manpowerLevyPct: safePctFromAmount(Number(tx.manpowerLevyAmount ?? 0), Number(tx.amount), 0),
        advancePaymentRecovery: Number(tx.advancePaymentRecovery ?? 0),
        description: tx.description || '',
        items: lineItems,
      });
      return;
    }

    const invoiceLines = mapStoredInvoiceLines(tx.invoiceLines ?? tx.items);
    const hasMaterialLines = invoiceLines.some(
      (l) => Number(l.quantity) > 0 && (l.itemDescription.trim() || l.materialCategoryId),
    );
    const assetCode = String(tx.inventoryAccountCode || '').trim();
    const isFixedLoad = assetCode.startsWith('11') && assetCode.length === 8 && !hasMaterialLines;

    let warehouseAccountId = tx.warehouseAccountId || '';
    if (!warehouseAccountId && tx.inventoryAccountCode?.startsWith('127')) {
      warehouseAccountId = accounts.find((a) => a.accountCode === tx.inventoryAccountCode)?.id || '';
    }

    ipcBoqSyncKeyRef.current = '';
    setActiveTab('invoice');
    setIsFixedAsset(isFixedLoad);
    if (isFixedLoad) {
      setFixedAssetAccountCode(assetCode);
      setFixedAssetAccountName(tx.inventoryAccountName || assetCode);
      setFixedAssetName(tx.description || '');
    } else {
      setFixedAssetName('');
      setFixedAssetAccountCode('');
      setFixedAssetAccountName('');
    }

    setFormData({
      supplierId: tx.supplierAccountId || tx.supplierId || '',
      paymentType: normalizeInvoicePaymentType(tx.paymentType),
      projectId: tx.projectId || '',
      contractId: tx.contractId || '',
      costCenterId: tx.contractId || '',
      warehouseAccountId,
      expenseAccountId: tx.expenseAccountId || '',
      date: tx.date || new Date().toISOString().split('T')[0],
      referenceNumber: tx.referenceNumber || '',
      amount: Number(tx.amount) || 0,
      invoiceLines: hasMaterialLines ? invoiceLines : [createInvoiceLineDraft()],
      invoiceVatPct,
      vatPct: invoiceVatPct,
      whtPct,
      execGuaranteePct: 5,
      labourInsurancePct: 0,
      manpowerLevyPct: 0,
      advancePaymentRecovery: 0,
      description: tx.description || '',
      items: [],
    });
  }, [accounts, scopedBoqItems]);

  const openPurchaseTransaction = useCallback(async (tx: PurchaseTransaction, options?: { ipcMode?: IpcSaveMode }) => {
    if (tx.type !== 'ipc' && tx.type !== 'invoice') return;

    let full: PurchaseTransaction = tx;
    if (isLocalBackend) {
      try {
        const fetched = (await purchaseTransactionsApi.get(tx.id)) as PurchaseTransaction;
        full = {
          ...tx,
          ...fetched,
          items: fetched.items ?? tx.items,
          invoiceLines:
            fetched.invoiceLines
            ?? tx.invoiceLines
            ?? (fetched.type === 'invoice' ? mapStoredInvoiceLines(fetched.items ?? tx.items) : undefined),
        };
      } catch {
        // list row fallback
      }
    }

    ipcSaveModeRef.current = options?.ipcMode ?? 'submit';
    setEditingPurchaseId(full.id);
    populatePurchaseForm(full);
    setShowModal(true);
  }, [isLocalBackend, populatePurchaseForm]);

  const selectPurchaseForDetail = useCallback(async (tx: PurchaseTransaction) => {
    setSelectedPurchaseId(tx.id);
    setDetailPurchaseLoading(true);
    try {
      let full: PurchaseTransaction = tx;
      if (isLocalBackend) {
        try {
          const fetched = (await purchaseTransactionsApi.get(tx.id)) as PurchaseTransaction;
          full = {
            ...tx,
            ...fetched,
            items: fetched.items ?? tx.items,
            invoiceLines:
              fetched.invoiceLines
              ?? tx.invoiceLines
              ?? (fetched.type === 'invoice' ? mapStoredInvoiceLines(fetched.items ?? tx.items) : undefined),
          };
        } catch {
          // list row fallback
        }
      }
      if (full.type === 'invoice') {
        full = {
          ...full,
          invoiceLines: mapStoredInvoiceLines(full.invoiceLines ?? full.items),
        };
      }
      setDetailPurchase(full);
    } finally {
      setDetailPurchaseLoading(false);
    }
  }, [isLocalBackend]);

  const canApproveIpcTransaction = useCallback(
    (tx: PurchaseTransaction) =>
      (isAdmin || isProjectsManager)
      && tx.type === 'ipc'
      && resolveIpcWorkflowStatus(tx) === 'submitted',
    [isAdmin, isProjectsManager],
  );

  const beginIpcApproval = useCallback(
    (tx: PurchaseTransaction) => {
      void openPurchaseTransaction(tx, { ipcMode: 'approve' });
    },
    [openPurchaseTransaction],
  );

  useEffect(() => {
    if (!pendingIpcOpenId) return;
    setActiveTab('ipc');
    const tx = transactions.find((t) => t.id === pendingIpcOpenId);
    if (!tx) return;
    void selectPurchaseForDetail(tx as PurchaseTransaction);
    setPendingIpcOpenId(null);
  }, [pendingIpcOpenId, transactions, selectPurchaseForDetail]);

  useEffect(() => {
    setSelectedPurchaseId(null);
    setDetailPurchase(null);
    setPurchaseStatusFilter('all');
    setFilterContractId('');
  }, [activeTab]);

  useEffect(() => {
    setFilterContractId('');
    setSelectedPurchaseId(null);
    setDetailPurchase(null);
  }, [filterProjectId]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const payload = {
        ...newAccountData,
        type: 'expense',
        isGroup: false,
        status: 'active' as const,
      };
      if (isLocalBackend) {
        const created = await chartOfAccountsApi.create(payload) as { id: string };
        invalidateCoaCache();
        setCoaRefreshKey((k) => k + 1);
        setFormData(prev => ({ ...prev, expenseAccountId: created.id }));
      } else {
        const docRef = await addDoc(collection(db, 'chart_of_accounts'), {
          ...payload,
          createdAt: serverTimestamp(),
        });
        invalidateCoaCache();
        setFormData(prev => ({ ...prev, expenseAccountId: docRef.id }));
      }
      setShowAccountModal(false);
      setNewAccountData({ accountName: '', accountNameEn: '', accountCode: '', parentCode: '511' });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'chart_of_accounts');
    } finally { setIsSubmitting(false); }
  };

  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSupplierData.nameEn.trim()) {
      toast.error(t('toast_english_name_required'));
      return;
    }
    setIsSubmitting(true);
    try {
      const parentCode = newSupplierType === 'supplier' ? '21101' : '21102';
      if (isLocalBackend) {
        const supplier = await suppliersApi.create({
          name: newSupplierData.name || newSupplierData.nameEn,
          nameEn: newSupplierData.nameEn,
          type: newSupplierType,
          taxNumber: newSupplierData.taxNumber,
          phone: newSupplierData.phone,
          address: newSupplierData.address,
          isDeleted: false,
        } as unknown as Supplier) as { id: string };
        const account = await chartOfAccountsApi.create({
          accountName: newSupplierData.name || newSupplierData.nameEn,
          accountNameEn: newSupplierData.nameEn,
          accountCode: computedSupplierCode,
          parentCode,
          type: 'liability',
          isGroup: false,
          status: 'active',
          supplierId: supplier.id,
        }) as { id: string };
        invalidateCoaCache();
        refreshReferenceData();
        setFormData(prev => ({ ...prev, supplierId: account.id }));
      } else {
        const batch = writeBatch(db);
        const supplierRef = doc(collection(db, 'suppliers'));
        batch.set(supplierRef, { ...newSupplierData, type: newSupplierType, isDeleted: false, createdAt: serverTimestamp() });

        const accountRef = doc(collection(db, 'chart_of_accounts'));
        batch.set(accountRef, {
          accountName: newSupplierData.name || newSupplierData.nameEn,
          accountNameEn: newSupplierData.nameEn,
          accountCode: computedSupplierCode,
          parentCode,
          type: 'liability',
          isGroup: false,
          supplierId: supplierRef.id,
          createdAt: serverTimestamp(),
        });
        await batch.commit();
        invalidateCoaCache();
        setFormData(prev => ({ ...prev, supplierId: accountRef.id }));
      }
      setShowSupplierModal(false);
      setNewSupplierData({ name: '', nameEn: '', taxNumber: '', phone: '', address: '', type: supplierTypeForActiveTab });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'suppliers');
    } finally { setIsSubmitting(false); }
  };

  const handleExportTemplate = () => {
    const isAr = language === 'ar';
    const headers = [isAr ? 'كود البند' : 'Item Code', isAr ? 'البيان' : 'Description', isAr ? 'الوحدة' : 'Unit', isAr ? 'الفئة' : 'Rate', isAr ? 'الكمية السابقة' : 'Prev Qty', isAr ? 'الكمية الحالية' : 'Curr Qty'];
    const aoa = [headers, ...formData.items.map(i => [i.itemCode, i.description, i.unit, i.rate, i.previousQty, 0])];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'IPC Template');
    XLSX.writeFile(wb, 'Subcontractor_IPC_Template.xlsx');
  };

  const handleImportExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const wb = XLSX.read(evt.target?.result as string, { type: 'binary' });
      const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]) as Record<string, unknown>[];
      const updated = [...formData.items];
      data.forEach(row => {
        const itemCode = row[language === 'ar' ? 'كود البند' : 'Item Code'] as string | undefined;
        const currQty = Number(row[language === 'ar' ? 'الكمية الحالية' : 'Curr Qty']);
        if (itemCode !== undefined && !isNaN(currQty)) {
          const idx = updated.findIndex(i => i.itemCode === String(itemCode));
          if (idx !== -1) {
            const item = updated[idx];
            updated[idx] = { ...item, currentQty: currQty, totalQty: item.previousQty + currQty, amount: (item.previousQty + currQty) * item.rate };
          }
        }
      });
      setFormData(prev => ({ ...prev, items: updated }));
    };
    reader.readAsBinaryString(file);
  };

  const handleItemQtyChange = (idx: number, qty: number) => {
    const items = [...formData.items];
    items[idx] = { ...items[idx], currentQty: qty, totalQty: items[idx].previousQty + qty, amount: (items[idx].previousQty + qty) * items[idx].rate };
    setFormData(prev => ({ ...prev, items }));
  };

  const handleItemRateChange = (idx: number, rate: number) => {
    const items = [...formData.items];
    items[idx] = { ...items[idx], rate, amount: items[idx].totalQty * rate };
    setFormData(prev => ({ ...prev, items }));
  };

  const setInvoiceLineField = (
    lineId: string,
    field: keyof Omit<InvoiceLineDraft, 'id'>,
    value: string | number,
  ) => {
    setFormData((prev) => ({
      ...prev,
      invoiceLines: prev.invoiceLines.map((line) =>
        line.id === lineId ? { ...line, [field]: value } : line
      ),
    }));
  };

  const handleInvoiceLineMaterialSelect = (lineId: string, materialCategoryId: string) => {
    const cat = materialCategories.find((c) => c.id === Number(materialCategoryId));
    setFormData((prev) => ({
      ...prev,
      invoiceLines: prev.invoiceLines.map((line) =>
        line.id === lineId
          ? {
              ...line,
              materialCategoryId: cat ? cat.id : undefined,
              itemDescription: cat ? cat.name : line.itemDescription,
              unit: cat ? cat.unit : line.unit,
            }
          : line
      ),
    }));
  };

  /** اختيار بند BOQ يملأ الوصف والوحدة تلقائياً */
  const handleInvoiceLineBOQSelect = (lineId: string, boqItemId: string) => {
    setFormData((prev) => {
      const line = prev.invoiceLines.find(l => l.id === lineId);
      if (!line) return prev;
      
      const currentIds = line.boqItemIds || [];
      let newIds: string[];
      
      // Toggle selection
      if (currentIds.includes(boqItemId)) {
        newIds = currentIds.filter(id => id !== boqItemId);
      } else {
        newIds = [...currentIds, boqItemId];
      }
      
      // Update projectId from first selected BOQ item
      let projectId = prev.projectId;
      if (newIds.length > 0) {
        const firstItem = scopedBoqItems.find(b => b.id === newIds[0]);
        if (firstItem) {
          projectId = String(firstItem.projectId || prev.projectId || '');
        }
      }
      
      return {
        ...prev,
        projectId,
        invoiceLines: prev.invoiceLines.map((l) =>
          l.id === lineId
            ? {
                ...l,
                boqItemId: newIds[0] || '', // Keep for backward compatibility
                boqItemIds: newIds,
              }
            : l
        ),
      };
    });
  };

  const addInvoiceLine = () => {
    setFormData((prev) => ({ ...prev, invoiceLines: [...prev.invoiceLines, createInvoiceLineDraft()] }));
  };

  const removeInvoiceLine = (lineId: string) => {
    setFormData((prev) => {
      const next = prev.invoiceLines.filter((line) => line.id !== lineId);
      return { ...prev, invoiceLines: next.length > 0 ? next : [createInvoiceLineDraft()] };
    });
  };

  const calculateIPCDeductions = () => {
    const worksValue = formData.items.reduce((s, i) => s + i.amount, 0);
    const vat = worksValue * (formData.vatPct / 100);
    const exec = worksValue * (formData.execGuaranteePct / 100);
    const wht = worksValue * (formData.whtPct / 100);
    const insurance = worksValue * (formData.labourInsurancePct / 100);
    const levy = worksValue * (formData.manpowerLevyPct / 100);
    const advance = formData.advancePaymentRecovery;
    const net = worksValue + vat - exec - wht - insurance - levy - advance;
    return { worksValue, vat, exec, wht, insurance, levy, advance, net };
  };

  const handlePrintSubcontractorIpc = () => {
    if (activeTab !== 'ipc' || formData.items.length === 0) return;
    const supplierCoaAccount = accounts.find(
      (a) => a.id === formData.supplierId && matchesCreditorLedgerForTab(a, 'ipc'),
    );
    const subcontractorName = supplierCoaAccount
      ? (language === 'ar'
        ? supplierCoaAccount.accountName
        : (supplierCoaAccount.accountNameEn || supplierCoaAccount.accountName))
      : '';
    const project = scopedProjects.find((p) => p.id === formData.projectId);
    const contract = scopedContracts.find((c) => c.id === formData.contractId);
    const { worksValue, vat, exec, wht, insurance, levy, advance, net } = calculateIPCDeductions();
    const printItems = mapToIpcPrintItems(
      formData.items.map((item) => {
        const boq = scopedBoqItems.find((b) => b.id === item.boqItemId);
        return {
          ...item,
          chapterName: boq?.chapterName,
          sectionName: boq?.sectionName,
          tenderQty: item.tenderQty ?? boq?.tenderQty,
        };
      }),
    );
    const data = buildSubcontractorIpcPrintData({
      referenceNumber: formData.referenceNumber || '—',
      dateLabel: formData.date,
      projectName: project?.projectName,
      contractName: contract?.contractName || contract?.contractNumber,
      subcontractorName,
      items: printItems,
      worksValueExVat: worksValue,
      vatAmount: vat,
      execGuaranteeAmount: exec,
      whtAmount: wht,
      labourInsuranceAmount: insurance,
      manpowerLevyAmount: levy,
      advancePaymentRecovery: advance,
      netPayable: net,
    });
    const scopeLabel = contract
      ? [contract.contractNumber, contract.contractName].filter(Boolean).join(' — ')
      : undefined;
    requestPrint(
      data,
      'subcontractor_ipc',
      companyInfo,
      new Date().toLocaleDateString(displayLocale(language)),
      scopeLabel,
    );
  };

  const handlePrintSubcontractorIpcFromTx = useCallback(
    (tx: PurchaseTransaction) => {
      const supplierCoaAccount = accounts.find(
        (a) => a.id === tx.supplierAccountId && matchesCreditorLedgerForTab(a, 'ipc'),
      );
      const subcontractorName =
        tx.supplierName
        || (supplierCoaAccount
          ? (language === 'ar'
            ? supplierCoaAccount.accountName
            : (supplierCoaAccount.accountNameEn || supplierCoaAccount.accountName))
          : '');
      const project = scopedProjects.find((p) => p.id === tx.projectId);
      const contract = scopedContracts.find((c) => c.id === tx.contractId);
      const printItems = mapToIpcPrintItems(
        (tx.items ?? []).map((item) => {
          const boq = scopedBoqItems.find((b) => b.id === item.boqItemId);
          return {
            ...item,
            chapterName: boq?.chapterName,
            sectionName: boq?.sectionName,
            tenderQty: (item as BillingItem & { tenderQty?: number }).tenderQty ?? boq?.tenderQty,
          };
        }),
      );
      const data = buildSubcontractorIpcPrintData({
        referenceNumber: tx.referenceNumber || '—',
        dateLabel: tx.date,
        projectName: project?.projectName,
        contractName: contract?.contractName || contract?.contractNumber,
        subcontractorName,
        items: printItems,
        worksValueExVat: tx.amount,
        vatAmount: tx.vatAmount,
        execGuaranteeAmount: tx.execGuaranteeAmount ?? 0,
        whtAmount: tx.whtAmount ?? 0,
        labourInsuranceAmount: tx.labourInsuranceAmount ?? 0,
        manpowerLevyAmount: tx.manpowerLevyAmount ?? 0,
        advancePaymentRecovery: tx.advancePaymentRecovery ?? 0,
        netPayable: tx.totalAmount,
      });
      const scopeLabel = contract
        ? [contract.contractNumber, contract.contractName].filter(Boolean).join(' — ')
        : undefined;
      requestPrint(
        data,
        'subcontractor_ipc',
        companyInfo,
        new Date().toLocaleDateString(displayLocale(language)),
        scopeLabel,
      );
    },
    [
      accounts,
      language,
      scopedProjects,
      scopedContracts,
      scopedBoqItems,
      companyInfo,
      requestPrint,
    ],
  );

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    const warehouseAccount =
      activeTab === 'invoice'
        ? accounts.find((a) => a.id === formData.warehouseAccountId && isProjectWarehouseAccount(a))
        : undefined;
    /** Picker value = `chart_of_accounts` creditor document id (supplier 21101… or cash 12102…) */
    const invoicePaymentType =
      activeTab === 'invoice' ? normalizeInvoicePaymentType(formData.paymentType) : 'credit';
    const supplierCoaAccount = accounts.find((a) => {
      if (a.id !== formData.supplierId) return false;
      if (activeTab === 'invoice' && invoicePaymentType === 'cash') {
        return isCustodyOrCashFundAccount(a);
      }
      return matchesCreditorLedgerForTab(a, activeTab as 'invoice' | 'ipc');
    });
    if (!supplierCoaAccount?.accountCode) {
      toast.error(
        activeTab === 'invoice' && invoicePaymentType === 'cash'
          ? t('toast_pick_custody_cash_coa')
          : t('toast_pick_supplier_coa'),
      );
      setIsSubmitting(false);
      return;
    }
    const expenseCoaAccount =
      activeTab === 'invoice' && isIndirectInvoice
        ? accounts.find(
            (a) =>
              a.id === formData.expenseAccountId &&
              String(a.accountCode).startsWith('5') &&
              String(a.accountCode).length === 8,
          )
        : undefined;
    if (activeTab === 'invoice' && isIndirectInvoice) {
      if (!formData.costCenterId) {
        toast.error(t('select_cost_center'));
        setIsSubmitting(false);
        return;
      }
      if (!expenseCoaAccount?.accountCode) {
        toast.error(t('toast_pick_expense_account'));
        setIsSubmitting(false);
        return;
      }
      if (invoiceBaseAmount <= 0) {
        toast.error(language === 'ar' ? 'أدخل مبلغاً أكبر من صفر.' : 'Enter an amount greater than zero.');
        setIsSubmitting(false);
        return;
      }
    } else if (activeTab === 'invoice' && isFixedAsset) {
      const code = fixedAssetAccountCode.trim();
      if (!code || !code.startsWith('11') || code.length !== 8) {
        toast.error(
          language === 'ar'
            ? 'أدخل كود حساب أصل ثابت صحيح (8 أرقام يبدأ بـ 11).'
            : 'Enter a valid fixed asset account code (8 digits starting with 11).',
        );
        setIsSubmitting(false);
        return;
      }
      if (invoiceBaseAmount <= 0) {
        toast.error(language === 'ar' ? 'أدخل مبلغاً أكبر من صفر.' : 'Enter an amount greater than zero.');
        setIsSubmitting(false);
        return;
      }
    } else if (activeTab === 'invoice' && !warehouseAccount?.accountCode) {
      toast.error(t('toast_pick_warehouse_account'));
      setIsSubmitting(false);
      return;
    }
    let inventoryProjectId: string | null = null;
    if (activeTab === 'invoice' && !isSimpleAmountInvoice) {
      if (warehouseAccount) {
        inventoryProjectId = nullIfEmpty(
          resolveProjectIdForWarehouse(
            {
              accountCode: String(warehouseAccount.accountCode),
              projectId: warehouseAccount.projectId as string | undefined,
            },
            projects ?? [],
          ) ?? '',
        );
      }
      if (isProjectAccountant && inventoryProjectId && !scopedProjectSet.has(inventoryProjectId)) {
        toast.error(
          language === 'ar' ? 'غير مسموح التسجيل على مخزن هذا المشروع' : 'You cannot post to this project warehouse'
        );
        setIsSubmitting(false);
        return;
      }
      if (normalizedInvoiceLines.length === 0) {
        toast.error(language === 'ar' ? 'أضف بند فاتورة واحد على الأقل.' : 'Add at least one invoice line.');
        setIsSubmitting(false);
        return;
      }
      if (isLocalBackend && inventoryProjectId && materialCategories.length === 0) {
        toast.error(
          language === 'ar'
            ? 'لا توجد أصناف مواد متاحة للمخزون. تأكد من تشغيل الخادم المحلي وتعريف شجرة الأصناف.'
            : 'No material categories are available for inventory. Make sure the local API is running and materials are defined.'
        );
        setIsSubmitting(false);
        return;
      }
      for (const [lineIndex, line] of normalizedInvoiceLines.entries()) {
        if (isLocalBackend && inventoryProjectId && !line.materialCategoryId) {
          toast.error(language === 'ar' ? 'اختر صنفاً من شجرة الأصناف' : 'Select a material category');
          setIsSubmitting(false);
          return;
        }
        if (!isLocalBackend && !line.itemDescription.trim()) {
          toast.error(
            language === 'ar'
              ? `وصف البند ${lineIndex + 1} مطلوب.`
              : `Line ${lineIndex + 1} description is required.`
          );
          setIsSubmitting(false);
          return;
        }
        if (line.quantity <= 0 || line.unitCost < 0) {
          toast.error(
            language === 'ar'
              ? `قيم الكمية/السعر في البند ${lineIndex + 1} غير صحيحة.`
              : `Invalid quantity/unit cost in line ${lineIndex + 1}.`
          );
          setIsSubmitting(false);
          return;
        }
      }
    } else if (activeTab === 'ipc') {
      if (!formData.costCenterId) {
        toast.error(t('select_cost_center'));
        setIsSubmitting(false);
        return;
      }
      const isDirect = isDirectCostCenterId(formData.costCenterId, scopedContracts);
      if (isProjectAccountant && isDirect && !allowedContractSet.has(String(formData.costCenterId))) {
        toast.error(language === 'ar' ? 'غير مسموح التسجيل على هذا العقد' : 'You are not allowed to post to this contract');
        setIsSubmitting(false);
        return;
      }
      if (isDirect && (!formData.projectId || !formData.contractId)) {
        toast.error(t('select_cost_center'));
        setIsSubmitting(false);
        return;
      }
    }
    const supplierFromDirectory =
      invoicePaymentType === 'cash'
        ? undefined
        : supplierCoaAccount.supplierId
          ? suppliers.find((s) => s.id === supplierCoaAccount.supplierId)
          : undefined;
    const resolvedSupplierName =
      supplierDirectoryLabel(supplierFromDirectory, language) ||
      supplierCoaAccount.accountName ||
      supplierCoaAccount.accountNameEn ||
      '';
    const { worksValue, vat, exec, wht, insurance, levy, advance, net } =
      activeTab === 'invoice'
        ? (() => {
            const base = invoiceBaseAmount;
            const vatAmt = roundMoney(base * (formData.invoiceVatPct / 100));
            const whtAmt = roundMoney(base * (formData.whtPct / 100));
            return {
              worksValue: base,
              vat: vatAmt,
              wht: whtAmt,
              exec: 0,
              insurance: 0,
              levy: 0,
              advance: 0,
              net: roundMoney(base + vatAmt - whtAmt),
            };
          })()
        : calculateIPCDeductions();
    const projectIdForSave = activeTab === 'invoice' ? null : nullIfEmpty(formData.projectId);
    const contractIdForSave = activeTab === 'invoice' ? null : nullIfEmpty(formData.contractId);
    const costCenterIdForGl = nullIfEmpty(formData.costCenterId);
    const ipcSaveMode = activeTab === 'ipc' ? ipcSaveModeRef.current : null;

    if (activeTab === 'ipc' && ipcFormReadOnly) {
      setIsSubmitting(false);
      return;
    }
    if (activeTab === 'invoice' && invoiceFormReadOnly) {
      setIsSubmitting(false);
      return;
    }

    // Subcontractor IPC — journal preview only when projects manager approves.
    if (activeTab === 'ipc' && ipcSaveMode === 'approve' && !ipcPreviewConfirmedRef.current) {
      const entries = buildSubcontractorIpcEntries({
        worksValue, vatAmount: vat, netPayable: net, execGuarantee: exec, whtAmount: wht,
        labourInsurance: insurance, manpowerLevy: levy, advancePaymentRecovery: advance,
        supplierName: resolvedSupplierName, supplierAccountCode: supplierCoaAccount.accountCode,
      });
      setIpcPreviewEntries({
        entries,
        description: formData.description || `${t('ipc_entry')} - ${resolvedSupplierName}`,
      });
      setIsSubmitting(false);
      return;
    }

    const ipcStatusForSave: PurchaseTransaction['status'] =
      activeTab === 'ipc'
        ? ipcSaveMode === 'draft'
          ? 'draft'
          : ipcSaveMode === 'approve'
            ? 'approved'
            : 'submitted'
        : 'pending';
    const shouldPostIpcGl = activeTab === 'ipc' && ipcSaveMode === 'approve';

    let transactionId = '';
    try {
      if (isLocalBackend && activeTab === 'ipc' && formData.costCenterId && isDirectCostCenterId(formData.costCenterId, scopedContracts)) {
        const projectHint = scopedProjects.find((p) => p.id === formData.projectId);
        await ensureLocalProjectExists(formData.projectId, {
          projectName: projectHint?.projectName,
          projectCode: projectHint?.projectCode,
          clientName: projectHint?.clientName,
          budget: projectHint?.budget,
        });
        if (contractIdForSave) {
          const contractHint = scopedContracts.find((c) => c.id === contractIdForSave);
          await ensureLocalContractExists(contractIdForSave, formData.projectId, {
            projectId: formData.projectId,
            contractName: contractHint?.contractName,
            contractNumber: contractHint?.contractNumber,
          });
        }
      }

      // Local invoices: one API call (GL + purchase row + optional stock) so offline sync cannot orphan the journal.
      if (isLocalBackend && activeTab === 'invoice') {
        const invoiceRef = formData.referenceNumber.trim()
          ? `INV-${formData.referenceNumber.trim()}`
          : undefined;
        const journalDescription =
          isFixedAsset && fixedAssetAccountCode.trim()
            ? formData.description ||
              `${t('invoice_entry')} - ${resolvedSupplierName} - ${fixedAssetName.trim() || fixedAssetAccountCode.trim()}`
            : formData.description || `${t('invoice_entry')} - ${resolvedSupplierName}`;

        let journalEntries: ReturnType<typeof buildPurchaseWithholdingJournalLines>;
        let journalProjectId: string | undefined;
        let journalCostCenterId: string | undefined;

        if (isIndirectInvoice && expenseCoaAccount) {
          journalEntries = buildPurchaseWithholdingJournalLines({
            debitAccountCode: expenseCoaAccount.accountCode,
            debitAccountName: expenseCoaAccount.accountName || expenseCoaAccount.accountNameEn || '',
            supplierAccountCode: supplierCoaAccount.accountCode,
            supplierLabel: `موردين - ${resolvedSupplierName}`,
            baseAmount: worksValue,
            vatAmount: vat,
            whtAmount: wht,
            costCenterId: costCenterIdForGl!,
          });
          journalCostCenterId = costCenterIdForGl!;
        } else if (isFixedAsset && fixedAssetAccountCode.trim()) {
          journalEntries = buildPurchaseWithholdingJournalLines({
            debitAccountCode: fixedAssetAccountCode.trim(),
            debitAccountName: fixedAssetAccountName.trim() || fixedAssetAccountCode.trim(),
            supplierAccountCode: supplierCoaAccount.accountCode,
            supplierLabel: `موردين - ${resolvedSupplierName}`,
            baseAmount: worksValue,
            vatAmount: vat,
            whtAmount: wht,
          });
        } else if (warehouseAccount) {
          journalEntries = buildPurchaseWithholdingJournalLines({
            debitAccountCode: warehouseAccount.accountCode,
            debitAccountName: warehouseAccount.accountName,
            supplierAccountCode: supplierCoaAccount.accountCode,
            supplierLabel: `موردين - ${resolvedSupplierName}`,
            baseAmount: worksValue,
            vatAmount: vat,
            whtAmount: wht,
          });
          journalProjectId = inventoryProjectId || undefined;
          journalCostCenterId = costCenterIdForGl || undefined;
        } else {
          toast.error(
            language === 'ar'
              ? 'تعذر بناء قيد الفاتورة — تحقق من المخزن أو الأصل أو مركز التكلفة.'
              : 'Cannot build invoice journal — check warehouse, asset, or cost center.',
          );
          return;
        }

        if (inventoryProjectId && !isIndirectInvoice && !isFixedAsset) {
          const projectHint = projects?.find((p) => p.id === inventoryProjectId);
          await ensureLocalProjectExists(inventoryProjectId, {
            projectName: projectHint?.projectName,
            projectCode: projectHint?.projectCode as string | undefined,
            clientName: projectHint?.clientName as string | undefined,
            budget: Number(projectHint?.budget ?? 0),
          });
        }

        const apiBody = {
          type: 'invoice' as const,
          supplierId:
            invoicePaymentType === 'cash'
              ? null
              : nullIfEmpty(supplierFromDirectory?.id || supplierCoaAccount.supplierId || ''),
          supplierAccountId: nullIfEmpty(supplierCoaAccount.id),
          supplierName: resolvedSupplierName,
          paymentType: invoicePaymentType,
          projectId: projectIdForSave,
          contractId: contractIdForSave,
          expenseAccountId: isIndirectInvoice ? nullIfEmpty(expenseCoaAccount?.id) : null,
          expenseAccountName: isIndirectInvoice ? expenseCoaAccount?.accountName || '' : '',
          date: formData.date,
          referenceNumber: formData.referenceNumber,
          amount: worksValue,
          vatAmount: vat,
          whtAmount: wht,
          execGuaranteeAmount: exec,
          labourInsuranceAmount: insurance,
          manpowerLevyAmount: levy,
          advancePaymentRecovery: advance,
          totalAmount: net,
          description: formData.description || '',
          status: 'pending',
          isDeleted: false,
          invoiceLines: !isSimpleAmountInvoice
            ? normalizedInvoiceLines.map(mapInvoiceLineForPersistence)
            : undefined,
        };

        const posted = await purchaseTransactionsApi.postInvoice({
          purchase: apiBody,
          journal: {
            date: formData.date,
            description: journalDescription,
            ...(invoiceRef ? { reference: invoiceRef } : {}),
            ...(journalProjectId ? { projectId: journalProjectId } : {}),
            ...(journalCostCenterId ? { costCenterId: journalCostCenterId } : {}),
            entries: journalEntries,
          },
          ...(inventoryProjectId && !isIndirectInvoice && !isFixedAsset
            ? {
                inventory: {
                  projectId: inventoryProjectId,
                  vatPct: formData.invoiceVatPct,
                  invoiceNumber: formData.referenceNumber,
                  lines: normalizedInvoiceLines.map(mapInvoiceLineForPersistence),
                },
              }
            : {}),
        });

        const purchaseId = String(posted.id);
        transactionId = String(posted.transactionId || '');

        if (isFixedAsset && fixedAssetAccountCode.trim()) {
          try {
            const assetValue = worksValue + vat;
            await import('../services/local/modulesApi').then(({ fixedAssetsApi }) =>
              fixedAssetsApi.create({
                assetName: fixedAssetName.trim() || `${resolvedSupplierName} - ${formData.date}`,
                acquisitionDate: formData.date,
                assetValue,
                assetAccountCode: fixedAssetAccountCode.trim(),
                assetAccountName: fixedAssetAccountName.trim() || fixedAssetAccountCode.trim(),
                accumulatedDepreciationAccountCode: '',
                expenseAccountCode: '',
                purchaseTransactionId: purchaseId,
                status: 'pending_setup',
              } as Parameters<typeof fixedAssetsApi.create>[0]),
            );
            toast(
              language === 'ar'
                ? 'تم إنشاء سجل الأصل الثابت في وضع "انتظار الإعداد" — يرجى إكمال البيانات في موديول الأصول الثابتة'
                : 'Fixed asset record created (pending setup) — complete details in the Fixed Assets module',
              { duration: 6000 },
            );
          } catch (faErr) {
            console.warn('Fixed asset record creation failed:', faErr);
            toast.error(
              language === 'ar'
                ? `تم ترحيل القيد لكن فشل إنشاء سجل الأصل الثابت: ${faErr instanceof Error ? faErr.message : String(faErr)}`
                : `Journal posted but fixed asset register row failed: ${faErr instanceof Error ? faErr.message : String(faErr)}`,
              { duration: 8000 },
            );
          }
        }

        if (inventoryProjectId && !isIndirectInvoice && !isFixedAsset) {
          try {
            const summary = (await inventoryApi.projectSummary(inventoryProjectId)) as {
              items: InventoryBalanceItem[];
            };
            if (summary?.items) setInventorySnapshot(summary.items);
          } catch {
            // non-critical
          }
          try {
            const spentRows = await inventoryApi.spentByContract();
            const spentMap = new Map<string, number>();
            for (const row of spentRows) spentMap.set(row.contractId, row.totalSpent);
            setBoqSpentByContract(spentMap);
          } catch {
            // non-critical
          }
        }

        toast.success(
          language === 'ar'
            ? 'تم حفظ الفاتورة وإنشاء القيد بنجاح.'
            : 'Invoice saved and journal entry created successfully.',
        );
        setPurchaseRefreshKey((k) => k + 1);
        setShowModal(false);
        resetForm();
        return;
      }

      if (activeTab === 'invoice' && isIndirectInvoice && expenseCoaAccount) {
        const invoiceRef = formData.referenceNumber.trim()
          ? `INV-${formData.referenceNumber.trim()}`
          : undefined;
        transactionId = await accountingService.recordIndirectExpenseInvoice({
          baseAmount: worksValue,
          vatAmount: vat,
          whtAmount: wht,
          totalAmount: net,
          supplierName: resolvedSupplierName,
          supplierAccountCode: supplierCoaAccount.accountCode,
          expenseAccountCode: expenseCoaAccount.accountCode,
          expenseAccountName: expenseCoaAccount.accountName || expenseCoaAccount.accountNameEn || '',
          description:
            formData.description ||
            `${t('invoice_entry')} - ${resolvedSupplierName}`,
          costCenterId: costCenterIdForGl!,
          date: formData.date,
          ...(invoiceRef ? { reference: invoiceRef } : {}),
        });
      } else if (activeTab === 'invoice' && isFixedAsset && fixedAssetAccountCode.trim()) {
        // Fixed asset purchase: Dr 11xxxx (asset account) instead of 127xxxx warehouse
        const invoiceRef = formData.referenceNumber.trim()
          ? `INV-${formData.referenceNumber.trim()}`
          : undefined;
        transactionId = await accountingService.recordFixedAssetPurchase({
          baseAmount: worksValue,
          vatAmount: vat,
          whtAmount: wht,
          totalAmount: net,
          supplierName: resolvedSupplierName,
          supplierAccountCode: supplierCoaAccount.accountCode,
          assetAccountCode: fixedAssetAccountCode.trim(),
          assetAccountName: fixedAssetAccountName.trim() || fixedAssetAccountCode.trim(),
          description:
            formData.description ||
            `${t('invoice_entry')} - ${resolvedSupplierName} - ${fixedAssetName.trim() || fixedAssetAccountCode.trim()}`,
          date: formData.date,
          ...(invoiceRef ? { reference: invoiceRef } : {}),
        });
      } else if (activeTab === 'invoice' && warehouseAccount) {
        const invoiceRef = formData.referenceNumber.trim()
          ? `INV-${formData.referenceNumber.trim()}`
          : undefined;
        transactionId = await accountingService.recordPurchaseToProjectInventory({
          baseAmount: worksValue,
          vatAmount: vat,
          whtAmount: wht,
          totalAmount: net,
          supplierName: resolvedSupplierName,
          supplierAccountCode: supplierCoaAccount.accountCode,
          inventoryAccountCode: warehouseAccount.accountCode,
          inventoryAccountName: warehouseAccount.accountName,
          description:
            formData.description ||
            `${t('invoice_entry')} - ${resolvedSupplierName}`,
          ...(inventoryProjectId ? { projectId: inventoryProjectId } : {}),
          ...(costCenterIdForGl ? { costCenterId: costCenterIdForGl } : {}),
          date: formData.date,
          ...(invoiceRef ? { reference: invoiceRef } : {}),
        });
      } else if (activeTab === 'ipc' && shouldPostIpcGl) {
        if (isLocalBackend && editingPurchaseId) {
          const approved = await purchaseTransactionsApi.approve(editingPurchaseId);
          transactionId = String(approved.transactionId || '');
        } else {
          transactionId = await accountingService.recordSubcontractorIPC({
            worksValue, vatAmount: vat, netPayable: net, execGuarantee: exec, whtAmount: wht,
            labourInsurance: insurance, manpowerLevy: levy, advancePaymentRecovery: advance,
            supplierName: resolvedSupplierName, supplierAccountCode: supplierCoaAccount.accountCode,
            description: formData.description || `${t('ipc_entry')} - ${resolvedSupplierName}`,
            ...(formData.projectId ? { projectId: formData.projectId } : {}),
            ...(formData.contractId ? { contractId: formData.contractId } : {}),
            ...(costCenterIdForGl ? { costCenterId: costCenterIdForGl } : {}),
            date: formData.date,
          });
        }
      }
      const purchasePayload = {
        type: activeTab,
        supplierId:
          activeTab === 'invoice' && invoicePaymentType === 'cash'
            ? null
            : nullIfEmpty(supplierFromDirectory?.id || supplierCoaAccount.supplierId || ''),
        supplierAccountId: supplierCoaAccount.id,
        supplierName: resolvedSupplierName,
        paymentType: activeTab === 'invoice' ? invoicePaymentType : null,
        projectId: projectIdForSave,
        contractId: contractIdForSave,
        warehouseAccountId: activeTab === 'invoice' && !isSimpleAmountInvoice ? formData.warehouseAccountId : '',
        inventoryAccountCode: activeTab === 'invoice' && !isSimpleAmountInvoice ? warehouseAccount?.accountCode || '' : '',
        inventoryAccountName: activeTab === 'invoice' && !isSimpleAmountInvoice ? warehouseAccount?.accountName || '' : '',
        expenseAccountId:
          activeTab === 'ipc'
            ? nullIfEmpty(formData.expenseAccountId)
            : activeTab === 'invoice' && isIndirectInvoice
              ? expenseCoaAccount?.id || ''
              : '',
        expenseAccountName: activeTab === 'invoice' && isIndirectInvoice ? expenseCoaAccount?.accountName || '' : '',
        date: formData.date,
        referenceNumber: formData.referenceNumber,
        amount: worksValue,
        vatAmount: vat,
        whtAmount: wht,
        execGuaranteeAmount: exec,
        labourInsuranceAmount: insurance,
        manpowerLevyAmount: levy,
        advancePaymentRecovery: advance,
        totalAmount: net,
        description: formData.description || '',
        items: activeTab === 'ipc' ? formData.items : null,
        invoiceLines:
          activeTab === 'invoice' && !isSimpleAmountInvoice
            ? normalizedInvoiceLines.map(mapInvoiceLineForPersistence)
            : null,
        distributedLines: null,
        status: ipcStatusForSave,
        transactionId: activeTab === 'ipc' ? (shouldPostIpcGl ? transactionId : '') : transactionId,
        whtPct: activeTab === 'ipc' ? formData.whtPct : undefined,
        execGuaranteePct: activeTab === 'ipc' ? formData.execGuaranteePct : undefined,
        isDeleted: false,
      };
      let purchaseId: string;
      if (isLocalBackend) {
        const apiBody = {
          type: purchasePayload.type,
          supplierId: purchasePayload.supplierId,
          supplierAccountId: nullIfEmpty(purchasePayload.supplierAccountId),
          supplierName: purchasePayload.supplierName,
          paymentType: purchasePayload.paymentType,
          projectId: purchasePayload.projectId,
          contractId: purchasePayload.contractId,
          expenseAccountId: nullIfEmpty(purchasePayload.expenseAccountId),
          expenseAccountName: purchasePayload.expenseAccountName,
          date: purchasePayload.date,
          referenceNumber: purchasePayload.referenceNumber,
          amount: purchasePayload.amount,
          vatAmount: purchasePayload.vatAmount,
          whtAmount: purchasePayload.whtAmount,
          execGuaranteeAmount: purchasePayload.execGuaranteeAmount,
          labourInsuranceAmount: purchasePayload.labourInsuranceAmount,
          manpowerLevyAmount: purchasePayload.manpowerLevyAmount,
          advancePaymentRecovery: purchasePayload.advancePaymentRecovery,
          totalAmount: purchasePayload.totalAmount,
          description: purchasePayload.description,
          status: purchasePayload.status,
          transactionId: nullIfEmpty(purchasePayload.transactionId),
          isDeleted: purchasePayload.isDeleted,
          items: activeTab === 'ipc' ? formData.items : null,
          invoiceLines:
            activeTab === 'invoice' && !isSimpleAmountInvoice
              ? normalizedInvoiceLines.map(mapInvoiceLineForPersistence)
              : undefined,
          whtPct: formData.whtPct,
          execGuaranteePct: activeTab === 'ipc' ? formData.execGuaranteePct : undefined,
        };
        if (activeTab === 'ipc' && ipcSaveMode === 'approve' && editingPurchaseId) {
          purchaseId = editingPurchaseId;
        } else if (editingPurchaseId && activeTab === 'ipc') {
          await purchaseTransactionsApi.update(editingPurchaseId, apiBody);
          purchaseId = editingPurchaseId;
        } else {
          const created = await purchaseTransactionsApi.create(apiBody);
          purchaseId = String(created.id);
        }
      } else if (activeTab === 'ipc' && ipcSaveMode === 'approve' && editingPurchaseId) {
        await updateDoc(doc(db, 'purchase_transactions', editingPurchaseId), {
          status: 'approved',
          transactionId,
        });
        purchaseId = editingPurchaseId;
      } else if (editingPurchaseId && activeTab === 'ipc') {
        await updateDoc(doc(db, 'purchase_transactions', editingPurchaseId), {
          ...purchasePayload,
          whtPct: formData.whtPct,
          execGuaranteePct: formData.execGuaranteePct,
        });
        purchaseId = editingPurchaseId;
      } else {
        const purchaseDocRef = await addDoc(collection(db, 'purchase_transactions'), {
          ...purchasePayload,
          whtPct: activeTab === 'ipc' ? formData.whtPct : undefined,
          execGuaranteePct: activeTab === 'ipc' ? formData.execGuaranteePct : undefined,
          createdAt: serverTimestamp(),
        });
        purchaseId = purchaseDocRef.id;
      }
      // If this is a fixed asset purchase, create a pending_setup fixed asset record
      if (activeTab === 'invoice' && isFixedAsset && isLocalBackend && fixedAssetAccountCode.trim()) {
        try {
          const assetValue = worksValue + vat; // Dr amount (incl. VAT)
          await import('../services/local/modulesApi').then(({ fixedAssetsApi }) =>
            fixedAssetsApi.create({
              assetName: fixedAssetName.trim() || `${resolvedSupplierName} - ${formData.date}`,
              acquisitionDate: formData.date,
              assetValue,
              assetAccountCode: fixedAssetAccountCode.trim(),
              assetAccountName: fixedAssetAccountName.trim() || fixedAssetAccountCode.trim(),
              accumulatedDepreciationAccountCode: '',
              expenseAccountCode: '',
              purchaseTransactionId: purchaseId,
              status: 'pending_setup',
            } as Parameters<typeof fixedAssetsApi.create>[0])
          );
          toast(
            language === 'ar'
              ? 'تم إنشاء سجل الأصل الثابت في وضع "انتظار الإعداد" — يرجى إكمال البيانات في موديول الأصول الثابتة'
              : 'Fixed asset record created (pending setup) — complete details in the Fixed Assets module',
            { duration: 6000 },
          );
        } catch (faErr) {
          console.warn('Fixed asset record creation failed:', faErr);
          toast.error(
            language === 'ar'
              ? `تم ترحيل القيد لكن فشل إنشاء سجل الأصل الثابت: ${faErr instanceof Error ? faErr.message : String(faErr)}`
              : `Journal posted but fixed asset register row failed: ${faErr instanceof Error ? faErr.message : String(faErr)}`,
            { duration: 8000 },
          );
        }
      }

      if (activeTab === 'invoice' && isLocalBackend && inventoryProjectId && !isIndirectInvoice && !isFixedAsset) {
        try {
          const projectHint = projects?.find((p) => p.id === inventoryProjectId);
          await ensureLocalProjectExists(inventoryProjectId, {
            projectName: projectHint?.projectName,
            projectCode: projectHint?.projectCode as string | undefined,
            clientName: projectHint?.clientName as string | undefined,
            budget: Number(projectHint?.budget ?? 0),
          });
          await sqliteCoreApi.createDistributedPurchaseInvoice({
            invoiceId: purchaseId,
            invoiceNumber: formData.referenceNumber,
            invoiceDate: formData.date,
            supplierName: resolvedSupplierName,
            projectId: inventoryProjectId,
            status: 'confirmed',
            vatPct: formData.invoiceVatPct,
            lines: normalizedInvoiceLines.map(mapInvoiceLineForPersistence),
          });
          try {
            const summary = (await inventoryApi.projectSummary(inventoryProjectId)) as {
              items: InventoryBalanceItem[];
            };
            if (summary?.items) setInventorySnapshot(summary.items);
          } catch {
            // non-critical
          }
          try {
            const spentRows = await inventoryApi.spentByContract();
            const spentMap = new Map<string, number>();
            for (const row of spentRows) spentMap.set(row.contractId, row.totalSpent);
            setBoqSpentByContract(spentMap);
          } catch {
            // non-critical
          }
        } catch (sqliteErr) {
          console.warn('SQLite distributed invoice sync failed:', sqliteErr);
          try {
            await accountingService.softDelete('purchase_transactions', purchaseId);
            if (transactionId) await accountingService.deleteTransaction(transactionId);
          } catch (rollbackErr) {
            console.warn('Purchase invoice rollback after SQLite sync failure failed:', rollbackErr);
          }
          toast.error(
            language === 'ar'
              ? 'فشل إثبات الفاتورة في المخزون، لذلك تم إلغاء حفظ الفاتورة والقيد.'
              : 'Invoice inventory posting failed, so the invoice and journal entry were rolled back.'
          );
          return;
        }
      }
      toast.success(
        activeTab === 'invoice'
          ? language === 'ar'
            ? 'تم حفظ الفاتورة وإنشاء القيد بنجاح.'
            : 'Invoice saved and journal entry created successfully.'
          : ipcSaveMode === 'approve'
            ? language === 'ar'
              ? 'تم اعتماد المستخلص وترحيل القيد بنجاح.'
              : 'IPC approved and journal entry posted successfully.'
            : ipcSaveMode === 'draft'
              ? language === 'ar'
                ? 'تم حفظ المستخلص كمسودة.'
                : 'IPC saved as draft.'
              : language === 'ar'
                ? 'تم تقديم المستخلص للاعتماد.'
                : 'IPC submitted for approval.'
      );
      if (activeTab === 'ipc' && (ipcSaveMode === 'submit' || ipcSaveMode === 'approve')) {
        window.dispatchEvent(new CustomEvent('notifications:refresh'));
      }
      if (isLocalBackend) setPurchaseRefreshKey((k) => k + 1);
      setShowModal(false);
      resetForm();
    } catch (err) {
      if (err instanceof NetworkQueuedError) {
        setShowModal(false);
        resetForm();
        return;
      }
      if (transactionId) {
        try {
          await accountingService.deleteTransaction(transactionId);
        } catch (rollbackErr) {
          console.warn('Journal rollback after save failure failed:', rollbackErr);
        }
      }
      if (isLocalBackend) {
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        toast.error(
          msg || (language === 'ar' ? 'فشل حفظ المعاملة.' : 'Failed to save transaction.'),
        );
      } else {
        handleFirestoreError(err, OperationType.CREATE, 'purchase_transactions');
      }
    } finally {
      setIsSubmitting(false);
      ipcPreviewConfirmedRef.current = false;
      ipcSaveModeRef.current = 'submit';
    }
  };

  const resetForm = () => {
    ipcBoqSyncKeyRef.current = '';
    setEditingPurchaseId(null);
    ipcSaveModeRef.current = 'submit';
    setFormData({
      supplierId: '', paymentType: 'credit', projectId: '', contractId: '', costCenterId: '', warehouseAccountId: '', expenseAccountId: '',
      date: new Date().toISOString().split('T')[0], referenceNumber: '',
      amount: 0, invoiceLines: [createInvoiceLineDraft()], invoiceVatPct: BILLING_DEFAULTS.VAT_PCT, vatPct: BILLING_DEFAULTS.VAT_PCT, whtPct: BILLING_DEFAULTS.WHT_PCT,
      execGuaranteePct: 5, labourInsurancePct: 0, manpowerLevyPct: 0, advancePaymentRecovery: 0,
      description: '', items: [],
    });
    setIsFixedAsset(false);
    setFixedAssetName('');
    setFixedAssetAccountCode('');
    setFixedAssetAccountName('');
  };

  const handleDeleteTransaction = (tx: PurchaseTransaction) => {
    setConfirmConfig({
      isOpen: true,
      title: language === 'ar' ? 'تأكيد الحذف' : 'Confirm Delete',
      message: language === 'ar' ? 'هل أنت متأكد من حذف هذه المعاملة؟ سيتم حذف القيد المحاسبي المرتبط به أيضاً.' : 'Delete this transaction and its journal entry?',
      onConfirm: async () => {
        setIsDeleting(true);
        try {
          await accountingService.softDelete('purchase_transactions', tx.id);
          if (tx.transactionId) await accountingService.deleteTransaction(tx.transactionId);
          if (isLocalBackend) setPurchaseRefreshKey((k) => k + 1);
          setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, 'purchase_transactions');
        } finally { setIsDeleting(false); }
      }
    });
  };

  // ── Derived values ─────────────────────────────────────────────────────────
  const normalizedInvoiceLines = useMemo(
    () =>
      formData.invoiceLines.map((line) => {
        const quantity = Number(line.quantity || 0);
        const unitCost = Number(line.unitCost || 0);
        const lineTotal = toMoneySafe(quantity * unitCost);
        const inventoryUnitCost = unitCostInclVat(unitCost, formData.invoiceVatPct);
        return {
          ...line,
          quantity,
          unitCost,
          totalCost: lineTotal,
          inventoryUnitCost,
        };
      }),
    [formData.invoiceLines, formData.invoiceVatPct]
  );

  const invoiceBaseAmount = useMemo(() => {
    if (isSimpleAmountInvoice) return toMoneySafe(Number(formData.amount) || 0);
    return toMoneySafe(normalizedInvoiceLines.reduce((sum, line) => sum + line.totalCost, 0));
  }, [normalizedInvoiceLines, isSimpleAmountInvoice, formData.amount]);

  const filteredContractsForPicker = useMemo(
    () => (filterProjectId ? scopedContracts.filter((c) => c.projectId === filterProjectId) : scopedContracts),
    [scopedContracts, filterProjectId],
  );

  const purchaseSidebarList = useMemo(() => {
    if (activeTab !== 'invoice' && activeTab !== 'ipc') return [];
    const tab = activeTab;
    let list = scopedTransactions.filter((tx) => tx.type === tab);
    if (filterProjectId) list = list.filter((tx) => tx.projectId === filterProjectId);
    if (filterContractId) list = list.filter((tx) => tx.contractId === filterContractId);
    const q = searchTerm.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (tx) =>
          tx.supplierName.toLowerCase().includes(q) ||
          tx.referenceNumber.toLowerCase().includes(q),
      );
    }
    list = list.filter((tx) =>
      matchesPurchaseStatusFilter(tx as PurchaseTransaction, tab, purchaseStatusFilter),
    );
    return [...list].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [
    scopedTransactions,
    activeTab,
    filterProjectId,
    filterContractId,
    searchTerm,
    purchaseStatusFilter,
  ]);

  const purchaseStatusCounts = useMemo(() => {
    const tab = activeTab === 'ipc' ? 'ipc' : activeTab === 'invoice' ? 'invoice' : null;
    if (!tab) return { all: 0, draft: 0, submitted: 0, approved: 0, pending: 0, posted: 0, paid: 0 };
    let base = scopedTransactions.filter((tx) => tx.type === tab);
    if (filterProjectId) base = base.filter((tx) => tx.projectId === filterProjectId);
    if (filterContractId) base = base.filter((tx) => tx.contractId === filterContractId);
    const counts = { all: base.length, draft: 0, submitted: 0, approved: 0, pending: 0, posted: 0, paid: 0 };
    for (const tx of base) {
      const row = tx as PurchaseTransaction;
      if (tab === 'ipc') {
        const st = resolveIpcWorkflowStatus(row);
        if (st === 'draft') counts.draft += 1;
        if (st === 'submitted') counts.submitted += 1;
        if (st === 'approved') counts.approved += 1;
        if (row.status === 'paid') counts.paid += 1;
      } else {
        if (row.transactionId) counts.posted += 1;
        else if (row.status === 'paid') counts.paid += 1;
        else counts.pending += 1;
      }
    }
    return counts;
  }, [scopedTransactions, activeTab, filterProjectId, filterContractId]);

  const enrichedDetailPurchase = useMemo(() => {
    if (!detailPurchase) return detailPurchase;
    if (detailPurchase.type === 'invoice') {
      const invoiceLines = mapStoredInvoiceLines(
        detailPurchase.invoiceLines ?? detailPurchase.items,
      ).filter((line) => line.itemDescription.trim() || line.quantity > 0 || line.unitCost > 0);
      return { ...detailPurchase, invoiceLines };
    }
    if (detailPurchase.type !== 'ipc') return detailPurchase;
    const items = (detailPurchase.items ?? []).map((item) => {
      const boq = scopedBoqItems.find((b) => b.id === item.boqItemId);
      return {
        ...item,
        chapterName: boq?.chapterName,
        sectionName: boq?.sectionName,
        tenderQty: (item as BillingItem & { tenderQty?: number }).tenderQty ?? boq?.tenderQty,
      };
    });
    return { ...detailPurchase, items };
  }, [detailPurchase, scopedBoqItems]);

  const selectedDetailProjectLabel = useMemo(() => {
    if (!detailPurchase?.projectId) return undefined;
    return scopedProjects.find((p) => p.id === detailPurchase.projectId)?.projectName;
  }, [detailPurchase, scopedProjects]);

  const selectedDetailContractLabel = useMemo(() => {
    if (!detailPurchase?.contractId) return undefined;
    const c = scopedContracts.find((x) => x.id === detailPurchase.contractId);
    return c?.contractName || c?.contractNumber;
  }, [detailPurchase, scopedContracts]);

  const selectedDetailExpenseLabel = useMemo(() => {
    if (!detailPurchase?.expenseAccountId) return undefined;
    const acc = accounts.find((a) => a.id === detailPurchase.expenseAccountId);
    if (!acc) return undefined;
    return language === 'ar' ? acc.accountName : (acc.accountNameEn || acc.accountName);
  }, [detailPurchase, accounts, language]);

  const boqBudgetByContract = useMemo(() => {
    const map = new Map<string, number>();
    scopedBoqItems.forEach(i => { if (i.contractId && i.isDeleted !== true) map.set(i.contractId, (map.get(i.contractId) || 0) + (i.tenderAmount || 0)); });
    return map;
  }, [scopedBoqItems]);

  const spentByContract = useMemo(() => {
    const map = new Map<string, number>();
    if (isLocalBackend) {
      boqSpentByContract.forEach((spent, contractId) => map.set(contractId, spent));
    }
    scopedTransactions.forEach((tx) => {
      if (!tx.contractId) return;
      if (tx.type === 'invoice') return;
      if (!isIpcJournalPosted(tx as PurchaseTransaction)) return;
      const gross = (tx.amount || 0) + (tx.vatAmount || 0);
      map.set(tx.contractId, (map.get(tx.contractId) || 0) + gross);
    });
    return map;
  }, [scopedTransactions, isLocalBackend, boqSpentByContract]);

  const creditorAccountSelectOptions = useMemo(() => {
    if (activeTab === 'custody') return [];
    if (activeTab === 'invoice' && formData.paymentType === 'cash') {
      return accounts
        .filter((a) => isCustodyOrCashFundAccount(a))
        .sort((x, y) => String(x.accountCode || '').localeCompare(String(y.accountCode || ''), undefined, { numeric: true }))
        .map((a) => ({
          value: a.id as string,
          secondary: a.accountCode as string,
          label: language === 'ar' ? a.accountName : (a.accountNameEn || a.accountName || ''),
        }));
    }
    const tab = activeTab as 'invoice' | 'ipc';
    return accounts
      .filter(a => matchesCreditorLedgerForTab(a, tab))
      .sort((x, y) => String(x.accountCode || '').localeCompare(String(y.accountCode || ''), undefined, { numeric: true }))
      .map(a => ({
        value: a.id as string,
        secondary: a.accountCode as string,
        label: language === 'ar' ? a.accountName : (a.accountNameEn || a.accountName || ''),
      }));
  }, [accounts, activeTab, formData.paymentType, language]);

  const expenseAccountSelectOptions = useMemo(
    () =>
      accounts
        .filter((a) => String(a.accountCode).startsWith('5') && String(a.accountCode).length === 8)
        .sort((x, y) => String(x.accountCode || '').localeCompare(String(y.accountCode || ''), undefined, { numeric: true }))
        .map((a) => ({
          value: a.id as string,
          secondary: a.accountCode as string,
          label: language === 'ar' ? a.accountName : (a.accountNameEn || a.accountName || ''),
        })),
    [accounts, language],
  );

  const warehouseAccountSelectOptions = useMemo(() => {
    return accounts
      .filter((a) => {
        if (!isProjectWarehouseAccount(a)) return false;
        const projectId = resolveProjectIdForWarehouse(
          { accountCode: String(a.accountCode), projectId: a.projectId as string | undefined },
          scopedProjects
        );
        if (isProjectAccountant && !scopedProjectSet.has(projectId)) return false;
        return true;
      })
      .sort((x, y) =>
        String(x.accountCode || '').localeCompare(String(y.accountCode || ''), undefined, { numeric: true })
      )
      .map((a) => {
        const projectId = resolveProjectIdForWarehouse(
          { accountCode: String(a.accountCode), projectId: a.projectId as string | undefined },
          scopedProjects
        );
        const project = scopedProjects.find((p) => p.id === projectId);
        const projectLabel =
          project?.projectName ||
          projectId ||
          (language === 'ar' ? 'عام/غير مربوط' : 'General / unlinked');
        return {
          value: a.id as string,
          secondary: a.accountCode as string,
          label:
            language === 'ar'
              ? `${a.accountName} (${projectLabel})`
              : `${a.accountNameEn || a.accountName} (${projectLabel})`,
        };
      });
  }, [accounts, scopedProjects, scopedProjectSet, isProjectAccountant, language]);

  const fixedAssetAccountSelectOptions = useMemo(
    () =>
      chartLeafAccountOptions(
        accounts.filter((a) => String(a.accountCode ?? '').trim().startsWith('11')),
        language === 'en' ? 'en' : 'ar',
      ),
    [accounts, language],
  );

  const handleFixedAssetAccountChange = useCallback(
    (accountCode: string) => {
      const code = accountCode.trim();
      const acc = accounts.find((a) => String(a.accountCode ?? '').trim() === code);
      setFixedAssetAccountCode(code);
      setFixedAssetAccountName(
        acc
          ? (language === 'ar' ? acc.accountName : (acc.accountNameEn?.trim() || acc.accountName || ''))
          : '',
      );
    },
    [accounts, language],
  );

  const newEntryAmount =
    activeTab === 'invoice'
      ? invoiceBaseAmount + invoiceBaseAmount * (formData.invoiceVatPct / 100)
      : (() => {
          const w = formData.items.reduce((s, i) => s + i.amount, 0);
          return w + w * (formData.vatPct / 100);
        })();
  const contractBudget = boqBudgetByContract.get(formData.contractId) || 0;
  const contractSpent = spentByContract.get(formData.contractId) || 0;
  const isDirectIpcCenter =
    activeTab === 'ipc' &&
    !!formData.costCenterId &&
    isDirectCostCenterId(formData.costCenterId, scopedContracts);
  const budgetExceeded =
    isDirectIpcCenter &&
    contractBudget > 0 &&
    (contractSpent + newEntryAmount) > contractBudget;
  const overByAmount = contractSpent + newEntryAmount - contractBudget;

  // ── Shared classes ─────────────────────────────────────────────────────────
  const inputCls = cn('w-full border rounded-xl py-3 px-4 text-sm outline-none focus:border-blue-500 transition-colors', theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200');
  const cardCls = cn(
    'rounded-xl border p-4',
    theme === 'dark' ? 'border-gray-800 bg-gray-900/40' : theme === 'soft' ? 'border-[#cfd8dc] bg-white' : 'border-gray-200 bg-white',
  );
  const sectionTitleCls = 'text-xs font-bold uppercase tracking-wide text-gray-500';
  const selectCls = cn(
    'w-full rounded-lg border px-3 py-2 text-sm font-bold outline-none focus:border-blue-500 transition-colors',
    theme === 'dark' ? 'bg-gray-900 border-gray-800 text-white' : theme === 'soft' ? 'bg-white border-[#cfd8dc] text-gray-900' : 'bg-white border-gray-300 text-gray-900',
  );
  const labelCls = cn('block text-xs font-bold mb-1.5', theme === 'dark' ? 'text-gray-400' : 'text-gray-500');

  const ALL_TABS: { id: ActiveTab; labelAr: string; labelEn: string; icon: React.ReactNode }[] = [
    { id: 'invoice', labelAr: 'فاتورة مشتريات', labelEn: 'Purchase Invoice', icon: <Receipt size={16} /> },
    { id: 'ipc',     labelAr: 'مستخلص مقاول',  labelEn: 'Subcontractor IPC', icon: <FileText size={16} /> },
    { id: 'custody', labelAr: 'تسوية عهدة',    labelEn: 'Custody Settlement', icon: <ShoppingCart size={16} /> },
  ];
  const TABS = ALL_TABS.filter((t) => canViewTab(t.id));

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={cn('p-8 min-h-screen transition-colors', theme === 'dark' ? 'bg-[#0a0a0a] text-gray-100' : 'bg-gray-50 text-gray-900')} dir={dir}>

      {/* Header */}
      <header className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{t(SCREEN_TITLE_KEY[activeTab])}</h2>
          <p className="text-gray-400 mt-1 text-sm">{t(SCREEN_SUBTITLE_KEY[activeTab])}</p>
          {isLocalBackend && (
            <p className="text-xs text-amber-600/80 mt-2">
              {language === 'ar'
                ? `Postgres: ${transactions.length} معاملة · ${projects.length} مشروع`
                : `Postgres: ${transactions.length} transactions · ${projects.length} projects`}
            </p>
          )}
        </div>
      </header>

      {/* Tab bar + new entry (next to custody tab) */}
      {!isErpShell && (
      <div className={cn('flex flex-wrap items-center gap-3 mb-6')}>
        <div className={cn('flex gap-1 p-1 rounded-xl w-fit', theme === 'dark' ? 'bg-gray-900' : 'bg-gray-100')}>
          {TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn('flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all', activeTab === tab.id ? 'bg-blue-600 text-white shadow' : theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-800')}
            >
              {tab.icon}
              {language === 'ar' ? tab.labelAr : tab.labelEn}
            </button>
          ))}
        </div>
      </div>
      )}

      {/* H2: بطاقة رصيد المخزون بعد حفظ فاتورة موزعة */}
      {inventorySnapshot && inventorySnapshot.length > 0 && activeTab === 'invoice' && (
        <div className={cn('mb-6 rounded-xl border p-4', theme === 'dark' ? 'border-green-800 bg-green-950/30' : 'border-green-200 bg-green-50')}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={18} className="text-green-600" />
              <span className="font-bold text-green-700 dark:text-green-400 text-sm">
                {language === 'ar' ? 'رصيد المخزون المحدَّث بعد الفاتورة' : 'Updated Inventory Balance After Invoice'}
              </span>
            </div>
            <button
              type="button"
              aria-label={language === 'ar' ? 'إغلاق' : 'Close'}
              title={language === 'ar' ? 'إغلاق' : 'Close'}
              onClick={() => setInventorySnapshot(null)}
              className="text-gray-400 hover:text-gray-600"
            >
              <X size={16} />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b">
                  <th className="pb-1 text-start">{language === 'ar' ? 'الصنف' : 'Item'}</th>
                  <th className="pb-1 text-center">{language === 'ar' ? 'الوحدة' : 'Unit'}</th>
                  <th className="pb-1 text-center">{language === 'ar' ? 'الرصيد' : 'Balance'}</th>
                  <th className="pb-1 text-center">{language === 'ar' ? 'المتاح' : 'Available'}</th>
                  <th className="pb-1 text-center">{language === 'ar' ? 'سعر الوحدة' : 'Unit Cost'}</th>
                  <th className="pb-1 text-end">{language === 'ar' ? 'العقد' : 'Contract'}</th>
                </tr>
              </thead>
              <tbody>
                {inventorySnapshot.map((item, idx) => (
                  <tr key={item.id || `${item.projectId || 'project'}-${item.materialCategoryId || item.itemDescription}-${idx}`} className="border-t border-dashed">
                    <td className="py-1 font-medium">{item.itemDescription}</td>
                    <td className="py-1 text-center">{item.unit}</td>
                    <td className="py-1 text-center font-mono font-bold">{formatQuantity(item.quantityBalance, language)}</td>
                    <td className="py-1 text-center font-mono text-green-700 font-bold">{formatQuantity(item.quantityAvailable, language)}</td>
                    <td className="py-1 text-center font-mono">{formatMoney(item.unitCost)}</td>
                    <td className="py-1 text-end text-gray-500">{item.contractNumber || item.contractId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── CUSTODY TAB ──────────────────────────────────────────────────── */}
      {activeTab === 'custody' && (
        <>
          <div className="flex items-center gap-2 mb-4">
            <ManualHelpButton topicId="costs.custody.settlement" />
          </div>
          <GLCustodySettlement
          accounts={accounts}
          transactions={glTransactions}
          contracts={scopedContracts}
          projects={scopedProjects}
          theme={theme}
          language={language}
          dir={dir}
          allowLedgerCreate={canPostCustody}
          canApproveSettlement={canApproveCustody}
          initialOpenId={pendingCustodyOpenId}
          onSettlementSaved={() => setGlRefreshKey((k) => k + 1)}
          onCoaChanged={() => {
            invalidateCoaCache();
            setCoaRefreshKey((k) => k + 1);
          }}
        />
        </>
      )}

      {/* ── INVOICE / IPC TABS ────────────────────────────────────────────── */}
      {(activeTab === 'invoice' || activeTab === 'ipc') && (
        <div className={cn('flex flex-col md:flex-row md:items-start gap-4', dir === 'rtl' ? 'md:flex-row-reverse' : '')}>
          <div className="flex-1 min-w-0 md:flex-[3] space-y-4 order-2 md:order-none">
            {loading || detailPurchaseLoading ? (
              <div className={cn('border rounded-xl p-12 text-center text-gray-500 flex flex-col items-center gap-4', theme === 'dark' ? 'border-gray-800 bg-[#151619]' : 'border-gray-200 bg-white')}>
                <Loader2 className="animate-spin text-blue-500" size={32} />
                {language === 'ar' ? 'جاري التحميل...' : 'Loading...'}
              </div>
            ) : purchaseSidebarList.length === 0 ? (
              <div className={cn('border rounded-xl p-12 text-center', theme === 'dark' ? 'border-gray-800 bg-[#151619]' : 'border-gray-200 bg-white')}>
                <p className={cn('text-sm', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>{t('costs_filter_empty')}</p>
              </div>
            ) : !selectedPurchaseId || !enrichedDetailPurchase ? (
              <div className={cn('border rounded-xl p-12 text-center', theme === 'dark' ? 'border-gray-800 bg-[#151619]' : 'border-gray-200 bg-white')}>
                <p className={cn('text-sm', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>{t('costs_filter_select_record')}</p>
              </div>
            ) : (
              <div className={cn(cardCls, 'p-6 max-h-[calc(100vh-8rem)] overflow-y-auto')}>
                <PurchaseTransactionDetail
                  tx={enrichedDetailPurchase}
                  tab={activeTab}
                  theme={theme}
                  language={language}
                  formatMoney={formatMoney}
                  projectLabel={selectedDetailProjectLabel}
                  contractLabel={selectedDetailContractLabel}
                  expenseAccountLabel={selectedDetailExpenseLabel}
                  ipcStatus={
                    enrichedDetailPurchase.type === 'ipc'
                      ? resolveIpcWorkflowStatus(enrichedDetailPurchase)
                      : enrichedDetailPurchase.status
                  }
                  canEdit={
                    activeTab === 'invoice'
                      ? !enrichedDetailPurchase.transactionId
                      : !isIpcJournalPosted(enrichedDetailPurchase)
                  }
                  canDelete
                  canApprove={canApproveIpcTransaction(enrichedDetailPurchase)}
                  onEdit={() => void openPurchaseTransaction(enrichedDetailPurchase)}
                  onDelete={() => handleDeleteTransaction(enrichedDetailPurchase)}
                  onApprove={() => beginIpcApproval(enrichedDetailPurchase)}
                  onPrint={
                    activeTab === 'ipc' && isIpcJournalPosted(enrichedDetailPurchase)
                      ? () => handlePrintSubcontractorIpcFromTx(enrichedDetailPurchase)
                      : undefined
                  }
                />
              </div>
            )}
          </div>

          <aside className={cn(cardCls, 'w-full md:flex-[2] md:min-w-[17rem] md:max-w-[24rem] shrink-0 space-y-4 md:sticky md:top-4 order-1 md:order-none')}>
            <div>
              <h3 className="font-bold text-sm">{t('costs_filter_title')}</h3>
            </div>

            {canCreateInTab(activeTab) && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { resetForm(); setShowModal(true); }}
                  className={cn(
                    'flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-bold text-white transition-colors',
                    'bg-blue-600 hover:bg-blue-500',
                  )}
                >
                  <Plus size={16} />
                  {activeTab === 'invoice' ? t('costs_new_invoice') : t('costs_new_ipc')}
                </button>
                {activeTab === 'invoice' && (
                  <ManualHelpButton topicId="costs.invoice.purchase" size={16} />
                )}
                {activeTab === 'ipc' && (
                  <ManualHelpButton topicId="costs.ipc.subcontractor" size={16} />
                )}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className={labelCls}>{t('project')}</label>
                <select className={selectCls} value={filterProjectId} onChange={(e) => setFilterProjectId(e.target.value)}>
                  <option value="">{language === 'ar' ? '— كل المشاريع —' : '— All projects —'}</option>
                  {scopedProjects.map((p) => (
                    <option key={p.id} value={p.id}>{p.projectName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>{t('contract')}</label>
                <select className={selectCls} value={filterContractId} onChange={(e) => setFilterContractId(e.target.value)}>
                  <option value="">{language === 'ar' ? '— كل العقود —' : '— All contracts —'}</option>
                  {filteredContractsForPicker.map((c) => (
                    <option key={c.id} value={c.id}>{c.contractName} ({c.contractNumber})</option>
                  ))}
                </select>
              </div>
            </div>

            <div className={cn('pt-3 border-t space-y-2', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
              <label className={labelCls}>{language === 'ar' ? 'تصفية حسب الحالة' : 'Filter by status'}</label>
              <select
                className={selectCls}
                value={purchaseStatusFilter}
                onChange={(e) => setPurchaseStatusFilter(e.target.value as PurchaseStatusFilter)}
              >
                <option value="all">{language === 'ar' ? `الكل (${purchaseStatusCounts.all})` : `All (${purchaseStatusCounts.all})`}</option>
                {activeTab === 'ipc' ? (
                  <>
                    <option value="draft">{language === 'ar' ? 'مسودة' : 'Draft'} ({purchaseStatusCounts.draft})</option>
                    <option value="submitted">{language === 'ar' ? 'بانتظار الاعتماد' : 'Awaiting approval'} ({purchaseStatusCounts.submitted})</option>
                    <option value="approved">{language === 'ar' ? 'معتمد' : 'Approved'} ({purchaseStatusCounts.approved})</option>
                  </>
                ) : (
                  <>
                    <option value="pending">{language === 'ar' ? 'معلق' : 'Pending'} ({purchaseStatusCounts.pending})</option>
                    <option value="posted">{language === 'ar' ? 'مرحّلة' : 'Posted'} ({purchaseStatusCounts.posted})</option>
                    <option value="paid">{language === 'ar' ? 'تم السداد' : 'Paid'} ({purchaseStatusCounts.paid})</option>
                  </>
                )}
              </select>
            </div>

            <div className={cn('pt-3 border-t space-y-2', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
              <label className={labelCls}>{language === 'ar' ? 'بحث' : 'Search'}</label>
              <div className="relative">
                <Search className={cn('absolute top-1/2 -translate-y-1/2 text-gray-500', dir === 'rtl' ? 'right-3' : 'left-3')} size={16} />
                <input
                  type="text"
                  placeholder={language === 'ar' ? 'بحث...' : 'Search...'}
                  className={cn('w-full border rounded-lg py-2 text-sm outline-none focus:border-blue-500', dir === 'rtl' ? 'pr-9 pl-4' : 'pl-9 pr-4', theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200')}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>

            <div className={cn('pt-3 border-t space-y-2', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
              <p className={sectionTitleCls}>{t('costs_filter_list')}</p>
              {loading ? (
                <Loader2 className="animate-spin mx-auto" size={18} />
              ) : purchaseSidebarList.length === 0 ? (
                <p className="text-xs text-gray-500">{t('costs_filter_empty')}</p>
              ) : (
                <ul className="space-y-1 max-h-52 overflow-auto">
                  {purchaseSidebarList.map((tx, txIdx) => {
                    const active = selectedPurchaseId === tx.id;
                    const tab = activeTab as 'invoice' | 'ipc';
                    const paymentType =
                      tab === 'invoice' ? normalizeInvoicePaymentType((tx as PurchaseTransaction).paymentType) : null;
                    return (
                      <li key={tx.id || `tx-${tx.referenceNumber}-${txIdx}`}>
                        <button
                          type="button"
                          onClick={() => void selectPurchaseForDetail(tx as PurchaseTransaction)}
                          className={cn(
                            'w-full text-start px-2.5 py-1 rounded-lg text-sm border transition-colors',
                            active
                              ? 'bg-blue-600 text-white border-blue-600'
                              : theme === 'dark'
                                ? 'text-gray-300 border-gray-800 hover:bg-gray-800'
                                : 'text-gray-700 border-gray-200 hover:bg-gray-50',
                          )}
                        >
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0 min-h-[1.25rem] leading-tight">
                            <span className="font-bold shrink-0">{tx.referenceNumber || tx.id.slice(0, 8)}</span>
                            <span className="text-xs opacity-80 shrink-0">{tx.date}</span>
                            <span className="text-[10px] opacity-75 shrink-0">
                              {purchaseStatusLabel(tx as PurchaseTransaction, tab, language)}
                            </span>
                            {paymentType && (
                              <span className="text-[10px] opacity-75 shrink-0">
                                {paymentType === 'cash' ? t('invoice_payment_cash') : t('invoice_payment_credit')}
                              </span>
                            )}
                            <span className="text-[10px] opacity-75 shrink-0 truncate max-w-[8rem]">{tx.supplierName}</span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* ── ENTRY MODAL ───────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className={cn(
                'w-full border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]',
                activeTab === 'ipc' || (activeTab === 'invoice' && !isSimpleAmountInvoice && normalizedInvoiceLines.some((l) => l.quantity > 0))
                  ? 'max-w-[min(96vw,72rem)]'
                  : 'max-w-2xl',
                theme === 'dark' ? 'bg-[#151619] border-gray-800' : 'bg-white border-gray-200',
              )}
            >
              <div className={cn('p-6 border-b flex justify-between items-center shrink-0 gap-3', theme === 'dark' ? 'bg-gray-900/50 border-gray-800' : 'bg-gray-50 border-gray-200')}>
                <div className="flex items-center gap-2 min-w-0">
                  <h3 className="text-xl font-bold flex items-center gap-2">
                    {activeTab === 'invoice' ? <Receipt className="text-blue-500" size={24} /> : <FileText className="text-blue-500" size={24} />}
                    {activeTab === 'invoice'
                      ? editingPurchaseId
                        ? invoiceFormReadOnly
                          ? (language === 'ar' ? 'معاينة فاتورة' : 'View invoice')
                          : (language === 'ar' ? 'تعديل فاتورة' : 'Edit invoice')
                        : t('invoice_entry')
                      : editingPurchaseId
                        ? ipcFormReadOnly
                          ? (language === 'ar' ? 'معاينة مستخلص' : 'View IPC')
                          : (language === 'ar' ? 'تعديل مستخلص' : 'Edit IPC')
                        : t('ipc_entry')}
                    {activeTab === 'invoice' && invoiceFormReadOnly && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase bg-green-900/40 text-green-400">
                        {language === 'ar' ? 'مرحّلة' : 'Posted'}
                      </span>
                    )}
                    {activeTab === 'ipc' && editingIpcStatus && (
                      <span className={cn(
                        'text-[10px] font-bold px-2 py-0.5 rounded-full uppercase',
                        editingIpcStatus === 'approved' ? 'bg-green-900/40 text-green-400'
                          : editingIpcStatus === 'submitted' ? 'bg-amber-900/40 text-amber-400'
                          : editingIpcStatus === 'draft' ? 'bg-gray-800 text-gray-400'
                          : 'bg-yellow-900/40 text-yellow-400',
                      )}>
                        {editingIpcStatus === 'approved'
                          ? (language === 'ar' ? 'معتمد' : 'Approved')
                          : editingIpcStatus === 'submitted'
                            ? (language === 'ar' ? 'بانتظار الاعتماد' : 'Awaiting approval')
                            : editingIpcStatus === 'draft'
                              ? (language === 'ar' ? 'مسودة' : 'Draft')
                              : editingIpcStatus}
                      </span>
                    )}
                  </h3>
                  {activeTab === 'invoice' && (
                    <ManualHelpButton
                      topicId={resolveInvoiceManualTopicId(isIndirectInvoice, isFixedAsset)}
                    />
                  )}
                  {activeTab === 'ipc' && (
                    <ManualHelpButton topicId="costs.ipc.subcontractor" />
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => { setShowModal(false); resetForm(); }}
                  aria-label={language === 'ar' ? 'إغلاق النافذة' : 'Close dialog'}
                  title={language === 'ar' ? 'إغلاق النافذة' : 'Close dialog'}
                  className="text-gray-500 hover:text-white transition-colors"
                >
                  <X size={24} />
                </button>
              </div>

              <form key={editingPurchaseId ?? 'new-purchase'} onSubmit={handleSubmit} className="p-8 space-y-6 overflow-y-auto">
                <fieldset disabled={entryFormReadOnly} className="space-y-6 border-0 p-0 m-0 min-w-0">
                {activeTab === 'invoice' && (
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase">{t('invoice_payment_type')}</label>
                    <div className={cn('inline-flex rounded-lg border p-0.5 gap-0.5', theme === 'dark' ? 'border-gray-700 bg-gray-900/50' : 'border-gray-200 bg-gray-50')}>
                      <button
                        type="button"
                        onClick={() => {
                          if (formData.paymentType === 'credit') return;
                          setFormData((p) => ({ ...p, paymentType: 'credit', supplierId: '' }));
                        }}
                        className={cn(
                          'px-3 py-1.5 rounded-md text-xs font-bold transition-colors',
                          formData.paymentType === 'credit'
                            ? 'bg-blue-600 text-white'
                            : theme === 'dark'
                              ? 'text-gray-400 hover:text-gray-200'
                              : 'text-gray-600 hover:text-gray-900',
                        )}
                      >
                        {t('invoice_payment_credit')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (formData.paymentType === 'cash') return;
                          setFormData((p) => ({ ...p, paymentType: 'cash', supplierId: '' }));
                        }}
                        className={cn(
                          'px-3 py-1.5 rounded-md text-xs font-bold transition-colors',
                          formData.paymentType === 'cash'
                            ? 'bg-blue-600 text-white'
                            : theme === 'dark'
                              ? 'text-gray-400 hover:text-gray-200'
                              : 'text-gray-600 hover:text-gray-900',
                        )}
                      >
                        {t('invoice_payment_cash')}
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-bold text-gray-400 uppercase">
                        {activeTab === 'invoice' && formData.paymentType === 'cash'
                          ? t('custody_cash_account')
                          : t('supplier_name')}
                      </label>
                      {(activeTab !== 'invoice' || formData.paymentType === 'credit') && (
                        <button type="button" onClick={() => { setNewSupplierData(p => ({ ...p, type: supplierTypeForActiveTab })); setShowSupplierModal(true); }} className="text-[10px] text-blue-500 hover:underline flex items-center gap-1">
                          <Plus size={12} />{language === 'ar' ? 'إضافة مورد/مقاول' : 'Add Supplier'}
                        </button>
                      )}
                    </div>
                    <SearchableSelect value={formData.supplierId} onChange={v => setFormData(p => ({ ...p, supplierId: v }))} theme={theme} dir={dir}
                      placeholder={
                        activeTab === 'invoice' && formData.paymentType === 'cash'
                          ? t('select_custody_cash_account')
                          : (language === 'ar' ? 'اختر المورد/المقاول' : 'Select Supplier')
                      }
                      options={creditorAccountSelectOptions} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase">{t('invoice_date')}</label>
                    <input required type="date" aria-label={t('invoice_date')} className={inputCls} value={formData.date} onChange={e => setFormData(p => ({ ...p, date: e.target.value }))} />
                  </div>
                </div>

                {activeTab === 'ipc' && isLocalBackend && costCenterSelectOptions.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase">{t('cost_center')}</label>
                    <SearchableSelect
                      value={formData.costCenterId}
                      onChange={handleCostCenterChange}
                      theme={theme}
                      dir={dir}
                      placeholder={t('select_cost_center')}
                      options={costCenterSelectOptions}
                    />
                  </div>
                )}

                {activeTab === 'ipc' && (!isLocalBackend || costCenterSelectOptions.length === 0) && (
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase">{t('project')}</label>
                      <SearchableSelect value={formData.projectId} onChange={v => setFormData(p => ({ ...p, projectId: v, contractId: '', costCenterId: '' }))} theme={theme} dir={dir}
                        placeholder={language === 'ar' ? 'اختر المشروع' : 'Select Project'}
                        options={scopedProjects.map(p => ({ value: p.id, label: p.projectName }))} />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase">{t('contract')}</label>
                      <SearchableSelect value={formData.contractId} onChange={v => setFormData(p => ({ ...p, contractId: v, costCenterId: v }))} theme={theme} dir={dir}
                        placeholder={language === 'ar' ? 'اختر العقد' : 'Select Contract'}
                        options={scopedContracts.filter(c => c.projectId === formData.projectId).map(c => ({ value: c.id, label: c.contractName }))} />
                    </div>
                  </div>
                )}

                {activeTab === 'invoice' && isLocalBackend && costCenterSelectOptions.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase">{t('cost_center_optional')}</label>
                    <SearchableSelect
                      value={formData.costCenterId}
                      onChange={handleCostCenterChange}
                      theme={theme}
                      dir={dir}
                      placeholder={t('select_cost_center')}
                      options={[{ value: '', label: language === 'ar' ? '— بدون —' : '— None —' }, ...costCenterSelectOptions]}
                    />
                  </div>
                )}

                {budgetExceeded && (
                  <div className="flex items-start gap-3 bg-yellow-500/10 border border-yellow-500/40 rounded-xl px-4 py-3">
                    <AlertTriangle size={18} className="text-yellow-400 shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-bold text-yellow-400">{language === 'ar' ? 'تحذير: تجاوز ميزانية العقد' : 'Warning: Budget Exceeded'}</p>
                      <p className="text-yellow-300/80 text-xs mt-0.5">
                        {language === 'ar' ? `سيتجاوز الميزانية بمقدار ${formatMoney(overByAmount)}` : `Exceeds budget by ${formatMoney(overByAmount)}`}
                      </p>
                    </div>
                  </div>
                )}

                {activeTab === 'invoice' ? (
                  <div className="space-y-4">
                    {isIndirectInvoice ? (
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-400 uppercase">{t('indirect_expense_account')}</label>
                        <SearchableSelect
                          value={formData.expenseAccountId}
                          onChange={(v) => setFormData((p) => ({ ...p, expenseAccountId: v }))}
                          theme={theme}
                          dir={dir}
                          placeholder={t('toast_pick_expense_account')}
                          options={expenseAccountSelectOptions}
                        />
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {/* Fixed asset toggle */}
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={isFixedAsset}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setIsFixedAsset(checked);
                              if (checked) {
                                setFormData((p) => ({
                                  ...p,
                                  costCenterId: indirectCenters.some((c) => c.id === p.costCenterId) ? '' : p.costCenterId,
                                  warehouseAccountId: '',
                                  amount: 0,
                                }));
                              }
                            }}
                            className="rounded border-gray-500 accent-violet-500"
                          />
                          <span className="text-xs font-bold text-violet-400 uppercase">
                            {language === 'ar' ? 'تسجيل كأصل ثابت (11xxxx)' : 'Register as Fixed Asset (11xxxx)'}
                          </span>
                        </label>

                        {isFixedAsset ? (
                          <div
                            className={cn(
                              'space-y-3 p-3 rounded-lg border',
                              theme === 'dark' ? 'border-violet-500/30 bg-violet-500/5' : 'border-violet-300 bg-violet-50',
                            )}
                          >
                            <div className="space-y-1">
                              <label className="text-xs font-bold text-gray-400 uppercase">
                                {language === 'ar' ? 'اسم الأصل' : 'Asset Name'}
                              </label>
                              <input
                                className={inputCls}
                                placeholder={language === 'ar' ? 'اسم الأصل الثابت' : 'Fixed asset name'}
                                value={fixedAssetName}
                                onChange={(e) => setFixedAssetName(e.target.value)}
                              />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <div className="space-y-1">
                                <label className="text-xs font-bold text-gray-400 uppercase">
                                  {language === 'ar' ? 'كود حساب الأصل (11xxxx)' : 'Asset Account Code (11xxxx)'}
                                </label>
                                <SearchableSelect
                                  value={fixedAssetAccountCode}
                                  onChange={handleFixedAssetAccountChange}
                                  theme={theme}
                                  dir={dir}
                                  placeholder={
                                    language === 'ar' ? 'اختر حساب الأصل الثابت' : 'Select fixed asset account'
                                  }
                                  options={fixedAssetAccountSelectOptions}
                                />
                                {fixedAssetAccountSelectOptions.length === 0 && (
                                  <p className="text-[11px] text-amber-400">
                                    {language === 'ar'
                                      ? 'لا توجد حسابات أصول ثابتة (11…) في شجرة الحسابات — أضفها من الإعدادات.'
                                      : 'No fixed asset accounts (11…) in the chart — add them in Settings.'}
                                  </p>
                                )}
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs font-bold text-gray-400 uppercase">
                                  {language === 'ar' ? 'اسم الحساب' : 'Account Name'}
                                </label>
                                <input
                                  className={cn(inputCls, 'read-only:opacity-90')}
                                  placeholder={language === 'ar' ? 'يُعبّأ تلقائياً من الشجرة' : 'Filled from chart of accounts'}
                                  value={fixedAssetAccountName}
                                  readOnly
                                  aria-readonly
                                />
                              </div>
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs font-bold text-gray-400 uppercase">
                                {language === 'ar' ? 'المبلغ (بدون ضريبة)' : 'Amount (ex-VAT)'}
                              </label>
                              <input
                                required
                                type="number"
                                min="0"
                                step="0.01"
                                aria-label={language === 'ar' ? 'المبلغ' : 'Amount'}
                                className={inputCls}
                                value={formData.amount || ''}
                                onChange={(e) => setFormData((p) => ({ ...p, amount: Number(e.target.value) }))}
                              />
                            </div>
                            <p className="text-[10px] text-violet-500/90">
                              {language === 'ar'
                                ? 'سيُنشأ سجل أصل ثابت تلقائياً في وضع "انتظار الإعداد" لإكمال بيانات الإهلاك لاحقاً'
                                : 'A fixed asset record will be created automatically (pending setup) for depreciation details later'}
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-400 uppercase">{t('project_warehouse_account')}</label>
                            <SearchableSelect
                              value={formData.warehouseAccountId}
                              onChange={(v) => setFormData((p) => ({ ...p, warehouseAccountId: v }))}
                              theme={theme}
                              dir={dir}
                              placeholder={t('select_warehouse_account')}
                              options={warehouseAccountSelectOptions}
                            />
                            {warehouseAccountSelectOptions.length === 0 && (
                              <p className="text-[11px] text-amber-400">{t('warehouse_accounts_hint')}</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase">{t('invoice_number')}</label>
                      <input required type="text" aria-label={t('invoice_number')} className={inputCls} value={formData.referenceNumber} onChange={e => setFormData(p => ({ ...p, referenceNumber: e.target.value }))} />
                    </div>
                    <div className="space-y-2 col-span-2">
                      <label className="text-xs font-bold text-gray-400 uppercase">{language === 'ar' ? 'ضريبة القيمة المضافة' : 'VAT Treatment'}</label>
                      <select aria-label={language === 'ar' ? 'معالجة ضريبة القيمة المضافة' : 'VAT treatment'} className={inputCls} value={formData.invoiceVatPct} onChange={e => setFormData(p => ({ ...p, invoiceVatPct: Number(e.target.value) }))}>
                        <option value={BILLING_DEFAULTS.VAT_PCT}>{language === 'ar' ? `بضريبة قيمة مضافة (${BILLING_DEFAULTS.VAT_PCT}%)` : `With VAT (${BILLING_DEFAULTS.VAT_PCT}%)`}</option>
                        <option value="0">{language === 'ar' ? 'بدون ضريبة قيمة مضافة' : 'Without VAT'}</option>
                      </select>
                    </div>
                    </div>

                    {isIndirectInvoice ? (
                      <div className={cn('rounded-xl border p-4 space-y-4', theme === 'dark' ? 'border-gray-800 bg-gray-900/30' : 'border-gray-200 bg-gray-50')}>
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-gray-400 uppercase">{language === 'ar' ? 'المبلغ (بدون ضريبة)' : 'Amount (ex-VAT)'}</label>
                          <input
                            required
                            type="number"
                            min="0"
                            step="0.01"
                            aria-label={language === 'ar' ? 'المبلغ' : 'Amount'}
                            className={inputCls}
                            value={formData.amount || ''}
                            onChange={(e) => setFormData((p) => ({ ...p, amount: Number(e.target.value) }))}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-gray-400 uppercase">{t('description')}</label>
                          <input
                            type="text"
                            aria-label={t('description')}
                            className={inputCls}
                            value={formData.description}
                            onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
                          />
                        </div>
                      </div>
                    ) : isFixedAsset ? null : (
                    <div className={cn('rounded-xl border p-4', theme === 'dark' ? 'border-gray-800 bg-gray-900/30' : 'border-gray-200 bg-gray-50')}>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm font-bold text-gray-400 uppercase">
                          {t('invoice_lines')}
                        </h4>
                        <button
                          type="button"
                          onClick={addInvoiceLine}
                          className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded flex items-center gap-1"
                        >
                          <Plus size={12} />
                          {language === 'ar' ? 'إضافة بند' : 'Add Line'}
                        </button>
                      </div>
                      <div className="space-y-4 max-h-80 overflow-y-auto pe-1">
                        {normalizedInvoiceLines.map((line, lineIdx) => (
                          <div key={line.id} className={cn('rounded-lg border p-3 space-y-3', theme === 'dark' ? 'border-gray-800 bg-gray-900/40' : 'border-gray-200 bg-white')}>
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-gray-400">
                                {language === 'ar' ? `البند ${lineIdx + 1}` : `Line ${lineIdx + 1}`}
                              </span>
                              <button
                                type="button"
                                aria-label={language === 'ar' ? 'حذف بند الفاتورة' : 'Remove invoice line'}
                                title={language === 'ar' ? 'حذف بند الفاتورة' : 'Remove invoice line'}
                                onClick={() => removeInvoiceLine(line.id)}
                                className="text-red-400 hover:text-red-300"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                            {/* H1: ربط ببند BOQ اختياري - اختيار متعدد */}
                            {invoiceBoqItems.length > 0 && (
                              <div className="mb-2">
                                <label className="text-xs font-bold text-gray-400 mb-2 block">
                                  {language === 'ar' ? 'ربط ببنود BOQ (اختياري)' : 'Link to BOQ items (optional)'}
                                </label>
                                <div className={cn(
                                  'max-h-40 overflow-y-auto rounded-lg border p-2 space-y-1',
                                  theme === 'dark' ? 'border-gray-700 bg-gray-900/50' : 'border-gray-300 bg-gray-50'
                                )}>
                                  {invoiceBoqItems.map((b, idx) => {
                                    const selectedIds = (line as InvoiceLineDraft).boqItemIds || [];
                                    const isChecked = selectedIds.includes(b.id);
                                    return (
                                      <label
                                        key={b.id || `${b.itemCode || 'boq'}-${idx}`}
                                        className={cn(
                                          'flex items-start gap-2 p-2 rounded cursor-pointer text-xs hover:bg-opacity-50',
                                          theme === 'dark' ? 'hover:bg-gray-800' : 'hover:bg-gray-200',
                                          isChecked && (theme === 'dark' ? 'bg-blue-900/30' : 'bg-blue-50')
                                        )}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={() => handleInvoiceLineBOQSelect(line.id, b.id)}
                                          className="mt-0.5 flex-shrink-0"
                                        />
                                        <span className={cn('flex-1', isChecked && 'font-medium')}>
                                          <span className="font-mono text-blue-400">{b.itemCode}</span>
                                          {' — '}
                                          <span>{b.description}</span>
                                          {' '}
                                          <span className="text-gray-500">({b.unit})</span>
                                        </span>
                                      </label>
                                    );
                                  })}
                                </div>
                                {((line as InvoiceLineDraft).boqItemIds || []).length > 0 && (
                                  <div className="mt-1 text-xs text-blue-400">
                                    {language === 'ar' 
                                      ? `${((line as InvoiceLineDraft).boqItemIds || []).length} بند مربوط`
                                      : `${((line as InvoiceLineDraft).boqItemIds || []).length} item(s) linked`}
                                  </div>
                                )}
                              </div>
                            )}
                            {isLocalBackend && materialCategories.length > 0 && (
                              <select
                                className={cn(inputCls, 'py-2 px-3 w-full text-xs mb-2')}
                                value={line.materialCategoryId || ''}
                                onChange={(e) => handleInvoiceLineMaterialSelect(line.id, e.target.value)}
                                title={language === 'ar' ? 'اختيار صنف المادة' : 'Select material category'}
                                aria-label={language === 'ar' ? 'اختيار صنف المادة' : 'Select material category'}
                              >
                                <option value="">{language === 'ar' ? '— اختر الصنف —' : '— Select material —'}</option>
                                {materialCategories.map((c, idx) => (
                                  <option key={c.id || `${c.code || 'material'}-${idx}`} value={c.id}>
                                    {c.code} — {c.name} ({c.unit})
                                  </option>
                                ))}
                              </select>
                            )}
                            <div className="grid grid-cols-4 gap-2">
                              <input
                                type="text"
                                aria-label={language === 'ar' ? 'وصف البند' : 'Line description'}
                                placeholder={language === 'ar' ? 'الوصف' : 'Description'}
                                className={cn(inputCls, 'py-2 px-3')}
                                value={line.itemDescription}
                                onChange={(e) => setInvoiceLineField(line.id, 'itemDescription', e.target.value)}
                                readOnly={isLocalBackend && !!line.materialCategoryId}
                              />
                              <input
                                type="text"
                                aria-label={language === 'ar' ? 'الوحدة' : 'Unit'}
                                placeholder={language === 'ar' ? 'الوحدة' : 'Unit'}
                                className={cn(inputCls, 'py-2 px-3')}
                                value={line.unit}
                                onChange={(e) => setInvoiceLineField(line.id, 'unit', e.target.value)}
                              />
                              <input
                                type="number"
                                step="0.01"
                                aria-label={language === 'ar' ? 'الكمية' : 'Quantity'}
                                placeholder={language === 'ar' ? 'الكمية' : 'Qty'}
                                className={cn(inputCls, 'py-2 px-3')}
                                value={line.quantity || ''}
                                onChange={(e) => setInvoiceLineField(line.id, 'quantity', Number(e.target.value))}
                              />
                              <input
                                type="number"
                                step="0.01"
                                aria-label={language === 'ar' ? 'سعر الوحدة' : 'Unit cost'}
                                placeholder={language === 'ar' ? 'سعر الوحدة' : 'Unit Cost'}
                                className={cn(inputCls, 'py-2 px-3')}
                                value={line.unitCost || ''}
                                onChange={(e) => setInvoiceLineField(line.id, 'unitCost', Number(e.target.value))}
                              />
                            </div>
                            <div className="text-xs text-gray-400 space-y-0.5">
                              <div>
                                {language === 'ar' ? 'إجمالي البند (بدون ضريبة)' : 'Line total (ex-VAT)'}:{' '}
                                <span className="font-mono">{formatMoney(line.totalCost)}</span>
                              </div>
                              <div>
                                {language === 'ar' ? 'تكلفة الوحدة للمخزون (شامل ض.ق.م)' : 'Inventory unit cost (incl. VAT)'}:{' '}
                                <span className="font-mono text-blue-400">{formatMoney(line.inventoryUnitCost)}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <h4 className="text-sm font-bold text-gray-400 uppercase">{language === 'ar' ? 'بنود المستخلص' : 'IPC Items'}</h4>
                      <div className="flex gap-2">
                        <button type="button" onClick={handleExportTemplate} className="text-xs bg-gray-800 hover:bg-gray-700 px-3 py-1 rounded flex items-center gap-1"><Download size={14} />{language === 'ar' ? 'نموذج' : 'Template'}</button>
                        <label className="text-xs bg-blue-900/20 text-blue-400 hover:bg-blue-900/40 px-3 py-1 rounded flex items-center gap-1 cursor-pointer"><Upload size={14} />{language === 'ar' ? 'استيراد' : 'Import'}<input type="file" aria-label={language === 'ar' ? 'استيراد ملف إكسل' : 'Import Excel file'} title={language === 'ar' ? 'استيراد ملف إكسل' : 'Import Excel file'} className="hidden" accept=".xlsx,.xls" onChange={handleImportExcel} /></label>
                      </div>
                    </div>
                    <div
                      className={cn(
                        'border rounded-xl overflow-auto max-h-[min(55vh,32rem)]',
                        theme === 'dark' ? 'border-gray-800' : 'border-gray-200',
                      )}
                    >
                      <table className="w-full min-w-[52rem] text-xs text-right">
                        <thead
                          className={cn(
                            'sticky top-0 z-10',
                            theme === 'dark' ? 'bg-gray-900/95 text-gray-400' : 'bg-gray-50 text-gray-600',
                          )}
                        >
                          <tr>
                            <th className="p-2 whitespace-nowrap">{language === 'ar' ? 'كود' : 'Code'}</th>
                            <th className="p-2 min-w-[14rem]">{language === 'ar' ? 'البيان' : 'Desc'}</th>
                            <th className="p-2">{language === 'ar' ? 'الوحدة' : 'Unit'}</th>
                            <th className="p-2">{language === 'ar' ? 'الكمية' : 'Qty'}</th>
                            <th className="p-2 min-w-[5.5rem]">{language === 'ar' ? 'الفئة' : 'Rate'}</th>
                            <th className="p-2">{language === 'ar' ? 'سابق' : 'Prev'}</th>
                            <th className="p-2 min-w-[5.5rem]">{language === 'ar' ? 'حالي' : 'Curr'}</th>
                            <th className="p-2">{language === 'ar' ? 'إجمالي' : 'Total'}</th>
                          </tr>
                        </thead>
                        <tbody className={cn('divide-y', theme === 'dark' ? 'divide-gray-800' : 'divide-gray-200')}>
                          {formData.items.map((item, idx) => (
                            <tr
                              key={item.boqItemId || `${item.itemCode || 'ipc-item'}-${idx}`}
                              className={theme === 'dark' ? 'hover:bg-gray-900/40' : 'hover:bg-gray-50'}
                            >
                              <td className="p-2 font-mono whitespace-nowrap">{item.itemCode}</td>
                              <td className="p-2 min-w-[14rem] max-w-[22rem] whitespace-normal leading-snug" title={item.description}>
                                {item.description}
                              </td>
                              <td className="p-2 whitespace-nowrap">{item.unit}</td>
                              <td className="p-2 font-mono text-gray-400 whitespace-nowrap">{formatNumber(((item as any).tenderQty ?? 0))}</td>
                              <td className="p-2">
                                <SpreadsheetCellInput
                                  type="number"
                                  step="0.01"
                                  inputMode="decimal"
                                  row={idx}
                                  col={0}
                                  rowCount={formData.items.length}
                                  colCount={2}
                                  gridRefs={ipcGridRefs}
                                  variant="rate"
                                  theme={theme}
                                  aria-label={language === 'ar' ? `سعر البند ${item.itemCode}` : `Rate for ${item.itemCode}`}
                                  value={Number.isFinite(item.rate) ? roundMoney2(item.rate) : ''}
                                  onChange={(e) => handleItemRateChange(idx, Number(e.target.value))}
                                />
                              </td>
                              <td className="p-2 font-mono text-gray-500 whitespace-nowrap">{item.previousQty}</td>
                              <td className="p-2">
                                <SpreadsheetCellInput
                                  type="number"
                                  step="0.01"
                                  inputMode="decimal"
                                  row={idx}
                                  col={1}
                                  rowCount={formData.items.length}
                                  colCount={2}
                                  gridRefs={ipcGridRefs}
                                  variant="qty"
                                  theme={theme}
                                  aria-label={language === 'ar' ? `الكمية الحالية للبند ${item.itemCode}` : `Current quantity for ${item.itemCode}`}
                                  value={item.currentQty}
                                  onChange={(e) => handleItemQtyChange(idx, Number(e.target.value))}
                                />
                              </td>
                              <td className="p-2 font-mono font-bold whitespace-nowrap">{formatNumber(item.totalQty * item.rate)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase">{t('wht_pct')}</label>
                    <select aria-label={t('wht_pct')} className={inputCls} value={formData.whtPct} onChange={e => setFormData(p => ({ ...p, whtPct: Number(e.target.value) }))}>
                      <option value="0">0%</option><option value="1">1%</option><option value="3">3%</option><option value="5">5%</option>
                    </select>
                  </div>
                  {activeTab === 'ipc' && (
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase">{language === 'ar' ? 'نسبة ضمان الأعمال' : 'Retention %'}</label>
                      <select aria-label={language === 'ar' ? 'نسبة ضمان الأعمال' : 'Retention percentage'} className={inputCls} value={formData.execGuaranteePct} onChange={e => setFormData(p => ({ ...p, execGuaranteePct: Number(e.target.value) }))}>
                        <option value="0">0%</option><option value="5">5%</option><option value="10">10%</option>
                      </select>
                    </div>
                  )}
                </div>

                {activeTab === 'ipc' && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-gray-400 uppercase">{t('expense_account')}</label>
                    <button type="button" onClick={() => setShowAccountModal(true)} className="text-[10px] text-blue-500 hover:underline flex items-center gap-1"><Plus size={12} />{language === 'ar' ? 'إضافة حساب' : 'Add Account'}</button>
                  </div>
                  <SearchableSelect value={formData.expenseAccountId} onChange={v => setFormData(p => ({ ...p, expenseAccountId: v }))} theme={theme} dir={dir}
                    placeholder={t('select_account')}
                    options={accounts.filter(a => a.accountCode?.startsWith('5') && a.accountCode?.length === 8 && !a.isGroup && a.status !== 'disabled').map(a => ({
                      value: a.id, secondary: a.accountCode, label: language === 'ar' ? a.accountName : (a.accountNameEn || a.accountName),
                    }))} />
                </div>
                )}

                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase">{t('description')}</label>
                  <textarea aria-label={t('description')} className={cn(inputCls, 'h-20 resize-none')} value={formData.description} onChange={e => setFormData(p => ({ ...p, description: e.target.value }))} />
                </div>

                {/* Summary */}
                <div className={cn('p-4 rounded-xl space-y-2', theme === 'dark' ? 'bg-gray-900/50' : 'bg-gray-50')}>
                  {activeTab === 'invoice' ? (
                    <>
                      <div className="flex justify-between text-sm"><span className="text-gray-500">{t('amount')}</span><span className="font-mono">{formatMoney(invoiceBaseAmount)}</span></div>
                      <div className="flex justify-between text-sm"><span className="text-gray-500">{t('vat')} ({formData.invoiceVatPct}%)</span><span className="font-mono text-blue-400">{formatMoney(roundMoney(invoiceBaseAmount * (formData.invoiceVatPct / 100)))}</span></div>
                      <div className="flex justify-between text-sm"><span className="text-gray-500">{t('wht_amount')} ({formData.whtPct}%)</span><span className="font-mono text-red-400">{formatMoney(roundMoney(invoiceBaseAmount * (formData.whtPct / 100)))}</span></div>
                      <div className="flex justify-between pt-2 border-t border-gray-800 font-bold"><span>{t('total')}</span><span className="text-lg text-green-500">{formatMoney(roundMoney(invoiceBaseAmount + invoiceBaseAmount * (formData.invoiceVatPct / 100) - invoiceBaseAmount * (formData.whtPct / 100)))}</span></div>
                    </>
                  ) : (() => {
                    const { worksValue, vat, exec, wht, net } = calculateIPCDeductions();
                    return (
                      <>
                        <div className="flex justify-between text-sm"><span className="text-gray-500">{language === 'ar' ? 'قيمة الأعمال' : 'Works Value'}</span><span className="font-mono">{formatNumber(worksValue)}</span></div>
                        <div className="flex justify-between text-sm"><span className="text-gray-500">{t('vat')} (14%)</span><span className="font-mono text-blue-400">{formatNumber(vat)}</span></div>
                        <div className="flex justify-between text-sm"><span className="text-gray-500">{language === 'ar' ? 'حجز ضمان' : 'Retention'} ({formData.execGuaranteePct}%)</span><span className="font-mono text-orange-400">-{formatNumber(exec)}</span></div>
                        <div className="flex justify-between text-sm"><span className="text-gray-500">{t('wht_amount')} ({formData.whtPct}%)</span><span className="font-mono text-red-400">-{formatNumber(wht)}</span></div>
                        <div className="flex justify-between pt-2 border-t border-gray-800 font-bold"><span>{language === 'ar' ? 'صافي المستحق' : 'Net Payable'}</span><span className="text-lg text-green-500">{formatNumber(net)}</span></div>
                      </>
                    );
                  })()}
                </div>

                <div className="flex flex-wrap gap-4 pt-2">
                  {activeTab === 'ipc' && formData.items.length > 0 && (
                    <button
                      type="button"
                      onClick={handlePrintSubcontractorIpc}
                      className="px-6 bg-green-600 hover:bg-green-500 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 text-white"
                    >
                      <Printer size={18} />
                      {language === 'ar' ? 'معاينة وطباعة' : 'Preview & Print'}
                    </button>
                  )}
                  {activeTab === 'invoice' && !invoiceFormReadOnly && (
                    <button type="submit" disabled={isSubmitting} className="flex-1 min-w-[8rem] bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 py-3 rounded-xl font-bold transition-all shadow-lg shadow-blue-900/20 text-white flex items-center justify-center gap-2">
                      {isSubmitting && <Loader2 className="animate-spin" size={18} />}
                      {isSubmitting ? (language === 'ar' ? 'جاري الحفظ...' : 'Saving...') : (language === 'ar' ? 'حفظ المعاملة' : 'Save Transaction')}
                    </button>
                  )}
                  {activeTab === 'ipc' && !ipcFormReadOnly && !canApproveEditingIpc && (
                    <>
                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => { ipcSaveModeRef.current = 'draft'; void handleSubmit(); }}
                        className={cn('min-w-[8rem] py-3 px-4 rounded-xl font-bold transition-all border', theme === 'dark' ? 'bg-gray-800 hover:bg-gray-700 text-white border-gray-700' : 'bg-white hover:bg-gray-50 text-gray-700 border-gray-200')}
                      >
                        {language === 'ar' ? 'حفظ مسودة' : 'Save Draft'}
                      </button>
                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => { ipcSaveModeRef.current = 'submit'; void handleSubmit(); }}
                        className="flex-1 min-w-[8rem] bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 py-3 rounded-xl font-bold transition-all shadow-lg shadow-blue-900/20 text-white flex items-center justify-center gap-2"
                      >
                        {isSubmitting && <Loader2 className="animate-spin" size={18} />}
                        {isSubmitting ? (language === 'ar' ? 'جاري الحفظ...' : 'Saving...') : (language === 'ar' ? 'تقديم للاعتماد' : 'Submit for Approval')}
                      </button>
                    </>
                  )}
                  {activeTab === 'ipc' && canApproveEditingIpc && (
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => { ipcSaveModeRef.current = 'approve'; void handleSubmit(); }}
                      className="flex-1 min-w-[8rem] bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-900 py-3 rounded-xl font-bold transition-all text-white flex items-center justify-center gap-2"
                    >
                      {isSubmitting && <Loader2 className="animate-spin" size={18} />}
                      {language === 'ar' ? 'اعتماد وترحيل القيد' : 'Approve & Post Journal'}
                    </button>
                  )}
                </div>
                </fieldset>
                <div className="flex flex-wrap gap-4 pt-2">
                  <button type="button" onClick={() => { setShowModal(false); resetForm(); }} className={cn('flex-1 min-w-[8rem] py-3 rounded-xl font-bold transition-all', theme === 'dark' ? 'bg-gray-800 hover:bg-gray-700 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700')}>{t('cancel')}</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── ADD EXPENSE ACCOUNT MODAL ─────────────────────────────────────── */}
      <AnimatePresence>
        {showAccountModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[60] p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className={cn('w-full max-w-md border rounded-2xl shadow-2xl overflow-hidden', theme === 'dark' ? 'bg-[#1a1b1e] border-gray-800' : 'bg-white border-gray-200')}
            >
              <div className="p-6 border-b flex justify-between items-center">
                <h3 className="text-lg font-bold">{language === 'ar' ? 'إضافة حساب مصروفات جديد' : 'Add Expense Account'}</h3>
                <button
                  type="button"
                  onClick={() => setShowAccountModal(false)}
                  aria-label={language === 'ar' ? 'إغلاق النافذة' : 'Close dialog'}
                  title={language === 'ar' ? 'إغلاق النافذة' : 'Close dialog'}
                  className="text-gray-500 hover:text-white"
                >
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleSaveAccount} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'الاسم العربي' : 'Arabic Name'}<span className="text-red-500 ms-1">*</span></label>
                    <input required type="text" dir="rtl" placeholder="مثال: مواد خرسانة" className={cn('w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500', theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200')} value={newAccountData.accountName} onChange={e => setNewAccountData(p => ({ ...p, accountName: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'الاسم الإنجليزي' : 'English Name'}<span className="text-red-500 ms-1">*</span></label>
                    <input required type="text" dir="ltr" placeholder="e.g. Concrete Materials" className={cn('w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500', theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200')} value={newAccountData.accountNameEn} onChange={e => setNewAccountData(p => ({ ...p, accountNameEn: e.target.value }))} />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'كود الحساب' : 'Account Code'}</label>
                  <input required type="text" placeholder="e.g. 51101002" className={cn('w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500', theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200')} value={newAccountData.accountCode} onChange={e => setNewAccountData(p => ({ ...p, accountCode: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'الحساب الأب' : 'Parent Account'}</label>
                  <select required aria-label={language === 'ar' ? 'الحساب الأب' : 'Parent account'} className={cn('w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500', theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200')} value={newAccountData.parentCode} onChange={e => setNewAccountData(p => ({ ...p, parentCode: e.target.value }))}>
                    <option value="511">{language === 'ar' ? '511 - تكاليف مباشرة' : '511 - Direct Costs'}</option>
                    <option value="512">{language === 'ar' ? '512 - تكاليف غير مباشرة' : '512 - Indirect Costs'}</option>
                    <option value="521">{language === 'ar' ? '521 - إدارية وعمومية' : '521 - G&A'}</option>
                    <option value="531">{language === 'ar' ? '531 - تكاليف التمويل' : '531 - Financing'}</option>
                  </select>
                </div>
                <div className="pt-4 flex gap-3">
                  <button type="submit" disabled={isSubmitting} className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 py-2 rounded-lg font-bold transition-colors text-white">{isSubmitting ? '...' : (language === 'ar' ? 'حفظ' : 'Save')}</button>
                  <button type="button" onClick={() => setShowAccountModal(false)} className={cn('flex-1 py-2 rounded-lg font-bold', theme === 'dark' ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300')}>{t('cancel')}</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── ADD SUPPLIER / SUBCONTRACTOR MODAL ───────────────────────────── */}
      <AnimatePresence>
        {showSupplierModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[60] p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className={cn('w-full max-w-md border rounded-2xl shadow-2xl overflow-hidden', theme === 'dark' ? 'bg-[#1a1b1e] border-gray-800' : 'bg-white border-gray-200')}
            >
              <div className="p-6 border-b flex justify-between items-center">
                <h3 className="text-lg font-bold">{language === 'ar' ? 'إضافة مورد / مقاول' : 'Add Supplier / Subcontractor'}</h3>
                <button
                  type="button"
                  onClick={() => setShowSupplierModal(false)}
                  aria-label={language === 'ar' ? 'إغلاق النافذة' : 'Close dialog'}
                  title={language === 'ar' ? 'إغلاق النافذة' : 'Close dialog'}
                  className="text-gray-500 hover:text-white"
                >
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleSaveSupplier} className="p-6 space-y-4">
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'النوع' : 'Type'}</label>
                  <div className="flex gap-3">
                    <button type="button" disabled
                      className="flex-1 py-2 rounded-lg text-sm font-bold border transition-all bg-blue-600 border-blue-600 text-white cursor-not-allowed"
                    >
                      {newSupplierType === 'supplier'
                        ? (language === 'ar' ? 'مورد (21101)' : 'Supplier (21101)')
                        : (language === 'ar' ? 'مقاول (21102)' : 'Subcontractor (21102)')}
                    </button>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'كود الحساب (تلقائي)' : 'Account Code (Auto)'}</label>
                  <input readOnly aria-label={language === 'ar' ? 'كود الحساب التلقائي' : 'Auto generated account code'} value={computedSupplierCode} className={cn('w-full border rounded-lg py-2 px-3 text-sm font-mono cursor-not-allowed opacity-60', theme === 'dark' ? 'bg-gray-900 border-gray-800 text-blue-400' : 'bg-gray-50 border-gray-200 text-blue-700')} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'الاسم (عربي)' : 'Name (Arabic)'}</label>
                  <input type="text" placeholder="الاسم بالعربية" className={cn('w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500', theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200')} value={newSupplierData.name} onChange={e => setNewSupplierData(p => ({ ...p, name: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'الاسم (إنجليزي) *' : 'Name (English) *'}</label>
                  <input required type="text" dir="ltr" placeholder="Name in English" className={cn('w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500', theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200')} value={newSupplierData.nameEn} onChange={e => setNewSupplierData(p => ({ ...p, nameEn: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'رقم التسجيل الضريبي' : 'Tax Registration'}</label>
                  <input type="text" aria-label={language === 'ar' ? 'رقم التسجيل الضريبي' : 'Tax registration'} className={cn('w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500', theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200')} value={newSupplierData.taxNumber} onChange={e => setNewSupplierData(p => ({ ...p, taxNumber: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'رقم الهاتف' : 'Phone'}</label>
                  <input type="text" aria-label={language === 'ar' ? 'رقم الهاتف' : 'Phone number'} className={cn('w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500', theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200')} value={newSupplierData.phone} onChange={e => setNewSupplierData(p => ({ ...p, phone: e.target.value }))} />
                </div>
                <div className="pt-4 flex gap-3">
                  <button type="submit" disabled={isSubmitting} className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 py-2 rounded-lg font-bold transition-colors text-white">{isSubmitting ? '...' : (language === 'ar' ? 'حفظ' : 'Save')}</button>
                  <button type="button" onClick={() => setShowSupplierModal(false)} className={cn('flex-1 py-2 rounded-lg font-bold', theme === 'dark' ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300')}>{t('cancel')}</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── CONFIRM DELETE MODAL ──────────────────────────────────────────── */}
      <AnimatePresence>
        {confirmConfig.isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className={cn('border rounded-2xl w-full max-w-md overflow-hidden shadow-2xl', theme === 'dark' ? 'bg-[#151619] border-gray-800' : 'bg-white border-gray-200')}
            >
              <div className={cn('p-6 border-b flex justify-between items-center', theme === 'dark' ? 'bg-gray-900/50 border-gray-800' : 'bg-gray-50 border-gray-200')}>
                <h3 className="text-lg font-bold text-red-500">{confirmConfig.title}</h3>
                <button
                  type="button"
                  onClick={() => setConfirmConfig(p => ({ ...p, isOpen: false }))}
                  aria-label={language === 'ar' ? 'إغلاق النافذة' : 'Close dialog'}
                  title={language === 'ar' ? 'إغلاق النافذة' : 'Close dialog'}
                  className="text-gray-500 hover:text-white transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="p-6"><p className={cn('text-sm', theme === 'dark' ? 'text-gray-300' : 'text-gray-600')}>{confirmConfig.message}</p></div>
              <div className={cn('p-6 border-t flex justify-end gap-3', theme === 'dark' ? 'bg-gray-900/30 border-gray-800' : 'bg-gray-50 border-gray-200')}>
                <button onClick={() => setConfirmConfig(p => ({ ...p, isOpen: false }))} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">{language === 'ar' ? 'إلغاء' : 'Cancel'}</button>
                <button onClick={confirmConfig.onConfirm} disabled={isDeleting} className="px-6 py-2 rounded-lg text-sm font-bold bg-red-600 hover:bg-red-500 text-white transition-colors flex items-center gap-2">
                  {isDeleting && <Loader2 className="animate-spin" size={16} />}
                  {language === 'ar' ? 'تأكيد' : 'Confirm'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {PrintHost}

      <JournalPreviewModal
        open={ipcPreviewEntries !== null}
        title={language === 'ar' ? 'معاينة قيد مستخلص مقاول الباطن' : 'Subcontractor IPC Preview'}
        description={ipcPreviewEntries?.description}
        entries={ipcPreviewEntries?.entries ?? []}
        busy={isSubmitting}
        confirmLabel={language === 'ar' ? 'اعتماد وترحيل' : 'Approve & post'}
        onConfirm={() => {
          ipcPreviewConfirmedRef.current = true;
          ipcSaveModeRef.current = 'approve';
          setIpcPreviewEntries(null);
          void handleSubmit();
        }}
        onClose={() => { ipcPreviewConfirmedRef.current = false; setIpcPreviewEntries(null); }}
      />
    </div>
  );
}
