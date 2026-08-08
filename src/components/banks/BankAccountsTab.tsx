import React, { useMemo, useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import { Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '../../lib/utils';
import type { Account } from '../../services/accountingService';
import type { BankAccount } from './types';
import { SearchableSelect } from '../ui/SearchableSelect';
import {
  createBankAccount,
  removeBankAccount,
  updateBankAccount,
} from '../../lib/bankPersistence';
import { BankAccountStatementPanel } from './BankAccountStatementPanel';

/** Leaf bank GL accounts live under COA group "البنوك" (seed code 12101). */
const BANK_COA_PARENT_CODE = '12101';

type Props = {
  accounts: BankAccount[];
  coaAccounts: Account[];
  dir?: string;
  language: 'ar' | 'en';
  theme: string;
  allowCreate: boolean;
  allowEdit: boolean;
  onMutated?: () => void;
  t: (key: string) => string;
};

const emptyForm = {
  coaAccountId: '',
  code: '',
  nameAr: '',
  nameEn: '',
  accountNumber: '',
  iban: '',
  currency: 'EGP',
  openingBalance: 0,
  isActive: true,
};

function pickLinkedCoa(row: BankAccount, coa: Account[]): Account | undefined {
  if (row.coaAccountId) {
    const byId = coa.find((c) => c.id === row.coaAccountId);
    if (byId) return byId;
  }
  return coa.find(
    (c) =>
      c.accountCode === row.code &&
      !c.isGroup &&
      c.parentCode === BANK_COA_PARENT_CODE &&
      c.status !== 'disabled',
  );
}

function splitSidebarCls(theme: string) {
  return cn(
    'rounded-xl border p-4 w-full md:flex-[2] md:min-w-[17rem] md:max-w-[24rem] shrink-0 space-y-4 md:sticky md:top-4 order-1 md:order-none',
    theme === 'dark'
      ? 'border-gray-800 bg-[#151619]'
      : theme === 'soft'
        ? 'border-[#cfd8dc] bg-white'
        : 'border-gray-200 bg-white',
  );
}

function splitMainCls() {
  return 'flex-1 min-w-0 md:flex-[3] space-y-4 order-2 md:order-none';
}

function splitRowCls(dir?: string) {
  return cn('flex flex-col md:flex-row md:items-start gap-4', dir === 'rtl' ? 'md:flex-row-reverse' : '');
}

function splitActiveListBtn(active: boolean, theme: string) {
  return cn(
    'w-full text-start px-2.5 py-2 rounded-lg text-sm border transition-colors',
    active
      ? 'bg-blue-600 text-white border-blue-600'
      : theme === 'dark'
        ? 'border-gray-800 hover:bg-gray-800/80 text-gray-200'
        : 'border-gray-200 hover:bg-gray-50 text-gray-800',
  );
}

function panelCls(theme: string) {
  return cn(
    'rounded-xl border p-4 md:p-5 space-y-4 shadow-sm',
    theme === 'dark'
      ? 'border-gray-800 bg-[#151619]'
      : theme === 'soft'
        ? 'border-[#cfd8dc] bg-white'
        : 'border-gray-200 bg-white',
  );
}

export function BankAccountsTab({
  accounts,
  coaAccounts,
  dir,
  language,
  theme,
  allowCreate,
  allowEdit,
  onMutated,
  t,
}: Props) {
  const isAr = language === 'ar';
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');

  const inputCls = cn(
    'w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500 transition-colors',
    theme === 'dark'
      ? 'bg-gray-900 border-gray-700 text-white'
      : theme === 'soft'
        ? 'bg-white border-[#cfd8dc] text-[#37474f]'
        : 'bg-white border-gray-300 text-gray-900',
  );

  const labelCls = cn('block text-xs font-bold mb-1.5', theme === 'dark' ? 'text-gray-400' : 'text-gray-500');

  const bankCoaLeaves = useMemo(
    () =>
      coaAccounts.filter(
        (a) =>
          !a.isGroup &&
          a.parentCode === BANK_COA_PARENT_CODE &&
          a.status !== 'disabled',
      ),
    [coaAccounts],
  );

  const bankCoaOptions = useMemo(
    () =>
      [...bankCoaLeaves]
        .sort((a, b) => a.accountCode.localeCompare(b.accountCode))
        .map((a) => ({
          value: a.id,
          label: language === 'ar' ? a.accountName : a.accountNameEn || a.accountName,
          secondary: a.accountCode,
        })),
    [bankCoaLeaves, language],
  );

  const visibleAccounts = useMemo(
    () =>
      accounts
        .filter((x) => {
          const q = query.trim().toLowerCase();
          if (!q) return true;
          return (
            x.code.toLowerCase().includes(q) ||
            x.nameAr.toLowerCase().includes(q) ||
            (x.nameEn || '').toLowerCase().includes(q) ||
            (x.accountNumber || '').toLowerCase().includes(q)
          );
        })
        .sort((a, b) => a.code.localeCompare(b.code)),
    [accounts, query],
  );

  const selectedAccount = useMemo(
    () => (selectedId ? accounts.find((a) => a.id === selectedId) ?? null : null),
    [accounts, selectedId],
  );

  const applyCoaSelection = (coaId: string) => {
    const acc = bankCoaLeaves.find((c) => c.id === coaId);
    setForm((f) =>
      acc
        ? {
            ...f,
            coaAccountId: coaId,
            code: acc.accountCode,
            nameAr: acc.accountName,
            nameEn: acc.accountNameEn || '',
          }
        : { ...f, coaAccountId: coaId, code: '' },
    );
  };

  const loadFormFromAccount = (x: BankAccount) => {
    const linked = pickLinkedCoa(x, coaAccounts);
    setForm({
      coaAccountId: linked?.id ?? x.coaAccountId ?? '',
      code: x.code,
      nameAr: x.nameAr,
      nameEn: x.nameEn ?? '',
      accountNumber: x.accountNumber ?? '',
      iban: x.iban ?? '',
      currency: x.currency,
      openingBalance: x.openingBalance ?? 0,
      isActive: x.isActive,
    });
  };

  const accountDisplayName = (x: BankAccount) => (isAr ? x.nameAr : x.nameEn || x.nameAr);

  const openCreate = () => {
    if (!allowCreate) return;
    setSelectedId(null);
    setIsCreating(true);
    setIsEditing(true);
    setForm(emptyForm);
  };

  const selectAccount = (x: BankAccount) => {
    setIsCreating(false);
    setIsEditing(false);
    setSelectedId(x.id);
    loadFormFromAccount(x);
  };

  const openEdit = () => {
    if (!selectedAccount) return;
    setIsEditing(true);
    loadFormFromAccount(selectedAccount);
  };

  const cancelForm = () => {
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
      setSelectedId(null);
      setForm(emptyForm);
      return;
    }
    setIsEditing(false);
    if (selectedAccount) loadFormFromAccount(selectedAccount);
  };

  const save = async () => {
    const trimmedCoaId = form.coaAccountId.trim();
    const coaRow = trimmedCoaId ? bankCoaLeaves.find((c) => c.id === trimmedCoaId) : undefined;

    if (!coaRow) {
      toast.error(
        language === 'ar'
          ? 'اختر حساباً بنكياً من شجرة الحسابات (تحت مجموعة البنوك 12101).'
          : 'Pick a bank account from Chart of Accounts (under Banks group 12101).',
      );
      return;
    }

    if (!form.code.trim() || !form.nameAr.trim()) {
      toast.error(language === 'ar' ? 'الرمز والاسم العربي مطلوبان.' : 'Code and Arabic name are required.');
      return;
    }

    const codeNormalized = coaRow.accountCode;
    const dupCoa = accounts.some(
      (a) =>
        (a.coaAccountId === coaRow.id || (!a.coaAccountId && a.code === codeNormalized)) &&
        a.id !== selectedAccount?.id,
    );
    if (dupCoa) {
      toast.error(
        language === 'ar'
          ? 'هذا الحساب من الشجرة مربوط بالفعل بحساب بنكي آخر.'
          : 'This chart account is already linked to another bank account.',
      );
      return;
    }

    if (isCreating && !allowCreate) return;
    if (!isCreating && selectedAccount && !allowEdit) return;
    setSaving(true);
    try {
      const payload = {
        coaAccountId: coaRow.id,
        code: codeNormalized,
        nameAr: form.nameAr.trim(),
        nameEn: form.nameEn.trim() || null,
        accountNumber: form.accountNumber.trim() || null,
        iban: form.iban.trim() || null,
        currency: form.currency.trim() || 'EGP',
        openingBalance: Number(form.openingBalance) || 0,
        isActive: form.isActive,
        updatedAt: Timestamp.now(),
      };
      if (selectedAccount && !isCreating) {
        await updateBankAccount(selectedAccount.id, payload);
        toast.success(language === 'ar' ? 'تم تحديث الحساب البنكي.' : 'Bank account updated.');
        setIsEditing(false);
      } else {
        const newId = await createBankAccount({ ...payload, createdAt: Timestamp.now() });
        toast.success(language === 'ar' ? 'تم إنشاء الحساب البنكي.' : 'Bank account created.');
        setSelectedId(newId);
        setIsCreating(false);
        setIsEditing(false);
      }
      onMutated?.();
    } catch {
      toast.error(language === 'ar' ? 'تعذر حفظ الحساب.' : 'Failed to save account.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!allowEdit || !selectedAccount) return;
    const ok = window.confirm(
      language === 'ar'
        ? `حذف الحساب ${selectedAccount.nameAr}؟`
        : `Delete account ${selectedAccount.nameAr}?`,
    );
    if (!ok) return;
    try {
      await removeBankAccount(selectedAccount.id);
      onMutated?.();
      setSelectedId(null);
      setIsCreating(false);
      setIsEditing(false);
      setForm(emptyForm);
      toast.success(language === 'ar' ? 'تم حذف الحساب.' : 'Account deleted.');
    } catch {
      toast.error(language === 'ar' ? 'تعذر حذف الحساب.' : 'Failed to delete account.');
    }
  };

  const coaEmptyHint =
    language === 'ar'
      ? 'لا توجد حسابات فرعية تحت مجموعة البنوك (12101) في شجرة الحسابات. أضف حساباً من الأستاذ العام ← شجرة الحسابات.'
      : 'No leaf accounts under Banks (12101) in Chart of Accounts. Add one from General Ledger → Chart of Accounts.';

  const showEditForm = isCreating || (Boolean(selectedAccount) && isEditing);
  const showStatement = Boolean(selectedAccount) && !isCreating && !isEditing;

  const detailTitle = isCreating
    ? t('banks_accounts_add_new')
    : selectedAccount
      ? accountDisplayName(selectedAccount)
      : '';

  const editForm = (
    <div className={panelCls(theme)}>
      <div className={cn('pb-3 border-b', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
        <h3 className="font-bold text-base">{detailTitle}</h3>
        <p className="text-xs text-gray-500 mt-1">{t('banks_screen_accounts_subtitle')}</p>
      </div>

      {bankCoaLeaves.length === 0 ? (
        <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded-lg p-3">
          {coaEmptyHint}
        </p>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="md:col-span-2">
          <label className={labelCls}>
            {language === 'ar' ? 'الحساب من شجرة الحسابات (مجموعة البنوك)' : 'Chart of Accounts — Banks'}
          </label>
          <SearchableSelect
            options={bankCoaOptions}
            value={form.coaAccountId}
            onChange={applyCoaSelection}
            theme={theme}
            dir={dir}
            placeholder={language === 'ar' ? 'اختر حساب البنك من الشجرة…' : 'Select bank from chart…'}
          />
        </div>
        <div>
          <label className={labelCls}>{language === 'ar' ? 'رمز الحساب (من الشجرة)' : 'GL code (from chart)'}</label>
          <input readOnly aria-label={language === 'ar' ? 'رمز المحاسبي' : 'GL code'} className={cn(inputCls, 'opacity-90 font-mono')} value={form.code} />
        </div>
        <div>
          <label className={labelCls}>{language === 'ar' ? 'اسم البنك عربي' : 'Bank name (AR)'}</label>
          <input aria-label="name ar" className={inputCls} value={form.nameAr} onChange={(e) => setForm((f) => ({ ...f, nameAr: e.target.value }))} />
        </div>
        <div>
          <label className={labelCls}>{language === 'ar' ? 'اسم البنك إنجليزي' : 'Bank name (EN)'}</label>
          <input aria-label="name en" className={inputCls} value={form.nameEn} onChange={(e) => setForm((f) => ({ ...f, nameEn: e.target.value }))} />
        </div>
        <div>
          <label className={labelCls}>{language === 'ar' ? 'رقم الحساب' : 'Account number'}</label>
          <input aria-label="account number" className={cn(inputCls, 'font-mono')} value={form.accountNumber} onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))} />
        </div>
        <div>
          <label className={labelCls}>IBAN</label>
          <input aria-label="iban" className={cn(inputCls, 'font-mono text-xs')} value={form.iban} onChange={(e) => setForm((f) => ({ ...f, iban: e.target.value }))} />
        </div>
        <div>
          <label className={labelCls}>{language === 'ar' ? 'العملة' : 'Currency'}</label>
          <input aria-label="currency" className={inputCls} value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))} />
        </div>
        <div>
          <label className={labelCls}>{language === 'ar' ? 'رصيد افتتاحي' : 'Opening balance'}</label>
          <input aria-label="opening balance" className={inputCls} type="number" step="0.01" value={form.openingBalance} onChange={(e) => setForm((f) => ({ ...f, openingBalance: Number(e.target.value) }))} />
        </div>
        <div className="flex items-end">
          <label className="text-xs flex items-center gap-2 px-1 pb-2">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
            {language === 'ar' ? 'نشط' : 'Active'}
          </label>
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2 pt-1">
        {selectedAccount && !isCreating && allowEdit ? (
          <button
            type="button"
            onClick={() => void remove()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-red-600 hover:bg-red-500/10"
          >
            <Trash2 size={14} />
            {language === 'ar' ? 'حذف' : 'Delete'}
          </button>
        ) : null}
        <button type="button" onClick={cancelForm} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-gray-500/15">
          {language === 'ar' ? 'إلغاء' : 'Cancel'}
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || (isCreating && !allowCreate) || (!isCreating && selectedAccount && !allowEdit)}
          className="px-4 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white disabled:opacity-50"
        >
          {saving ? '…' : language === 'ar' ? 'حفظ' : 'Save'}
        </button>
      </div>
    </div>
  );

  return (
    <div className={splitRowCls(dir)}>
      <div className={splitMainCls()}>
        {showEditForm ? (
          editForm
        ) : showStatement && selectedAccount ? (
          <div className={panelCls(theme)}>
            <div className={cn('pb-3 border-b', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
              <h3 className="font-bold text-base">{accountDisplayName(selectedAccount)}</h3>
              <p className="text-xs text-gray-500 mt-1">{t('banks_screen_account_statement_subtitle')}</p>
            </div>
            <BankAccountStatementPanel
              embedded
              bankAccountId={selectedAccount.id}
              bankAccounts={accounts}
              coaAccounts={coaAccounts}
              language={language}
              dir={dir === 'rtl' ? 'rtl' : 'ltr'}
              theme={theme}
              allowEdit={allowEdit}
              onEditAccount={openEdit}
            />
          </div>
        ) : (
          <div className={cn(panelCls(theme), 'flex flex-col items-center justify-center min-h-[280px] text-center')}>
            <p className="text-sm text-gray-500">{t('banks_filter_select_account')}</p>
            {allowCreate ? (
              <button
                type="button"
                onClick={openCreate}
                className="mt-4 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold bg-blue-600 text-white"
              >
                <Plus size={16} />
                {t('banks_accounts_add_new')}
              </button>
            ) : null}
          </div>
        )}
      </div>

      <aside className={splitSidebarCls(theme)}>
        <div>
          <h3 className="font-bold text-sm">{t('banks_screen_accounts_title')}</h3>
        </div>
        <button
          type="button"
          disabled={!allowCreate}
          onClick={openCreate}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
        >
          <Plus size={16} />
          {t('banks_accounts_add_new')}
        </button>
        <input
          aria-label="search accounts"
          className={inputCls}
          placeholder={isAr ? 'بحث بالاسم…' : 'Search by name…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul className="space-y-1 max-h-[min(60vh,28rem)] overflow-y-auto">
          {visibleAccounts.length === 0 ? (
            <li className="text-xs text-gray-500 py-4 text-center">{isAr ? 'لا توجد حسابات بنكية.' : 'No bank accounts.'}</li>
          ) : (
            visibleAccounts.map((x) => (
              <li key={x.id}>
                <button
                  type="button"
                  onClick={() => selectAccount(x)}
                  className={splitActiveListBtn(!isCreating && selectedId === x.id, theme)}
                >
                  <span className="font-semibold truncate block">{accountDisplayName(x)}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </aside>
    </div>
  );
}
