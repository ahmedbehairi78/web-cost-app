import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Loader2, Plus, Printer, Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import toast from 'react-hot-toast';
import { BILLING_DEFAULTS } from '../../constants/billingDefaults';
import { businessTodayYmd } from '../../lib/businessCalendar';
import { isLocalBackend } from '../../lib/dataBackend';
import { cn, listKey, roundMoney2 } from '../../lib/utils';
import { roundMoney } from '../../lib/money';
import { displayLocale } from '../../lib/numberLocale';
import { useLanguage } from '../../context/LanguageContext';
import { JournalPreviewModal } from '../gl/JournalPreviewModal';
import { SearchableSelect } from '../ui/SearchableSelect';
import { SpreadsheetCellInput } from '../ui/SpreadsheetCellInput';
import { ManualHelpButton } from '../help/ManualHelpButton';
import {
  CostsPurchaseSidebar,
  type CostsPurchaseStatusFilter,
  type CostsSidebarPurchaseRow,
} from './CostsPurchaseSidebar';
import { AddSupplierModal, type NewSupplierFields } from './AddSupplierModal';
import { purchaseTransactionsApi, suppliersApi, chartOfAccountsApi, settingsApi, glApi } from '../../services/local/modulesApi';
import { invalidateCoaCache, type Account } from '../../services/accountingService';
import { ApiError } from '../../lib/apiClient';
import { NetworkQueuedError } from '../../lib/offline/offlineWrite';
import { ensureLocalContractExists, ensureLocalProjectExists } from '../../lib/localEntitySync';
import {
  SERVICE_IPC_KINDS,
  SERVICE_IPC_TYPE,
  displayServiceIpcNumber,
  isServiceContractor,
  isServiceIpcKind,
  netQty,
  computeServiceIpcCertificateSummary,
  periodLineAmount,
  previousQtyFromApproved,
  resolveContractorAccountCode,
  serviceIpcPrintTitle,
  sumContractorCashPaymentsFromGl,
  uniqueBoqChapters,
  type ServiceIpcKind,
  type ServiceIpcLine,
} from '../../lib/serviceContractor';
import { DEFAULT_HEADER_LOGO } from '../../lib/concordPlusBrand';
import { buildServiceIpcEntries } from '../../lib/serviceIpcJournal';
import {
  buildServiceIpcCertificateSections,
  type ServiceIpcPrintData,
} from '../../lib/reportDocument';
import type { CompanyPrintInfo } from '../../lib/ipcPrintData';
import type { StoredReportPrintProfiles } from '../../lib/reportPrintProfiles';
import { useReportDocumentPreview } from '../../hooks/useReportDocumentPreview';
import type { Supplier, BOQItem } from '../../types';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';

type ProjectRow = { id: string; projectName: string; projectCode?: string; clientName?: string; budget?: number };
type ContractRow = {
  id: string;
  contractName: string;
  contractNumber: string;
  projectId?: string;
};

type ServiceTx = {
  id: string;
  type?: string;
  supplierId?: string | null;
  supplierAccountId?: string;
  supplierName?: string;
  projectId?: string | null;
  contractId?: string | null;
  date?: string;
  referenceNumber?: string;
  amount?: number;
  vatAmount?: number;
  whtAmount?: number;
  execGuaranteeAmount?: number;
  labourInsuranceAmount?: number;
  manpowerLevyAmount?: number;
  advancePaymentRecovery?: number;
  totalAmount?: number;
  /** UI-only: actual GL payments override for print (not stored in DB) */
  _actualPreviousPayments?: number;
  description?: string;
  status?: string;
  transactionId?: string | null;
  items?: ServiceIpcLine[];
  serviceKind?: string;
  vatPct?: number;
  whtPct?: number;
  execGuaranteePct?: number;
  labourInsurancePct?: number;
  manpowerLevyPct?: number;
};

function makeLine(): ServiceIpcLine & { id: string } {
  return {
    id: `sl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    contractId: '',
    projectId: '',
    chapterCode: '',
    chapterName: '',
    description: '',
    unit: 'يوم',
    rate: 0,
    previousQty: 0,
    currentQty: 0,
  };
}

function posted(tx: Pick<ServiceTx, 'status' | 'transactionId'>): boolean {
  return Boolean(tx.transactionId) || tx.status === 'approved';
}

/** Prefer stored % (incl. 0); else derive from amounts; never revive billing defaults for zeros. */
function resolveStoredPct(
  storedPct: unknown,
  amount: unknown,
  base: unknown,
): number {
  if (storedPct != null && storedPct !== '' && Number.isFinite(Number(storedPct))) {
    return Number(storedPct);
  }
  const part = Number(amount) || 0;
  const whole = Number(base) || 0;
  if (whole > 0) return Math.round((part / whole) * 10000) / 100;
  return 0;
}

function workflowStatusLabel(tx: Pick<ServiceTx, 'status' | 'transactionId'>, isAr: boolean): string {
  if (posted(tx)) return isAr ? 'معتمد' : 'Approved';
  if (tx.status === 'submitted') return isAr ? 'بانتظار الاعتماد' : 'Awaiting approval';
  if (tx.status === 'draft') return isAr ? 'مسودة' : 'Draft';
  return isAr ? 'مسودة' : 'Draft';
}

type Props = {
  accounts: Account[];
  suppliers: Supplier[];
  projects: ProjectRow[];
  contracts: ContractRow[];
  boqItems: BOQItem[];
  theme: string;
  language: string;
  dir: string;
  canCreate: boolean;
  canApprove: boolean;
  refreshKey: number;
  /** Notification deep-link: select + open the form for this id once loaded. */
  initialOpenId?: string | null;
  onInitialOpenConsumed?: () => void;
  onRefresh: () => void;
  onCoaChanged: () => void;
};

export function ServiceIpcPanel({
  accounts,
  suppliers,
  projects,
  contracts,
  boqItems,
  theme,
  language,
  dir,
  canCreate,
  canApprove,
  refreshKey,
  initialOpenId = null,
  onInitialOpenConsumed,
  onRefresh,
  onCoaChanged,
}: Props) {
  const { t, formatMoney } = useLanguage();
  const isAr = language === 'ar';
  const [companyInfo, setCompanyInfo] = useState<CompanyPrintInfo & { reportPrintProfiles?: StoredReportPrintProfiles }>({
    companyName: '',
    companyNameEn: '',
    headerLogo: DEFAULT_HEADER_LOGO,
  });
  const { openDocPreview, ReportPreviewHost } = useReportDocumentPreview({
    language: language === 'en' ? 'en' : 'ar',
    t,
    formatMoney,
    companyInfo,
  });

  useEffect(() => {
    const loadCompany = async () => {
      try {
        if (isLocalBackend) {
          const res = await settingsApi.getCompanyInfo();
          if (res.value) setCompanyInfo((prev) => ({ ...prev, ...res.value }));
          return;
        }
        const snap = await getDoc(doc(db, 'settings', 'company_info'));
        if (snap.exists()) setCompanyInfo((prev) => ({ ...prev, ...(snap.data() as CompanyPrintInfo) }));
      } catch {
        /* keep defaults */
      }
    };
    void loadCompany();
  }, []);

  const [list, setList] = useState<ServiceTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterProjectId, setFilterProjectId] = useState('');
  const [filterContractId, setFilterContractId] = useState('');
  const [statusFilter, setStatusFilter] = useState<CostsPurchaseStatusFilter>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [saveMode, setSaveMode] = useState<'draft' | 'submit' | 'approve'>('submit');
  const [saving, setSaving] = useState(false);
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [preview, setPreview] = useState<{ entries: ReturnType<typeof buildServiceIpcEntries>; description: string } | null>(null);
  const previewConfirmed = useRef(false);
  const gridRefs = useRef<(HTMLInputElement | null)[][]>([]);

  const [header, setHeader] = useState({
    supplierAccountId: '',
    serviceKind: 'labour' as ServiceIpcKind,
    date: businessTodayYmd(),
    referenceNumber: '',
    description: '',
    vatPct: BILLING_DEFAULTS.VAT_PCT,
    execGuaranteePct: BILLING_DEFAULTS.EXEC_GUARANTEE_PCT,
    whtPct: BILLING_DEFAULTS.WHT_PCT,
    labourInsurancePct: BILLING_DEFAULTS.LABOUR_INSURANCE_PCT,
    manpowerLevyPct: BILLING_DEFAULTS.MANPOWER_LEVY_PCT,
    advancePaymentRecovery: 0,
  });
  const [lines, setLines] = useState<(ServiceIpcLine & { id: string })[]>([makeLine()]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = (await purchaseTransactionsApi.list()) as ServiceTx[];
      setList(rows.filter((r) => r.type === SERVICE_IPC_TYPE && !(r as { isDeleted?: boolean }).isDeleted));
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const creditorOptions = useMemo(() => {
    const byId = new Map(suppliers.map((s) => [s.id, s as Supplier & { serviceKind?: string }]));
    return accounts
      .filter((a) => {
        if (a.isGroup || a.status === 'disabled') return false;
        const code = String(a.accountCode || '');
        if (code === '21102001') return false;
        if (!code.startsWith('21102') && String(a.parentCode || '') !== '21102') return false;
        const sup = a.supplierId ? byId.get(String(a.supplierId)) : undefined;
        return isServiceContractor(sup);
      })
      .sort((x, y) => String(x.accountCode).localeCompare(String(y.accountCode), undefined, { numeric: true }))
      .map((a) => ({
        value: a.id as string,
        label: language === 'ar' ? a.accountName : (a.accountNameEn || a.accountName),
        secondary: a.accountCode as string,
      }));
  }, [accounts, suppliers, language]);

  const nextSupplierCode = useMemo(() => {
    const codes = accounts
      .filter((a) => String(a.parentCode) === '21102' && /^\d{8}$/.test(String(a.accountCode)))
      .map((a) => Number(a.accountCode));
    const max = codes.length ? Math.max(...codes) : 21102001;
    return String(Math.max(max + 1, 21102002));
  }, [accounts]);

  const selectedCoa = accounts.find((a) => a.id === header.supplierAccountId);
  const selectedSupplier = selectedCoa?.supplierId
    ? (suppliers.find((s) => s.id === selectedCoa.supplierId) as (Supplier & { serviceKind?: string }) | undefined)
    : undefined;

  useEffect(() => {
    const kind = selectedSupplier?.serviceKind;
    if (isServiceIpcKind(kind)) setHeader((h) => (h.serviceKind === kind ? h : { ...h, serviceKind: kind }));
  }, [selectedSupplier?.serviceKind]);

  const approvedItemsForPrev = useMemo(() => {
    const accId = header.supplierAccountId;
    if (!accId) return [];
    return list
      .filter((tx) => posted(tx) && tx.supplierAccountId === accId && tx.id !== editingId)
      .flatMap((tx) => tx.items ?? []);
  }, [list, header.supplierAccountId, editingId]);

  const fillPrevious = useCallback((line: ServiceIpcLine & { id: string }) => {
    const prev = previousQtyFromApproved(approvedItemsForPrev, line);
    return { ...line, previousQty: prev };
  }, [approvedItemsForPrev]);

  // Auto-populate lines from the latest approved IPC when supplier is selected on a NEW form.
  // Fills description/unit/rate/contract/chapter and computes previousQty so the summary
  // shows correct الأعمال السابقة and المسدد without any manual re-entry.
  useEffect(() => {
    if (editingId) return; // editing an existing document — keep its own lines
    if (!header.supplierAccountId) return;

    const approvedForSupplier = list
      .filter((tx) => posted(tx) && tx.supplierAccountId === header.supplierAccountId)
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    if (approvedForSupplier.length === 0) return;

    const latestTx = approvedForSupplier[0];
    const latestItems = latestTx.items ?? [];
    if (latestItems.length === 0) return;

    const allApprovedItems = approvedForSupplier.flatMap((tx) => tx.items ?? []);

    setLines((prev) => {
      // Only auto-fill while lines are still at the initial blank state
      const isBlank =
        prev.length === 1 &&
        !prev[0].contractId &&
        !prev[0].description &&
        prev[0].rate === 0 &&
        prev[0].currentQty === 0;
      if (!isBlank) return prev;

      const newLines = latestItems.map((item, i) => ({
        ...makeLine(),
        id: `sl-auto-${Date.now()}-${i}`,
        contractId: String(item.contractId || ''),
        projectId: String(item.projectId || ''),
        chapterCode: String(item.chapterCode || ''),
        chapterName: String(item.chapterName || ''),
        description: String(item.description || ''),
        unit: String(item.unit || 'يوم'),
        rate: Number(item.rate) || 0,
        previousQty: previousQtyFromApproved(allApprovedItems, item),
        currentQty: 0,
      }));
      return newLines.length > 0 ? newLines : prev;
    });

    // Copy percentages from last approved IPC so the summary الأعمال السابقة / المسدد is accurate
    const totalBase = Number(latestTx.amount) || 0;
    setHeader((h) => ({
      ...h,
      vatPct: resolveStoredPct(latestTx.vatPct, latestTx.vatAmount, totalBase),
      execGuaranteePct: resolveStoredPct(latestTx.execGuaranteePct, latestTx.execGuaranteeAmount, totalBase),
      whtPct: resolveStoredPct(latestTx.whtPct, latestTx.whtAmount, totalBase),
      labourInsurancePct: resolveStoredPct(latestTx.labourInsurancePct, latestTx.labourInsuranceAmount, totalBase),
      manpowerLevyPct: resolveStoredPct(latestTx.manpowerLevyPct, latestTx.manpowerLevyAmount, totalBase),
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [header.supplierAccountId, editingId, list]);

  // Stable key of sorted unique contractIds from current lines — used as an effect dep
  const lineContractIdsKey = useMemo(
    () => [...new Set(lines.map((l) => l.contractId).filter(Boolean))].sort().join(','),
    [lines],
  );

  // المسدد = Dr نقدي على حساب المقاول مصدره بنك 12101 أو صندوق/عهدة 12102 لنفس مراكز التكلفة
  const [paidToDate, setPaidToDate] = useState(0);
  useEffect(() => {
    if (!isLocalBackend || !header.supplierAccountId) { setPaidToDate(0); return; }
    const code = resolveContractorAccountCode(accounts, header.supplierAccountId);
    const contractIds = lineContractIdsKey.split(',').filter(Boolean);
    if (!code || contractIds.length === 0) { setPaidToDate(0); return; }
    let cancelled = false;
    glApi.transactionsQuery({ accountFrom: code, accountTo: code, limit: 3000 })
      .then((txs) => {
        if (cancelled) return;
        setPaidToDate(sumContractorCashPaymentsFromGl(txs, code, contractIds));
      })
      .catch(() => { if (!cancelled) setPaidToDate(0); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [header.supplierAccountId, lineContractIdsKey, accounts]);

  const summary = useMemo(
    () =>
      computeServiceIpcCertificateSummary(
        lines,
        {
          vatPct: header.vatPct,
          execGuaranteePct: header.execGuaranteePct,
          whtPct: header.whtPct,
          labourInsurancePct: header.labourInsurancePct,
          manpowerLevyPct: header.manpowerLevyPct,
        },
        header.advancePaymentRecovery,
        paidToDate,
      ),
    [lines, header, paidToDate],
  );
  const worksValue = summary.currentWorks;
  const vat = summary.vatPeriod;
  const exec = summary.execGuaranteePeriod;
  const wht = summary.whtPeriod;
  const insurance = summary.labourInsurancePeriod;
  const levy = summary.manpowerLevyPeriod;
  const advance = summary.advancePaymentRecovery;
  const net = summary.amountDue;

  const counts = useMemo(() => {
    const draft = list.filter((t) => t.status === 'draft' && !posted(t)).length;
    const submitted = list.filter((t) => t.status === 'submitted' && !posted(t)).length;
    const approved = list.filter((t) => posted(t)).length;
    return { all: list.length, draft, submitted, approved, pending: 0, posted: 0, paid: 0 };
  }, [list]);

  const filtered = useMemo(() => {
    let rows = list;
    if (filterProjectId) {
      rows = rows.filter((tx) =>
        tx.projectId === filterProjectId
        || (tx.items ?? []).some((i) => i.projectId === filterProjectId)
        || contracts.filter((c) => c.projectId === filterProjectId).some((c) =>
          tx.contractId === c.id || (tx.items ?? []).some((i) => i.contractId === c.id)),
      );
    }
    if (filterContractId) {
      rows = rows.filter((tx) =>
        tx.contractId === filterContractId || (tx.items ?? []).some((i) => i.contractId === filterContractId),
      );
    }
    if (statusFilter === 'draft') rows = rows.filter((t) => t.status === 'draft' && !posted(t));
    if (statusFilter === 'submitted') rows = rows.filter((t) => t.status === 'submitted' && !posted(t));
    if (statusFilter === 'approved') rows = rows.filter((t) => posted(t));
    const q = searchTerm.trim().toLowerCase();
    if (q) {
      rows = rows.filter((tx) =>
        String(tx.referenceNumber || '').toLowerCase().includes(q)
        || String(tx.supplierName || '').toLowerCase().includes(q),
      );
    }
    return rows;
  }, [list, filterProjectId, filterContractId, statusFilter, searchTerm, contracts]);

  const selected = filtered.find((t) => t.id === selectedId) ?? list.find((t) => t.id === selectedId);

  const resetForm = () => {
    setEditingId(null);
    previewConfirmed.current = false;
    setPreview(null);
    setShowDeleteConfirm(false);
    setHeader({
      supplierAccountId: '',
      serviceKind: 'labour',
      date: businessTodayYmd(),
      referenceNumber: '',
      description: '',
      vatPct: BILLING_DEFAULTS.VAT_PCT,
      execGuaranteePct: BILLING_DEFAULTS.EXEC_GUARANTEE_PCT,
      whtPct: BILLING_DEFAULTS.WHT_PCT,
      labourInsurancePct: BILLING_DEFAULTS.LABOUR_INSURANCE_PCT,
      manpowerLevyPct: BILLING_DEFAULTS.MANPOWER_LEVY_PCT,
      advancePaymentRecovery: 0,
    });
    setLines([makeLine()]);
  };

  const openExisting = (tx: ServiceTx, mode: 'draft' | 'submit' | 'approve' = 'submit') => {
    setEditingId(tx.id);
    setSaveMode(mode);
    previewConfirmed.current = false;
    const base = Number(tx.amount) || 0;
    setHeader({
      supplierAccountId: tx.supplierAccountId || '',
      serviceKind: isServiceIpcKind(tx.serviceKind) ? tx.serviceKind : 'labour',
      date: tx.date || businessTodayYmd(),
      referenceNumber: tx.referenceNumber || '',
      description: tx.description || '',
      vatPct: resolveStoredPct(tx.vatPct, tx.vatAmount, base),
      execGuaranteePct: resolveStoredPct(tx.execGuaranteePct, tx.execGuaranteeAmount, base),
      whtPct: resolveStoredPct(tx.whtPct, tx.whtAmount, base),
      labourInsurancePct: resolveStoredPct(tx.labourInsurancePct, tx.labourInsuranceAmount, base),
      manpowerLevyPct: resolveStoredPct(tx.manpowerLevyPct, tx.manpowerLevyAmount, base),
      advancePaymentRecovery: Number(tx.advancePaymentRecovery) || 0,
    });
    const mapped = (tx.items ?? []).map((l, i) => ({
      ...makeLine(),
      ...l,
      id: l.id || `sl-${i}`,
    }));
    setLines(mapped.length ? mapped : [makeLine()]);
    setShowModal(true);
  };

  const deepLinkOpenedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialOpenId || list.length === 0) return;
    const row = list.find((t) => t.id === initialOpenId);
    if (!row) return;
    setSelectedId(initialOpenId);
    if (deepLinkOpenedRef.current === initialOpenId) return;
    deepLinkOpenedRef.current = initialOpenId;
    openExisting(row, row.status === 'submitted' && !posted(row) && canApprove ? 'approve' : 'submit');
    onInitialOpenConsumed?.();
  }, [initialOpenId, list, canApprove, onInitialOpenConsumed]);

  const editingTx = list.find((t) => t.id === editingId);
  const readOnly = Boolean(editingTx && posted(editingTx));

  const handleSaveSupplier = async (data: NewSupplierFields) => {
    if (!data.nameEn.trim()) {
      toast.error(t('toast_english_name_required'));
      return;
    }
    const kind = isServiceIpcKind(data.serviceKind) ? data.serviceKind : 'labour';
    try {
      const supplier = await suppliersApi.create({
        name: data.name || data.nameEn,
        nameEn: data.nameEn,
        type: 'subcontractor',
        serviceKind: kind,
        taxNumber: data.taxNumber,
        phone: data.phone,
        address: data.address,
        isDeleted: false,
      } as unknown as Supplier) as { id: string };
      const account = await chartOfAccountsApi.create({
        accountName: data.name || data.nameEn,
        accountNameEn: data.nameEn,
        accountCode: nextSupplierCode,
        parentCode: '21102',
        type: 'liability',
        isGroup: false,
        status: 'active',
        supplierId: supplier.id,
      }) as { id: string };
      invalidateCoaCache();
      onCoaChanged();
      setHeader((h) => ({ ...h, supplierAccountId: account.id, serviceKind: kind }));
      setShowSupplierModal(false);
    } catch {
      toast.error(t('toast_save_failed'));
    }
  };

  const persist = async (mode: 'draft' | 'submit' | 'approve') => {
    if (!selectedCoa) {
      toast.error(t('select_supplier'));
      return;
    }
    const activeLines = lines.filter((l) => periodLineAmount(l) > 0 || Number(l.currentQty) > 0);
    const missingCc = activeLines.find((l) => !String(l.contractId).trim());
    if (mode !== 'draft' && (activeLines.length === 0 || missingCc)) {
      toast.error(t('service_ipc_need_cost_center'));
      return;
    }
    const supplierName =
      (language === 'ar' ? selectedCoa.accountName : (selectedCoa.accountNameEn || selectedCoa.accountName)) || '';

    if (mode === 'approve' && !previewConfirmed.current) {
      const entries = buildServiceIpcEntries({
        serviceKind: header.serviceKind,
        supplierName,
        supplierAccountCode: selectedCoa.accountCode,
        lines,
        vatAmount: vat,
        execGuarantee: exec,
        whtAmount: wht,
        labourInsurance: insurance,
        manpowerLevy: levy,
        advancePaymentRecovery: advance,
      });
      setPreview({ entries, description: header.description || `${t('service_ipc_entry')} - ${supplierName}` });
      return;
    }

    const uniqueContracts = [...new Set(lines.map((l) => l.contractId).filter(Boolean))];
    const uniqueProjects = [...new Set(lines.map((l) => l.projectId).filter(Boolean))];
    const status = mode === 'draft' ? 'draft' : mode === 'approve' ? 'submitted' : 'submitted';

    setSaving(true);
    try {
      if (isLocalBackend) {
        for (const cid of uniqueContracts) {
          const c = contracts.find((x) => x.id === cid);
          const pid = String(c?.projectId || '');
          if (pid) {
            const p = projects.find((x) => x.id === pid);
            await ensureLocalProjectExists(pid, {
              projectName: p?.projectName,
              projectCode: p?.projectCode,
              clientName: p?.clientName,
              budget: p?.budget,
            });
            await ensureLocalContractExists(cid, pid, {
              projectId: pid,
              contractName: c?.contractName,
              contractNumber: c?.contractNumber,
            });
          }
        }
      }
      const body = {
        type: SERVICE_IPC_TYPE,
        supplierId: selectedCoa.supplierId || null,
        supplierAccountId: selectedCoa.id,
        supplierName,
        projectId: uniqueProjects.length === 1 ? uniqueProjects[0] : null,
        contractId: uniqueContracts.length === 1 ? uniqueContracts[0] : null,
        date: header.date,
        referenceNumber: header.referenceNumber,
        amount: worksValue,
        vatAmount: vat,
        whtAmount: wht,
        execGuaranteeAmount: exec,
        labourInsuranceAmount: insurance,
        manpowerLevyAmount: levy,
        advancePaymentRecovery: advance,
        totalAmount: net,
        description: header.description,
        status,
        serviceKind: header.serviceKind,
        vatPct: header.vatPct,
        execGuaranteePct: header.execGuaranteePct,
        whtPct: header.whtPct,
        labourInsurancePct: header.labourInsurancePct,
        manpowerLevyPct: header.manpowerLevyPct,
        items: lines.map((l) => ({
          contractId: l.contractId,
          projectId: l.projectId || undefined,
          chapterCode: l.chapterCode || undefined,
          chapterName: l.chapterName || undefined,
          description: l.description,
          unit: l.unit,
          rate: l.rate,
          previousQty: l.previousQty,
          currentQty: l.currentQty,
        })),
      };
      let id = editingId;
      if (editingId) await purchaseTransactionsApi.update(editingId, body);
      else {
        const created = await purchaseTransactionsApi.create(body) as { id: string };
        id = created.id;
        setEditingId(id);
      }
      if (mode === 'approve' && id) {
        await purchaseTransactionsApi.approve(id);
      }
      toast.success(t('service_ipc_saved'));
      setShowModal(false);
      resetForm();
      onRefresh();
      await load();
    } catch (err) {
      if (err instanceof NetworkQueuedError) {
        toast(err.message);
        setShowModal(false);
        return;
      }
      const msg = err instanceof ApiError ? err.message : t('toast_save_failed');
      toast.error(msg);
    } finally {
      setSaving(false);
      previewConfirmed.current = false;
    }
  };

  const handleDeleteDraft = async () => {
    if (!editingId) return;
    try {
      await purchaseTransactionsApi.remove(editingId);
      toast.success(language === 'ar' ? 'تم حذف المستخلص' : 'Certificate deleted');
      setShowModal(false);
      setShowDeleteConfirm(false);
      resetForm();
      onRefresh();
      await load();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (language === 'ar' ? 'فشل الحذف' : 'Delete failed');
      toast.error(msg);
      setShowDeleteConfirm(false);
    }
  };

  const cardCls = cn(
    'rounded-xl border p-4',
    theme === 'dark' ? 'border-gray-800 bg-gray-900/40' : 'border-gray-200 bg-white',
  );
  const inputCls = cn(
    'w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500',
    theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200',
  );
  const labelCls = cn('block text-xs font-bold mb-1.5', theme === 'dark' ? 'text-gray-400' : 'text-gray-500');
  const selectCls = cn(
    'w-full rounded-lg border px-3 py-2 text-sm font-bold outline-none focus:border-blue-500',
    theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-300',
  );
  const sectionTitleCls = 'text-xs font-bold uppercase tracking-wide text-gray-500';
  const colCount = 8;

  const kindLabel = (k: string) => {
    if (k === 'labour') return t('service_kind_labour');
    if (k === 'equipment') return t('service_kind_equipment');
    if (k === 'vehicles') return t('service_kind_vehicles');
    if (k === 'housing') return t('service_kind_housing');
    return k;
  };

  const buildPrintPayload = useCallback(
    (tx: ServiceTx): ServiceIpcPrintData => {
      const items = tx.items ?? [];
      const periodWorks = roundMoney(Number(tx.amount) || items.reduce((s, l) => s + periodLineAmount(l), 0));
      const cert = computeServiceIpcCertificateSummary(
        items,
        {
          vatPct: resolveStoredPct(tx.vatPct, tx.vatAmount, periodWorks),
          execGuaranteePct: resolveStoredPct(tx.execGuaranteePct, tx.execGuaranteeAmount, periodWorks),
          whtPct: resolveStoredPct(tx.whtPct, tx.whtAmount, periodWorks),
          labourInsurancePct: resolveStoredPct(tx.labourInsurancePct, tx.labourInsuranceAmount, periodWorks),
          manpowerLevyPct: resolveStoredPct(tx.manpowerLevyPct, tx.manpowerLevyAmount, periodWorks),
        },
        Number(tx.advancePaymentRecovery) || 0,
        Number(tx._actualPreviousPayments) || 0,
      );
      const worksValue = cert.currentWorks || periodWorks;
      const vatAmount = cert.vatToDate;
      const exec = cert.execGuaranteeToDate;
      const wht = cert.whtToDate;
      const insurance = cert.labourInsuranceToDate;
      const levy = cert.manpowerLevyToDate;
      const advance = cert.advancePaymentRecovery;
      const netPayable = cert.amountDue;
      const projectIds = [
        ...new Set(
          items.map((l) => String(l.projectId || '').trim()).filter(Boolean)
            .concat(tx.projectId ? [String(tx.projectId)] : []),
        ),
      ];
      const projectName =
        projectIds.length === 1
          ? projects.find((p) => p.id === projectIds[0])?.projectName
          : undefined;

      return {
        documentNumber: displayServiceIpcNumber(tx.referenceNumber) || '—',
        dateLabel: tx.date || '—',
        statusLabel: workflowStatusLabel(tx, isAr),
        serviceKindLabel: kindLabel(String(tx.serviceKind || '')),
        contractorName: tx.supplierName || '—',
        projectName,
        lines: items.map((l) => {
          const c = contracts.find((x) => x.id === l.contractId);
          const chapter =
            l.chapterCode || l.chapterName
              ? [l.chapterCode, l.chapterName].filter(Boolean).join(' — ')
              : '';
          return {
            contractLabel: c
              ? `${c.contractName} (${c.contractNumber})`
              : (l.contractId || '—'),
            chapterLabel: chapter || undefined,
            description: l.description || '',
            unit: l.unit || '',
            rate: Number(l.rate) || 0,
            previousQty: Number(l.previousQty) || 0,
            currentQty: Number(l.currentQty) || 0,
            netQty: netQty(Number(l.previousQty) || 0, Number(l.currentQty) || 0),
            periodAmount: roundMoney(periodLineAmount(l)),
          };
        }),
        worksValueExVat: worksValue,
        vatAmount,
        execGuaranteeAmount: exec,
        whtAmount: wht,
        labourInsuranceAmount: insurance,
        manpowerLevyAmount: levy,
        advancePaymentRecovery: advance,
        netPayable,
        previousWorksExVat: cert.previousWorks,
        totalWorksExVat: cert.totalWorks,
        vatToDate: cert.vatToDate,
        execGuaranteeToDate: cert.execGuaranteeToDate,
        labourInsuranceToDate: cert.labourInsuranceToDate,
        whtToDate: cert.whtToDate,
        manpowerLevyToDate: cert.manpowerLevyToDate,
        netAfterDeductions: cert.netAfterDeductions,
        previousPayments: cert.previousPayments,
      };
    },
    [contracts, projects, isAr, t],
  );

  const handlePrint = useCallback(
    async (tx: ServiceTx) => {
      let paid = tx._actualPreviousPayments;
      if (paid == null && isLocalBackend) {
        const code = resolveContractorAccountCode(accounts, String(tx.supplierAccountId || tx.supplierId || ''));
        const ccIds = [...new Set((tx.items ?? []).map((l) => String(l.contractId || '').trim()).filter(Boolean))];
        if (code && ccIds.length > 0) {
          try {
            const txs = await glApi.transactionsQuery({ accountFrom: code, accountTo: code, limit: 3000 });
            paid = sumContractorCashPaymentsFromGl(txs, code, ccIds);
          } catch {
            paid = 0;
          }
        } else {
          paid = 0;
        }
      }
      const data = buildPrintPayload({ ...tx, _actualPreviousPayments: Number(paid) || 0 });
      const sections = buildServiceIpcCertificateSections(data, language === 'en' ? 'en' : 'ar', formatMoney);
      openDocPreview({
        reportId: 'service_ipc',
        title: serviceIpcPrintTitle({
          contractorName: data.contractorName,
          documentNumber: data.documentNumber,
          statusLabel: data.statusLabel,
          language: isAr ? 'ar' : 'en',
        }),
        columns: [],
        rows: [],
        sections,
        filename: `ipc-${data.documentNumber}`,
        dateLabel: new Date().toLocaleDateString(displayLocale(language === 'en' ? 'en' : 'ar')),
        scopeLabel: data.contractorName,
        layoutOverrides: {
          showLogo: true,
          headerShowCompany: true,
        },
      });
    },
    [buildPrintPayload, formatMoney, language, isAr, openDocPreview, accounts],
  );

  /** Print from open form (draft in progress or saved). */
  const handlePrintForm = useCallback(() => {
    const supplierName =
      selectedCoa
        ? (language === 'ar' ? selectedCoa.accountName : (selectedCoa.accountNameEn || selectedCoa.accountName))
        : header.supplierAccountId;
    const formTx: ServiceTx = {
      id: editingId || 'draft',
      referenceNumber: header.referenceNumber || (isAr ? 'مسودة' : 'DRAFT'),
      date: header.date,
      status: editingTx?.status || 'draft',
      transactionId: editingTx?.transactionId,
      supplierName: String(supplierName || ''),
      serviceKind: header.serviceKind,
      amount: worksValue,
      vatAmount: vat,
      execGuaranteeAmount: exec,
      whtAmount: wht,
      labourInsuranceAmount: insurance,
      manpowerLevyAmount: levy,
      advancePaymentRecovery: advance,
      totalAmount: net,
      vatPct: header.vatPct,
      execGuaranteePct: header.execGuaranteePct,
      whtPct: header.whtPct,
      labourInsurancePct: header.labourInsurancePct,
      manpowerLevyPct: header.manpowerLevyPct,
      items: lines,
      // Pass GL-sourced actual payments so the print shows المسدد correctly
      _actualPreviousPayments: paidToDate,
    };
    void handlePrint(formTx);
  }, [
    selectedCoa, language, header, editingId, editingTx, worksValue, vat, exec, wht,
    insurance, levy, advance, net, lines, isAr, handlePrint, paidToDate,
  ]);

  return (
    <div className={cn('flex flex-col md:flex-row md:items-start gap-4', dir === 'rtl' ? 'md:flex-row-reverse' : '')}>
      <div className="flex-1 min-w-0 md:flex-[3] space-y-4 order-2 md:order-none">
        <div className="flex items-center gap-2">
          <ManualHelpButton topicId="costs.ipc.service" />
        </div>
        {loading ? (
          <div className={cn('border rounded-xl p-12 text-center text-gray-500 flex flex-col items-center gap-4', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
            <Loader2 className="animate-spin text-blue-500" size={32} />
          </div>
        ) : !selected ? (
          <div className={cn('border rounded-xl p-12 text-center', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
            <p className="text-sm text-gray-500">{t('costs_filter_select_record')}</p>
          </div>
        ) : (
          <div className={cn(cardCls, 'p-6 space-y-3')}>
            <div className="flex justify-between gap-3">
              <div>
                <h3 className="font-bold text-lg">
                  {serviceIpcPrintTitle({
                    contractorName: selected.supplierName,
                    documentNumber: displayServiceIpcNumber(selected.referenceNumber),
                    language: isAr ? 'ar' : 'en',
                  })}
                </h3>
                <p className="text-xs text-gray-500">{kindLabel(String(selected.serviceKind || ''))} · {selected.date}</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold bg-teal-700 text-white"
                  onClick={() => void handlePrint(selected)}
                >
                  <Printer size={14} />
                  {t('report_print_action')}
                </button>
                <button type="button" className="px-3 py-1.5 rounded-lg text-sm font-bold bg-gray-700 text-white" onClick={() => openExisting(selected)}>
                  {posted(selected) ? t('view') : t('edit')}
                </button>
                {canApprove && selected.status === 'submitted' && !posted(selected) && (
                  <button type="button" className="px-3 py-1.5 rounded-lg text-sm font-bold bg-blue-600 text-white" onClick={() => openExisting(selected, 'approve')}>
                    {t('approve')}
                  </button>
                )}
              </div>
            </div>
            <p className="text-xs text-gray-500">{workflowStatusLabel(selected, isAr)}</p>
            <p className="text-sm">{formatMoney(Number(selected.totalAmount || 0))}</p>
          </div>
        )}
      </div>

      <CostsPurchaseSidebar
        theme={theme}
        language={language}
        dir={dir}
        activeTab="service_ipc"
        cardCls={cardCls}
        labelCls={labelCls}
        selectCls={selectCls}
        sectionTitleCls={sectionTitleCls}
        canCreate={canCreate}
        loading={loading}
        filterProjectId={filterProjectId}
        filterContractId={filterContractId}
        purchaseStatusFilter={statusFilter}
        searchTerm={searchTerm}
        projects={projects}
        contracts={filterProjectId ? contracts.filter((c) => c.projectId === filterProjectId) : contracts}
        purchaseStatusCounts={counts}
        list={filtered as CostsSidebarPurchaseRow[]}
        selectedPurchaseId={selectedId}
        statusLabel={(tx) => {
          const row = tx as ServiceTx;
          if (posted(row)) return isAr ? 'معتمد' : 'Approved';
          if (row.status === 'submitted') return isAr ? 'بانتظار الاعتماد' : 'Awaiting approval';
          if (row.status === 'draft') return isAr ? 'مسودة' : 'Draft';
          return row.status || '';
        }}
        paymentTypeOf={() => null}
        t={t}
        onFilterProject={setFilterProjectId}
        onFilterContract={setFilterContractId}
        onStatusFilter={setStatusFilter}
        onSearch={setSearchTerm}
        onSelect={(tx) => setSelectedId(tx.id)}
        onNew={() => { resetForm(); setShowModal(true); }}
      />

      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className={cn(
                'w-full max-w-[min(96vw,72rem)] max-h-[90vh] overflow-hidden flex flex-col border rounded-2xl shadow-2xl',
                theme === 'dark' ? 'bg-[#151619] border-gray-800' : 'bg-white border-gray-200',
              )}
            >
              <div className={cn('p-4 border-b flex justify-between items-center', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <FileText className="text-blue-500" size={22} />
                  {t('service_ipc_entry')}
                  <ManualHelpButton topicId="costs.ipc.service" />
                </h3>
                <button type="button" className="text-gray-500" onClick={() => { setShowModal(false); resetForm(); }}>×</button>
              </div>
              <div className="p-4 overflow-y-auto space-y-4 flex-1">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="md:col-span-2">
                    <label className={labelCls}>{t('supplier')}</label>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <SearchableSelect
                          options={creditorOptions}
                          value={header.supplierAccountId}
                          onChange={(v) => setHeader((h) => ({ ...h, supplierAccountId: v }))}
                          theme={theme}
                          dir={dir}
                        />
                      </div>
                      {canCreate && (
                        <button type="button" className="px-2 rounded-lg bg-blue-600 text-white" onClick={() => setShowSupplierModal(true)} title={t('add')}>
                          <Plus size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>{t('service_kind')}</label>
                    <select
                      className={selectCls}
                      value={header.serviceKind}
                      disabled={readOnly}
                      onChange={(e) => setHeader((h) => ({ ...h, serviceKind: e.target.value as ServiceIpcKind }))}
                    >
                      {SERVICE_IPC_KINDS.map((k) => (
                        <option key={k} value={k}>{kindLabel(k)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>{t('date')}</label>
                    <input type="date" className={inputCls} value={header.date} disabled={readOnly} onChange={(e) => setHeader((h) => ({ ...h, date: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelCls}>{t('reference')}</label>
                    <input
                      className={inputCls}
                      value={header.referenceNumber}
                      placeholder={t('service_ipc_ref_auto')}
                      disabled={readOnly}
                      onChange={(e) => setHeader((h) => ({ ...h, referenceNumber: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[56rem]">
                    <thead>
                      <tr className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>
                        <th className="p-1 text-start">{t('cost_center')}</th>
                        <th className="p-1 text-start">{t('service_ipc_chapter')}</th>
                        <th className="p-1 text-start">{t('description')}</th>
                        <th className="p-1">{t('unit')}</th>
                        <th className="p-1">{t('rate')}</th>
                        <th className="p-1">{t('service_ipc_prev')}</th>
                        <th className="p-1">{t('service_ipc_curr')}</th>
                        <th className="p-1">{t('service_ipc_net')}</th>
                        <th className="p-1 w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line, idx) => {
                        const chapters = uniqueBoqChapters(boqItems, line.contractId);
                        return (
                          <tr key={listKey(line.id, idx, 'sl')}>
                            <td className="p-1 min-w-[10rem]">
                              <select
                                className={selectCls}
                                disabled={readOnly}
                                value={line.contractId}
                                onChange={(e) => {
                                  const c = contracts.find((x) => x.id === e.target.value);
                                  setLines((rows) => rows.map((r, i) => i === idx
                                    ? fillPrevious({ ...r, contractId: e.target.value, projectId: c?.projectId || '', chapterCode: '', chapterName: '' })
                                    : r));
                                }}
                              >
                                <option value="">—</option>
                                {contracts.map((c) => (
                                  <option key={c.id} value={c.id}>{c.contractName} ({c.contractNumber})</option>
                                ))}
                              </select>
                            </td>
                            <td className="p-1 min-w-[8rem]">
                              <select
                                className={selectCls}
                                disabled={readOnly || !line.contractId}
                                value={line.chapterCode || ''}
                                onChange={(e) => {
                                  const ch = chapters.find((x) => x.code === e.target.value);
                                  setLines((rows) => rows.map((r, i) => i === idx
                                    ? fillPrevious({ ...r, chapterCode: e.target.value, chapterName: ch?.name || '' })
                                    : r));
                                }}
                              >
                                <option value="">{t('service_ipc_chapter_none')}</option>
                                {chapters.map((ch) => (
                                  <option key={ch.code} value={ch.code}>{ch.code} — {ch.name}</option>
                                ))}
                              </select>
                            </td>
                            <td className="p-1">
                              <input
                                className={inputCls}
                                disabled={readOnly}
                                value={line.description}
                                onChange={(e) => setLines((rows) => rows.map((r, i) => i === idx
                                  ? fillPrevious({ ...r, description: e.target.value })
                                  : r))}
                              />
                            </td>
                            <td className="p-1 w-20">
                              <input className={inputCls} disabled={readOnly} value={line.unit} onChange={(e) => setLines((rows) => rows.map((r, i) => i === idx ? { ...r, unit: e.target.value } : r))} />
                            </td>
                            <td className="p-1 w-24">
                              <SpreadsheetCellInput
                                type="number"
                                step="0.01"
                                row={idx}
                                col={0}
                                rowCount={lines.length}
                                colCount={colCount}
                                gridRefs={gridRefs}
                                variant="rate"
                                theme={theme}
                                disabled={readOnly}
                                value={line.rate || ''}
                                onChange={(e) => setLines((rows) => rows.map((r, i) => i === idx ? { ...r, rate: Number(e.target.value) || 0 } : r))}
                              />
                            </td>
                            <td className="p-1 w-20 text-center tabular-nums">{roundMoney2(line.previousQty)}</td>
                            <td className="p-1 w-24">
                              <SpreadsheetCellInput
                                type="number"
                                step="0.01"
                                row={idx}
                                col={1}
                                rowCount={lines.length}
                                colCount={colCount}
                                gridRefs={gridRefs}
                                variant="qty"
                                theme={theme}
                                disabled={readOnly}
                                value={line.currentQty || ''}
                                onChange={(e) => setLines((rows) => rows.map((r, i) => i === idx ? { ...r, currentQty: Number(e.target.value) || 0 } : r))}
                              />
                            </td>
                            <td className="p-1 w-24 text-center tabular-nums">{roundMoney2(netQty(line.previousQty, line.currentQty))}</td>
                            <td className="p-1">
                              {!readOnly && (
                                <button type="button" className="text-red-500" onClick={() => setLines((rows) => rows.length <= 1 ? [makeLine()] : rows.filter((_, i) => i !== idx))}>
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {!readOnly && (
                    <button type="button" className="mt-2 text-sm font-bold text-blue-500" onClick={() => setLines((rows) => [...rows, makeLine()])}>
                      + {t('add_line')}
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  {([
                    ['vatPct', t('vat')],
                    ['execGuaranteePct', t('retention')],
                    ['whtPct', t('wht')],
                    ['labourInsurancePct', t('insurance')],
                    ['manpowerLevyPct', t('manpower_levy')],
                  ] as const).map(([key, label]) => (
                    <label key={key} className="text-xs">
                      {label} %
                      <input
                        type="number"
                        step="0.01"
                        className={inputCls}
                        disabled={readOnly}
                        value={header[key]}
                        onChange={(e) => setHeader((h) => ({ ...h, [key]: Number(e.target.value) || 0 }))}
                      />
                    </label>
                  ))}
                </div>
                <label className="text-xs block max-w-xs">
                  {t('service_ipc_advance')}
                  <input
                    type="number"
                    step="0.01"
                    className={inputCls}
                    disabled={readOnly}
                    value={header.advancePaymentRecovery}
                    onChange={(e) => setHeader((h) => ({ ...h, advancePaymentRecovery: Number(e.target.value) || 0 }))}
                  />
                </label>
                <div className={cn('w-[40%] max-w-[40%] ms-auto rounded-lg border text-[11px] leading-tight divide-y', theme === 'dark' ? 'border-gray-800 divide-gray-800' : 'border-gray-200 divide-gray-100')}>
                  {([
                    { key: 'service_ipc_prev_works', value: summary.previousWorks },
                    { key: 'service_ipc_curr_works', value: summary.currentWorks },
                    { key: 'service_ipc_total_works', value: summary.totalWorks, strong: true },
                    { key: 'service_ipc_total_vat', value: summary.vatToDate },
                    { key: 'service_ipc_retention_works', value: summary.execGuaranteeToDate },
                    { key: 'service_ipc_retention_insurance', value: summary.labourInsuranceToDate },
                    ...(summary.whtToDate > 0 ? [{ key: 'service_ipc_wht', value: summary.whtToDate }] : []),
                    ...(summary.manpowerLevyToDate > 0 ? [{ key: 'service_ipc_levy', value: summary.manpowerLevyToDate }] : []),
                    { key: 'service_ipc_net_after', value: summary.netAfterDeductions },
                    ...(summary.advancePaymentRecovery > 0
                      ? [{ key: 'service_ipc_advance', value: summary.advancePaymentRecovery }]
                      : []),
                    { key: 'service_ipc_previous_paid', value: summary.previousPayments },
                    { key: 'service_ipc_amount_due', value: summary.amountDue, strong: true },
                  ]).map((row) => (
                    <div key={row.key} className={cn('flex justify-between gap-2 px-2 py-0.5', row.strong && 'font-bold')}>
                      <span>{t(row.key)}</span>
                      <span className="tabular-nums">{formatMoney(row.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className={cn('p-4 border-t flex flex-wrap gap-2 justify-end', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
                {editingId && !readOnly && !showDeleteConfirm && (
                  <button
                    type="button"
                    className="px-4 py-2 rounded-lg font-bold inline-flex items-center gap-2 bg-red-700 hover:bg-red-600 text-white me-auto"
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    <Trash2 size={15} />
                    {language === 'ar' ? 'حذف المستخلص' : 'Delete Certificate'}
                  </button>
                )}
                {showDeleteConfirm && (
                  <div className="me-auto flex items-center gap-2">
                    <span className="text-sm font-bold text-red-500">{language === 'ar' ? 'تأكيد الحذف؟' : 'Confirm delete?'}</span>
                    <button type="button" className="px-3 py-1.5 rounded-lg text-sm font-bold bg-red-700 hover:bg-red-600 text-white" onClick={() => void handleDeleteDraft()}>
                      {language === 'ar' ? 'نعم، احذف' : 'Yes, Delete'}
                    </button>
                    <button type="button" className="px-3 py-1.5 rounded-lg text-sm font-bold" onClick={() => setShowDeleteConfirm(false)}>
                      {language === 'ar' ? 'تراجع' : 'Cancel'}
                    </button>
                  </div>
                )}
                <button type="button" className="px-4 py-2 rounded-lg font-bold inline-flex items-center gap-2" onClick={handlePrintForm}>
                  <Printer size={16} />
                  {t('report_print_action')}
                </button>
                <button type="button" className="px-4 py-2 rounded-lg font-bold" onClick={() => { setShowModal(false); setShowDeleteConfirm(false); resetForm(); }}>{t('cancel')}</button>
                {!readOnly && (
                  <>
                    <button type="button" disabled={saving} className="px-4 py-2 rounded-lg font-bold bg-gray-700 text-white" onClick={() => void persist('draft')}>{t('save_draft')}</button>
                    <button type="button" disabled={saving} className="px-4 py-2 rounded-lg font-bold bg-amber-600 text-white" onClick={() => void persist('submit')}>{t('submit')}</button>
                    {canApprove && (
                      <button type="button" disabled={saving} className="px-4 py-2 rounded-lg font-bold bg-blue-600 text-white" onClick={() => { setSaveMode('approve'); void persist('approve'); }}>{t('approve')}</button>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {showSupplierModal && (
        <AddSupplierModal
          open
          theme={theme}
          language={language}
          cancelLabel={t('cancel')}
          isSubmitting={false}
          supplierType="subcontractor"
          askServiceKind
          computedAccountCode={nextSupplierCode}
          onClose={() => setShowSupplierModal(false)}
          onSubmit={handleSaveSupplier}
        />
      )}

      <JournalPreviewModal
        open={preview !== null}
        title={t('service_ipc_preview')}
        description={preview?.description}
        entries={preview?.entries ?? []}
        resolveCostCenter={(id) => contracts.find((c) => c.id === id)?.contractName}
        onClose={() => setPreview(null)}
        onConfirm={() => {
          previewConfirmed.current = true;
          setPreview(null);
          void persist('approve');
        }}
      />
      {ReportPreviewHost}
    </div>
  );
}
