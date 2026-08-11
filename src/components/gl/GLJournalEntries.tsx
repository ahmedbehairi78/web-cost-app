import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus, Printer, Download, Trash2, X, ChevronLast, Wrench, Loader2
} from 'lucide-react';
import { collection, addDoc, doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { cn, listKey } from '../../lib/utils';
import { ApiError } from '../../lib/apiClient';
import { isLocalBackend } from '../../lib/dataBackend';
import { motion, AnimatePresence } from 'motion/react';
import { accountingService, Account } from '../../services/accountingService';
import { contractsApi, projectsApi, costCentersApi, settingsApi, glApi, NetworkQueuedError } from '../../services/local/modulesApi';
import { useFormDraftAutosave } from '../../hooks/useFormDraftAutosave';
import { useOfflineUserId } from '../../hooks/useOfflineUserId';
import { FormDraftRestoreBanner } from '../offline/FormDraftRestoreBanner';
import { clearFormDraft, FORM_DRAFT_KEYS } from '../../lib/offline';
import { businessTodayYmd } from '../../lib/businessCalendar';
import { useReportDocumentPreview } from '../../hooks/useReportDocumentPreview';
import type { CompanyPrintInfo } from '../../lib/ipcPrintData';
import { SearchableSelect } from '../ui/SearchableSelect';
import { ManualHelpButton } from '../help/ManualHelpButton';
import toast from 'react-hot-toast';
import { useLanguage } from '../../context/LanguageContext';
import { resolveEntryCostCenterLine, resolveTxDescription } from '../../lib/glBilingual';
import { buildCostCenterSelectOptions } from '../../lib/costCenterPicker';
import { formatMoney as formatMoneyLib, NUMBER_LOCALE } from '../../lib/money';
import { SHELL_MODAL_ROOT_CLASS, SHELL_MODAL_Z } from '../../lib/shellTheme';

interface Transaction {
  id: string;
  date: string;
  description: string;
  descriptionEn?: string | null;
  reference: string;
  projectId?: string;
  costCenterId?: string;
  entries: { accountCode: string; accountName: string; debit: number; credit: number; costCenterId?: string | null }[];
  createdBy: string;
  createdAt?: string | Date;
  reversesReference?: string;
  undoesReversalOfReference?: string;
}

interface Contract { id: string; contractName: string; contractNameEn?: string | null; contractNumber: string; projectId: string }
interface Project { id: string; projectName: string; projectNameEn?: string | null; projectCode: string }

function formatMoney(value: number, locale: string) {
  return formatMoneyLib(value, locale);
}

interface Props {
  transactions: Transaction[];
  transactionLimit: number;
  onLoadMore: () => void;
  onJournalChanged?: () => void;
  accounts: Account[];
  contracts: Contract[];
  projects: Project[];
  contractsMap: Map<string, Contract>;
  projectsMap: Map<string, Project>;
  theme: string;
  language: string;
  dir: string;
  fiscalYear: number;
  loading?: boolean;
  allowCreate?: boolean;
  allowEdit?: boolean;
}

export function GLJournalEntries({
  transactions, transactionLimit, onLoadMore, onJournalChanged,
  accounts, contracts, projects, contractsMap, projectsMap,
  theme, language, dir, fiscalYear, loading = false,
  allowCreate = true, allowEdit = true,
}: Props) {
  const { t } = useLanguage();
  const moneyLocale = NUMBER_LOCALE;

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
    formatMoney: (n: number) => formatMoneyLib(n, NUMBER_LOCALE),
    companyInfo,
  });

  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [isEntryModalOpen, setIsEntryModalOpen] = useState(false);
  const [isContractModalOpen, setIsContractModalOpen] = useState(false);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMaintenanceOpen, setIsMaintenanceOpen] = useState(false);
  const [reverseRefInput, setReverseRefInput] = useState('');
  const [undoRefInput, setUndoRefInput] = useState('');
  const [indirectCenters, setIndirectCenters] = useState<Array<{ id: string; code: string; name: string; nameEn?: string | null }>>([]);

  useEffect(() => {
    if (!isLocalBackend) return;
    void costCentersApi.list('indirect').then((rows) => {
      setIndirectCenters(rows as Array<{ id: string; code: string; name: string; nameEn?: string | null }>);
    }).catch(() => setIndirectCenters([]));
  }, []);

  const indirectCentersMap = React.useMemo(
    () => new Map(indirectCenters.map((c) => [c.id, c])),
    [indirectCenters],
  );

  const costCenterOptions = React.useMemo(
    () =>
      buildCostCenterSelectOptions(
        contracts,
        projects,
        indirectCenters.filter((c) => (c as { isActive?: boolean }).isActive !== false),
        language === 'en' ? 'en' : 'ar',
      ).map(({ value, label, secondary }) => ({ value, label, secondary })),
    [contracts, projects, indirectCenters, language],
  );
  const emptyEntryForm = () => ({
    date: businessTodayYmd(),
    description: '',
    descriptionEn: '',
    costCenterId: '',
    entries: [
      { id: crypto.randomUUID(), accountCode: '', accountName: '', debit: 0, credit: 0 },
      { id: crypto.randomUUID(), accountCode: '', accountName: '', debit: 0, credit: 0 },
    ],
  });
  const [entryForm, setEntryForm] = useState(emptyEntryForm);
  const [businessTimeZone, setBusinessTimeZone] = useState('Africa/Cairo');

  const offlineUserId = useOfflineUserId();
  const {
    restorePrompt: glRestore,
    acceptRestore: acceptGlRestore,
    dismissRestore: dismissGlRestore,
  } = useFormDraftAutosave({
    userId: offlineUserId,
    draftKey: FORM_DRAFT_KEYS.glJournalNew,
    value: entryForm,
    enabled: isEntryModalOpen,
    isEmpty: (v) =>
      !String(v.description || '').trim()
      && !(v.entries || []).some((e) => e.accountCode || e.debit || e.credit),
  });

  const refreshBusinessPostingDate = React.useCallback(async () => {
    let date = businessTodayYmd();
    let timeZone = 'Africa/Cairo';
    if (isLocalBackend) {
      try {
        const res = await glApi.businessToday();
        if (res?.date) date = res.date;
        if (res?.timeZone) timeZone = res.timeZone;
      } catch {
        /* keep Cairo calendar from client clock as last resort */
      }
    }
    setBusinessTimeZone(timeZone);
    setEntryForm((prev) => ({ ...prev, date }));
    return date;
  }, []);

  const [contractForm, setContractForm] = useState({ contractName: '', contractNumber: '', projectId: '' });
  const [projectForm, setProjectForm] = useState({ projectName: '', projectCode: '', clientName: '', budget: 0, startDate: businessTodayYmd() });

  const inputCls = (extra = '') => cn(
    'w-full border rounded-lg py-2.5 px-4 text-sm outline-none focus:border-blue-500 transition-colors',
    theme === 'dark' ? 'bg-gray-900 border-gray-800' : theme === 'soft' ? 'bg-white border-[#cfd8dc]' : 'bg-white border-gray-300 text-gray-900',
    extra
  );

  const handleEntryChange = (idx: number, field: keyof typeof entryForm.entries[0], value: string | number) => {
    const next = [...entryForm.entries];
    next[idx] = { ...next[idx], [field]: value };
    if (field === 'accountCode') {
      const acc = accounts.find(a => a.accountCode === value);
      if (acc) next[idx] = { ...next[idx], accountName: language === 'ar' ? acc.accountName : (acc.accountNameEn || acc.accountName) };
    }
    setEntryForm({ ...entryForm, entries: next });
  };

  const handleSaveEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entryForm.costCenterId) {
      toast.error(t('toast_gl_cost_center_required'));
      return;
    }
    const lines = entryForm.entries.map(row => ({
      ...row,
      debit: Number(row.debit) || 0,
      credit: Number(row.credit) || 0,
    }));
    for (let i = 0; i < lines.length; i++) {
      const row = lines[i];
      const hasAcc = !!row.accountCode?.trim();
      const hasDebit = row.debit > 0;
      const hasCredit = row.credit > 0;
      if (!hasAcc && !hasDebit && !hasCredit) continue;
      if (!hasAcc && (hasDebit || hasCredit)) {
        toast.error(t('toast_gl_line_amount_no_account').replace('{line}', String(i + 1)));
        return;
      }
      if (hasAcc && !hasDebit && !hasCredit) {
        toast.error(t('toast_gl_line_account_no_amount').replace('{line}', String(i + 1)));
        return;
      }
      if (hasDebit && hasCredit) {
        toast.error(t('toast_gl_line_debit_credit_both').replace('{line}', String(i + 1)));
        return;
      }
    }
    const posting = lines.filter(
      row => row.accountCode.trim() && (row.debit > 0 || row.credit > 0),
    );
    if (posting.length < 2) {
      toast.error(t('toast_gl_min_two_lines'));
      return;
    }
    const totalDebit = posting.reduce((s, row) => s + row.debit, 0);
    const totalCredit = posting.reduce((s, row) => s + row.credit, 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      toast.error(t('toast_gl_not_balanced'));
      return;
    }
    setIsSubmitting(true);
    try {
      const selectedContract = contracts.find(c => c.id === entryForm.costCenterId);
      const postingDate = await refreshBusinessPostingDate();
      await accountingService.createTransaction({
        date: postingDate,
        stampBusinessToday: true,
        description: entryForm.description.trim(),
        descriptionEn: entryForm.descriptionEn.trim() || null,
        costCenterId: entryForm.costCenterId,
        projectId: selectedContract?.projectId || '',
        entries: posting.map(row => {
          const acc = accounts.find(a => a.accountCode === row.accountCode.trim());
          const accountName = acc
            ? language === 'ar'
              ? acc.accountName
              : (acc.accountNameEn || acc.accountName)
            : '';
          return {
            accountCode: row.accountCode.trim(),
            accountName,
            debit: row.debit,
            credit: row.credit,
          };
        }),
      });
      toast.success(language === 'ar' ? 'تم حفظ القيد' : 'Journal entry saved');
      if (offlineUserId) await clearFormDraft(offlineUserId, FORM_DRAFT_KEYS.glJournalNew);
      onJournalChanged?.();
      setIsEntryModalOpen(false);
      setEntryForm(emptyEntryForm());
    } catch (error) {
      if (error instanceof NetworkQueuedError) return;
      handleFirestoreError(error, OperationType.CREATE, 'transactions');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveContract = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (isLocalBackend) {
        const contract = await contractsApi.create({ ...contractForm, isDeleted: false }) as Contract;
        setEntryForm(prev => ({ ...prev, costCenterId: contract.id }));
      } else {
        const docRef = await addDoc(collection(db, 'contracts'), { ...contractForm, isDeleted: false, createdAt: serverTimestamp() });
        setEntryForm(prev => ({ ...prev, costCenterId: docRef.id }));
      }
      setIsContractModalOpen(false);
      setContractForm({ contractName: '', contractNumber: '', projectId: '' });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'contracts');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (isLocalBackend) {
        const project = await projectsApi.create({ ...projectForm, status: 'active', isDeleted: false }) as Project;
        setContractForm(prev => ({ ...prev, projectId: project.id }));
      } else {
        const docRef = await addDoc(collection(db, 'projects'), { ...projectForm, status: 'active', isDeleted: false, createdAt: serverTimestamp() });
        setContractForm(prev => ({ ...prev, projectId: docRef.id }));
      }
      setIsProjectModalOpen(false);
      setProjectForm({ projectName: '', projectCode: '', clientName: '', budget: 0, startDate: businessTodayYmd() });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'projects');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitReverse = async (e: React.FormEvent) => {
    e.preventDefault();
    const ref = reverseRefInput.trim();
    if (!ref) {
      toast.error(t('toast_gl_ref_required'));
      return;
    }
    setIsSubmitting(true);
    try {
      await accountingService.reverseJournalByReference(ref);
      toast.success(t('toast_gl_reverse_posted'));
      onJournalChanged?.();
      setReverseRefInput('');
      setIsMaintenanceOpen(false);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? String(err.message)
          : err instanceof Error
            ? err.message
            : String(err);
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitUndo = async (e: React.FormEvent) => {
    e.preventDefault();
    const ref = undoRefInput.trim();
    if (!ref) {
      toast.error(t('toast_gl_ref_required'));
      return;
    }
    setIsSubmitting(true);
    try {
      await accountingService.undoJournalReversalByReference(ref);
      toast.success(t('toast_gl_undo_posted'));
      onJournalChanged?.();
      setUndoRefInput('');
      setIsMaintenanceOpen(false);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? String(err.message)
          : err instanceof Error
            ? err.message
            : String(err);
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExportPDF = (tx: Transaction) => {
    const isAr = language === 'ar';
    const descLine = resolveTxDescription(tx, language);
    const totalDebit = tx.entries.reduce((s, e) => s + (Number(e.debit) || 0), 0);
    const totalCredit = tx.entries.reduce((s, e) => s + (Number(e.credit) || 0), 0);
    openDocPreview({
      reportId: 'gl_journal_entry',
      title: isAr ? 'قيد محاسبي' : 'Journal Entry',
      scopeLabel: tx.reference || undefined,
      dateLabel: tx.date,
      columns: [],
      rows: [],
      sections: [
        {
          kind: 'keyValue',
          columnsPerRow: 3,
          items: [
            { label: isAr ? 'المرجع' : 'Reference', value: tx.reference || '—' },
            { label: isAr ? 'التاريخ' : 'Date', value: tx.date },
            { label: isAr ? 'البيان' : 'Description', value: descLine || '—' },
          ],
        },
        {
          kind: 'table',
          flow: true,
          columns: [
            { key: 'costCenter', header: isAr ? 'مركز التكلفة' : 'Cost Center', width: 18 },
            { key: 'account', header: isAr ? 'الحساب' : 'Account', width: 26 },
            { key: 'debit', header: isAr ? 'مدين' : 'Debit', width: 12, money: true },
            { key: 'credit', header: isAr ? 'دائن' : 'Credit', width: 12, money: true },
          ],
          rows: tx.entries.map((e) => {
            const acc = accounts.find((a) => a.accountCode === e.accountCode);
            const nm = acc
              ? (language === 'ar' ? acc.accountName : (acc.accountNameEn || acc.accountName))
              : (e.accountName ?? '');
            const ccLine = resolveEntryCostCenterLine(e, tx, contractsMap, projectsMap, language, indirectCentersMap);
            return {
              costCenter: ccLine || '—',
              account: `${nm} (${e.accountCode})`,
              debit: e.debit > 0 ? e.debit : '',
              credit: e.credit > 0 ? e.credit : '',
            };
          }),
          totals: { debit: totalDebit, credit: totalCredit },
          totalsLabel: isAr ? 'الإجمالي' : 'Total',
        },
        {
          kind: 'signatures',
          signatures: [
            { role: isAr ? 'إعداد' : 'Prepared by' },
            { role: isAr ? 'مراجعة' : 'Reviewed by' },
            { role: isAr ? 'اعتماد' : 'Approved by' },
          ],
        },
      ],
      filename: `Entry_${tx.reference ?? tx.id}`,
    });
  };

  const handleExportExcel = async () => {
    const XLSX = await import('xlsx');
    const isAr = language === 'ar';
    const exportTransactions = transactions;

    let entryNumber = 0;
    const rows = exportTransactions.flatMap(tx => {
      entryNumber += 1;
      return tx.entries.map((entry, idx) => ({
        [isAr ? 'م' : '#']: entryNumber,
        [isAr ? 'التاريخ' : 'Date']: tx.date,
        [isAr ? 'البيان' : 'Description']: resolveTxDescription(tx, language),
        [isAr ? 'السطر' : 'Line']: idx + 1,
        [isAr ? 'كود الحساب' : 'Account Code']: entry.accountCode,
        [isAr ? 'اسم الحساب' : 'Account Name']: entry.accountName,
        [isAr ? 'مدين' : 'Debit']: entry.debit || 0,
        [isAr ? 'دائن' : 'Credit']: entry.credit || 0,
        [isAr ? 'الصافي' : 'Net']: (entry.debit || 0) - (entry.credit || 0),
        [isAr ? 'مركز التكلفة' : 'Cost Center']: resolveEntryCostCenterLine(
          entry,
          tx,
          contractsMap,
          projectsMap,
          language,
          indirectCentersMap,
        ),
        [isAr ? 'المرجع' : 'Reference']: tx.reference ?? '',
      }));
    });

    const totalsRow = {
      [isAr ? 'م' : '#']: isAr ? 'الإجمالي' : 'Total',
      [isAr ? 'مدين' : 'Debit']: rows.reduce((sum, row) => sum + Number(row[isAr ? 'مدين' : 'Debit'] || 0), 0),
      [isAr ? 'دائن' : 'Credit']: rows.reduce((sum, row) => sum + Number(row[isAr ? 'دائن' : 'Credit'] || 0), 0),
      [isAr ? 'الصافي' : 'Net']: rows.reduce((sum, row) => sum + Number(row[isAr ? 'الصافي' : 'Net'] || 0), 0),
    };

    const ws = XLSX.utils.json_to_sheet([...rows, totalsRow]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, isAr ? 'قيود اليومية' : 'Journal Entries');
    XLSX.writeFile(wb, `Journal_Entries_${fiscalYear}_${businessTodayYmd()}.xlsx`);
  };

  const totalDebit = entryForm.entries.reduce((s, e) => s + Number(e.debit), 0);
  const totalCredit = entryForm.entries.reduce((s, e) => s + Number(e.credit), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  const modalBg = cn('border rounded-2xl w-full overflow-hidden shadow-2xl transition-colors', theme === 'dark' ? 'bg-[#151619] border-gray-800' : theme === 'soft' ? 'bg-white border-[#cfd8dc]' : 'bg-white border-gray-200');
  const modalHeader = cn('p-6 border-b flex justify-between items-center transition-colors', theme === 'dark' ? 'bg-gray-900/50 border-gray-800' : theme === 'soft' ? 'bg-[#eceff1] border-[#cfd8dc]' : 'bg-gray-50 border-gray-200');

  return (
    <>
      <div className="flex flex-wrap justify-end gap-2 mb-4">
        {allowEdit && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setIsMaintenanceOpen(true)}
              className={cn(
                'px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 border',
                theme === 'dark' ? 'border-amber-600/50 text-amber-400 hover:bg-amber-600/10' : 'border-amber-500 text-amber-800 hover:bg-amber-50',
              )}
            >
              <Wrench size={18} />
              {t('gl_journal_maintenance')}
            </button>
            <ManualHelpButton topicId="ledger.journal.reverse" size={16} />
          </div>
        )}
        {allowCreate && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                void refreshBusinessPostingDate();
                setIsEntryModalOpen(true);
              }}
              className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 text-white"
            >
              <Plus size={18} />
              {language === 'ar' ? 'قيد جديد' : 'New Entry'}
            </button>
            <ManualHelpButton topicId="ledger.journal.manual_entry" size={16} />
          </div>
        )}
      </div>

      <div className={cn('border rounded-xl overflow-hidden shadow-2xl transition-colors', theme === 'dark' ? 'bg-[#151619] border-gray-800' : theme === 'soft' ? 'bg-white border-[#cfd8dc]' : 'bg-white border-gray-200')}>
        <div className={cn('p-4 border-b flex items-center justify-between transition-colors', theme === 'dark' ? 'bg-gray-900/50 border-gray-800' : theme === 'soft' ? 'bg-[#eceff1] border-[#cfd8dc]' : 'bg-gray-50 border-gray-200')}>
          <div className="flex items-center gap-3">
            <span className={cn('text-xs', theme === 'dark' ? 'text-gray-400' : 'text-gray-500')}>
              {loading
                ? (language === 'ar' ? 'جاري التحميل…' : 'Loading…')
                : (language === 'ar' ? `${transactions.length} قيد` : `${transactions.length} entries`)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" title={language === 'ar' ? 'طباعة القيود' : 'Print entries'} aria-label={language === 'ar' ? 'طباعة القيود' : 'Print entries'} className={cn('p-2 rounded-lg transition-colors', theme === 'dark' ? 'hover:bg-gray-800 text-gray-400' : theme === 'soft' ? 'hover:bg-[#dde3e8] text-[#546e7a]' : 'hover:bg-gray-100 text-gray-500')}><Printer size={18} /></button>
            <button
              type="button"
              onClick={handleExportExcel}
              title={language === 'ar' ? 'تحميل قيود اليومية Excel' : 'Download journal entries Excel'}
              className={cn('p-2 rounded-lg transition-colors', theme === 'dark' ? 'hover:bg-gray-800 text-gray-400' : theme === 'soft' ? 'hover:bg-[#dde3e8] text-[#546e7a]' : 'hover:bg-gray-100 text-gray-500')}
            >
              <Download size={18} />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className={cn('border-b transition-colors', theme === 'dark' ? 'border-gray-800 bg-gray-900/30' : theme === 'soft' ? 'border-[#cfd8dc] bg-[#eceff1]' : 'border-gray-200 bg-gray-50')}>
                <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'التاريخ' : 'Date'}</th>
                <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'البيان' : 'Description'}</th>
                <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'مركز التكلفة' : 'Cost Center'}</th>
                <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'الحساب' : 'Account'}</th>
                <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'مدين' : 'Debit'}</th>
                <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'دائن' : 'Credit'}</th>
              </tr>
            </thead>
            <tbody className={cn('divide-y transition-colors', theme === 'dark' ? 'divide-gray-800/50' : theme === 'soft' ? 'divide-[#cfd8dc]' : 'divide-gray-100')}>
              {transactions.map((tx, ti) => (
                <React.Fragment key={listKey(tx.id, ti, 'gl-tx')}>
                  {tx.entries.map((entry, idx) => (
                    <tr key={listKey(`${tx.id}-${entry.accountCode}-${idx}`, idx, `gl-line-${ti}`)} className={cn('transition-colors group cursor-pointer', theme === 'dark' ? 'hover:bg-gray-800/20' : theme === 'soft' ? 'hover:bg-[#eceff1]/50' : 'hover:bg-gray-50')} onClick={() => setSelectedTransaction(tx)}>
                      <td className="px-6 py-4 text-sm font-mono text-gray-500">{idx === 0 ? tx.date : ''}</td>
                      <td className="px-6 py-4 text-sm font-bold">{idx === 0 ? resolveTxDescription(tx, language) : ''}</td>
                      <td className="px-6 py-4 text-sm text-blue-400 font-medium">
                        {resolveEntryCostCenterLine(entry, tx, contractsMap, projectsMap, language, indirectCentersMap)}
                      </td>
                      <td className="px-6 py-4 text-sm"><div className="flex items-center gap-2"><span className="font-mono text-[10px] text-gray-500">{entry.accountCode}</span><span>{(() => { const acc = accounts.find(a => a.accountCode === entry.accountCode); return acc ? language === 'ar' ? acc.accountName : (acc.accountNameEn || acc.accountName) : entry.accountName; })()}</span></div></td>
                      <td className="px-6 py-4 text-sm font-mono text-blue-400">{entry.debit > 0 ? formatMoney(entry.debit, moneyLocale) : ''}</td>
                      <td className="px-6 py-4 text-sm font-mono text-red-400">{entry.credit > 0 ? formatMoney(entry.credit, moneyLocale) : ''}</td>
                    </tr>
                  ))}
                  <tr className={cn('border-b transition-colors', theme === 'dark' ? 'bg-gray-900/10 border-gray-800/50' : theme === 'soft' ? 'bg-[#eceff1]/20 border-[#cfd8dc]' : 'bg-gray-50/50 border-gray-100')}>
                    <td colSpan={6} className="px-6 py-1 text-[10px] text-gray-500 italic">{language === 'ar' ? 'مرجع: ' : 'Ref: '}{tx.reference}</td>
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {transactions.length >= transactionLimit && (
          <div className={cn('px-4 pt-3 text-xs', theme === 'dark' ? 'text-amber-300/90' : 'text-amber-700')}>
            {language === 'ar'
              ? `يعرض ${transactionLimit} قيد كحد أقصى — استخدم «تحميل المزيد» إن وُجدت قيود إضافية`
              : `Showing up to ${transactionLimit} entries — use Load More if more exist`}
          </div>
        )}
        {transactions.length >= transactionLimit && (
          <div className={cn('p-4 border-t transition-colors flex justify-center', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
            <button onClick={onLoadMore} className="text-blue-400 hover:text-blue-300 text-sm font-bold flex items-center gap-2">
              <ChevronLast size={16} />
              {language === 'ar' ? 'تحميل المزيد من القيود' : 'Load More Entries'}
            </button>
          </div>
        )}
      </div>

      {/* Journal maintenance: reverse / undo reversal by reference */}
      <AnimatePresence>
        {isMaintenanceOpen && (
          <div className="fixed inset-0 z-[55] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className={cn(modalBg, 'max-w-lg w-full')}
            >
              <div className={modalHeader}>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-bold">{t('gl_journal_maintenance')}</h3>
                  <ManualHelpButton topicId="ledger.journal.reverse" size={16} />
                </div>
                <button type="button" title={language === 'ar' ? 'إغلاق' : 'Close'} aria-label={language === 'ar' ? 'إغلاق' : 'Close'} onClick={() => setIsMaintenanceOpen(false)} className="text-gray-500 hover:text-white transition-colors">
                  <X size={20} />
                </button>
              </div>
              <div className="p-6 space-y-8">
                <form onSubmit={handleSubmitReverse} className="space-y-3">
                  <h4 className="text-sm font-bold text-amber-600/90">{t('gl_reverse_by_ref_title')}</h4>
                  <p className="text-xs text-gray-500">{t('gl_reverse_by_ref_hint')}</p>
                  <input
                    type="text"
                    className={inputCls()}
                    value={reverseRefInput}
                    onChange={(e) => setReverseRefInput(e.target.value)}
                    placeholder={t('gl_reference_placeholder')}
                  />
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-60 py-2.5 rounded-lg text-sm font-bold text-white flex items-center justify-center gap-2"
                  >
                    {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : null}
                    {t('gl_run_reverse')}
                  </button>
                </form>
                <div className="border-t border-gray-700/30 pt-6">
                  <form onSubmit={handleSubmitUndo} className="space-y-3">
                    <h4 className="text-sm font-bold text-slate-400">{t('gl_undo_reversal_title')}</h4>
                    <p className="text-xs text-gray-500">{t('gl_undo_reversal_hint')}</p>
                    <input
                      type="text"
                      className={inputCls()}
                      value={undoRefInput}
                      onChange={(e) => setUndoRefInput(e.target.value)}
                      placeholder={t('gl_undo_reference_placeholder')}
                    />
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full bg-slate-600 hover:bg-slate-500 disabled:opacity-60 py-2.5 rounded-lg text-sm font-bold text-white flex items-center justify-center gap-2"
                    >
                      {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : null}
                      {t('gl_run_undo')}
                    </button>
                  </form>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* New Entry Modal */}
      <AnimatePresence>
        {isEntryModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className={cn(modalBg, 'max-w-4xl')}>
              <div className={modalHeader}>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-bold">{language === 'ar' ? 'إضافة قيد محاسبي جديد' : 'Add New Journal Entry'}</h3>
                  <ManualHelpButton topicId="ledger.journal.manual_entry" size={16} />
                </div>
                <button type="button" title={language === 'ar' ? 'إغلاق' : 'Close'} aria-label={language === 'ar' ? 'إغلاق' : 'Close'} onClick={() => setIsEntryModalOpen(false)} className="text-gray-500 hover:text-white transition-colors"><X size={20} /></button>
              </div>
              <form onSubmit={handleSaveEntry} className="p-6 space-y-6">
                <FormDraftRestoreBanner
                  show={!!glRestore}
                  updatedAt={glRestore?.updatedAt}
                  onRestore={() => {
                    if (glRestore?.payload) setEntryForm(glRestore.payload as typeof entryForm);
                    acceptGlRestore();
                  }}
                  onDiscard={() => {
                    void dismissGlRestore();
                  }}
                />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase">{language === 'ar' ? 'التاريخ' : 'Date'}</label>
                    <input
                      required
                      type="date"
                      readOnly
                      title={t('gl_posting_date_hint')}
                      className={inputCls('opacity-90 cursor-default')}
                      value={entryForm.date}
                    />
                    <p className={cn('text-[11px] mt-1', theme === 'dark' ? 'text-gray-500' : 'text-gray-500')}>
                      {t('gl_posting_date_hint').replace('{tz}', businessTimeZone)}
                    </p>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-xs font-bold text-gray-400 uppercase">{language === 'ar' ? 'البيان (عربي)' : 'Description (Arabic)'}</label>
                    <input required type="text" placeholder={language === 'ar' ? 'وصف القيد بالعربية' : 'Entry description in Arabic'} className={inputCls()} value={entryForm.description} onChange={(e) => setEntryForm({ ...entryForm, description: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase">{language === 'ar' ? 'البيان (إنجليزي) — اختياري' : 'Description (English) — optional'}</label>
                  <input type="text" placeholder={language === 'ar' ? 'نفس البيان بالإنجليزية إن وُجد' : 'English wording if different'} className={inputCls()} value={entryForm.descriptionEn} onChange={(e) => setEntryForm({ ...entryForm, descriptionEn: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-gray-400 uppercase">{language === 'ar' ? 'مركز التكلفة' : 'Cost Center'}</label>
                    {allowCreate && (
                      <button type="button" onClick={() => setIsContractModalOpen(true)} className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1"><Plus size={12} />{language === 'ar' ? 'عقد جديد' : 'New Contract'}</button>
                    )}
                  </div>
                  <SearchableSelect
                    value={entryForm.costCenterId}
                    onChange={(v) => setEntryForm({ ...entryForm, costCenterId: v })}
                    theme={theme}
                    dir={dir}
                    placeholder={language === 'ar' ? 'اختر مركز التكلفة' : 'Select cost center'}
                    options={costCenterOptions}
                  />
                </div>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h4 className="text-sm font-bold text-blue-400 uppercase tracking-wider">{language === 'ar' ? 'بنود القيد' : 'Entry Lines'}</h4>
                    {allowCreate && (
                      <button type="button" onClick={() => setEntryForm({ ...entryForm, entries: [...entryForm.entries, { id: crypto.randomUUID(), accountCode: '', accountName: '', debit: 0, credit: 0 }] })} className={cn('text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1', theme === 'dark' ? 'bg-gray-800 hover:bg-gray-700 text-gray-200' : theme === 'soft' ? 'bg-[#dde3e8] hover:bg-[#cfd8dc] text-[#37474f]' : 'bg-gray-100 hover:bg-gray-200 text-gray-700')}><Plus size={14} />{language === 'ar' ? 'إضافة سطر' : 'Add Line'}</button>
                    )}
                  </div>
                  <div className="space-y-3">
                    {entryForm.entries.map((entry, idx) => (
                      <div key={listKey(entry.id, idx, 'entry-form')} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                        <div className="md:col-span-5 space-y-1">
                          <label className="text-[10px] text-gray-500 uppercase">{language === 'ar' ? 'الحساب' : 'Account'}</label>
                          <SearchableSelect
                            value={entry.accountCode}
                            onChange={(v) => handleEntryChange(idx, 'accountCode', v)}
                            theme={theme}
                            dir={dir}
                            placeholder={language === 'ar' ? 'اختر الحساب' : 'Select Account'}
                            options={accounts.filter(a => !a.isGroup && a.status !== 'disabled' && a.accountCode.length === 8).map(a => ({
                              value: a.accountCode,
                              secondary: a.accountCode,
                              label: language === 'ar' ? a.accountName : (a.accountNameEn || a.accountName),
                            }))}
                          />
                        </div>
                        <div className="md:col-span-3 space-y-1">
                          <label className="text-[10px] text-gray-500 uppercase">{language === 'ar' ? 'مدين' : 'Debit'}</label>
                          <input type="number" step="1" title={language === 'ar' ? 'مبلغ المدين' : 'Debit amount'} placeholder="0" className={cn(inputCls('py-2 px-3'), theme === 'dark' ? 'text-blue-400' : 'text-blue-700')} value={entry.debit || ''} onChange={(e) => handleEntryChange(idx, 'debit', e.target.value)} />
                        </div>
                        <div className="md:col-span-3 space-y-1">
                          <label className="text-[10px] text-gray-500 uppercase">{language === 'ar' ? 'دائن' : 'Credit'}</label>
                          <input type="number" step="1" title={language === 'ar' ? 'مبلغ الدائن' : 'Credit amount'} placeholder="0" className={cn(inputCls('py-2 px-3'), theme === 'dark' ? 'text-red-400' : 'text-red-700')} value={entry.credit || ''} onChange={(e) => handleEntryChange(idx, 'credit', e.target.value)} />
                        </div>
                        <div className="md:col-span-1 flex justify-center pb-2">
                          <button type="button" title={language === 'ar' ? 'حذف السطر' : 'Remove line'} aria-label={language === 'ar' ? 'حذف السطر' : 'Remove line'} onClick={() => setEntryForm({ ...entryForm, entries: entryForm.entries.filter((_, i) => i !== idx) })} className="text-gray-500 hover:text-red-500 transition-colors" disabled={!allowCreate}><Trash2 size={18} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className={cn('pt-6 border-t flex justify-between items-center transition-colors', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
                  <div className="flex gap-8 text-sm">
                    <div className="flex flex-col"><span className="text-gray-500 text-[10px] uppercase">{language === 'ar' ? 'إجمالي المدين' : 'Total Debit'}</span><span className="font-mono font-bold text-blue-400">{formatMoney(totalDebit, moneyLocale)}</span></div>
                    <div className="flex flex-col"><span className="text-gray-500 text-[10px] uppercase">{language === 'ar' ? 'إجمالي الدائن' : 'Total Credit'}</span><span className="font-mono font-bold text-red-400">{formatMoney(totalCredit, moneyLocale)}</span></div>
                    <div className="flex flex-col"><span className="text-gray-500 text-[10px] uppercase">{language === 'ar' ? 'الفرق' : 'Difference'}</span><span className={cn('font-mono font-bold', isBalanced ? 'text-green-500' : 'text-red-500')}>{formatMoney(totalDebit - totalCredit, moneyLocale)}</span></div>
                  </div>
                  <div className="flex gap-3">
                    <button type="submit" disabled={isSubmitting || !allowCreate} className="bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 px-8 py-3 rounded-xl font-bold transition-all flex items-center gap-2 text-white">
                      {isSubmitting ? (language === 'ar' ? 'جاري الحفظ...' : 'Saving...') : (language === 'ar' ? 'حفظ القيد' : 'Save Entry')}
                    </button>
                    <button type="button" onClick={() => setIsEntryModalOpen(false)} className={cn('px-8 py-3 rounded-xl font-bold transition-all', theme === 'dark' ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-100 hover:bg-gray-200 text-gray-900')}>
                      {language === 'ar' ? 'إلغاء' : 'Cancel'}
                    </button>
                  </div>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Contract Modal */}
      <AnimatePresence>
        {isContractModalOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className={cn(modalBg, 'max-w-md')}>
              <div className={modalHeader}>
                <h3 className="text-lg font-bold">{language === 'ar' ? 'إضافة عقد جديد' : 'Add New Contract'}</h3>
                <button type="button" title={language === 'ar' ? 'إغلاق' : 'Close'} aria-label={language === 'ar' ? 'إغلاق' : 'Close'} onClick={() => setIsContractModalOpen(false)} className={cn('transition-colors', theme === 'dark' ? 'text-gray-500 hover:text-white' : 'text-gray-400 hover:text-gray-900')}><X size={20} /></button>
              </div>
              <form onSubmit={handleSaveContract} className="p-6 space-y-4">
                <div className="space-y-1">
                  <label className={cn('text-xs uppercase font-bold', theme === 'dark' ? 'text-gray-400' : 'text-gray-500')}>{language === 'ar' ? 'اسم العقد' : 'Contract Name'}</label>
                  <input required type="text" title={language === 'ar' ? 'اسم العقد' : 'Contract name'} placeholder={language === 'ar' ? 'اسم العقد' : 'Contract name'} className={inputCls()} value={contractForm.contractName} onChange={(e) => setContractForm({ ...contractForm, contractName: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <label className={cn('text-xs uppercase font-bold', theme === 'dark' ? 'text-gray-400' : 'text-gray-500')}>{language === 'ar' ? 'رقم العقد' : 'Contract Number'}</label>
                  <input required type="text" title={language === 'ar' ? 'رقم العقد' : 'Contract number'} placeholder={language === 'ar' ? 'رقم العقد' : 'Contract number'} className={inputCls()} value={contractForm.contractNumber} onChange={(e) => setContractForm({ ...contractForm, contractNumber: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'المشروع المرتبط' : 'Linked Project'}</label>
                    {allowCreate && (
                      <button type="button" onClick={() => setIsProjectModalOpen(true)} className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1"><Plus size={12} />{language === 'ar' ? 'مشروع جديد' : 'New Project'}</button>
                    )}
                  </div>
                  <SearchableSelect
                    value={contractForm.projectId}
                    onChange={(v) => setContractForm({ ...contractForm, projectId: v })}
                    theme={theme}
                    dir={dir}
                    placeholder={language === 'ar' ? 'اختر المشروع' : 'Select Project'}
                    options={projects.map(p => ({ value: p.id, secondary: p.projectCode, label: p.projectName }))}
                  />
                </div>
                <div className="pt-4 flex gap-3">
                  <button type="submit" disabled={isSubmitting} className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 py-2 rounded-lg font-bold transition-colors text-white">{isSubmitting ? '...' : (language === 'ar' ? 'حفظ العقد' : 'Save Contract')}</button>
                  <button type="button" onClick={() => setIsContractModalOpen(false)} className={cn('flex-1 py-2 rounded-lg font-bold transition-colors', theme === 'dark' ? 'bg-gray-800 hover:bg-gray-700 text-gray-200' : theme === 'soft' ? 'bg-[#dde3e8] hover:bg-[#cfd8dc] text-[#37474f]' : 'bg-gray-100 hover:bg-gray-200 text-gray-700')}>{language === 'ar' ? 'إلغاء' : 'Cancel'}</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Project Modal */}
      <AnimatePresence>
        {isProjectModalOpen && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/90 backdrop-blur-lg">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className={cn(modalBg, 'max-w-md')}>
              <div className={modalHeader}>
                <h3 className="text-lg font-bold">{language === 'ar' ? 'إضافة مشروع جديد' : 'Add New Project'}</h3>
                <button type="button" title={language === 'ar' ? 'إغلاق' : 'Close'} aria-label={language === 'ar' ? 'إغلاق' : 'Close'} onClick={() => setIsProjectModalOpen(false)} className={cn('transition-colors', theme === 'dark' ? 'text-gray-500 hover:text-white' : 'text-gray-400 hover:text-gray-900')}><X size={20} /></button>
              </div>
              <form onSubmit={handleSaveProject} className="p-6 space-y-4">
                <div className="space-y-1"><label className={cn('text-xs uppercase font-bold', theme === 'dark' ? 'text-gray-400' : 'text-gray-500')}>{language === 'ar' ? 'اسم المشروع' : 'Project Name'}</label><input required type="text" title={language === 'ar' ? 'اسم المشروع' : 'Project name'} placeholder={language === 'ar' ? 'اسم المشروع' : 'Project name'} className={inputCls()} value={projectForm.projectName} onChange={(e) => setProjectForm({ ...projectForm, projectName: e.target.value })} /></div>
                <div className="space-y-1"><label className={cn('text-xs uppercase font-bold', theme === 'dark' ? 'text-gray-400' : 'text-gray-500')}>{language === 'ar' ? 'كود المشروع' : 'Project Code'}</label><input required type="text" title={language === 'ar' ? 'كود المشروع' : 'Project code'} placeholder={language === 'ar' ? 'كود المشروع' : 'Project code'} className={inputCls()} value={projectForm.projectCode} onChange={(e) => setProjectForm({ ...projectForm, projectCode: e.target.value })} /></div>
                <div className="space-y-1"><label className={cn('text-xs uppercase font-bold', theme === 'dark' ? 'text-gray-400' : 'text-gray-500')}>{language === 'ar' ? 'العميل' : 'Client'}</label><input required type="text" title={language === 'ar' ? 'اسم العميل' : 'Client name'} placeholder={language === 'ar' ? 'اسم العميل' : 'Client name'} className={inputCls()} value={projectForm.clientName} onChange={(e) => setProjectForm({ ...projectForm, clientName: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1"><label className={cn('text-xs uppercase font-bold', theme === 'dark' ? 'text-gray-400' : 'text-gray-500')}>{language === 'ar' ? 'الميزانية' : 'Budget'}</label><input required type="number" title={language === 'ar' ? 'ميزانية المشروع' : 'Project budget'} placeholder="0" className={inputCls()} value={projectForm.budget || ''} onChange={(e) => setProjectForm({ ...projectForm, budget: Number(e.target.value) })} /></div>
                  <div className="space-y-1"><label className={cn('text-xs uppercase font-bold', theme === 'dark' ? 'text-gray-400' : 'text-gray-500')}>{language === 'ar' ? 'تاريخ البدء' : 'Start Date'}</label><input required type="date" title={language === 'ar' ? 'تاريخ بدء المشروع' : 'Project start date'} className={inputCls()} value={projectForm.startDate} onChange={(e) => setProjectForm({ ...projectForm, startDate: e.target.value })} /></div>
                </div>
                <div className="pt-4 flex gap-3">
                  <button type="submit" disabled={isSubmitting} className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 py-2 rounded-lg font-bold transition-colors text-white">{isSubmitting ? '...' : (language === 'ar' ? 'حفظ المشروع' : 'Save Project')}</button>
                  <button type="button" onClick={() => setIsProjectModalOpen(false)} className={cn('flex-1 py-2 rounded-lg font-bold transition-colors', theme === 'dark' ? 'bg-gray-800 hover:bg-gray-700 text-gray-200' : theme === 'soft' ? 'bg-[#dde3e8] hover:bg-[#cfd8dc] text-[#37474f]' : 'bg-gray-100 hover:bg-gray-200 text-gray-700')}>{language === 'ar' ? 'إلغاء' : 'Cancel'}</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Transaction detail — portal to body so it floats over the journal (not clipped by window overflow) */}
      {createPortal(
        <AnimatePresence>
          {selectedTransaction && (
            <div
              className={cn(
                'fixed inset-0 flex items-center justify-center p-4 overflow-y-auto overscroll-contain bg-black/60 backdrop-blur-sm',
                SHELL_MODAL_ROOT_CLASS,
                SHELL_MODAL_Z,
              )}
              dir={dir}
              role="presentation"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) setSelectedTransaction(null);
              }}
            >
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-label={language === 'ar' ? 'تفاصيل القيد' : 'Journal Entry Details'}
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className={cn(modalBg, 'max-w-2xl w-full max-h-[min(95dvh,calc(100vh-2rem))] flex flex-col my-auto')}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className={cn(modalHeader, 'shrink-0 p-4 sm:p-6')}>
                  <div className="min-w-0 pr-2">
                    <h3 className="text-xl font-bold">{language === 'ar' ? 'تفاصيل القيد' : 'Journal Entry Details'}</h3>
                    <p className="text-xs text-gray-500 mt-1 font-mono truncate">{selectedTransaction.reference || '—'}</p>
                  </div>
                  <button type="button" title={language === 'ar' ? 'إغلاق' : 'Close'} aria-label={language === 'ar' ? 'إغلاق' : 'Close'} onClick={() => setSelectedTransaction(null)} className="text-gray-500 hover:text-white transition-colors shrink-0"><X size={20} /></button>
                </div>
                <div className="flex flex-col flex-1 min-h-0">
                  <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 sm:p-6 space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                      <div><p className="text-[10px] text-gray-500 font-bold uppercase mb-1">{language === 'ar' ? 'التاريخ' : 'Date'}</p><p className="text-sm font-bold">{selectedTransaction.date}</p></div>
                      <div className="sm:col-span-2"><p className="text-[10px] text-gray-500 font-bold uppercase mb-1">{language === 'ar' ? 'البيان' : 'Description'}</p><p className="text-sm font-bold break-words">{resolveTxDescription(selectedTransaction, language)}</p></div>
                    </div>
                    <div className={cn('rounded-xl overflow-x-auto border', theme === 'dark' ? 'border-gray-800' : theme === 'soft' ? 'border-[#cfd8dc]' : 'border-gray-200')}>
                      <table className="w-full text-right min-w-[28rem]">
                        <thead><tr className={cn('border-b', theme === 'dark' ? 'bg-gray-900/50 border-gray-800' : theme === 'soft' ? 'bg-[#eceff1] border-[#cfd8dc]' : 'bg-gray-50 border-gray-200')}><th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase">{language === 'ar' ? 'مركز التكلفة' : 'Cost Center'}</th><th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase">{language === 'ar' ? 'الحساب' : 'Account'}</th><th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase">{language === 'ar' ? 'مدين' : 'Debit'}</th><th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase">{language === 'ar' ? 'دائن' : 'Credit'}</th></tr></thead>
                        <tbody className={cn('divide-y', theme === 'dark' ? 'divide-gray-800' : theme === 'soft' ? 'divide-[#cfd8dc]' : 'divide-gray-100')}>
                          {selectedTransaction.entries.map((e, idx) => {
                            const acc = accounts.find(a => a.accountCode === e.accountCode);
                            const lineName = acc
                              ? language === 'ar'
                                ? acc.accountName
                                : (acc.accountNameEn || acc.accountName)
                              : e.accountName;
                            const ccLine = resolveEntryCostCenterLine(
                              e,
                              selectedTransaction,
                              contractsMap,
                              projectsMap,
                              language,
                              indirectCentersMap,
                            );
                            return (
                              <tr key={idx} className={cn('transition-colors', theme === 'dark' ? 'hover:bg-gray-800/20' : theme === 'soft' ? 'hover:bg-[#eceff1]/50' : 'hover:bg-gray-50')}><td className="px-4 py-3 text-sm text-blue-400 font-medium">{ccLine}</td><td className="px-4 py-3"><div className="flex flex-col"><span className="text-sm font-medium">{lineName}</span><span className="text-[10px] text-gray-500 font-mono">{e.accountCode}</span></div></td><td className="px-4 py-3 text-sm font-mono text-blue-400">{e.debit > 0 ? formatMoney(e.debit, moneyLocale) : '-'}</td><td className="px-4 py-3 text-sm font-mono text-red-400">{e.credit > 0 ? formatMoney(e.credit, moneyLocale) : '-'}</td></tr>
                            );
                          })}
                        </tbody>
                        <tfoot><tr className={cn('font-bold border-t', theme === 'dark' ? 'bg-gray-900/50 border-gray-800' : theme === 'soft' ? 'bg-[#eceff1] border-[#cfd8dc]' : 'bg-gray-50 border-gray-200')}><td className="px-4 py-3 text-sm" colSpan={2}>{language === 'ar' ? 'الإجمالي' : 'Total'}</td><td className="px-4 py-3 text-sm font-mono text-blue-400">{formatMoney(selectedTransaction.entries.reduce((s, e) => s + e.debit, 0), moneyLocale)}</td><td className="px-4 py-3 text-sm font-mono text-red-400">{formatMoney(selectedTransaction.entries.reduce((s, e) => s + e.credit, 0), moneyLocale)}</td></tr></tfoot>
                      </table>
                    </div>
                  </div>
                  <div
                    className={cn(
                      'shrink-0 flex flex-wrap gap-3 justify-end p-4 border-t',
                      theme === 'dark' ? 'border-gray-800 bg-[#151619]' : theme === 'soft' ? 'border-[#cfd8dc] bg-white' : 'border-gray-200 bg-white',
                    )}
                  >
                    <button type="button" onClick={() => handleExportPDF(selectedTransaction)} className={cn('px-6 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2', theme === 'dark' ? 'bg-gray-800 hover:bg-gray-700 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-900')}><Printer size={16} />{language === 'ar' ? 'طباعة' : 'Print'}</button>
                    <button type="button" onClick={() => setSelectedTransaction(null)} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-bold text-white transition-colors">{language === 'ar' ? 'إغلاق' : 'Close'}</button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body,
      )}

      {ReportPreviewHost}
    </>
  );
}
