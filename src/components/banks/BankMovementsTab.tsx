import { formatNumber } from '../../lib/numberLocale';
import React, { useEffect, useMemo, useState } from 'react';
import { collection, query, Timestamp, where } from 'firebase/firestore';
import { listenQuery } from '../../lib/firestoreListen';
import toast from 'react-hot-toast';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { cn } from '../../lib/utils';
import { businessTodayYmd } from '../../lib/businessCalendar';
import { isLocalBackend } from '../../lib/dataBackend';
import { contractsApi, projectsApi, banksApi, NetworkQueuedError } from '../../services/local/modulesApi';
import type { Account } from '../../services/accountingService';
import { accountingService } from '../../services/accountingService';
import { buildBankMovementJournalEntries, genBankDocNo, suggestInstapayFee } from '../../lib/bankMovementPosting';
import { transferDetailLabel } from '../../lib/bankTransferMeta';
import type { TransferChannel, TransferDirection, TransferScope } from './types';
import {
  createBankMovement,
  removeBankMovement,
  updateBankMovement,
} from '../../lib/bankPersistence';
import type { BankAccount, BankMovement } from './types';
import { SearchableSelect } from '../ui/SearchableSelect';
import { ManualHelpButton } from '../help/ManualHelpButton';
import { useConfirm } from '../../context/ConfirmDialogContext';
import { coaIdToAccountCode, resolveBankGlAccountCode } from '../../lib/glAccountBalance';
import { GlAccountBalanceHint } from './GlAccountBalanceHint';

const TYPES: BankMovement['movementType'][] = ['deposit', 'withdrawal', 'transfer', 'fee', 'interest', 'adjustment'];

const typeLabel = (t: BankMovement['movementType'], ar: boolean): string => {
  const map: Record<string, { ar: string; en: string }> = {
    deposit: { ar: 'إيداع', en: 'Deposit' },
    withdrawal: { ar: 'سحب', en: 'Withdrawal' },
    transfer: { ar: 'تحويل', en: 'Transfer' },
    fee: { ar: 'رسوم', en: 'Fee' },
    interest: { ar: 'فوائد', en: 'Interest' },
    adjustment: { ar: 'تسوية', en: 'Adjustment' },
  };
  const row = map[t] ?? map.transfer;
  return ar ? row.ar : row.en;
};

const COA_CODE_8 = /^\d{8}$/;

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

type Props = {
  movements: BankMovement[];
  accounts: BankAccount[];
  coaAccounts: Account[];
  balanceByCode: Map<string, number>;
  glBalancesLoading?: boolean;
  banksEdit: boolean;
  ledgerCreate: boolean;
  dir: 'rtl' | 'ltr';
  language: 'ar' | 'en';
  theme: string;
  allowCreate: boolean;
  allowEdit: boolean;
  onMutated?: () => void;
  embedded?: boolean;
  panelMode?: 'create' | 'detail';
  selectedMovementId?: string;
  onMovementCreated?: (id: string) => void;
  onCancelCreate?: () => void;
  onDetailRemoved?: () => void;
};

export function BankMovementsTab({
  movements,
  accounts,
  coaAccounts,
  balanceByCode,
  glBalancesLoading = false,
  banksEdit,
  ledgerCreate,
  dir,
  language,
  theme,
  allowCreate,
  allowEdit,
  onMutated,
  embedded = false,
  panelMode,
  selectedMovementId,
  onMovementCreated,
  onCancelCreate,
  onDetailRemoved,
}: Props) {
  const confirmDlg = useConfirm();
  const isAr = language === 'ar';
  const [filterBankId, setFilterBankId] = useState('');
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [adjDir, setAdjDir] = useState<'in' | 'out'>('in');
  const [form, setForm] = useState({
    movementType: 'deposit' as BankMovement['movementType'],
    bankAccountId: '',
    toBankAccountId: '',
    transferScope: 'internal' as TransferScope,
    transferChannel: 'bank_app' as TransferChannel,
    transferDirection: 'out' as TransferDirection,
    instapayBeneficiary: '',
    instapayFee: '',
    date: businessTodayYmd(),
    amount: '',
    reference: '',
    descriptionAr: '',
    descriptionEn: '',
    offsetChartOfAccountId: '',
    projectId: '',
    contractId: '',
  });

  const isTransferForm = form.movementType === 'transfer';
  const isInternalTransfer = isTransferForm && form.transferScope === 'internal';
  const isExternalTransfer = isTransferForm && form.transferScope === 'external';
  const showInstapayFee =
    isTransferForm && form.transferChannel === 'instapay' && form.transferDirection === 'out';

  const primaryBankLabel = (() => {
    if (!isTransferForm) return isAr ? 'اختر الحساب البنكي' : 'Select bank account';
    if (isInternalTransfer) {
      return form.transferDirection === 'out'
        ? (isAr ? 'من — حساب بنكي (الشركة)' : 'From — company bank')
        : (isAr ? 'إلى — حساب بنكي (الشركة)' : 'To — company bank');
    }
    return form.transferDirection === 'out'
      ? (isAr ? 'من — حساب بنكي (مرسل)' : 'From — sending bank')
      : (isAr ? 'إلى — حساب بنكي (مستلم)' : 'To — receiving bank');
  })();

  const counterpartyBankLabel = (() => {
    if (!isInternalTransfer) return '';
    return form.transferDirection === 'out'
      ? (isAr ? 'إلى — حساب بنكي (الشركة)' : 'To — company bank')
      : (isAr ? 'من — حساب بنكي (الشركة)' : 'From — company bank');
  })();

  const canPostLedger = banksEdit || ledgerCreate;

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

  useEffect(() => {
    if (isLocalBackend) {
      let cancelled = false;
      void (async () => {
        try {
          const [pRows, cRows] = await Promise.all([projectsApi.list(), contractsApi.list()]);
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
        } catch (err) {
          console.error('Failed to load projects/contracts for bank movements:', err);
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

  const leafCoaOptions = useMemo(() => {
    return coaAccounts
      .filter((a) => !a.isGroup && a.status !== 'disabled' && COA_CODE_8.test(String(a.accountCode).trim()))
      .map((a) => ({
        value: a.id,
        label: language === 'ar' ? a.accountName : a.accountNameEn || a.accountName,
        secondary: a.accountCode,
      }))
      .sort((x, y) => (x.secondary || '').localeCompare(y.secondary || ''));
  }, [coaAccounts, language]);

  const byBank = useMemo(
    () =>
      movements
        .filter((m) => (filterBankId ? m.bankAccountId === filterBankId : true))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [movements, filterBankId],
  );

  const needsOffsetCoa =
    form.movementType === 'deposit'
    || form.movementType === 'withdrawal'
    || form.movementType === 'adjustment'
    || isExternalTransfer;
  const showOffsetSelect = needsOffsetCoa || form.movementType === 'interest';

  const contractSelectOptions = useMemo(() => {
    const none = {
      value: '',
      label: isAr ? '— بدون مركز تكلفة —' : '— No cost center —',
    };
    const list = form.projectId ? contracts.filter((c) => c.projectId === form.projectId) : contracts;
    const opts = list.map((c) => {
      const p = projects.find((pr) => pr.id === c.projectId);
      const nameAr = c.contractName ?? c.contractNumber;
      const nameEn = c.contractNameEn || c.contractName || c.contractNumber;
      return {
        value: c.id,
        secondary: c.contractNumber,
        label: isAr ? `${nameAr} — ${p?.projectName ?? ''}` : `${nameEn} — ${p?.projectNameEn || p?.projectName || ''}`,
      };
    });
    return [none, ...opts];
  }, [contracts, projects, form.projectId, isAr]);

  const primaryBankAccount = useMemo(
    () => accounts.find((a) => a.id === form.bankAccountId),
    [accounts, form.bankAccountId],
  );

  const primaryBankGlCode = useMemo(
    () => (primaryBankAccount ? resolveBankGlAccountCode(primaryBankAccount, coaAccounts) : ''),
    [primaryBankAccount, coaAccounts],
  );

  const counterpartyBankAccount = useMemo(
    () => accounts.find((a) => a.id === form.toBankAccountId),
    [accounts, form.toBankAccountId],
  );

  const counterpartyBankGlCode = useMemo(
    () => (counterpartyBankAccount ? resolveBankGlAccountCode(counterpartyBankAccount, coaAccounts) : ''),
    [counterpartyBankAccount, coaAccounts],
  );

  const offsetGlCode = useMemo(
    () => coaIdToAccountCode(form.offsetChartOfAccountId, coaAccounts),
    [form.offsetChartOfAccountId, coaAccounts],
  );

  function resolveOffsetForSave(): Pick<BankMovement, 'offsetChartOfAccountId' | 'offsetAccountCode' | 'offsetAccountName'> {
    const id = form.offsetChartOfAccountId.trim();
    if (!id) return {};
    const leaf = coaAccounts.find((a) => a.id === id);
    if (!leaf) return {};
    return {
      offsetChartOfAccountId: leaf.id,
      offsetAccountCode: leaf.accountCode,
      offsetAccountName: leaf.accountName,
    };
  }

  const create = async () => {
    if (!allowCreate) return;
    const amount = Number(form.amount);
    if (!form.bankAccountId || !form.date || !Number.isFinite(amount) || amount <= 0) {
      toast.error(isAr ? 'أكمل البيانات بشكل صحيح.' : 'Complete valid movement fields.');
      return;
    }
    if (isInternalTransfer) {
      if (!form.toBankAccountId || form.toBankAccountId === form.bankAccountId) {
        toast.error(isAr ? 'اختر حساباً بنكياً مختلفاً للطرف الآخر.' : 'Pick a distinct counterparty bank account.');
        return;
      }
    }
    if (isExternalTransfer && !form.offsetChartOfAccountId.trim()) {
      toast.error(isAr ? 'للجهة المستفيدة اختر حساباً من الدليل (8 أرقام).' : 'For external beneficiary select an offset GL leaf (8 digits).');
      return;
    }
    if (needsOffsetCoa && !form.offsetChartOfAccountId.trim()) {
      toast.error(isAr ? 'اختر حساب الطرف المقابل من الدليل (8 أرقام).' : 'Select offset GL leaf (8 digits).');
      return;
    }

    const bankRow = accounts.find((a) => a.id === form.bankAccountId);
    const curr = bankRow?.currency?.trim() || 'EGP';
    const off = resolveOffsetForSave();

    const feeNum = showInstapayFee && form.instapayFee.trim() ? Number(form.instapayFee) : null;

    setSaving(true);
    try {
      const newId = await createBankMovement({
        documentNo: genBankDocNo('BM'),
        movementType: form.movementType,
        bankAccountId: form.bankAccountId,
        toBankAccountId: isInternalTransfer ? form.toBankAccountId : null,
        transferScope: isTransferForm ? form.transferScope : null,
        transferChannel: isTransferForm ? form.transferChannel : null,
        transferDirection: isTransferForm ? form.transferDirection : null,
        date: form.date,
        amount,
        currency: curr,
        reference: form.reference.trim() || null,
        descriptionAr: form.descriptionAr.trim() || null,
        descriptionEn: form.descriptionEn.trim() || null,
        instapayBeneficiary: isExternalTransfer ? form.instapayBeneficiary.trim() || null : null,
        instapayFee: feeNum != null && Number.isFinite(feeNum) && feeNum > 0 ? feeNum : null,
        projectId: form.projectId.trim() || null,
        contractId: form.contractId.trim() || null,
        ...off,
        adjustmentDirection:
          form.movementType === 'adjustment' ? adjDir : null,
        status: 'draft',
        createdAt: Timestamp.now(),
      });
      onMutated?.();
      toast.success(isAr ? 'تم حفظ مسودة الحركة.' : 'Movement draft created.');
      if (embedded && onMovementCreated) {
        onMovementCreated(newId);
        return;
      }
      setForm((f) => ({
        ...f,
        amount: '',
        reference: '',
        descriptionAr: '',
        descriptionEn: '',
        offsetChartOfAccountId: '',
        toBankAccountId: '',
        instapayBeneficiary: '',
        instapayFee: '',
        contractId: '',
      }));
    } catch {
      toast.error(isAr ? 'تعذر إنشاء الحركة.' : 'Failed to create movement.');
    } finally {
      setSaving(false);
    }
  };

  const post = async (m: BankMovement) => {
    if (!allowEdit) return;
    if (!canPostLedger) {
      toast.error(isAr ? 'يجب امتلاك صلاحية تعديل البنوك أو إنشاء قيود للترحيل.' : 'Posting requires Banks edit or Ledger create.');
      return;
    }
    const bankRow = accounts.find((a) => a.id === m.bankAccountId);
    if (!bankRow) {
      toast.error(isAr ? 'الحساب البنكي غير موجود.' : 'Bank account missing.');
      return;
    }
    try {
      const entries = buildBankMovementJournalEntries({
        movementType: m.movementType,
        amount: m.amount,
        bankAccount: bankRow,
        toBankAccount: m.toBankAccountId ? accounts.find((a) => a.id === m.toBankAccountId) ?? null : null,
        offsetChartOfAccountId: m.offsetChartOfAccountId,
        adjustmentDirection: m.movementType === 'adjustment' ? m.adjustmentDirection || 'in' : undefined,
        transferScope: m.transferScope,
        transferChannel: m.transferChannel,
        transferDirection: m.transferDirection,
        instapayFee: m.instapayFee,
        chartOfAccounts: coaAccounts,
      });
      const docNo = m.documentNo?.trim() || genBankDocNo('BM');
      const glRef = m.reference?.trim() || docNo;
      const desc =
        (m.descriptionAr?.trim() || m.note?.trim() || '').trim() ||
        (isAr ? `حركة بنكية ${docNo}` : `Bank movement ${docNo}`);

      if (isLocalBackend) {
        await banksApi.movements.post(m.id, {
          documentNo: m.documentNo?.trim() ? undefined : docNo,
          journal: {
            date: m.date,
            description: desc,
            reference: glRef,
            projectId: m.projectId || null,
            costCenterId: m.contractId || null,
            entries,
          },
        });
      } else {
        const txId = await accountingService.createTransaction({
          date: m.date,
          description: desc,
          descriptionEn: m.descriptionEn?.trim() || null,
          reference: glRef,
          projectId: m.projectId,
          costCenterId: m.contractId,
          entries,
        });

        await updateBankMovement(m.id, {
          status: 'posted',
          ...(m.documentNo?.trim() ? {} : { documentNo: docNo }),
          postedGlReference: glRef,
          glTransactionId: txId,
          postedAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });
      }
      onMutated?.();
      toast.success(isAr ? 'تم ترحيل الحركة وإنشاء القيد في الأستاذ.' : 'Posted; journal entry created.');
    } catch (err) {
      if (err instanceof NetworkQueuedError) return;
      const msg = err instanceof Error ? err.message : '';
      toast.error(msg || (isAr ? 'تعذر الترحيل.' : 'Failed to post movement.'));
    }
  };

  const cancel = async (bm: BankMovement) => {
    if (!allowEdit || !canPostLedger) return;
    const ok = await confirmDlg({
      title: isAr ? 'إلغاء حركة مرحَّلة' : 'Cancel posted movement',
      message: isAr ? 'سيُنشَأ قيد عكسي في الأستاذ العام. أكمل؟' : 'A reversing journal entry will be created. Continue?',
      variant: 'danger',
      confirmLabel: isAr ? 'تأكيد' : 'Confirm',
    });
    if (!ok) return;

    const ref = bm.postedGlReference?.trim();
    if (!ref && !bm.glTransactionId) {
      toast.error(
        isAr
          ? 'لا يوجد مرجع قيد محفوظ لحركة قديمة — تعذر العكس الآمن.'
          : 'Missing saved GL reference for this legacy post; cannot safely reverse.',
      );
      return;
    }
    try {
      if (isLocalBackend) {
        await banksApi.movements.cancelPosted(bm.id);
      } else {
        if (!ref) {
          toast.error(
            isAr
              ? 'لا يوجد مرجع قيد محفوظ لحركة قديمة — تعذر العكس الآمن.'
              : 'Missing saved GL reference for this legacy post; cannot safely reverse.',
          );
          return;
        }
        const revId = await accountingService.reverseJournalByReference(ref);
        await updateBankMovement(bm.id, {
          status: 'cancelled',
          reversalTransactionId: revId,
          cancelledAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });
      }
      onMutated?.();
      toast.success(isAr ? 'تم الإلغاء وقيد العكس.' : 'Cancelled with reversal journal.');
    } catch (err) {
      if (err instanceof NetworkQueuedError) return;
      const msg = err instanceof Error ? err.message : '';
      toast.error(msg || (isAr ? 'تعذر الإلغاء.' : 'Failed to cancel.'));
    }
  };

  const remove = async (m: BankMovement) => {
    if (!allowEdit) return;
    if (m.status !== 'draft') {
      toast.error(isAr ? 'الحذف مسموح للمسودة فقط.' : 'Delete is allowed for drafts only.');
      return;
    }
    try {
      await removeBankMovement(m.id);
      onMutated?.();
      if (embedded) onDetailRemoved?.();
      toast.success(isAr ? 'تم حذف المسودة.' : 'Draft deleted.');
    } catch {
      toast.error(isAr ? 'تعذر حذف المسودة.' : 'Failed to delete draft.');
    }
  };

  const movementOffsetLabel = (m: BankMovement): string => {
    const meta = transferDetailLabel(m, isAr);
    const base = (() => {
      if (m.transferScope === 'external' && m.instapayBeneficiary?.trim()) {
        return m.instapayBeneficiary.trim();
      }
      if (m.toBankAccountId) {
        const b = accounts.find((a) => a.id === m.toBankAccountId);
        if (b) return b.code;
      }
      if (!m.offsetChartOfAccountId) return m.offsetAccountCode || '—';
      const r = coaAccounts.find((a) => a.id === m.offsetChartOfAccountId);
      return r?.accountCode || m.offsetAccountCode || '—';
    })();
    if (meta && (m.movementType === 'transfer' || m.movementType === 'instapay_out' || m.movementType === 'instapay_in')) {
      return `${meta} · ${base}`;
    }
    return base;
  };

  const movementTypeDisplay = (m: BankMovement): string => {
    const normalized = m.movementType === 'instapay_out' || m.movementType === 'instapay_in' ? 'transfer' : m.movementType;
    return typeLabel(normalized, isAr);
  };

  const showTransferFee = (m: BankMovement): boolean => {
    if (!(m.instapayFee && Number(m.instapayFee) > 0)) return false;
    if (m.movementType === 'instapay_out') return true;
    return m.movementType === 'transfer' && m.transferChannel === 'instapay' && m.transferDirection === 'out';
  };

  const contractShort = (cid?: string): string => {
    if (!cid) return '—';
    const c = contracts.find((x) => x.id === cid);
    if (!c) return cid.slice(0, 8);
    return `${c.contractNumber}${c.contractName ? ` · ${c.contractName}` : ''}`;
  };

  const docDisplay = (m: BankMovement) => m.documentNo?.trim() || '—';

  const selectedMovement = selectedMovementId
    ? movements.find((m) => m.id === selectedMovementId) ?? null
    : null;

  const permissionBanner = !canPostLedger ? (
    <p className="text-xs text-amber-600 dark:text-amber-400 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
      {isAr
        ? 'لن يُسمح بالترحيل أو إلغاء الترحيل حتى تمتلك صلاحية تعديل البنوك أو إنشاء قيود في الأستاذ العام.'
        : 'Posting and cancellation require Banks edit permission or Ledger create (to write journal entries).'}
    </p>
  ) : null;

  const createFormPanel = (
    <div className={cn(!embedded && panelCls, !embedded && 'p-4 md:p-5 space-y-4 shadow-sm', embedded && 'space-y-4')}>
      {!embedded ? (
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-sm">{isAr ? 'حركة بنكية جديدة' : 'New bank movement'}</h3>
            <ManualHelpButton
              topicId={isTransferForm ? 'banks.movement.transfer' : 'banks.movement.income_expense'}
              size={14}
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {isAr
              ? 'مسودة بالحقول التي يعتمدها الترحيل (الطرف المقابل والعقد). عند الترحيل يُنشَأ القيد في الأستاذ العام.'
              : 'Draft with fields used on post (offset account, contract). Posting creates a General Ledger journal entry.'}
          </p>
        </div>
      ) : (
        <ManualHelpButton
          topicId={isTransferForm ? 'banks.movement.transfer' : 'banks.movement.income_expense'}
          size={14}
        />
      )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          <select
            aria-label="movement type"
            className={inputCls}
            value={form.movementType}
            onChange={(e) => {
              const next = e.target.value as BankMovement['movementType'];
              setForm((f) => ({
                ...f,
                movementType: next,
                offsetChartOfAccountId: '',
                toBankAccountId: '',
                instapayBeneficiary: '',
                instapayFee: '',
                transferScope: 'internal',
                transferChannel: 'bank_app',
                transferDirection: 'out',
              }));
            }}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {typeLabel(t, isAr)}
              </option>
            ))}
          </select>
          {isTransferForm ? (
            <>
              <select
                aria-label="transfer scope"
                className={inputCls}
                value={form.transferScope}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    transferScope: e.target.value as TransferScope,
                    toBankAccountId: '',
                    offsetChartOfAccountId: '',
                    instapayBeneficiary: '',
                    instapayFee: '',
                  }))
                }
              >
                <option value="internal">{isAr ? 'بين حسابات بنكية للشركة' : 'Between company bank accounts'}</option>
                <option value="external">{isAr ? 'تحويل لجهة مستفيدة' : 'Transfer to beneficiary'}</option>
              </select>
              <select
                aria-label="transfer channel"
                className={inputCls}
                value={form.transferChannel}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    transferChannel: e.target.value as TransferChannel,
                    instapayFee: '',
                  }))
                }
              >
                <option value="bank_app">{isAr ? 'تطبيق بنكي' : 'Bank app'}</option>
                <option value="instapay">{isAr ? 'إنستاباي' : 'InstaPay'}</option>
              </select>
              <select
                aria-label="transfer direction"
                className={inputCls}
                value={form.transferDirection}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    transferDirection: e.target.value as TransferDirection,
                    toBankAccountId: '',
                    instapayFee: '',
                  }))
                }
              >
                <option value="out">{isAr ? 'صادر' : 'Outgoing'}</option>
                <option value="in">{isAr ? 'وارد' : 'Incoming'}</option>
              </select>
            </>
          ) : null}
          <div>
            <select
              aria-label="bank account"
              className={inputCls}
              value={form.bankAccountId}
              onChange={(e) => setForm((f) => ({ ...f, bankAccountId: e.target.value, toBankAccountId: '' }))}
            >
              <option value="">{primaryBankLabel}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {isAr ? a.nameAr : a.nameEn || a.nameAr}
                </option>
              ))}
            </select>
            <GlAccountBalanceHint
              accountCode={primaryBankGlCode}
              balanceByCode={balanceByCode}
              language={language}
              variant="bank"
              loading={glBalancesLoading}
            />
          </div>
          {isInternalTransfer ? (
            <div>
              <select
                aria-label="counterparty bank account"
                className={inputCls}
                value={form.toBankAccountId}
                onChange={(e) => setForm((f) => ({ ...f, toBankAccountId: e.target.value }))}
              >
                <option value="">{counterpartyBankLabel}</option>
                {accounts
                  .filter((a) => a.id !== form.bankAccountId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {isAr ? a.nameAr : a.nameEn || a.nameAr}
                    </option>
                  ))}
              </select>
              <GlAccountBalanceHint
                accountCode={counterpartyBankGlCode}
                balanceByCode={balanceByCode}
                language={language}
                variant="bank"
                loading={glBalancesLoading}
              />
            </div>
          ) : null}
          <input
            aria-label="date"
            className={inputCls}
            type="date"
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
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
          <input
            aria-label="reference"
            className={inputCls}
            placeholder={
              isTransferForm && form.transferChannel === 'instapay'
                ? (isAr ? 'مرجع إنستاباي / IPN (يُستخدم كمرجع القيد)' : 'InstaPay / IPN reference (GL ref if set)')
                : (isAr ? 'مرجع (يُستخدم كمرجع القيد إذا وُجد)' : 'Reference (GL ref if set)')
            }
            value={form.reference}
            onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
          />
          {isExternalTransfer ? (
            <input
              aria-label="beneficiary reference"
              className={cn(inputCls, 'md:col-span-2')}
              placeholder={
                form.transferChannel === 'instapay'
                  ? (isAr
                    ? 'المستفيد — IPA (name@instapay) · جوال · IBAN · رقم حساب'
                    : 'Beneficiary — IPA · mobile · IBAN · account number')
                  : (isAr ? 'بيانات المستفيد (اختياري)' : 'Beneficiary details (optional)')
              }
              value={form.instapayBeneficiary}
              onChange={(e) => setForm((f) => ({ ...f, instapayBeneficiary: e.target.value }))}
            />
          ) : null}
          {showInstapayFee ? (
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="block text-xs font-bold text-gray-500 mb-1">
                  {isAr ? 'رسوم إنستاباي (اختياري)' : 'InstaPay fee (optional)'}
                </label>
                <input
                  aria-label="instapay fee"
                  className={inputCls}
                  type="number"
                  step="1"
                  min="0"
                  placeholder={isAr ? '0.1% (0.5–20)' : '0.1% (0.5–20 EGP)'}
                  value={form.instapayFee}
                  onChange={(e) => setForm((f) => ({ ...f, instapayFee: e.target.value }))}
                />
              </div>
              <button
                type="button"
                className="shrink-0 rounded-lg border px-3 py-2 text-xs font-bold border-blue-500/40 text-blue-500 hover:bg-blue-500/10"
                onClick={() => {
                  const amt = Number(form.amount);
                  if (!(amt > 0)) {
                    toast.error(isAr ? 'أدخل المبلغ أولاً.' : 'Enter amount first.');
                    return;
                  }
                  setForm((f) => ({ ...f, instapayFee: String(suggestInstapayFee(amt)) }));
                }}
              >
                {isAr ? 'اقتراح الرسوم' : 'Suggest fee'}
              </button>
            </div>
          ) : null}
          <input
            aria-label="description ar"
            className={cn(inputCls, 'md:col-span-2')}
            placeholder={isAr ? 'وصف القيد — عربي' : 'Journal description — Arabic'}
            value={form.descriptionAr}
            onChange={(e) => setForm((f) => ({ ...f, descriptionAr: e.target.value }))}
          />
          <input
            aria-label="description en"
            className={inputCls}
            placeholder={isAr ? 'وصف القيد — إنجليزي (اختياري)' : 'Journal description — English (optional)'}
            value={form.descriptionEn}
            onChange={(e) => setForm((f) => ({ ...f, descriptionEn: e.target.value }))}
          />

          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">
              {isAr ? 'المشروع (تصفية العقود)' : 'Project'}
            </label>
            <select
              aria-label="project"
              className={inputCls}
              value={form.projectId}
              onChange={(e) => {
                const pid = e.target.value;
                setForm((f) => {
                  let cid = f.contractId;
                  if (cid && !contracts.some((c) => c.id === cid && (!pid || c.projectId === pid))) cid = '';
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
              {isAr ? 'مركز التكلفة (العقد) — يُرحَّل للقيد' : 'Cost center (contract) — on journal'}
            </label>
            <SearchableSelect
              theme={theme}
              dir={dir}
              className="w-full"
              placeholder={isAr ? 'اختر العقد (اختياري)' : 'Select contract (optional)'}
              options={contractSelectOptions}
              value={form.contractId}
              onChange={(v) => {
                const c = contracts.find((x) => x.id === v);
                setForm((f) => ({
                  ...f,
                  contractId: v,
                  projectId: c ? c.projectId : f.projectId,
                }));
              }}
            />
          </div>

          {showOffsetSelect ? (
            <div className="md:col-span-3">
              <label className="block text-xs font-bold text-gray-500 mb-1">
                {isExternalTransfer
                  ? (isAr ? 'الجهة المستفيدة (دليل · 8 أرقام)' : 'Beneficiary (GL · 8 digits)')
                  : (isAr ? 'الطرف المقابل (دليل · ورقة 8 أرقام)' : 'Offset GL chart leaf (8 digits)')}
              </label>
              <SearchableSelect
                theme={theme}
                dir={dir}
                className="w-full max-w-2xl"
                placeholder={
                  needsOffsetCoa
                    ? isAr
                      ? '— اختر من الدليل —'
                      : '— Select from chart —'
                    : isAr
                      ? '— اختياري للفائدة؛ وإلا يُستخدم حساب الإيرادات الافتراضي —'
                      : '— Optional; default revenue account if empty —'
                }
                options={leafCoaOptions}
                value={form.offsetChartOfAccountId}
                onChange={(v) => setForm((f) => ({ ...f, offsetChartOfAccountId: v }))}
              />
              <GlAccountBalanceHint
                accountCode={offsetGlCode}
                balanceByCode={balanceByCode}
                language={language}
                variant="account"
                loading={glBalancesLoading}
              />
            </div>
          ) : null}

          {form.movementType === 'adjustment' ? (
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">
                {isAr ? 'اتجاه التسوية' : 'Adjustment side'}
              </label>
              <select aria-label={isAr ? 'اتجاه التسوية' : 'Adjustment direction'} className={inputCls} value={adjDir} onChange={(e) => setAdjDir(e.target.value as 'in' | 'out')}>
                <option value="in">{isAr ? 'زيادة البنك (مدين بنك)' : 'Increase bank (Dr bank)'}</option>
                <option value="out">{isAr ? 'نقص البنك (دائن بنك)' : 'Decrease bank (Cr bank)'}</option>
              </select>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {embedded && onCancelCreate ? (
            <button type="button" onClick={onCancelCreate} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-gray-500/15">
              {isAr ? 'إلغاء' : 'Cancel'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void create()}
            disabled={saving || !allowCreate}
            className="rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-bold disabled:opacity-50"
          >
            {saving ? '…' : isAr ? 'حفظ مسودة' : 'Save draft'}
          </button>
        </div>
      </div>
  );

  const detailPanel = selectedMovement ? (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-gray-500">{isAr ? 'المستند' : 'Document'}</p>
          <p className="font-mono font-semibold">{docDisplay(selectedMovement)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">{isAr ? 'النوع' : 'Type'}</p>
          <p>{movementTypeDisplay(selectedMovement)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">{isAr ? 'الحالة' : 'Status'}</p>
          <p className="font-semibold">{selectedMovement.status}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">{isAr ? 'البنك' : 'Bank'}</p>
          <p>{accounts.find((a) => a.id === selectedMovement.bankAccountId)?.code ?? '—'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">{isAr ? 'التاريخ' : 'Date'}</p>
          <p>{selectedMovement.date}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">{isAr ? 'المبلغ' : 'Amount'}</p>
          <p className="font-mono font-bold">{formatNumber(Number(selectedMovement.amount))}</p>
        </div>
        <div className="sm:col-span-2">
          <p className="text-xs text-gray-500">{isAr ? 'طرف مقابل' : 'Offset'}</p>
          <p className="text-xs font-mono">{movementOffsetLabel(selectedMovement)}</p>
        </div>
        <div className="sm:col-span-2">
          <p className="text-xs text-gray-500">{isAr ? 'مركز تكلفة' : 'Cost center'}</p>
          <p className="text-xs">{contractShort(selectedMovement.contractId)}</p>
        </div>
        <div className="sm:col-span-2">
          <p className="text-xs text-gray-500">{isAr ? 'مرجع' : 'Reference'}</p>
          <p>{selectedMovement.reference || '—'}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        {selectedMovement.status === 'draft' ? (
          <>
            <button
              type="button"
              disabled={!allowEdit || !canPostLedger}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold disabled:opacity-50"
              onClick={() => void post(selectedMovement)}
            >
              {isAr ? 'ترحيل' : 'Post'}
            </button>
            <button
              type="button"
              disabled={!allowEdit}
              className="px-4 py-2 rounded-lg text-red-600 border border-red-500/30 text-xs font-bold disabled:opacity-50"
              onClick={() => void remove(selectedMovement)}
            >
              {isAr ? 'حذف' : 'Delete'}
            </button>
          </>
        ) : null}
        {selectedMovement.status === 'posted' ? (
          <button
            type="button"
            disabled={!allowEdit || !canPostLedger || Boolean(selectedMovement.reversalTransactionId)}
            className="px-4 py-2 rounded-lg text-amber-700 border border-amber-500/30 text-xs font-bold disabled:opacity-50"
            onClick={() => void cancel(selectedMovement)}
          >
            {isAr ? 'إلغاء' : 'Cancel'}
          </button>
        ) : null}
      </div>
    </div>
  ) : (
    <p className="text-sm text-gray-500">{isAr ? 'الحركة غير موجودة.' : 'Movement not found.'}</p>
  );

  if (embedded && panelMode === 'create') {
    return (
      <div className="space-y-4" dir={dir}>
        {permissionBanner}
        {createFormPanel}
      </div>
    );
  }

  if (embedded && panelMode === 'detail') {
    return (
      <div className="space-y-4" dir={dir}>
        {permissionBanner}
        {detailPanel}
      </div>
    );
  }

  return (
    <div className="space-y-4" dir={dir}>
      {permissionBanner}
      {createFormPanel}

      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">{isAr ? 'تصفية بالحساب' : 'Filter by bank'}</span>
        <select
          aria-label="filter bank"
          className={cn(inputCls, 'max-w-sm')}
          value={filterBankId}
          onChange={(e) => setFilterBankId(e.target.value)}
        >
          <option value="">{isAr ? 'كل الحسابات' : 'All accounts'}</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code}
            </option>
          ))}
        </select>
      </div>

      <div className={cn(panelCls, 'overflow-x-auto')}>
        <table className="w-full text-sm min-w-[1024px]">
          <thead>
            <tr
              className={cn(
                'border-b text-left',
                theme === 'dark' ? 'border-gray-800 bg-gray-900/50' : 'border-gray-200 bg-gray-50',
              )}
            >
              <th className="px-3 py-2">{isAr ? 'المستند' : 'Doc'}</th>
              <th className="px-3 py-2">{isAr ? 'النوع' : 'Type'}</th>
              <th className="px-3 py-2">{isAr ? 'الحالة' : 'Status'}</th>
              <th className="px-3 py-2">{isAr ? 'البنك' : 'Bank'}</th>
              <th className="px-3 py-2">{isAr ? 'طرف مقابل' : 'Offset'}</th>
              <th className="px-3 py-2">{isAr ? 'مركز تكلفة' : 'Cost ctr.'}</th>
              <th className="px-3 py-2">{isAr ? 'التاريخ' : 'Date'}</th>
              <th className="px-3 py-2 text-end">{isAr ? 'المبلغ' : 'Amount'}</th>
              <th className="px-3 py-2">{isAr ? 'مرجع' : 'Ref'}</th>
              <th className="px-3 py-2 w-44">{isAr ? 'إجراءات' : 'Actions'}</th>
            </tr>
          </thead>
          <tbody>
            {byBank.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-gray-500">
                  {isAr ? 'لا توجد حركات.' : 'No movements.'}
                </td>
              </tr>
            ) : (
              byBank.map((m) => (
                <tr
                  key={m.id}
                  className={cn(
                    'border-b hover:bg-blue-500/5 transition-colors',
                    theme === 'dark' ? 'border-gray-800' : 'border-gray-100',
                  )}
                >
                  <td className="px-3 py-2 font-mono text-xs">{docDisplay(m)}</td>
                  <td className="px-3 py-2">{movementTypeDisplay(m)}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        'text-xs px-2 py-0.5 rounded-full font-bold',
                        m.status === 'posted'
                          ? 'bg-emerald-500/15 text-emerald-600'
                          : m.status === 'cancelled'
                            ? 'bg-red-500/15 text-red-500'
                            : 'bg-blue-500/15 text-blue-600',
                      )}
                    >
                      {m.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">{accounts.find((a) => a.id === m.bankAccountId)?.code ?? '—'}</td>
                  <td className="px-3 py-2 text-xs font-mono">{movementOffsetLabel(m)}</td>
                  <td className="px-3 py-2 text-xs max-w-[11rem] truncate" title={contractShort(m.contractId)}>
                    {contractShort(m.contractId)}
                  </td>
                  <td className="px-3 py-2">{m.date}</td>
                  <td className="px-3 py-2 text-end font-mono">
                    {formatNumber(Number(m.amount))}
                    {showTransferFee(m) ? (
                      <span className="block text-[10px] text-gray-500">
                        {isAr ? `+ رسوم ${formatNumber(Number(m.instapayFee))}` : `+ fee ${formatNumber(Number(m.instapayFee))}`}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-xs">{m.reference || '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2 text-xs">
                      {m.status === 'draft' ? (
                        <>
                          <button
                            type="button"
                            disabled={!allowEdit || !canPostLedger}
                            className="font-bold text-emerald-600 hover:underline disabled:opacity-40 disabled:no-underline"
                            onClick={() => void post(m)}
                          >
                            {isAr ? 'ترحيل' : 'Post'}
                          </button>
                          <button
                            type="button"
                            disabled={!allowEdit}
                            className="text-red-500 hover:underline disabled:opacity-40 disabled:no-underline"
                            onClick={() => void remove(m)}
                          >
                            {isAr ? 'حذف' : 'Delete'}
                          </button>
                        </>
                      ) : null}
                      {m.status === 'posted' ? (
                        <button
                          type="button"
                          disabled={!allowEdit || !canPostLedger || Boolean(m.reversalTransactionId)}
                          className="text-amber-600 hover:underline disabled:opacity-40 disabled:no-underline"
                          onClick={() => void cancel(m)}
                        >
                          {isAr ? 'إلغاء' : 'Cancel'}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
