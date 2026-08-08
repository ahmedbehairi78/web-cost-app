import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ManualHelpButton } from './help/ManualHelpButton';
import { useFirestoreQuery } from '../hooks/useFirestoreQuery';
import { useApiQuery } from '../hooks/useApiQuery';
import { useBoqItemsWithRateOverlay } from '../hooks/useBoqItemsWithRateOverlay';
import {
  Plus,
  FileText,
  Trash2,
  Briefcase,
  X,
  Download,
  Upload,
  Loader2,
} from 'lucide-react';
import { BoqMaterialsModal } from './BoqMaterialsModal';
import { BOQItemFormModal, EMPTY_BOQ_FORM, type BoqItemFormData } from './boq/BOQItemFormModal';
import { ContractFormModal, type ContractFormFields } from './boq/ContractFormModal';
import { VoOrdersPanel } from './boq/VoOrdersPanel';
import { VoOrderModal } from './boq/VoOrderModal';
import { BoqItemRow } from './boq/BoqItemRow';
import { buildBoqRowViewModel } from './boq/boqRowViewModel';
import { DeleteBlockedModal } from './boq/DeleteBlockedModal';
import { collection, query, where, orderBy, addDoc, serverTimestamp, deleteDoc, doc, getDocs, updateDoc, writeBatch } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { cn, listKey } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../context/LanguageContext';
import { formatNumber } from '../lib/numberLocale';
import { usePermissions } from '../context/PermissionsContext';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import { AdminSensitiveVerifyModal } from './AdminSensitiveVerifyModal';
import { isLocalBackend } from '../lib/dataBackend';
import { ApiError } from '../lib/apiClient';
import { boqApi, billingApi, contractsApi, inventoryApi, projectsApi, settingsApi, boqMaterialsApi, NetworkQueuedError } from '../services/local/modulesApi';
import { consumePendingBoqFocus } from '../lib/shellNavigation';
import { useUserAccessScope } from '../hooks/useUserAccessScope';
import { useVoPrintPreview } from '../hooks/useVoPrintPreview';
import { buildVoPrintData } from '../lib/voPrintData';
import type { CompanyPrintInfo } from '../lib/ipcPrintData';
import type { StoredReportPrintProfiles } from '../lib/reportPrintProfiles';
import { displayLocale } from '../lib/numberLocale';
import type { VariationOrder } from '../types';

interface Project {
  id: string;
  projectName: string;
  projectCode: string;
}

interface Contract {
  id: string;
  contractName: string;
  contractNumber: string;
  projectId: string;
}

interface BOQItem {
  id: string;
  projectId: string;
  contractId: string;
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
  rateDirect: number;
  rateOverheadPct: number;
  rateProfitPct: number;
  unitRateTotal: number;
  tenderAmount: number;
  startDate?: string;
  expectedDuration?: number;
  createdAt?: { toDate(): Date } | Date | string;
}

function buildBoqFormFromItem(item: BOQItem): BoqItemFormData {
  return {
    chapterCode: item.chapterCode || '',
    chapterName: item.chapterName || '',
    workTypeCode: item.workTypeCode || '',
    sectionCode: item.sectionCode || '',
    sectionName: item.sectionName || '',
    itemCode: item.itemCode,
    description: item.description,
    unit: item.unit,
    tenderQty: item.tenderQty,
    rateMaterials: item.rateMaterials || 0,
    rateLabour: item.rateLabour || 0,
    rateEquipment: item.rateEquipment || 0,
    rateOverheadPct: item.rateOverheadPct,
    rateProfitPct: item.rateProfitPct,
    startDate: item.startDate || '',
    expectedDuration: item.expectedDuration || 0,
  };
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

function normalizeBoqItem(row: Record<string, unknown>, index = 0): BOQItem {
  const unitRateTotal = Number(row.unitRateTotal ?? 0);
  const rawId = String(row.id ?? '').trim();
  const itemCode = String(row.itemCode ?? '');
  const contractId = String(row.contractId ?? '');
  return {
    id: rawId || `boq-${contractId}-${itemCode || index}-${index}`,
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
    rateDirect: Number(row.rateDirect ?? 0),
    rateOverheadPct: Number(row.rateOverheadPct ?? 10),
    rateProfitPct: Number(row.rateProfitPct ?? 12),
    unitRateTotal,
    tenderAmount: Number(row.tenderAmount ?? 0),
    startDate: row.startDate ? String(row.startDate) : undefined,
    expectedDuration: row.expectedDuration != null ? Number(row.expectedDuration) : undefined,
    createdAt: row.createdAt as BOQItem['createdAt'],
  };
}

function buildBoqApiPayload(
  data: {
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
    startDate: string;
    expectedDuration: number;
  },
  projectId: string,
  contractId: string,
) {
  const direct = data.rateMaterials + data.rateLabour + data.rateEquipment;
  const overheadAmt = direct * (data.rateOverheadPct / 100);
  const subtotal = direct + overheadAmt;
  const profitAmt = subtotal * (data.rateProfitPct / 100);
  const total = subtotal + profitAmt;
  return {
    projectId,
    contractId,
    chapterCode: data.chapterCode || null,
    chapterName: data.chapterName || null,
    workTypeCode: data.workTypeCode || null,
    sectionCode: data.sectionCode || null,
    sectionName: data.sectionName || null,
    itemCode: data.itemCode,
    description: data.description,
    unit: data.unit,
    tenderQty: data.tenderQty,
    rateMaterials: data.rateMaterials,
    rateLabour: data.rateLabour,
    rateEquipment: data.rateEquipment,
    rateDirect: direct,
    rateOverheadPct: data.rateOverheadPct,
    rateProfitPct: data.rateProfitPct,
    unitRateTotal: total,
    tenderAmount: total * data.tenderQty,
    expectedDuration: data.expectedDuration || null,
    startDate: data.startDate || null,
    isDeleted: false,
  };
}

export function BOQ({ embedded = false }: { embedded?: boolean }) {
  const { t, language, theme, dir, locale, formatMoney } = useLanguage();
  const { isAdmin, can } = usePermissions();
  const { isProjectsManager } = useUserAccessScope();
  const canWriteVo = isLocalBackend && (can('boq').create || can('boq').edit);
  const canApproveVo = isLocalBackend && (isAdmin || isProjectsManager);
  const canReadBillingProgress = can('billing').view || can('billing').create || can('billing').edit;
  const [dataRefreshKey, setDataRefreshKey] = useState(0);
  const [voRefreshKey, setVoRefreshKey] = useState(0);
  const [voModalOpen, setVoModalOpen] = useState(false);
  const [voHighlightId, setVoHighlightId] = useState<string | null>(null);
  const [voOrders, setVoOrders] = useState<VariationOrder[]>([]);
  const handleVoOrdersLoaded = useCallback((orders: VariationOrder[]) => {
    setVoOrders(orders);
  }, []);
  const printLabels = useMemo(
    () => ({
      title: t('report_print_preview_title'),
      hint: t('report_print_preview_hint'),
      print: t('report_print_action'),
      cancel: t('cancel'),
    }),
    [t],
  );
  const { requestPrint: requestVoPrint, PrintHost: VoPrintHost } = useVoPrintPreview(
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
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedContractId, setSelectedContractId] = useState<string>('');
  // H3: بيانات التكاليف الفعلية ورصيد المخزون من SQLite
  const [boqActuals, setBoqActuals] = useState<{
    consumedByBoqId: Record<string, number>;
    inventoryByDesc: Record<string, number>;
  }>({ consumedByBoqId: {}, inventoryByDesc: {} });

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

  const { data: fsItems, loading: fsItemsLoading } = useFirestoreQuery<BOQItem>(
    () =>
      !isLocalBackend && selectedContractId
        ? query(collection(db, 'boq_items'), where('contractId', '==', selectedContractId), where('isDeleted', '!=', true))
        : null,
    [selectedContractId, isLocalBackend],
    { mode: 'snapshot', collectionName: 'boq_items' },
  );
  const {
    items: apiItems,
    loading: apiItemsLoading,
    error: apiItemsError,
  } = useBoqItemsWithRateOverlay<BOQItem>({
    contractId: selectedContractId,
    refreshKey: dataRefreshKey,
    persistOverlay: isLocalBackend && (can('boq').create || can('boq').edit),
    normalize: normalizeBoqItem,
  });
  const items = useMemo(() => {
    if (isLocalBackend) return apiItems ?? [];
    return (fsItems ?? []).map((r, idx) =>
      normalizeBoqItem(r as unknown as Record<string, unknown>, idx),
    );
  }, [isLocalBackend, apiItems, fsItems]);
  const loading = isLocalBackend ? apiItemsLoading : fsItemsLoading;

  const { data: fsBillingForProgress } = useFirestoreQuery<{ items?: Array<{ boqItemId?: string; currentQty?: number }>; status?: string }>(
    () =>
      !isLocalBackend && selectedContractId
        ? query(collection(db, 'billing'), where('contractId', '==', selectedContractId), where('status', 'in', ['approved', 'paid']))
        : null,
    [selectedContractId, isLocalBackend],
    { mode: 'snapshot', collectionName: 'billing' },
  );
  const { data: apiBillingForProgress, error: apiBillingError } = useApiQuery<{ items?: Array<{ boqItemId?: string; currentQty?: number }>; status?: string }>(
    () => billingApi.list(selectedContractId) as Promise<Array<{ items?: Array<{ boqItemId?: string; currentQty?: number }>; status?: string }>>,
    [selectedContractId],
    { enabled: isLocalBackend && !!selectedContractId && canReadBillingProgress, refreshKey: dataRefreshKey },
  );
  const billingForProgress = useMemo(() => {
    if (isLocalBackend) {
      return apiBillingForProgress.filter((b) => b.status === 'approved' || b.status === 'paid');
    }
    return fsBillingForProgress;
  }, [isLocalBackend, apiBillingForProgress, fsBillingForProgress]);

  useEffect(() => {
    if (apiProjectsError) apiLoadErrorToast(apiProjectsError, language, language === 'ar' ? 'المشاريع' : 'projects');
  }, [apiProjectsError, language]);
  useEffect(() => {
    if (apiContractsError) apiLoadErrorToast(apiContractsError, language, language === 'ar' ? 'العقود' : 'contracts');
  }, [apiContractsError, language]);
  useEffect(() => {
    if (apiItemsError) apiLoadErrorToast(apiItemsError, language, language === 'ar' ? 'بنود BOQ' : 'BOQ items');
  }, [apiItemsError, language]);
  useEffect(() => {
    if (apiBillingError) apiLoadErrorToast(apiBillingError, language, language === 'ar' ? 'المستخلصات' : 'billing');
  }, [apiBillingError, language]);

  useEffect(() => {
    if (!isLocalBackend || !selectedContractId) {
      setLinkCounts({});
      return;
    }
    boqMaterialsApi
      .getLinkCounts(selectedContractId)
      .then((counts) => setLinkCounts(counts))
      .catch(() => setLinkCounts({}));
  }, [selectedContractId, isLocalBackend]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isContractModalOpen, setIsContractModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<BOQItem | null>(null);
  const [boqModalVariant, setBoqModalVariant] = useState<'default' | 'changeOrder'>('default');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [linkCounts, setLinkCounts] = useState<Record<string, number>>({});
  const [materialsModal, setMaterialsModal] = useState<{
    boqItemId: string;
    label: string;
    boqHint?: {
      projectId?: string;
      contractId?: string;
      itemCode?: string;
      description?: string;
      unit?: string;
      chapterCode?: string;
      chapterName?: string;
      workTypeCode?: string;
      sectionCode?: string;
      sectionName?: string;
      tenderQty?: number;
      unitRateTotal?: number;
      tenderAmount?: number;
      expectedDuration?: number;
      startDate?: string;
    };
  } | null>(null);
  
  // New Contract Form State
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
  
  const [deleteBlockedModal, setDeleteBlockedModal] = useState<{
    itemCode: string;
    itemDescription: string;
    linkCount: number;
    consumptionCount: number;
    actualCostCount: number;
  } | null>(null);
  const sensitiveClearBoqRef = useRef<(() => Promise<void>) | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const boqModalInitialData = useMemo<BoqItemFormData>(
    () => (editingItem ? buildBoqFormFromItem(editingItem) : EMPTY_BOQ_FORM),
    [editingItem],
  );

  // Compute progress map from approved/paid billings
  const progressMap = useMemo(() => {
    const progress: Record<string, number> = {};
    for (const ipc of billingForProgress) {
      if (Array.isArray(ipc.items)) {
        for (const item of ipc.items) {
          if (item.boqItemId) progress[item.boqItemId] = (progress[item.boqItemId] || 0) + (item.currentQty || 0);
        }
      }
    }
    return progress;
  }, [billingForProgress]);

  // Auto-select first project when loaded
  useEffect(() => {
    if (projects.length > 0 && !selectedProjectId) setSelectedProjectId(projects[0].id);
  }, [projects, selectedProjectId]);

  // Auto-select/clear contract when project changes
  useEffect(() => {
    if (!selectedProjectId) { setSelectedContractId(''); return; }
    if (contracts.length > 0) setSelectedContractId(contracts[0].id);
    else setSelectedContractId('');
  }, [contracts, selectedProjectId]);

  // Clear contract if project cleared
  useEffect(() => {
    if (!selectedProjectId) setSelectedContractId('');
  }, [selectedProjectId]);

  useEffect(() => {
    setVoOrders([]);
  }, [selectedContractId]);

  useEffect(() => {
    const focus = consumePendingBoqFocus();
    if (!focus?.contractId) return;
    if (focus.projectId) setSelectedProjectId(focus.projectId);
    setSelectedContractId(focus.contractId);
    if (focus.variationOrderId) setVoHighlightId(focus.variationOrderId);
  }, []);

  useEffect(() => {
    if (!isLocalBackend) return;
    void settingsApi
      .getCompanyInfo()
      .then((res) => {
        if (res.value) setCompanyInfo((prev) => ({ ...prev, ...res.value }));
      })
      .catch(() => {
        /* keep defaults */
      });
  }, []);

  const contractScopeLabel = useCallback((contract?: Contract) => {
    if (!contract) return undefined;
    return [contract.contractNumber, contract.contractName].filter(Boolean).join(' — ');
  }, []);

  const handlePrintVo = useCallback(
    (order: VariationOrder) => {
      const project = projects?.find((p) => p.id === selectedProjectId);
      const contract = contracts.find((c) => c.id === selectedContractId);
      const statusKey = `vo_status_${order.status}`;
      const statusLabel = t(statusKey) === statusKey ? order.status : t(statusKey);
      const data = buildVoPrintData({
        order,
        projectName: project?.projectName,
        contractName: contract?.contractName || contract?.contractNumber,
        statusLabel,
        lineTypeLabel: (type) => {
          if (type === 'new_item') return t('vo_line_new_item');
          if (type === 'adjust') return t('vo_line_adjust');
          return t('vo_line_delete_item');
        },
        formatMoney,
      });
      requestVoPrint(
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
      formatMoney,
      requestVoPrint,
      companyInfo,
      language,
      contractScopeLabel,
    ],
  );

  // H3: جلب التكاليف الفعلية ورصيد المخزون من SQLite
  useEffect(() => {
    if (!isLocalBackend) return;
    let cancelled = false;
    inventoryApi.boqActuals(selectedContractId || undefined)
      .then((data) => {
        if (cancelled) return;
        const consumedByBoqId: Record<string, number> = {};
        for (const row of data?.actualCosts ?? []) {
          consumedByBoqId[String(row.boqItemId)] = Number(row.totalConsumed || 0);
        }
        const inventoryByDesc: Record<string, number> = {};
        const invRows = data?.projectInventory ?? data?.inventory ?? [];
        for (const row of invRows) {
          const key = String(row.itemDescription).toLowerCase().trim();
          inventoryByDesc[key] = (inventoryByDesc[key] || 0) + Number(row.quantityBalance || 0);
        }
        setBoqActuals({ consumedByBoqId, inventoryByDesc });
      })
      .catch(() => {/* non-blocking */});
    return () => { cancelled = true; };
  }, [selectedContractId]);

  const handleContractSubmit = async (data: ContractFormFields) => {
    if (!selectedProjectId) return;
    setIsSubmitting(true);

    try {
      if (isLocalBackend) {
        const created = (await contractsApi.create({
          contractName: data.contractName,
          contractNumber: data.contractNumber,
          projectId: selectedProjectId,
          isDeleted: false,
        })) as { id: string };
        setIsContractModalOpen(false);
        setDataRefreshKey((k) => k + 1);
        setSelectedContractId(created.id);
        return;
      }
      const docRef = await addDoc(collection(db, 'contracts'), {
        ...data,
        projectId: selectedProjectId,
        isDeleted: false,
        createdAt: serverTimestamp(),
      });
      setIsContractModalOpen(false);
      setSelectedContractId(docRef.id);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'contracts');
      throw error;
    } finally {
      setIsSubmitting(false);
    }
  };


  const handleSubmit = async (data: BoqItemFormData) => {
    setIsSubmitting(true);

    try {
      if (isLocalBackend) {
        const payload = buildBoqApiPayload(data, selectedProjectId, selectedContractId);
        let newItemId: string | null = null;
        if (editingItem) {
          await boqApi.update(editingItem.id, payload);
        } else {
          const created = await boqApi.create(payload);
          newItemId = created.id;
          // وراثة الروابط من بند مشابه
          if (newItemId && data.sectionCode) {
            const similarItem = sortedItems.find(
              (i) =>
                i.id !== newItemId &&
                i.sectionCode === data.sectionCode &&
                linkCounts[i.id] > 0
            );
            if (similarItem) {
              try {
                await boqMaterialsApi.inheritLinks(newItemId, similarItem.id);
                toast.success(
                  language === 'ar'
                    ? `تم نسخ ${linkCounts[similarItem.id]} صنف من بند مشابه`
                    : `Inherited ${linkCounts[similarItem.id]} material(s) from similar item`
                );
              } catch (err) {
                console.warn('Auto-inherit failed:', err);
              }
            }
          }
        }
      } else {
        const direct = data.rateMaterials + data.rateLabour + data.rateEquipment;
        const overheadAmt = direct * (data.rateOverheadPct / 100);
        const subtotal = direct + overheadAmt;
        const profitAmt = subtotal * (data.rateProfitPct / 100);
        const total = subtotal + profitAmt;
        const tenderAmount = total * data.tenderQty;
        const itemData = {
          ...data,
          projectId: selectedProjectId,
          contractId: selectedContractId,
          rateDirect: direct,
          unitRateTotal: total,
          tenderAmount,
          createdAt: editingItem ? editingItem.createdAt : serverTimestamp(),
        };
        if (editingItem) {
          await updateDoc(doc(db, 'boq_items', editingItem.id), itemData);
        } else {
          await addDoc(collection(db, 'boq_items'), itemData);
        }
      }

      if (isLocalBackend) setDataRefreshKey((k) => k + 1);
      setIsModalOpen(false);
      setEditingItem(null);
      setBoqModalVariant('default');
    } catch (error) {
      if (error instanceof NetworkQueuedError) {
        setIsModalOpen(false);
        setEditingItem(null);
        setBoqModalVariant('default');
        return;
      }
      handleFirestoreError(error, editingItem ? OperationType.UPDATE : OperationType.CREATE, 'boq_items');
      throw error;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClearBOQ = async () => {
    if (!isAdmin) {
      toast.error(
        language === 'ar'
          ? 'مسح جدول الكميات بالكامل متاح لمدير النظام فقط.'
          : 'Clearing the entire BOQ is limited to system administrators.',
      );
      return;
    }
    if (!selectedContractId) return;

    setConfirmConfig({
      isOpen: true,
      title: t('boq_confirm_clear'),
      message: t('boq_confirm_clear_msg'),
      onConfirm: async () => {
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        sensitiveClearBoqRef.current = async () => {
          setIsSubmitting(true);
          try {
            if (isLocalBackend) {
              await Promise.all(items.map((item) => boqApi.remove(item.id)));
              setDataRefreshKey((k) => k + 1);
              return;
            }
            const q = query(collection(db, 'boq_items'), where('contractId', '==', selectedContractId));
            const snapshot = await getDocs(q);

            const CHUNK = 500;
            for (let i = 0; i < snapshot.docs.length; i += CHUNK) {
              const batch = writeBatch(db);
              snapshot.docs.slice(i, i + CHUNK).forEach(d =>
                batch.update(doc(db, 'boq_items', d.id), { isDeleted: true }),
              );
              await batch.commit();
            }
          } catch (error) {
            handleFirestoreError(error, OperationType.DELETE, 'boq_items');
          } finally {
            setIsSubmitting(false);
          }
        };
        setAdminVerifyOpen(true);
      },
    });
  };

  const handleEditItem = useCallback((item: BOQItem) => {
    setEditingItem(item);
    setBoqModalVariant('default');
    setIsModalOpen(true);
  }, []);

  const handleOpenChangeOrder = useCallback((item: BOQItem) => {
    setEditingItem(item);
    setBoqModalVariant('changeOrder');
    setIsModalOpen(true);
  }, []);

  const handleDeleteItem = useCallback(async (itemId: string) => {
    const item = items.find(i => i.id === itemId);

    if (isLocalBackend) {
      try {
        const checkResult = await boqMaterialsApi.canDelete(itemId);
        if (!checkResult.canDelete) {
          setDeleteBlockedModal({
            itemCode: item?.itemCode || '',
            itemDescription: item?.description || '',
            linkCount: checkResult.linkCount,
            consumptionCount: checkResult.consumptionCount,
            actualCostCount: checkResult.actualCostCount,
          });
          return;
        }
      } catch (err) {
        console.error('Delete check error:', err);
      }
    }

    setConfirmConfig({
      isOpen: true,
      title: t('delete_item'),
      message: t('delete_item_msg'),
      onConfirm: async () => {
        try {
          if (isLocalBackend) {
            await boqApi.remove(itemId);
            setDataRefreshKey((k) => k + 1);
          } else {
            await deleteDoc(doc(db, 'boq_items', itemId));
          }
          setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
          if (error instanceof NetworkQueuedError) {
            setConfirmConfig(prev => ({ ...prev, isOpen: false }));
            return;
          }
          handleFirestoreError(error, OperationType.DELETE, 'boq_items');
        }
      }
    });
  }, [items, isLocalBackend, t]);

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.itemCode.localeCompare(b.itemCode, undefined, { numeric: true })),
    [items],
  );
  const voCreatedItemIds = useMemo(() => {
    const ids = new Set<string>();
    for (const order of voOrders) {
      for (const line of order.lines) {
        if (line.createdBoqItemId) ids.add(String(line.createdBoqItemId));
      }
    }
    return ids;
  }, [voOrders]);
  /** Original contract BOQ — excludes items created by approved VOs (those appear under VO sections). */
  const baseItems = useMemo(
    () => sortedItems.filter((item) => !voCreatedItemIds.has(String(item.id))),
    [sortedItems, voCreatedItemIds],
  );
  const boqItemsById = useMemo(() => {
    const map = new Map<string, BOQItem>();
    for (const item of sortedItems) map.set(String(item.id), item);
    return map;
  }, [sortedItems]);
  /** Pending VOs are not yet in live `boq_items`; approved ones already are. */
  const pendingVoNet = useMemo(
    () =>
      voOrders
        .filter((o) => o.status === 'draft' || o.status === 'submitted')
        .reduce((sum, o) => sum + Number(o.totalValue || 0), 0),
    [voOrders],
  );
  const liveBoqTotal = useMemo(
    () => sortedItems.reduce((s, i) => s + Number(i.tenderAmount ?? 0), 0),
    [sortedItems],
  );
  const boqColumnSums = useMemo(
    () => ({
      materials: baseItems.reduce((s, i) => s + Number(i.rateMaterials ?? 0) * Number(i.tenderQty ?? 0), 0),
      labour: baseItems.reduce((s, i) => s + Number(i.rateLabour ?? 0) * Number(i.tenderQty ?? 0), 0),
      equipment: baseItems.reduce((s, i) => s + Number(i.rateEquipment ?? 0) * Number(i.tenderQty ?? 0), 0),
      tenderTotal: baseItems.reduce((s, i) => s + Number(i.tenderAmount ?? 0), 0),
      actualConsumed: baseItems.reduce(
        (s, i) => s + (boqActuals.consumedByBoqId[String(i.id)] ?? 0),
        0,
      ),
    }),
    [baseItems, boqActuals.consumedByBoqId],
  );
  /** Live contract BOQ (incl. approved VOs) + net of draft/submitted VOs. */
  const grandBoqTotal = useMemo(
    () => liveBoqTotal + pendingVoNet,
    [liveBoqTotal, pendingVoNet],
  );
  const totalBOQAmount = grandBoqTotal;
  const boqTableColSpan = isLocalBackend ? 22 : 20;

  const boqRowLabels = useMemo(
    () => ({
      done: t('done'),
      late: t('late'),
      running: t('running'),
      notStarted: language === 'ar' ? 'لم يبدأ' : 'Not started',
      edit: language === 'ar' ? 'تعديل البند' : 'Edit item',
      changeOrders: language === 'ar' ? 'أوامر التغيير' : 'Change orders',
      delete: language === 'ar' ? 'حذف' : 'Delete',
      materials: language === 'ar' ? 'أصناف مسموحة' : 'Allowed materials',
    }),
    [t, language],
  );

  const boqRowViewModels = useMemo(() => {
    const now = new Date();
    return baseItems.map((item, idx) => {
      const invKey = String(item.description || '').toLowerCase().trim();
      return buildBoqRowViewModel(
        item,
        idx,
        progressMap[item.id] || 0,
        locale,
        now,
        boqActuals.consumedByBoqId[String(item.id)] ?? 0,
        boqActuals.inventoryByDesc[invKey] ?? null,
      );
    });
  }, [baseItems, progressMap, locale, boqActuals]);

  const handleRowEdit = useCallback(
    (id: string) => {
      const item = items.find((i) => i.id === id);
      if (item) handleEditItem(item);
    },
    [items, handleEditItem],
  );

  const handleRowChangeOrder = useCallback(
    (id: string) => {
      const item = items.find((i) => i.id === id);
      if (item) handleOpenChangeOrder(item);
    },
    [items, handleOpenChangeOrder],
  );

  const handleRowMaterials = useCallback(
    (id: string) => {
      const item = items.find((i) => i.id === id) || baseItems.find((i) => i.id === id);
      if (!item) return;
      setMaterialsModal({
        boqItemId: item.id,
        label: `${item.itemCode} — ${item.description}`,
        boqHint: {
          projectId: item.projectId || selectedProjectId,
          contractId: item.contractId || selectedContractId,
          itemCode: item.itemCode,
          description: item.description,
          unit: item.unit,
          chapterCode: item.chapterCode,
          chapterName: item.chapterName,
          workTypeCode: item.workTypeCode,
          sectionCode: item.sectionCode,
          sectionName: item.sectionName,
          tenderQty: item.tenderQty,
          unitRateTotal: item.unitRateTotal,
          tenderAmount: item.tenderAmount,
          expectedDuration: item.expectedDuration,
          startDate: item.startDate,
        },
      });
    },
    [items, baseItems, selectedProjectId, selectedContractId],
  );
  const showVoInline = isLocalBackend && !!selectedContractId && (canWriteVo || canApproveVo);

  const handleExportTemplate = () => {
    const data = items.length > 0 ? items.map(item => ({
      'كود الفصل': item.chapterCode || '',
      'اسم الفصل': item.chapterName || '',
      'كود نوع العمل': item.workTypeCode || '',
      'كود القسم': item.sectionCode || '',
      'اسم القسم': item.sectionName || '',
      'كود البند': item.itemCode,
      'وصف البند': item.description,
      'الوحدة': item.unit,
      'الكمية': item.tenderQty,
      'تكلفة المواد': item.rateMaterials || 0,
      'تكلفة العمالة': item.rateLabour || 0,
      'تكلفة المعدات': item.rateEquipment || 0,
      'نسبة المصاريف العمومية %': item.rateOverheadPct,
      'نسبة الربح %': item.rateProfitPct,
      'تاريخ بدء العمل': item.startDate || '',
      'مدة التنفيذ المتوقعة': item.expectedDuration || 0
    })) : [{
      'كود الفصل': '01',
      'اسم الفصل': 'الأعمال الترابية',
      'كود نوع العمل': '01',
      'كود القسم': '01',
      'اسم القسم': 'الحفر',
      'كود البند': '1.1',
      'وصف البند': 'حفر في جميع أنواع التربة',
      'الوحدة': 'م3',
      'الكمية': 100,
      'تكلفة المواد': 0,
      'تكلفة العمالة': 30,
      'تكلفة المعدات': 20,
      'نسبة المصاريف العمومية %': 10,
      'نسبة الربح %': 12,
      'تاريخ بدء العمل': '2024-01-01',
      'مدة التنفيذ المتوقعة': 30
    }];

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "BOQ");
    
    // Set column widths
    const wscols = [
      { wch: 12 }, // Chapter Code
      { wch: 20 }, // Chapter Name
      { wch: 15 }, // Work Type Code
      { wch: 12 }, // Section Code
      { wch: 20 }, // Section Name
      { wch: 15 }, // Item Code
      { wch: 40 }, // Description
      { wch: 10 }, // Unit
      { wch: 15 }, // Qty
      { wch: 15 }, // Mat
      { wch: 15 }, // Lab
      { wch: 15 }, // Equip
      { wch: 15 }, // Overhead
      { wch: 15 }, // Profit
      { wch: 20 }, // Start Date
      { wch: 20 }, // Duration
    ];
    ws['!cols'] = wscols;

    XLSX.writeFile(wb, `BOQ_Template_${selectedContractId || 'New'}.xlsx`);
  };

  const handleImportTemplate = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedContractId) return;

    if (isLocalBackend && typeof navigator !== 'undefined' && !navigator.onLine) {
      toast.error(
        language === 'ar'
          ? 'استيراد Excel يتطلب اتصالاً بالشبكة'
          : 'Excel import requires a network connection',
      );
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const data = new Uint8Array(event.target?.result as ArrayBuffer);
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);
      
      setIsSubmitting(true);
      try {
        const getVal = (row: Record<string, unknown>, key: string, fallback: unknown = 0): unknown => {
          if (row[key] !== undefined) return row[key];
          const normalizedKey = key.trim();
          for (const k in row) {
            if (k.trim() === normalizedKey) return row[k];
          }
          return fallback;
        };

        let imported = 0;
        for (const row of jsonData as Record<string, unknown>[]) {
          const chapterCode = String(getVal(row, 'كود الفصل', ''));
          const chapterName = String(getVal(row, 'اسم الفصل', ''));
          const workTypeCode = String(getVal(row, 'كود نوع العمل', ''));
          const sectionCode = String(getVal(row, 'كود القسم', ''));
          const sectionName = String(getVal(row, 'اسم القسم', ''));
          const itemCode = String(getVal(row, 'كود البند', ''));
          const description = String(getVal(row, 'وصف البند', ''));
          const unit = String(getVal(row, 'الوحدة', ''));
          const tenderQty = Number(getVal(row, 'الكمية', 0));
          const rateMaterials = Number(getVal(row, 'تكلفة المواد', 0));
          const rateLabour = Number(getVal(row, 'تكلفة العمالة', 0));
          const rateEquipment = Number(getVal(row, 'تكلفة المعدات', 0));
          const rateOverheadPct = Number(getVal(row, 'نسبة المصاريف العمومية %', 10));
          const rateProfitPct = Number(getVal(row, 'نسبة الربح %', 12));
          const rawDate = getVal(row, 'تاريخ بدء العمل', '');
          const startDate = rawDate instanceof Date
            ? rawDate.toISOString().split('T')[0]
            : typeof rawDate === 'number'
              ? new Date(Math.round((rawDate - 25569) * 86400 * 1000)).toISOString().split('T')[0]
              : String(rawDate);
          const expectedDuration = Number(getVal(row, 'مدة التنفيذ المتوقعة', 0));

          if (!itemCode || !description) continue;

          if (isLocalBackend) {
            await boqApi.create(
              buildBoqApiPayload(
                {
                  chapterCode,
                  chapterName,
                  workTypeCode,
                  sectionCode,
                  sectionName,
                  itemCode,
                  description,
                  unit,
                  tenderQty,
                  rateMaterials,
                  rateLabour,
                  rateEquipment,
                  rateOverheadPct,
                  rateProfitPct,
                  startDate,
                  expectedDuration,
                },
                selectedProjectId,
                selectedContractId,
              ),
            );
          } else {
            const direct = rateMaterials + rateLabour + rateEquipment;
            const overheadAmt = direct * (rateOverheadPct / 100);
            const subtotal = direct + overheadAmt;
            const profitAmt = subtotal * (rateProfitPct / 100);
            const total = subtotal + profitAmt;

            await addDoc(collection(db, 'boq_items'), {
              chapterCode,
              chapterName,
              workTypeCode,
              sectionCode,
              sectionName,
              itemCode,
              description,
              unit,
              tenderQty,
              rateMaterials,
              rateLabour,
              rateEquipment,
              rateOverheadPct,
              rateProfitPct,
              startDate,
              expectedDuration,
              projectId: selectedProjectId,
              contractId: selectedContractId,
              rateDirect: direct,
              unitRateTotal: total,
              tenderAmount: total * tenderQty,
              isDeleted: false,
              createdAt: serverTimestamp(),
            });
          }
          imported += 1;
        }
        if (isLocalBackend && imported > 0) setDataRefreshKey((k) => k + 1);
        toast.success(t('toast_boq_import_success'));
      } catch (error) {
        console.error('Import error:', error);
        toast.error(t('toast_boq_import_error'));
      } finally {
        setIsSubmitting(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <div className={cn(
      embedded ? 'px-8 pb-8 pt-2' : 'p-8 min-h-screen',
      'transition-colors',
      !embedded && (theme === 'dark' ? 'bg-[#0a0a0a] text-gray-100' :
      theme === 'soft' ? 'bg-[#eceff1] text-[#37474f]' :
      'bg-gray-50 text-gray-900'),
    )} dir={dir}>
      <header className={cn('flex mb-8 gap-4 flex-wrap', embedded ? 'justify-end items-center' : 'justify-between items-center')}>
        {!embedded && (
          <div>
            <h2 className="text-3xl font-bold tracking-tight">{t('boq_page_title')}</h2>
            <p className="text-gray-400 mt-1">{t('boq_page_subtitle')}</p>
            {isLocalBackend && selectedContractId && (
              <p className="text-xs text-amber-600/80 mt-2">
                {language === 'ar'
                  ? `Postgres: ${items.length} بند · ${contracts.length} عقد`
                  : `Postgres: ${items.length} items · ${contracts.length} contracts`}
              </p>
            )}
          </div>
        )}
        <div className="flex gap-4">
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-gray-500 font-bold uppercase">
              {showVoInline && voOrders.length > 0 ? t('boq_grand_total') : t('total_project_value')}
            </span>
            <span className="text-xl font-bold text-blue-500">{formatNumber(totalBOQAmount)} <span className="text-xs font-normal">{t('currency')}</span></span>
          </div>
          
          <div className="flex gap-2">
            <button 
              onClick={handleExportTemplate}
              className={cn(
                "px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 border",
                theme === 'dark' ? "bg-gray-800 hover:bg-gray-700 text-gray-300 border-gray-700" : 
                theme === 'soft' ? "bg-white hover:bg-[#eceff1] text-[#37474f] border-[#cfd8dc]" :
                "bg-white hover:bg-gray-50 text-gray-700 border-gray-200 shadow-sm"
              )}
              title={t('export_template')}
            >
              <Download size={18} />
              {t('export')}
            </button>
            <button
              disabled={!selectedContractId || isSubmitting}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 border disabled:opacity-50",
                theme === 'dark' ? "bg-gray-800 hover:bg-gray-700 text-gray-300 border-gray-700" :
                theme === 'soft' ? "bg-white hover:bg-[#eceff1] text-[#37474f] border-[#cfd8dc]" :
                "bg-white hover:bg-gray-50 text-gray-700 border-gray-200 shadow-sm"
              )}
              title={t('import_template')}
            >
              <Upload size={18} />
              {t('import')}
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept=".xlsx, .xls" 
              onChange={handleImportTemplate}
            />
            <ManualHelpButton topicId="technical.boq.import" size={16} />
          </div>

            <div className="flex items-center gap-2">
            <button 
              disabled={!selectedContractId || isSubmitting}
              onClick={() => {
                setEditingItem(null);
                setBoqModalVariant('default');
                setIsModalOpen(true);
              }}
              className="bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:text-gray-400 px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 text-white"
            >
              <Plus size={18} />
              {t('add_item')}
            </button>
            <ManualHelpButton topicId="technical.boq.add_item" size={16} />
            <ManualHelpButton topicId="technical.boq.materials" size={16} />
            <button
              disabled={!selectedContractId || isSubmitting || items.length === 0 || !isAdmin}
              onClick={handleClearBOQ}
              className="bg-red-900/20 hover:bg-red-900/40 text-red-500 px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 border border-red-900/50"
              title={t('boq_clear_table')}
            >
              <Trash2 size={18} />
              {t('clear')}
            </button>
          </div>
        </div>
      </header>

      {/* Selectors */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div className={cn(
          "border p-4 rounded-xl flex items-center gap-4",
          theme === 'dark' ? "bg-[#151619] border-gray-800" : 
          theme === 'soft' ? "bg-white border-[#cfd8dc]" : 
          "bg-white border-gray-200 shadow-sm"
        )}>
          <div className="p-2 bg-blue-900/20 rounded-lg text-blue-500">
            <Briefcase size={20} />
          </div>
          <div className="flex-1">
            <label className="text-[10px] text-gray-500 font-bold uppercase block mb-1">{t('project')}</label>
            <select 
              className={cn(
                "bg-transparent text-lg font-bold outline-none w-full cursor-pointer",
                theme === 'dark' ? "text-white" : "text-gray-900"
              )}
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
            >
              {projects.map((p, pi) => (
                <option key={listKey(p.id, pi, `boq-proj-${p.projectCode}`)} value={p.id} className={theme === 'dark' ? "bg-[#151619]" : "bg-white"}>{p.projectName} ({p.projectCode})</option>
              ))}
            </select>
          </div>
        </div>

        <div className={cn(
          "border p-4 rounded-xl flex items-center gap-4",
          theme === 'dark' ? "bg-[#151619] border-gray-800" : 
          theme === 'soft' ? "bg-white border-[#cfd8dc]" : 
          "bg-white border-gray-200 shadow-sm"
        )}>
          <div className="p-2 bg-purple-900/20 rounded-lg text-purple-500">
            <FileText size={20} />
          </div>
          <div className="flex-1">
            <div className="flex justify-between items-center mb-1">
              <label className="text-[10px] text-gray-500 font-bold uppercase block">{t('contract')}</label>
              <button
                onClick={() => setIsContractModalOpen(true)}
                disabled={!selectedProjectId}
                className="p-1 px-2 bg-purple-900/20 text-purple-500 rounded text-[10px] font-black uppercase flex items-center gap-1 hover:bg-purple-900/30 transition-colors disabled:opacity-50"
              >
                <Plus size={10} />
                {t('add_contract')}
              </button>
            </div>
            <select
              className={cn(
                "bg-transparent text-lg font-bold outline-none w-full cursor-pointer",
                theme === 'dark' ? "text-white" : "text-gray-900"
              )}
              value={selectedContractId}
              onChange={(e) => setSelectedContractId(e.target.value)}
              disabled={!selectedProjectId}
            >
              <option value="" disabled>{t('select_contract')}</option>
              {contracts.map((c, ci) => (
                <option key={listKey(c.id, ci, `boq-contract-${c.contractNumber}`)} value={c.id} className={theme === 'dark' ? "bg-[#151619]" : "bg-white"}>{c.contractName} ({c.contractNumber})</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* BOQ Table */}
      <div className={cn(
        "border rounded-xl overflow-x-auto shadow-2xl",
        theme === 'dark' ? "bg-[#151619] border-gray-800" : 
        theme === 'soft' ? "bg-white border-[#cfd8dc]" : 
        "bg-white border-gray-200"
      )}>
        <table className="w-full text-right border-collapse min-w-[1100px]">
          <thead>
            <tr className={cn(
              "border-b text-[10px] font-bold text-gray-400 uppercase",
              theme === 'dark' ? "bg-gray-900/50 border-gray-800" : 
              theme === 'soft' ? "bg-[#eceff1] border-[#cfd8dc]" : 
              "bg-gray-50 border-gray-100"
            )}>
              <th
                className={cn(
                  'p-4 w-28 whitespace-nowrap sticky right-0 z-20 border-l shadow-[inset_1px_0_0_rgba(0,0,0,0.06)]',
                  theme === 'dark' ? 'bg-gray-900/95 border-gray-700' : theme === 'soft' ? 'bg-[#eceff1] border-[#cfd8dc]' : 'bg-gray-50 border-gray-200',
                )}
              >
                {language === 'ar' ? 'إجراءات' : 'Actions'}
              </th>
              <th className="p-4 w-24">{t('chapter')}</th>
              <th className="p-4 w-24">{t('section_col')}</th>
              <th className="p-4 w-20">{t('type')}</th>
              <th className="p-4 w-20">{t('code')}</th>
              <th className="p-4">{t('description')}</th>
              <th className="p-4 w-16">{t('unit')}</th>
              <th className="p-4 w-20">{t('qty')}</th>
              <th className="p-4 w-24 whitespace-nowrap">{t('start_date')}</th>
              <th className="p-4 w-16 whitespace-nowrap">{t('duration')}</th>
              <th className="p-4 w-24 whitespace-nowrap">{t('end_date')}</th>
              <th className="p-4 w-20 whitespace-nowrap">{t('progress')}</th>
              <th className="p-4 w-24 whitespace-nowrap">{t('status')}</th>
              <th className="p-4 w-20 whitespace-normal text-[8px]">{t('mat_abbr')}</th>
              <th className="p-4 w-20 whitespace-normal text-[8px]">{t('lab_abbr')}</th>
              <th className="p-4 w-20 whitespace-normal text-[8px]">{t('equip_abbr')}</th>
              <th className="p-4 w-12 whitespace-normal text-[8px]">{t('oh_pct')}</th>
              <th className="p-4 w-12 whitespace-normal text-[8px]">{t('profit_pct')}</th>
              <th className="p-4 w-24">{t('unit_rate')}</th>
              <th className="p-4 w-24">{t('total')}</th>
              {isLocalBackend && (
                <>
                  <th className="p-4 w-28 whitespace-normal text-[8px] text-orange-400">{language === 'ar' ? 'تكلفة\nصرف فعلية' : 'Actual\nIssue Cost'}</th>
                  <th className="p-4 w-28 whitespace-normal text-[8px] text-cyan-400">{language === 'ar' ? 'مخزن\nالمشروع' : 'Project\nWarehouse'}</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={boqTableColSpan} className="p-12 text-center text-gray-500">{t('loading_items')}</td></tr>
            ) : baseItems.length === 0 && !showVoInline ? (
              <tr><td colSpan={boqTableColSpan} className="p-12 text-center text-gray-500">{t('no_items')}</td></tr>
            ) : baseItems.length === 0 ? (
              <tr>
                <td colSpan={boqTableColSpan} className="p-6 text-center text-xs text-gray-500">
                  {t('boq_original_empty')}
                </td>
              </tr>
            ) : (
              boqRowViewModels.map((row) => (
                <BoqItemRow
                  key={listKey(row.id, row.index, `boq-row-${row.itemCode}`)}
                  row={row}
                  theme={theme}
                  isLocalBackend={isLocalBackend}
                  linkCount={linkCounts[row.id] || 0}
                  formatMoney={formatMoney}
                  labels={boqRowLabels}
                  onEdit={handleRowEdit}
                  onChangeOrder={handleRowChangeOrder}
                  onDelete={handleDeleteItem}
                  onMaterials={handleRowMaterials}
                />
              ))
            )}
          </tbody>
          {!loading && baseItems.length > 0 ? (
            <tbody>
              <tr
                className={cn(
                  'border-t-2 font-bold text-[10px]',
                  theme === 'dark' ? 'bg-gray-900/70 border-gray-700 text-gray-200' :
                  theme === 'soft' ? 'bg-[#eceff1] border-[#cfd8dc] text-[#37474f]' :
                  'bg-gray-100 border-gray-300 text-gray-800',
                )}
              >
                <td
                  className={cn(
                    'p-4 sticky right-0 z-10 border-l shadow-[inset_1px_0_0_rgba(0,0,0,0.06)]',
                    theme === 'dark' ? 'bg-gray-900/95 border-gray-700' : theme === 'soft' ? 'bg-[#eceff1] border-[#cfd8dc]' : 'bg-gray-100 border-gray-200',
                  )}
                />
                <td colSpan={12} className="p-4 text-xs uppercase tracking-wide">
                  {showVoInline ? t('boq_original_total') : t('total')}
                </td>
                <td className="p-4 font-mono text-gray-500">{formatNumber(boqColumnSums.materials)}</td>
                <td className="p-4 font-mono text-gray-500">{formatNumber(boqColumnSums.labour)}</td>
                <td className="p-4 font-mono text-gray-500">{formatNumber(boqColumnSums.equipment)}</td>
                <td className="p-4" />
                <td className="p-4" />
                <td className="p-4" />
                <td className="p-4 text-xs text-green-500">{formatNumber(boqColumnSums.tenderTotal)}</td>
                {isLocalBackend ? (
                  <>
                    <td className="p-4 text-xs font-mono text-orange-400">
                      {boqColumnSums.actualConsumed > 0 ? formatMoney(boqColumnSums.actualConsumed) : '—'}
                    </td>
                    <td className="p-4" />
                  </>
                ) : null}
              </tr>
            </tbody>
          ) : null}

          {showVoInline ? (
            <VoOrdersPanel
              inline
              contractId={selectedContractId}
              canWrite={canWriteVo}
              canApprove={canApproveVo}
              theme={theme}
              refreshSignal={voRefreshKey}
              highlightOrderId={voHighlightId}
              boqItemsById={boqItemsById}
              onOrdersLoaded={handleVoOrdersLoaded}
              colSpan={boqTableColSpan}
              hasLocalExtraCols={isLocalBackend}
              onChanged={() => {
                setDataRefreshKey((k) => k + 1);
                setVoRefreshKey((k) => k + 1);
                setVoHighlightId(null);
              }}
              onNewOrder={() => setVoModalOpen(true)}
              onPrint={handlePrintVo}
            />
          ) : null}

          {!loading && showVoInline && (baseItems.length > 0 || voOrders.length > 0) ? (
            <tbody>
              <tr
                className={cn(
                  'border-t-2 font-bold text-[11px]',
                  theme === 'dark' ? 'bg-blue-950/50 border-blue-800 text-blue-100' :
                  theme === 'soft' ? 'bg-blue-50 border-blue-200 text-[#37474f]' :
                  'bg-blue-50 border-blue-200 text-blue-900',
                )}
              >
                <td
                  className={cn(
                    'p-4 sticky right-0 z-10 border-l shadow-[inset_1px_0_0_rgba(0,0,0,0.06)]',
                    theme === 'dark' ? 'bg-blue-950/70 border-blue-800' : theme === 'soft' ? 'bg-blue-50 border-blue-200' : 'bg-blue-50 border-blue-200',
                  )}
                />
                <td colSpan={12} className="p-4 text-xs uppercase tracking-wide">
                  {t('boq_grand_total')}
                </td>
                <td className="p-4" />
                <td className="p-4" />
                <td className="p-4" />
                <td className="p-4" />
                <td className="p-4" />
                <td className="p-4" />
                <td className="p-4 text-sm text-blue-500">{formatNumber(grandBoqTotal)}</td>
                {isLocalBackend ? (
                  <>
                    <td className="p-4" />
                    <td className="p-4" />
                  </>
                ) : null}
              </tr>
            </tbody>
          ) : null}
        </table>
      </div>

      {VoPrintHost}

      {/* Modals */}
      <AnimatePresence>
        {confirmConfig.isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={cn(
                "border rounded-2xl w-full max-w-md overflow-hidden shadow-2xl",
                theme === 'dark' ? "bg-[#151619] border-gray-800" : 
                theme === 'soft' ? "bg-white border-[#cfd8dc]" : 
                "bg-white border-gray-200"
              )}
            >
              <div className={cn(
                "p-6 border-b flex justify-between items-center",
                theme === 'dark' ? "bg-gray-900/50 border-gray-800" : 
                theme === 'soft' ? "bg-[#eceff1] border-[#cfd8dc]" : 
                "bg-gray-50 border-gray-200"
              )}>
                <h3 className="text-lg font-bold text-red-500">{confirmConfig.title}</h3>
                <button onClick={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))} className="text-gray-500 hover:text-red-500 transition-colors">
                  <X size={20} />
                </button>
              </div>
              <div className="p-6">
                <p className={theme === 'dark' ? "text-gray-300" : "text-gray-600"}>{confirmConfig.message}</p>
              </div>
              <div className={cn(
                "p-6 border-t flex justify-end gap-3",
                theme === 'dark' ? "bg-gray-900/30 border-gray-800" : 
                theme === 'soft' ? "bg-[#eceff1] border-[#cfd8dc]" : 
                "bg-gray-50 border-gray-200"
              )}>
                <button 
                  onClick={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                >
                  {t('cancel')}
                </button>
                <button 
                  onClick={confirmConfig.onConfirm}
                  disabled={isSubmitting}
                  className="px-6 py-2 rounded-lg text-sm font-bold bg-red-600 hover:bg-red-500 text-white transition-colors flex items-center gap-2"
                >
                  {isSubmitting && <Loader2 className="animate-spin" size={16} />}
                  {t('confirm')}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {voModalOpen && selectedContractId ? (
          <VoOrderModal
            contractId={selectedContractId}
            boqItems={items.map((item) => ({
              id: item.id,
              itemCode: item.itemCode,
              description: item.description,
              unit: item.unit,
              tenderQty: item.tenderQty,
              unitRateTotal: item.unitRateTotal,
              chapterCode: item.chapterCode,
              chapterName: item.chapterName,
              workTypeCode: item.workTypeCode,
              sectionCode: item.sectionCode,
              sectionName: item.sectionName,
            }))}
            theme={theme}
            dir={dir}
            onClose={() => setVoModalOpen(false)}
            onCreated={() => {
              setVoRefreshKey((k) => k + 1);
            }}
          />
        ) : null}

        <ContractFormModal
          isOpen={isContractModalOpen}
          isSubmitting={isSubmitting}
          onSubmit={handleContractSubmit}
          onClose={() => setIsContractModalOpen(false)}
          theme={theme}
          language={language}
        />
        <BOQItemFormModal
          isOpen={isModalOpen}
          editingItem={editingItem}
          variant={boqModalVariant}
          initialData={boqModalInitialData}
          contractId={selectedContractId || undefined}
          isSubmitting={isSubmitting}
          onSubmit={handleSubmit}
          onClose={() => {
            setIsModalOpen(false);
            setEditingItem(null);
            setBoqModalVariant('default');
          }}
          theme={theme}
          language={language}
          existingItems={items}
        />
      </AnimatePresence>

      {materialsModal && (
        <BoqMaterialsModal
          boqItemId={materialsModal.boqItemId}
          itemLabel={materialsModal.label}
          boqHint={materialsModal.boqHint}
          onClose={() => setMaterialsModal(null)}
        />
      )}

      <AdminSensitiveVerifyModal
        open={adminVerifyOpen}
        onOpenChange={(v) => {
          setAdminVerifyOpen(v);
          if (!v) sensitiveClearBoqRef.current = null;
        }}
        language={language as 'ar' | 'en'}
        theme={theme}
        onVerified={async () => {
          const fn = sensitiveClearBoqRef.current;
          sensitiveClearBoqRef.current = null;
          if (fn) await fn();
        }}
      />

      {deleteBlockedModal && (
        <DeleteBlockedModal
          itemCode={deleteBlockedModal.itemCode}
          itemDescription={deleteBlockedModal.itemDescription}
          linkCount={deleteBlockedModal.linkCount}
          consumptionCount={deleteBlockedModal.consumptionCount}
          actualCostCount={deleteBlockedModal.actualCostCount}
          language={language as 'ar' | 'en'}
          theme={theme}
          onClose={() => setDeleteBlockedModal(null)}
        />
      )}
    </div>
  );
}

