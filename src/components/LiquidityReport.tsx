import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, orderBy, limit } from 'firebase/firestore';
import { listenQuery } from '../lib/firestoreListen';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { ApiError } from '../lib/apiClient';
import { cn } from '../lib/utils';
import { useLanguage } from '../context/LanguageContext';
import toast from 'react-hot-toast';
import { LISTENER_LIQUIDITY_KPI_GL_CAP } from '../constants/dataLimits';
import {
  aggregateLiquidityPortfolio,
  cashAndBankBalanceFromGlTxs,
  computeLiquidityContractRow,
  computePortfolioPendingBilling,
  contractCountByProject,
} from '../lib/liquidityMetrics';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { isLocalBackend } from '../lib/dataBackend';
import type { BillingRecord, Transaction } from '../types';
import { useApiQuery } from '../hooks/useApiQuery';
import { billingApi, contractsApi, glApi, projectsApi } from '../services/local/modulesApi';

interface Contract { id: string; contractName: string; contractNumber: string; projectId: string }
interface Project  { id: string; projectName: string }
interface BillingDoc {
  id: string;
  contractId: string;
  status: string;
  worksValueExVat: number;
  vatAmount: number;
  netPayable?: number;
  retentionAmount?: number;
  execGuaranteeAmount?: number;
  isDeleted?: boolean;
}
interface GlEntry   { accountCode: string; debit: number; credit: number }
interface GlTx      { id: string; projectId?: string; costCenterId?: string; reference?: string; entries: GlEntry[]; isDeleted?: boolean; date?: string }

function apiLoadErrorToast(err: unknown, language: string, label: string) {
  const msg =
    err instanceof ApiError
      ? `${label}: ${err.message} (${err.status})`
      : `${label}: ${err instanceof Error ? err.message : String(err)}`;
  toast.error(language === 'ar' ? `فشل تحميل ${label} من الخادم` : `Failed to load ${label} from API`, {
    description: msg,
  } as Parameters<typeof toast.error>[1]);
}

function normalizeLiquidityBilling(row: BillingRecord & { worksValueExVat?: number; vatAmount?: number; execGuaranteeAmount?: number }): BillingDoc {
  return {
    id: String(row.id ?? ''),
    contractId: String(row.contractId ?? ''),
    status: String(row.status ?? ''),
    worksValueExVat: Number(row.worksValueExVat ?? 0),
    vatAmount: Number(row.vatAmount ?? 0),
    netPayable: row.netPayable != null ? Number(row.netPayable) : undefined,
    retentionAmount: row.retentionAmount != null ? Number(row.retentionAmount) : undefined,
    execGuaranteeAmount: row.execGuaranteeAmount != null ? Number(row.execGuaranteeAmount) : undefined,
    isDeleted: row.isDeleted === true,
  };
}

export function LiquidityReport({ embedded = false }: { embedded?: boolean } = {}) {
  const { language, theme, dir, t, formatMoney } = useLanguage();

  const [cloudContracts, setCloudContracts] = useState<Contract[]>([]);
  const [cloudProjects, setCloudProjects] = useState<Project[]>([]);
  const [cloudBilling, setCloudBilling] = useState<BillingDoc[]>([]);
  const [cloudGlTxs, setCloudGlTxs] = useState<GlTx[]>([]);
  const [cloudLoading, setCloudLoading] = useState(!isLocalBackend);

  useEffect(() => {
    if (isLocalBackend) return;
    setCloudLoading(true);
    const unsubs = [
      listenQuery(query(collection(db, 'contracts'), where('isDeleted', '!=', true)),
        s => setCloudContracts(s.docs.map(d => ({ ...d.data(), id: d.id } as Contract))),
        e => handleFirestoreError(e, OperationType.LIST, 'contracts')),
      listenQuery(query(collection(db, 'projects'), where('isDeleted', '==', false)),
        s => setCloudProjects(s.docs.map(d => ({ ...d.data(), id: d.id } as Project))),
        e => handleFirestoreError(e, OperationType.LIST, 'projects')),
      listenQuery(query(collection(db, 'billing'), where('isDeleted', '!=', true)),
        s => { setCloudBilling(s.docs.map(d => ({ ...d.data(), id: d.id } as BillingDoc))); setCloudLoading(false); },
        e => { handleFirestoreError(e, OperationType.LIST, 'billing'); setCloudLoading(false); }),
      listenQuery(
        query(
          collection(db, 'transactions'),
          where('isDeleted', '==', false),
          orderBy('date', 'desc'),
          limit(LISTENER_LIQUIDITY_KPI_GL_CAP),
        ),
        s => setCloudGlTxs(s.docs.map(d => ({ ...d.data(), id: d.id } as GlTx))),
        e => handleFirestoreError(e, OperationType.LIST, 'transactions'),
      ),
    ];
    return () => unsubs.forEach(u => u());
  }, []);

  const { data: apiContracts, loading: apiContractsLoading, error: apiContractsError } = useApiQuery<Contract>(
    async () => {
      const rows = (await contractsApi.list()) as Contract[];
      return rows.filter((c) => (c as { isDeleted?: boolean }).isDeleted !== true);
    },
    [],
    { enabled: isLocalBackend },
  );
  const { data: apiProjects, loading: apiProjectsLoading, error: apiProjectsError } = useApiQuery<Project>(
    async () => {
      const rows = await projectsApi.list();
      return rows.filter((p) => !p.isDeleted).map((p) => ({ id: p.id, projectName: p.projectName }));
    },
    [],
    { enabled: isLocalBackend },
  );
  const { data: apiBilling, loading: apiBillingLoading, error: apiBillingError } = useApiQuery<BillingDoc>(
    async () => {
      const rows = await billingApi.list();
      return rows.filter((r) => r.isDeleted !== true).map(normalizeLiquidityBilling);
    },
    [],
    { enabled: isLocalBackend },
  );
  const { data: apiGlTxs, loading: apiGlLoading, error: apiGlError } = useApiQuery<GlTx>(
    () => glApi.transactions(undefined, LISTENER_LIQUIDITY_KPI_GL_CAP) as Promise<GlTx[]>,
    [],
    { enabled: isLocalBackend },
  );

  useEffect(() => {
    if (apiContractsError) apiLoadErrorToast(apiContractsError, language, language === 'ar' ? 'العقود' : 'contracts');
  }, [apiContractsError, language]);
  useEffect(() => {
    if (apiProjectsError) apiLoadErrorToast(apiProjectsError, language, language === 'ar' ? 'المشاريع' : 'projects');
  }, [apiProjectsError, language]);
  useEffect(() => {
    if (apiBillingError) apiLoadErrorToast(apiBillingError, language, language === 'ar' ? 'المستخلصات' : 'billing');
  }, [apiBillingError, language]);
  useEffect(() => {
    if (apiGlError) apiLoadErrorToast(apiGlError, language, language === 'ar' ? 'قيود اليومية' : 'journal entries');
  }, [apiGlError, language]);

  const contracts = isLocalBackend ? apiContracts : cloudContracts;
  const projects = isLocalBackend ? apiProjects : cloudProjects;
  const billing = isLocalBackend ? apiBilling : cloudBilling;
  const mergedGlTxs = isLocalBackend ? apiGlTxs : cloudGlTxs;
  const loading = isLocalBackend
    ? apiContractsLoading || apiProjectsLoading || apiBillingLoading || apiGlLoading
    : cloudLoading;

  const glSlice = useMemo(
    () =>
      mergedGlTxs.map(tx => ({
        costCenterId: tx.costCenterId,
        projectId: tx.projectId,
        reference: tx.reference,
        entries: tx.entries,
      })),
    [mergedGlTxs],
  );

  const activeBilling = useMemo(
    () => billing.filter(b => !b.isDeleted),
    [billing],
  );

  const projectsMap = useMemo(() => {
    const m = new Map<string, Project>();
    projects.forEach(p => m.set(p.id, p));
    return m;
  }, [projects]);

  const cashBalance = useMemo(() => cashAndBankBalanceFromGlTxs(glSlice), [glSlice]);

  const contractRows = useMemo(() => {
    const countMap = contractCountByProject(contracts);
    return contracts.map(contract =>
      computeLiquidityContractRow(contract, activeBilling, glSlice, countMap),
    );
  }, [contracts, activeBilling, glSlice]);

  const totals = useMemo(() => aggregateLiquidityPortfolio(contractRows), [contractRows]);

  const pendingBilling = useMemo(
    () => computePortfolioPendingBilling(glSlice, totals.uncollected),
    [glSlice, totals.uncollected],
  );

  const cardCls = cn(
    'p-5 border rounded-xl shadow-sm',
    theme === 'dark'  ? 'bg-[#151619] border-gray-800'   :
    theme === 'soft'  ? 'bg-white border-[#cfd8dc]'       :
                        'bg-white border-gray-200',
  );
  const tableBorderCls = theme === 'dark' ? 'border-gray-800' : theme === 'soft' ? 'border-[#cfd8dc]' : 'border-gray-200';
  const theadCls = theme === 'dark' ? 'bg-gray-900/40 border-gray-800' : theme === 'soft' ? 'bg-[#eceff1] border-[#cfd8dc]' : 'bg-gray-50 border-gray-200';
  const rowHoverCls = theme === 'dark' ? 'hover:bg-gray-800/30' : 'hover:bg-gray-50/60';

  return (
    <div className={cn(
      'transition-colors print:min-h-0 print:p-0 print:bg-white print:text-black',
      embedded
        ? 'p-0 min-h-0 bg-transparent'
        : cn('p-8 min-h-screen', theme === 'dark' ? 'bg-[#0a0a0a] text-gray-100' : 'bg-gray-50 text-gray-900'),
    )} dir={dir}>

      {/* Header — hidden when embedded in Reports page viewer (letterhead owns the title) */}
      {!embedded ? (
      <header className="mb-6 print:hidden">
        <h2 className="text-3xl font-bold tracking-tight">{language === 'ar' ? 'تقرير السيولة' : 'Liquidity Report'}</h2>
        <p className="text-gray-400 mt-1 text-sm">
          {language === 'ar' ? 'وضع التحصيلات والمستحقات لكل عقد' : 'Collections and receivables status per contract'}
        </p>
        {isLocalBackend && (
          <p className="text-xs text-amber-600/80 mt-2">
            {language === 'ar'
              ? `Postgres: ${mergedGlTxs.length} قيد · ${contracts.length} عقد`
              : `Postgres: ${mergedGlTxs.length} entries · ${contracts.length} contracts`}
          </p>
        )}
      </header>
      ) : null}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 report-print-summary-cards">
        <div className={cardCls}>
          <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">{language === 'ar' ? 'رصيد النقدية والبنوك' : 'Cash & Banks Balance'}</p>
          <p className={cn('text-2xl font-black font-mono', cashBalance >= 0 ? 'text-green-500' : 'text-red-500')}>{formatMoney(cashBalance)}</p>
          <div className="mt-1 flex items-center gap-1 text-[10px]">
            {cashBalance > 0 ? <TrendingUp size={12} className="text-green-500" /> : cashBalance < 0 ? <TrendingDown size={12} className="text-red-500" /> : <Minus size={12} className="text-gray-500" />}
            <span className="text-gray-500">{language === 'ar' ? 'إجمالي حسابات 121xxx' : 'All 121xxx accounts'}</span>
          </div>
        </div>
        <div className={cardCls}>
          <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">{language === 'ar' ? 'إجمالي المستخلصات' : 'Total Billed'}</p>
          <p className="text-2xl font-black font-mono text-blue-500">{formatMoney(totals.billed)}</p>
        </div>
        <div className={cardCls}>
          <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">{t('cash_collections')}</p>
          <p className="text-2xl font-black font-mono text-green-500">{formatMoney(totals.ipcCollected)}</p>
        </div>
        <div className={cardCls}>
          <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">{t('pending_billing')}</p>
          <p className={cn('text-2xl font-black font-mono', pendingBilling > 0 ? 'text-orange-500' : 'text-gray-400')}>{formatMoney(pendingBilling)}</p>
        </div>
      </div>

      {/* Per-contract table */}
      <div className={cn('border rounded-2xl overflow-hidden shadow-sm', theme === 'dark' ? 'bg-[#151619] border-gray-800' : 'bg-white border-gray-200')}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className={cn('border-b text-xs font-black text-gray-400 uppercase', theadCls)}>
                <th className="px-5 py-3 text-start">{language === 'ar' ? 'العقد' : 'Contract'}</th>
                <th className="px-5 py-3 text-start">{language === 'ar' ? 'المشروع' : 'Project'}</th>
                <th className="px-5 py-3 text-end">{language === 'ar' ? 'المستخلصات' : 'Billed'}</th>
                <th className="px-5 py-3 text-end">{language === 'ar' ? 'التحصيلات' : 'Collected'}</th>
                <th className="px-5 py-3 text-end">{language === 'ar' ? 'دفعات مقدمة' : 'Advances'}</th>
                <th className="px-5 py-3 text-end">{language === 'ar' ? 'المحتجزات' : 'Retention'}</th>
                <th className="px-5 py-3 text-end">{language === 'ar' ? 'غير محصل' : 'Uncollected'}</th>
                <th className="px-5 py-3 text-end">{language === 'ar' ? 'نسبة التحصيل' : 'Collection %'}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-5 py-12 text-center text-gray-500">{language === 'ar' ? 'جاري التحميل…' : 'Loading…'}</td></tr>
              ) : contractRows.length === 0 ? (
                <tr><td colSpan={8} className="px-5 py-12 text-center text-gray-500">{language === 'ar' ? 'لا توجد عقود' : 'No contracts found'}</td></tr>
              ) : contractRows.map(row => {
                const project = projectsMap.get(row.contract.projectId);
                const pct = row.totalBilled > 0 ? Math.round((row.ipcCollected / row.totalBilled) * 100) : 0;
                return (
                  <tr key={row.contract.id} className={cn('border-b transition-colors', tableBorderCls, rowHoverCls)}>
                    <td className="px-5 py-3 font-bold">{row.contract.contractNumber || row.contract.contractName}</td>
                    <td className="px-5 py-3 text-gray-500">{project?.projectName || '—'}</td>
                    <td className="px-5 py-3 text-end font-mono tabular-nums">{formatMoney(row.totalBilled)}</td>
                    <td className="px-5 py-3 text-end font-mono tabular-nums text-green-500">{formatMoney(row.ipcCollected)}</td>
                    <td className="px-5 py-3 text-end font-mono tabular-nums text-blue-400">{formatMoney(row.totalAdvances)}</td>
                    <td className="px-5 py-3 text-end font-mono tabular-nums text-orange-400">{formatMoney(row.totalRetention)}</td>
                    <td className="px-5 py-3 text-end font-mono tabular-nums text-red-400">{formatMoney(row.uncollected)}</td>
                    <td className="px-5 py-3 text-end font-mono tabular-nums" dir="ltr">{pct}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
