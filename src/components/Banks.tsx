import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useErpModuleDraft, useErpModuleView } from '../hooks/useErpModuleView';
import { collection, orderBy, query } from 'firebase/firestore';
import { listenQuery } from '../lib/firestoreListen';
import { Building2, Landmark, Wallet } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { useLanguage } from '../context/LanguageContext';
import { usePermissions } from '../context/PermissionsContext';
import { useApiQuery } from '../hooks/useApiQuery';
import { useChartOfAccountsRef } from '../hooks/useChartOfAccountsRef';
import { isLocalBackend } from '../lib/dataBackend';
import { cn } from '../lib/utils';
import { businessTodayYmd } from '../lib/businessCalendar';
import type { Account } from '../services/accountingService';
import type {
  BankAccount,
  BankCheque,
  BankMovement,
  BankStatement,
} from './banks/types';
import { BankAccountsTab } from './banks/BankAccountsTab';
import { BankTransactionsTab } from './banks/BankTransactionsTab';
import { BankStatementsTab } from './banks/BankStatementsTab';
import {
  banksApi,
} from '../services/local/modulesApi';
import { useGlAccountBalances } from '../hooks/useGlAccountBalances';
import { consumePendingShellView, peekPendingShellView } from '../lib/shellNavigation';

type BankTab = 'accounts' | 'transactions' | 'statements';

interface BanksDraft {
  tab: BankTab;
}

function isBankTab(value: string): value is BankTab {
  return value === 'accounts' || value === 'transactions' || value === 'statements';
}

function normalizeBankTab(value: string): BankTab {
  if (value === 'account_statement') return 'accounts';
  if (value === 'movements' || value === 'cheques') return 'transactions';
  return isBankTab(value) ? value : 'accounts';
}

function mapAccountRow(raw: Record<string, unknown>): BankAccount {
  return {
    id: String(raw.id ?? ''),
    code: String(raw.code ?? ''),
    coaAccountId: typeof raw.coaAccountId === 'string' ? raw.coaAccountId : undefined,
    nameAr: String(raw.nameAr ?? ''),
    nameEn: String(raw.nameEn ?? ''),
    accountNumber: String(raw.accountNumber ?? ''),
    iban: String(raw.iban ?? ''),
    currency: String(raw.currency ?? 'EGP'),
    openingBalance: Number(raw.openingBalance ?? 0),
    isActive: Boolean(raw.isActive ?? true),
  };
}

function mapMovementRow(raw: Record<string, unknown>): BankMovement {
  const movementType = (raw.movementType as BankMovement['movementType']) ?? 'deposit';
  const adj =
    raw.adjustmentDirection === 'out' ? 'out' : raw.adjustmentDirection === 'in' ? 'in' : undefined;
  return {
    id: String(raw.id ?? ''),
    documentNo: String(raw.documentNo ?? ''),
    bankAccountId: String(raw.bankAccountId ?? ''),
    movementType,
    amount: Number(raw.amount ?? 0),
    date: String(raw.date ?? ''),
    currency: raw.currency != null ? String(raw.currency) : undefined,
    reference: raw.reference != null ? String(raw.reference) : undefined,
    note: raw.note != null ? String(raw.note) : undefined,
    descriptionAr: raw.descriptionAr != null ? String(raw.descriptionAr) : undefined,
    descriptionEn: raw.descriptionEn != null ? String(raw.descriptionEn) : undefined,
    projectId: raw.projectId != null && String(raw.projectId).trim() ? String(raw.projectId) : undefined,
    contractId:
      raw.contractId != null && String(raw.contractId).trim() ? String(raw.contractId) : undefined,
    offsetChartOfAccountId:
      raw.offsetChartOfAccountId != null && String(raw.offsetChartOfAccountId).trim()
        ? String(raw.offsetChartOfAccountId)
        : undefined,
    offsetAccountCode: raw.offsetAccountCode != null ? String(raw.offsetAccountCode) : undefined,
    offsetAccountName: raw.offsetAccountName != null ? String(raw.offsetAccountName) : undefined,
    toBankAccountId:
      raw.toBankAccountId != null && String(raw.toBankAccountId).trim()
        ? String(raw.toBankAccountId)
        : undefined,
    transferScope:
      raw.transferScope != null && String(raw.transferScope).trim()
        ? (String(raw.transferScope) as BankMovement['transferScope'])
        : undefined,
    transferChannel:
      raw.transferChannel != null && String(raw.transferChannel).trim()
        ? (String(raw.transferChannel) as BankMovement['transferChannel'])
        : undefined,
    transferDirection:
      raw.transferDirection != null && String(raw.transferDirection).trim()
        ? (String(raw.transferDirection) as BankMovement['transferDirection'])
        : undefined,
    instapayBeneficiary:
      raw.instapayBeneficiary != null && String(raw.instapayBeneficiary).trim()
        ? String(raw.instapayBeneficiary)
        : undefined,
    instapayFee: raw.instapayFee != null && Number(raw.instapayFee) > 0 ? Number(raw.instapayFee) : undefined,
    adjustmentDirection: adj,
    status: (raw.status as BankMovement['status']) ?? 'draft',
    glTransactionId: raw.glTransactionId != null ? String(raw.glTransactionId) : undefined,
    postedGlReference: raw.postedGlReference != null ? String(raw.postedGlReference) : undefined,
    reversalTransactionId:
      raw.reversalTransactionId != null ? String(raw.reversalTransactionId) : undefined,
  };
}

function mapChequeRow(raw: Record<string, unknown>): BankCheque {
  const rawStatus = String(raw.status ?? 'draft');
  const status =
    rawStatus === 'returned'
      ? ('rejected' as BankCheque['status'])
      : (rawStatus as BankCheque['status']);
  const ric = raw.receivedIssueCredits;
  const receivedIssueCredits =
    Array.isArray(ric) && ric.length > 0
      ? (ric as { offsetChartOfAccountId?: string; amount?: number }[])
          .map((r) => ({
            offsetChartOfAccountId: String(r.offsetChartOfAccountId ?? '').trim(),
            amount: Number(r.amount),
          }))
          .filter((r) => r.offsetChartOfAccountId && Number.isFinite(r.amount) && r.amount > 0)
      : undefined;
  return {
    id: String(raw.id ?? ''),
    direction: (raw.direction as BankCheque['direction']) ?? 'issued',
    bankAccountId: String(raw.bankAccountId ?? ''),
    chequeNo: String(raw.chequeNo ?? ''),
    payeeName: raw.payeeName != null ? String(raw.payeeName) : undefined,
    amount: Number(raw.amount ?? 0),
    issueDate: String(raw.issueDate ?? ''),
    dueDate: raw.dueDate != null ? String(raw.dueDate) : undefined,
    status,
    offsetChartOfAccountId:
      raw.offsetChartOfAccountId != null && String(raw.offsetChartOfAccountId).trim()
        ? String(raw.offsetChartOfAccountId)
        : undefined,
    projectId: raw.projectId != null && String(raw.projectId).trim() ? String(raw.projectId) : undefined,
    contractId:
      raw.contractId != null && String(raw.contractId).trim() ? String(raw.contractId) : undefined,
    receivedIssueCredits: receivedIssueCredits?.length ? receivedIssueCredits : undefined,
    glIssueTransactionId:
      raw.glIssueTransactionId != null ? String(raw.glIssueTransactionId) : undefined,
    glClearTransactionId:
      raw.glClearTransactionId != null ? String(raw.glClearTransactionId) : undefined,
    glRejectTransactionId:
      raw.glRejectTransactionId != null ? String(raw.glRejectTransactionId) : undefined,
    postedIssueReference:
      raw.postedIssueReference != null ? String(raw.postedIssueReference) : undefined,
    postedClearReference:
      raw.postedClearReference != null ? String(raw.postedClearReference) : undefined,
  };
}

function mapStatementRow(raw: Record<string, unknown>): BankStatement {
  return {
    id: String(raw.id ?? ''),
    bankAccountId: String(raw.bankAccountId ?? ''),
    periodStart: String(raw.periodStart ?? ''),
    periodEnd: String(raw.periodEnd ?? ''),
    openingBalance: Number(raw.openingBalance ?? 0),
    closingBalance: Number(raw.closingBalance ?? 0),
    sourceLabel: String(raw.sourceLabel ?? ''),
  };
}

export function Banks() {
  const { language, dir, theme, t } = useLanguage();
  const { can } = usePermissions();
  const access = can('banks');
  const ledger = can('ledger');
  const lang = language as 'ar' | 'en';

  const { isErpShell, activeViewId, erp } = useErpModuleView('banks', 'accounts');
  const draftHydrated = useRef(false);
  const [tab, setTab] = useState<BankTab>(() => {
    const pending = peekPendingShellView('banks');
    return pending ? normalizeBankTab(pending) : 'accounts';
  });

  useEffect(() => {
    if (!isErpShell || !erp || draftHydrated.current) return;
    const saved = erp.getModuleDraft<BanksDraft>('banks');
    if (saved?.tab) setTab(normalizeBankTab(saved.tab));
    draftHydrated.current = true;
  }, [isErpShell, erp]);

  useEffect(() => {
    if (!isErpShell) return;
    setTab(normalizeBankTab(activeViewId));
  }, [activeViewId, isErpShell]);

  useEffect(() => {
    const pendingView = consumePendingShellView('banks');
    if (pendingView) setTab(normalizeBankTab(pendingView));
  }, []);

  useErpModuleDraft('banks', { tab }, isErpShell, erp);

  const [dataRefreshKey, setDataRefreshKey] = useState(0);
  const onBankDataMutated = () => setDataRefreshKey((k) => k + 1);

  const [fsAccounts, setFsAccounts] = useState<BankAccount[]>([]);
  const [fsCoaAccounts, setFsCoaAccounts] = useState<Account[]>([]);
  const [fsMovements, setFsMovements] = useState<BankMovement[]>([]);
  const [fsCheques, setFsCheques] = useState<BankCheque[]>([]);
  const [fsStatements, setFsStatements] = useState<BankStatement[]>([]);

  const { accounts: coaFromApi } = useChartOfAccountsRef({ refreshKey: dataRefreshKey });

  const { data: apiAccounts } = useApiQuery<Record<string, unknown>>(
    () => banksApi.accounts.list() as Promise<Record<string, unknown>[]>,
    [dataRefreshKey],
    { enabled: isLocalBackend && access.view, refreshKey: dataRefreshKey },
  );
  const { data: apiMovements } = useApiQuery<Record<string, unknown>>(
    () => banksApi.movements.list() as Promise<Record<string, unknown>[]>,
    [dataRefreshKey],
    { enabled: isLocalBackend && access.view, refreshKey: dataRefreshKey },
  );
  const { data: apiCheques } = useApiQuery<Record<string, unknown>>(
    () => banksApi.cheques.list() as Promise<Record<string, unknown>[]>,
    [dataRefreshKey],
    { enabled: isLocalBackend && access.view, refreshKey: dataRefreshKey },
  );
  const { data: apiStatements } = useApiQuery<Record<string, unknown>>(
    () => banksApi.statements.list() as Promise<Record<string, unknown>[]>,
    [dataRefreshKey],
    { enabled: isLocalBackend && access.view, refreshKey: dataRefreshKey },
  );

  const accounts = useMemo(
    () => (isLocalBackend ? apiAccounts.map(mapAccountRow) : fsAccounts),
    [isLocalBackend, apiAccounts, fsAccounts],
  );
  const movements = useMemo(
    () => (isLocalBackend ? apiMovements.map(mapMovementRow) : fsMovements),
    [isLocalBackend, apiMovements, fsMovements],
  );
  const cheques = useMemo(
    () => (isLocalBackend ? apiCheques.map(mapChequeRow) : fsCheques),
    [isLocalBackend, apiCheques, fsCheques],
  );
  const statements = useMemo(
    () => (isLocalBackend ? apiStatements.map(mapStatementRow) : fsStatements),
    [isLocalBackend, apiStatements, fsStatements],
  );
  const coaAccounts = useMemo(
    () => (isLocalBackend ? coaFromApi : fsCoaAccounts),
    [isLocalBackend, coaFromApi, fsCoaAccounts],
  );

  const { balanceByCode, accountTotalsByCode, loading: glBalancesLoading } = useGlAccountBalances(
    access.view,
    dataRefreshKey,
  );

  const stats = useMemo(() => {
    const activeAccounts = accounts.filter((a) => a.isActive).length;
    const draftMovements = movements.filter((m) => m.status === 'draft').length;
    const openCheques = cheques.filter((c) => {
      const s = c.status === 'returned' ? 'rejected' : c.status;
      return !['cleared', 'rejected', 'cancelled'].includes(s);
    }).length;
    const month = businessTodayYmd().slice(0, 7);
    const monthStatements = statements.filter((s) => s.periodEnd.startsWith(month)).length;
    return { activeAccounts, draftMovements, openCheques, monthStatements };
  }, [accounts, movements, cheques, statements]);

  useEffect(() => {
    if (isLocalBackend || !access.view) return;

    const unsubA = listenQuery(
      collection(db, 'bank_accounts'),
      (snap) => {
        setFsAccounts(snap.docs.map((d) => mapAccountRow({ ...d.data(), id: d.id })));
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'bank_accounts'),
    );

    const unsubM = listenQuery(
      collection(db, 'bank_movements'),
      (snap) => {
        setFsMovements(snap.docs.map((d) => mapMovementRow({ ...d.data(), id: d.id })));
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'bank_movements'),
    );

    const unsubC = listenQuery(
      collection(db, 'bank_cheques'),
      (snap) => {
        setFsCheques(snap.docs.map((d) => mapChequeRow({ ...d.data(), id: d.id })));
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'bank_cheques'),
    );

    const unsubS = listenQuery(
      collection(db, 'bank_statements'),
      (snap) => {
        setFsStatements(snap.docs.map((d) => mapStatementRow({ ...d.data(), id: d.id })));
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'bank_statements'),
    );

    const unsubCoa = listenQuery(
      query(collection(db, 'chart_of_accounts'), orderBy('accountCode')),
      (snap) =>
        setFsCoaAccounts(snap.docs.map((d) => ({ ...d.data(), id: d.id } as Account))),
      (error) => handleFirestoreError(error, OperationType.LIST, 'chart_of_accounts'),
    );

    return () => {
      unsubA();
      unsubM();
      unsubC();
      unsubS();
      unsubCoa();
    };
  }, [access.view]);

  if (!access.view) {
    return (
      <div className="p-8" dir={dir}>
        <div
          className={cn(
            'rounded-2xl border p-6 text-sm',
            theme === 'dark'
              ? 'border-gray-700 bg-gray-900/50 text-gray-300'
              : 'border-gray-200 bg-white text-gray-700',
          )}
        >
          {lang === 'ar'
            ? 'ليس لديك صلاحية عرض وحدة البنوك.'
            : 'You do not have permission to view Banks.'}
        </div>
      </div>
    );
  }

  const tabBtn = (active: boolean) =>
    cn(
      'px-4 py-2 rounded-xl text-sm font-bold transition-all',
      active
        ? 'bg-blue-600 text-white shadow-md shadow-blue-900/25'
        : theme === 'dark'
          ? 'bg-gray-700/30 text-gray-300 hover:bg-gray-700/50'
          : 'bg-gray-500/10 text-gray-600 hover:bg-gray-500/15',
    );

  const shellBg = cn(
    'p-6 md:p-8 min-h-screen transition-colors',
    theme === 'dark'
      ? 'bg-[#0a0a0a] text-gray-100'
      : theme === 'soft'
        ? 'bg-[#eceff1] text-[#37474f]'
        : 'bg-gray-50 text-gray-900',
  );

  const statCard = cn(
    'rounded-xl border p-4',
    theme === 'dark'
      ? 'border-gray-800 bg-[#151619]'
      : theme === 'soft'
        ? 'border-[#cfd8dc] bg-white'
        : 'border-gray-200 bg-white',
  );

  const TAB_META: Record<BankTab, { titleKey: string; subtitleKey: string }> = {
    accounts: { titleKey: 'banks_screen_accounts_title', subtitleKey: 'banks_screen_accounts_subtitle' },
    transactions: { titleKey: 'banks_screen_transactions_title', subtitleKey: 'banks_screen_transactions_subtitle' },
    statements: { titleKey: 'banks_menu_statements', subtitleKey: 'banks_screen_statements_subtitle' },
  };

  const headerMeta = TAB_META[tab];

  return (
    <div className={shellBg} dir={dir}>
      <header className="mb-6">
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
          <Landmark className="text-blue-500 shrink-0" size={28} />
          {t(headerMeta.titleKey)}
        </h2>
        <p className="text-gray-500 mt-1 text-sm">{t(headerMeta.subtitleKey)}</p>
      </header>

      {tab !== 'accounts' && tab !== 'transactions' ? (
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
        <div className={statCard}>
          <p className="text-xs text-gray-500">{lang === 'ar' ? 'الحسابات النشطة' : 'Active accounts'}</p>
          <p className="mt-1 text-2xl font-bold text-blue-500">{stats.activeAccounts}</p>
        </div>
        <div className={statCard}>
          <p className="text-xs text-gray-500">{lang === 'ar' ? 'مسودات الحركات' : 'Draft movements'}</p>
          <p className="mt-1 text-2xl font-bold text-amber-500">{stats.draftMovements}</p>
        </div>
        <div className={statCard}>
          <p className="text-xs text-gray-500">{lang === 'ar' ? 'شيكات مفتوحة' : 'Open cheques'}</p>
          <p className="mt-1 text-2xl font-bold text-emerald-500">{stats.openCheques}</p>
        </div>
        <div className={statCard}>
          <p className="text-xs text-gray-500">{lang === 'ar' ? 'كشوف هذا الشهر' : 'Statements this month'}</p>
          <p className="mt-1 text-2xl font-bold text-purple-500">{stats.monthStatements}</p>
        </div>
      </section>
      ) : null}

      {!isErpShell && (
      <div className="flex flex-wrap gap-2 mb-6">
        <button type="button" className={cn(tabBtn(tab === 'accounts'), 'inline-flex items-center gap-2')} onClick={() => setTab('accounts')}>
          <Building2 size={16} />
          {t('banks_menu_accounts')}
        </button>
        <button type="button" className={cn(tabBtn(tab === 'transactions'), 'inline-flex items-center gap-2')} onClick={() => setTab('transactions')}>
          <Wallet size={16} />
          {t('banks_menu_transactions')}
        </button>
        <button type="button" className={cn(tabBtn(tab === 'statements'), 'inline-flex items-center gap-2')} onClick={() => setTab('statements')}>
          <Landmark size={16} />
          {t('banks_menu_statements')}
        </button>
      </div>
      )}

      {tab === 'accounts' ? (
        <BankAccountsTab
          accounts={accounts}
          coaAccounts={coaAccounts}
          dir={dir}
          language={lang}
          theme={theme}
          allowCreate={access.create}
          allowEdit={access.edit}
          onMutated={onBankDataMutated}
          t={t}
        />
      ) : null}

      {tab === 'transactions' ? (
        <BankTransactionsTab
          movements={movements}
          cheques={cheques}
          accounts={accounts}
          coaAccounts={coaAccounts}
          balanceByCode={balanceByCode}
          glBalancesLoading={glBalancesLoading}
          dir={dir}
          language={lang}
          theme={theme}
          allowCreate={access.create}
          allowEdit={access.edit}
          banksEdit={access.edit}
          ledgerCreate={ledger.create}
          onMutated={onBankDataMutated}
          t={t}
        />
      ) : null}

      {tab === 'statements' ? (
        <BankStatementsTab
          statements={statements}
          accounts={accounts}
          language={lang}
          theme={theme}
          allowCreate={access.create}
          allowEdit={access.edit}
          onMutated={onBankDataMutated}
        />
      ) : null}
    </div>
  );
}
