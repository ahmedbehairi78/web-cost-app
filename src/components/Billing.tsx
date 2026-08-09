import React, { Fragment, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useFirestoreQuery } from '../hooks/useFirestoreQuery';
import { useApiQuery } from '../hooks/useApiQuery';
import { BILLING_DEFAULTS, IPC_KIND, type IpcKind } from '../constants/billingDefaults';
import {
  Plus,
  FileText,
  CheckCircle2,
  Clock,
  X,
  Trash2,
  Edit2,
  Printer,
  Loader2
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { collection, query, where, orderBy, addDoc, updateDoc, writeBatch, doc, getDocs, getDoc, limit } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { accountingService, buildIpcEntries } from '../services/accountingService';
import { JournalPreviewModal, type JournalPreviewEntry } from './gl/JournalPreviewModal';
import { cn, normalizeDate, roundMoney2 } from '../lib/utils';
import { coverWhtAmount } from '../lib/ipcCoverMath';
import { LISTENER_PURCHASE_TX_CAP } from '../constants/dataLimits';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../context/LanguageContext';
import { displayLocale } from '../lib/numberLocale';
import { usePermissions } from '../context/PermissionsContext';
import toast from 'react-hot-toast';
import { IPCFormModal } from './billing/IPCFormModal';
import { IpcCoverPanel } from './billing/IpcCoverPanel';
import { buildIpcCoverContractSums } from '../lib/ipcCoverContractSums';
import { buildIpcCoverSchedule } from '../lib/ipcCoverSchedule';
import { ManualHelpButton } from './help/ManualHelpButton';
import { AdminSensitiveVerifyModal } from './AdminSensitiveVerifyModal';
import { isLocalBackend } from '../lib/dataBackend';
import { ApiError } from '../lib/apiClient';
import {
  billingApi,
  boqApi,
  contractsApi,
  mosCertificatesApi,
  projectsApi,
  purchaseTransactionsApi,
  settingsApi,
  variationOrdersApi,
} from '../services/local/modulesApi';
import {
  buildIpcCoverWorksSplit,
  collectVoCreatedBoqItemIds,
} from '../lib/ipcCoverFromQtyList';
import type { VariationOrder } from '../types';
import { useIpcPrintPreview } from '../hooks/useIpcPrintPreview';
import { useMosPrintPreview } from '../hooks/useMosPrintPreview';
import { buildMosPrintData } from '../lib/mosPrintData';
import { consumePendingBillingFocus } from '../lib/shellNavigation';
import { findIpcItemsExceedingTender } from '../lib/ipcBoqValidation';
import { ipcApproveErrorToastMessage } from '../lib/ipcApproveErrorMessage';
import {
  buildBillingIpcPrintData,
  groupIpcItemsByChapter,
  mapToIpcPrintItems,
  type CompanyPrintInfo,
} from '../lib/ipcPrintData';
import { mergeCompanyPrintInfoWithProject } from '../lib/projectCoverLogos';
import { formatQuantity } from '../lib/formatQuantity';
import type { StoredReportPrintProfiles } from '../lib/reportPrintProfiles';
import { useUserAccessScope } from '../hooks/useUserAccessScope';
import { MosExtractModal } from './billing/MosExtractModal';
import { MosExtractDetail } from './billing/MosExtractDetail';
import type { MosCertificate } from '../types';
import { PackageCheck, ChevronDown, ChevronUp } from 'lucide-react';

interface Project {
  id: string;
  projectName: string;
  projectCode: string;
  coverLogoLeft?: string | null;
  coverLogoCenter?: string | null;
  coverLogoRight?: string | null;
}

interface Contract {
  id: string;
  contractName: string;
  contractNumber: string;
  projectId: string;
  startDate?: string | null;
  endDate?: string | null;
  contractValue?: number | null;
}

interface BOQItem {
  id: string;
  projectId: string;
  contractId?: string;
  chapterCode: string;
  chapterName: string;
  workTypeCode: string;
  sectionCode: string;
  sectionName: string;
  itemCode: string;
  description: string;
  unit: string;
  tenderQty: number;
  rateMaterials: number;
  rateLabour: number;
  rateEquipment: number;
  rateOverheadPct: number;
  rateProfitPct: number;
  unitRateTotal: number;
}

interface BillingItem {
  boqItemId: string;
  chapterCode?: string;
  chapterName?: string;
  workTypeCode?: string;
  sectionCode?: string;
  sectionName?: string;
  itemCode: string;
  description: string;
  unit: string;
  rate: number;
  tenderQty?: number;
  previousQty: number;
  currentQty: number;
  totalQty: number;
  amount: number;
}

type FirestoreDate = string | Date | { seconds: number; toDate(): Date };

interface BillingIPC {
  id: string;
  projectId: string;
  contractId: string;
  billingNumber: string;
  date: FirestoreDate;
  items: BillingItem[];
  worksValueExVat: number;
  vatAmount: number;
  execGuaranteeAmount: number;
  whtAmount: number;
  labourInsuranceAmount: number;
  manpowerLevyAmount: number;
  performanceSecurityAmount?: number;
  syndicateStampAmount?: number;
  backChargeAmount?: number;
  advancePaymentTotal?: number;
  advancePaymentRecovery: number;
  netPayable: number;
  status: 'draft' | 'review' | 'submitted' | 'approved' | 'paid';
  transactionId?: string;
  isDeleted?: boolean;
  /** جاري / نهائي — النهائي المعتمد يغلق العقد في التقارير ويمنع مستخلصات جديدة حتى إلغاؤه */
  ipcKind?: IpcKind;
}

type BillingStatusFilter = 'all' | BillingIPC['status'];

type SelectedExtract = { kind: 'ipc' | 'mos'; id: string };

type SidebarExtractItem =
  | { kind: 'ipc'; id: string; ipc: BillingIPC }
  | { kind: 'mos'; id: string; cert: MosCertificate };

function mosMatchesStatusFilter(cert: MosCertificate, filter: BillingStatusFilter): boolean {
  if (cert.status === 'superseded') return false;
  if (filter === 'all') return true;
  if (filter === 'draft') return cert.status === 'draft';
  if (filter === 'approved') return cert.status === 'approved';
  return false;
}

function ipcStatusLabel(status: BillingIPC['status'], language: string): string {
  if (language === 'ar') {
    switch (status) {
      case 'draft': return 'مسودة';
      case 'submitted': return 'مُرسل';
      case 'review': return 'قيد المراجعة';
      case 'approved': return 'معتمد';
      case 'paid': return 'تم التحصيل';
      default: return status;
    }
  }
  switch (status) {
    case 'draft': return 'Draft';
    case 'submitted': return 'Submitted';
    case 'review': return 'Under Review';
    case 'approved': return 'Approved';
    case 'paid': return 'Paid';
    default: return status;
  }
}

function apiLoadErrorToast(err: unknown, language: string, label: string) {
  const msg =
    err instanceof ApiError
      ? `${label}: ${err.message} (${err.status})`
      : `${label}: ${err instanceof Error ? err.message : String(err)}`;
  toast.error(language === 'ar' ? `فشل تحميل ${label} من الخادم` : `Failed to load ${label} from API`, {
    description: msg,
  } as Parameters<typeof toast.error>[1]);
}

function normalizeBillingItem(row: Record<string, unknown>): BillingItem {
  return {
    boqItemId: String(row.boqItemId ?? ''),
    chapterCode: row.chapterCode ? String(row.chapterCode) : undefined,
    chapterName: row.chapterName ? String(row.chapterName) : undefined,
    workTypeCode: row.workTypeCode ? String(row.workTypeCode) : undefined,
    sectionCode: row.sectionCode ? String(row.sectionCode) : undefined,
    sectionName: row.sectionName ? String(row.sectionName) : undefined,
    itemCode: String(row.itemCode ?? ''),
    description: String(row.description ?? ''),
    unit: String(row.unit ?? ''),
    rate: Number(row.rate ?? 0),
    tenderQty: row.tenderQty != null ? Number(row.tenderQty) : undefined,
    previousQty: Number(row.previousQty ?? 0),
    currentQty: Number(row.currentQty ?? 0),
    totalQty: Number(row.totalQty ?? 0),
    amount: Number(row.amount ?? 0),
  };
}

function normalizeBilling(row: Record<string, unknown>): BillingIPC {
  const items = Array.isArray(row.items)
    ? (row.items as Record<string, unknown>[]).map(normalizeBillingItem)
    : [];
  return {
    id: String(row.id),
    projectId: String(row.projectId),
    contractId: String(row.contractId),
    billingNumber: String(row.billingNumber),
    date: String(row.date),
    items,
    worksValueExVat: Number(row.worksValueExVat ?? 0),
    vatAmount: Number(row.vatAmount ?? 0),
    execGuaranteeAmount: Number(row.execGuaranteeAmount ?? 0),
    whtAmount: Number(row.whtAmount ?? 0),
    labourInsuranceAmount: Number(row.labourInsuranceAmount ?? 0),
    manpowerLevyAmount: Number(row.manpowerLevyAmount ?? 0),
    performanceSecurityAmount: Number(row.performanceSecurityAmount ?? 0),
    syndicateStampAmount: Number(row.syndicateStampAmount ?? 0),
    backChargeAmount: Number(row.backChargeAmount ?? 0),
    advancePaymentTotal: Number(row.advancePaymentTotal ?? 0),
    advancePaymentRecovery: Number(row.advancePaymentRecovery ?? 0),
    netPayable: Number(row.netPayable ?? 0),
    status: String(row.status ?? 'draft') as BillingIPC['status'],
    transactionId: row.transactionId ? String(row.transactionId) : undefined,
    isDeleted: row.isDeleted === true,
    ipcKind: IPC_KIND.INTERIM,
  };
}

function normalizeBoqItem(row: Record<string, unknown>): BOQItem {
  return {
    id: String(row.id),
    projectId: String(row.projectId ?? ''),
    contractId: String(row.contractId ?? ''),
    chapterCode: String(row.chapterCode ?? ''),
    chapterName: String(row.chapterName ?? ''),
    workTypeCode: String(row.workTypeCode ?? ''),
    sectionCode: String(row.sectionCode ?? ''),
    sectionName: String(row.sectionName ?? ''),
    itemCode: String(row.itemCode ?? ''),
    description: String(row.description ?? ''),
    unit: String(row.unit ?? ''),
    tenderQty: Number(row.tenderQty ?? 0),
    rateMaterials: Number(row.rateMaterials ?? 0),
    rateLabour: Number(row.rateLabour ?? 0),
    rateEquipment: Number(row.rateEquipment ?? 0),
    rateOverheadPct: Number(row.rateOverheadPct ?? 10),
    rateProfitPct: Number(row.rateProfitPct ?? 12),
    unitRateTotal: Number(row.unitRateTotal ?? 0),
  };
}

function buildBillingPayload(
  formData: {
    billingNumber: string;
    date: string;
    items: BillingItem[];
    ipcKind: IpcKind;
    advancePaymentTotal?: number;
  },
  selectedProjectId: string,
  selectedContractId: string,
  finalStatus: BillingIPC['status'],
  amounts: {
    worksValueExVat: number;
    vat: number;
    exec: number;
    wht: number;
    insurance: number;
    levy: number;
    performanceSecurity: number;
    syndicateStamp: number;
    backCharge: number;
    advance: number;
    net: number;
  },
  language: string,
  transactionId?: string,
) {
  return {
    projectId: selectedProjectId,
    contractId: selectedContractId,
    billingNumber: formData.billingNumber,
    date: formData.date,
    items: formData.items,
    worksValueExVat: amounts.worksValueExVat,
    vatAmount: amounts.vat,
    execGuaranteeAmount: amounts.exec,
    whtAmount: amounts.wht,
    labourInsuranceAmount: amounts.insurance,
    manpowerLevyAmount: amounts.levy,
    performanceSecurityAmount: amounts.performanceSecurity,
    syndicateStampAmount: amounts.syndicateStamp,
    backChargeAmount: amounts.backCharge,
    advancePaymentTotal: Number(formData.advancePaymentTotal || 0),
    advancePaymentRecovery: amounts.advance,
    netPayable: amounts.net,
    status: finalStatus,
    description: `${language === 'ar' ? 'مستخلص رقم' : 'IPC No'} ${formData.billingNumber}`,
    ...(transactionId ? { transactionId } : {}),
    isDeleted: false,
    ipcKind: formData.ipcKind,
  };
}

export function Billing({ embedded = false }: { embedded?: boolean }) {
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
  const { requestPrint: requestMosPrint, PrintHost: MosPrintHost } = useMosPrintPreview(
    language,
    formatMoney,
    printLabels,
  );

  const [companyInfo, setCompanyInfo] = useState<CompanyPrintInfo & { reportPrintProfiles?: StoredReportPrintProfiles }>({
    companyName: 'شركة النيل للمقاولات والاستثمار العقاري',
    companyNameEn: 'Nile Construction & Real Estate',
    headerLogo: '',
    taxId: '123-456-789',
    address: 'القاهرة، مصر',
    addressEn: 'Cairo, Egypt',
    footerText: 'نظام إدارة التكاليف - جميع الحقوق محفوظة © 2026',
    footerTextEn: 'Cost Management System - All Rights Reserved © 2026',
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

  const { isAdmin } = usePermissions();
  const { isAdmin: isAdminScope, isProjectsManager } = useUserAccessScope();
  const canApproveMos = isAdminScope || isProjectsManager;
  const canApproveIpc = isLocalBackend && canApproveMos;
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedContractId, setSelectedContractId] = useState<string>('');
  const [billingRefreshKey, setBillingRefreshKey] = useState(0);
  const [dataRefreshKey, setDataRefreshKey] = useState(0);
  const [statusFilter, setStatusFilter] = useState<BillingStatusFilter>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIPC, setEditingIPC] = useState<BillingIPC | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [ipcPreview, setIpcPreview] = useState<{
    entries: JournalPreviewEntry[];
    reference: string;
    description: string;
    status: 'draft' | 'submitted';
    mode: 'submit' | 'approve';
    approveIpcId?: string;
  } | null>(null);
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });
  const [adminVerifyOpen, setAdminVerifyOpen] = useState(false);
  const sensitiveClearBillingRef = useRef<(() => Promise<void>) | null>(null);
  const [mosEquivalentMap, setMosEquivalentMap] = useState<Record<string, number>>({});
  const [mosModalOpen, setMosModalOpen] = useState(false);
  const [mosRefreshSignal, setMosRefreshSignal] = useState(0);
  const [mosHighlightId, setMosHighlightId] = useState<string | null>(null);
  const [ipcHighlightId, setIpcHighlightId] = useState<string | null>(null);
  const [selectedExtract, setSelectedExtract] = useState<SelectedExtract | null>(null);
  const [mosCertificates, setMosCertificates] = useState<MosCertificate[]>([]);
  const [mosListLoading, setMosListLoading] = useState(false);
  const [approvingMosId, setApprovingMosId] = useState<string | null>(null);
  const [newExtractMenuOpen, setNewExtractMenuOpen] = useState(false);
  const [showIpcQtyItems, setShowIpcQtyItems] = useState(false);
  const [formData, setFormData] = useState({
    billingNumber: '',
    date: new Date().toISOString().split('T')[0],
    items: [] as BillingItem[],
    vatPct: BILLING_DEFAULTS.VAT_PCT,
    execGuaranteePct: BILLING_DEFAULTS.EXEC_GUARANTEE_PCT,
    whtPct: BILLING_DEFAULTS.WHT_PCT,
    labourInsurancePct: BILLING_DEFAULTS.LABOUR_INSURANCE_PCT,
    manpowerLevyPct: BILLING_DEFAULTS.MANPOWER_LEVY_PCT,
    performanceSecurityPct: BILLING_DEFAULTS.PERFORMANCE_SECURITY_PCT,
    syndicateStampPct: BILLING_DEFAULTS.SYNDICATE_STAMP_PCT,
    backChargeAmount: 0,
    advancePaymentTotal: 0,
    advancePaymentRecovery: 0,
    ipcKind: IPC_KIND.INTERIM as IpcKind,
  });

  const { data: fsPurchaseTransactions } = useFirestoreQuery(
    () =>
      isLocalBackend
        ? null
        : query(
            collection(db, 'purchase_transactions'),
            where('isDeleted', '==', false),
            orderBy('createdAt', 'desc'),
            limit(LISTENER_PURCHASE_TX_CAP),
          ),
    [isLocalBackend],
    { mode: 'snapshot', collectionName: 'purchase_transactions' },
  );
  const { data: apiPurchaseTransactions, error: apiPurchaseError } = useApiQuery<Record<string, unknown>>(
    async () => {
      const rows = (await purchaseTransactionsApi.list()) as Record<string, unknown>[];
      return rows.filter((r) => r.isDeleted !== true);
    },
    [],
    { enabled: isLocalBackend, refreshKey: dataRefreshKey },
  );
  const purchaseTransactions = isLocalBackend ? apiPurchaseTransactions : fsPurchaseTransactions;

  const { data: fsProjects } = useFirestoreQuery<Project>(
    () => (isLocalBackend ? null : query(collection(db, 'projects'), where('isDeleted', '==', false), orderBy('projectCode'))),
    [isLocalBackend],
    { mode: 'snapshot', collectionName: 'projects' },
  );
  const { data: apiProjects, error: apiProjectsError } = useApiQuery<Project>(
    async () => {
      const rows = (await projectsApi.list()) as Project[];
      return rows
        .filter((p) => !(p as Project & { isDeleted?: boolean }).isDeleted)
        .sort((a, b) => String(a.projectCode).localeCompare(String(b.projectCode)));
    },
    [],
    { enabled: isLocalBackend, refreshKey: dataRefreshKey },
  );
  const projects = isLocalBackend ? apiProjects : fsProjects;

  const { data: fsContracts } = useFirestoreQuery<Contract>(
    () =>
      !isLocalBackend && selectedProjectId
        ? query(collection(db, 'contracts'), where('projectId', '==', selectedProjectId), where('isDeleted', '==', false))
        : null,
    [selectedProjectId, isLocalBackend],
    { mode: 'snapshot', collectionName: 'contracts' },
  );
  const { data: apiContracts, error: apiContractsError } = useApiQuery<Contract>(
    () =>
      selectedProjectId
        ? contractsApi.list(`?projectId=${encodeURIComponent(selectedProjectId)}`) as Promise<Contract[]>
        : Promise.resolve([]),
    [selectedProjectId],
    { enabled: isLocalBackend && !!selectedProjectId, refreshKey: dataRefreshKey },
  );
  const contracts = useMemo(() => {
    const rows = isLocalBackend ? apiContracts : fsContracts;
    return rows.filter((c) => !(c as Contract & { isDeleted?: boolean }).isDeleted);
  }, [isLocalBackend, apiContracts, fsContracts]);

  const { data: fsBillings, loading: fsBillingsLoading } = useFirestoreQuery<BillingIPC>(
    () =>
      !isLocalBackend && selectedContractId
        ? query(collection(db, 'billing'), where('contractId', '==', selectedContractId), where('isDeleted', '==', false), orderBy('date', 'desc'))
        : null,
    [selectedContractId, billingRefreshKey, isLocalBackend],
    { mode: 'snapshot', collectionName: 'billing' },
  );
  const { data: apiBillings, loading: apiBillingsLoading, error: apiBillingsError } = useApiQuery<BillingIPC>(
    async () => {
      if (!selectedContractId) return [];
      const rows = (await billingApi.list(selectedContractId)) as Record<string, unknown>[];
      return rows.filter((r) => r.isDeleted !== true).map(normalizeBilling);
    },
    [selectedContractId],
    { enabled: isLocalBackend && !!selectedContractId, refreshKey: billingRefreshKey + dataRefreshKey },
  );
  const billings = isLocalBackend ? apiBillings : fsBillings;
  const loading = isLocalBackend ? apiBillingsLoading : fsBillingsLoading;
  const extractsLoading = loading || (isLocalBackend && mosListLoading);

  const { data: fsBoqItemsRaw } = useFirestoreQuery<BOQItem>(
    () =>
      !isLocalBackend && selectedContractId
        ? query(collection(db, 'boq_items'), where('contractId', '==', selectedContractId), where('isDeleted', '!=', true))
        : null,
    [selectedContractId, isLocalBackend],
    { mode: 'snapshot', collectionName: 'boq_items' },
  );
  const { data: apiBoqItemsRaw, error: apiBoqError } = useApiQuery<BOQItem>(
    async () => {
      if (!selectedContractId) return [];
      const rows = (await boqApi.list(`?contractId=${encodeURIComponent(selectedContractId)}`)) as Record<string, unknown>[];
      return rows.filter((r) => r.isDeleted !== true).map(normalizeBoqItem);
    },
    [selectedContractId],
    { enabled: isLocalBackend && !!selectedContractId, refreshKey: dataRefreshKey },
  );
  const boqItemsRaw = isLocalBackend ? apiBoqItemsRaw : fsBoqItemsRaw;

  const { data: apiApprovedVos } = useApiQuery<VariationOrder>(
    async () => {
      if (!selectedContractId) return [];
      return variationOrdersApi.list({
        contractId: selectedContractId,
        status: 'approved',
      });
    },
    [selectedContractId],
    { enabled: isLocalBackend && !!selectedContractId, refreshKey: dataRefreshKey },
  );

  const voCreatedBoqItemIds = useMemo(
    () => collectVoCreatedBoqItemIds(isLocalBackend ? apiApprovedVos : []),
    [isLocalBackend, apiApprovedVos],
  );

  const materialsOnSiteTotal = useMemo(() => {
    if (!selectedContractId) return 0;
    return mosCertificates
      .filter((m) => m.status === 'approved' && m.contractId === selectedContractId)
      .reduce((s, m) => s + Number(m.totalClaimed || 0), 0);
  }, [mosCertificates, selectedContractId]);

  const previousPaymentsTotal = useMemo(() => {
    return billings
      .filter((b) => b.status === 'approved' || b.status === 'paid')
      .filter((b) => !editingIPC || b.id !== editingIPC.id)
      .reduce((sum, b) => sum + Number(b.netPayable || 0), 0);
  }, [billings, editingIPC]);

  useEffect(() => {
    if (apiProjectsError) apiLoadErrorToast(apiProjectsError, language, language === 'ar' ? 'المشاريع' : 'projects');
  }, [apiProjectsError, language]);
  useEffect(() => {
    if (apiContractsError) apiLoadErrorToast(apiContractsError, language, language === 'ar' ? 'العقود' : 'contracts');
  }, [apiContractsError, language]);
  useEffect(() => {
    if (apiBillingsError) apiLoadErrorToast(apiBillingsError, language, language === 'ar' ? 'المستخلصات' : 'billing');
  }, [apiBillingsError, language]);
  useEffect(() => {
    if (apiBoqError) apiLoadErrorToast(apiBoqError, language, language === 'ar' ? 'بنود BOQ' : 'BOQ items');
  }, [apiBoqError, language]);
  useEffect(() => {
    if (apiPurchaseError) apiLoadErrorToast(apiPurchaseError, language, language === 'ar' ? 'التكاليف' : 'costs');
  }, [apiPurchaseError, language]);

  useEffect(() => {
    const focus = consumePendingBillingFocus();
    if (!focus) return;
    if (focus.projectId) setSelectedProjectId(focus.projectId);
    if (focus.contractId) setSelectedContractId(focus.contractId);
    if (focus.docType === 'mos' && focus.entityId) {
      setMosHighlightId(focus.entityId);
      setSelectedExtract({ kind: 'mos', id: focus.entityId });
    }
    if (focus.docType === 'ipc' && focus.entityId) {
      setIpcHighlightId(focus.entityId);
      setSelectedExtract({ kind: 'ipc', id: focus.entityId });
    }
  }, []);

  const boqItems = useMemo(
    () => [...boqItemsRaw].sort((a, b) => a.itemCode.localeCompare(b.itemCode, undefined, { numeric: true })),
    [boqItemsRaw],
  );

  const hasBlockingFinalIpc = useMemo(
    () => billings.some((b) => b.ipcKind === IPC_KIND.FINAL && !b.isDeleted),
    [billings],
  );

  const statusCounts = useMemo(() => {
    const counts: Record<BillingIPC['status'], number> = {
      draft: 0,
      submitted: 0,
      review: 0,
      approved: 0,
      paid: 0,
    };
    for (const b of billings) counts[b.status] = (counts[b.status] ?? 0) + 1;
    if (isLocalBackend) {
      for (const cert of mosCertificates) {
        if (cert.status === 'superseded') continue;
        if (cert.status === 'draft') counts.draft += 1;
        if (cert.status === 'approved') counts.approved += 1;
      }
    }
    return counts;
  }, [billings, mosCertificates]);

  const visibleMosCount = useMemo(
    () => (isLocalBackend ? mosCertificates.filter((c) => c.status !== 'superseded').length : 0),
    [mosCertificates],
  );

  const totalExtractCount = billings.length + visibleMosCount;

  const hasAnyExtracts = billings.length > 0 || visibleMosCount > 0;

  useEffect(() => {
    if (ipcHighlightId) setSelectedExtract({ kind: 'ipc', id: ipcHighlightId });
  }, [ipcHighlightId]);

  useEffect(() => {
    if (mosHighlightId) setSelectedExtract({ kind: 'mos', id: mosHighlightId });
  }, [mosHighlightId]);

  const filteredBillings = useMemo(() => {
    if (statusFilter === 'all') return billings;
    return billings.filter(b => b.status === statusFilter);
  }, [billings, statusFilter]);

  const filteredSidebarExtracts = useMemo((): SidebarExtractItem[] => {
    const items: SidebarExtractItem[] = filteredBillings.map((ipc) => ({
      kind: 'ipc',
      id: ipc.id,
      ipc,
    }));
    if (isLocalBackend) {
      for (const cert of mosCertificates) {
        if (mosMatchesStatusFilter(cert, statusFilter)) {
          items.push({ kind: 'mos', id: cert.id, cert });
        }
      }
    }
    items.sort((a, b) => {
      const dateA = a.kind === 'ipc' ? normalizeDate(a.ipc.date) : (a.cert.extractDate ?? '');
      const dateB = b.kind === 'ipc' ? normalizeDate(b.ipc.date) : (b.cert.extractDate ?? '');
      return dateB.localeCompare(dateA);
    });
    return items;
  }, [filteredBillings, mosCertificates, statusFilter]);

  const selectedIpc = useMemo(() => {
    if (selectedExtract?.kind !== 'ipc') return null;
    return billings.find((b) => b.id === selectedExtract.id) ?? null;
  }, [selectedExtract, billings]);

  const selectedMosCert = useMemo(() => {
    if (selectedExtract?.kind !== 'mos') return null;
    return mosCertificates.find((c) => c.id === selectedExtract.id) ?? null;
  }, [selectedExtract, mosCertificates]);

  useEffect(() => {
    if (ipcHighlightId || mosHighlightId) return;
    setSelectedExtract((prev) => {
      if (!prev) return null;
      if (filteredSidebarExtracts.some((item) => item.kind === prev.kind && item.id === prev.id)) return prev;
      return null;
    });
  }, [filteredSidebarExtracts, ipcHighlightId, mosHighlightId]);

  // Auto-select first project
  useEffect(() => {
    if (projects.length > 0 && !selectedProjectId) setSelectedProjectId(projects[0].id);
  }, [projects, selectedProjectId]);

  // Auto-select/clear contract when project changes
  useEffect(() => {
    if (!selectedProjectId) { setSelectedContractId(''); return; }
    if (contracts.length > 0) setSelectedContractId(contracts[0].id);
    else setSelectedContractId('');
  }, [contracts, selectedProjectId]);

  useEffect(() => {
    setStatusFilter('all');
    setSelectedExtract(null);
    setIpcHighlightId(null);
    setMosHighlightId(null);
  }, [selectedContractId]);

  useEffect(() => {
    if (!selectedContractId || !isLocalBackend) {
      setMosCertificates([]);
      return;
    }
    let cancelled = false;
    setMosListLoading(true);
    mosCertificatesApi
      .list({ contractId: selectedContractId })
      .then((rows) => {
        if (!cancelled) setMosCertificates(rows);
      })
      .catch(() => {
        if (!cancelled) setMosCertificates([]);
      })
      .finally(() => {
        if (!cancelled) setMosListLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedContractId, mosRefreshSignal]);

  // جلب مجموع التشوينات المعتمدة لكل بند في العقد الحالي (لا يكسر الـ UI إذا فشل)
  useEffect(() => {
    if (!selectedContractId || !isLocalBackend) {
      setMosEquivalentMap({});
      return;
    }
    let cancelled = false;
    mosCertificatesApi
      .equivalentMap(selectedContractId)
      .then((data) => {
        if (cancelled) return;
        setMosEquivalentMap(data.equivalent ?? {});
      })
      .catch(() => { if (!cancelled) setMosEquivalentMap({}); });
    return () => { cancelled = true; };
  }, [selectedContractId, billingRefreshKey, mosRefreshSignal]);

  const boqItemIdsWithCost = useMemo(() => {
    const s = new Set<string>();
    if (!selectedContractId) return s;
    for (const tx of purchaseTransactions) {
      if (tx?.isDeleted || tx?.contractId !== selectedContractId) continue;
      if (!tx?.supplierAccountId) continue;
      const lid = tx.linkedBoqItemId;
      if (lid) s.add(String(lid));
      const rows = tx.items;
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (row?.boqItemId) s.add(String(row.boqItemId));
      }
    }
    return s;
  }, [purchaseTransactions, selectedContractId]);

  const worksValueExVat = useMemo(
    () =>
      formData.items.reduce(
        (sum, item) => sum + roundMoney2(Number(item.currentQty || 0) * Number(item.rate || 0)),
        0,
      ),
    [formData.items],
  );

  const calculateDeductions = useMemo(() => {
    // BOQ rates already include VAT — never add VAT on top of works.
    const worksInclVat = worksValueExVat;
    const vatDivisor = 100 + Number(formData.vatPct || 0);
    const vat =
      vatDivisor > 0
        ? roundMoney2((worksInclVat * Number(formData.vatPct || 0)) / vatDivisor)
        : 0;
    const exec = worksInclVat * (formData.execGuaranteePct / 100);
    // Cover-JLL WHT: (Sub − MOS) / (1+VAT%) × WHT% — strip embedded VAT only.
    const periodSubIncl = worksInclVat + Number(materialsOnSiteTotal || 0);
    const wht = coverWhtAmount(
      periodSubIncl,
      Number(materialsOnSiteTotal || 0),
      formData.vatPct,
      formData.whtPct,
    );
    const insurance = worksInclVat * (formData.labourInsurancePct / 100);
    const levy = worksInclVat * (formData.manpowerLevyPct / 100);
    const performanceSecurity = worksInclVat * (formData.performanceSecurityPct / 100);
    const syndicateStamp = worksInclVat * (formData.syndicateStampPct / 100);
    const backCharge = formData.backChargeAmount;
    const advance = formData.advancePaymentRecovery;
    const net =
      worksInclVat -
      exec -
      performanceSecurity -
      wht -
      insurance -
      levy -
      syndicateStamp -
      backCharge -
      advance;
    return { vat, exec, wht, insurance, levy, performanceSecurity, syndicateStamp, backCharge, advance, net };
  }, [
    worksValueExVat,
    materialsOnSiteTotal,
    formData.vatPct,
    formData.execGuaranteePct,
    formData.whtPct,
    formData.labourInsurancePct,
    formData.manpowerLevyPct,
    formData.performanceSecurityPct,
    formData.syndicateStampPct,
    formData.backChargeAmount,
    formData.advancePaymentRecovery,
  ]);

  const ipcBoqExceedRows = useMemo(
    () => findIpcItemsExceedingTender(formData.items),
    [formData.items],
  );

  const modalOpenBoqRefreshRef = useRef(false);
  useEffect(() => {
    if (!isModalOpen) {
      modalOpenBoqRefreshRef.current = false;
      return;
    }
    if (isLocalBackend && !modalOpenBoqRefreshRef.current) {
      modalOpenBoqRefreshRef.current = true;
      setDataRefreshKey((k) => k + 1);
    }
  }, [isModalOpen, isLocalBackend]);

  useEffect(() => {
    if (!isModalOpen || !boqItems.length) return;
    setFormData((prev) => {
      let changed = false;
      const items = prev.items.map((item) => {
        const boq = boqItems.find((b) => b.id === item.boqItemId);
        if (!boq || typeof boq.tenderQty !== 'number') return item;
        if (item.tenderQty === boq.tenderQty) return item;
        changed = true;
        return { ...item, tenderQty: boq.tenderQty };
      });
      return changed ? { ...prev, items } : prev;
    });
  }, [boqItems, isModalOpen]);

  const handleExportExcel = () => {
    const isAr = language === 'ar';
    const headers = [
      isAr ? 'الفصل' : 'Chapter',
      isAr ? 'القسم' : 'Section',
      isAr ? 'كود البند' : 'Item Code',
      isAr ? 'البيان' : 'Description',
      isAr ? 'الوحدة' : 'Unit',
      isAr ? 'الكمية التعاقدية' : 'Tender Qty',
      isAr ? 'الفئة' : 'Rate',
      isAr ? 'الكمية السابقة' : 'Prev Qty',
      isAr ? 'الكمية الحالية' : 'Curr Qty',
      isAr ? 'إجمالي الكمية' : 'Total Qty',
      isAr ? 'نسبة التنفيذ' : 'Comp %',
      isAr ? 'القيمة' : 'Amount'
    ];

    const aoa: (string | number | null | undefined)[][] = [headers];

    // Group items by chapter
    const chapters: { [key: string]: BillingItem[] } = {};
    formData.items.forEach(item => {
      const chapter = item.chapterName || (isAr ? 'غير مصنف' : 'Uncategorized');
      if (!chapters[chapter]) chapters[chapter] = [];
      chapters[chapter].push(item);
    });

    let totalWorksValue = 0;

    Object.entries(chapters).forEach(([chapterName, items]) => {
      const chapterTotal = items.reduce((sum, item) => sum + item.amount, 0);
      totalWorksValue += chapterTotal;

      items.forEach(item => {
        aoa.push([
          item.chapterName,
          item.sectionName,
          item.itemCode,
          item.description,
          item.unit,
          item.tenderQty,
          item.rate,
          item.previousQty,
          item.currentQty,
          item.totalQty,
          (item.tenderQty ? (item.totalQty / item.tenderQty) * 100 : 0).toFixed(2) + '%',
          item.amount
        ]);
      });

      // Add Chapter Subtotal Row
      aoa.push([
        isAr ? `إجمالي الفصل: ${chapterName}` : `Chapter Total: ${chapterName}`,
        '', '', '', '', '', '', '', '', '', '',
        chapterTotal
      ]);
      aoa.push([]); // Empty row for spacing
    });

    // Add Summary Section
    const { vat, exec, wht, insurance, levy, performanceSecurity, syndicateStamp, backCharge, advance, net } =
      calculateDeductions;
    const totalDeductions =
      exec + performanceSecurity + wht + insurance + levy + syndicateStamp + backCharge + advance;
    
    aoa.push([]);
    aoa.push([isAr ? 'الملخص المالي' : 'Financial Summary']);
    aoa.push([isAr ? 'قيمة الأعمال (بدون ضريبة):' : 'Work Value (Excl. VAT):', '', '', '', '', '', '', '', '', '', '', totalWorksValue]);
    aoa.push([isAr ? 'ضريبة القيمة المضافة (+):' : 'VAT Amount (+):', '', '', '', '', '', '', '', '', '', '', vat]);

    aoa.push([]);
    aoa.push([isAr ? 'تفاصيل المبالغ المحتجزة' : 'Retention Details']);
    aoa.push([
      isAr ? 'نوع المحتجز' : 'Retention Type',
      isAr ? 'النسبة' : 'Rate',
      isAr ? 'قيمة الأعمال الخاضعة' : 'Base Amount',
      isAr ? 'قيمة المحتجز' : 'Retention Amount'
    ]);
    aoa.push([isAr ? 'حجز ضمان أعمال' : 'Retention', `${formData.execGuaranteePct}%`, totalWorksValue, exec]);
    aoa.push([isAr ? 'ضمان أداء' : 'Performance Security', `${formData.performanceSecurityPct}%`, totalWorksValue, performanceSecurity]);
    aoa.push([isAr ? 'مصلحة الضرائب - خصم وإضافة' : 'WHT', `${formData.whtPct}%`, totalWorksValue, wht]);
    aoa.push([isAr ? 'حجز تحت حساب التأمينات' : 'Social Insurance', `${formData.labourInsurancePct}%`, totalWorksValue, insurance]);
    aoa.push([isAr ? 'القوى العاملة' : 'Labour Force', `${formData.manpowerLevyPct}%`, totalWorksValue, levy]);
    aoa.push([isAr ? 'دمغة نقابة المهندسين' : 'Syndicate Stamp', `${formData.syndicateStampPct}%`, totalWorksValue, syndicateStamp]);
    if (backCharge > 0) {
      aoa.push([isAr ? 'خصومات ومبالغ محتجزة' : 'Back Charge', '', '', backCharge]);
    }
    aoa.push([isAr ? 'إجمالي المبالغ المحتجزة' : 'Total Retentions', '', '', totalDeductions - advance]);

    if (advance > 0) {
      aoa.push([isAr ? 'استرداد دفعة مقدمة:' : 'Advance Recovery:', '', '', '', '', '', '', '', '', '', '', advance]);
    }
    aoa.push([isAr ? 'إجمالي الاستقطاعات:' : 'Total Deductions:', '', '', '', '', '', '', '', '', '', '', totalDeductions]);
    aoa.push([isAr ? 'صافي المستحق الصرف:' : 'Net Payable:', '', '', '', '', '', '', '', '', '', '', net]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "IPC Items");
    XLSX.writeFile(wb, `${formData.billingNumber || 'IPC'}_Export.xlsx`);
  };

  const handleImportExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = XLSX.utils.sheet_to_json(ws) as Record<string, unknown>[];

      const updatedItems = [...formData.items];
      data.forEach(row => {
        const itemCode = row[language === 'ar' ? 'كود البند' : 'Item Code'] as string | undefined;
        const currQty = Number(row[language === 'ar' ? 'الكمية الحالية' : 'Curr Qty']);
        
        if (itemCode !== undefined && !isNaN(currQty)) {
          const idx = updatedItems.findIndex(item => item.itemCode === String(itemCode));
          if (idx !== -1) {
            const item = updatedItems[idx];
            const totalQty = item.previousQty + currQty;
            updatedItems[idx] = {
              ...item,
              currentQty: currQty,
              totalQty: totalQty,
              amount: currQty * item.rate,
            };
          }
        }
      });

      setFormData({ ...formData, items: updatedItems });
    };
    reader.readAsBinaryString(file);
  };

  const safePct = (num: number, denom: number, fallback: number) =>
    denom > 0 ? (num / denom) * 100 : fallback;

  const handleOpenModal = useCallback((ipc?: BillingIPC, defaultKind: IpcKind = IPC_KIND.INTERIM) => {
    if (ipc && (ipc.status === 'approved' || ipc.status === 'paid')) return;
    if (!ipc && hasBlockingFinalIpc) {
      toast.error(
        language === 'ar'
          ? 'يوجد مستخلص نهائي لهذا العقد. احذف المستخلص النهائي أو ألغِه لإنشاء مستخلص جديد.'
          : 'A final IPC exists for this contract. Delete or cancel the final IPC to create a new one.',
      );
      return;
    }
    if (ipc) {
      setEditingIPC(ipc);
      const periodBase = (() => {
        const period = ipc.items.reduce(
          (s, i) => s + roundMoney2(Number(i.currentQty || 0) * Number(i.rate || 0)),
          0,
        );
        return period > 0 ? period : ipc.worksValueExVat;
      })();
      setFormData({
        billingNumber: ipc.billingNumber,
        date: normalizeDate(ipc.date),
        items: ipc.items.map(item => {
          const boq = boqItems.find(b => b.id === item.boqItemId);
          const currentQty = Number(item.currentQty || 0);
          const rate = Number(item.rate || 0);
          return {
            ...item,
            tenderQty: boq?.tenderQty ?? item.tenderQty,
            amount: roundMoney2(currentQty * rate),
          };
        }),
        vatPct: safePct(ipc.vatAmount, ipc.worksValueExVat || periodBase, BILLING_DEFAULTS.VAT_PCT),
        execGuaranteePct: safePct(ipc.execGuaranteeAmount, periodBase, BILLING_DEFAULTS.EXEC_GUARANTEE_PCT),
        whtPct: safePct(ipc.whtAmount, periodBase, BILLING_DEFAULTS.WHT_PCT),
        labourInsurancePct: safePct(ipc.labourInsuranceAmount, periodBase, BILLING_DEFAULTS.LABOUR_INSURANCE_PCT),
        manpowerLevyPct: safePct(ipc.manpowerLevyAmount, periodBase, BILLING_DEFAULTS.MANPOWER_LEVY_PCT),
        performanceSecurityPct: safePct(
          ipc.performanceSecurityAmount || 0,
          periodBase,
          BILLING_DEFAULTS.PERFORMANCE_SECURITY_PCT,
        ),
        syndicateStampPct: safePct(
          ipc.syndicateStampAmount || 0,
          periodBase,
          BILLING_DEFAULTS.SYNDICATE_STAMP_PCT,
        ),
        backChargeAmount: ipc.backChargeAmount || 0,
        advancePaymentTotal: ipc.advancePaymentTotal || 0,
        advancePaymentRecovery: ipc.advancePaymentRecovery || 0,
        ipcKind: ipc.ipcKind === IPC_KIND.FINAL ? IPC_KIND.FINAL : IPC_KIND.INTERIM,
      });
    } else {
      setEditingIPC(null);
      // Initialize form with BOQ items
      const initialItems: BillingItem[] = boqItems.map(boq => {
        // Calculate previous quantity from existing billings (excluding drafts)
        const billedPreviousQty = billings.reduce((sum, b) => {
          if (b.status === 'draft') return sum;
          const item = b.items?.find(i => i.boqItemId === boq.id);
          return sum + (item?.currentQty || 0);
        }, 0);
        // طبقة إضافية: الكميات المعادلة من مستخلصات التشوين المعتمدة لهذا البند
        const previousQty = billedPreviousQty + (mosEquivalentMap[boq.id] ?? 0);

        return {
          boqItemId: boq.id,
          chapterCode: boq.chapterCode,
          chapterName: boq.chapterName,
          workTypeCode: boq.workTypeCode,
          sectionCode: boq.sectionCode,
          sectionName: boq.sectionName,
          itemCode: boq.itemCode,
          description: boq.description,
          unit: boq.unit,
          rate: boq.unitRateTotal,
          tenderQty: boq.tenderQty,
          previousQty,
          currentQty: 0,
          totalQty: previousQty,
          amount: 0
        };
      });

      setFormData({
        billingNumber: `IPC-${billings.length + 1}`,
        date: new Date().toISOString().split('T')[0],
        items: initialItems,
        vatPct: BILLING_DEFAULTS.VAT_PCT,
        execGuaranteePct: BILLING_DEFAULTS.EXEC_GUARANTEE_PCT,
        whtPct: BILLING_DEFAULTS.WHT_PCT,
        labourInsurancePct: BILLING_DEFAULTS.LABOUR_INSURANCE_PCT,
        manpowerLevyPct: BILLING_DEFAULTS.MANPOWER_LEVY_PCT,
        performanceSecurityPct: BILLING_DEFAULTS.PERFORMANCE_SECURITY_PCT,
        syndicateStampPct: BILLING_DEFAULTS.SYNDICATE_STAMP_PCT,
        backChargeAmount: 0,
        advancePaymentTotal: 0,
        advancePaymentRecovery: 0,
        ipcKind: defaultKind,
      });
    }
    setIsModalOpen(true);
  }, [billings, boqItems, hasBlockingFinalIpc, language, mosEquivalentMap]);

  const handleItemQtyChange = (idx: number, qty: number) => {
    const newItems = [...formData.items];
    const item = newItems[idx];
    item.currentQty = qty;
    item.totalQty = item.previousQty + qty;
    item.amount = qty * item.rate;
    setFormData({ ...formData, items: newItems });
  };

  const handleItemRateChange = (idx: number, rate: number) => {
    const newItems = [...formData.items];
    const item = newItems[idx];
    item.rate = rate;
    item.amount = item.currentQty * rate;
    setFormData({ ...formData, items: newItems });
  };

  const handleSubmit = async (e?: React.FormEvent, forcedStatus?: 'draft' | 'submitted') => {
    if (e) e.preventDefault();
    if (!selectedContractId) return;
    setIsSubmitting(true);
    const { vat, exec, wht, insurance, levy, performanceSecurity, syndicateStamp, backCharge, advance, net } =
      calculateDeductions;
    const contract = contracts.find(c => c.id === selectedContractId);
    
    // Determine the status: if forcedStatus is provided (from Draft button), use it. 
    // Otherwise use editingIPC.status or default to 'submitted'.
    const finalStatus = forcedStatus || (editingIPC ? editingIPC.status : 'submitted');

    try {
      const amounts = {
        // Journal expects ex-VAT works + separate VAT (rates on lines are VAT-inclusive).
        worksValueExVat: roundMoney2(worksValueExVat - vat),
        vat,
        exec,
        wht,
        insurance,
        levy,
        performanceSecurity,
        syndicateStamp,
        backCharge,
        advance,
        net,
      };
      const payload = buildBillingPayload(
        formData,
        selectedProjectId,
        selectedContractId,
        finalStatus,
        amounts,
        language,
        editingIPC?.transactionId,
      );

      if (isLocalBackend) {
        let saved: { boqQuantityWarnings?: unknown[] } | undefined;
        if (editingIPC) {
          if (finalStatus === 'draft' && editingIPC.transactionId) {
            await billingApi.revertToDraft(editingIPC.id);
            saved = await billingApi.update(editingIPC.id, { ...payload, status: 'draft', transactionId: '' });
          } else {
            saved = await billingApi.update(editingIPC.id, payload);
          }
        } else {
          saved = await billingApi.create(payload);
        }
        setIsModalOpen(false);
        setEditingIPC(null);
        setBillingRefreshKey((k) => k + 1);
        setDataRefreshKey((k) => k + 1);
        toast.success(
          finalStatus === 'draft'
            ? (language === 'ar' ? 'تم حفظ المسودة' : 'Draft saved')
            : t('ipc_submitted_toast'),
        );
        if (finalStatus === 'submitted') {
          const serverCount = Array.isArray(saved?.boqQuantityWarnings) ? saved.boqQuantityWarnings.length : 0;
          const count = Math.max(serverCount, ipcBoqExceedRows.length);
          if (count > 0) {
            toast(t('ipc_exceeds_boq_submit_toast').replace('{count}', String(count)));
          }
        }
        return;
      } else {
        let transactionId = editingIPC?.transactionId;

        if (finalStatus !== 'draft') {
          transactionId = await accountingService.recordIPC({
            worksValue: roundMoney2(worksValueExVat - vat),
            vatAmount: vat,
            netPayable: net,
            execGuarantee: exec,
            whtAmount: wht,
            labourInsurance: insurance,
            manpowerLevy: levy,
            advancePaymentTotal: formData.advancePaymentTotal || 0,
      advancePaymentRecovery: advance,
            performanceSecurity,
            syndicateStamp,
            backCharge,
            description: payload.description,
            projectId: selectedProjectId,
            contractId: selectedContractId,
            date: formData.date,
            contractName: contract?.contractName || 'N/A',
            transactionId: editingIPC?.transactionId,
          });
        } else if (editingIPC?.transactionId) {
          transactionId = '';
        }

        const billingData = {
          ...payload,
          transactionId: transactionId || '',
        };

        if (editingIPC) {
          if (finalStatus === 'draft' && editingIPC.transactionId) {
            const batch = writeBatch(db);
            batch.update(doc(db, 'transactions', editingIPC.transactionId), { isDeleted: true });
            batch.update(doc(db, 'billing', editingIPC.id), billingData);
            await batch.commit();
          } else {
            await updateDoc(doc(db, 'billing', editingIPC.id), billingData);
          }
        } else {
          await addDoc(collection(db, 'billing'), billingData);
        }
      }

      setIsModalOpen(false);
      setEditingIPC(null);
      setBillingRefreshKey((k) => k + 1);
      setDataRefreshKey((k) => k + 1);
      toast.success(
        finalStatus === 'draft'
          ? (language === 'ar' ? 'تم حفظ المسودة' : 'Draft saved')
          : (language === 'ar' ? 'تم حفظ المستخلص' : 'IPC saved'),
      );
    } catch (error) {
      handleFirestoreError(error, editingIPC ? OperationType.UPDATE : OperationType.CREATE, 'billing');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Local: submit without GL (GL on approve). Cloud: preview then post via recordIPC.
  const handleRequestSubmit = useCallback((status: 'draft' | 'submitted') => {
    if (status === 'draft' || !selectedContractId) {
      void handleSubmit(undefined, status);
      return;
    }
    if (isLocalBackend) {
      void handleSubmit(undefined, status);
      return;
    }
    const d = calculateDeductions;
    const contract = contracts.find((c) => c.id === selectedContractId);
    const entries = buildIpcEntries({
      worksValue: roundMoney2(worksValueExVat - d.vat),
      vatAmount: d.vat,
      netPayable: d.net,
      execGuarantee: d.exec,
      whtAmount: d.wht,
      labourInsurance: d.insurance,
      manpowerLevy: d.levy,
      advancePaymentRecovery: d.advance,
      performanceSecurity: d.performanceSecurity,
      syndicateStamp: d.syndicateStamp,
      backCharge: d.backCharge,
      contractName: contract?.contractName || 'N/A',
    });
    setIpcPreview({
      entries,
      reference: '',
      description: language === 'ar' ? `مستخلص عميل — ${contract?.contractName ?? ''}` : `Client IPC — ${contract?.contractName ?? ''}`,
      status,
      mode: 'submit',
    });
  }, [selectedContractId, calculateDeductions, contracts, worksValueExVat, language, isLocalBackend]);

  const formatDate = (date: FirestoreDate | null | undefined) => {
    const locale = displayLocale(language);
    if (!date) return 'N/A';
    try {
      if (typeof date === 'string') return new Date(date).toLocaleDateString(locale);
      if (date instanceof Date) return date.toLocaleDateString(locale);
      return date.toDate().toLocaleDateString(locale);
    } catch {
      return 'N/A';
    }
  };

  const contractScopeLabel = useCallback(
    (contract?: Contract) => {
      if (!contract) return undefined;
      return [contract.contractNumber, contract.contractName].filter(Boolean).join(' — ');
    },
    [],
  );

  const openMosModal = useCallback(() => {
    if (!selectedContractId) return;
    if (!isLocalBackend) {
      toast.error(t('mos_local_only'));
      return;
    }
    setMosModalOpen(true);
  }, [selectedContractId, isLocalBackend, t]);

  const handleApproveMos = useCallback(
    async (cert: MosCertificate) => {
      setApprovingMosId(cert.id);
      try {
        await mosCertificatesApi.approve(cert.id);
        toast.success(t('mos_approved'));
        setMosRefreshSignal((k) => k + 1);
      } catch {
        toast.error(t('mos_approve_failed'));
      } finally {
        setApprovingMosId(null);
      }
    },
    [t],
  );

  const handlePrintMos = useCallback(
    (cert: MosCertificate) => {
      const project = projects?.find((p) => p.id === selectedProjectId);
      const contract = contracts.find((c) => c.id === selectedContractId);
      const phaseLabel =
        cert.phase === 'initial' ? t('mos_phase_initial') : t('mos_phase_periodic');
      const statusLabel =
        cert.status === 'approved'
          ? t('mos_status_approved')
          : cert.status === 'superseded'
            ? t('mos_status_superseded')
            : t('mos_status_draft');
      const data = buildMosPrintData({
        cert,
        projectName: project?.projectName,
        contractName: contract?.contractName || contract?.contractNumber,
        phaseLabel,
        statusLabel,
      });
      requestMosPrint(
        data,
        companyInfo,
        new Date().toLocaleDateString(displayLocale(language)),
        contractScopeLabel(contract),
      );
    },
    [
      projects,
      contracts,
      selectedProjectId,
      selectedContractId,
      t,
      requestMosPrint,
      companyInfo,
      language,
      contractScopeLabel,
    ],
  );

  const handlePrintIPC = (ipc: BillingIPC) => {
    const project = projects?.find((p) => p.id === ipc.projectId);
    const contract = contracts.find((c) => c.id === ipc.contractId);
    const coverWorks = buildIpcCoverWorksSplit(ipc.items || [], voCreatedBoqItemIds);
    const coverSchedule = buildIpcCoverSchedule({
      startDate: contract?.startDate,
      endDate: contract?.endDate,
      language,
    });
    const coverContractSums = buildIpcCoverContractSums({
      originalContractSum: contract?.contractValue,
      approvedVos: isLocalBackend ? (apiApprovedVos ?? []) : [],
    });
    const materialsOnSite = mosCertificates
      .filter((m) => m.status === 'approved' && m.contractId === ipc.contractId)
      .reduce((s, m) => s + Number(m.totalClaimed || 0), 0);
    const previousPayments = billings
      .filter((b) => (b.status === 'approved' || b.status === 'paid') && b.id !== ipc.id)
      .reduce((sum, b) => sum + Number(b.netPayable || 0), 0);
    const periodWorks =
      coverWorks.periodWorksTotal > 0 ? coverWorks.periodWorksTotal : ipc.worksValueExVat;
    const data = buildBillingIpcPrintData({
      ipcKind: ipc.ipcKind,
      billingNumber: ipc.billingNumber,
      dateLabel: formatDate(ipc.date),
      projectName: project?.projectName,
      contractName: contract?.contractName || contract?.contractNumber,
      contractorName: companyInfo.companyName || companyInfo.companyNameEn,
      statusLabel: ipcStatusLabel(ipc.status, language),
      items: mapToIpcPrintItems(ipc.items || []),
      coverWorks,
      coverSchedule,
      coverContractSums,
      materialsOnSite,
      previousPayments,
      worksValueExVat: periodWorks,
      vatPct: BILLING_DEFAULTS.VAT_PCT,
      coverRates: {
        vatPct: BILLING_DEFAULTS.VAT_PCT,
        whtPct: BILLING_DEFAULTS.WHT_PCT,
        retentionPct: BILLING_DEFAULTS.EXEC_GUARANTEE_PCT,
        performancePct: BILLING_DEFAULTS.PERFORMANCE_SECURITY_PCT,
        insurancePct: BILLING_DEFAULTS.LABOUR_INSURANCE_PCT,
        manpowerPct: BILLING_DEFAULTS.MANPOWER_LEVY_PCT,
        syndicatePct: BILLING_DEFAULTS.SYNDICATE_STAMP_PCT,
      },
      vatAmount: ipc.vatAmount,
      execGuaranteeAmount: ipc.execGuaranteeAmount,
      whtAmount: ipc.whtAmount || 0,
      labourInsuranceAmount: ipc.labourInsuranceAmount,
      manpowerLevyAmount: ipc.manpowerLevyAmount,
      performanceSecurityAmount: ipc.performanceSecurityAmount || 0,
      syndicateStampAmount: ipc.syndicateStampAmount || 0,
      backChargeAmount: ipc.backChargeAmount || 0,
      advancePaymentTotal: ipc.advancePaymentTotal || 0,
      advancePaymentRecovery: ipc.advancePaymentRecovery || 0,
      netPayable: ipc.netPayable,
    });
    requestPrint(
      data,
      'billing_ipc',
      mergeCompanyPrintInfoWithProject(companyInfo, project),
      new Date().toLocaleDateString(displayLocale(language)),
      contractScopeLabel(contract),
    );
  };

  const handlePrintIPCCover = (ipc: BillingIPC) => {
    const project = projects?.find((p) => p.id === ipc.projectId);
    const contract = contracts.find((c) => c.id === ipc.contractId);
    const coverWorks = buildIpcCoverWorksSplit(ipc.items || [], voCreatedBoqItemIds);
    const coverSchedule = buildIpcCoverSchedule({
      startDate: contract?.startDate,
      endDate: contract?.endDate,
      language,
    });
    const coverContractSums = buildIpcCoverContractSums({
      originalContractSum: contract?.contractValue,
      approvedVos: isLocalBackend ? (apiApprovedVos ?? []) : [],
    });
    const materialsOnSite = mosCertificates
      .filter((m) => m.status === 'approved' && m.contractId === ipc.contractId)
      .reduce((s, m) => s + Number(m.totalClaimed || 0), 0);
    const previousPayments = billings
      .filter((b) => (b.status === 'approved' || b.status === 'paid') && b.id !== ipc.id)
      .reduce((sum, b) => sum + Number(b.netPayable || 0), 0);
    const periodWorks =
      coverWorks.periodWorksTotal > 0 ? coverWorks.periodWorksTotal : ipc.worksValueExVat;
    const data = buildBillingIpcPrintData({
      ipcKind: ipc.ipcKind,
      billingNumber: ipc.billingNumber,
      dateLabel: formatDate(ipc.date),
      projectName: project?.projectName,
      contractName: contract?.contractName || contract?.contractNumber,
      contractorName: companyInfo.companyName || companyInfo.companyNameEn,
      statusLabel: ipcStatusLabel(ipc.status, language),
      items: mapToIpcPrintItems(ipc.items || []),
      coverWorks,
      coverSchedule,
      coverContractSums,
      materialsOnSite,
      previousPayments,
      worksValueExVat: periodWorks,
      vatPct: BILLING_DEFAULTS.VAT_PCT,
      coverRates: {
        vatPct: BILLING_DEFAULTS.VAT_PCT,
        whtPct: BILLING_DEFAULTS.WHT_PCT,
        retentionPct: BILLING_DEFAULTS.EXEC_GUARANTEE_PCT,
        performancePct: BILLING_DEFAULTS.PERFORMANCE_SECURITY_PCT,
        insurancePct: BILLING_DEFAULTS.LABOUR_INSURANCE_PCT,
        manpowerPct: BILLING_DEFAULTS.MANPOWER_LEVY_PCT,
        syndicatePct: BILLING_DEFAULTS.SYNDICATE_STAMP_PCT,
      },
      vatAmount: ipc.vatAmount,
      execGuaranteeAmount: ipc.execGuaranteeAmount,
      whtAmount: ipc.whtAmount || 0,
      labourInsuranceAmount: ipc.labourInsuranceAmount,
      manpowerLevyAmount: ipc.manpowerLevyAmount,
      performanceSecurityAmount: ipc.performanceSecurityAmount || 0,
      syndicateStampAmount: ipc.syndicateStampAmount || 0,
      backChargeAmount: ipc.backChargeAmount || 0,
      advancePaymentTotal: ipc.advancePaymentTotal || 0,
      advancePaymentRecovery: ipc.advancePaymentRecovery || 0,
      netPayable: ipc.netPayable,
    });
    requestPrint(
      data,
      'billing_ipc',
      mergeCompanyPrintInfoWithProject(companyInfo, project),
      new Date().toLocaleDateString(displayLocale(language)),
      contractScopeLabel(contract),
      { coverOnly: true },
    );
  };

  const handlePrintIPCFromModal = () => {
    if (!editingIPC) return;
    const project = projects?.find((p) => p.id === selectedProjectId);
    const contract = contracts.find((c) => c.id === selectedContractId);
    const { vat, exec, wht, insurance, levy, performanceSecurity, syndicateStamp, backCharge, advance, net } =
      calculateDeductions;
    const coverWorks = buildIpcCoverWorksSplit(formData.items, voCreatedBoqItemIds);
    const coverSchedule = buildIpcCoverSchedule({
      startDate: contract?.startDate,
      endDate: contract?.endDate,
      language,
    });
    const coverContractSums = buildIpcCoverContractSums({
      originalContractSum: contract?.contractValue,
      approvedVos: isLocalBackend ? (apiApprovedVos ?? []) : [],
    });
    const data = buildBillingIpcPrintData({
      ipcKind: formData.ipcKind,
      billingNumber: formData.billingNumber || editingIPC.billingNumber,
      dateLabel: formatDate(formData.date),
      projectName: project?.projectName,
      contractName: contract?.contractName || contract?.contractNumber,
      contractorName: companyInfo.companyName || companyInfo.companyNameEn,
      statusLabel: ipcStatusLabel(editingIPC.status, language),
      items: mapToIpcPrintItems(formData.items),
      coverWorks,
      coverSchedule,
      coverContractSums,
      materialsOnSite: materialsOnSiteTotal,
      previousPayments: previousPaymentsTotal,
      worksValueExVat: worksValueExVat,
      vatPct: formData.vatPct,
      coverRates: {
        vatPct: formData.vatPct,
        whtPct: formData.whtPct,
        retentionPct: formData.execGuaranteePct,
        performancePct: formData.performanceSecurityPct,
        insurancePct: formData.labourInsurancePct,
        manpowerPct: formData.manpowerLevyPct,
        syndicatePct: formData.syndicateStampPct,
      },
      vatAmount: vat,
      execGuaranteeAmount: exec,
      whtAmount: wht,
      labourInsuranceAmount: insurance,
      manpowerLevyAmount: levy,
      performanceSecurityAmount: performanceSecurity,
      syndicateStampAmount: syndicateStamp,
      backChargeAmount: backCharge,
      advancePaymentTotal: formData.advancePaymentTotal || 0,
      advancePaymentRecovery: advance,
      netPayable: net,
    });
    requestPrint(
      data,
      'billing_ipc',
      mergeCompanyPrintInfoWithProject(companyInfo, project),
      new Date().toLocaleDateString(displayLocale(language)),
      contractScopeLabel(contract),
    );
  };

  const handlePrintIPCCoverFromModal = () => {
    if (!editingIPC) return;
    const project = projects?.find((p) => p.id === selectedProjectId);
    const contract = contracts.find((c) => c.id === selectedContractId);
    const { vat, exec, wht, insurance, levy, performanceSecurity, syndicateStamp, backCharge, advance, net } =
      calculateDeductions;
    const coverWorks = buildIpcCoverWorksSplit(formData.items, voCreatedBoqItemIds);
    const coverSchedule = buildIpcCoverSchedule({
      startDate: contract?.startDate,
      endDate: contract?.endDate,
      language,
    });
    const coverContractSums = buildIpcCoverContractSums({
      originalContractSum: contract?.contractValue,
      approvedVos: isLocalBackend ? (apiApprovedVos ?? []) : [],
    });
    const data = buildBillingIpcPrintData({
      ipcKind: formData.ipcKind,
      billingNumber: formData.billingNumber || editingIPC.billingNumber,
      dateLabel: formatDate(formData.date),
      projectName: project?.projectName,
      contractName: contract?.contractName || contract?.contractNumber,
      contractorName: companyInfo.companyName || companyInfo.companyNameEn,
      statusLabel: ipcStatusLabel(editingIPC.status, language),
      items: mapToIpcPrintItems(formData.items),
      coverWorks,
      coverSchedule,
      coverContractSums,
      materialsOnSite: materialsOnSiteTotal,
      previousPayments: previousPaymentsTotal,
      worksValueExVat: worksValueExVat,
      vatPct: formData.vatPct,
      coverRates: {
        vatPct: formData.vatPct,
        whtPct: formData.whtPct,
        retentionPct: formData.execGuaranteePct,
        performancePct: formData.performanceSecurityPct,
        insurancePct: formData.labourInsurancePct,
        manpowerPct: formData.manpowerLevyPct,
        syndicatePct: formData.syndicateStampPct,
      },
      vatAmount: vat,
      execGuaranteeAmount: exec,
      whtAmount: wht,
      labourInsuranceAmount: insurance,
      manpowerLevyAmount: levy,
      performanceSecurityAmount: performanceSecurity,
      syndicateStampAmount: syndicateStamp,
      backChargeAmount: backCharge,
      advancePaymentTotal: formData.advancePaymentTotal || 0,
      advancePaymentRecovery: advance,
      netPayable: net,
    });
    requestPrint(
      data,
      'billing_ipc',
      mergeCompanyPrintInfoWithProject(companyInfo, project),
      new Date().toLocaleDateString(displayLocale(language)),
      contractScopeLabel(contract),
      { coverOnly: true },
    );
  };

  const handleUpdateStatus = async (ipcId: string, newStatus: BillingIPC['status']) => {
    try {
      if (isLocalBackend) {
        await billingApi.patchStatus(ipcId, newStatus);
      } else {
        await updateDoc(doc(db, 'billing', ipcId), { status: newStatus });
      }
      setBillingRefreshKey((k) => k + 1);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'billing');
    }
  };

  const handleStartApproveIpc = useCallback(
    async (ipc: BillingIPC) => {
      if (!canApproveIpc) return;
      if (ipc.status !== 'submitted' && ipc.status !== 'review') return;

      setIsSubmitting(true);
      try {
        let entries: JournalPreviewEntry[];
        let description: string;
        let reference: string;

        if (isLocalBackend) {
          const preview = await billingApi.journalPreview(ipc.id);
          entries = preview.entries;
          description = preview.description;
          reference = preview.reference;
        } else {
          const contract = contracts.find((c) => c.id === ipc.contractId);
          entries = buildIpcEntries({
            worksValue: ipc.worksValueExVat,
            vatAmount: ipc.vatAmount,
            netPayable: ipc.netPayable,
            execGuarantee: ipc.execGuaranteeAmount,
            whtAmount: ipc.whtAmount,
            labourInsurance: ipc.labourInsuranceAmount,
            manpowerLevy: ipc.manpowerLevyAmount,
            advancePaymentRecovery: ipc.advancePaymentRecovery,
            performanceSecurity: ipc.performanceSecurityAmount || 0,
            syndicateStamp: ipc.syndicateStampAmount || 0,
            backCharge: ipc.backChargeAmount || 0,
            contractName: contract?.contractName || 'N/A',
          });
          description =
            language === 'ar'
              ? `مستخلص عميل — ${contract?.contractName ?? ipc.billingNumber}`
              : `Client IPC — ${contract?.contractName ?? ipc.billingNumber}`;
          reference = ipc.billingNumber;
        }

        setIpcPreview({
          entries,
          reference,
          description,
          status: 'submitted',
          mode: 'approve',
          approveIpcId: ipc.id,
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.READ, 'billing');
      } finally {
        setIsSubmitting(false);
      }
    },
    [canApproveIpc, contracts, isLocalBackend, language],
  );

  const handleConfirmApproveIpc = useCallback(async () => {
    const ipcId = ipcPreview?.approveIpcId;
    if (!ipcId) return;
    setIsSubmitting(true);
    try {
      if (isLocalBackend) {
        await billingApi.approve(ipcId);
      } else {
        await handleUpdateStatus(ipcId, 'approved');
      }
      setIpcPreview(null);
      setBillingRefreshKey((k) => k + 1);
      setDataRefreshKey((k) => k + 1);
      toast.success(t('ipc_approved_toast'));
    } catch (error) {
      if (isLocalBackend) {
        toast.error(ipcApproveErrorToastMessage(error, t));
      } else {
        handleFirestoreError(error, OperationType.UPDATE, 'billing');
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [ipcPreview?.approveIpcId, isLocalBackend, t]);

  const handleDeleteIPC = (ipc: BillingIPC) => {
    setConfirmConfig({
      isOpen: true,
      title: language === 'ar' ? 'تأكيد الحذف' : 'Confirm Delete',
      message: language === 'ar' ? 'هل أنت متأكد من حذف هذا المستخلص؟ سيتم حذف القيد المحاسبي المرتبط به أيضاً.' : 'Are you sure you want to delete this IPC? The associated journal entry will also be deleted.',
      onConfirm: async () => {
        setIsSubmitting(true);
        try {
          if (isLocalBackend) {
            await billingApi.remove(ipc.id);
          } else {
            await accountingService.softDelete('billing', ipc.id);
            if (ipc.transactionId) {
              await accountingService.deleteTransaction(ipc.transactionId);
            }
          }
          setBillingRefreshKey((k) => k + 1);
          setDataRefreshKey((k) => k + 1);
          setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, 'billing');
        } finally {
          setIsSubmitting(false);
        }
      }
    });
  };

  const handleClearIPCs = async () => {
    if (!isAdmin) {
      toast.error(
        language === 'ar'
          ? 'مسح كل المستخلصات للعقد متاح لمدير النظام فقط.'
          : 'Clearing all IPCs for a contract is limited to system administrators.',
      );
      return;
    }
    if (!selectedContractId) return;

    setConfirmConfig({
      isOpen: true,
      title: language === 'ar' ? 'تأكيد المسح' : 'Confirm Clear',
      message: language === 'ar' ? 'هل أنت متأكد من رغبتك في مسح كافة مستخلصات هذا العقد؟' : 'Are you sure you want to clear all IPCs for this contract?',
      onConfirm: async () => {
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        sensitiveClearBillingRef.current = async () => {
          setIsSubmitting(true);
          try {
          if (isLocalBackend) {
            for (const ipc of billings) {
              await billingApi.remove(ipc.id);
            }
          } else {
            const q = query(collection(db, 'billing'), where('contractId', '==', selectedContractId), where('isDeleted', '==', false));
            const snapshot = await getDocs(q);
            const deletePromises = snapshot.docs.map((d) => updateDoc(doc(db, 'billing', d.id), { isDeleted: true }));
            await Promise.all(deletePromises);
          }
          setBillingRefreshKey((k) => k + 1);
          setDataRefreshKey((k) => k + 1);
          } catch (error) {
            handleFirestoreError(error, OperationType.DELETE, 'billing');
          } finally {
            setIsSubmitting(false);
          }
        };
        setAdminVerifyOpen(true);
      },
    });
  };

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

  const renderIpcDetail = (ipc: BillingIPC) => {
    const printItems = mapToIpcPrintItems(ipc.items || []);
    const chapters = groupIpcItemsByChapter(printItems, language as 'ar' | 'en');
    const coverSplit = buildIpcCoverWorksSplit(ipc.items || [], voCreatedBoqItemIds);
    const contract = contracts.find((c) => c.id === ipc.contractId);
    const coverSchedule = buildIpcCoverSchedule({
      startDate: contract?.startDate,
      endDate: contract?.endDate,
      language,
    });
    const previousPayments = billings
      .filter((b) => (b.status === 'approved' || b.status === 'paid') && b.id !== ipc.id)
      .reduce((sum, b) => sum + Number(b.netPayable || 0), 0);
    const coverContractSums = buildIpcCoverContractSums({
      originalContractSum: contract?.contractValue,
      approvedVos: isLocalBackend ? (apiApprovedVos ?? []) : [],
    });
    const materialsOnSite = mosCertificates
      .filter((m) => m.status === 'approved' && m.contractId === ipc.contractId)
      .reduce((s, m) => s + Number(m.totalClaimed || 0), 0);
    const isAr = language === 'ar';
    const tableHeadCls = cn(
      'p-2 whitespace-nowrap',
      theme === 'dark' ? 'border-b border-gray-800 bg-gray-900/50 text-gray-500' : 'border-b border-gray-200 bg-gray-50 text-gray-600',
    );
    const tableCellCls = cn('p-2', theme === 'dark' ? 'text-gray-200' : 'text-gray-700');
    const coverRates = {
      vatPct: BILLING_DEFAULTS.VAT_PCT,
      whtPct: BILLING_DEFAULTS.WHT_PCT,
      retentionPct: BILLING_DEFAULTS.EXEC_GUARANTEE_PCT,
      performancePct: BILLING_DEFAULTS.PERFORMANCE_SECURITY_PCT,
      insurancePct: BILLING_DEFAULTS.LABOUR_INSURANCE_PCT,
      manpowerPct: BILLING_DEFAULTS.MANPOWER_LEVY_PCT,
      syndicatePct: BILLING_DEFAULTS.SYNDICATE_STAMP_PCT,
    };

    return (
    <>
      <div className="flex justify-between items-start mb-4">
        <div className="flex gap-4 min-w-0">
          <div className={cn(
            'w-10 h-10 rounded-lg flex items-center justify-center border shrink-0',
            theme === 'dark' ? 'bg-gray-900 border-gray-800' : theme === 'soft' ? 'bg-[#eceff1] border-[#cfd8dc]' : 'bg-gray-50 border-gray-200',
          )}>
            <FileText className="text-blue-500" size={20} />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold truncate">{language === 'ar' ? 'مستخلص رقم:' : 'IPC No:'} {ipc.billingNumber}</h3>
            <p className="text-xs text-gray-500 mt-1">{language === 'ar' ? 'بتاريخ:' : 'Date:'} {formatDate(ipc.date)}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap justify-end shrink-0">
          <span className={cn(
            'text-[10px] font-bold px-2 py-1 rounded uppercase',
            ipc.ipcKind === IPC_KIND.FINAL ? 'bg-violet-900/30 text-violet-400' : 'bg-slate-800/50 text-slate-400',
          )}>
            {ipc.ipcKind === IPC_KIND.FINAL ? (language === 'ar' ? 'نهائي' : 'Final') : (language === 'ar' ? 'جاري' : 'Interim')}
          </span>
          <span className={cn(
            'text-[10px] font-bold px-2 py-1 rounded uppercase',
            ipc.status === 'paid' ? 'bg-green-900/20 text-green-500'
              : ipc.status === 'draft' ? 'bg-gray-800 border border-gray-700 text-gray-400'
                : ipc.status === 'review' ? 'bg-blue-900/20 text-blue-500'
                  : ipc.status === 'submitted' ? 'bg-amber-900/20 text-amber-500'
                    : ipc.status === 'approved' ? 'bg-yellow-900/20 text-yellow-500'
                      : 'bg-gray-800 text-gray-400',
          )}>
            {ipcStatusLabel(ipc.status, language)}
          </span>
          <div className="flex gap-2">
            {ipc.status !== 'approved' && ipc.status !== 'paid' && (
              <button type="button" onClick={() => handleOpenModal(ipc)} className="text-gray-500 hover:text-blue-500 transition-colors" title={language === 'ar' ? 'تعديل' : 'Edit'}>
                <Edit2 size={16} />
              </button>
            )}
            <button type="button" onClick={() => handleDeleteIPC(ipc)} className="text-gray-500 hover:text-red-500 transition-colors" title={language === 'ar' ? 'حذف' : 'Delete'}>
              <Trash2 size={16} />
            </button>
            {ipc.status === 'submitted' && (
              <button type="button" onClick={() => handleUpdateStatus(ipc.id, 'review')} className="text-gray-500 hover:text-blue-500 transition-colors" title={t('ipc_send_review')}>
                <Clock size={16} />
              </button>
            )}
            {canApproveIpc && (ipc.status === 'submitted' || ipc.status === 'review') && !ipc.transactionId && (
              <button
                type="button"
                onClick={() => void handleStartApproveIpc(ipc)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-green-600/90 text-white text-[10px] font-bold hover:bg-green-500 transition-colors"
                title={t('ipc_approve')}
              >
                <CheckCircle2 size={14} />
                {t('ipc_approve')}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mb-4">
        <IpcCoverPanel
          cover={coverSplit}
          schedule={coverSchedule}
          contractSums={coverContractSums}
          formatMoney={formatMoney}
          language={language}
          theme={theme}
          dir={dir === 'rtl' ? 'rtl' : 'ltr'}
          asOfDate={formatDate(ipc.date)}
          materialsOnSite={materialsOnSite}
          rates={coverRates}
          advancePaymentTotal={ipc.advancePaymentTotal || 0}
          advanceRecovery={ipc.advancePaymentRecovery || 0}
          backCharge={ipc.backChargeAmount || 0}
          previousPayments={previousPayments}
          netPayable={ipc.netPayable}
          preparedBy={companyInfo.coverPreparedBy}
          approvedBy={companyInfo.coverApprovedBy}
        />
      </div>

      <div className={cn('mt-4 pt-4 border-t space-y-3', theme === 'dark' ? 'border-gray-800/50' : 'border-gray-100')}>
        <button
          type="button"
          onClick={() => setShowIpcQtyItems((v) => !v)}
          className={cn(
            'w-full flex items-center justify-between gap-2 px-4 py-3 rounded-xl border text-sm font-bold transition-colors',
            theme === 'dark'
              ? 'border-gray-800 bg-gray-900/40 text-blue-300 hover:bg-gray-900'
              : 'border-gray-200 bg-gray-50 text-blue-700 hover:bg-gray-100',
          )}
        >
          <span>
            {isAr ? 'بنود المستخلص (قائمة الكميات)' : 'IPC line items (quantities)'}
            <span className="ms-2 text-[10px] font-normal opacity-70">({printItems.length})</span>
          </span>
          {showIpcQtyItems ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
        {showIpcQtyItems ? (
          printItems.length === 0 ? (
            <p className="text-xs text-gray-500">{isAr ? 'لا توجد بنود في هذا المستخلص.' : 'No line items in this IPC.'}</p>
          ) : (
          <div className={cn('overflow-x-auto border rounded-xl', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
            <table className={cn('w-full text-right text-[10px] min-w-[720px]', theme === 'dark' ? 'bg-transparent' : 'bg-white')}>
              <thead>
                <tr>
                  <th className={tableHeadCls}>{isAr ? 'الفصل' : 'Chapter'}</th>
                  <th className={tableHeadCls}>{isAr ? 'القسم' : 'Section'}</th>
                  <th className={tableHeadCls}>{isAr ? 'البند' : 'Item'}</th>
                  <th className={tableHeadCls}>{isAr ? 'الوحدة' : 'Unit'}</th>
                  <th className={cn(tableHeadCls, 'text-center')}>{isAr ? 'الكمية' : 'Qty'}</th>
                  <th className={cn(tableHeadCls, 'text-center')}>{isAr ? 'السعر' : 'Rate'}</th>
                  <th className={cn(tableHeadCls, 'text-center')}>{isAr ? 'سابق' : 'Prev'}</th>
                  <th className={cn(tableHeadCls, 'text-center')}>{isAr ? 'حالي' : 'Curr'}</th>
                  <th className={cn(tableHeadCls, 'text-center')}>{isAr ? 'إجمالي' : 'Total'}</th>
                  <th className={cn(tableHeadCls, 'text-center')}>{isAr ? '% تنفيذ' : '% Comp'}</th>
                  <th className={cn(tableHeadCls, 'text-center')}>{isAr ? 'القيمة' : 'Amount'}</th>
                </tr>
              </thead>
              <tbody className={cn('divide-y', theme === 'dark' ? 'divide-gray-800' : 'divide-gray-100')}>
                {chapters.map(({ chapterName, items }) => {
                  const chapterTotal = items.reduce(
                    (s, i) => s + roundMoney2(Number(i.currentQty || 0) * Number(i.rate || 0)),
                    0,
                  );
                  return (
                    <Fragment key={chapterName}>
                      {items.map((item, rowIdx) => {
                        const execPct = item.tenderQty ? (item.totalQty / item.tenderQty) * 100 : 0;
                        const boqItemId = ipc.items.find((row) => row.itemCode === item.itemCode)?.boqItemId;
                        const costLinked = boqItemId ? boqItemIdsWithCost.has(boqItemId) : false;
                        const periodAmount = roundMoney2(Number(item.currentQty || 0) * Number(item.rate || 0));
                        return (
                          <tr
                            key={`${chapterName}-${item.itemCode}-${rowIdx}`}
                            className={cn(
                              costLinked && (theme === 'dark' ? 'bg-amber-950/35 border-s-4 border-amber-500' : 'bg-amber-50/90 border-s-4 border-amber-500'),
                            )}
                          >
                            <td className={tableCellCls}>{chapterName}</td>
                            <td className={tableCellCls}>{item.sectionName || '—'}</td>
                            <td className={tableCellCls}>
                              <div className="max-w-[180px] truncate font-medium">{item.description}</div>
                              <div className="text-[8px] text-blue-400 font-mono">{item.itemCode}</div>
                            </td>
                            <td className={cn(tableCellCls, 'text-center text-gray-400')}>{item.unit}</td>
                            <td className={cn(tableCellCls, 'text-center font-mono text-gray-400')}>{formatQuantity(item.tenderQty ?? 0, language)}</td>
                            <td className={cn(tableCellCls, 'text-center font-mono text-green-500')}>{formatMoney(item.rate)}</td>
                            <td className={cn(tableCellCls, 'text-center font-mono text-gray-500')}>{formatQuantity(item.previousQty, language)}</td>
                            <td className={cn(tableCellCls, 'text-center font-mono')}>{formatQuantity(item.currentQty, language)}</td>
                            <td className={cn(tableCellCls, 'text-center font-mono')}>{formatQuantity(item.totalQty, language)}</td>
                            <td className={cn(tableCellCls, 'text-center')}>
                              <span className={cn('font-mono text-[8px]', execPct > 100 ? 'text-red-500' : 'text-gray-400')}>
                                {execPct.toFixed(1)}%
                              </span>
                            </td>
                            <td className={cn(tableCellCls, 'text-center font-mono font-bold text-blue-400')}>{formatMoney(periodAmount)}</td>
                          </tr>
                        );
                      })}
                      <tr className={cn('font-bold', theme === 'dark' ? 'bg-blue-900/10 border-t border-gray-800' : 'bg-blue-50/80 border-t border-gray-200')}>
                        <td colSpan={10} className={cn(tableCellCls, 'text-start text-gray-400')}>
                          {isAr ? 'إجمالي الفصل:' : 'Chapter Total:'} {chapterName}
                        </td>
                        <td className={cn(tableCellCls, 'text-center font-mono text-blue-400')}>{formatMoney(chapterTotal)}</td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          )
        ) : null}
      </div>

      <div className={cn('mt-4 pt-4 border-t flex flex-wrap justify-between items-center gap-3', theme === 'dark' ? 'border-gray-800/50' : 'border-gray-100')}>
        <div className="flex flex-wrap gap-4">
          <div className="flex items-center gap-1 text-[10px] text-gray-500">
            <CheckCircle2 size={12} className="text-green-500" />
            <span>{language === 'ar' ? 'تم اعتماد المكتب الفني' : 'Technical Office Approved'}</span>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-gray-500">
            <Clock size={12} className="text-yellow-500" />
            <span>{language === 'ar' ? 'في انتظار تحويل البنك' : 'Awaiting Bank Transfer'}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => handlePrintIPCCover(ipc)}
            className="text-indigo-500 hover:text-indigo-400 text-xs font-bold flex items-center gap-1 bg-indigo-500/10 px-3 py-1.5 rounded-lg transition-colors"
          >
            <Printer size={14} />
            {t('ipc_print_cover_only')}
          </button>
          <button
            type="button"
            onClick={() => handlePrintIPC(ipc)}
            className="text-blue-500 hover:text-blue-400 text-xs font-bold flex items-center gap-1 bg-blue-500/10 px-3 py-1.5 rounded-lg transition-colors"
          >
            <Printer size={14} />
            {t('ipc_print_full')}
          </button>
        </div>
      </div>
    </>
    );
  };

  return (
    <div className={cn(
      embedded ? 'p-4 md:p-6' : 'p-8 min-h-screen',
      'transition-colors',
      !embedded && (theme === 'dark' ? 'bg-[#0a0a0a] text-gray-100' :
      theme === 'soft' ? 'bg-[#eceff1] text-[#37474f]' :
      'bg-gray-50 text-gray-900'),
    )} dir={dir}>
      {!embedded && (
        <header className="mb-6">
          <h2 className="text-3xl font-bold tracking-tight">{t('billing')}</h2>
          <p className="text-gray-400 mt-1">{language === 'ar' ? 'إدارة مستخلصات الأعمال، الاستقطاعات، والتحصيل' : 'Manage business IPCs, deductions, and collections'}</p>
          {isLocalBackend && selectedContractId && (
            <p className="text-xs text-amber-600/80 mt-2">
              {language === 'ar'
                ? `Postgres: ${billings.length} مستخلص · ${boqItems.length} بند BOQ`
                : `Postgres: ${billings.length} IPCs · ${boqItems.length} BOQ items`}
            </p>
          )}
        </header>
      )}

      <div className={cn('flex flex-col md:flex-row md:items-start gap-4', dir === 'rtl' ? 'md:flex-row-reverse' : '')}>
        <div className="flex-1 min-w-0 md:flex-[3] space-y-4 order-2 md:order-none">
          {extractsLoading ? (
            <div className={cn('border rounded-xl p-12 text-center text-gray-500 flex flex-col items-center gap-4', theme === 'dark' ? 'border-gray-800 bg-[#151619]' : 'border-gray-200 bg-white')}>
              <Loader2 className="animate-spin text-blue-500" size={32} />
              {language === 'ar' ? 'جاري تحميل المستخلصات...' : 'Loading extracts...'}
            </div>
          ) : !selectedContractId ? (
            <div className={cn('border rounded-xl p-12 text-center', theme === 'dark' ? 'border-gray-800 bg-[#151619]' : 'border-gray-200 bg-white')}>
              <p className={cn('text-sm', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>{t('billing_filter_select_contract')}</p>
            </div>
          ) : !hasAnyExtracts ? (
            <div className={cn('border rounded-xl p-12 text-center', theme === 'dark' ? 'border-gray-800 bg-[#151619]' : 'border-gray-200 bg-white')}>
              <p className={cn('text-sm', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>{t('billing_filter_no_ipcs')}</p>
            </div>
          ) : filteredSidebarExtracts.length === 0 ? (
            <div className={cn('border rounded-xl p-12 text-center', theme === 'dark' ? 'border-gray-800 bg-[#151619]' : 'border-gray-200 bg-white')}>
              <p className={cn('text-sm', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>{t('billing_filter_ipc_empty')}</p>
            </div>
          ) : !selectedExtract ? (
            <div className={cn('border rounded-xl p-12 text-center', theme === 'dark' ? 'border-gray-800 bg-[#151619]' : 'border-gray-200 bg-white')}>
              <p className={cn('text-sm', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>{t('billing_filter_select_ipc')}</p>
            </div>
          ) : selectedExtract.kind === 'ipc' && selectedIpc ? (
            <div className={cn(cardCls, 'p-6 max-h-[calc(100vh-8rem)] overflow-y-auto', ipcHighlightId === selectedIpc.id && 'ring-2 ring-blue-500/70')}>
              {renderIpcDetail(selectedIpc)}
            </div>
          ) : selectedExtract.kind === 'mos' && selectedMosCert ? (
            <div className={cn(cardCls, 'p-6', mosHighlightId === selectedMosCert.id && 'ring-2 ring-cyan-500/70')}>
              <MosExtractDetail
                certificate={selectedMosCert}
                canApprove={canApproveMos}
                theme={theme}
                approving={approvingMosId === selectedMosCert.id}
                onApprove={() => void handleApproveMos(selectedMosCert)}
                onPrint={handlePrintMos}
              />
            </div>
          ) : (
            <div className={cn('border rounded-xl p-12 text-center', theme === 'dark' ? 'border-gray-800 bg-[#151619]' : 'border-gray-200 bg-white')}>
              <p className={cn('text-sm', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>{t('billing_filter_select_ipc')}</p>
            </div>
          )}
        </div>

        <aside className={cn(cardCls, 'w-full md:flex-[2] md:min-w-[17rem] md:max-w-[24rem] shrink-0 space-y-4 md:sticky md:top-4 order-1 md:order-none')}>
          <div>
            <h3 className="font-bold text-sm">{t('billing_filter_title')}</h3>
          </div>

          <div className="space-y-3">
            <div>
              <label className={labelCls}>{language === 'ar' ? 'المشروع' : 'Project'}</label>
              <select className={selectCls} value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}>
                <option value="" disabled>{language === 'ar' ? 'اختر المشروع' : 'Select Project'}</option>
                {projects.map((p) => (
                  <option key={p.id || `project-${p.projectCode}`} value={p.id}>{p.projectName} ({p.projectCode})</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>{language === 'ar' ? 'العقد' : 'Contract'}</label>
              <select className={selectCls} value={selectedContractId} onChange={(e) => setSelectedContractId(e.target.value)} disabled={!selectedProjectId}>
                <option value="" disabled>{language === 'ar' ? 'اختر العقد' : 'Select Contract'}</option>
                {contracts.map((c) => (
                  <option key={c.id || `contract-${c.contractNumber}`} value={c.id}>{c.contractName} ({c.contractNumber})</option>
                ))}
              </select>
            </div>
          </div>

          {selectedContractId && (
            <>
              <div className={cn('pt-3 border-t space-y-2', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
                <label className={labelCls}>{language === 'ar' ? 'تصفية حسب الحالة' : 'Filter by status'}</label>
                <select className={selectCls} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as BillingStatusFilter)}>
                  <option value="all">{language === 'ar' ? `الكل (${totalExtractCount})` : `All (${totalExtractCount})`}</option>
                  {(['draft', 'submitted', 'review', 'approved', 'paid'] as const).map((status) => (
                    <option key={status} value={status}>
                      {ipcStatusLabel(status, language)} ({statusCounts[status]})
                    </option>
                  ))}
                </select>
              </div>

              <div className={cn('pt-3 border-t space-y-2', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
                <p className={sectionTitleCls}>{t('billing_filter_ipc_list')}</p>
                {extractsLoading ? (
                  <Loader2 className="animate-spin mx-auto" size={18} />
                ) : filteredSidebarExtracts.length === 0 ? (
                  <p className="text-xs text-gray-500">{t('billing_filter_ipc_empty')}</p>
                ) : (
                  <ul className="space-y-1 max-h-52 overflow-auto">
                    {filteredSidebarExtracts.map((item, itemIdx) => {
                      const active =
                        selectedExtract?.kind === item.kind && selectedExtract.id === item.id;
                      if (item.kind === 'ipc') {
                        const ipc = item.ipc;
                        return (
                          <li key={`ipc-${ipc.id || ipc.billingNumber}-${itemIdx}`}>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedExtract({ kind: 'ipc', id: ipc.id });
                                setIpcHighlightId(null);
                                setMosHighlightId(null);
                              }}
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
                                <span className="font-bold shrink-0">{ipc.billingNumber}</span>
                                <span className="text-xs opacity-80 shrink-0">{formatDate(ipc.date)}</span>
                                <span className="text-[10px] opacity-75 shrink-0">{ipcStatusLabel(ipc.status, language)}</span>
                                <span className="text-[10px] opacity-75 shrink-0">
                                  {ipc.ipcKind === IPC_KIND.FINAL ? (language === 'ar' ? 'نهائي' : 'Final') : (language === 'ar' ? 'جاري' : 'Interim')}
                                </span>
                              </div>
                            </button>
                          </li>
                        );
                      }
                      const cert = item.cert;
                      return (
                        <li key={`mos-${cert.id || cert.certificateNo}-${itemIdx}`}>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedExtract({ kind: 'mos', id: cert.id });
                              setIpcHighlightId(null);
                              setMosHighlightId(null);
                            }}
                            className={cn(
                              'w-full text-start px-2.5 py-1 rounded-lg text-sm border transition-colors',
                              active
                                ? 'bg-cyan-600 text-white border-cyan-600'
                                : theme === 'dark'
                                  ? 'text-gray-300 border-gray-800 hover:bg-gray-800'
                                  : 'text-gray-700 border-gray-200 hover:bg-gray-50',
                            )}
                          >
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0 min-h-[1.25rem] leading-tight">
                              <span className="font-bold shrink-0">{cert.certificateNo}</span>
                              <span className="text-xs opacity-80 shrink-0">{cert.extractDate ?? '—'}</span>
                              <span className="text-[10px] opacity-75 shrink-0">
                                {cert.status === 'approved'
                                  ? t('mos_status_approved')
                                  : cert.status === 'superseded'
                                    ? t('mos_status_superseded')
                                    : t('mos_status_draft')}
                              </span>
                              <span className="text-[10px] opacity-75 shrink-0">{t('extract_kind_mos')}</span>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </>
          )}

          <div className={cn('pt-3 border-t space-y-2', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
            <button
              type="button"
              disabled={!selectedContractId || isSubmitting || billings.length === 0 || !isAdmin}
              onClick={handleClearIPCs}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-bold border border-red-900/50 bg-red-900/20 text-red-500 hover:bg-red-900/40 disabled:opacity-40 transition-colors"
            >
              <Trash2 size={16} />
              {language === 'ar' ? 'تفريغ' : 'Clear'}
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!selectedContractId}
                title={!isLocalBackend ? t('mos_local_only') : undefined}
                onClick={openMosModal}
                className={cn(
                  'flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-bold border transition-colors disabled:opacity-40',
                  isLocalBackend ? 'bg-cyan-600 hover:bg-cyan-500 text-white border-cyan-500' : theme === 'dark' ? 'bg-gray-800 text-gray-400 border-gray-700' : 'bg-gray-100 text-gray-500 border-gray-300',
                )}
              >
                <PackageCheck size={16} />
                {t('extract_kind_mos')}
              </button>
              <ManualHelpButton topicId="technical.billing.mos" size={16} />
            </div>
            <div className="relative">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!selectedContractId}
                  onClick={() => setNewExtractMenuOpen((o) => !o)}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-600 text-white text-sm font-bold transition-colors"
                >
                  <Plus size={16} />
                  {t('new_extract')}
                  <ChevronDown size={16} className={cn('transition-transform', newExtractMenuOpen && 'rotate-180')} />
                </button>
                <ManualHelpButton topicId="technical.billing.interim" size={16} />
              </div>
              {newExtractMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setNewExtractMenuOpen(false)} />
                  <div className={cn(
                    'absolute top-full z-50 mt-2 w-full rounded-xl border shadow-2xl overflow-hidden',
                    theme === 'dark' ? 'bg-[#1a1d23] border-gray-700' : 'bg-white border-gray-200',
                  )}>
                    <button type="button" onClick={() => { setNewExtractMenuOpen(false); openMosModal(); }} className={cn('w-full flex items-center gap-2 px-4 py-2.5 text-sm transition-colors', language === 'ar' ? 'text-right flex-row-reverse' : 'text-left', theme === 'dark' ? 'text-gray-200 hover:bg-gray-800' : 'text-gray-700 hover:bg-gray-50')}>
                      <PackageCheck size={16} className="text-blue-500 shrink-0" />
                      {t('extract_kind_mos')}
                    </button>
                    <button type="button" disabled={hasBlockingFinalIpc} onClick={() => { setNewExtractMenuOpen(false); handleOpenModal(undefined, IPC_KIND.INTERIM); }} className={cn('w-full flex items-center gap-2 px-4 py-2.5 text-sm transition-colors disabled:opacity-40', language === 'ar' ? 'text-right flex-row-reverse' : 'text-left', theme === 'dark' ? 'text-gray-200 hover:bg-gray-800' : 'text-gray-700 hover:bg-gray-50')}>
                      <FileText size={16} className="text-purple-500 shrink-0" />
                      {t('extract_kind_interim')}
                    </button>
                    <button type="button" disabled={hasBlockingFinalIpc} onClick={() => { setNewExtractMenuOpen(false); handleOpenModal(undefined, IPC_KIND.FINAL); }} className={cn('w-full flex items-center gap-2 px-4 py-2.5 text-sm transition-colors disabled:opacity-40', language === 'ar' ? 'text-right flex-row-reverse' : 'text-left', theme === 'dark' ? 'text-gray-200 hover:bg-gray-800' : 'text-gray-700 hover:bg-gray-50')}>
                      <CheckCircle2 size={16} className="text-green-500 shrink-0" />
                      {t('extract_kind_final')}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {confirmConfig.isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={cn("border rounded-2xl w-full max-w-md overflow-hidden shadow-2xl", theme === 'dark' ? "bg-[#151619] border-gray-800" : "bg-white border-gray-200")}
            >
              <div className={cn("p-6 border-b flex justify-between items-center", theme === 'dark' ? "bg-gray-900/50 border-gray-800" : "bg-gray-50 border-gray-200")}>
                <h3 className="text-lg font-bold text-red-500">{confirmConfig.title}</h3>
                <button onClick={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))} className="text-gray-500 hover:text-white transition-colors">
                  <X size={20} />
                </button>
              </div>
              <div className="p-6">
                <p className={cn("text-sm", theme === 'dark' ? "text-gray-300" : "text-gray-600")}>{confirmConfig.message}</p>
              </div>
              <div className={cn("p-6 border-t flex justify-end gap-3", theme === 'dark' ? "bg-gray-900/30 border-gray-800" : "bg-gray-50 border-gray-200")}>
                <button 
                  onClick={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                >
                  {language === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>
                <button 
                  onClick={confirmConfig.onConfirm}
                  disabled={isSubmitting}
                  className="px-6 py-2 rounded-lg text-sm font-bold bg-red-600 hover:bg-red-500 text-white transition-colors flex items-center gap-2"
                >
                  {isSubmitting && <Loader2 className="animate-spin" size={16} />}
                  {language === 'ar' ? 'تأكيد' : 'Confirm'}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        <IPCFormModal
          isOpen={isModalOpen}
          editingIPC={editingIPC}
          formData={formData}
          setFormData={setFormData}
          isSubmitting={isSubmitting}
          contracts={contracts}
          selectedContractId={selectedContractId}
          onClose={() => setIsModalOpen(false)}
          onSubmit={(status) => handleRequestSubmit(status)}
          onItemQtyChange={handleItemQtyChange}
          onItemRateChange={handleItemRateChange}
          theme={theme}
          language={language}
          dir={dir}
          boqItemIdsWithCost={boqItemIdsWithCost}
          ipcKindReadOnly={!!editingIPC && editingIPC.status !== 'draft'}
          onPrintPreview={editingIPC ? handlePrintIPCFromModal : undefined}
          onPrintCoverPreview={editingIPC ? handlePrintIPCCoverFromModal : undefined}
          boqExceedCount={ipcBoqExceedRows.length}
          voCreatedBoqItemIds={voCreatedBoqItemIds}
          approvedVariationOrders={isLocalBackend ? (apiApprovedVos ?? []) : []}
          materialsOnSiteTotal={materialsOnSiteTotal}
          previousPayments={previousPaymentsTotal}
        />

      </AnimatePresence>

      {PrintHost}
      {MosPrintHost}

      <AdminSensitiveVerifyModal
        open={adminVerifyOpen}
        onOpenChange={(v) => {
          setAdminVerifyOpen(v);
          if (!v) sensitiveClearBillingRef.current = null;
        }}
        language={language as 'ar' | 'en'}
        theme={theme}
        onVerified={async () => {
          const fn = sensitiveClearBillingRef.current;
          sensitiveClearBillingRef.current = null;
          if (fn) await fn();
        }}
      />

      <JournalPreviewModal
        open={ipcPreview !== null}
        title={
          ipcPreview?.mode === 'approve'
            ? t('ipc_approve_preview_title')
            : (language === 'ar' ? 'معاينة قيد المستخلص' : 'IPC Journal Preview')
        }
        description={ipcPreview?.description}
        entries={ipcPreview?.entries ?? []}
        busy={isSubmitting}
        confirmLabel={
          ipcPreview?.mode === 'approve'
            ? t('ipc_approve_confirm')
            : (language === 'ar' ? 'تأكيد وحفظ' : 'Confirm & Save')
        }
        onConfirm={() => {
          if (ipcPreview?.mode === 'approve') {
            void handleConfirmApproveIpc();
            return;
          }
          const status = ipcPreview?.status ?? 'submitted';
          setIpcPreview(null);
          void handleSubmit(undefined, status);
        }}
        onClose={() => setIpcPreview(null)}
      />

      {mosModalOpen && selectedContractId && (
        <MosExtractModal
          contractId={selectedContractId}
          boqItems={boqItems}
          theme={theme}
          dir={dir}
          onClose={() => setMosModalOpen(false)}
          onCreated={() => { setMosModalOpen(false); setMosRefreshSignal(k => k + 1); }}
        />
      )}
    </div>
  );
}
