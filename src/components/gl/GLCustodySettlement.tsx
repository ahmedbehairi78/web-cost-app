import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Trash2, FileDown, FileUp, Loader2, X, Save, Search, Printer,
} from 'lucide-react';
import {
  collection, addDoc, updateDoc, doc, getDoc, serverTimestamp, query, where, orderBy, getDocs,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { accountingService, Account, invalidateCoaCache } from '../../services/accountingService';
import { AccountModal } from './AccountModal';
import { SearchableSelect } from '../ui/SearchableSelect';
import { cn } from '../../lib/utils';
import { businessTodayYmd } from '../../lib/businessCalendar';
import { formatMoney as formatMoneyLib, roundMoney } from '../../lib/money';
import toast from 'react-hot-toast';
import { useLanguage } from '../../context/LanguageContext';
import { motion, AnimatePresence } from 'motion/react';
import { isLocalBackend } from '../../lib/dataBackend';
import { ApiError } from '../../lib/apiClient';
import { boqApi, chartOfAccountsApi, custodySettlementsApi, costCentersApi, settingsApi } from '../../services/local/modulesApi';
import { ensureLocalProjectExists } from '../../lib/localEntitySync';
import { buildCostCenterSelectOptions, isDirectCostCenterId } from '../../lib/costCenterPicker';
import { listenQuery } from '../../lib/firestoreListen';
import { buildCustodySettlementSections } from '../../lib/reportDocument';
import type { CompanyPrintInfo } from '../../lib/ipcPrintData';
import { useReportDocumentPreview } from '../../hooks/useReportDocumentPreview';
import { useApiQuery } from '../../hooks/useApiQuery';
import { CustodySettlementDetail } from '../actualCosts/CustodySettlementDetail';
import type { BOQItem } from '../../types';

function formatSaveError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) {
    try {
      const parsed = JSON.parse(error.message) as { error?: string };
      if (parsed?.error) return parsed.error;
    } catch {
      /* plain message */
    }
    return error.message;
  }
  return String(error);
}

interface Transaction {
  id: string;
  date: string;
  description: string;
  reference: string;
  costCenterId?: string;
  isDeleted?: boolean;
  entries: { accountCode: string; accountName: string; debit: number; credit: number }[];
  createdBy: string;
}

interface ContractOption {
  id: string;
  contractName: string;
  contractNumber: string;
  contractNameEn?: string | null;
  projectId?: string;
}

interface ProjectOption {
  id: string;
  projectName: string;
  projectNameEn?: string | null;
  projectCode?: string;
}

export type CustodySettlementStatus = 'draft' | 'submitted' | 'approved';

export interface CustodySettlementItem {
  id: string;
  contractId: string;
  accountCode: string;
  accountName: string;
  amount: number;
  description: string;
  /** Optional — report allocation to BOQ on approve only; no GL impact. */
  boqItemId?: string;
}

export interface CustodySettlementRecord {
  id: string;
  projectId: string;
  settlementNumber: string;
  custodyAccountCode: string;
  custodyAccountName?: string;
  date: string;
  description?: string;
  totalAmount: number;
  status: CustodySettlementStatus;
  transactionIds?: string[];
  items: CustodySettlementItem[];
}

interface Props {
  accounts: Account[];
  transactions: Transaction[];
  contracts: ContractOption[];
  projects?: ProjectOption[];
  theme: string;
  language: string;
  dir: string;
  /** Can create/edit/submit custody settlements (costs_custody). */
  allowLedgerCreate?: boolean;
  /** Accounting manager — can approve and post GL. */
  canApproveSettlement?: boolean;
  /** Open a specific settlement (from notifications). */
  initialOpenId?: string | null;
  onSettlementSaved?: () => void | Promise<void>;
  onCoaChanged?: () => void | Promise<void>;
}

function emptyItem(): CustodySettlementItem {
  return {
    id: crypto.randomUUID(),
    contractId: '',
    accountCode: '',
    accountName: '',
    amount: 0,
    description: '',
    boqItemId: '',
  };
}

function emptyForm(language: string) {
  return {
    projectId: '',
    date: businessTodayYmd(),
    description: language === 'ar' ? 'تسوية عهدة' : 'Custody Settlement',
    items: [emptyItem()],
  };
}

function isPosted(row: CustodySettlementRecord): boolean {
  return row.status === 'approved' || (Array.isArray(row.transactionIds) && row.transactionIds.length > 0);
}

export function GLCustodySettlement({
  accounts,
  transactions,
  contracts,
  projects = [],
  theme,
  language,
  dir,
  allowLedgerCreate = true,
  canApproveSettlement = false,
  initialOpenId = null,
  onSettlementSaved,
  onCoaChanged,
}: Props) {
  const { t } = useLanguage();
  const formatMoney = (value: number) => formatMoneyLib(value);

  const [companyInfo, setCompanyInfo] = useState<CompanyPrintInfo>({ companyName: '' });
  useEffect(() => {
    const fetchCompanyInfo = async () => {
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
    void fetchCompanyInfo();
  }, []);

  const { openDocPreview, ReportPreviewHost } = useReportDocumentPreview({
    language: language === 'en' ? 'en' : 'ar',
    t,
    formatMoney,
    companyInfo,
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [filterProjectId, setFilterProjectId] = useState('');
  const [custodyStatusFilter, setCustodyStatusFilter] = useState<'all' | CustodySettlementStatus>('all');
  const [selectedSettlementId, setSelectedSettlementId] = useState<string | null>(null);
  const [fsSettlements, setFsSettlements] = useState<CustodySettlementRecord[]>([]);
  const [fsLoading, setFsLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedCustodyAccount, setSelectedCustodyAccount] = useState('');
  const [form, setForm] = useState(emptyForm(language));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const saveModeRef = useRef<'draft' | 'submit' | 'approve'>('submit');

  const [isCustodyAccountModalOpen, setIsCustodyAccountModalOpen] = useState(false);
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [newExpenseData, setNewExpenseData] = useState({ accountName: '', accountNameEn: '', parentCode: '' });
  const [indirectCenters, setIndirectCenters] = useState<
    Array<{ id: string; code: string; name: string; nameEn?: string | null; isActive?: boolean }>
  >([]);

  const { data: apiSettlements = [], loading: apiLoading } = useApiQuery(
    () =>
      custodySettlementsApi.list(
        filterProjectId ? `?projectId=${encodeURIComponent(filterProjectId)}` : '',
      ),
    [filterProjectId, refreshKey],
    { enabled: isLocalBackend },
  );

  const { data: apiBoqItems = [] } = useApiQuery<BOQItem>(
    async () => {
      const rows = (await boqApi.list()) as BOQItem[];
      return rows.filter((b) => b.isDeleted !== true);
    },
    [refreshKey],
    { enabled: isLocalBackend },
  );

  useEffect(() => {
    if (!isLocalBackend) return;
    void costCentersApi.list('indirect').then((rows) => {
      setIndirectCenters(rows as typeof indirectCenters);
    }).catch(() => setIndirectCenters([]));
  }, []);

  useEffect(() => {
    if (isLocalBackend) return;
    setFsLoading(true);
    const q = filterProjectId
      ? query(
          collection(db, 'custody_settlements'),
          where('isDeleted', '==', false),
          where('projectId', '==', filterProjectId),
          orderBy('createdAt', 'desc'),
        )
      : query(
          collection(db, 'custody_settlements'),
          where('isDeleted', '==', false),
          orderBy('createdAt', 'desc'),
        );
    const unsub = listenQuery(
      q,
      (snap) => {
        setFsSettlements(
          snap.docs.map((d) => {
            const data = d.data() as Omit<CustodySettlementRecord, 'id'>;
            return {
              ...data,
              id: d.id,
              totalAmount: Number(data.totalAmount) || 0,
              items: Array.isArray(data.items) ? data.items : [],
              transactionIds: Array.isArray(data.transactionIds) ? data.transactionIds : [],
            };
          }),
        );
        setFsLoading(false);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'custody_settlements');
        setFsLoading(false);
      },
    );
    return () => unsub();
  }, [filterProjectId, refreshKey]);

  const settlements: CustodySettlementRecord[] = useMemo(() => {
    if (isLocalBackend) {
      return (apiSettlements as CustodySettlementRecord[]).map((row) => ({
        ...row,
        totalAmount: Number(row.totalAmount) || 0,
        items: Array.isArray(row.items) ? row.items : [],
        transactionIds: Array.isArray(row.transactionIds) ? row.transactionIds : [],
      }));
    }
    return fsSettlements;
  }, [apiSettlements, fsSettlements]);

  const loading = isLocalBackend ? apiLoading : fsLoading;

  const editingRecord = useMemo(
    () => (editingId ? settlements.find((s) => s.id === editingId) ?? null : null),
    [editingId, settlements],
  );
  const formReadOnly = editingRecord != null && isPosted(editingRecord);
  const canApproveEditing =
    canApproveSettlement
    && editingRecord != null
    && editingRecord.status === 'submitted'
    && !isPosted(editingRecord);

  const costCenterOptions = useMemo(
    () =>
      buildCostCenterSelectOptions(
        contracts,
        projects,
        indirectCenters.filter((c) => c.isActive !== false),
        language === 'en' ? 'en' : 'ar',
      ).map(({ value, label, secondary }) => ({ value, label, secondary })),
    [contracts, projects, indirectCenters, language],
  );

  const projectLabel = useCallback(
    (projectId: string) => {
      const p = projects.find((x) => x.id === projectId);
      if (!p) return projectId.slice(0, 8);
      return language === 'ar' ? p.projectName : (p.projectNameEn || p.projectName);
    },
    [projects, language],
  );

  const filteredSettlements = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    let list = settlements;
    if (custodyStatusFilter !== 'all') {
      list = list.filter((s) => {
        if (custodyStatusFilter === 'approved') return isPosted(s) || s.status === 'approved';
        return s.status === custodyStatusFilter && !isPosted(s);
      });
    }
    if (!q) return list;
    return list.filter((s) => {
      const hay = [
        s.settlementNumber,
        s.custodyAccountCode,
        s.custodyAccountName,
        s.description,
        projectLabel(s.projectId),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [settlements, searchTerm, projectLabel, custodyStatusFilter]);

  const selectedSettlement = useMemo(
    () => (selectedSettlementId ? settlements.find((s) => s.id === selectedSettlementId) ?? null : null),
    [selectedSettlementId, settlements],
  );

  const custodyStatusCounts = useMemo(() => {
    const counts = { all: settlements.length, draft: 0, submitted: 0, approved: 0 };
    for (const row of settlements) {
      if (isPosted(row) || row.status === 'approved') counts.approved += 1;
      else if (row.status === 'submitted') counts.submitted += 1;
      else counts.draft += 1;
    }
    return counts;
  }, [settlements]);

  const custodyBalance = useMemo(() => {
    if (!selectedCustodyAccount) return 0;
    const code = String(selectedCustodyAccount).trim();
    return transactions.reduce((sum, tx) => {
      if (tx.isDeleted) return sum;
      const entries = (tx.entries ?? []).filter(
        (e) => String(e.accountCode ?? '').trim() === code,
      );
      return sum + entries.reduce(
        (s, e) => s + (Number(e.debit) || 0) - (Number(e.credit) || 0),
        0,
      );
    }, 0);
  }, [transactions, selectedCustodyAccount]);

  const totalSettlement = form.items.reduce((s, i) => s + Number(i.amount), 0);

  const expenseParentGroups = useMemo(
    () => accounts.filter((a) => a.isGroup && a.accountCode.startsWith('5') && a.accountCode.length === 5),
    [accounts],
  );

  const computedExpenseCode = useMemo(() => {
    if (!newExpenseData.parentCode) return '';
    const siblings = accounts.filter((a) => a.parentCode === newExpenseData.parentCode);
    const codes = siblings.map((a) => parseInt(a.accountCode, 10)).filter((n) => !isNaN(n));
    const parentNum = parseInt(newExpenseData.parentCode, 10);
    const defaultBase = parentNum * 1000 + 1;
    const maxCode = codes.length > 0 ? Math.max(...codes) : defaultBase - 1;
    return String(maxCode + 1);
  }, [newExpenseData.parentCode, accounts]);

  const openNewSettlement = () => {
    setEditingId(null);
    setSelectedCustodyAccount('');
    setForm(emptyForm(language));
    setModalOpen(true);
  };

  const openSettlementModal = (row: CustodySettlementRecord) => {
    setEditingId(row.id);
    setSelectedCustodyAccount(row.custodyAccountCode);
    setForm({
      projectId: row.projectId,
      date: row.date,
      description: row.description || (language === 'ar' ? 'تسوية عهدة' : 'Custody Settlement'),
      items: row.items.length > 0
        ? row.items.map((i) => ({
            ...i,
            id: i.id || crypto.randomUUID(),
            boqItemId: i.boqItemId || '',
          }))
        : [emptyItem()],
    });
    setModalOpen(true);
  };

  const selectSettlement = (row: CustodySettlementRecord) => {
    setSelectedSettlementId(row.id);
  };

  useEffect(() => {
    if (!initialOpenId || settlements.length === 0) return;
    setSelectedSettlementId(initialOpenId);
  }, [initialOpenId, settlements]);

  useEffect(() => {
    setSelectedSettlementId(null);
  }, [filterProjectId, custodyStatusFilter]);

  const handleItemChange = (idx: number, field: string, value: string | number) => {
    const next = [...form.items];
    next[idx] = { ...next[idx], [field]: value };
    if (field === 'accountCode') {
      const acc = accounts.find((a) => a.accountCode === value);
      if (acc) next[idx] = { ...next[idx], accountName: acc.accountName };
    }
    if (field === 'contractId') {
      next[idx] = { ...next[idx], boqItemId: '' };
    }
    setForm({ ...form, items: next });
  };

  const boqOptionsForContract = useCallback(
    (contractId: string) => {
      const cid = String(contractId || '').trim();
      if (!cid) return [];
      return apiBoqItems
        .filter((b) => String(b.contractId || '') === cid)
        .map((b) => ({
          value: b.id,
          secondary: b.itemCode,
          label: `${b.itemCode} — ${b.description || ''}`.trim(),
        }));
    },
    [apiBoqItems],
  );

  const validateForm = (): boolean => {
    if (!form.projectId) {
      toast.error(language === 'ar' ? 'اختر المشروع.' : 'Select a project.');
      return false;
    }
    if (!selectedCustodyAccount) {
      toast.error(language === 'ar' ? 'اختر حساب العهدة أولاً.' : 'Select a custody account first.');
      return false;
    }
    if (totalSettlement <= 0) {
      toast.error(language === 'ar' ? 'أدخل مبالغ التسوية.' : 'Enter settlement amounts.');
      return false;
    }
    const validItems = form.items.filter((i) => i.accountCode.trim() && Number(i.amount) > 0);
    if (validItems.length === 0) {
      toast.error(t('toast_custody_min_expense_line'));
      return false;
    }
    const badLines = form.items.filter((i) => {
      const hasAcc = !!i.accountCode.trim();
      const amt = Number(i.amount);
      const hasAmt = amt > 0;
      return (hasAcc && !hasAmt) || (!hasAcc && hasAmt);
    });
    if (badLines.length > 0) {
      toast.error(t('toast_custody_bad_lines'));
      return false;
    }
    return true;
  };

  const buildPayload = (status: CustodySettlementStatus) => {
    const custodyAcc = accounts.find((a) => a.accountCode === selectedCustodyAccount);
    const items = form.items
      .filter((i) => i.accountCode.trim() && Number(i.amount) > 0)
      .map((i) => ({
        id: i.id,
        contractId: i.contractId || '',
        accountCode: i.accountCode.trim(),
        accountName: i.accountName || accounts.find((a) => a.accountCode === i.accountCode)?.accountName || '',
        amount: roundMoney(Number(i.amount)),
        description: i.description || '',
        ...(i.boqItemId?.trim() ? { boqItemId: i.boqItemId.trim() } : {}),
      }));
    return {
      projectId: form.projectId,
      custodyAccountCode: selectedCustodyAccount,
      custodyAccountName: custodyAcc?.accountName || '',
      date: form.date,
      description: form.description.trim(),
      totalAmount: roundMoney(items.reduce((s, i) => s + i.amount, 0)),
      status,
      items,
      transactionIds: [],
      isDeleted: false,
    };
  };

  const postCloudGl = async (settlementNumber: string) => {
    const custodyAcc = accounts.find((a) => a.accountCode === selectedCustodyAccount);
    const validItems = form.items.filter((i) => i.accountCode.trim() && Number(i.amount) > 0);
    const groups = new Map<string, typeof validItems>();
    for (const item of validItems) {
      const key = item.contractId || '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }
    const txIds: string[] = [];
    let groupIndex = 0;
    for (const [costCenterKey, items] of groups) {
      const groupTotal = roundMoney(items.reduce((s, i) => s + Number(i.amount), 0));
      if (groupTotal <= 0) continue;
      groupIndex += 1;
      const isDirect = costCenterKey && isDirectCostCenterId(costCenterKey, contracts);
      const contract = isDirect ? contracts.find((c) => c.id === costCenterKey) : undefined;
      const projectId = form.projectId || String(contract?.projectId || '').trim();
      const txId = await accountingService.createTransaction({
        date: form.date,
        description: form.description.trim(),
        reference: `${settlementNumber}-${groupIndex}`,
        ...(costCenterKey
          ? { costCenterId: costCenterKey, ...(projectId ? { projectId } : {}) }
          : projectId ? { projectId } : {}),
        entries: [
          {
            accountCode: selectedCustodyAccount,
            accountName: custodyAcc?.accountName || '',
            debit: 0,
            credit: groupTotal,
          },
          ...items.map((item) => ({
            accountCode: item.accountCode.trim(),
            accountName:
              item.accountName || accounts.find((a) => a.accountCode === item.accountCode)?.accountName || '',
            debit: Number(item.amount),
            credit: 0,
          })),
        ],
      });
      txIds.push(txId);
    }
    return txIds;
  };

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (formReadOnly) return;
    const mode = saveModeRef.current;
    if (mode !== 'approve' && !allowLedgerCreate) {
      toast.error(t('toast_custody_no_post_permission'));
      return;
    }
    if (mode === 'approve' && !canApproveSettlement) {
      toast.error(language === 'ar' ? 'اعتماد مدير الحسابات فقط.' : 'Accounting manager approval only.');
      return;
    }
    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      const status: CustodySettlementStatus =
        mode === 'draft' ? 'draft' : mode === 'approve' ? 'approved' : 'submitted';

      if (isLocalBackend) {
        const projectHint = projects.find((p) => p.id === form.projectId);
        await ensureLocalProjectExists(form.projectId, {
          projectName: projectHint?.projectName,
          projectCode: projectHint?.projectCode,
        });

        if (mode === 'approve' && editingId) {
          await custodySettlementsApi.approve(editingId);
        } else if (editingId) {
          await custodySettlementsApi.update(editingId, buildPayload(status));
        } else {
          await custodySettlementsApi.create(buildPayload(status));
        }
      } else {
        const payload = buildPayload(status);
        if (mode === 'approve' && editingRecord) {
          const txIds = await postCloudGl(editingRecord.settlementNumber);
          await updateDoc(doc(db, 'custody_settlements', editingId!), {
            status: 'approved',
            transactionIds: txIds,
            ...payload,
            updatedAt: serverTimestamp(),
          });
        } else if (editingId) {
          await updateDoc(doc(db, 'custody_settlements', editingId), {
            ...payload,
            updatedAt: serverTimestamp(),
          });
        } else {
          const project = projects.find((p) => p.id === form.projectId);
          const code = (project?.projectCode || 'PRJ').replace(/[^A-Za-z0-9-]/g, '').slice(0, 20);
          const prefix = `SET-${code}-`;
          const existing = await getDocs(
            query(
              collection(db, 'custody_settlements'),
              where('projectId', '==', form.projectId),
              where('isDeleted', '==', false),
            ),
          );
          let seq = 1;
          for (const d of existing.docs) {
            const num = String(d.data().settlementNumber || '');
            const m = num.match(/-(\d+)$/);
            if (m && num.startsWith(prefix)) seq = Math.max(seq, parseInt(m[1], 10) + 1);
          }
          const settlementNumber = `${prefix}${String(seq).padStart(4, '0')}`;
          await addDoc(collection(db, 'custody_settlements'), {
            ...payload,
            settlementNumber,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }

      setRefreshKey((k) => k + 1);
      setModalOpen(false);
      setEditingId(null);
      await onSettlementSaved?.();
      toast.success(
        mode === 'approve'
          ? (language === 'ar' ? 'تم اعتماد التسوية وترحيل القيد.' : 'Settlement approved and posted.')
          : mode === 'draft'
            ? t('toast_custody_draft_saved')
            : (language === 'ar' ? 'تم تقديم التسوية للاعتماد.' : 'Settlement submitted for approval.'),
      );
    } catch (error) {
      console.error('Custody settlement save failed:', error);
      toast.error(formatSaveError(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveExpenseAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allowLedgerCreate) {
      toast.error(t('toast_custody_no_add_coa'));
      return;
    }
    if (!newExpenseData.parentCode) {
      toast.error(t('toast_parent_account_required'));
      return;
    }
    if (!newExpenseData.accountNameEn.trim()) {
      toast.error(t('toast_english_name_required'));
      return;
    }
    setIsSubmitting(true);
    try {
      const payload = {
        accountCode: computedExpenseCode,
        accountName: newExpenseData.accountName || newExpenseData.accountNameEn,
        accountNameEn: newExpenseData.accountNameEn,
        parentCode: newExpenseData.parentCode,
        type: 'expense' as const,
        isGroup: false,
        status: 'active' as const,
      };
      if (isLocalBackend) {
        await chartOfAccountsApi.create(payload);
        await onCoaChanged?.();
      } else {
        await addDoc(collection(db, 'chart_of_accounts'), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }
      invalidateCoaCache();
      setIsExpenseModalOpen(false);
      setNewExpenseData({ accountName: '', accountNameEn: '', parentCode: '' });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'chart_of_accounts');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExportExcel = async (row?: CustodySettlementRecord) => {
    const XLSX = await import('xlsx');
    const items = row?.items ?? form.items;
    const ws = XLSX.utils.json_to_sheet(
      items.map((item) => ({
        'Cost Center': item.contractId,
        'Account Code': item.accountCode,
        'Account Name': item.accountName,
        Amount: item.amount,
        Description: item.description,
      })),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'CustodySettlement');
    const name = row?.settlementNumber || `Custody_${businessTodayYmd()}`;
    XLSX.writeFile(wb, `${name}.xlsx`);
  };

  const handleImportExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (formReadOnly || !allowLedgerCreate) {
      e.target.value = '';
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(evt.target?.result as string, { type: 'binary' });
      const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      const imported = (data as Record<string, unknown>[]).map((row) => ({
        id: crypto.randomUUID(),
        contractId: String(row['Cost Center'] || row['مركز التكلفة'] || ''),
        accountCode: String(row['Account Code'] || row['كود الحساب'] || ''),
        accountName: String(row['Account Name'] || row['اسم الحساب'] || ''),
        amount: Number(row.Amount || row['المبلغ'] || 0),
        description: String(row.Description || row['البيان'] || ''),
      })).filter((i) => i.accountCode && i.amount > 0);
      if (imported.length > 0) setForm((prev) => ({ ...prev, items: imported }));
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const custodyStatusText = (status: CustodySettlementStatus, posted: boolean) => {
    if (posted || status === 'approved') return language === 'ar' ? 'معتمد' : 'Approved';
    if (status === 'submitted') return language === 'ar' ? 'بانتظار الاعتماد' : 'Pending approval';
    return language === 'ar' ? 'مسودة' : 'Draft';
  };

  const costCenterDisplay = (id: string) => {
    if (!id) return '—';
    const c = contracts.find((x) => x.id === id);
    if (c) return `${c.contractName} (${c.contractNumber})`;
    const ic = indirectCenters.find((x) => x.id === id);
    if (ic) return language === 'en' ? (ic.nameEn || ic.name) : ic.name;
    return id.slice(0, 8);
  };

  const openSettlementDocPreview = (record: CustodySettlementRecord) => {
    const isArLang = language !== 'en';
    const posted = isPosted(record);
    const custodyName = record.custodyAccountName
      || accounts.find((a) => a.accountCode === record.custodyAccountCode)?.accountName
      || '';
    openDocPreview({
      reportId: 'custody_settlement',
      title: isArLang
        ? `تسوية عهدة — ${record.settlementNumber}`
        : `Custody Settlement — ${record.settlementNumber}`,
      scopeLabel: projectLabel(record.projectId),
      dateLabel: record.date,
      columns: [],
      rows: [],
      sections: buildCustodySettlementSections(
        {
          settlementNumber: record.settlementNumber,
          date: record.date,
          projectLabel: projectLabel(record.projectId),
          custodyAccountLabel: custodyName
            ? `${custodyName} (${record.custodyAccountCode})`
            : record.custodyAccountCode,
          statusLabel: custodyStatusText(record.status, posted),
          postedLabel: posted ? (isArLang ? 'مرحّل في دفتر اليومية' : 'Posted to GL') : undefined,
          description: record.description,
          totalAmount: Number(record.totalAmount) || 0,
          items: record.items.map((item) => ({
            costCenterLabel: costCenterDisplay(item.contractId),
            accountName: item.accountName,
            accountCode: item.accountCode,
            description: item.description,
            amount: Number(item.amount) || 0,
          })),
        },
        isArLang ? 'ar' : 'en',
        formatMoney,
      ),
      filename: `custody-${record.settlementNumber || 'draft'}`,
    });
  };

  const handlePrint = () => {
    // Modal print — current form values (may include unsaved edits).
    openSettlementDocPreview({
      id: editingId ?? '',
      projectId: form.projectId,
      settlementNumber: editingRecord?.settlementNumber || (language === 'ar' ? 'مسودة' : 'Draft'),
      custodyAccountCode: selectedCustodyAccount,
      custodyAccountName: accounts.find((a) => a.accountCode === selectedCustodyAccount)?.accountName,
      date: form.date,
      description: form.description,
      totalAmount: roundMoney(form.items.reduce((s, i) => s + (Number(i.amount) || 0), 0)),
      status: editingRecord?.status ?? 'draft',
      transactionIds: editingRecord?.transactionIds,
      items: form.items.filter((i) => i.accountCode || Number(i.amount) > 0),
    });
  };

  const handlePrintSelected = () => {
    if (selectedSettlement) openSettlementDocPreview(selectedSettlement);
  };

  const contractLabel = useCallback(
    (contractId: string) => {
      const c = contracts.find((x) => x.id === contractId);
      if (!c) return contractId.slice(0, 8);
      return `${c.contractName} (${c.contractNumber})`;
    },
    [contracts],
  );

  const cardCls = cn(
    'rounded-xl border p-4',
    theme === 'dark' ? 'border-gray-800 bg-gray-900/40' : 'border-gray-200 bg-white shadow-sm',
  );
  const sectionTitleCls = 'text-xs font-bold uppercase tracking-wide text-gray-500';
  const selectCls = cn(
    'w-full rounded-lg border px-3 py-2 text-sm font-bold outline-none focus:border-blue-500 transition-colors',
    theme === 'dark' ? 'bg-gray-900 border-gray-800 text-white' : 'bg-white border-gray-200 text-gray-900',
  );
  const labelCls = cn('block text-xs font-bold mb-1.5', theme === 'dark' ? 'text-gray-400' : 'text-gray-500');

  const inputCls = cn(
    'w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500 transition-colors',
    theme === 'dark' ? 'bg-gray-900 border-gray-800 text-gray-100' : 'bg-white border-gray-200 text-gray-900',
  );

  const custodyAccounts = accounts.filter(
    (a) => !a.isGroup && a.status !== 'disabled' && a.accountCode.startsWith('12102') && a.accountCode.length === 8,
  );

  const expenseAccounts = accounts.filter(
    (a) => !a.isGroup && a.status !== 'disabled' && a.accountCode.startsWith('5') && a.accountCode.length === 8,
  );

  const statusBadge = (status: CustodySettlementStatus, posted: boolean) => {
    if (posted || status === 'approved') {
      return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-900/40 text-green-400">
          {language === 'ar' ? 'معتمد' : 'Approved'}
        </span>
      );
    }
    if (status === 'submitted') {
      return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-900/40 text-amber-400">
          {language === 'ar' ? 'بانتظار الاعتماد' : 'Pending approval'}
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-800 text-gray-400">
        {language === 'ar' ? 'مسودة' : 'Draft'}
      </span>
    );
  };

  return (
    <>
      <div className={cn('flex flex-col md:flex-row md:items-start gap-4', dir === 'rtl' ? 'md:flex-row-reverse' : '')}>
        <div className="flex-1 min-w-0 md:flex-[3] space-y-4 order-2 md:order-none">
          {loading ? (
            <div className={cn('border rounded-xl p-12 text-center text-gray-500 flex flex-col items-center gap-4', theme === 'dark' ? 'border-gray-800 bg-[#151619]' : 'border-gray-200 bg-white')}>
              <Loader2 className="animate-spin text-blue-500" size={32} />
              {language === 'ar' ? 'جاري التحميل...' : 'Loading...'}
            </div>
          ) : filteredSettlements.length === 0 ? (
            <div className={cn('border rounded-xl p-12 text-center', theme === 'dark' ? 'border-gray-800 bg-[#151619]' : 'border-gray-200 bg-white')}>
              <p className={cn('text-sm', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>{t('costs_filter_empty')}</p>
            </div>
          ) : !selectedSettlement ? (
            <div className={cn('border rounded-xl p-12 text-center', theme === 'dark' ? 'border-gray-800 bg-[#151619]' : 'border-gray-200 bg-white')}>
              <p className={cn('text-sm', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>{t('costs_filter_select_record')}</p>
            </div>
          ) : (
            <div className={cn(cardCls, 'p-6 max-h-[calc(100vh-8rem)] overflow-y-auto')}>
              <CustodySettlementDetail
                settlement={selectedSettlement}
                theme={theme}
                language={language}
                formatMoney={formatMoney}
                projectLabel={projectLabel(selectedSettlement.projectId)}
                contractLabel={contractLabel}
                posted={isPosted(selectedSettlement)}
                canEdit={allowLedgerCreate && !isPosted(selectedSettlement)}
                onEdit={() => openSettlementModal(selectedSettlement)}
                onExport={() => void handleExportExcel(selectedSettlement)}
                onPrint={handlePrintSelected}
              />
            </div>
          )}
        </div>

        <aside className={cn(cardCls, 'w-full md:flex-[2] md:min-w-[17rem] md:max-w-[24rem] shrink-0 space-y-4 md:sticky md:top-4 order-1 md:order-none')}>
          <div>
            <h3 className="font-bold text-sm">{t('costs_filter_title')}</h3>
          </div>

          <div className="space-y-3">
            <div>
              <label className={labelCls}>{t('project')}</label>
              <select className={selectCls} value={filterProjectId} onChange={(e) => setFilterProjectId(e.target.value)}>
                <option value="">{language === 'ar' ? '— كل المشاريع —' : '— All projects —'}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {language === 'ar' ? p.projectName : (p.projectNameEn || p.projectName)} ({p.projectCode})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={cn('pt-3 border-t space-y-2', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
            <label className={labelCls}>{language === 'ar' ? 'تصفية حسب الحالة' : 'Filter by status'}</label>
            <select
              className={selectCls}
              value={custodyStatusFilter}
              onChange={(e) => setCustodyStatusFilter(e.target.value as 'all' | CustodySettlementStatus)}
            >
              <option value="all">{language === 'ar' ? `الكل (${custodyStatusCounts.all})` : `All (${custodyStatusCounts.all})`}</option>
              <option value="draft">{language === 'ar' ? 'مسودة' : 'Draft'} ({custodyStatusCounts.draft})</option>
              <option value="submitted">{language === 'ar' ? 'بانتظار الاعتماد' : 'Pending approval'} ({custodyStatusCounts.submitted})</option>
              <option value="approved">{language === 'ar' ? 'معتمد' : 'Approved'} ({custodyStatusCounts.approved})</option>
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
            ) : filteredSettlements.length === 0 ? (
              <p className="text-xs text-gray-500">{t('costs_filter_empty')}</p>
            ) : (
              <ul className="space-y-1 max-h-52 overflow-auto">
                {filteredSettlements.map((row, rowIdx) => {
                  const posted = isPosted(row);
                  const active = selectedSettlementId === row.id;
                  return (
                    <li key={row.id || `settlement-${row.settlementNumber}-${rowIdx}`}>
                      <button
                        type="button"
                        onClick={() => selectSettlement(row)}
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
                          <span className="font-bold shrink-0">{row.settlementNumber}</span>
                          <span className="text-xs opacity-80 shrink-0">{row.date}</span>
                          <span className="text-[10px] opacity-75 shrink-0">
                            {posted || row.status === 'approved'
                              ? (language === 'ar' ? 'معتمد' : 'Approved')
                              : row.status === 'submitted'
                                ? (language === 'ar' ? 'بانتظار الاعتماد' : 'Pending')
                                : (language === 'ar' ? 'مسودة' : 'Draft')}
                          </span>
                          <span className="text-[10px] opacity-75 shrink-0 font-mono">{formatMoney(Number(row.totalAmount))}</span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {allowLedgerCreate && (
            <div className={cn('pt-3 border-t', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
              <button
                type="button"
                onClick={openNewSettlement}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-bold text-white bg-blue-600 hover:bg-blue-500 transition-colors"
              >
                <Plus size={16} />
                {language === 'ar' ? 'تسوية جديدة' : 'New settlement'}
              </button>
            </div>
          )}
        </aside>
      </div>

      <AnimatePresence>
        {modalOpen && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[55] p-2 sm:p-3">
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              className={cn('w-full max-w-[min(98vw,96rem)] max-h-[94vh] overflow-y-auto border rounded-2xl shadow-2xl', theme === 'dark' ? 'bg-[#1a1b1e] border-gray-800' : 'bg-white border-gray-200')}
            >
              <div className={cn('p-5 border-b flex justify-between items-center sticky top-0 z-10', theme === 'dark' ? 'border-gray-800 bg-[#1a1b1e]' : 'border-gray-200 bg-white')}>
                <div>
                  <h3 className="text-lg font-bold">
                    {editingRecord
                      ? editingRecord.settlementNumber
                      : (language === 'ar' ? 'تسوية عهدة جديدة' : 'New custody settlement')}
                  </h3>
                  {editingRecord && (
                    <div className="mt-1">{statusBadge(editingRecord.status, isPosted(editingRecord))}</div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => void handleExportExcel(editingRecord ?? undefined)} className="p-2 rounded-lg text-green-500 hover:bg-green-900/20" title={language === 'ar' ? 'تصدير إكسل' : 'Export Excel'}><FileDown size={18} /></button>
                  <button type="button" onClick={handlePrint} className="p-2 rounded-lg text-blue-500 hover:bg-blue-900/20" title={language === 'ar' ? 'طباعة' : 'Print'}><Printer size={18} /></button>
                  <button type="button" onClick={() => setModalOpen(false)} className="p-2 rounded-lg text-gray-500 hover:text-gray-300"><X size={20} /></button>
                </div>
              </div>

              <div className="p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] text-gray-500 font-bold uppercase">{language === 'ar' ? 'المشروع' : 'Project'} *</label>
                    <SearchableSelect
                      value={form.projectId}
                      onChange={(v) => !formReadOnly && setForm({ ...form, projectId: v })}
                      theme={theme}
                      dir={dir}
                      placeholder={language === 'ar' ? 'اختر المشروع' : 'Select project'}
                      options={projects.map((p) => ({
                        value: p.id,
                        label: language === 'ar' ? p.projectName : (p.projectNameEn || p.projectName),
                        secondary: p.projectCode,
                      }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <label className="text-[10px] text-gray-500 font-bold uppercase">{language === 'ar' ? 'حساب العهدة' : 'Custody account'} *</label>
                      {!formReadOnly && allowLedgerCreate && (
                        <button type="button" onClick={() => setIsCustodyAccountModalOpen(true)} className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1"><Plus size={10} />{language === 'ar' ? 'جديد' : 'New'}</button>
                      )}
                    </div>
                    <SearchableSelect
                      value={selectedCustodyAccount}
                      onChange={(v) => !formReadOnly && setSelectedCustodyAccount(v)}
                      theme={theme}
                      dir={dir}
                      placeholder={language === 'ar' ? 'اختر عهدة' : 'Select custody'}
                      options={custodyAccounts.map((acc) => ({
                        value: acc.accountCode,
                        secondary: acc.accountCode,
                        label: language === 'ar' ? acc.accountName : (acc.accountNameEn || acc.accountName),
                      }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-gray-500 font-bold uppercase">{language === 'ar' ? 'رصيد العهدة' : 'Custody balance'}</label>
                    <div className={cn('px-4 py-2 rounded-lg border font-mono font-bold', theme === 'dark' ? 'bg-gray-900 border-gray-800 text-blue-400' : 'bg-gray-50 border-gray-200 text-blue-600')}>
                      {formatMoney(custodyBalance)}
                    </div>
                  </div>
                  <div className="flex items-end gap-2">
                    {!formReadOnly && allowLedgerCreate && (
                      <label className={cn('flex-1 px-4 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2 text-white bg-blue-600 hover:bg-blue-500 cursor-pointer')}>
                        <FileUp size={16} />{language === 'ar' ? 'استيراد' : 'Import'}
                        <input type="file" className="hidden" accept=".xlsx,.xls" onChange={handleImportExcel} />
                      </label>
                    )}
                  </div>
                </div>

                <form onSubmit={handleSave} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] text-gray-500 font-bold uppercase">{language === 'ar' ? 'تاريخ التسوية' : 'Settlement date'}</label>
                      <input type="date" className={inputCls} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} disabled={formReadOnly} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-gray-500 font-bold uppercase">{language === 'ar' ? 'الوصف' : 'Description'}</label>
                      <input type="text" className={inputCls} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} disabled={formReadOnly} />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <h4 className="font-bold text-sm">{language === 'ar' ? 'بنود المصروفات' : 'Expense items'}</h4>
                      {!formReadOnly && allowLedgerCreate && (
                        <button type="button" onClick={() => setForm({ ...form, items: [...form.items, emptyItem()] })} className="text-xs text-blue-400 hover:text-blue-300 font-bold flex items-center gap-1"><Plus size={14} />{language === 'ar' ? 'إضافة بند' : 'Add item'}</button>
                      )}
                    </div>
                    <div className="space-y-3">
                      {form.items.map((item, idx) => (
                        <div key={item.id} className={cn('grid grid-cols-1 md:grid-cols-12 gap-3 items-end p-3 rounded-lg border', theme === 'dark' ? 'bg-gray-900/40 border-gray-800' : 'bg-gray-50 border-gray-200')}>
                          <div className="md:col-span-2 space-y-1">
                            <label className="text-[10px] text-gray-500 uppercase">{language === 'ar' ? 'مركز التكلفة' : 'Cost center'}</label>
                            <SearchableSelect value={item.contractId} onChange={(v) => !formReadOnly && handleItemChange(idx, 'contractId', v)} theme={theme} dir={dir} placeholder={language === 'ar' ? 'بدون مركز' : 'No center'} options={costCenterOptions} />
                          </div>
                          <div className="md:col-span-2 space-y-1">
                            <div className="flex justify-between items-center">
                              <label className="text-[10px] text-gray-500 uppercase">{language === 'ar' ? 'مصروف' : 'Expense'}</label>
                              {!formReadOnly && allowLedgerCreate && (
                                <button type="button" onClick={() => setIsExpenseModalOpen(true)} className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1"><Plus size={10} />{language === 'ar' ? 'جديد' : 'New'}</button>
                              )}
                            </div>
                            <SearchableSelect value={item.accountCode} onChange={(v) => !formReadOnly && handleItemChange(idx, 'accountCode', v)} theme={theme} dir={dir} placeholder={language === 'ar' ? 'اختر مصروف' : 'Select expense'} options={expenseAccounts.map((acc) => ({ value: acc.accountCode, secondary: acc.accountCode, label: language === 'ar' ? acc.accountName : (acc.accountNameEn || acc.accountName) }))} />
                          </div>
                          <div className="md:col-span-2 space-y-1">
                            <label className="text-[10px] text-gray-500 uppercase">{language === 'ar' ? 'المبلغ' : 'Amount'}</label>
                            <input type="number" step="0.01" className={cn(inputCls, 'text-blue-400')} value={item.amount || ''} onChange={(e) => handleItemChange(idx, 'amount', e.target.value)} disabled={formReadOnly} />
                          </div>
                          <div className="md:col-span-3 space-y-1">
                            <label className="text-[10px] text-gray-500 uppercase">{t('custody_boq_optional')}</label>
                            <SearchableSelect
                              value={item.boqItemId || ''}
                              onChange={(v) => {
                                if (formReadOnly || !item.contractId) return;
                                handleItemChange(idx, 'boqItemId', v);
                              }}
                              theme={theme}
                              dir={dir}
                              placeholder={t('custody_boq_none')}
                              options={
                                item.contractId
                                  ? [
                                      { value: '', label: t('custody_boq_none') },
                                      ...boqOptionsForContract(item.contractId),
                                    ]
                                  : [{ value: '', label: t('custody_boq_pick_contract_first') }]
                              }
                            />
                          </div>
                          <div className="md:col-span-2 space-y-1">
                            <label className="text-[10px] text-gray-500 uppercase">{language === 'ar' ? 'ملاحظات' : 'Notes'}</label>
                            <input type="text" className={inputCls} value={item.description} onChange={(e) => handleItemChange(idx, 'description', e.target.value)} disabled={formReadOnly} />
                          </div>
                          <div className="md:col-span-1 flex justify-center pb-2">
                            {!formReadOnly && allowLedgerCreate && (
                              <button type="button" onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) })} className="text-gray-500 hover:text-red-500"><Trash2 size={18} /></button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className={cn('pt-6 border-t flex flex-wrap justify-between items-center gap-4', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
                    <div className="text-xl font-bold">
                      <span className="text-gray-500 text-sm mr-2">{language === 'ar' ? 'الإجمالي:' : 'Total:'}</span>
                      <span className="text-blue-500 font-mono">{formatMoney(totalSettlement)}</span>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {!formReadOnly && allowLedgerCreate && (
                        <>
                          <button
                            type="button"
                            disabled={isSubmitting}
                            onClick={() => { saveModeRef.current = 'draft'; void handleSave(); }}
                            className={cn('px-5 py-2.5 rounded-xl font-bold flex items-center gap-2', theme === 'dark' ? 'bg-gray-800 hover:bg-gray-700 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700')}
                          >
                            <Save size={16} />
                            {language === 'ar' ? 'حفظ مسودة' : 'Save draft'}
                          </button>
                          <button
                            type="submit"
                            disabled={isSubmitting}
                            onClick={() => { saveModeRef.current = 'submit'; }}
                            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 px-6 py-2.5 rounded-xl font-bold text-white flex items-center gap-2"
                          >
                            {isSubmitting && saveModeRef.current === 'submit' && <Loader2 className="animate-spin" size={16} />}
                            {language === 'ar' ? 'تقديم للاعتماد' : 'Submit for approval'}
                          </button>
                        </>
                      )}
                      {canApproveEditing && (
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => { saveModeRef.current = 'approve'; void handleSave(); }}
                          className="bg-green-600 hover:bg-green-500 disabled:opacity-60 px-6 py-2.5 rounded-xl font-bold text-white flex items-center gap-2"
                        >
                          {isSubmitting && saveModeRef.current === 'approve' && <Loader2 className="animate-spin" size={16} />}
                          {language === 'ar' ? 'اعتماد وترحيل القيد' : 'Approve & post'}
                        </button>
                      )}
                    </div>
                  </div>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AccountModal isOpen={isCustodyAccountModalOpen} onClose={() => setIsCustodyAccountModalOpen(false)} accounts={accounts} theme={theme} language={language} defaultParentCode="12102" defaultType="asset" />

      <AnimatePresence>
        {isExpenseModalOpen && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[70] p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className={cn('w-full max-w-md border rounded-2xl shadow-2xl overflow-hidden', theme === 'dark' ? 'bg-[#1a1b1e] border-gray-800' : 'bg-white border-gray-200')}>
              <div className={cn('p-5 border-b flex justify-between items-center', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
                <h3 className="text-base font-bold">{language === 'ar' ? 'إضافة حساب مصروف' : 'New expense account'}</h3>
                <button type="button" onClick={() => setIsExpenseModalOpen(false)} className="text-gray-500 hover:text-gray-300"><X size={20} /></button>
              </div>
              <form onSubmit={handleSaveExpenseAccount} className="p-5 space-y-4">
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase font-bold">{language === 'ar' ? 'حساب الأب' : 'Parent'}</label>
                  <select required value={newExpenseData.parentCode} onChange={(e) => setNewExpenseData((p) => ({ ...p, parentCode: e.target.value }))} className={inputCls}>
                    <option value="">{language === 'ar' ? 'اختر' : 'Select'}</option>
                    {expenseParentGroups.map((a) => (
                      <option key={a.accountCode} value={a.accountCode}>{a.accountCode} — {language === 'ar' ? a.accountName : (a.accountNameEn || a.accountName)}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase font-bold">{language === 'ar' ? 'كود الحساب' : 'Code'}</label>
                  <input readOnly value={computedExpenseCode} className={cn(inputCls, 'opacity-60 font-mono')} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase font-bold">{language === 'ar' ? 'اسم عربي' : 'Arabic name'}</label>
                  <input type="text" value={newExpenseData.accountName} onChange={(e) => setNewExpenseData((p) => ({ ...p, accountName: e.target.value }))} className={inputCls} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase font-bold">{language === 'ar' ? 'اسم إنجليزي *' : 'English name *'}</label>
                  <input required type="text" dir="ltr" value={newExpenseData.accountNameEn} onChange={(e) => setNewExpenseData((p) => ({ ...p, accountNameEn: e.target.value }))} className={inputCls} />
                </div>
                <div className="pt-2 flex gap-3">
                  <button type="submit" disabled={isSubmitting || !computedExpenseCode} className="flex-1 bg-blue-600 hover:bg-blue-500 py-2 rounded-lg font-bold text-white text-sm">{language === 'ar' ? 'حفظ' : 'Save'}</button>
                  <button type="button" onClick={() => setIsExpenseModalOpen(false)} className={cn('flex-1 py-2 rounded-lg font-bold text-sm', theme === 'dark' ? 'bg-gray-800' : 'bg-gray-200')}>{language === 'ar' ? 'إلغاء' : 'Cancel'}</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {ReportPreviewHost}
    </>
  );
}
