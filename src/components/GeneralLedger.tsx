import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useErpModuleDraft, useErpModuleView } from '../hooks/useErpModuleView';
import { BookOpen, Calculator, CalendarRange } from 'lucide-react';
import { collection, query, orderBy, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useFirestoreQuery } from '../hooks/useFirestoreQuery';
import { useApiQuery } from '../hooks/useApiQuery';
import { useFilteredGlTransactions } from '../hooks/useFilteredGlTransactions';
import { cn } from '../lib/utils';
import { motion } from 'motion/react';
import toast from 'react-hot-toast';
import { useLanguage } from '../context/LanguageContext';
import { usePermissions } from '../context/PermissionsContext';
import { isLocalBackend } from '../lib/dataBackend';
import { chartOfAccountsApi, contractsApi, projectsApi } from '../services/local/modulesApi';
import { Account } from '../services/accountingService';
import { GLJournalEntries } from './gl/GLJournalEntries';
import { GLAccountStatement } from './gl/GLAccountStatement';
import { OverheadAllocation } from './OverheadAllocation';
import { JournalFilterPanel } from './gl/JournalFilterPanel';
import { ApiError } from '../lib/apiClient';
import {
  defaultJournalFilters,
  validateJournalFilters,
  type JournalQueryFilters,
} from '../lib/journalFilters';
import { consumePendingShellView, peekPendingShellView } from '../lib/shellNavigation';

interface Project { id: string; projectName: string; projectCode: string; projectNameEn?: string }
interface Contract { id: string; contractName: string; contractNameEn?: string; contractNumber: string; projectId: string }

export type GlSubTab = 'journal' | 'ledger' | 'periods';

export interface GlTabFilterBundle {
  draft: JournalQueryFilters;
  applied: JournalQueryFilters | null;
  limit: number;
  refreshKey: number;
}

export interface GeneralLedgerDraft {
  journalTab: GlTabFilterBundle;
  statementTab: GlTabFilterBundle;
  activeSubTab: GlSubTab;
}

function newTabFilters(defaultLimit: number): GlTabFilterBundle {
  return {
    draft: defaultJournalFilters(),
    applied: null,
    limit: defaultLimit,
    refreshKey: 0,
  };
}

function normalizeCoaRows(rows: Account[]): Account[] {
  return rows
    .map((a) => {
      const accountCode = String(a.accountCode ?? '').trim();
      let parentCode = String(a.parentCode ?? '').trim();
      if (accountCode.length === 1) parentCode = '';
      else if (parentCode === accountCode) parentCode = '';
      return { ...a, accountCode, parentCode };
    })
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
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

function viewIdToSubTab(viewId: string): GlSubTab {
  if (viewId === 'statement') return 'ledger';
  if (viewId === 'periods') return 'periods';
  return 'journal';
}

export function GeneralLedger() {
  const { language, theme, dir, t } = useLanguage();
  const { can } = usePermissions();
  const ledger = can('ledger');
  const overheadAccess = can('overhead');
  const { isErpShell, activeViewId, erp } = useErpModuleView('ledger', 'journal');
  const draftHydrated = useRef(false);

  const [activeSubTab, setActiveSubTab] = useState<GlSubTab>(() => {
    const pending = peekPendingShellView('ledger');
    return viewIdToSubTab(pending ?? 'journal');
  });
  const [journalTab, setJournalTab] = useState(() => newTabFilters(50));
  const [statementTab, setStatementTab] = useState(() => newTabFilters(5000));
  const [coaRefreshKey] = useState(0);

  useEffect(() => {
    if (!isErpShell || !erp || draftHydrated.current) return;
    const saved = erp.getModuleDraft<GeneralLedgerDraft>('ledger');
    if (saved) {
      setJournalTab(saved.journalTab);
      setStatementTab(saved.statementTab);
    }
    draftHydrated.current = true;
  }, [isErpShell, erp]);

  useEffect(() => {
    if (isErpShell) return;
    if (!ledger.view && overheadAccess.view) {
      setActiveSubTab('periods');
    }
  }, [isErpShell, ledger.view, overheadAccess.view]);

  useEffect(() => {
    if (!isErpShell) return;
    setActiveSubTab(viewIdToSubTab(activeViewId));
  }, [activeViewId, isErpShell]);

  useEffect(() => {
    if (isErpShell) return;
    const pendingView = consumePendingShellView('ledger');
    if (pendingView) setActiveSubTab(viewIdToSubTab(pendingView));
  }, [isErpShell]);

  useErpModuleDraft(
    'ledger',
    { journalTab, statementTab, activeSubTab },
    isErpShell,
    erp,
  );

  const activeBundle = activeSubTab === 'journal' ? journalTab : statementTab;
  const setActiveBundle = activeSubTab === 'journal' ? setJournalTab : setStatementTab;
  const isPeriodsView = activeSubTab === 'periods';

  const journalApplied = journalTab.applied;
  const statementApplied = statementTab.applied;

  const { data: fsAccounts } = useFirestoreQuery<Account>(
    () =>
      isLocalBackend
        ? null
        : query(collection(db, 'chart_of_accounts'), orderBy('accountCode')),
    [isLocalBackend],
    { mode: 'snapshot', collectionName: 'chart_of_accounts' },
  );

  const {
    data: apiCoaRows,
    loading: apiCoaLoading,
    error: apiCoaError,
  } = useApiQuery<Account>(
    async () => normalizeCoaRows((await chartOfAccountsApi.list()) as Account[]),
    [coaRefreshKey],
    { enabled: isLocalBackend, refreshKey: coaRefreshKey },
  );

  useEffect(() => {
    if (apiCoaError) apiLoadErrorToast(apiCoaError, language, language === 'ar' ? 'شجرة الحسابات' : 'chart of accounts');
  }, [apiCoaError, language]);

  const accounts = isLocalBackend ? (apiCoaRows ?? []) : (fsAccounts ?? []);

  const { data: fsProjects } = useFirestoreQuery<Project>(
    () => (isLocalBackend ? null : query(collection(db, 'projects'), where('isDeleted', '==', false))),
    [isLocalBackend],
    { mode: 'snapshot', collectionName: 'projects' },
  );
  const { data: apiProjects } = useApiQuery<Project>(
    () => projectsApi.list() as Promise<Project[]>,
    [],
    { enabled: isLocalBackend },
  );
  const projects = isLocalBackend ? (apiProjects ?? []) : (fsProjects ?? []);

  const { data: fsContracts } = useFirestoreQuery<Contract>(
    () => (isLocalBackend ? null : query(collection(db, 'contracts'), where('isDeleted', '==', false))),
    [isLocalBackend],
    { mode: 'snapshot', collectionName: 'contracts' },
  );
  const { data: apiContracts } = useApiQuery<Contract>(
    () => contractsApi.list() as Promise<Contract[]>,
    [],
    { enabled: isLocalBackend },
  );
  const contracts = isLocalBackend ? (apiContracts ?? []) : (fsContracts ?? []);

  const projectIdByContractId = useMemo(() => {
    const map = new Map<string, string>();
    contracts.forEach((c) => map.set(c.id, c.projectId));
    return map;
  }, [contracts]);

  const {
    transactions: journalTransactions,
    loading: journalLoading,
    error: journalTxError,
  } = useFilteredGlTransactions(
    journalApplied,
    journalTab.limit,
    journalTab.refreshKey,
    projectIdByContractId,
  );

  const {
    transactions: statementTransactions,
    loading: statementLoading,
    error: statementTxError,
  } = useFilteredGlTransactions(
    statementApplied,
    statementTab.limit,
    statementTab.refreshKey,
    projectIdByContractId,
  );

  useEffect(() => {
    if (journalTxError) apiLoadErrorToast(journalTxError, language, language === 'ar' ? 'قيود اليومية' : 'journal entries');
  }, [journalTxError, language]);

  useEffect(() => {
    if (statementTxError) apiLoadErrorToast(statementTxError, language, language === 'ar' ? 'كشف الحساب' : 'account statement');
  }, [statementTxError, language]);

  const contractsMap = useMemo(() => {
    const map = new Map<string, Contract>();
    contracts.forEach(c => map.set(c.id, c));
    return map;
  }, [contracts]);

  const projectsMap = useMemo(() => {
    const map = new Map<string, Project>();
    projects.forEach(p => map.set(p.id, p));
    return map;
  }, [projects]);

  const journalFiscalYear = journalApplied
    ? Number(journalApplied.dateFrom.slice(0, 4)) || new Date().getFullYear()
    : new Date().getFullYear();

  const handleApplyFilters = () => {
    const err = validateJournalFilters(activeBundle.draft, language === 'ar' ? 'ar' : 'en');
    if (err) {
      toast.error(err);
      return;
    }
    setActiveBundle((prev) => ({
      ...prev,
      applied: {
        ...prev.draft,
        accountTo: prev.draft.accountScope === 'range' ? prev.draft.accountTo : '',
      },
      limit: activeSubTab === 'journal' ? 50 : 5000,
      refreshKey: prev.refreshKey + 1,
    }));
  };

  const handleResetFilters = () => {
    const defaultLimit = activeSubTab === 'journal' ? 50 : 5000;
    setActiveBundle(newTabFilters(defaultLimit));
  };

  const tabs: { id: GlSubTab; icon: React.ReactNode; label: string }[] = [
    { id: 'journal', icon: <BookOpen size={16} />, label: language === 'ar' ? 'دفتر اليومية' : 'Journal Entries' },
    { id: 'ledger', icon: <Calculator size={16} />, label: language === 'ar' ? 'كشف حساب' : 'Account Statement' },
    { id: 'periods', icon: <CalendarRange size={16} />, label: t('gl_menu_periods') },
  ];

  const activeApplied = activeSubTab === 'journal' ? journalApplied : statementApplied;
  const activeLoading = activeSubTab === 'journal'
    ? (journalApplied !== null && (apiCoaLoading || journalLoading))
    : (statementApplied !== null && (apiCoaLoading || statementLoading));

  return (
    <div className={cn('min-h-screen transition-colors p-4 md:p-6', theme === 'dark' ? 'bg-[#0a0a0a] text-gray-100' : theme === 'soft' ? 'bg-[#eceff1] text-[#37474f]' : 'bg-gray-50 text-gray-900')} dir={dir}>
      <header className={cn(isPeriodsView ? 'mb-4' : 'mb-8')}>
        <h2 className="text-3xl font-bold tracking-tight">
          {isPeriodsView
            ? (language === 'ar' ? 'إقفال الفترات المحاسبية' : 'Closing accounting periods')
            : (language === 'ar' ? 'الاستاذ العام' : 'General Ledger')}
        </h2>
        <p className="text-gray-400 mt-1">
          {isPeriodsView
            ? t('overhead_module_desc')
            : (language === 'ar' ? 'استعراض القيود المحاسبية وكشوف الحسابات' : 'Browse journal entries and account statements')}
        </p>
        {isLocalBackend && activeApplied && !isPeriodsView && (
          <p className="text-xs text-amber-600/80 mt-2">
            {activeSubTab === 'journal'
              ? (language === 'ar'
                ? `Postgres: ${accounts.length} حساب · ${journalTransactions.length} قيد (دفتر اليومية)`
                : `Postgres: ${accounts.length} accounts · ${journalTransactions.length} journal entries`)
              : (language === 'ar'
                ? `Postgres: ${accounts.length} حساب · ${statementTransactions.length} قيد (كشف الحساب)`
                : `Postgres: ${accounts.length} accounts · ${statementTransactions.length} entries for statement`)}
          </p>
        )}
      </header>

      {!isErpShell && (
        <div className={cn('flex flex-wrap items-center gap-4 mb-6 border-b', theme === 'dark' ? 'border-gray-800' : theme === 'soft' ? 'border-[#cfd8dc]' : 'border-gray-200')}>
          <div className="flex gap-4">
            {tabs.map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveSubTab(tab.id)}
                className={cn(
                  'pb-4 px-2 text-sm font-bold transition-all relative',
                  activeSubTab === tab.id ? 'text-blue-500' : theme === 'dark' ? 'text-gray-500 hover:text-gray-300' : 'text-gray-500 hover:text-gray-800',
                  ((tab.id === 'periods' && !overheadAccess.view) || ((tab.id === 'journal' || tab.id === 'ledger') && !ledger.view)) && 'opacity-45 cursor-not-allowed',
                )}
                disabled={
                  (tab.id === 'periods' && !overheadAccess.view)
                  || ((tab.id === 'journal' || tab.id === 'ledger') && !ledger.view)
                }
                title={
                  tab.id === 'periods' && !overheadAccess.view
                    ? t('shell_module_access_denied').replace('{module}', t('gl_menu_periods'))
                    : (tab.id === 'journal' || tab.id === 'ledger') && !ledger.view
                      ? t('shell_module_access_denied').replace('{module}', t('ledger'))
                      : undefined
                }
              >
                <div className="flex items-center gap-2">{tab.icon}{tab.label}</div>
                {activeSubTab === tab.id && <motion.div layoutId="glActiveTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {isPeriodsView ? (
        overheadAccess.view ? (
          <OverheadAllocation embedded />
        ) : (
          <div className={cn('border rounded-xl p-12 text-center', theme === 'dark' ? 'border-gray-800 bg-[#151619]' : theme === 'soft' ? 'border-[#cfd8dc] bg-white' : 'border-gray-200 bg-white')}>
            <p className={cn('text-sm', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>
              {t('shell_module_access_denied').replace('{module}', t('gl_menu_periods'))}
            </p>
          </div>
        )
      ) : (
        <div className={cn('flex flex-col md:flex-row md:items-start gap-4', dir === 'rtl' ? 'md:flex-row-reverse' : '')}>
          <div className="flex-1 min-w-0 md:flex-[3] space-y-4 order-2 md:order-none">
      {activeSubTab === 'journal' ? (
        !journalApplied ? (
          <div className={cn('border rounded-xl p-12 text-center', theme === 'dark' ? 'border-gray-800 bg-[#151619]' : theme === 'soft' ? 'border-[#cfd8dc] bg-white' : 'border-gray-200 bg-white')}>
            <p className={cn('text-sm', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>{t('gl_journal_select_filters')}</p>
          </div>
        ) : (
          <GLJournalEntries
            transactions={journalTransactions}
            transactionLimit={journalTab.limit}
            onLoadMore={() => setJournalTab((prev) => ({ ...prev, limit: prev.limit + 50 }))}
            onJournalChanged={() => setJournalTab((prev) => ({ ...prev, refreshKey: prev.refreshKey + 1 }))}
            accounts={accounts}
            contracts={contracts}
            projects={projects}
            contractsMap={contractsMap}
            projectsMap={projectsMap}
            theme={theme}
            language={language}
            dir={dir}
            fiscalYear={journalFiscalYear}
            loading={activeLoading}
            allowCreate={ledger.create}
            allowEdit={ledger.edit}
          />
        )
      ) : !statementApplied ? (
        <div className={cn('border rounded-xl p-12 text-center', theme === 'dark' ? 'border-gray-800 bg-[#151619]' : theme === 'soft' ? 'border-[#cfd8dc] bg-white' : 'border-gray-200 bg-white')}>
          <p className={cn('text-sm', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>{t('gl_statement_select_filters')}</p>
        </div>
      ) : (
        <GLAccountStatement
          transactions={statementTransactions}
          accounts={accounts}
          theme={theme}
          language={language}
          dir={dir}
          dateFrom={statementApplied.dateFrom}
          dateTo={statementApplied.dateTo}
          selectedAccountCode={statementApplied.accountFrom}
          loading={activeLoading}
          contractsMap={contractsMap}
          projectsMap={projectsMap}
        />
      )}
          </div>

          <JournalFilterPanel
            layout="sidebar"
            variant={activeSubTab === 'journal' ? 'journal' : 'statement'}
            filters={activeBundle.draft}
            onChange={(draft) => setActiveBundle((prev) => ({ ...prev, draft }))}
            onApply={handleApplyFilters}
            onReset={handleResetFilters}
            projects={projects}
            accounts={accounts}
            theme={theme}
            applied={activeApplied !== null}
          />
        </div>
      )}
    </div>
  );
}
