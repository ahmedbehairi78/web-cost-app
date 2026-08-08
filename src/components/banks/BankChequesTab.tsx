import { formatNumber } from '../../lib/numberLocale';
import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  deleteField,
  query,
  Timestamp,
  where,
} from 'firebase/firestore';
import { listenQuery } from '../../lib/firestoreListen';
import toast from 'react-hot-toast';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { cn } from '../../lib/utils';
import { isLocalBackend } from '../../lib/dataBackend';
import { contractsApi, projectsApi, costCentersApi } from '../../services/local/modulesApi';
import type { Account } from '../../services/accountingService';
import { accountingService } from '../../services/accountingService';
import {
  createBankCheque,
  removeBankCheque,
  updateBankCheque,
} from '../../lib/bankPersistence';
import {
  buildChequeClearEntries,
  buildChequeIssueEntries,
  chequeClearRef,
  chequeIssueRef,
  validateReceivedIssueCredits,
} from '../../lib/bankChequePosting';
import type { BankAccount, BankCheque, ReceivedIssueCreditRow } from './types';
import { SearchableSelect } from '../ui/SearchableSelect';
import { ManualHelpButton } from '../help/ManualHelpButton';
import { useConfirm } from '../../context/ConfirmDialogContext';
import {
  buildCostCenterSelectOptions,
  resolveCostCenterSelection,
  shouldClearCostCenterOnProjectChange,
  type CostCenterSelectIndirect,
} from '../../lib/costCenterPicker';
import { coaIdToAccountCode, resolveBankGlAccountCode } from '../../lib/glAccountBalance';
import { GlAccountBalanceHint } from './GlAccountBalanceHint';

type Props = {
  cheques: BankCheque[];
  accounts: BankAccount[];
  coaAccounts: Account[];
  balanceByCode: Map<string, number>;
  glBalancesLoading?: boolean;
  language: 'ar' | 'en';
  theme: string;
  dir: 'rtl' | 'ltr';
  allowCreate: boolean;
  allowEdit: boolean;
  banksEdit: boolean;
  ledgerCreate: boolean;
  onMutated?: () => void;
  embedded?: boolean;
  panelMode?: 'create' | 'detail';
  selectedChequeId?: string;
  onChequeCreated?: (id: string) => void;
  onCancelCreate?: () => void;
  onDetailRemoved?: () => void;
};

interface ProjectRow {
  id: string;
  projectName: string;
  projectCode: string;
  projectNameEn?: string;
}

interface ContractRow {
  id: string;
  projectId: string;
  contractNumber: string;
  contractName?: string;
  contractNameEn?: string;
}

const COA_CODE_8 = /^\d{8}$/;

function displayStatus(c: BankCheque, isAr: boolean): string {
  const s = c.status === 'returned' ? 'rejected' : c.status;
  const map: Record<string, { ar: string; en: string }> = {
    draft: { ar: 'مسودة', en: 'Draft' },
    issued: { ar: 'محرّر', en: 'Issued' },
    received: { ar: 'مستلم', en: 'Received' },
    cleared: { ar: 'مُحصّل/مصروف', en: 'Cleared' },
    rejected: { ar: 'مرفوض', en: 'Rejected' },
    cancelled: { ar: 'ملغى', en: 'Cancelled' },
    returned: { ar: 'مرفوض', en: 'Rejected' },
  };
  return isAr ? (map[s]?.ar ?? s) : (map[s]?.en ?? s);
}

function mergeProjectContract(
  contracts: ContractRow[],
  indirectCenters: CostCenterSelectIndirect[],
  projectId: string,
  contractId: string,
): { projectId: string; contractId: string } {
  const resolved = resolveCostCenterSelection(
    contracts,
    indirectCenters,
    projectId,
    contractId,
  );
  return { projectId: resolved.projectId, contractId: resolved.costCenterId };
}

export function BankChequesTab({
  cheques,
  accounts,
  coaAccounts,
  balanceByCode,
  glBalancesLoading = false,
  language,
  theme,
  dir,
  allowCreate,
  allowEdit,
  banksEdit,
  ledgerCreate,
  onMutated,
  embedded = false,
  panelMode,
  selectedChequeId,
  onChequeCreated,
  onCancelCreate,
  onDetailRemoved,
}: Props) {
  const isAr = language === 'ar';
  const confirmDlg = useConfirm();
  const canPostLedger = banksEdit || ledgerCreate;
  const [filterDir, setFilterDir] = useState<'all' | 'issued' | 'received'>('all');
  const [saving, setSaving] = useState(false);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [indirectCenters, setIndirectCenters] = useState<CostCenterSelectIndirect[]>([]);
  const [form, setForm] = useState({
    direction: 'issued' as 'issued' | 'received',
    bankAccountId: '',
    chequeNo: '',
    payeeName: '',
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate: '',
    amount: '',
    offsetChartOfAccountId: '',
    projectId: '',
    contractId: '',
  });
  const [receiveMultiSplit, setReceiveMultiSplit] = useState(false);
  const [receiveCreditLines, setReceiveCreditLines] = useState<ReceivedIssueCreditRow[]>([
    { offsetChartOfAccountId: '', amount: 0 },
    { offsetChartOfAccountId: '', amount: 0 },
  ]);

  const [clearTarget, setClearTarget] = useState<BankCheque | null>(null);
  const [clearDate, setClearDate] = useState('');
  const [clearProjectId, setClearProjectId] = useState('');
  const [clearContractId, setClearContractId] = useState('');
  const [clearSaving, setClearSaving] = useState(false);

  const [issueModalCheque, setIssueModalCheque] = useState<BankCheque | null>(null);
  const [issueProjectId, setIssueProjectId] = useState('');
  const [issueContractId, setIssueContractId] = useState('');
  const [issueSaving, setIssueSaving] = useState(false);

  const inputCls = cn(
    'w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500 transition-colors',
    theme === 'dark'
      ? 'bg-gray-900 border-gray-700 text-white'
      : theme === 'soft'
        ? 'bg-white border-[#cfd8dc] text-[#37474f]'
        : 'bg-white border-gray-300 text-gray-900',
  );
  const panelCls = cn(
    'rounded-xl border',
    theme === 'dark'
      ? 'border-gray-800 bg-[#151619]'
      : theme === 'soft'
        ? 'border-[#cfd8dc] bg-white'
        : 'border-gray-200 bg-white',
  );

  const coaOptions = useMemo(
    () =>
      coaAccounts
        .filter((a) => !a.isGroup && a.status !== 'disabled' && COA_CODE_8.test(String(a.accountCode).trim()))
        .map((a) => ({
          value: a.id,
          label:
            language === 'ar'
              ? `${a.accountCode} — ${a.accountName}`
              : `${a.accountCode} — ${a.accountNameEn || a.accountName}`,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [coaAccounts, language],
  );

  const selectedBankAccount = useMemo(
    () => accounts.find((a) => a.id === form.bankAccountId),
    [accounts, form.bankAccountId],
  );

  const selectedBankGlCode = useMemo(
    () => (selectedBankAccount ? resolveBankGlAccountCode(selectedBankAccount, coaAccounts) : ''),
    [selectedBankAccount, coaAccounts],
  );

  const offsetGlCode = useMemo(
    () => coaIdToAccountCode(form.offsetChartOfAccountId, coaAccounts),
    [form.offsetChartOfAccountId, coaAccounts],
  );

  useEffect(() => {
    if (isLocalBackend) {
      let cancelled = false;
      void (async () => {
        try {
          const [pRows, cRows, iRows] = await Promise.all([
            projectsApi.list(),
            contractsApi.list(),
            costCentersApi.list('indirect'),
          ]);
          if (cancelled) return;
          setProjects(
            (Array.isArray(pRows) ? pRows : [])
              .filter((r) => (r as { isDeleted?: boolean }).isDeleted !== true)
              .map((r) => ({
                id: String((r as { id: string }).id),
                projectName: String((r as { projectName?: string }).projectName ?? ''),
                projectCode: String((r as { projectCode?: string }).projectCode ?? ''),
                projectNameEn: (r as { projectNameEn?: string }).projectNameEn,
              })),
          );
          setContracts(
            (Array.isArray(cRows) ? cRows : [])
              .filter((r) => (r as { isDeleted?: boolean }).isDeleted !== true)
              .map((r) => ({
                id: String((r as { id: string }).id),
                projectId: String((r as { projectId?: string }).projectId ?? ''),
                contractNumber: String((r as { contractNumber?: string }).contractNumber ?? ''),
                contractName: (r as { contractName?: string }).contractName,
                contractNameEn: (r as { contractNameEn?: string }).contractNameEn,
              })),
          );
          setIndirectCenters(
            (Array.isArray(iRows) ? iRows : [])
              .filter((r) => (r as { isActive?: boolean }).isActive !== false)
              .map((r) => ({
                id: String((r as { id: string }).id),
                code: String((r as { code?: string }).code ?? ''),
                name: String((r as { name?: string }).name ?? ''),
                nameEn: (r as { nameEn?: string | null }).nameEn,
              })),
          );
        } catch (err) {
          console.error('Failed to load projects/contracts for bank cheques:', err);
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    const unsubP = listenQuery(
      query(collection(db, 'projects'), where('isDeleted', '==', false)),
      (snap) => setProjects(snap.docs.map((d) => ({ ...d.data(), id: d.id } as ProjectRow))),
      (error) => handleFirestoreError(error, OperationType.LIST, 'projects'),
    );
    const unsubC = listenQuery(
      query(collection(db, 'contracts'), where('isDeleted', '==', false)),
      (snap) => setContracts(snap.docs.map((d) => ({ ...d.data(), id: d.id } as ContractRow))),
      (error) => handleFirestoreError(error, OperationType.LIST, 'contracts'),
    );
    return () => {
      unsubP();
      unsubC();
    };
  }, []);

  const newChequeContractOptions = useMemo(() => {
    const none = {
      value: '',
      label: isAr ? '— بدون مركز تكلفة —' : '— No cost center —',
    };
    const pid = form.projectId.trim();
    const filteredContracts = pid ? contracts.filter((c) => c.projectId === pid) : contracts;
    const opts = buildCostCenterSelectOptions(
      filteredContracts,
      projects,
      indirectCenters,
      language,
    ).map((o) => ({ value: o.value, label: o.label, secondary: o.secondary }));
    return [none, ...opts];
  }, [contracts, projects, indirectCenters, form.projectId, isAr, language]);

  const issueModalContractOptions = useMemo(() => {
    const none = {
      value: '',
      label: isAr ? '— بدون مركز تكلفة —' : '— No cost center —',
    };
    const pid = issueProjectId.trim();
    const filteredContracts = pid ? contracts.filter((c) => c.projectId === pid) : contracts;
    const opts = buildCostCenterSelectOptions(
      filteredContracts,
      projects,
      indirectCenters,
      language,
    ).map((o) => ({ value: o.value, label: o.label, secondary: o.secondary }));
    return [none, ...opts];
  }, [contracts, projects, indirectCenters, issueProjectId, isAr, language]);

  const clearModalContractOptions = useMemo(() => {
    const none = {
      value: '',
      label: isAr ? '— بدون مركز تكلفة —' : '— No cost center —',
    };
    const pid = clearProjectId.trim();
    const filteredContracts = pid ? contracts.filter((c) => c.projectId === pid) : contracts;
    const opts = buildCostCenterSelectOptions(
      filteredContracts,
      projects,
      indirectCenters,
      language,
    ).map((o) => ({ value: o.value, label: o.label, secondary: o.secondary }));
    return [none, ...opts];
  }, [contracts, projects, indirectCenters, clearProjectId, isAr, language]);

  const rows = useMemo(
    () =>
      cheques
        .filter((c) => (filterDir === 'all' ? true : c.direction === filterDir))
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate)),
    [cheques, filterDir],
  );

  const parseCreditsFromForm = (): ReceivedIssueCreditRow[] | null => {
    if (!receiveMultiSplit) return null;
    const lines: ReceivedIssueCreditRow[] = [];
    for (const row of receiveCreditLines) {
      const id = String(row.offsetChartOfAccountId ?? '').trim();
      const amt = Number(row.amount);
      if (id && Number.isFinite(amt) && amt > 0) lines.push({ offsetChartOfAccountId: id, amount: amt });
    }
    if (lines.length < 2) return null;
    return lines;
  };

  const create = async () => {
    if (!allowCreate) return;
    const amount = Number(form.amount);
    if (!form.bankAccountId || !form.chequeNo.trim() || !Number.isFinite(amount) || amount <= 0) {
      toast.error(isAr ? 'أكمل بيانات الشيك بشكل صحيح.' : 'Complete valid cheque fields.');
      return;
    }
    let receivedCredits: ReceivedIssueCreditRow[] | null = null;
    if (form.direction === 'received' && receiveMultiSplit) {
      const raw = parseCreditsFromForm();
      if (!raw) {
        toast.error(isAr ? 'أدخل سطرين دائن على الأقل بمبالغ صحيحة.' : 'Enter at least two valid credit lines.');
        return;
      }
      try {
        validateReceivedIssueCredits(raw, amount, language);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
        return;
      }
      receivedCredits = raw;
    } else if (form.direction === 'issued' || (form.direction === 'received' && !receiveMultiSplit)) {
      if (!form.offsetChartOfAccountId.trim()) {
        toast.error(isAr ? 'اختر حساب الطرف المقابل من الدليل.' : 'Select offset GL account.');
        return;
      }
    }

    let projectId = form.projectId.trim();
    let contractId = form.contractId.trim();
    try {
      const m = mergeProjectContract(contracts, indirectCenters, projectId, contractId);
      projectId = m.projectId;
      contractId = m.contractId;
    } catch {
      toast.error(isAr ? 'مركز التكلفة غير صالح أو لا يطابق المشروع.' : 'Invalid cost center or project mismatch.');
      return;
    }

    setSaving(true);
    try {
      const newId = await createBankCheque({
        direction: form.direction,
        bankAccountId: form.bankAccountId,
        chequeNo: form.chequeNo.trim(),
        payeeName: form.payeeName.trim() || null,
        issueDate: form.issueDate,
        dueDate: form.dueDate || null,
        amount,
        status: 'draft',
        offsetChartOfAccountId: receiveMultiSplit && form.direction === 'received' ? null : form.offsetChartOfAccountId.trim() || null,
        receivedIssueCredits: receivedCredits,
        projectId: projectId || null,
        contractId: contractId || null,
        createdAt: Timestamp.now(),
      });
      onMutated?.();
      toast.success(isAr ? 'تم إنشاء الشيك.' : 'Cheque created.');
      if (embedded && onChequeCreated) {
        onChequeCreated(newId);
        return;
      }
      setForm((f) => ({
        ...f,
        chequeNo: '',
        payeeName: '',
        amount: '',
        offsetChartOfAccountId: '',
        projectId: '',
        contractId: '',
      }));
      setReceiveCreditLines([
        { offsetChartOfAccountId: '', amount: 0 },
        { offsetChartOfAccountId: '', amount: 0 },
      ]);
    } catch {
      toast.error(isAr ? 'تعذر إنشاء الشيك.' : 'Failed to create cheque.');
    } finally {
      setSaving(false);
    }
  };

  const openPostIssue = (c: BankCheque) => {
    if (!allowEdit || !canPostLedger) {
      toast.error(isAr ? 'يلزم صلاحية تعديل البنوك أو إنشاء قيود.' : 'Need Banks edit or Ledger create.');
      return;
    }
    setIssueModalCheque(c);
    setIssueProjectId(c.projectId?.trim() ?? '');
    setIssueContractId(c.contractId?.trim() ?? '');
  };

  const runPostIssue = async () => {
    const c = issueModalCheque;
    if (!c) return;
    const bankRow = accounts.find((a) => a.id === c.bankAccountId);
    if (!bankRow) {
      toast.error(isAr ? 'الحساب البنكي غير موجود.' : 'Bank account missing.');
      return;
    }
    let projectId = issueProjectId.trim();
    let contractId = issueContractId.trim();
    try {
      const m = mergeProjectContract(contracts, indirectCenters, projectId, contractId);
      projectId = m.projectId;
      contractId = m.contractId;
    } catch {
      toast.error(isAr ? 'مركز التكلفة غير صالح.' : 'Invalid cost center.');
      return;
    }

    const multi =
      c.direction === 'received' &&
      Array.isArray(c.receivedIssueCredits) &&
      c.receivedIssueCredits.length >= 2;
    if (c.direction === 'issued' && !c.offsetChartOfAccountId?.trim() && !multi) {
      toast.error(isAr ? 'مسودة الشيك بدون حساب مقابل.' : 'Draft missing offset account.');
      return;
    }
    if (c.direction === 'received' && !multi && !c.offsetChartOfAccountId?.trim()) {
      toast.error(isAr ? 'مسودة الشيك بدون حساب مقابل.' : 'Draft missing offset account.');
      return;
    }

    setIssueSaving(true);
    try {
      const entries = buildChequeIssueEntries({
        direction: c.direction,
        amount: c.amount,
        coa: coaAccounts,
        offsetChartOfAccountId: c.offsetChartOfAccountId,
        receivedIssueCredits: multi ? c.receivedIssueCredits! : null,
        lang: language,
      });
      const issueRef = chequeIssueRef(c.id, c.direction);
      const desc =
        c.direction === 'issued'
          ? (isAr ? `شيك صادر ${c.chequeNo}` : `Issued cheque ${c.chequeNo}`)
          : isAr
            ? `شيك وارد ${c.chequeNo}`
            : `Received cheque ${c.chequeNo}`;
      const txId = await accountingService.createTransaction({
        date: c.issueDate,
        description: desc,
        reference: issueRef,
        projectId: projectId || undefined,
        costCenterId: contractId || undefined,
        entries,
      });
      const nextStatus = c.direction === 'issued' ? 'issued' : 'received';
      await updateBankCheque(c.id, {
        status: nextStatus,
        glIssueTransactionId: txId,
        postedIssueReference: issueRef,
        projectId: projectId || deleteField(),
        contractId: contractId || deleteField(),
        updatedAt: Timestamp.now(),
      });
      onMutated?.();
      toast.success(isAr ? 'تم ترحيل القيد الأول.' : 'First journal posted.');
      setIssueModalCheque(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : isAr ? 'تعذر الترحيل.' : 'Post failed.');
    } finally {
      setIssueSaving(false);
    }
  };

  const openClear = (c: BankCheque) => {
    if (!allowEdit || !canPostLedger) {
      toast.error(isAr ? 'يلزم صلاحية تعديل البنوك أو إنشاء قيود.' : 'Need Banks edit or Ledger create.');
      return;
    }
    setClearTarget(c);
    setClearDate(new Date().toISOString().slice(0, 10));
    setClearProjectId(c.projectId?.trim() ?? '');
    setClearContractId(c.contractId?.trim() ?? '');
  };

  const runClear = async () => {
    const c = clearTarget;
    if (!c || !c.glIssueTransactionId) return;
    const bankRow = accounts.find((a) => a.id === c.bankAccountId);
    if (!bankRow) {
      toast.error(isAr ? 'الحساب البنكي غير موجود.' : 'Bank account missing.');
      return;
    }
    let projectId = clearProjectId.trim();
    let contractId = clearContractId.trim();
    try {
      const m = mergeProjectContract(contracts, indirectCenters, projectId, contractId);
      projectId = m.projectId;
      contractId = m.contractId;
    } catch {
      toast.error(isAr ? 'مركز التكلفة غير صالح.' : 'Invalid cost center.');
      return;
    }
    const dClear = clearDate.trim() || c.issueDate;
    setClearSaving(true);
    try {
      const issueData = await accountingService.getJournalTransaction(c.glIssueTransactionId);
      if (!issueData) {
        throw new Error(isAr ? 'قيد التحرير غير موجود.' : 'Issue journal missing.');
      }
      const entries = buildChequeClearEntries({
        direction: c.direction,
        amount: c.amount,
        bankAccount: bankRow,
        issueTransaction: issueData,
        lang: language,
      });
      const clrRef = chequeClearRef(c.id, c.direction);
      const desc =
        c.direction === 'issued'
          ? isAr
            ? `صرف شيك صادر ${c.chequeNo}`
            : `Issued cheque paid ${c.chequeNo}`
          : isAr
            ? `تحصيل شيك وارد ${c.chequeNo}`
            : `Received cheque collected ${c.chequeNo}`;
      const txId = await accountingService.createTransaction({
        date: dClear,
        description: desc,
        reference: clrRef,
        projectId: projectId || undefined,
        costCenterId: contractId || undefined,
        entries,
      });
      await updateBankCheque(c.id, {
        status: 'cleared',
        glClearTransactionId: txId,
        postedClearReference: clrRef,
        projectId: projectId || deleteField(),
        contractId: contractId || deleteField(),
        updatedAt: Timestamp.now(),
      });
      onMutated?.();
      toast.success(isAr ? 'تم التحصيل/الصرف.' : 'Cleared to bank.');
      setClearTarget(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : isAr ? 'تعذر التحصيل.' : 'Clear failed.');
    } finally {
      setClearSaving(false);
    }
  };

  async function resolveIssueReference(c: BankCheque): Promise<string> {
    const r = c.postedIssueReference?.trim();
    if (r) return r;
    if (!c.glIssueTransactionId) throw new Error(isAr ? 'لا يوجد قيد ترحيل.' : 'No issue journal.');
    const tx = await accountingService.getJournalTransaction(c.glIssueTransactionId);
    const ref = String(tx?.reference ?? '').trim();
    if (!ref) throw new Error(isAr ? 'القيد بدون مرجع — تعذر العكس الآمن.' : 'Journal missing reference; cannot reverse safely.');
    return ref;
  }

  const runReject = async (c: BankCheque) => {
    if (!allowEdit || !canPostLedger) return;
    if (c.glClearTransactionId) {
      toast.error(isAr ? 'لا يمكن الرفض بعد التحصيل.' : 'Cannot reject after bank clearance.');
      return;
    }
    const ok = await confirmDlg({
      title: isAr ? 'رد الشيك' : 'Return cheque',
      message: isAr ? 'سيُنشأ قيد عكسي للمرحلة الأولى. أكمل؟' : 'A reversing entry will be posted for the first leg. Continue?',
      variant: 'danger',
      confirmLabel: isAr ? 'تأكيد' : 'Confirm',
    });
    if (!ok) return;
    try {
      const issueRef = c.postedIssueReference?.trim() || (await resolveIssueReference(c));
      const revId = c.glIssueTransactionId
        ? await accountingService.reverseJournalByTransactionId(c.glIssueTransactionId)
        : await accountingService.reverseJournalByReference(issueRef);
      await updateBankCheque(c.id, {
        status: 'rejected',
        glRejectTransactionId: revId,
        ...(c.postedIssueReference?.trim() ? {} : { postedIssueReference: issueRef }),
        updatedAt: Timestamp.now(),
      });
      onMutated?.();
      toast.success(isAr ? 'تم رد الشيك.' : 'Cheque rejected / returned.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : isAr ? 'تعذر الرفض.' : 'Reject failed.');
    }
  };

  const runCancelIssue = async (c: BankCheque) => {
    if (!allowEdit || !canPostLedger) return;
    if (c.glClearTransactionId || c.glRejectTransactionId) {
      toast.error(isAr ? 'غير مسموح بعد التحصيل أو الرفض.' : 'Not allowed after clear or reject.');
      return;
    }
    const ok = await confirmDlg({
      title: isAr ? 'إلغاء التحرير' : 'Cancel issue',
      message: isAr ? 'قيد عكسي وإلغاء حالة الشيك. أكمل؟' : 'Reverse first leg and cancel cheque state. Continue?',
      variant: 'danger',
      confirmLabel: isAr ? 'تأكيد' : 'Confirm',
    });
    if (!ok) return;
    try {
      const issueRef = await resolveIssueReference(c);
      if (c.glIssueTransactionId) {
        await accountingService.reverseJournalByTransactionId(c.glIssueTransactionId);
      } else {
        await accountingService.reverseJournalByReference(issueRef);
      }
      await updateBankCheque(c.id, {
        status: 'cancelled',
        glIssueTransactionId: deleteField(),
        postedIssueReference: deleteField(),
        updatedAt: Timestamp.now(),
      });
      onMutated?.();
      toast.success(isAr ? 'تم الإلغاء.' : 'Cancelled.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : isAr ? 'تعذر الإلغاء.' : 'Cancel failed.');
    }
  };

  const removeDraft = async (c: BankCheque) => {
    if (!allowEdit) return;
    if (c.glIssueTransactionId) {
      toast.error(isAr ? 'لا يمكن حذف شيك مرحَّل.' : 'Cannot delete posted cheque.');
      return;
    }
    if (c.status !== 'draft') {
      toast.error(isAr ? 'الحذف للمسودة فقط.' : 'Delete is for drafts only.');
      return;
    }
    try {
      await removeBankCheque(c.id);
      onMutated?.();
      if (embedded) onDetailRemoved?.();
      toast.success(isAr ? 'تم حذف الشيك.' : 'Cheque deleted.');
    } catch {
      toast.error(isAr ? 'تعذر الحذف.' : 'Delete failed.');
    }
  };

  const normChequeStatus = (c: BankCheque) => (c.status === 'returned' ? 'rejected' : c.status);

  const needsIssueGl = (c: BankCheque) => {
    if (c.glIssueTransactionId || c.glRejectTransactionId) return false;
    const s = normChequeStatus(c);
    return !['cleared', 'cancelled', 'rejected'].includes(s);
  };

  const canClear = (c: BankCheque) => {
    if (!c.glIssueTransactionId || c.glClearTransactionId || c.glRejectTransactionId) return false;
    const s = normChequeStatus(c);
    if (s === 'draft') return false;
    if (c.direction === 'issued') return s === 'issued';
    return s === 'received' || s === 'issued';
  };

  const selectedCheque = selectedChequeId ? cheques.find((c) => c.id === selectedChequeId) ?? null : null;

  const renderChequeActions = (c: BankCheque) => (
    <div className="flex flex-wrap gap-2 text-xs">
      {needsIssueGl(c) ? (
        <button
          type="button"
          disabled={!allowEdit || !canPostLedger}
          className="font-bold text-emerald-600 hover:underline disabled:opacity-40"
          onClick={() => openPostIssue(c)}
        >
          {isAr ? 'ترحيل أول' : 'Post 1st'}
        </button>
      ) : null}
      {canClear(c) ? (
        <button
          type="button"
          disabled={!allowEdit || !canPostLedger}
          className="font-bold text-blue-600 hover:underline disabled:opacity-40"
          onClick={() => openClear(c)}
        >
          {isAr ? 'تحصيل/صرف بنك' : 'Bank clear'}
        </button>
      ) : null}
      {c.glIssueTransactionId && !c.glClearTransactionId && !c.glRejectTransactionId ? (
        <button
          type="button"
          disabled={!allowEdit || !canPostLedger}
          className="text-red-600 hover:underline disabled:opacity-40"
          onClick={() => void runReject(c)}
        >
          {isAr ? 'رد شيك' : 'Return'}
        </button>
      ) : null}
      {c.glIssueTransactionId && !c.glClearTransactionId && !c.glRejectTransactionId ? (
        <button
          type="button"
          disabled={!allowEdit || !canPostLedger}
          className="text-amber-600 hover:underline disabled:opacity-40"
          onClick={() => void runCancelIssue(c)}
        >
          {isAr ? 'إلغاء التحرير' : 'Cancel issue'}
        </button>
      ) : null}
      {c.status === 'draft' && !c.glIssueTransactionId ? (
        <button
          type="button"
          disabled={!allowEdit}
          className="text-red-500 hover:underline disabled:opacity-40"
          onClick={() => void removeDraft(c)}
        >
          {isAr ? 'حذف' : 'Delete'}
        </button>
      ) : null}
    </div>
  );

  const createFormPanel = (
    <div className={cn(!embedded && panelCls, !embedded && 'p-4 md:p-5 space-y-4 shadow-sm', embedded && 'space-y-4')}>
      {!embedded ? (
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-sm">{isAr ? 'شيك جديد' : 'New cheque'}</h3>
            <ManualHelpButton
              topicId={form.direction === 'received' ? 'banks.cheque.received' : 'banks.cheque.issued'}
              size={14}
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {isAr
              ? 'الترحيل الأول ينشئ قيداً في الأستاذ؛ التحصيل/الصرف يغلق وسيط الشيك والبنك. يتطلب حساب 21601001 للصادر و12203001 للوارد في الدليل.'
              : 'First posting creates a GL entry; bank clearance closes clearing vs bank. Requires COA leaves 21601001 (issued) and 12203001 (received clearing).'}
          </p>
        </div>
      ) : (
        <ManualHelpButton
          topicId={form.direction === 'received' ? 'banks.cheque.received' : 'banks.cheque.issued'}
          size={14}
        />
      )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          <select
            aria-label="direction"
            className={inputCls}
            value={form.direction}
            onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value as 'issued' | 'received' }))}
          >
            <option value="issued">{isAr ? 'صادر' : 'Issued'}</option>
            <option value="received">{isAr ? 'وارد' : 'Received'}</option>
          </select>
          <div>
            <select
              aria-label="bank account"
              className={inputCls}
              value={form.bankAccountId}
              onChange={(e) => setForm((f) => ({ ...f, bankAccountId: e.target.value }))}
            >
              <option value="">{isAr ? 'اختر الحساب البنكي' : 'Select bank account'}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {isAr ? a.nameAr : a.nameEn || a.nameAr}
                </option>
              ))}
            </select>
            <GlAccountBalanceHint
              accountCode={selectedBankGlCode}
              balanceByCode={balanceByCode}
              language={language}
              variant="bank"
              loading={glBalancesLoading}
            />
          </div>
          <input
            aria-label="cheque number"
            className={inputCls}
            placeholder={isAr ? 'رقم الشيك' : 'Cheque no.'}
            value={form.chequeNo}
            onChange={(e) => setForm((f) => ({ ...f, chequeNo: e.target.value }))}
          />
          <input
            aria-label="payee name"
            className={inputCls}
            placeholder={isAr ? 'المستفيد / الجهة' : 'Payee / party'}
            value={form.payeeName}
            onChange={(e) => setForm((f) => ({ ...f, payeeName: e.target.value }))}
          />
          <input
            aria-label="issue date"
            className={inputCls}
            type="date"
            value={form.issueDate}
            onChange={(e) => setForm((f) => ({ ...f, issueDate: e.target.value }))}
          />
          <input
            aria-label="due date"
            className={inputCls}
            type="date"
            value={form.dueDate}
            onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
          />
          <input
            aria-label="amount"
            className={inputCls}
            type="number"
            step="0.01"
            placeholder={isAr ? 'المبلغ' : 'Amount'}
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
          />
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">
              {isAr ? 'المشروع (تصفية العقود)' : 'Project (filters contracts)'}
            </label>
            <select
              aria-label="project"
              className={inputCls}
              value={form.projectId}
              onChange={(e) => {
                const pid = e.target.value;
                setForm((f) => {
                  let cid = f.contractId;
                  if (shouldClearCostCenterOnProjectChange(cid, pid, contracts, indirectCenters)) cid = '';
                  return { ...f, projectId: pid, contractId: cid };
                });
              }}
            >
              <option value="">{isAr ? '— كل المشاريع —' : '— All projects —'}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.projectCode} — {isAr ? p.projectName : p.projectNameEn || p.projectName}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-bold text-gray-500 mb-1">
              {isAr ? 'مركز التكلفة — اختياري' : 'Cost center — optional'}
            </label>
            <SearchableSelect
              theme={theme}
              dir={dir}
              className="w-full"
              placeholder={isAr ? 'عقد أو مركز غير مباشر (اختياري)' : 'Contract or indirect center (optional)'}
              options={newChequeContractOptions}
              value={form.contractId}
              onChange={(v) => {
                const ctr = contracts.find((x) => x.id === v);
                const indirect = indirectCenters.find((x) => x.id === v);
                setForm((f) => ({
                  ...f,
                  contractId: v,
                  projectId: ctr ? ctr.projectId : indirect ? '' : f.projectId,
                }));
              }}
            />
          </div>
        </div>
        {form.direction === 'received' ? (
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={receiveMultiSplit} onChange={(e) => setReceiveMultiSplit(e.target.checked)} />
            {isAr ? 'تقسيم دائن متعدد (شيك وارد)' : 'Multi-credit split (received)'}
          </label>
        ) : null}
        {form.direction === 'received' && receiveMultiSplit ? (
          <div className="space-y-2">
            {receiveCreditLines.map((row, idx) => (
              <div key={idx} className="grid grid-cols-1 md:grid-cols-2 gap-2 items-end">
                <div>
                  <SearchableSelect
                    options={coaOptions}
                    value={row.offsetChartOfAccountId}
                    onChange={(id) => {
                      const next = [...receiveCreditLines];
                      next[idx] = { ...next[idx], offsetChartOfAccountId: id };
                      setReceiveCreditLines(next);
                    }}
                    placeholder={isAr ? `دائن ${idx + 1} — دليل` : `Credit ${idx + 1} — COA`}
                    dir={dir}
                    theme={theme}
                  />
                  <GlAccountBalanceHint
                    accountCode={coaIdToAccountCode(row.offsetChartOfAccountId, coaAccounts)}
                    balanceByCode={balanceByCode}
                    language={language}
                    variant="account"
                    loading={glBalancesLoading}
                  />
                </div>
                <input
                  className={inputCls}
                  type="number"
                  step="0.01"
                  placeholder={isAr ? 'مبلغ' : 'Amount'}
                  value={row.amount || ''}
                  onChange={(e) => {
                    const next = [...receiveCreditLines];
                    next[idx] = { ...next[idx], amount: Number(e.target.value) };
                    setReceiveCreditLines(next);
                  }}
                />
              </div>
            ))}
            <button
              type="button"
              className="text-xs text-blue-600 font-bold"
              onClick={() => setReceiveCreditLines((rows) => [...rows, { offsetChartOfAccountId: '', amount: 0 }])}
            >
              {isAr ? '+ سطر دائن' : '+ Credit line'}
            </button>
          </div>
        ) : (
          <div>
            <SearchableSelect
              options={coaOptions}
              value={form.offsetChartOfAccountId}
              onChange={(id) => setForm((f) => ({ ...f, offsetChartOfAccountId: id }))}
              placeholder={
                form.direction === 'issued'
                  ? isAr
                    ? 'الطرف المقابل (مدين) — مورد / مصروف…'
                    : 'Offset debit — supplier / expense…'
                  : isAr
                    ? 'الطرف المقابل (دائن) — عميل…'
                    : 'Offset credit — customer…'
              }
              dir={dir}
              theme={theme}
            />
            <GlAccountBalanceHint
              accountCode={offsetGlCode}
              balanceByCode={balanceByCode}
              language={language}
              variant="account"
              loading={glBalancesLoading}
            />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {embedded && onCancelCreate ? (
            <button type="button" onClick={onCancelCreate} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-gray-500/15">
              {isAr ? 'إلغاء' : 'Cancel'}
            </button>
          ) : null}
          <button
            type="button"
            disabled={saving || !allowCreate}
            onClick={() => void create()}
            className="rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-bold disabled:opacity-50"
          >
            {saving ? '…' : isAr ? 'حفظ مسودة' : 'Save draft'}
          </button>
        </div>
      </div>
  );

  const detailPanel = selectedCheque ? (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-gray-500">{isAr ? 'اتجاه' : 'Direction'}</p>
          <p>{selectedCheque.direction === 'issued' ? (isAr ? 'صادر' : 'Issued') : isAr ? 'وارد' : 'Received'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">{isAr ? 'رقم الشيك' : 'Cheque no.'}</p>
          <p className="font-mono font-semibold">{selectedCheque.chequeNo}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">{isAr ? 'الحالة' : 'Status'}</p>
          <p className="font-semibold">{displayStatus(selectedCheque, isAr)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">{isAr ? 'البنك' : 'Bank'}</p>
          <p>{accounts.find((a) => a.id === selectedCheque.bankAccountId)?.code ?? '—'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">{isAr ? 'التاريخ' : 'Date'}</p>
          <p>{selectedCheque.issueDate}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">{isAr ? 'المبلغ' : 'Amount'}</p>
          <p className="font-mono font-bold">{formatNumber(Number(selectedCheque.amount))}</p>
        </div>
        {selectedCheque.payeeName ? (
          <div className="sm:col-span-2">
            <p className="text-xs text-gray-500">{isAr ? 'المستفيد' : 'Payee'}</p>
            <p>{selectedCheque.payeeName}</p>
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {renderChequeActions(selectedCheque)}
        <ManualHelpButton
          topicId={selectedCheque.direction === 'received' ? 'banks.cheque.received' : 'banks.cheque.issued'}
          size={14}
        />
        <ManualHelpButton topicId="banks.cheque.reject" size={14} />
      </div>
    </div>
  ) : (
    <p className="text-sm text-gray-500">{isAr ? 'الشيك غير موجود.' : 'Cheque not found.'}</p>
  );

  const modals = (
    <>
      {issueModalCheque ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog">
          <div className={cn(panelCls, 'max-w-md w-full p-5 space-y-3 shadow-xl')}>
            <h4 className="font-bold">{isAr ? 'ترحيل أول — مركز التكلفة (اختياري)' : 'First post — cost center (optional)'}</h4>
            <p className="text-xs text-gray-500">
              {isAr
                ? 'يُمرَّر المشروع ومركز التكلفة إلى رأس القيد عند اختيارهما؛ ويمكن الترحيل بدون مركز تكلفة.'
                : 'Project and cost center are set on the journal header when chosen; posting without a cost center is allowed.'}
            </p>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">
                {isAr ? 'المشروع (تصفية العقود)' : 'Project (filters contracts)'}
              </label>
              <select
                className={inputCls}
                aria-label={isAr ? 'المشروع عند الترحيل الأول' : 'Project for first posting'}
                value={issueProjectId}
                onChange={(e) => {
                  const pid = e.target.value;
                  let cid = issueContractId;
                  if (shouldClearCostCenterOnProjectChange(cid, pid, contracts, indirectCenters)) cid = '';
                  setIssueProjectId(pid);
                  setIssueContractId(cid);
                }}
              >
                <option value="">{isAr ? '— كل المشاريع —' : '— All projects —'}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.projectCode} — {isAr ? p.projectName : p.projectNameEn || p.projectName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">
                {isAr ? 'مركز التكلفة — اختياري' : 'Cost center — optional'}
              </label>
              <SearchableSelect
                theme={theme}
                dir={dir}
                className="w-full"
                placeholder={isAr ? 'عقد أو مركز غير مباشر (اختياري)' : 'Contract or indirect center (optional)'}
                options={issueModalContractOptions}
                value={issueContractId}
                onChange={(v) => {
                  const ctr = contracts.find((x) => x.id === v);
                  const indirect = indirectCenters.find((x) => x.id === v);
                  setIssueContractId(v);
                  if (ctr) setIssueProjectId(ctr.projectId);
                  else if (indirect) setIssueProjectId('');
                }}
              />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" className={inputCls} onClick={() => setIssueModalCheque(null)}>
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={issueSaving}
                className="rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-bold disabled:opacity-50"
                onClick={() => void runPostIssue()}
              >
                {issueSaving ? '…' : isAr ? 'ترحيل' : 'Post'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {clearTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog">
          <div className={cn(panelCls, 'max-w-md w-full p-5 space-y-3 shadow-xl')}>
            <h4 className="font-bold">{isAr ? 'تحصيل / صرف بنك' : 'Bank collection / payment'}</h4>
            <input
              className={inputCls}
              type="date"
              aria-label={isAr ? 'تاريخ التحصيل أو الصرف' : 'Clearance posting date'}
              title={isAr ? 'تاريخ التحصيل أو الصرف' : 'Clearance posting date'}
              value={clearDate}
              onChange={(e) => setClearDate(e.target.value)}
            />
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">
                {isAr ? 'المشروع (تصفية العقود)' : 'Project (filters contracts)'}
              </label>
              <select
                className={inputCls}
                aria-label={isAr ? 'المشروع عند التحصيل البنكي' : 'Project for bank clearance'}
                value={clearProjectId}
                onChange={(e) => {
                  const pid = e.target.value;
                  let cid = clearContractId;
                  if (shouldClearCostCenterOnProjectChange(cid, pid, contracts, indirectCenters)) cid = '';
                  setClearProjectId(pid);
                  setClearContractId(cid);
                }}
              >
                <option value="">{isAr ? '— كل المشاريع —' : '— All projects —'}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.projectCode} — {isAr ? p.projectName : p.projectNameEn || p.projectName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">
                {isAr ? 'مركز التكلفة — اختياري' : 'Cost center — optional'}
              </label>
              <SearchableSelect
                theme={theme}
                dir={dir}
                className="w-full"
                placeholder={isAr ? 'عقد أو مركز غير مباشر (اختياري)' : 'Contract or indirect center (optional)'}
                options={clearModalContractOptions}
                value={clearContractId}
                onChange={(v) => {
                  const ctr = contracts.find((x) => x.id === v);
                  const indirect = indirectCenters.find((x) => x.id === v);
                  setClearContractId(v);
                  if (ctr) setClearProjectId(ctr.projectId);
                  else if (indirect) setClearProjectId('');
                }}
              />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" className={inputCls} onClick={() => setClearTarget(null)}>
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={clearSaving}
                className="rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-bold disabled:opacity-50"
                onClick={() => void runClear()}
              >
                {clearSaving ? '…' : isAr ? 'تأكيد' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );

  if (embedded && panelMode === 'create') {
    return (
      <div className="space-y-4" dir={dir}>
        {createFormPanel}
      </div>
    );
  }

  if (embedded && panelMode === 'detail') {
    return (
      <div className="space-y-4" dir={dir}>
        {detailPanel}
        {modals}
      </div>
    );
  }

  return (
    <div className="space-y-4" dir={dir}>
      {createFormPanel}

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500">{isAr ? 'عرض' : 'Show'}</span>
        {(['all', 'issued', 'received'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilterDir(k)}
            className={cn(
              'px-3 py-1 rounded-lg text-xs font-bold',
              filterDir === k ? 'bg-blue-600 text-white' : 'bg-gray-500/10 text-gray-600',
            )}
          >
            {k === 'all' ? (isAr ? 'الكل' : 'All') : k === 'issued' ? (isAr ? 'صادر' : 'Issued') : isAr ? 'وارد' : 'Received'}
          </button>
        ))}
      </div>

      <div className={cn(panelCls, 'overflow-x-auto')}>
        <table className="w-full text-sm min-w-[1020px]">
          <thead>
            <tr
              className={cn(
                'border-b text-left',
                theme === 'dark' ? 'border-gray-800 bg-gray-900/50' : 'border-gray-200 bg-gray-50',
              )}
            >
              <th className="px-3 py-2">{isAr ? 'اتجاه' : 'Dir'}</th>
              <th className="px-3 py-2">{isAr ? 'رقم الشيك' : 'Cheque no.'}</th>
              <th className="px-3 py-2">{isAr ? 'الحالة' : 'Status'}</th>
              <th className="px-3 py-2">{isAr ? 'البنك' : 'Bank'}</th>
              <th className="px-3 py-2">{isAr ? 'التاريخ' : 'Date'}</th>
              <th className="px-3 py-2 text-end">{isAr ? 'المبلغ' : 'Amount'}</th>
              <th className="px-3 py-2 w-64">{isAr ? 'إجراءات' : 'Actions'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-gray-500">
                  {isAr ? 'لا توجد شيكات.' : 'No cheques.'}
                </td>
              </tr>
            ) : (
              rows.map((c) => (
                <tr
                  key={c.id}
                  className={cn('border-b hover:bg-blue-500/5 transition-colors', theme === 'dark' ? 'border-gray-800' : 'border-gray-100')}
                >
                  <td className="px-3 py-2">{c.direction}</td>
                  <td className="px-3 py-2 font-mono">{c.chequeNo}</td>
                  <td className="px-3 py-2">{displayStatus(c, isAr)}</td>
                  <td className="px-3 py-2 text-xs">{accounts.find((a) => a.id === c.bankAccountId)?.code ?? '—'}</td>
                  <td className="px-3 py-2">{c.issueDate}</td>
                  <td className="px-3 py-2 text-end font-mono">{formatNumber(Number(c.amount))}</td>
                  <td className="px-3 py-2">{renderChequeActions(c)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {modals}
    </div>
  );
}
