import React, { useMemo, useCallback, useState, useEffect } from 'react';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
  Loader2,
  Landmark,
  Minus,
  PieChart as PieChartIcon,
} from 'lucide-react';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  AreaChart,
  Area,
  BarChart,
  Bar,
  Legend,
  Cell,
} from 'recharts';
import { ResponsiveChart } from './charts/ResponsiveChart';
import { collection, query, where, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { ApiError } from '../lib/apiClient';
import { useFirestoreQuery } from '../hooks/useFirestoreQuery';
import { useApiQuery } from '../hooks/useApiQuery';
import { motion } from 'motion/react';
import { cn, normalizeDate } from '../lib/utils';
import { useLanguage } from '../context/LanguageContext';
import { formatNumber } from '../lib/numberLocale';
import toast from 'react-hot-toast';
import { usePermissions } from '../context/PermissionsContext';
import {
  type Transaction,
  type BOQItem,
  type Project,
  type Contract,
  type BillingRecord,
  type MosCertificate,
} from '../types';
import { isLocalBackend } from '../lib/dataBackend';
import {
  billingApi,
  boqApi,
  contractsApi,
  glApi,
  inventoryApi,
  mosCertificatesApi,
  projectsApi,
} from '../services/local/modulesApi';
import { LISTENER_LIQUIDITY_KPI_GL_CAP } from '../constants/dataLimits';
import {
  buildCashFlowSeries,
  buildContractProgressPieSlices,
  buildContractProjectMap,
  buildMonthlySeries,
  buildProjectCompareRows,
  computeDashboardPeriodStats,
  DASHBOARD_UNALLOCATED_PROJECT_ID,
  defaultDashboardFilters,
  filterDashboardTransactions,
  materialSpentByMonth,
  materialSpentByProject,
  percentDelta,
  previousPeriodRange,
  resolveDatePreset,
  sumMaterialSpent,
  type DashboardDatePreset,
  type DashboardFilterState,
  type DashboardMosClaimSlice,
  type MaterialSpentSlice,
} from '../lib/dashboardMetrics';
import { DashboardFilterBar } from './dashboard/DashboardFilterBar';
import {
  ProjectCompareTable,
  type ProjectCompareSortKey,
} from './dashboard/ProjectCompareTable';
import { DashboardPie3D } from './dashboard/DashboardPie3D';
interface DashboardContract {
  id: string;
  projectId: string;
  contractName?: string;
  contractNumber?: string;
  isDeleted?: boolean;
}

interface DashboardBilling {
  id?: string;
  contractId: string;
  projectId?: string;
  status: string;
  date?: string;
  billingNumber?: string;
  worksValueExVat?: number;
  vatAmount?: number;
  netPayable?: number;
  retentionAmount?: number;
  execGuaranteeAmount?: number;
  isDeleted?: boolean;
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

function normalizeDashboardBilling(
  row: BillingRecord & {
    worksValueExVat?: number;
    vatAmount?: number;
    execGuaranteeAmount?: number;
  },
): DashboardBilling {
  return {
    id: row.id,
    contractId: String(row.contractId ?? ''),
    projectId: row.projectId ? String(row.projectId) : undefined,
    status: String(row.status ?? ''),
    date: row.date ? normalizeDate(row.date) : undefined,
    billingNumber: row.billingNumber,
    worksValueExVat: Number(row.worksValueExVat ?? 0),
    vatAmount: Number(row.vatAmount ?? 0),
    netPayable: Number(row.netPayable ?? 0),
    retentionAmount: row.retentionAmount != null ? Number(row.retentionAmount) : undefined,
    execGuaranteeAmount: Number(row.execGuaranteeAmount ?? 0),
    isDeleted: row.isDeleted === true,
  };
}

function normalizeDashboardBoq(row: BOQItem & { tenderQty?: number; unitRateTotal?: number }): BOQItem {
  return {
    id: String(row.id),
    projectId: String(row.projectId ?? ''),
    contractId: row.contractId ? String(row.contractId) : undefined,
    itemCode: String(row.itemCode ?? ''),
    description: String(row.description ?? ''),
    unit: String(row.unit ?? ''),
    quantity: Number(row.tenderQty ?? row.quantity ?? 0),
    unitRate: Number(row.unitRateTotal ?? row.unitRate ?? 0),
    tenderAmount: Number(row.tenderAmount ?? 0),
    isDeleted: row.isDeleted === true,
  };
}

type FocusMetric = 'revenue' | 'cost' | 'collections' | null;

function DeltaBadge({
  delta,
  invertColors,
}: {
  delta: number | null;
  invertColors?: boolean;
}) {
  if (delta === null) {
    return (
      <span className="text-[10px] font-bold px-2 py-1 rounded flex items-center gap-1 bg-gray-500/15 text-gray-400">
        <Minus size={10} /> —
      </span>
    );
  }
  const up = delta > 0.05;
  const down = delta < -0.05;
  const good = invertColors ? down : up;
  const bad = invertColors ? up : down;
  return (
    <span
      className={cn(
        'text-[10px] font-bold px-2 py-1 rounded flex items-center gap-1',
        good
          ? 'bg-green-900/20 text-green-400'
          : bad
            ? 'bg-red-900/20 text-red-400'
            : 'bg-gray-500/15 text-gray-400',
      )}
    >
      {up ? <ArrowUpRight size={10} /> : down ? <ArrowDownRight size={10} /> : <Minus size={10} />}
      {`${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`}
    </span>
  );
}

export function Dashboard() {
  const { t, language, theme, locale, formatMoney } = useLanguage();
  const { can } = usePermissions();
  const canViewDashboard = can('dashboard').view;
  const [refreshKey, setRefreshKey] = useState(0);
  const [filters, setFilters] = useState<DashboardFilterState>(() => defaultDashboardFilters());
  const [focusMetric, setFocusMetric] = useState<FocusMetric>(null);
  const [focusMonth, setFocusMonth] = useState('');
  const [sortKey, setSortKey] = useState<ProjectCompareSortKey>('billed');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const materialFilterParams = useMemo(
    () => ({
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      contractId: filters.contractId || undefined,
      projectId: filters.projectId !== 'all' ? filters.projectId : undefined,
      groupBy: 'month' as const,
    }),
    [filters.dateFrom, filters.dateTo, filters.contractId, filters.projectId],
  );

  const { data: materialRows = [] } = useApiQuery<MaterialSpentSlice>(
    () => inventoryApi.spentByContract(materialFilterParams),
    [materialFilterParams, refreshKey],
    { enabled: isLocalBackend && canViewDashboard, refreshKey },
  );

  const { data: fsProjects, loading: fsProjectsLoading } = useFirestoreQuery<Project>(
    () =>
      !isLocalBackend && canViewDashboard
        ? query(collection(db, 'projects'), where('isDeleted', '==', false))
        : null,
    [refreshKey, canViewDashboard, isLocalBackend],
    { mode: 'snapshot', collectionName: 'projects' },
  );
  const { data: apiProjects, loading: apiProjectsLoading, error: apiProjectsError } = useApiQuery<Project>(
    async () => {
      const rows = (await projectsApi.list()) as Project[];
      return rows.filter((p) => !p.isDeleted);
    },
    [refreshKey],
    { enabled: isLocalBackend && canViewDashboard, refreshKey },
  );
  const rawProjects = isLocalBackend ? apiProjects : fsProjects;

  const { data: fsTransactions, loading: fsTxLoading, size: fsTxSize } = useFirestoreQuery<Transaction>(
    () =>
      !isLocalBackend && canViewDashboard
        ? query(
            collection(db, 'transactions'),
            where('isDeleted', '==', false),
            orderBy('date', 'desc'),
            limit(LISTENER_LIQUIDITY_KPI_GL_CAP),
          )
        : null,
    [refreshKey, canViewDashboard, isLocalBackend],
    { mode: 'snapshot', collectionName: 'transactions' },
  );
  const { data: apiTransactions, loading: apiTxLoading, error: apiTxError } = useApiQuery<Transaction>(
    () => glApi.transactions(undefined, LISTENER_LIQUIDITY_KPI_GL_CAP) as Promise<Transaction[]>,
    [refreshKey],
    { enabled: isLocalBackend && canViewDashboard, refreshKey },
  );
  const mergedTransactions = isLocalBackend ? apiTransactions : (fsTransactions ?? []);
  const txSize = isLocalBackend ? apiTransactions.length : fsTxSize;

  const { data: fsBoqItems, loading: fsBoqLoading } = useFirestoreQuery<BOQItem>(
    () =>
      !isLocalBackend && canViewDashboard
        ? query(collection(db, 'boq_items'), where('isDeleted', '!=', true))
        : null,
    [refreshKey, canViewDashboard, isLocalBackend],
    { mode: 'snapshot', collectionName: 'boq_items' },
  );
  const { data: apiBoqItems, loading: apiBoqLoading, error: apiBoqError } = useApiQuery<BOQItem>(
    async () => {
      const rows = await boqApi.list();
      return rows.filter((r) => r.isDeleted !== true).map(normalizeDashboardBoq);
    },
    [refreshKey],
    { enabled: isLocalBackend && canViewDashboard, refreshKey },
  );
  const rawBoqItems = isLocalBackend ? apiBoqItems : fsBoqItems;

  const { data: fsContracts } = useFirestoreQuery<DashboardContract>(
    () =>
      !isLocalBackend && canViewDashboard
        ? query(collection(db, 'contracts'), where('isDeleted', '!=', true))
        : null,
    [refreshKey, canViewDashboard, isLocalBackend],
    { mode: 'snapshot', collectionName: 'contracts' },
  );
  const { data: apiContracts, error: apiContractsError } = useApiQuery<DashboardContract>(
    async () => {
      const rows = (await contractsApi.list()) as Contract[];
      return rows.filter((c) => c.isDeleted !== true) as DashboardContract[];
    },
    [refreshKey],
    { enabled: isLocalBackend && canViewDashboard, refreshKey },
  );
  const rawContracts = isLocalBackend ? apiContracts : fsContracts;

  const { data: fsBilling } = useFirestoreQuery<DashboardBilling>(
    () =>
      !isLocalBackend && canViewDashboard
        ? query(collection(db, 'billing'), where('isDeleted', '!=', true))
        : null,
    [refreshKey, canViewDashboard, isLocalBackend],
    { mode: 'snapshot', collectionName: 'billing' },
  );
  const { data: apiBilling, error: apiBillingError } = useApiQuery<DashboardBilling>(
    async () => {
      const rows = await billingApi.list();
      return rows.filter((r) => r.isDeleted !== true).map(normalizeDashboardBilling);
    },
    [refreshKey],
    { enabled: isLocalBackend && canViewDashboard, refreshKey },
  );
  const rawBilling = isLocalBackend ? apiBilling : fsBilling;

  const { data: apiMosClaims, error: apiMosError } = useApiQuery<DashboardMosClaimSlice>(
    async () => {
      const rows = (await mosCertificatesApi.list()) as MosCertificate[];
      return rows.map((c) => ({
        contractId: c.contractId,
        status: c.status,
        totalClaimed: Number(c.totalClaimed || 0),
      }));
    },
    [refreshKey],
    { enabled: isLocalBackend && canViewDashboard, refreshKey },
  );
  const mosClaims = isLocalBackend ? apiMosClaims ?? [] : [];

  useEffect(() => {
    if (apiProjectsError) apiLoadErrorToast(apiProjectsError, language, language === 'ar' ? 'المشاريع' : 'projects');
  }, [apiProjectsError, language]);
  useEffect(() => {
    if (apiTxError) apiLoadErrorToast(apiTxError, language, language === 'ar' ? 'قيود اليومية' : 'journal entries');
  }, [apiTxError, language]);
  useEffect(() => {
    if (apiBoqError) apiLoadErrorToast(apiBoqError, language, language === 'ar' ? 'بنود BOQ' : 'BOQ items');
  }, [apiBoqError, language]);
  useEffect(() => {
    if (apiContractsError) apiLoadErrorToast(apiContractsError, language, language === 'ar' ? 'العقود' : 'contracts');
  }, [apiContractsError, language]);
  useEffect(() => {
    if (apiBillingError) apiLoadErrorToast(apiBillingError, language, language === 'ar' ? 'المستخلصات' : 'billing');
  }, [apiBillingError, language]);
  useEffect(() => {
    if (apiMosError) apiLoadErrorToast(apiMosError, language, language === 'ar' ? 'التشوينات' : 'MOS');
  }, [apiMosError, language]);

  const loading = isLocalBackend
    ? apiProjectsLoading || apiTxLoading || apiBoqLoading
    : fsProjectsLoading || fsTxLoading || fsBoqLoading;
  const transactionsCapped = txSize >= LISTENER_LIQUIDITY_KPI_GL_CAP;
  const expenseMode = isLocalBackend ? 'local' : 'cloud';

  const projectIdByContractId = useMemo(
    () => buildContractProjectMap(rawContracts ?? []),
    [rawContracts],
  );

  const filteredTxs = useMemo(
    () => filterDashboardTransactions(mergedTransactions, filters, projectIdByContractId),
    [mergedTransactions, filters, projectIdByContractId],
  );

  const prevRange = useMemo(
    () => previousPeriodRange(filters.dateFrom, filters.dateTo),
    [filters.dateFrom, filters.dateTo],
  );

  const prevFilteredTxs = useMemo(() => {
    if (!prevRange.dateFrom || !prevRange.dateTo) return [];
    return filterDashboardTransactions(
      mergedTransactions,
      { ...filters, dateFrom: prevRange.dateFrom, dateTo: prevRange.dateTo },
      projectIdByContractId,
    );
  }, [mergedTransactions, filters, prevRange, projectIdByContractId]);

  const { data: prevMaterialRows = [] } = useApiQuery<MaterialSpentSlice>(
    () =>
      inventoryApi.spentByContract({
        dateFrom: prevRange.dateFrom || undefined,
        dateTo: prevRange.dateTo || undefined,
        contractId: filters.contractId || undefined,
        projectId: filters.projectId !== 'all' ? filters.projectId : undefined,
      }),
    [prevRange.dateFrom, prevRange.dateTo, filters.contractId, filters.projectId, refreshKey],
    {
      enabled:
        isLocalBackend &&
        canViewDashboard &&
        !!prevRange.dateFrom &&
        !!prevRange.dateTo,
      refreshKey,
    },
  );

  const materialOpts = useMemo(
    () => ({
      projectIdFilter: filters.projectId,
      contractIdFilter: filters.contractId,
      projectIdByContract: projectIdByContractId,
    }),
    [filters.projectId, filters.contractId, projectIdByContractId],
  );

  const materialSpentExtra = useMemo(
    () => (isLocalBackend ? sumMaterialSpent(materialRows, materialOpts) : 0),
    [isLocalBackend, materialRows, materialOpts],
  );

  const prevMaterialSpentExtra = useMemo(
    () => (isLocalBackend ? sumMaterialSpent(prevMaterialRows, materialOpts) : 0),
    [isLocalBackend, prevMaterialRows, materialOpts],
  );

  const materialsByMonth = useMemo(
    () => (isLocalBackend ? materialSpentByMonth(materialRows, materialOpts) : new Map<string, number>()),
    [isLocalBackend, materialRows, materialOpts],
  );

  const materialsByProject = useMemo(
    () =>
      isLocalBackend
        ? materialSpentByProject(materialRows, {
            contractIdFilter: filters.contractId,
            projectIdByContract: projectIdByContractId,
          })
        : new Map<string, number>(),
    [isLocalBackend, materialRows, filters.contractId, projectIdByContractId],
  );

  const currentStats = useMemo(
    () =>
      computeDashboardPeriodStats({
        projects: rawProjects ?? [],
        boqItems: rawBoqItems ?? [],
        contracts: rawContracts ?? [],
        billing: rawBilling ?? [],
        filteredTxs,
        allTxsForChequePairing: mergedTransactions,
        expenseMode,
        materialSpentExtra,
        projectIdFilter: filters.projectId,
      }),
    [
      rawProjects,
      rawBoqItems,
      rawContracts,
      rawBilling,
      filteredTxs,
      mergedTransactions,
      expenseMode,
      materialSpentExtra,
      filters.projectId,
    ],
  );

  const previousStats = useMemo(
    () =>
      computeDashboardPeriodStats({
        projects: rawProjects ?? [],
        boqItems: rawBoqItems ?? [],
        contracts: rawContracts ?? [],
        billing: rawBilling ?? [],
        filteredTxs: prevFilteredTxs,
        allTxsForChequePairing: mergedTransactions,
        expenseMode,
        materialSpentExtra: prevMaterialSpentExtra,
        projectIdFilter: filters.projectId,
      }),
    [
      rawProjects,
      rawBoqItems,
      rawContracts,
      rawBilling,
      prevFilteredTxs,
      mergedTransactions,
      expenseMode,
      prevMaterialSpentExtra,
      filters.projectId,
    ],
  );

  const chartData = useMemo(
    () =>
      buildMonthlySeries(
        filteredTxs,
        mergedTransactions,
        locale,
        expenseMode,
        materialsByMonth,
      ),
    [filteredTxs, mergedTransactions, locale, expenseMode, materialsByMonth],
  );

  /**
   * Cash-flow area chart: each month’s own total (not a running sum), starting
   * from zero. Idle months are `null` so `connectNulls` carries the line to the
   * next movement (e.g. 0 → 150k → 100k when month 2 is lower than month 1).
   */
  const cashFlowData = useMemo(
    () =>
      buildCashFlowSeries(filteredTxs, mergedTransactions, locale, expenseMode, {
        grain: 'month',
        materialByPeriod: materialsByMonth,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        includeOrigin: true,
        originLabel: t('cash_flow_origin'),
      }),
    [
      filteredTxs,
      mergedTransactions,
      locale,
      expenseMode,
      materialsByMonth,
      filters.dateFrom,
      filters.dateTo,
      t,
    ],
  );

  /** Dots only while the window is short enough to stay readable. */
  const cashFlowDots = cashFlowData.length <= 45;

  const compareRows = useMemo(
    () =>
      buildProjectCompareRows({
        projects: (rawProjects ?? []).map((p) => ({
          id: p.id,
          projectName: p.projectName,
          boqValue: (p as Project & { boqValue?: number }).boqValue,
          voValue: (p as Project & { voValue?: number }).voValue,
        })),
        boqItems: rawBoqItems ?? [],
        contracts: rawContracts ?? [],
        billing: rawBilling ?? [],
        filteredTxs,
        allTxsForChequePairing: mergedTransactions,
        expenseMode,
        projectIdFilter: filters.projectId,
        contractIdFilter: filters.contractId,
        mosClaims,
        materialByProject: materialsByProject,
        unallocatedLabel: t('dashboard_unallocated_costs'),
      }),
    [
      rawProjects,
      rawBoqItems,
      rawContracts,
      rawBilling,
      filteredTxs,
      mergedTransactions,
      expenseMode,
      filters.projectId,
      filters.contractId,
      mosClaims,
      materialsByProject,
      t,
    ],
  );

  const pieSlices = useMemo(
    () =>
      buildContractProgressPieSlices({
        projects: (rawProjects ?? []).map((p) => ({
          id: p.id,
          projectName: p.projectName,
          voValue: (p as Project & { voValue?: number }).voValue,
        })),
        boqItems: (rawBoqItems ?? []).map((b) => ({
          projectId: b.projectId,
          contractId: b.contractId,
          tenderAmount: b.tenderAmount,
          isDeleted: b.isDeleted,
        })),
        contracts: rawContracts ?? [],
        billing: rawBilling ?? [],
        filteredTxs,
        projectIdFilter: filters.projectId,
        mosClaims,
      }),
    [rawProjects, rawBoqItems, rawContracts, rawBilling, filteredTxs, filters.projectId, mosClaims],
  );

  const handleRefresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  const handlePreset = useCallback((preset: DashboardDatePreset) => {
    const range = resolveDatePreset(preset);
    setFilters((prev) => ({
      ...prev,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo || prev.dateTo,
    }));
    setFocusMonth('');
  }, []);

  const handleSort = useCallback(
    (key: ProjectCompareSortKey) => {
      if (key === sortKey) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortKey(key);
        setSortDir(key === 'projectName' ? 'asc' : 'desc');
      }
    },
    [sortKey],
  );

  const panelCls = cn(
    'border p-6 rounded-xl transition-colors',
    theme === 'dark'
      ? 'bg-[#0b0c0e] border-gray-800'
      : theme === 'soft'
        ? 'bg-white border-[#cfd8dc]'
        : 'bg-white border-gray-200 shadow-sm',
  );

  const tooltipStyle = {
    backgroundColor: theme === 'dark' ? '#111827' : '#ffffff',
    border: theme === 'dark' ? '1px solid #374151' : '1px solid #cfd8dc',
    borderRadius: '12px',
    fontSize: '12px',
  };

  const chartTooltipFormatter = useCallback(
    (value: number | string | null | undefined, name: string) => {
      if (value == null || value === '') return ['—', name];
      const n = Number(value);
      if (!Number.isFinite(n)) return ['—', name];
      return [formatMoney(n), name];
    },
    [formatMoney],
  );

  const statCards = [
    {
      id: 'budget' as const,
      label: t('total_contracts'),
      value: currentStats.totalBudget,
      icon: DollarSign,
      color: 'text-blue-500',
      delta: percentDelta(currentStats.totalBudget, previousStats.totalBudget),
      metric: null as FocusMetric,
      invert: false,
    },
    {
      id: 'spent' as const,
      label: t('actual_costs'),
      value: currentStats.totalSpent,
      icon: TrendingDown,
      color: 'text-red-500',
      delta: percentDelta(currentStats.totalSpent, previousStats.totalSpent),
      metric: 'cost' as FocusMetric,
      invert: true,
    },
    {
      id: 'collected' as const,
      label: t('cash_collections'),
      value: currentStats.totalCollected,
      icon: TrendingUp,
      color: 'text-green-500',
      delta: percentDelta(currentStats.totalCollected, previousStats.totalCollected),
      metric: 'collections' as FocusMetric,
      invert: false,
    },
    {
      id: 'pending' as const,
      label: t('pending_billing'),
      value: currentStats.pendingBilling,
      icon: Clock,
      color: 'text-yellow-500',
      delta: percentDelta(currentStats.pendingBilling, previousStats.pendingBilling),
      metric: null as FocusMetric,
      invert: true,
    },
    {
      id: 'cash' as const,
      label: t('dashboard_kpi_cash_banks'),
      value: currentStats.cashBanks,
      icon: Landmark,
      color: 'text-emerald-500',
      delta: percentDelta(currentStats.cashBanks, previousStats.cashBanks),
      metric: null as FocusMetric,
      invert: false,
    },
  ];

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-500 p-8 text-center">
        <Loader2 className="animate-spin text-blue-500 mb-4" size={48} />
        <p>{t('aggregating_data')}</p>
      </div>
    );
  }

  const lineOpacity = (key: 'cost' | 'revenue' | 'collections') =>
    !focusMetric || focusMetric === key ? 1 : 0.25;

  return (
    <div
      className={cn(
        'p-4 md:p-6 min-h-screen transition-colors',
        theme === 'dark'
          ? 'bg-[#0a0a0a] text-gray-100'
          : theme === 'soft'
            ? 'bg-[#eceff1] text-[#37474f]'
            : 'bg-gray-50 text-gray-900',
      )}
    >
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <DashboardFilterBar
          filters={filters}
          onChange={(next) => {
            setFilters(next);
            setFocusMonth('');
          }}
          onPreset={handlePreset}
          projects={rawProjects ?? []}
          contracts={rawContracts ?? []}
          theme={theme}
          language={language}
          t={t}
        />

        <div className="flex-1 min-w-0 space-y-6">
          <header className="flex flex-wrap justify-between items-end gap-4">
            <div>
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight">{t('portfolio_subtitle')}</h2>
              {isLocalBackend && canViewDashboard && (
                <p className="text-xs text-amber-600/80 mt-2">
                  {language === 'ar'
                    ? `Postgres: ${mergedTransactions.length} قيد · ${rawProjects.length} مشروع · نطاق ${filteredTxs.length}`
                    : `Postgres: ${mergedTransactions.length} entries · ${rawProjects.length} projects · scoped ${filteredTxs.length}`}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={handleRefresh}
              className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-md text-sm font-medium transition-colors text-white flex items-center gap-2"
            >
              {loading && <Loader2 className="animate-spin" size={16} />}
              {t('refresh_data')}
            </button>
          </header>

          {transactionsCapped && (
            <p
              className={cn(
                'text-xs rounded-lg px-3 py-2 border',
                theme === 'dark'
                  ? 'border-amber-700/60 bg-amber-950/30 text-amber-200'
                  : 'border-amber-200 bg-amber-50 text-amber-900',
              )}
              role="status"
            >
              {language === 'ar'
                ? `تم احتساب المؤشرات أدناه من أحدث ${formatNumber(LISTENER_LIQUIDITY_KPI_GL_CAP)} قيود يومية فقط؛ قد لا تعكس كل التاريخ المحاسبي.`
                : `Figures below are based on up to ${formatNumber(LISTENER_LIQUIDITY_KPI_GL_CAP)} most recent journal rows only.`}
            </p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
            {statCards.map((stat, i) => (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                key={stat.id}
                role={stat.metric ? 'button' : undefined}
                tabIndex={stat.metric ? 0 : undefined}
                onClick={() => {
                  if (!stat.metric) return;
                  setFocusMetric((m) => (m === stat.metric ? null : stat.metric));
                }}
                onKeyDown={(e) => {
                  if (!stat.metric) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setFocusMetric((m) => (m === stat.metric ? null : stat.metric));
                  }
                }}
                className={cn(
                  'border p-5 rounded-xl transition-all',
                  theme === 'dark'
                    ? 'bg-[#151619] border-gray-800 hover:border-gray-700'
                    : theme === 'soft'
                      ? 'bg-white border-[#cfd8dc] hover:border-[#546e7a]'
                      : 'bg-white border-gray-200 hover:border-blue-200 shadow-sm',
                  stat.metric && focusMetric === stat.metric && 'ring-2 ring-blue-500/60',
                  stat.metric && 'cursor-pointer',
                )}
              >
                <div className="flex justify-between items-start">
                  <div
                    className={cn(
                      'p-2 rounded-lg',
                      theme === 'dark' ? 'bg-gray-900' : theme === 'soft' ? 'bg-[#eceff1]' : 'bg-gray-50',
                      stat.color,
                    )}
                  >
                    <stat.icon size={22} />
                  </div>
                  <DeltaBadge delta={stat.delta} invertColors={stat.invert} />
                </div>
                <div className="mt-3">
                  <p className="text-sm text-gray-400 font-medium">{stat.label}</p>
                  <h3 className="text-xl font-bold mt-1">
                    {formatMoney(stat.value)}{' '}
                    <span className="text-xs font-normal text-gray-500">{t('currency')}</span>
                  </h3>
                  <p className="text-[10px] text-gray-500 mt-1">{t('dashboard_vs_previous')}</p>
                </div>
              </motion.div>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className={panelCls}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-base font-bold flex items-center gap-2">
                  <BarChart3 className="text-blue-500" size={18} />
                  {t('dashboard_monthly_chart')}
                </h3>
              </div>
              <div className="h-[280px] w-full min-h-[280px]">
                <ResponsiveChart>
                  <BarChart
                    data={chartData}
                    margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                    onClick={(state) => {
                      const label = (state as { activeLabel?: string } | null)?.activeLabel;
                      if (!label) return;
                      const point = chartData.find((p) => p.name === label);
                      if (point) setFocusMonth(point.key);
                    }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={theme === 'dark' ? '#1f2937' : '#e5e7eb'}
                      opacity={0.4}
                    />
                    <XAxis
                      dataKey="name"
                      stroke="#4b5563"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      reversed={language === 'ar'}
                    />
                    <YAxis
                      stroke="#4b5563"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => `${value / 1000}k`}
                      orientation={language === 'ar' ? 'right' : 'left'}
                    />
                    <Tooltip contentStyle={tooltipStyle} formatter={chartTooltipFormatter} />
                    <Legend verticalAlign="top" height={28} iconType="circle" />
                    <Bar
                      name={t('chart_costs')}
                      dataKey="cost"
                      fill="#ef4444"
                      opacity={lineOpacity('cost')}
                      radius={[4, 4, 0, 0]}
                    >
                      {chartData.map((entry) => (
                        <Cell
                          key={entry.key}
                          fill={focusMonth === entry.key ? '#f87171' : '#ef4444'}
                        />
                      ))}
                    </Bar>
                    <Bar
                      name={t('chart_revenue')}
                      dataKey="revenue"
                      fill="#3b82f6"
                      opacity={lineOpacity('revenue')}
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      name={t('chart_collections')}
                      dataKey="collections"
                      fill="#10b981"
                      opacity={lineOpacity('collections')}
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveChart>
              </div>
            </div>

            <div className={panelCls}>
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-base font-bold flex items-center gap-2">
                    <BarChart3 className="text-blue-500" size={18} />
                    {t('cash_flow_analysis')}
                  </h3>
                  <p className="text-[11px] text-gray-500 mt-1">{t('cash_flow_monthly_hint')}</p>
                </div>
              </div>
              <div className="h-[280px] w-full min-h-[280px]">
                <ResponsiveChart>
                  <AreaChart
                    data={cashFlowData}
                    margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                    onClick={(state) => {
                      const label = (state as { activeLabel?: string } | null)?.activeLabel;
                      if (!label) return;
                      const point = cashFlowData.find((p) => p.name === label);
                      if (point && point.key !== '__start__') setFocusMonth(point.key);
                    }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={theme === 'dark' ? '#1f2937' : '#e5e7eb'}
                      opacity={0.4}
                    />
                    <XAxis
                      dataKey="name"
                      stroke="#4b5563"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      reversed={language === 'ar'}
                      interval="preserveStartEnd"
                      minTickGap={28}
                    />
                    <YAxis
                      stroke="#4b5563"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => `${value / 1000}k`}
                      orientation={language === 'ar' ? 'right' : 'left'}
                    />
                    <Tooltip contentStyle={tooltipStyle} formatter={chartTooltipFormatter} />
                    <Legend verticalAlign="top" height={28} iconType="circle" />
                    <Area
                      type="natural"
                      name={t('chart_costs')}
                      dataKey="cost"
                      stroke="#ef4444"
                      fill="#ef4444"
                      fillOpacity={0.12}
                      strokeWidth={2.5}
                      strokeOpacity={lineOpacity('cost')}
                      connectNulls
                      dot={cashFlowDots ? { r: 4, fill: '#ef4444', strokeWidth: 0 } : false}
                      activeDot={{ r: 6 }}
                    />
                    <Area
                      type="natural"
                      name={t('chart_revenue')}
                      dataKey="revenue"
                      stroke="#3b82f6"
                      fill="#3b82f6"
                      fillOpacity={0.12}
                      strokeWidth={2.5}
                      strokeOpacity={lineOpacity('revenue')}
                      connectNulls
                      dot={cashFlowDots ? { r: 4, fill: '#3b82f6', strokeWidth: 0 } : false}
                      activeDot={{ r: 6 }}
                    />
                    <Area
                      type="natural"
                      name={t('chart_collections')}
                      dataKey="collections"
                      stroke="#10b981"
                      fill="#10b981"
                      fillOpacity={0.12}
                      strokeWidth={2.5}
                      strokeOpacity={lineOpacity('collections')}
                      connectNulls
                      dot={cashFlowDots ? { r: 4, fill: '#10b981', strokeWidth: 0 } : false}
                      activeDot={{ r: 6 }}
                    />
                  </AreaChart>
                </ResponsiveChart>
              </div>
            </div>

            <div className={panelCls}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-base font-bold flex items-center gap-2">
                  <PieChartIcon className="text-blue-500" size={18} />
                  {t('dashboard_pie_completed_share')}
                </h3>
              </div>
              <div className="h-[320px] w-full min-h-[320px]">
                <DashboardPie3D
                  slices={pieSlices}
                  selectedContractId={filters.contractId}
                  onSelectContract={(contractId, projectId) => {
                    setFilters((prev) => ({
                      ...prev,
                      projectId: contractId ? projectId : prev.projectId,
                      contractId,
                    }));
                    setFocusMonth('');
                  }}
                  theme={theme}
                  language={language}
                  t={t}
                  formatMoney={formatMoney}
                />
              </div>
            </div>
          </div>

          <ProjectCompareTable
            rows={compareRows}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={handleSort}
            selectedProjectId={filters.projectId}
            onSelectProject={(projectId) => {
              if (projectId === DASHBOARD_UNALLOCATED_PROJECT_ID) return;
              setFilters((prev) => ({ ...prev, projectId, contractId: '' }));
              setFocusMonth('');
            }}
            theme={theme}
            language={language}
            t={t}
            formatMoney={formatMoney}
          />
        </div>
      </div>
    </div>
  );
}
