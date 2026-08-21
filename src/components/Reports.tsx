import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useErpModuleDraft, useErpModuleView } from '../hooks/useErpModuleView';
import { collection, query, orderBy, limit, doc, getDoc, setDoc, updateDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { ApiError } from '../lib/apiClient';
import { useFirestoreQuery } from '../hooks/useFirestoreQuery';
import { useApiQuery } from '../hooks/useApiQuery';
import { motion, AnimatePresence } from 'motion/react';
import { cn, listKey, normalizeDate } from '../lib/utils';
import { tenderAmountExcludingProfit, BOQ_DEFAULT_PROFIT_PCT } from '../lib/boqPricing';
import { PrintReportHeader } from './print/PrintReportHeader';
import { useLanguage } from '../context/LanguageContext';
import { displayLocale } from '../lib/numberLocale';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import { JournalEntry, AccountCodes } from '../services/accountingService';
import type { Transaction as GlTransaction, BillingRecord } from '../types';
import { isLocalBackend } from '../lib/dataBackend';
import { sumTransactionOperatingExpense } from '../lib/operatingExpenseFromGl';
import {
  buildIncomeStatementTotals,
  entryMatchesProjectFilter,
  isExcludedFromIncomeStatement,
  transactionMatchesProjectFilter,
} from '../lib/incomeStatementGl';
import { resolveEntryCostCenterId, transactionMatchesCostCenterFilter } from '../lib/costCenterAttribution';
import { inventoryApi, glApi, projectsApi, contractsApi, boqApi, billingApi, chartOfAccountsApi, costCentersApi, reportsApi, settingsApi, type BoqCostLevel } from '../services/local/modulesApi';
import { buildCostCenterTypeMap, computeDirectIndirectCostSplit } from '../lib/costCenterCostSplit';
import { SearchableSelect } from './ui/SearchableSelect';
import { 
  TrendingUp,
  PieChart as PieChartIcon,
  Download,
  Loader2,
  Printer,
  FileText,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  Calculator,
  Building2,
  ChevronRight,
  ChevronLeft,
  Clock
} from 'lucide-react';
import {
  LISTENER_LIQUIDITY_KPI_GL_CAP,
  LISTENER_REPORTS_TRANSACTIONS_CAP,
} from '../constants/dataLimits';
import { useUserAccessScope } from '../hooks/useUserAccessScope';
import { PROJECT_WAREHOUSE_PARENT } from '../lib/projectWarehouse';
import {
  cashAndBankBalanceFromGlTxs,
  computeLiquidityContractRow,
  contractCountByProject,
} from '../lib/liquidityMetrics';
import { LiquidityReport } from './LiquidityReport';
import { BoqCostBreakdownReport } from './reports/BoqCostBreakdownReport';
import { BudgetVsActualReport } from './reports/BudgetVsActualReport';
import { ReportFormatToolbar } from './reports/ReportFormatToolbar';
import { buildBudgetVsActualRows, type BudgetDetailLevel } from '../lib/budgetVsActual';
import {
  buildReportsModuleDocument,
  openReportDocument,
} from '../lib/reportDocument';
import {
  buildBalanceSheetPrintRows,
  buildIncomeStatementPrintRows,
  buildSchedulePrintRows,
} from '../lib/reportDocument/buildAnalyticalPrintRows';
import {
  PRINT_FONT_CSS,
  PRINT_MARGIN_CSS,
  resolvePrintTextDir,
  resolveReportPrintProfile,
  type ReportPrintProfile,
  type StoredReportPrintProfiles,
} from '../lib/reportPrintProfiles';
import { canPersistUserPreferences } from '../lib/userPreferences';
import { ManualHelpButton } from './help/ManualHelpButton';
import type { ManualTopicId } from '../lib/operationsManual';

type ReportTabId = 'income' | 'budget' | 'balance' | 'trial' | 'time' | 'liquidity' | 'costs';

export interface ReportsDraft {
  activeReport: ReportTabId;
}

function isReportTabId(value: string): value is ReportTabId {
  return (
    value === 'income' ||
    value === 'budget' ||
    value === 'balance' ||
    value === 'trial' ||
    value === 'time' ||
    value === 'liquidity' ||
    value === 'costs'
  );
}

/** Legacy ERP/draft view id `overview` → income. */
function normalizeReportTabId(value: string): ReportTabId | null {
  if (value === 'overview') return 'income';
  return isReportTabId(value) ? value : null;
}

function resolveReportsTabTopic(tab: ReportTabId): ManualTopicId {
  const map: Record<ReportTabId, ManualTopicId> = {
    income: 'reports.income',
    budget: 'reports.budget',
    balance: 'reports.balance',
    trial: 'reports.trial',
    time: 'reports.time',
    liquidity: 'reports.liquidity',
    costs: 'reports.costs',
  };
  return map[tab];
}

function reportPrintTitle(tab: ReportTabId, language: 'ar' | 'en'): string {
  const titles: Record<ReportTabId, { ar: string; en: string }> = {
    income: { ar: 'قائمة الدخل', en: 'Income Statement' },
    budget: { ar: 'مقارنة الميزانية بالتكاليف', en: 'Budget vs Actual Report' },
    balance: { ar: 'الميزانية العمومية', en: 'Balance Sheet' },
    trial: { ar: 'ميزان المراجعة التحليلي', en: 'Analytical Trial Balance' },
    time: { ar: 'الجدول الزمني للمشاريع', en: 'Project Schedule' },
    liquidity: { ar: 'تقرير السيولة', en: 'Liquidity Report' },
    costs: { ar: 'تكاليف BOQ', en: 'BOQ Costs' },
  };
  return language === 'ar' ? titles[tab].ar : titles[tab].en;
}
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  PieChart, 
  Pie, 
  Cell,
  Legend,
  LineChart,
  Line
} from 'recharts';
import { ResponsiveChart } from './charts/ResponsiveChart';

interface Project {
  id: string;
  projectName: string;
  projectCode: string;
  totalContractValue: number;
  boqValue?: number;
  voValue?: number;
}

interface BillingIpcLine {
  boqItemId?: string;
  currentQty?: number;
  totalQty?: number;
  previousQty?: number;
}

interface Billing {
  id: string;
  projectId: string;
  contractId?: string;
  netPayable: number;
  worksValueExVat?: number;
  status: string;
  date: string | { toDate(): Date } | Date;
  items?: BillingIpcLine[];
  /** نهائي معتمد = إظهار اكتمال الأعمال في التقارير */
  ipcKind?: 'interim' | 'final';
  isDeleted?: boolean;
}

const IPC_COUNTABLE_STATUSES = new Set(['submitted', 'approved', 'paid']);

/** مستخلص نهائي بحالة معتمدة يُظهر اكتمالاً في التقارير */
function isFinalIpcForReports(b: Billing): boolean {
  return (
    b.ipcKind === 'final' &&
    IPC_COUNTABLE_STATUSES.has(b.status) &&
    b.isDeleted !== true
  );
}

function contractClosedByFinalIpc(contractId: string | undefined, billings: Billing[]): boolean {
  if (!contractId) return false;
  return billings.some((b) => b.contractId === contractId && isFinalIpcForReports(b));
}

function parseBillingDate(b: Billing): number {
  const d = b?.date;
  if (!d) return 0;
  if (typeof d === 'string') return new Date(d).getTime() || 0;
  if (d instanceof Date) return d.getTime();
  if (typeof (d as { toDate?: () => Date }).toDate === 'function') {
    return (d as { toDate: () => Date }).toDate().getTime();
  }
  return 0;
}

function lineExecutedQty(row: BillingIpcLine): number {
  if (row.totalQty != null) {
    const n = Number(row.totalQty);
    return Number.isFinite(n) ? n : 0;
  }
  return (Number(row.previousQty || 0) + Number(row.currentQty || 0)) || 0;
}

function isCountableIpcStatus(status: string): boolean {
  return IPC_COUNTABLE_STATUSES.has(status);
}

const INVENTORY127_AGG_CODE = PROJECT_WAREHOUSE_PARENT;

type TrialBalanceRow = {
  code: string;
  name: string;
  openingDebit: number;
  openingCredit: number;
  debitMovements: number;
  creditMovements: number;
  closingDebit: number;
  closingCredit: number;
  isInventory127Aggregate?: boolean;
};

function isInventory127AccountCode(code: string): boolean {
  return String(code).trim().startsWith(INVENTORY127_AGG_CODE);
}

function splitNetToDebitCredit(net: number): { debit: number; credit: number } {
  const n = Number(net) || 0;
  return { debit: n > 0 ? n : 0, credit: n < 0 ? -n : 0 };
}

/** Roll all 127… warehouse leaves into one trial-balance line. */
function aggregateTrialBalanceInventory127(rows: TrialBalanceRow[], language: 'ar' | 'en'): TrialBalanceRow[] {
  const invRows = rows.filter((r) => isInventory127AccountCode(r.code));
  if (invRows.length === 0) return rows;
  const rest = rows.filter((r) => !isInventory127AccountCode(r.code));
  const sum = (key: keyof Pick<TrialBalanceRow, 'openingDebit' | 'openingCredit' | 'debitMovements' | 'creditMovements' | 'closingDebit' | 'closingCredit'>) =>
    invRows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
  const closingNet = sum('closingDebit') - sum('closingCredit');
  const closingSplit = splitNetToDebitCredit(closingNet);
  const agg: TrialBalanceRow = {
    code: INVENTORY127_AGG_CODE,
    name: language === 'ar' ? 'مخزون المشاريع (127)' : 'Project Inventory (127)',
    openingDebit: sum('openingDebit'),
    openingCredit: sum('openingCredit'),
    debitMovements: sum('debitMovements'),
    creditMovements: sum('creditMovements'),
    closingDebit: closingSplit.debit,
    closingCredit: closingSplit.credit,
    isInventory127Aggregate: true,
  };
  const hasBalance =
    agg.openingDebit > 0 ||
    agg.openingCredit > 0 ||
    agg.debitMovements > 0 ||
    agg.creditMovements > 0 ||
    agg.closingDebit > 0 ||
    agg.closingCredit > 0;
  if (!hasBalance) return rows;
  return [...rest, agg].sort((a, b) => a.code.localeCompare(b.code));
}

function getExecutedQtyFromBillings(
  item: BOQItem,
  latestIpcByContract: Map<string, Billing>,
  billings: Billing[],
): number {
  const cid = item.contractId;
  if (!cid) return 0;
  if (contractClosedByFinalIpc(cid, billings)) {
    return item.tenderQty ?? 0;
  }
  const latest = latestIpcByContract.get(cid);
  if (latest?.items?.length) {
    const row = latest.items.find((i) => i.boqItemId === item.id);
    if (row) return lineExecutedQty(row);
  }
  let sum = 0;
  for (const b of billings) {
    if (b.contractId !== cid) continue;
    if (!isCountableIpcStatus(b.status)) continue;
    const row = b.items?.find((i) => i.boqItemId === item.id);
    if (row) sum += Number(row.currentQty || 0);
  }
  return sum;
}

interface BOQItem {
  id: string;
  projectId: string;
  contractId?: string;
  tenderAmount: number;
  tenderQty?: number;
  rateMaterials?: number;
  rateLabour?: number;
  rateEquipment?: number;
  rateOverheadPct?: number;
  rateProfitPct?: number;
  unitRateTotal?: number;
  startDate?: string;
  expectedDuration?: number;
  itemCode: string;
  description: string;
}

interface Contract {
  id: string;
  projectId: string;
  contractName: string;
  contractNumber: string;
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

type ApiBillingRow = Billing & {
  items?: Array<{
    boqItemId?: string;
    currentQty?: number;
    totalQty?: number;
    previousQty?: number;
  }>;
};

function normalizeReportsBilling(row: ApiBillingRow): Billing {
  return {
    id: String(row.id),
    projectId: String(row.projectId ?? ''),
    contractId: row.contractId ? String(row.contractId) : undefined,
    netPayable: Number(row.netPayable ?? 0),
    worksValueExVat: row.worksValueExVat != null ? Number(row.worksValueExVat) : undefined,
    status: String(row.status ?? ''),
    date: row.date ?? '',
    items: row.items?.map((item) => ({
      boqItemId: item.boqItemId,
      currentQty: item.currentQty != null ? Number(item.currentQty) : undefined,
      totalQty: item.totalQty != null ? Number(item.totalQty) : undefined,
      previousQty: item.previousQty != null ? Number(item.previousQty) : undefined,
    })),
    ipcKind: row.ipcKind,
    isDeleted: row.isDeleted === true,
  };
}

function normalizeReportsBoq(
  row: BOQItem & { tenderQty?: number; unitRateTotal?: number },
  index = 0,
): BOQItem {
  const rawId = String(row.id ?? '').trim();
  const itemCode = String(row.itemCode ?? '');
  return {
    id: rawId || `boq-${String(row.contractId ?? '')}-${itemCode || index}-${index}`,
    projectId: String(row.projectId ?? ''),
    contractId: row.contractId ? String(row.contractId) : undefined,
    tenderAmount: Number(row.tenderAmount ?? 0),
    tenderQty: Number(row.tenderQty ?? 0),
    unitRateTotal: Number(row.unitRateTotal ?? 0),
    startDate: row.startDate,
    expectedDuration: row.expectedDuration,
    itemCode: String(row.itemCode ?? ''),
    description: String(row.description ?? ''),
    rateMaterials: row.rateMaterials,
    rateLabour: row.rateLabour,
    rateEquipment: row.rateEquipment,
    rateOverheadPct: row.rateOverheadPct,
    rateProfitPct: row.rateProfitPct,
  };
}

export function Reports() {
  const { t, language, theme, dir, locale, formatMoney } = useLanguage();
  const { isProjectAccountant, assignedContractIds } = useUserAccessScope();
  const { isErpShell, activeViewId, erp } = useErpModuleView('reports', 'income');
  const draftHydrated = useRef(false);

  const [activeReport, setActiveReport] = useState<ReportTabId>('income');
  const [showCharts, setShowCharts] = useState(false);
  const [showAnalytical, setShowAnalytical] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('all');
  const [selectedContractId, setSelectedContractId] = useState<string>('all');
  const [costLevel, setCostLevel] = useState<BoqCostLevel>('boq_item');
  const [budgetLevel, setBudgetLevel] = useState<BudgetDetailLevel>('project');
  const [costDateFrom, setCostDateFrom] = useState('');
  const [costDateTo, setCostDateTo] = useState('');
  /** Material issued to BOQ (SQLite) per contract — replaces legacy purchase-invoice class-5 in local mode */
  const [boqMaterialByContract, setBoqMaterialByContract] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    if (!isErpShell || !erp || draftHydrated.current) return;
    const saved = erp.getModuleDraft<ReportsDraft>('reports');
    if (saved?.activeReport) {
      const tab = normalizeReportTabId(saved.activeReport);
      if (tab) setActiveReport(tab);
    }
    draftHydrated.current = true;
  }, [isErpShell, erp]);

  useEffect(() => {
    if (!isErpShell) return;
    const tab = normalizeReportTabId(activeViewId);
    if (tab) setActiveReport(tab);
  }, [activeViewId, isErpShell]);

  useErpModuleDraft('reports', { activeReport }, isErpShell, erp);

  // Conditional flags for live listeners (liquidity tab loads billing/GL when charts are on)
  const needBillings  = activeReport === 'income' || activeReport === 'budget' || activeReport === 'time' || (activeReport === 'liquidity' && showCharts);
  const needTx        = activeReport !== 'time' && activeReport !== 'costs' && (activeReport !== 'liquidity' || showCharts);

  const { data: fsProjects, loading: fsProjectsLoading } = useFirestoreQuery<Project>(
    () => (!isLocalBackend ? query(collection(db, 'projects'), where('isDeleted', '==', false)) : null),
    [isLocalBackend],
    { mode: 'once', collectionName: 'projects' },
  );
  const { data: apiProjects, loading: apiProjectsLoading, error: apiProjectsError } = useApiQuery<Project>(
    async () => {
      const rows = await projectsApi.list();
      return rows
        .filter((p) => !p.isDeleted)
        .map((p) => ({
          id: p.id,
          projectName: p.projectName,
          projectCode: p.projectCode,
          totalContractValue: Number((p as { totalContractValue?: number }).totalContractValue || 0),
          voValue: Number((p as { voValue?: number }).voValue || 0),
          boqValue: Number((p as { boqValue?: number }).boqValue || 0),
        }));
    },
    [isLocalBackend],
    { enabled: isLocalBackend },
  );
  const projects = isLocalBackend ? apiProjects : (fsProjects ?? []);

  const { data: fsContracts, loading: fsContractsLoading } = useFirestoreQuery<Contract>(
    () => (!isLocalBackend ? query(collection(db, 'contracts'), where('isDeleted', '!=', true)) : null),
    [isLocalBackend],
    { mode: 'once', collectionName: 'contracts' },
  );
  const { data: apiContracts, loading: apiContractsLoading, error: apiContractsError } = useApiQuery<Contract>(
    async () => {
      const rows = (await contractsApi.list()) as Contract[];
      return rows.filter((c) => c.isDeleted !== true);
    },
    [isLocalBackend],
    { enabled: isLocalBackend },
  );
  const contracts = isLocalBackend ? apiContracts : (fsContracts ?? []);

  const { data: fsAccounts, loading: fsAccountsLoading } = useFirestoreQuery(
    () => (!isLocalBackend ? (collection(db, 'chart_of_accounts') as ReturnType<typeof collection>) : null),
    [isLocalBackend],
    { mode: 'once', collectionName: 'chart_of_accounts' },
  );
  const { data: apiAccounts, loading: apiAccountsLoading, error: apiAccountsError } = useApiQuery<Record<string, unknown>>(
    () => chartOfAccountsApi.list() as Promise<Record<string, unknown>[]>,
    [isLocalBackend],
    { enabled: isLocalBackend },
  );
  const accounts = isLocalBackend ? apiAccounts : (fsAccounts ?? []);

  const { data: fsBoqItems, loading: fsBoqLoading } = useFirestoreQuery<BOQItem>(
    () => (!isLocalBackend ? query(collection(db, 'boq_items'), where('isDeleted', '!=', true)) : null),
    [isLocalBackend],
    { mode: 'once', collectionName: 'boq_items' },
  );
  const { data: apiBoqItems, loading: apiBoqLoading, error: apiBoqError } = useApiQuery<BOQItem>(
    async () => {
      const rows = await boqApi.list();
      return rows.filter((r) => r.isDeleted !== true).map((r, idx) => normalizeReportsBoq(r, idx));
    },
    [isLocalBackend],
    { enabled: isLocalBackend },
  );
  const boqItems = isLocalBackend ? apiBoqItems : (fsBoqItems ?? []);

  const { data: fsBillings } = useFirestoreQuery<Billing>(
    () =>
      !isLocalBackend && needBillings
        ? query(collection(db, 'billing'), where('isDeleted', '==', false))
        : null,
    [needBillings, isLocalBackend],
    { mode: 'snapshot', collectionName: 'billing' },
  );
  const { data: apiBillings, error: apiBillingsError } = useApiQuery<Billing>(
    async () => {
      const rows = (await billingApi.list()) as ApiBillingRow[];
      return rows.filter((r) => r.isDeleted !== true).map(normalizeReportsBilling);
    },
    [needBillings, isLocalBackend],
    { enabled: isLocalBackend && needBillings },
  );
  const billings = isLocalBackend ? apiBillings : (fsBillings ?? []);

  const { data: fsTransactions } = useFirestoreQuery(
    () =>
      !isLocalBackend && needTx
        ? query(
            collection(db, 'transactions'),
            where('isDeleted', '==', false),
            orderBy('date', 'desc'),
            limit(LISTENER_REPORTS_TRANSACTIONS_CAP),
          )
        : null,
    [needTx, isLocalBackend],
    { mode: 'snapshot', collectionName: 'transactions' },
  );
  const { data: apiTransactions, error: apiTxError } = useApiQuery<GlTransaction>(
    () => glApi.transactions(undefined, LISTENER_REPORTS_TRANSACTIONS_CAP),
    [needTx, isLocalBackend],
    { enabled: isLocalBackend && needTx },
  );
  const transactions: GlTransaction[] = isLocalBackend
    ? apiTransactions
    : ((fsTransactions ?? []) as GlTransaction[]);

  const { data: apiCostCenters } = useApiQuery<{ id: string; type: 'direct' | 'indirect' }>(
    () => costCentersApi.list(),
    [isLocalBackend],
    { enabled: isLocalBackend && needTx },
  );
  const costCenterTypeMap = useMemo(
    () => buildCostCenterTypeMap(apiCostCenters ?? []),
    [apiCostCenters],
  );

  useEffect(() => {
    if (apiProjectsError) apiLoadErrorToast(apiProjectsError, language, language === 'ar' ? 'المشاريع' : 'projects');
  }, [apiProjectsError, language]);
  useEffect(() => {
    if (apiContractsError) apiLoadErrorToast(apiContractsError, language, language === 'ar' ? 'العقود' : 'contracts');
  }, [apiContractsError, language]);
  useEffect(() => {
    if (apiAccountsError) apiLoadErrorToast(apiAccountsError, language, language === 'ar' ? 'شجرة الحسابات' : 'chart of accounts');
  }, [apiAccountsError, language]);
  useEffect(() => {
    if (apiBoqError) apiLoadErrorToast(apiBoqError, language, language === 'ar' ? 'بنود BOQ' : 'BOQ items');
  }, [apiBoqError, language]);
  useEffect(() => {
    if (apiBillingsError) apiLoadErrorToast(apiBillingsError, language, language === 'ar' ? 'المستخلصات' : 'billing');
  }, [apiBillingsError, language]);
  useEffect(() => {
    if (apiTxError) apiLoadErrorToast(apiTxError, language, language === 'ar' ? 'قيود اليومية' : 'journal entries');
  }, [apiTxError, language]);

  const loading = isLocalBackend
    ? apiProjectsLoading || apiContractsLoading || apiAccountsLoading || apiBoqLoading
    : fsProjectsLoading || fsContractsLoading || fsAccountsLoading || fsBoqLoading;
  const [periodStart, setPeriodStart] = useState(() => `${new Date().getFullYear()}-01-01`);
  const printAreaRef = useRef<HTMLDivElement>(null);
  const allowedContractSet = useMemo(() => new Set(assignedContractIds), [assignedContractIds]);
  const scopedContracts = useMemo(
    () => (isProjectAccountant ? contracts.filter((c) => allowedContractSet.has(String(c.id))) : contracts),
    [isProjectAccountant, contracts, allowedContractSet]
  );
  const scopedProjectSet = useMemo(
    () => new Set(scopedContracts.map((c) => String(c.projectId))),
    [scopedContracts]
  );
  const scopedProjects = useMemo(
    () => (isProjectAccountant ? projects.filter((p) => scopedProjectSet.has(String(p.id))) : projects),
    [isProjectAccountant, projects, scopedProjectSet]
  );
  const scopedBillings = useMemo(
    () =>
      isProjectAccountant
        ? billings.filter((b) => allowedContractSet.has(String(b.contractId || '')))
        : billings,
    [isProjectAccountant, billings, allowedContractSet]
  );
  const scopedBoqItems = useMemo(
    () =>
      isProjectAccountant
        ? boqItems.filter((item) => allowedContractSet.has(String(item.contractId || '')))
        : boqItems,
    [isProjectAccountant, boqItems, allowedContractSet]
  );
  const scopedTransactions = useMemo(
    () => {
      const base = isProjectAccountant
        ? transactions.filter((tx) => allowedContractSet.has(String(tx.costCenterId || '')))
        : transactions;
      // fiscal_opening is a carry-forward memo for the new year — exclude from rolling BS/IS/TB
      return base.filter((tx) => {
        const kind = String(tx.journalKind || '');
        if (kind === 'fiscal_opening') return false;
        const ref = String(tx.reference || '');
        return !/^OPEN-/i.test(ref);
      });
    },
    [isProjectAccountant, transactions, allowedContractSet]
  );

  const latestIpcByContract = useMemo(() => {
    const map = new Map<string, Billing>();
    for (const b of scopedBillings) {
      if (!b.contractId || !isCountableIpcStatus(b.status)) continue;
      const prev = map.get(b.contractId);
      if (!prev || parseBillingDate(b) > parseBillingDate(prev)) {
        map.set(b.contractId, b);
      }
    }
    return map;
  }, [scopedBillings]);

  // Company Info State
  const [companyInfo, setCompanyInfo] = useState<{
    companyName: string;
    companyNameEn: string;
    headerLogo: string;
    taxId: string;
    address: string;
    addressEn: string;
    footerText: string;
    footerTextEn: string;
    reportPrintProfiles?: StoredReportPrintProfiles;
  }>({
    companyName: 'شركة النيل للمقاولات والاستثمار العقاري',
    companyNameEn: 'Nile Construction & Real Estate',
    headerLogo: '',
    taxId: '123-456-789',
    address: 'القاهرة، مصر',
    addressEn: 'Cairo, Egypt',
    footerText: 'نظام إدارة التكاليف - جميع الحقوق محفوظة © 2026',
    footerTextEn: 'Cost Management System - All Rights Reserved © 2026',
  });

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        if (isLocalBackend) {
          const res = await settingsApi.getCompanyInfo();
          if (res.value) {
            setCompanyInfo((prev) => ({ ...prev, ...res.value }));
          }
          return;
        }
        const settingsDoc = await getDoc(doc(db, 'settings', 'company_info'));
        if (settingsDoc.exists()) {
          setCompanyInfo(settingsDoc.data() as typeof companyInfo);
        }
      } catch {
        /* keep print defaults */
      }
    };
    void fetchSettings();
  }, [language]);


  useEffect(() => {
    setSelectedContractId('all');
  }, [selectedProjectId]);

  useEffect(() => {
    if (!isLocalBackend) {
      setBoqMaterialByContract(new Map());
      return;
    }
    inventoryApi
      .spentByContract()
      .then((rows) => {
        const map = new Map<string, number>();
        for (const row of rows) {
          map.set(row.contractId, row.totalSpent);
        }
        setBoqMaterialByContract(map);
      })
      .catch(() => setBoqMaterialByContract(new Map()));
  }, [isLocalBackend]);

  useEffect(() => {
    if (!isProjectAccountant) return;
    const fallbackContract = assignedContractIds[0] || 'all';
    if (!scopedProjectSet.has(selectedProjectId) && selectedProjectId !== 'all') {
      setSelectedProjectId('all');
    }
    if (selectedContractId !== 'all' && !allowedContractSet.has(selectedContractId)) {
      setSelectedContractId(fallbackContract);
    }
  }, [
    isProjectAccountant,
    assignedContractIds,
    selectedProjectId,
    selectedContractId,
    allowedContractSet,
    scopedProjectSet,
  ]);

  // Data Processing
  const filteredProjects = React.useMemo(
    () => selectedProjectId === 'all' ? scopedProjects : scopedProjects.filter(p => p.id === selectedProjectId),
    [scopedProjects, selectedProjectId]
  );

  const projectStats = React.useMemo(() => filteredProjects.map(p => {
    const expenseMode = isLocalBackend ? 'local' : 'cloud';
    const ledgerCosts = scopedTransactions
      .filter(t => t.projectId === p.id && !t.isDeleted &&
        (selectedContractId === 'all' || transactionMatchesCostCenterFilter(t, selectedContractId)))
      .reduce(
        (sum, t) => sum + sumTransactionOperatingExpense(t.entries, expenseMode, {
          transactionCostCenterId: t.costCenterId,
          filterCostCenterId: selectedContractId,
        }),
        0,
      );
    let materialBoq = 0;
    if (isLocalBackend) {
      for (const c of scopedContracts.filter((c) => c.projectId === p.id)) {
        if (selectedContractId !== 'all' && c.id !== selectedContractId) continue;
        materialBoq += boqMaterialByContract.get(c.id) || 0;
      }
    }
    const costs = ledgerCosts + materialBoq;

    const projectRevenue = scopedBillings
      .filter(b => b.projectId === p.id && b.status !== 'draft' &&
        (selectedContractId === 'all' || (b as any).contractId === selectedContractId))
      .reduce((sum, b) => sum + (b.worksValueExVat || 0), 0);

    const boqFiltered = scopedBoqItems.filter(item => item.projectId === p.id &&
      (selectedContractId === 'all' || item.contractId === selectedContractId));

    const calculatedBoqValue = boqFiltered.reduce((sum, item) => sum + (item.tenderAmount || 0), 0);
    const calculatedBoqEstimatedCost = boqFiltered.reduce(
      (sum, item) => sum + tenderAmountExcludingProfit(item),
      0,
    );

    const boqValue = calculatedBoqValue > 0 ? calculatedBoqValue : (p.boqValue || 0);
    const boqEstimatedCost =
      calculatedBoqEstimatedCost > 0
        ? calculatedBoqEstimatedCost
        : calculatedBoqValue > 0
          ? calculatedBoqValue / (1 + BOQ_DEFAULT_PROFIT_PCT / 100)
          : 0;
    const voValue = p.voValue || 0;
    const contractTotal = (boqValue + voValue) || p.totalContractValue || 0;
    const costPlanBudget = boqEstimatedCost + voValue;

    const closedByFinal = scopedBillings.some(
      (b) =>
        b.projectId === p.id &&
        (selectedContractId === 'all' || b.contractId === selectedContractId) &&
        isFinalIpcForReports(b),
    );

    return {
      id: p.id,
      name: p.projectName,
      contractTotal,
      costPlanBudget,
      boqValue,
      boqEstimatedCost,
      voValue,
      costs,
      materialBoq,
      billings: projectRevenue,
      profit: projectRevenue - costs,
      variance: costPlanBudget - costs,
      variancePct: costPlanBudget > 0 ? ((costPlanBudget - costs) / costPlanBudget) * 100 : 0,
      progress: closedByFinal
        ? 100
        : contractTotal > 0
          ? (projectRevenue / contractTotal) * 100
          : 0,
    };
  }), [
    filteredProjects,
    scopedTransactions,
    scopedBillings,
    scopedBoqItems,
    scopedContracts,
    selectedContractId,
    isLocalBackend,
    boqMaterialByContract,
  ]);

  const {
    totalRevenue,
    totalCosts,
    totalGrossProfit,
    totalContractValue,
    totalCostBudget,
    totalBoqValue,
    totalBoqEstimatedCost,
    totalVoValue,
  } = React.useMemo(() => ({
    totalRevenue: projectStats.reduce((sum, s) => sum + s.billings, 0),
    totalCosts: projectStats.reduce((sum, s) => sum + s.costs, 0),
    totalGrossProfit: projectStats.reduce((sum, s) => sum + s.profit, 0),
    totalContractValue: projectStats.reduce((sum, s) => sum + s.contractTotal, 0),
    totalCostBudget: projectStats.reduce((sum, s) => sum + s.costPlanBudget, 0),
    totalBoqValue: projectStats.reduce((sum, s) => sum + (s.boqValue || 0), 0),
    totalBoqEstimatedCost: projectStats.reduce((sum, s) => sum + (s.boqEstimatedCost || 0), 0),
    totalVoValue: projectStats.reduce((sum, s) => sum + (s.voValue || 0), 0),
  }), [projectStats]);

  // Local: one source for all BVA levels — boq_actual_costs (same as تكاليف BOQ).
  // Avoids GL/fiscal_pl_close/OHA netting mismatches that made project-level actuals wrong.
  const needBudgetActualApi = isLocalBackend && activeReport === 'budget';
  const { data: budgetBreakdownRows } = useApiQuery<{
    rows: Array<{
      projectId: string;
      contractId?: string;
      boqItemId?: string;
      totalCost: number;
    }>;
  }>(
    () =>
      reportsApi
        .boqCostBreakdown({
          projectId: selectedProjectId,
          contractId: selectedContractId,
          level: budgetLevel,
        })
        .then((response) => [response]),
    [selectedProjectId, selectedContractId, budgetLevel, needBudgetActualApi],
    { enabled: needBudgetActualApi },
  );

  const budgetActualByKey = React.useMemo(() => {
    const map = new Map<string, number>();
    const apiRows = budgetBreakdownRows[0]?.rows ?? [];
    if (isLocalBackend) {
      // Prefer boq_actual_costs for every level (empty API = zero actual, not GL fallback).
      for (const r of apiRows) {
        const key =
          budgetLevel === 'project'
            ? r.projectId
            : budgetLevel === 'contract'
              ? r.contractId
              : r.boqItemId;
        if (key) map.set(String(key), Number(r.totalCost) || 0);
      }
      return map;
    }
    // Cloud fallback — project: GL+materials; contract: CC-scoped GL+materials.
    if (budgetLevel === 'project') {
      for (const s of projectStats) map.set(s.id, s.costs);
      return map;
    }
    if (budgetLevel === 'contract') {
      for (const c of scopedContracts) {
        if (selectedProjectId !== 'all' && c.projectId !== selectedProjectId) continue;
        if (selectedContractId !== 'all' && c.id !== selectedContractId) continue;
        const ledger = scopedTransactions
          .filter((t) => !t.isDeleted && transactionMatchesCostCenterFilter(t, c.id))
          .reduce(
            (sum, t) =>
              sum +
              sumTransactionOperatingExpense(t.entries, 'cloud', {
                transactionCostCenterId: t.costCenterId,
                filterCostCenterId: c.id,
              }),
            0,
          );
        map.set(c.id, ledger);
      }
    }
    return map;
  }, [
    budgetLevel,
    projectStats,
    budgetBreakdownRows,
    scopedContracts,
    scopedTransactions,
    selectedProjectId,
    selectedContractId,
    isLocalBackend,
    boqMaterialByContract,
  ]);

  // Analytical Trial Balance Calculation
  const trialBalance = React.useMemo(() => {
    // 1. Get all unique account codes from COA and Transactions
    const coaCodes = accounts.map(a => a.accountCode || a.code).filter(Boolean);
    const allTx = scopedTransactions.filter(t =>
      !t.isDeleted &&
      (selectedProjectId === 'all' || t.projectId === selectedProjectId) &&
      (selectedContractId === 'all' || transactionMatchesCostCenterFilter(t, selectedContractId))
    );
    const txCodes = allTx
      .flatMap(t => (t.entries || []))
      .map(e => e.accountCode)
      .filter(Boolean);
    
    const allUniqueCodes = Array.from(
      new Set([...coaCodes, ...txCodes].map((c) => String(c).trim()).filter(Boolean)),
    );

    // 2. Split transactions into before-period (opening) and in-period (movements)
    const beforePeriodTx = allTx.filter(t => t.date < periodStart);
    const inPeriodTx     = allTx.filter(t => t.date >= periodStart);

    // 3. Map data for each code
    const list: TrialBalanceRow[] = allUniqueCodes.map((code) => {
      const coaAcc = accounts.find((a) => String(a.accountCode || a.code).trim() === code);
      const name = coaAcc
        ? (language === 'ar'
            ? (coaAcc.accountName || coaAcc.nameAr || code)
            : (coaAcc.accountNameEn || coaAcc.accountName || coaAcc.nameEn || code))
        : (language === 'ar' ? `حساب غير معرف (${code})` : `Undefined Account (${code})`);

      const matchCode = (e: JournalEntry) => String(e.accountCode ?? '').trim() === code;
      const entryInScope = (t: typeof allTx[0], e: JournalEntry) => {
        if (!matchCode(e)) return false;
        if (selectedContractId === 'all') return true;
        const effective = e.costCenterId ?? t.costCenterId ?? null;
        return String(effective ?? '') === selectedContractId;
      };
      const entriesBefore = beforePeriodTx.flatMap(t => (t.entries || []).filter((e) => entryInScope(t, e)));
      const entriesIn     = inPeriodTx.flatMap(t => (t.entries || []).filter((e) => entryInScope(t, e)));

      const openingNet    = entriesBefore.reduce((s, e) => s + (Number(e.debit) || 0) - (Number(e.credit) || 0), 0);
      const openingDebit  = openingNet > 0 ? openingNet : 0;
      const openingCredit = openingNet < 0 ? Math.abs(openingNet) : 0;

      const debitMovements  = entriesIn.reduce((s, e) => s + (Number(e.debit)  || 0), 0);
      const creditMovements = entriesIn.reduce((s, e) => s + (Number(e.credit) || 0), 0);

      const closingNet    = openingNet + debitMovements - creditMovements;
      const closingDebit  = closingNet > 0 ? closingNet : 0;
      const closingCredit = closingNet < 0 ? Math.abs(closingNet) : 0;

      return { code, name, openingDebit, openingCredit, debitMovements, creditMovements, closingDebit, closingCredit };
    })
    .filter(item => item.openingDebit !== 0 || item.openingCredit !== 0 || item.debitMovements !== 0 || item.creditMovements !== 0);

    return aggregateTrialBalanceInventory127(list, language);
  }, [accounts, scopedTransactions, language, selectedProjectId, selectedContractId, periodStart]);

  const trialBalanceTotals = React.useMemo(() => {
    return trialBalance.reduce((acc, item) => ({
      opDebit: acc.opDebit + item.openingDebit,
      opCredit: acc.opCredit + item.openingCredit,
      movDebit: acc.movDebit + item.debitMovements,
      movCredit: acc.movCredit + item.creditMovements,
      clDebit: acc.clDebit + item.closingDebit,
      clCredit: acc.clCredit + item.closingCredit
    }), { opDebit: 0, opCredit: 0, movDebit: 0, movCredit: 0, clDebit: 0, clCredit: 0 });
  }, [trialBalance]);

  const selectedProjectContractIds = React.useMemo(() => {
    if (selectedProjectId === 'all') return new Set<string>();
    return new Set(
      scopedContracts
        .filter((c) => String(c.projectId) === selectedProjectId)
        .map((c) => String(c.id)),
    );
  }, [scopedContracts, selectedProjectId]);

  // GL-based P&L — excludes fiscal_pl_close; filtered by project/contract
  const glPnL = React.useMemo(() => {
    const tx = scopedTransactions.filter((t) => {
      if (t.isDeleted || isExcludedFromIncomeStatement(t)) return false;
      if (
        selectedProjectId !== 'all' &&
        !transactionMatchesProjectFilter(t, selectedProjectId, selectedProjectContractIds)
      ) {
        return false;
      }
      if (selectedContractId !== 'all' && !transactionMatchesCostCenterFilter(t, selectedContractId)) {
        return false;
      }
      return true;
    });

    const entryMatchesFilter = (t: (typeof tx)[0], e: JournalEntry) => {
      if (
        selectedProjectId !== 'all' &&
        !entryMatchesProjectFilter(t, e, selectedProjectId, selectedProjectContractIds)
      ) {
        return false;
      }
      if (selectedContractId === 'all') return true;
      return resolveEntryCostCenterId(e, t.costCenterId) === selectedContractId;
    };

    const leafCodes = accounts
      .filter((a) => !a.isGroup && /^[45]/.test(String(a.accountCode || '').trim()))
      .map((a) => String(a.accountCode || '').trim())
      .filter(Boolean);

    return buildIncomeStatementTotals(tx, leafCodes, entryMatchesFilter);
  }, [
    scopedTransactions,
    accounts,
    selectedProjectId,
    selectedContractId,
    selectedProjectContractIds,
  ]);

  const costCenterSplit = React.useMemo(() => {
    if (!isLocalBackend || costCenterTypeMap.size === 0) return null;
    const tx = scopedTransactions.filter((t) => {
      if (t.isDeleted || isExcludedFromIncomeStatement(t)) return false;
      if (
        selectedProjectId !== 'all' &&
        !transactionMatchesProjectFilter(t, selectedProjectId, selectedProjectContractIds)
      ) {
        return false;
      }
      if (selectedContractId !== 'all' && !transactionMatchesCostCenterFilter(t, selectedContractId)) {
        return false;
      }
      return true;
    });
    return computeDirectIndirectCostSplit(tx, costCenterTypeMap, {
      projectId: selectedProjectId,
      contractId: selectedContractId,
    });
  }, [
    isLocalBackend,
    costCenterTypeMap,
    scopedTransactions,
    selectedProjectId,
    selectedContractId,
    selectedProjectContractIds,
  ]);

  // Balance sheet — company-wide; equity = prefix 3 only (P&L 4/5 → income statement tab)
  const balanceSheet = React.useMemo(() => {
    const allTx = scopedTransactions.filter(t => !t.isDeleted);

    // Single source of truth: code → net (debit - credit) across all transactions
    const codeBalMap = new Map<string, number>();
    allTx.forEach(t => {
      (t.entries || []).forEach((e: JournalEntry) => {
        const code = String(e.accountCode ?? '').trim();
        if (!code) return;
        codeBalMap.set(code, (codeBalMap.get(code) ?? 0) + (Number(e.debit) || 0) - (Number(e.credit) || 0));
      });
    });

    // Sum all codes whose accountCode starts with prefix
    const netDebit = (prefix: string) => {
      let sum = 0;
      codeBalMap.forEach((bal, code) => { if (code.startsWith(prefix)) sum += bal; });
      return sum;
    };

    // Per-account balance from the map
    const accBal = (code: string, nature: 'debit' | 'credit') => {
      const net = codeBalMap.get(code) ?? 0;
      return nature === 'debit' ? net : -net;
    };

    // Detail-level section sum — used only for display rows, not for totals
    const sectionBal = (prefix: string, nature: 'debit' | 'credit') =>
      accounts
        .filter(a => !a.isGroup && (a.accountCode || '').startsWith(prefix) && a.status !== 'disabled')
        .reduce((sum, acc) => sum + accBal(acc.accountCode || '', nature), 0);

    // ── Totals via direct prefix sums — mathematically guaranteed to balance ──
    const nonCurrentAssets = netDebit('11');
    const currentAssets    = netDebit('12');
    const totalAssets      = currentAssets + nonCurrentAssets;

    const currentLiab      = -netDebit('21');
    const nonCurrentLiab   = -netDebit('22');
    const totalLiab        = currentLiab + nonCurrentLiab;

    // حقوق الملكية: حسابات فرع 3 فقط — لا تُدمج إيرادات/مصروفات (4/5)؛ تُقفل في قائمة الدخل ثم تُرحّل للأرباح المحتجزة.
    const equityAccounts   = -netDebit('3');
    const allRevenue       = -netDebit('4');
    const allCosts         =  netDebit('5');
    const unclosedPeriodPl = allRevenue - allCosts;
    const totalEquity      = equityAccounts;
    const totalLE          = totalLiab + totalEquity;
    const balanceGap       = totalAssets - totalLE;
    const inventory127Net  = netDebit(INVENTORY127_AGG_CODE);
    const inventory127     = splitNetToDebitCredit(inventory127Net);

    return {
      codeBalMap,
      currentAssets, nonCurrentAssets, totalAssets,
      currentLiab, nonCurrentLiab, totalLiab,
      equityAccounts, unclosedPeriodPl, totalEquity, totalLE, balanceGap,
      inventory127,
      isBalanced: Math.abs(balanceGap) <= 1,
      accBal, sectionBal,
    };
  }, [scopedTransactions, accounts]);

  const exportToExcel = async () => {
    let data: Record<string, unknown>[] = [];
    let filename = 'report.xlsx';

    if (activeReport === 'costs' && isLocalBackend) {
      const resp = await reportsApi.boqCostBreakdown({
        projectId: selectedProjectId,
        contractId: selectedContractId,
        level: costLevel,
        dateFrom: costDateFrom || undefined,
        dateTo: costDateTo || undefined,
      });
      const isAr = language === 'ar';
      data = resp.rows.map((row) => {
        const base: Record<string, unknown> = {
          [isAr ? 'المشروع' : 'Project']: row.projectName,
          [isAr ? 'كود المشروع' : 'Project code']: row.projectCode,
          [t('report_direct_costs')]: row.directCost,
          [t('report_indirect_allocated')]: row.indirectCost,
          [t('report_total_costs')]: row.totalCost,
        };
        if (costLevel === 'contract' || costLevel === 'boq_item') {
          base[isAr ? 'العقد' : 'Contract'] = row.contractName ?? '';
          base[isAr ? 'رقم العقد' : 'Contract #'] = row.contractNumber ?? '';
        }
        if (costLevel === 'boq_item') {
          base[isAr ? 'كود البند' : 'Item code'] = row.itemCode ?? '';
          base[isAr ? 'وصف البند' : 'Description'] = row.boqDescription ?? '';
        }
        return base;
      });
      filename = `BOQ_Cost_Breakdown_${costLevel}.xlsx`;
    } else if (activeReport === 'income') {
      data = projectStats.map(s => ({
        [language === 'ar' ? 'المشروع' : 'Project']: s.name,
        [language === 'ar' ? 'الإيرادات' : 'Revenue']: s.billings,
        [language === 'ar' ? 'التكاليف المباشرة' : 'Direct Costs']: s.costs,
        [language === 'ar' ? 'مجمل الربح' : 'Gross Profit']: s.profit,
        [language === 'ar' ? 'هامش الربح %' : 'Profit Margin %']: ((s.profit / (s.billings || 1)) * 100).toFixed(2) + '%'
      }));
      filename = 'Income_Statement.xlsx';
    } else if (activeReport === 'budget') {
      const bvaRows = buildBudgetVsActualRows({
        level: budgetLevel,
        projects: filteredProjects.map((p) => ({
          id: p.id,
          projectName: p.projectName,
          projectCode: p.projectCode,
          voValue: p.voValue,
        })),
        contracts: scopedContracts,
        boqItems: scopedBoqItems,
        actualByKey: budgetActualByKey,
        projectFilter: selectedProjectId,
        contractFilter: selectedContractId,
      });
      data = bvaRows.map((r) => {
        const row: Record<string, string | number> = {
          [language === 'ar' ? 'البند' : 'Label']: r.label,
          [language === 'ar' ? 'المرجع' : 'Reference']: r.meta || '',
          [language === 'ar' ? 'BOQ (بيع)' : 'BOQ selling']: r.boqSelling,
          [language === 'ar' ? 'تكلفة تقديرية' : 'Est. cost']: r.estCost,
        };
        if (budgetLevel === 'project') {
          row[language === 'ar' ? 'أوامر التغيير' : 'VO'] = r.voValue;
        }
        row[language === 'ar' ? 'ميزانية التكلفة' : 'Cost budget'] = r.costBudget;
        row[language === 'ar' ? 'الفعلي' : 'Actual'] = r.actual;
        row[language === 'ar' ? 'الانحراف' : 'Variance'] = r.variance;
        return row;
      });
      filename = `Budget_vs_Actual_${budgetLevel}.xlsx`;
    } else if (activeReport === 'trial') {
      data = trialBalance.map(i => ({
        [language === 'ar' ? 'كود الحساب' : 'Code']: i.code,
        [language === 'ar' ? 'اسم الحساب' : 'Account Name']: i.name,
        [language === 'ar' ? 'رصيد أول - مدين' : 'Opening Debit']: i.openingDebit,
        [language === 'ar' ? 'رصيد أول - دائن' : 'Opening Credit']: i.openingCredit,
        [language === 'ar' ? 'حركة - مدين' : 'Debit Movements']: i.debitMovements,
        [language === 'ar' ? 'حركة - دائن' : 'Credit Movements']: i.creditMovements,
        [language === 'ar' ? 'رصيد آخر - مدين' : 'Closing Debit']: i.closingDebit,
        [language === 'ar' ? 'رصيد آخر - دائن' : 'Closing Credit']: i.closingCredit
      }));
      filename = 'Analytical_Trial_Balance.xlsx';
    } else if (activeReport === 'time') {
      data = scopedBoqItems
        .filter(item => (selectedProjectId === 'all' || item.projectId === selectedProjectId) && (selectedContractId === 'all' || item.contractId === selectedContractId))
        .map(item => {
          const tenderQty = item.tenderQty ?? 0;
          const executedQty = getExecutedQtyFromBillings(item, latestIpcByContract, scopedBillings);
          const physicalPct = tenderQty > 0 ? (executedQty / tenderQty) * 100 : 0;

          const duration = item.expectedDuration || 0;
          const hasSchedule = !!(item.startDate && item.expectedDuration);

          const now = new Date();
          now.setHours(0, 0, 0, 0);

          let start: Date | null = null;
          let end: Date | null = null;
          if (item.startDate && item.expectedDuration) {
            const [sy, sm, sd] = normalizeDate(item.startDate).split('-').map(Number);
            start = new Date(sy, sm - 1, sd);
            end = new Date(sy, sm - 1, sd + item.expectedDuration);
          }

          const elapsedDays = start
            ? Math.max(0, Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)))
            : 0;
          const timeProgress = duration > 0 ? (elapsedDays / duration) * 100 : 0;

          const isCompleted = physicalPct >= 99.9;
          const notStarted = start ? start > now : false;
          const isDelayed = end ? end < now && !isCompleted : false;

          let statusLabel: string;
          if (isCompleted) {
            statusLabel = language === 'ar' ? 'مكتمل' : 'Completed';
          } else if (!hasSchedule) {
            statusLabel = language === 'ar' ? 'غير مجدول زمنياً' : 'Not scheduled';
          } else if (notStarted) {
            statusLabel = language === 'ar' ? 'لم يبدأ' : 'Not started';
          } else if (isDelayed) {
            statusLabel = language === 'ar' ? 'متأخر' : 'Delayed';
          } else {
            statusLabel = language === 'ar' ? 'قيد التنفيذ' : 'In progress';
          }

          return {
            [language === 'ar' ? 'البند' : 'Item']: item.itemCode,
            [language === 'ar' ? 'الوصف' : 'Description']: item.description,
            [language === 'ar' ? 'تاريخ البدء' : 'Start Date']: item.startDate ? normalizeDate(item.startDate) : '',
            [language === 'ar' ? 'المدة المتوقعة (يوم)' : 'Expected Duration (Days)']: duration,
            [language === 'ar' ? 'النهاية المتوقعة' : 'Expected Finish']: end ? end.toLocaleDateString(locale) : '',
            [language === 'ar' ? 'إنجاز الأعمال %' : 'Physical %']: physicalPct.toFixed(2),
            [language === 'ar' ? 'الأيام المنقضية' : 'Elapsed Days']: hasSchedule ? elapsedDays : '',
            [language === 'ar' ? 'التقدم الزمني %' : 'Time progress %']: hasSchedule ? timeProgress.toFixed(2) : '',
            [language === 'ar' ? 'الحالة' : 'Status']: statusLabel,
          };
        });
      filename = 'Project_Schedule.xlsx';
    } else {
      data = projectStats;
      filename = 'Project_Overview.xlsx';
    }

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Report");
    XLSX.writeFile(wb, filename);
  };

  const printScopeLabel = useMemo(() => {
    const parts: string[] = [];
    if (selectedProjectId !== 'all') {
      const p = scopedProjects.find((x) => x.id === selectedProjectId);
      if (p?.projectName) parts.push(p.projectName);
    }
    if (selectedContractId !== 'all') {
      const c = scopedContracts.find((x) => x.id === selectedContractId);
      if (c) parts.push(c.contractName || c.contractNumber);
    }
    return parts.join(' · ');
  }, [selectedProjectId, selectedContractId, scopedProjects, scopedContracts]);

  const printReportDate = useMemo(
    () => new Date().toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' }),
    [locale],
  );

  /** Resolved print profile for the active report — drives on-screen paper + live format preview. */
  const currentPrintProfile = useMemo(
    () => resolveReportPrintProfile(companyInfo.reportPrintProfiles, activeReport),
    [companyInfo.reportPrintProfiles, activeReport],
  );

  const printPreviewDir = useMemo(
    () => resolvePrintTextDir(currentPrintProfile.textDirection, language),
    [currentPrintProfile.textDirection, language],
  );

  const printPreviewStyle = useMemo(
    () =>
      ({
        fontFamily: PRINT_FONT_CSS[currentPrintProfile.fontFamily],
        padding: PRINT_MARGIN_CSS[currentPrintProfile.marginPreset],
        direction: printPreviewDir,
        ['--report-accent' as string]: currentPrintProfile.accent,
      }) as React.CSSProperties,
    [
      currentPrintProfile.fontFamily,
      currentPrintProfile.marginPreset,
      currentPrintProfile.accent,
      printPreviewDir,
    ],
  );

  const printFormatDirtyRef = useRef(false);

  const patchActivePrintProfile = (patch: Partial<ReportPrintProfile>) => {
    printFormatDirtyRef.current = true;
    setCompanyInfo((prev) => {
      const current = resolveReportPrintProfile(prev.reportPrintProfiles, activeReport);
      return {
        ...prev,
        reportPrintProfiles: {
          ...(prev.reportPrintProfiles || {}),
          [activeReport]: { ...current, ...patch },
        },
      };
    });
  };

  const resetActivePrintProfile = () => {
    printFormatDirtyRef.current = true;
    setCompanyInfo((prev) => {
      const next = { ...(prev.reportPrintProfiles || {}) };
      delete next[activeReport];
      return { ...prev, reportPrintProfiles: next };
    });
  };

  useEffect(() => {
    if (!printFormatDirtyRef.current) return;
    if (!canPersistUserPreferences()) return;
    const timer = window.setTimeout(() => {
      const profiles = companyInfo.reportPrintProfiles || {};
      void (async () => {
        try {
          if (isLocalBackend) {
            // Prefer profiles-only patch (reports permission); admin full PUT as fallback.
            try {
              await settingsApi.patchReportPrintProfiles(profiles);
            } catch {
              await settingsApi.putCompanyInfo({ ...companyInfo });
            }
          } else {
            const ref = doc(db, 'settings', 'company_info');
            const snap = await getDoc(ref);
            if (snap.exists()) {
              await updateDoc(ref, { reportPrintProfiles: profiles });
            } else {
              await setDoc(ref, { ...companyInfo, reportPrintProfiles: profiles });
            }
          }
          printFormatDirtyRef.current = false;
        } catch (err) {
          console.error(err);
          toast.error(t('report_fmt_save_failed'));
        }
      })();
    }, 600);
    return () => window.clearTimeout(timer);
  }, [companyInfo, t]);

  const printReport = async () => {
    try {
      let costRows:
        | Array<{
            projectName: string;
            projectCode?: string;
            contractName?: string;
            contractNumber?: string;
            itemCode?: string;
            boqDescription?: string;
            chapterCode?: string;
            sectionCode?: string;
            directCost: number;
            indirectCost: number;
            totalCost: number;
          }>
        | undefined;
      let costTotals: { directCost: number; indirectCost: number; totalCost: number } | undefined;
      if (activeReport === 'costs' && isLocalBackend) {
        const resp = await reportsApi.boqCostBreakdown({
          projectId: selectedProjectId,
          contractId: selectedContractId,
          level: costLevel,
          dateFrom: costDateFrom || undefined,
          dateTo: costDateTo || undefined,
        });
        costRows = (resp.rows || []).map((row) => ({
          projectName: row.projectName,
          projectCode: row.projectCode,
          contractName: row.contractName,
          contractNumber: row.contractNumber,
          itemCode: row.itemCode,
          boqDescription: row.boqDescription,
          chapterCode: row.chapterCode,
          sectionCode: row.sectionCode,
          directCost: Number(row.directCost) || 0,
          indirectCost: Number(row.indirectCost) || 0,
          totalCost: Number(row.totalCost) || 0,
        }));
        costTotals = {
          directCost: Number(resp.totals?.directCost) || costRows.reduce((a, r) => a + r.directCost, 0),
          indirectCost: Number(resp.totals?.indirectCost) || costRows.reduce((a, r) => a + r.indirectCost, 0),
          totalCost: Number(resp.totals?.totalCost) || costRows.reduce((a, r) => a + r.totalCost, 0),
        };
      }

      let incomeRows;
      let incomeColumns;
      if (activeReport === 'income') {
        const built = buildIncomeStatementPrintRows({
          language,
          showAnalytical,
          glPnL,
          accounts,
          billingFallbackRevenue: totalRevenue,
        });
        incomeRows = built.rows;
        incomeColumns = built.columns;
      }

      let balanceRows;
      let balanceColumns;
      if (activeReport === 'balance') {
        const built = buildBalanceSheetPrintRows({
          language,
          showAnalytical,
          bs: balanceSheet,
          accounts,
        });
        balanceRows = built.rows;
        balanceColumns = built.columns;
      }

      let timeColumns;
      let timeRows;
      if (activeReport === 'time') {
        const scheduleItems = scopedBoqItems.filter(
          (item) =>
            (selectedProjectId === 'all' || item.projectId === selectedProjectId) &&
            (selectedContractId === 'all' || item.contractId === selectedContractId),
        );
        const physicalPctByItemId = new Map<string, number>();
        for (const item of scheduleItems) {
          const tenderQty = item.tenderQty ?? 0;
          const executedQty = getExecutedQtyFromBillings(item, latestIpcByContract, scopedBillings);
          physicalPctByItemId.set(
            String(item.id || ''),
            tenderQty > 0 ? (executedQty / tenderQty) * 100 : 0,
          );
        }
        const built = buildSchedulePrintRows({
          language,
          locale,
          items: scheduleItems,
          physicalPctByItemId,
          normalizeDate,
        });
        timeColumns = built.columns;
        timeRows = built.rows;
      }

      let liquidityRows:
        | Array<{
            name: string;
            billings: number;
            collected: number;
            advances: number;
            retention: number;
            uncollected: number;
          }>
        | undefined;
      let liquidityCashBalance: number | undefined;
      if (activeReport === 'liquidity') {
        const [contracts, projects, billingRows, glTxs] = await Promise.all([
          contractsApi.list() as Promise<Array<{ id: string; contractName: string; contractNumber: string; projectId: string; isDeleted?: boolean }>>,
          projectsApi.list(),
          billingApi.list(),
          glApi.transactions(undefined, LISTENER_LIQUIDITY_KPI_GL_CAP) as Promise<
            Array<{
              costCenterId?: string;
              projectId?: string;
              reference?: string;
              entries?: Array<{ accountCode: string; debit: number; credit: number }>;
              isDeleted?: boolean;
            }>
          >,
        ]);
        const activeContracts = contracts.filter((c) => c.isDeleted !== true);
        const projectsMap = new Map(
          projects.filter((p) => !p.isDeleted).map((p) => [p.id, p.projectName] as const),
        );
        const activeBilling = billingRows
          .filter((b) => b.isDeleted !== true)
          .map((b) => {
            const row = b as BillingRecord & {
              worksValueExVat?: number;
              vatAmount?: number;
              execGuaranteeAmount?: number;
            };
            return {
              id: String(row.id ?? ''),
              contractId: String(row.contractId ?? ''),
              status: String(row.status ?? ''),
              worksValueExVat: Number(row.worksValueExVat ?? 0),
              vatAmount: Number(row.vatAmount ?? 0),
              netPayable: row.netPayable != null ? Number(row.netPayable) : undefined,
              retentionAmount: row.retentionAmount != null ? Number(row.retentionAmount) : undefined,
              execGuaranteeAmount:
                row.execGuaranteeAmount != null ? Number(row.execGuaranteeAmount) : undefined,
            };
          });
        const glSlice = glTxs
          .filter((tx) => tx.isDeleted !== true)
          .map((tx) => ({
            costCenterId: tx.costCenterId,
            projectId: tx.projectId,
            reference: tx.reference,
            entries: tx.entries || [],
          }));
        const countMap = contractCountByProject(activeContracts);
        liquidityRows = activeContracts.map((contract) => {
          const row = computeLiquidityContractRow(contract, activeBilling, glSlice, countMap);
          const projectName = projectsMap.get(contract.projectId) || '';
          const contractLabel = contract.contractNumber || contract.contractName;
          return {
            name: projectName ? `${contractLabel} · ${projectName}` : contractLabel,
            billings: row.totalBilled,
            collected: row.ipcCollected,
            advances: row.totalAdvances,
            retention: row.totalRetention,
            uncollected: row.uncollected,
          };
        });
        liquidityCashBalance = cashAndBankBalanceFromGlTxs(glSlice);
      }

      const doc = buildReportsModuleDocument({
        language,
        company: companyInfo,
        scopeLabel: printScopeLabel || undefined,
        dateLabel: printReportDate,
        formatMoney,
        activeReport,
        budgetLevel,
        budgetProjects: filteredProjects.map((p) => ({
          id: p.id,
          projectName: p.projectName,
          projectCode: p.projectCode,
          voValue: p.voValue,
        })),
        budgetContracts: scopedContracts,
        budgetBoqItems: scopedBoqItems,
        budgetActualByKey,
        selectedProjectId,
        selectedContractId,
        projectStats: projectStats.map((s) => ({
          name: s.name,
          billings: s.billings,
          costs: s.costs,
          profit: s.profit,
        })),
        trialBalance,
        costRows,
        costLevel,
        costTotals,
        incomeRows,
        incomeColumns,
        balanceRows,
        balanceColumns,
        timeColumns,
        timeRows,
        liquidityRows,
        liquidityCashBalance,
      });

      if (!doc) {
        toast.error(language === 'ar' ? 'لا يمكن بناء مستند الطباعة لهذا التقرير' : 'Cannot build print document for this report');
        return;
      }

      await openReportDocument(doc, 'preview', formatMoney, {
        title: t('report_print_preview_title'),
        hint: language === 'ar'
          ? 'معاينة مستند التقرير — اطبع أو صدّر PDF (ليس لقطة من الشاشة)'
          : 'Document preview — print or export PDF (not a screen capture)',
        print: t('report_print_action'),
        pdf: language === 'ar' ? 'تصدير PDF' : 'Export PDF',
        cancel: t('cancel'),
      });
    } catch (err) {
      console.error(err);
      toast.error(language === 'ar' ? 'فشل إعداد الطباعة' : 'Print preparation failed');
    }
  };

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

  const ui = {
    page: theme === 'dark'
      ? 'bg-[#0a0a0a] text-gray-100'
      : theme === 'soft'
        ? 'bg-[#eceff1] text-[#37474f]'
        : 'bg-gray-50 text-gray-900',
    card: theme === 'dark'
      ? 'bg-[#151619] border-gray-800'
      : theme === 'soft'
        ? 'bg-white border-[#cfd8dc]'
        : 'bg-white border-gray-200',
    cardMuted: theme === 'dark'
      ? 'bg-gray-900/50 border-gray-800'
      : theme === 'soft'
        ? 'bg-[#f5f7f8] border-[#cfd8dc]'
        : 'bg-gray-50 border-gray-200',
    borderSoft: theme === 'dark'
      ? 'border-gray-800'
      : theme === 'soft'
        ? 'border-[#cfd8dc]'
        : 'border-gray-200',
    borderSubtle: theme === 'dark'
      ? 'border-gray-800/40'
      : theme === 'soft'
        ? 'border-[#cfd8dc]/60'
        : 'border-gray-100',
    divider: theme === 'dark'
      ? 'divide-gray-800/50'
      : theme === 'soft'
        ? 'divide-[#cfd8dc]/70'
        : 'divide-gray-100',
    rowHover: theme === 'dark'
      ? 'hover:bg-white/[0.02]'
      : theme === 'soft'
        ? 'hover:bg-[#eceff1]/60'
        : 'hover:bg-gray-50',
    headRow: theme === 'dark'
      ? 'bg-gray-900/30 border-gray-800'
      : theme === 'soft'
        ? 'bg-[#f5f7f8] border-[#cfd8dc]'
        : 'bg-gray-50 border-gray-200',
    tabBar: theme === 'dark'
      ? 'bg-gray-900/50 border-gray-800'
      : theme === 'soft'
        ? 'bg-white border-[#cfd8dc]'
        : 'bg-white border-gray-200',
    tabInactive: theme === 'dark'
      ? 'text-gray-500 hover:text-gray-200'
      : theme === 'soft'
        ? 'text-[#546e7a] hover:text-[#263238] hover:bg-[#eceff1]'
        : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100',
    btnGhost: theme === 'dark'
      ? 'bg-gray-900 border-gray-800 hover:bg-gray-800 text-gray-200'
      : theme === 'soft'
        ? 'bg-white border-[#cfd8dc] hover:bg-[#f5f7f8] text-[#37474f]'
        : 'bg-white border-gray-300 hover:bg-gray-50 text-gray-700',
    trackBg: theme === 'dark'
      ? 'bg-gray-800'
      : theme === 'soft'
        ? 'bg-[#dde3e8]'
        : 'bg-gray-200',
    mutedText: theme === 'dark' ? 'text-gray-400' : 'text-gray-500',
    subtleText: theme === 'dark' ? 'text-gray-500' : 'text-gray-400',
    input: theme === 'dark'
      ? 'bg-gray-900 border-gray-700 text-white'
      : theme === 'soft'
        ? 'bg-white border-[#cfd8dc] text-[#37474f]'
        : 'bg-white border-gray-300 text-gray-900',
    chipBlue: theme === 'dark'
      ? 'bg-blue-600/15 text-blue-400 border-blue-600/25'
      : 'bg-blue-50 text-blue-700 border-blue-200',
    chipPurple: theme === 'dark'
      ? 'bg-purple-600/15 text-purple-400 border-purple-600/25'
      : 'bg-purple-50 text-purple-700 border-purple-200',
  } as const;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <Loader2 className="animate-spin text-blue-500" size={48} />
        <p className="text-gray-500">{language === 'ar' ? 'جاري إعداد التقارير المالية...' : 'Preparing financial reports...'}</p>
      </div>
    );
  }

  return (
    <div className={cn(
      activeReport === 'budget' ? 'px-3 py-6 md:px-4 min-h-full' : 'p-8 min-h-full',
      'transition-colors',
      ui.page,
    )} dir={dir}>
      {/* Controls (Hidden in Print) */}
      <header className="mb-8 print:hidden">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-3xl font-bold tracking-tight">{t('reports')}</h2>
              <ManualHelpButton topicId={resolveReportsTabTopic(activeReport)} size={16} />
            </div>
            <p className={cn("mt-1 text-sm", ui.mutedText)}>{language === 'ar' ? 'تحليلات مالية متقدمة وتقارير أداء المشاريع' : 'Advanced financial analytics and project performance reports'}</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            {/* Project Selector */}
            <div className="flex items-center gap-2">
              <Building2 className="text-blue-500 shrink-0" size={18} />
              <SearchableSelect
                value={selectedProjectId}
                onChange={setSelectedProjectId}
                theme={theme}
                dir={dir}
                className="w-56"
                placeholder={language === 'ar' ? 'جميع المشاريع' : 'All Projects'}
                options={[
                  { value: 'all', label: language === 'ar' ? 'جميع المشاريع' : 'All Projects' },
                  ...scopedProjects.map(p => ({ value: p.id, label: p.projectName })),
                ]}
              />
            </div>

            {/* Contract Selector — costs tab: all scoped contracts; other tabs: selected project only */}
            {(() => {
              const projectContracts = scopedContracts.filter(c => c.projectId === selectedProjectId);
              const showContractFilter =
                activeReport === 'costs'
                  ? scopedContracts.length > 0
                  : selectedProjectId !== 'all' && projectContracts.length > 0;
              if (!showContractFilter) return null;
              const contractOptions =
                activeReport === 'costs' && selectedProjectId === 'all'
                  ? scopedContracts
                  : projectContracts;
              return (
                <div className="flex items-center gap-2">
                  <FileText className="text-purple-500 shrink-0" size={18} />
                  <SearchableSelect
                    value={selectedContractId}
                    onChange={setSelectedContractId}
                    theme={theme}
                    dir={dir}
                    className="w-56"
                    placeholder={language === 'ar' ? 'جميع العقود' : 'All Contracts'}
                    options={[
                      { value: 'all', label: language === 'ar' ? 'جميع العقود' : 'All Contracts' },
                      ...contractOptions.map(c => ({
                        value: c.id,
                        label: c.contractName || c.contractNumber,
                      })),
                    ]}
                  />
                </div>
              );
            })()}

            <button
              type="button"
              onClick={() => setShowCharts(!showCharts)}
              className={cn("px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 border",
                showCharts
                  ? (theme === 'dark' ? "bg-blue-600/15 border-blue-600/30 text-blue-400" : "bg-blue-50 border-blue-200 text-blue-700")
                  : ui.btnGhost)}
            >
              <BarChart3 size={18} />
              {language === 'ar' ? 'الرسوم البيانية' : 'Charts'}
            </button>
            <button
              type="button"
              onClick={printReport}
              className={cn("px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 border", ui.btnGhost)}
            >
              <Printer size={18} />
              {t('report_print_action')}
            </button>
            <ManualHelpButton topicId="reports.shared.filters_print" size={14} className="shrink-0" />
            <button
              type="button"
              onClick={exportToExcel}
              className="bg-emerald-600 hover:bg-emerald-500 px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 shadow-md shadow-emerald-600/20 text-white"
            >
              <Download size={18} />
              {language === 'ar' ? 'تصدير Excel' : 'Export Excel'}
            </button>
          </div>
        </div>

        {/* Tabs */}
        {!isErpShell && (
        <div className={cn("flex flex-wrap gap-1 p-1 border rounded-2xl w-fit", ui.tabBar)}>
          {([
            { id: 'income',    label: language === 'ar' ? 'قائمة الدخل'       : 'Income Statement' },
            { id: 'budget',    label: language === 'ar' ? 'الميزانية vs الفعلي' : 'Budget vs Actual' },
            { id: 'balance',   label: language === 'ar' ? 'الميزانية العمومية' : 'Balance Sheet' },
            { id: 'trial',     label: language === 'ar' ? 'ميزان المراجعة'     : 'Trial Balance' },
            { id: 'time',      label: language === 'ar' ? 'الجدول الزمني'      : 'Schedule' },
            { id: 'liquidity', label: language === 'ar' ? 'تقرير السيولة'      : 'Liquidity' },
            { id: 'costs',     label: language === 'ar' ? 'تكاليف BOQ'         : 'BOQ Costs' },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveReport(tab.id)}
              className={cn(
                "px-5 py-2 rounded-xl text-sm font-bold transition-all whitespace-nowrap",
                activeReport === tab.id
                  ? "bg-blue-600 text-white shadow-md shadow-blue-600/20"
                  : ui.tabInactive,
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        )}
      </header>

      <ReportFormatToolbar
        profile={currentPrintProfile}
        onChange={patchActivePrintProfile}
        onReset={resetActivePrintProfile}
        language={language}
        t={t}
        ui={{
          card: ui.card,
          borderSoft: ui.borderSoft,
          mutedText: ui.mutedText,
          input: ui.input,
          btnGhost: ui.btnGhost,
        }}
      />

      {/* Charts Section — screen only, above the A4 paper sheet */}
      <AnimatePresence>
        {showCharts && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="grid grid-cols-1 lg:grid-cols-2 gap-8 print:hidden mb-6"
          >
              <div className={cn("p-6 border rounded-2xl shadow-xl", theme === 'dark' ? "bg-[#151619] border-gray-800" : "bg-white border-gray-200")}>
                <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
                  <TrendingUp className="text-green-500" size={20} />
                  {activeReport === 'income' ? (language === 'ar' ? 'تحليل الربحية (استحقاق)' : 'Profitability Analysis (Accrual)') : (language === 'ar' ? 'مقارنة الإيرادات بالمصروفات' : 'Revenue vs Spent')}
                </h3>
                <div className="h-[300px] w-full min-h-[300px]">
                  <ResponsiveChart>
                    <BarChart data={projectStats}>
                      <CartesianGrid strokeDasharray="3 3" stroke={theme === 'dark' ? "#333" : "#eee"} />
                      <XAxis dataKey="name" stroke="#888" fontSize={10} />
                      <YAxis stroke="#888" fontSize={10} />
                      <Tooltip contentStyle={{ backgroundColor: theme === 'dark' ? '#151619' : '#fff', border: 'none', borderRadius: '8px' }} />
                      <Legend />
                      <Bar dataKey="billings" name={language === 'ar' ? 'إيرادات الاستحقاق' : 'Accrued Revenue'} fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="costs" name={language === 'ar' ? 'التكاليف' : 'Costs'} fill="#ef4444" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveChart>
                </div>
              </div>

              <div className={cn("p-6 border rounded-2xl shadow-xl", theme === 'dark' ? "bg-[#151619] border-gray-800" : "bg-white border-gray-200")}>
                <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
                  <PieChartIcon className="text-blue-500" size={20} />
                  {language === 'ar' ? 'توزيع التكاليف حسب المشروع' : 'Cost Distribution by Project'}
                </h3>
                <div className="h-[300px] w-full min-h-[300px]">
                  <ResponsiveChart>
                    <PieChart>
                      <Pie
                        data={projectStats}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="costs"
                        nameKey="name"
                      >
                        {projectStats.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: theme === 'dark' ? '#151619' : '#fff', border: 'none', borderRadius: '8px' }} />
                      <Legend />
                    </PieChart>
                  </ResponsiveChart>
                </div>
              </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* A4 page viewer — report-print-area constrained to paper dimensions */}
      <div
        className="report-page-viewer"
        data-orientation={currentPrintProfile.orientation}
        data-page-size={currentPrintProfile.pageSize}
        data-multipage={activeReport === 'budget' ? 'true' : undefined}
      >
      <div
        ref={printAreaRef}
        className="report-print-area print:p-0 print:bg-white print:text-black"
        dir={printPreviewDir}
        data-title-align={currentPrintProfile.titleAlign}
        data-table-align={currentPrintProfile.tableCellAlign}
        data-show-header={currentPrintProfile.showHeader ? 'true' : 'false'}
        data-show-footer={currentPrintProfile.showFooter ? 'true' : 'false'}
        style={printPreviewStyle}
      >
        {activeReport === 'budget' ? (
          <div className="report-print-body">
            <BudgetVsActualReport
              level={budgetLevel}
              onLevelChange={setBudgetLevel}
              projects={filteredProjects.map((p) => ({
                id: p.id,
                projectName: p.projectName,
                projectCode: p.projectCode,
                voValue: p.voValue,
              }))}
              contracts={scopedContracts}
              boqItems={scopedBoqItems}
              actualByKey={budgetActualByKey}
              selectedProjectId={selectedProjectId}
              selectedContractId={selectedContractId}
              theme={theme}
              language={language}
              dir={printPreviewDir}
              formatMoney={formatMoney}
              ui={ui}
              scopeLabel={printScopeLabel || undefined}
              printDate={printReportDate}
              companyInfo={companyInfo}
              printProfile={currentPrintProfile}
            />
          </div>
        ) : (
          /* Single-page reports: one sheet — letterhead + body + footer (no outer/inner duplicate frames) */
          <div className="report-print-sheet flex flex-col min-h-full">
            {currentPrintProfile.showHeader ? (
              <PrintReportHeader
                companyInfo={companyInfo}
                language={language}
                title={reportPrintTitle(activeReport, language)}
                printReportDate={printReportDate}
                scopeLabel={printScopeLabel || undefined}
                metaLabel={[printScopeLabel, printReportDate].filter(Boolean).join(' · ') || undefined}
                showOnScreen
                content={{
                  showCompany: currentPrintProfile.headerShowCompany,
                  showAddress: currentPrintProfile.headerShowAddress,
                  showTaxId: currentPrintProfile.headerShowTaxId,
                  showLogo: currentPrintProfile.showLogo,
                  showTitle: currentPrintProfile.headerShowTitle,
                  showMeta: currentPrintProfile.headerShowMeta,
                  extraText: currentPrintProfile.headerExtraText,
                  titleAlign: currentPrintProfile.titleAlign,
                  logoAlign: currentPrintProfile.logoAlign,
                }}
              />
            ) : null}

            <div className="report-print-body flex-1">
          {/* Income Statement View */}
          {activeReport === 'income' && (() => {
            const baseRevenue = glPnL.revenue > 0 ? glPnL.revenue : totalRevenue;
            const fmtCost = (v: number) =>
              Math.abs(v) < 0.005 ? '—' : `(${formatMoney(Math.abs(v))})`;
            const fmtRev = (v: number) =>
              Math.abs(v) < 0.005 ? '—' : formatMoney(Math.abs(v));

            const hasLeafBal = (prefix: string) =>
              accounts.some((a) => {
                const code = String(a.accountCode || '').trim();
                return !a.isGroup && code.startsWith(prefix) && (glPnL.leafBalances[code] || 0) !== 0;
              });
            const has511 = hasLeafBal('511');
            const has512 = hasLeafBal('512');
            const has521 = hasLeafBal('521');
            const has522 = hasLeafBal('522');
            const has531 = hasLeafBal('531');
            const showGa = glPnL.gaExpenses > 0.005 || has521 || has522;
            const showFin = glPnL.financeExpenses > 0.005 || has531;

            const leafRows = (prefix: string, isCost: boolean) => {
              if (!showAnalytical) return null;
              return accounts
                .filter((a) => !a.isGroup && String(a.accountCode || '').trim().startsWith(prefix))
                .map((acc, ai) => {
                  const accountCode = String(acc.accountCode ?? '').trim();
                  const net = glPnL.leafBalances[accountCode] || 0;
                  if (Math.abs(net) < 0.005) return null;
                  const display = isCost ? net : -net;
                  return (
                    <div
                      key={listKey(accountCode || acc.id, ai, `coa-${prefix}`)}
                      className={cn('flex justify-between items-center gap-4 px-6 py-2 border-b text-sm', ui.borderSubtle)}
                    >
                      <span className={cn('ps-4 flex-1 min-w-0', ui.mutedText)}>
                        <span className={cn('font-mono text-[11px] me-2 opacity-60', ui.subtleText)}>{accountCode}</span>
                        {language === 'ar'
                          ? (acc.accountName || accountCode)
                          : (acc.accountNameEn || acc.accountName || accountCode)}
                      </span>
                      <span className={cn('font-mono tabular-nums w-36 text-end shrink-0', isCost ? ui.mutedText : '')}>
                        {isCost ? fmtCost(display) : fmtRev(display)}
                      </span>
                    </div>
                  );
                });
            };

            const SectionHeader = ({ label }: { label: string }) => (
              <div className={cn('px-6 py-2.5 border-b text-xs font-bold uppercase tracking-wider', ui.headRow, ui.borderSoft)}>
                {label}
              </div>
            );
            const SubHeader = ({ label }: { label: string }) =>
              showAnalytical ? (
                <div className={cn('px-6 py-1.5 border-b text-[11px] font-semibold tracking-wide ps-8', ui.subtleText, ui.borderSubtle)}>
                  {label}
                </div>
              ) : null;
            const TotalRow = ({
              label,
              value,
              isCost = false,
            }: {
              label: string;
              value: number;
              isCost?: boolean;
            }) => (
              <div className={cn('flex justify-between items-center gap-4 px-6 py-3 border-b text-sm font-semibold', ui.borderSoft)}>
                <span>{label}</span>
                <span className="font-mono tabular-nums w-36 text-end">
                  {isCost ? fmtCost(value) : fmtRev(value)}
                </span>
              </div>
            );
            const ResultRow = ({
              label,
              value,
              emphasize = false,
            }: {
              label: string;
              value: number;
              emphasize?: boolean;
            }) => (
              <div
                className={cn(
                  'flex justify-between items-center gap-4 px-6 py-3.5 border-b font-bold',
                  emphasize ? 'border-b-2 border-t' : ui.borderSoft,
                  emphasize ? ui.headRow : '',
                )}
              >
                <span className={emphasize ? 'text-base' : 'text-sm'}>{label}</span>
                <span className={cn('font-mono tabular-nums w-36 text-end', emphasize ? 'text-lg' : 'text-sm')}>
                  {formatMoney(value)}
                </span>
              </div>
            );

            const scopeBits = [
              selectedProjectId !== 'all'
                ? scopedProjects.find((p) => p.id === selectedProjectId)?.projectName
                : null,
              selectedContractId !== 'all'
                ? (scopedContracts.find((c) => c.id === selectedContractId)?.contractName
                  || scopedContracts.find((c) => c.id === selectedContractId)?.contractNumber)
                : null,
            ].filter(Boolean);

            return (
              <div className="p-6 md:p-10 max-w-3xl mx-auto" dir={printPreviewDir}>
                <div
                  className={cn(
                    'mb-6 report-print-doc-title',
                    currentPrintProfile.titleAlign === 'start' && 'text-start',
                    currentPrintProfile.titleAlign === 'center' && 'text-center',
                    currentPrintProfile.titleAlign === 'end' && 'text-end',
                    currentPrintProfile.showHeader && currentPrintProfile.headerShowTitle && 'hidden',
                  )}
                >
                  <h3 className="text-xl md:text-2xl font-bold tracking-tight">
                    {language === 'ar' ? 'قائمة الدخل' : 'Income Statement'}
                  </h3>
                  <p className={cn('text-sm mt-1', ui.mutedText)}>
                    {language === 'ar' ? 'للفترة المنتهية في ' : 'For the period ending '}
                    {new Date().toLocaleDateString(locale)}
                  </p>
                  {scopeBits.length > 0 && (
                    <p className={cn('text-xs mt-2', ui.subtleText)}>{scopeBits.join(' · ')}</p>
                  )}
                </div>

                <div className="flex justify-center mb-6 print:hidden">
                  <button
                    type="button"
                    onClick={() => setShowAnalytical((v) => !v)}
                    className={cn(
                      'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border transition-all',
                      showAnalytical
                        ? (theme === 'dark' ? 'bg-blue-600/20 border-blue-600/40 text-blue-400' : 'bg-blue-50 border-blue-300 text-blue-700')
                        : ui.btnGhost,
                    )}
                  >
                    {showAnalytical
                      ? (language === 'ar' ? 'إخفاء التحليلي' : 'Hide Details')
                      : (language === 'ar' ? 'إظهار التحليلي' : 'Show Details')}
                  </button>
                </div>

                <div className={cn('border overflow-hidden mb-8', ui.borderSoft)}>
                  <SectionHeader label={language === 'ar' ? 'الإيرادات' : 'Revenue'} />
                  {leafRows('4', false)}
                  {glPnL.revenue < 0.005 && totalRevenue > 0.005 && (
                    <div className={cn('flex justify-between items-center px-6 py-2 border-b text-sm', ui.borderSubtle)}>
                      <span className={cn('ps-4', ui.mutedText)}>
                        {language === 'ar' ? 'إيرادات المستخلصات (استحقاق)' : 'Billing Revenue (Accrual)'}
                      </span>
                      <span className="font-mono tabular-nums w-36 text-end">{formatMoney(totalRevenue)}</span>
                    </div>
                  )}
                  <TotalRow
                    label={language === 'ar' ? 'مجموع الإيرادات' : 'Total Revenue'}
                    value={baseRevenue}
                  />

                  <SectionHeader label={language === 'ar' ? 'تكاليف العقود' : 'Contract Costs'} />
                  {has511 && <SubHeader label={language === 'ar' ? 'تكاليف مباشرة' : 'Direct Costs'} />}
                  {leafRows('511', true)}
                  {has512 && <SubHeader label={language === 'ar' ? 'تكاليف غير مباشرة للموقع' : 'Indirect Site Costs'} />}
                  {leafRows('512', true)}
                  <TotalRow
                    label={language === 'ar' ? 'مجموع تكاليف العقود' : 'Total Contract Costs'}
                    value={glPnL.contractCosts}
                    isCost
                  />

                  <ResultRow
                    label={language === 'ar' ? 'مجمل ربح العقود' : 'Gross Profit on Contracts'}
                    value={glPnL.grossContractProfit}
                  />

                  {showGa && (
                    <>
                      <SectionHeader
                        label={language === 'ar' ? 'المصروفات العمومية والإدارية' : 'General & Administrative Expenses'}
                      />
                      {has521 && <SubHeader label={language === 'ar' ? 'إدارية وعمومية' : 'G&A'} />}
                      {leafRows('521', true)}
                      {has522 && <SubHeader label={language === 'ar' ? 'تسويق وبيع' : 'Marketing & Sales'} />}
                      {leafRows('522', true)}
                      <TotalRow
                        label={language === 'ar' ? 'مجموع المصروفات العمومية والإدارية' : 'Total G&A Expenses'}
                        value={glPnL.gaExpenses}
                        isCost
                      />
                    </>
                  )}

                  {showFin && (
                    <>
                      <SectionHeader
                        label={language === 'ar' ? 'المصروفات التمويلية' : 'Finance Expenses'}
                      />
                      {leafRows('531', true)}
                      <TotalRow
                        label={language === 'ar' ? 'مجموع المصروفات التمويلية' : 'Total Finance Expenses'}
                        value={glPnL.financeExpenses}
                        isCost
                      />
                    </>
                  )}

                  <ResultRow
                    label={language === 'ar' ? 'ربح الفترة قبل الضريبة' : 'Profit before Tax'}
                    value={glPnL.profitBeforeTax}
                    emphasize
                  />
                </div>

                {showAnalytical && costCenterSplit && (
                  <div className={cn('mb-8 px-1 text-sm', ui.mutedText)}>
                    <p className="font-semibold mb-1">
                      {language === 'ar' ? 'تحليل مراكز التكلفة' : 'Cost center analysis'}
                    </p>
                    <p className="text-xs leading-relaxed">
                      {t('report_direct_costs')}: {formatMoney(costCenterSplit.directCosts)}
                      {' · '}
                      {t('report_indirect_costs')}: {formatMoney(costCenterSplit.totalIndirect)}
                      {' ('}
                      {t('report_indirect_pool')}: {formatMoney(costCenterSplit.indirectNative)}
                      {' · '}
                      {t('report_indirect_allocated')}: {formatMoney(costCenterSplit.indirectAllocated)}
                      {')'}
                    </p>
                  </div>
                )}

                {showAnalytical && (
                  <div>
                    <h4 className={cn('font-semibold text-sm mb-3', ui.mutedText)}>
                      {language === 'ar' ? 'تفصيل حسب المشروع (مستخلصات)' : 'Project breakdown (billing)'}
                    </h4>
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className={cn('border-b', ui.borderSoft)}>
                          <th className={cn('px-3 py-2 text-start text-xs font-semibold', ui.mutedText)}>
                            {language === 'ar' ? 'المشروع' : 'Project'}
                          </th>
                          <th className={cn('px-3 py-2 text-end text-xs font-semibold', ui.mutedText)}>
                            {language === 'ar' ? 'الإيرادات' : 'Revenue'}
                          </th>
                          <th className={cn('px-3 py-2 text-end text-xs font-semibold', ui.mutedText)}>
                            {language === 'ar' ? 'التكاليف' : 'Costs'}
                          </th>
                          <th className={cn('px-3 py-2 text-end text-xs font-semibold', ui.mutedText)}>
                            {language === 'ar' ? 'الربح' : 'Profit'}
                          </th>
                        </tr>
                      </thead>
                      <tbody className={cn('divide-y', ui.divider)}>
                        {projectStats.map((stat, si) => (
                          <tr key={listKey(stat.id, si, `is-proj-${stat.name}`)}>
                            <td className="px-3 py-2 font-medium">{stat.name}</td>
                            <td className="px-3 py-2 font-mono tabular-nums text-end">{formatMoney(stat.billings)}</td>
                            <td className="px-3 py-2 font-mono tabular-nums text-end">({formatMoney(stat.costs)})</td>
                            <td className="px-3 py-2 font-mono tabular-nums text-end font-semibold">{formatMoney(stat.profit)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className={cn('border-t font-semibold', ui.borderSoft)}>
                          <td className="px-3 py-2">{language === 'ar' ? 'الإجمالي' : 'Total'}</td>
                          <td className="px-3 py-2 font-mono tabular-nums text-end">{formatMoney(totalRevenue)}</td>
                          <td className="px-3 py-2 font-mono tabular-nums text-end">({formatMoney(totalCosts)})</td>
                          <td className="px-3 py-2 font-mono tabular-nums text-end">{formatMoney(totalGrossProfit)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Balance Sheet View */}
          {activeReport === 'balance' && (() => {
            const bs = balanceSheet;

            // Name lookup from COA
            const coaNameMap = new Map<string, string>(
              accounts.map(a => [
                a.accountCode || '',
                language === 'ar'
                  ? (a.accountName || a.accountCode || '')
                  : (a.accountNameEn || a.accountName || a.accountCode || ''),
              ])
            );

            // Derive all account codes with a non-zero balance for a given prefix
            // directly from codeBalMap — single source of truth, no re-scan needed.
            const resolveAccounts = (prefix: string, nature: 'debit' | 'credit'): string[] => {
              const result: string[] = [];
              bs.codeBalMap.forEach((net, code) => {
                if (!code.startsWith(prefix)) return;
                const bal = nature === 'debit' ? net : -net;
                if (bal !== 0) result.push(code);
              });
              return result.sort();
            };

            // Render leaf account rows for a prefix (all codes with non-zero balance)
            const BSLeafRows = ({ prefix, nature }: { prefix: string; nature: 'debit' | 'credit' }) => {
              const rows = resolveAccounts(prefix, nature).map(code => {
                const bal = bs.accBal(code, nature);
                const name = coaNameMap.get(code) || code;
                return (
                  <div key={code} className="flex justify-between items-center py-1.5 text-sm ps-4">
                    <span className={ui.mutedText}>{name}</span>
                    <span className="font-mono tabular-nums">{formatMoney(bal)}</span>
                  </div>
                );
              });
              return <>{rows}</>;
            };

            // Render an L3 sub-group: header + leaf rows + optional subtotal
            const BSGroup = ({ prefix, nature, label }: { prefix: string; nature: 'debit' | 'credit'; label: string }) => {
              const codes = resolveAccounts(prefix, nature);
              if (codes.length === 0) return null;
              const total = codes.reduce((s, code) => s + bs.accBal(code, nature), 0);
              if (total === 0) return null;
              return (
                <div className="mb-3">
                  <div className={cn("flex justify-between items-center text-xs font-bold uppercase tracking-wider mb-1 pb-1 border-b border-dashed", ui.subtleText, ui.borderSoft)}>
                    <span>{label}</span>
                    {!showAnalytical && (
                      <span className="font-mono tabular-nums normal-case">{formatMoney(total)}</span>
                    )}
                  </div>
                  {showAnalytical && (
                    <>
                      <BSLeafRows prefix={prefix} nature={nature} />
                      {codes.length > 1 && (
                        <div className={cn("flex justify-between items-center py-1 text-sm font-semibold border-t mt-1 pt-1", ui.borderSubtle)}>
                          <span className={cn("text-xs", ui.mutedText)}>{language === 'ar' ? 'مجموع' : 'Sub-total'}</span>
                          <span className="font-mono tabular-nums text-xs">{formatMoney(total)}</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            };

            const SectionTitle = ({ label, color }: { label: string; color: string }) => (
              <div className={cn('text-base font-black pb-2 mb-3 border-b-2', color)}>{label}</div>
            );
            const SectionTotal = ({ label, value, color }: { label: string; value: number; color: string }) => (
              <div className={cn('flex justify-between items-center pt-3 mt-3 border-t font-black text-base', color)}>
                <span>{label}</span>
                <span className="font-mono tabular-nums">{formatMoney(value)}</span>
              </div>
            );

            // Build L3 group labels from accounts array
            const l3Label = (code: string, fallback: string) =>
              accounts.find(a => a.accountCode === code)?.accountName || fallback;

            return (
              <div className="p-8" dir={printPreviewDir}>
                {/* Title */}
                <div
                  className={cn(
                    'mb-8 report-print-doc-title',
                    currentPrintProfile.titleAlign === 'start' && 'text-start',
                    currentPrintProfile.titleAlign === 'center' && 'text-center',
                    currentPrintProfile.titleAlign === 'end' && 'text-end',
                    currentPrintProfile.showHeader && currentPrintProfile.headerShowTitle && 'hidden',
                  )}
                >
                  <h3 className="text-2xl font-black">{language === 'ar' ? 'الميزانية العمومية' : 'Balance Sheet'}</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {language === 'ar' ? 'بتاريخ ' : 'As of '}
                    {new Date().toLocaleDateString(locale)}
                  </p>
                </div>

                {/* Balance indicator + analytical toggle */}
                <div className="flex items-center justify-center gap-4 mb-8 flex-wrap">
                  <div className={cn('flex items-center gap-3 px-6 py-3 rounded-xl border',
                    bs.isBalanced
                      ? (theme === 'dark' ? 'bg-green-900/10 border-green-900/30 text-green-400' : 'bg-green-50 border-green-200 text-green-700')
                      : (theme === 'dark' ? 'bg-red-900/10 border-red-900/30 text-red-400'   : 'bg-red-50 border-red-200 text-red-700')
                  )}>
                    <div className={cn('w-2.5 h-2.5 rounded-full animate-pulse', bs.isBalanced ? 'bg-green-500' : 'bg-red-500')} />
                    <span className="font-bold text-sm uppercase tracking-wider">
                      {bs.isBalanced
                        ? (language === 'ar' ? 'الميزانية متوازنة' : 'Balanced')
                        : (language === 'ar' ? `فرق: ${formatMoney(Math.abs(bs.balanceGap))}` : `Out of balance by ${formatMoney(Math.abs(bs.balanceGap))}`)}
                    </span>
                  </div>

                  {/* Analytical toggle button */}
                  <button
                    type="button"
                    onClick={() => setShowAnalytical(v => !v)}
                    className={cn(
                      'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border transition-all print:hidden',
                      showAnalytical
                        ? (theme === 'dark' ? 'bg-blue-600/20 border-blue-600/40 text-blue-400' : 'bg-blue-50 border-blue-300 text-blue-700')
                        : ui.btnGhost,
                    )}
                  >
                    <FileText size={15} />
                    {showAnalytical
                      ? (language === 'ar' ? 'إخفاء التحليلي' : 'Hide Details')
                      : (language === 'ar' ? 'إظهار التحليلي' : 'Show Details')}
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-10">

                  {/* ════ LEFT: ASSETS ════ */}
                  <div>
                    {/* Non-Current Assets — first per IFRS/Arabic standards */}
                    <SectionTitle label={language === 'ar' ? 'الأصول غير المتداولة' : 'Non-Current Assets'} color="text-blue-400 border-blue-400/30" />
                    {/* Fixed asset groups 111–118 */}
                    {['111','112','113','114','115','116','117','118'].map(p => (
                      <BSGroup key={p} prefix={p} nature="debit" label={l3Label(p, `${language === 'ar' ? 'أصول ثابتة' : 'Fixed Assets'} (${p})`)} />
                    ))}
                    {/* Accumulated depreciation 119 — credit nature (deduction) */}
                    {bs.accBal('119', 'credit') > 0 || bs.sectionBal('119', 'credit') > 0 ? (
                      <div className="mb-3">
                        <div className={cn('flex justify-between items-center text-xs font-bold uppercase tracking-wider mb-1 pb-1 border-b border-dashed', ui.subtleText, ui.borderSoft)}>
                          <span className="text-red-500">{language === 'ar' ? 'يُطرح: مجمع الإهلاك' : 'Less: Accumulated Depreciation'}</span>
                          <span className="font-mono tabular-nums normal-case text-red-500">
                            ({formatMoney(bs.sectionBal('119', 'credit'))})
                          </span>
                        </div>
                      </div>
                    ) : null}
                    <SectionTotal label={language === 'ar' ? 'صافي الأصول غير المتداولة' : 'Net Non-Current Assets'} value={bs.nonCurrentAssets} color="text-blue-400" />

                    <div className="mt-8">
                      {/* Current Assets */}
                      <SectionTitle label={language === 'ar' ? 'الأصول المتداولة' : 'Current Assets'} color="text-blue-500 border-blue-500/40" />
                      <BSGroup prefix="121" nature="debit" label={l3Label('121', language === 'ar' ? 'النقدية والبنوك' : 'Cash & Banks')} />
                      <BSGroup prefix="122" nature="debit" label={l3Label('122', language === 'ar' ? 'العملاء والذمم المدينة' : 'Receivables')} />
                      <BSGroup prefix="123" nature="debit" label={l3Label('123', language === 'ar' ? 'مدفوعات مقدمة' : 'Advances')} />
                      <BSGroup prefix="124" nature="debit" label={l3Label('124', language === 'ar' ? 'حسابات ضريبية مدينة' : 'Tax Receivables')} />
                      <BSGroup prefix="125" nature="debit" label={l3Label('125', language === 'ar' ? 'ذمم مدينة أخرى' : 'Other Receivables')} />
                      <BSGroup prefix="126" nature="debit" label={l3Label('126', language === 'ar' ? 'أصول أخرى' : 'Other Assets')} />
                      {(bs.inventory127.debit > 0 || bs.inventory127.credit > 0) ? (
                        <div className={cn('flex justify-between items-center gap-3 py-2 mb-3 text-sm border-b border-dashed', ui.borderSoft)}>
                          <span className={cn('font-bold', ui.mutedText)}>
                            {language === 'ar' ? 'مخزون المشاريع (127)' : 'Project Inventory (127)'}
                          </span>
                          <span className="font-mono tabular-nums text-xs shrink-0">
                            {bs.inventory127.debit > 0 ? (
                              <span className="text-blue-600">
                                {language === 'ar' ? 'مدين: ' : 'Dr: '}
                                {formatMoney(bs.inventory127.debit)}
                              </span>
                            ) : null}
                            {bs.inventory127.debit > 0 && bs.inventory127.credit > 0 ? (
                              <span className={cn('mx-2', ui.subtleText)}>·</span>
                            ) : null}
                            {bs.inventory127.credit > 0 ? (
                              <span className="text-red-600">
                                {language === 'ar' ? 'دائن: ' : 'Cr: '}
                                {formatMoney(bs.inventory127.credit)}
                              </span>
                            ) : null}
                          </span>
                        </div>
                      ) : null}
                      <SectionTotal label={language === 'ar' ? 'مجموع الأصول المتداولة' : 'Total Current Assets'} value={bs.currentAssets} color="text-blue-500" />
                    </div>

                    {/* Grand Total Assets */}
                    <div className={cn('flex justify-between items-center mt-6 pt-4 border-t-4 font-black text-lg', 'border-blue-600 text-blue-500')}>
                      <span>{language === 'ar' ? 'إجمالي الأصول' : 'Total Assets'}</span>
                      <span className="font-mono tabular-nums">{formatMoney(bs.totalAssets)}</span>
                    </div>
                  </div>

                  {/* ════ RIGHT: LIABILITIES & EQUITY ════ */}
                  <div>
                    {/* Non-Current Liabilities — first per IFRS/Arabic standards */}
                    <SectionTitle label={language === 'ar' ? 'الخصوم غير المتداولة' : 'Non-Current Liabilities'} color="text-red-400 border-red-400/30" />
                    <BSGroup prefix="221" nature="credit" label={l3Label('221', language === 'ar' ? 'قروض طويلة الأجل' : 'Long-term Loans')} />
                    <SectionTotal label={language === 'ar' ? 'مجموع الخصوم غير المتداولة' : 'Total Non-Current Liabilities'} value={bs.nonCurrentLiab} color="text-red-400" />

                    <div className="mt-8">
                      {/* Current Liabilities */}
                      <SectionTitle label={language === 'ar' ? 'الخصوم المتداولة' : 'Current Liabilities'} color="text-red-500 border-red-500/40" />
                      <BSGroup prefix="211" nature="credit" label={l3Label('211', language === 'ar' ? 'ذمم دائنة تجارية' : 'Trade Payables')} />
                      <BSGroup prefix="212" nature="credit" label={l3Label('212', language === 'ar' ? 'محتجزات الضمان' : 'Retention Payables')} />
                      <BSGroup prefix="213" nature="credit" label={l3Label('213', language === 'ar' ? 'دفعات مقدمة من العملاء' : 'Customer Advances')} />
                      <BSGroup prefix="214" nature="credit" label={l3Label('214', language === 'ar' ? 'التزامات ضريبية' : 'Tax Liabilities')} />
                      <BSGroup prefix="215" nature="credit" label={l3Label('215', language === 'ar' ? 'مستحقات أخرى' : 'Other Payables')} />
                      <SectionTotal label={language === 'ar' ? 'مجموع الخصوم المتداولة' : 'Total Current Liabilities'} value={bs.currentLiab} color="text-red-500" />
                    </div>

                    <div className="mt-8">
                      {/* Equity */}
                      <SectionTitle label={language === 'ar' ? 'حقوق الملكية' : 'Equity'} color="text-emerald-500 border-emerald-500/40" />
                      <BSGroup prefix="311" nature="credit" label={l3Label('311', language === 'ar' ? 'رأس المال' : 'Share Capital')} />
                      <BSGroup prefix="312" nature="credit" label={l3Label('312', language === 'ar' ? 'الاحتياطيات' : 'Reserves')} />
                      <BSGroup prefix="313" nature="credit" label={l3Label('313', language === 'ar' ? 'الأرباح المحتجزة' : 'Retained Earnings')} />
                      <BSGroup prefix="314" nature="credit" label={l3Label('314', language === 'ar' ? 'جاري الشركاء' : "Partners' Current Accounts")} />
                      <SectionTotal label={language === 'ar' ? 'مجموع حقوق الملكية' : 'Total Equity'} value={bs.totalEquity} color="text-emerald-500" />
                    </div>

                    {/* Grand Total L&E */}
                    <div className={cn('flex justify-between items-center mt-6 pt-4 border-t-4 font-black text-lg', 'border-emerald-600 text-emerald-500')}>
                      <span>{language === 'ar' ? 'إجمالي الخصوم وحقوق الملكية' : 'Total Liabilities & Equity'}</span>
                      <span className="font-mono tabular-nums">{formatMoney(bs.totalLE)}</span>
                    </div>
                  </div>
                </div>

                {/* Working capital note */}
                <div className={cn('mt-8 p-4 rounded-xl border text-sm flex justify-between items-center', ui.cardMuted)}>
                  <span className={cn("font-bold", ui.mutedText)}>{language === 'ar' ? 'رأس المال العامل (الأصول المتداولة − الخصوم المتداولة)' : 'Working Capital (Current Assets − Current Liabilities)'}</span>
                  <span className={cn('font-mono font-black tabular-nums', (bs.currentAssets - bs.currentLiab) >= 0 ? 'text-blue-500' : 'text-red-500')}>
                    {formatMoney((bs.currentAssets - bs.currentLiab))}
                  </span>
                </div>

                {!bs.isBalanced ? (
                  <div
                    className={cn(
                      'mt-4 p-4 rounded-xl border text-sm space-y-2',
                      theme === 'dark' ? 'bg-amber-900/10 border-amber-800/40 text-amber-200' : 'bg-amber-50 border-amber-200 text-amber-900',
                    )}
                  >
                    <p className="font-bold">
                      {language === 'ar' ? 'تنويه التوازن' : 'Balance sheet note'}
                    </p>
                    <p>
                      {language === 'ar'
                        ? `الفرق بين إجمالي الأصول وإجمالي (الخصوم + حقوق الملكية): ${formatMoney(Math.abs(bs.balanceGap))}`
                        : `Assets vs liabilities + equity gap: ${formatMoney(Math.abs(bs.balanceGap))}`}
                    </p>
                    {Math.abs(bs.unclosedPeriodPl) > 0.01 && Math.abs(bs.balanceGap - bs.unclosedPeriodPl) < 1 ? (
                      <p className={cn('text-xs leading-relaxed', theme === 'dark' ? 'text-amber-300/90' : 'text-amber-800')}>
                        {language === 'ar'
                          ? 'الفرق يطابق صافي حسابات الإيرادات والمصروفات غير المقفلة — تُعرض في قائمة الدخل ولا تُدرج في حقوق الملكية حتى إقفال الفترة.'
                          : 'The gap matches unclosed revenue/expense (P&L) balances — see the income statement; not in equity until period closing.'}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })()}

          {/* Analytical Trial Balance View */}
          {activeReport === 'trial' && (() => {
            const tbBorder = theme === 'dark' ? 'border-gray-800' : theme === 'soft' ? 'border-[#cfd8dc]' : 'border-gray-200';
            return (
            <div className="p-8" dir={printPreviewDir}>
              <div className="flex flex-wrap items-center gap-4 mb-8">
                <div
                  className={cn(
                    'flex items-center gap-4 flex-1 min-w-0 report-print-doc-title',
                    currentPrintProfile.titleAlign === 'start' && 'justify-start text-start',
                    currentPrintProfile.titleAlign === 'center' && 'justify-center text-center',
                    currentPrintProfile.titleAlign === 'end' && 'justify-end text-end',
                    currentPrintProfile.showHeader && currentPrintProfile.headerShowTitle && 'hidden',
                  )}
                >
                  <BarChart3 className="text-blue-500" size={32} />
                  <h3 className="text-2xl font-black flex-1">{language === 'ar' ? 'ميزان المراجعة التحليلي' : 'Analytical Trial Balance'}</h3>
                </div>
                <div className="flex items-center gap-3 print:hidden">
                  <label className={cn("text-xs font-bold uppercase whitespace-nowrap", ui.mutedText)}>
                    {language === 'ar' ? 'بداية الفترة' : 'Period Start'}
                  </label>
                  <input
                    type="date"
                    aria-label={language === 'ar' ? 'بداية الفترة' : 'Period start'}
                    value={periodStart}
                    onChange={(e) => setPeriodStart(e.target.value)}
                    className={cn('border rounded-lg py-1.5 px-3 text-sm outline-none focus:border-blue-500 transition-colors', ui.input)}
                  />
                  <span className={cn('text-[11px] px-2 py-1 rounded font-bold', theme === 'dark' ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-50 text-blue-700')}>
                    {language === 'ar'
                      ? `الحركة من ${periodStart} حتى اليوم`
                      : `Movements from ${periodStart} onward`}
                  </span>
                </div>
              </div>
              <p className="hidden print:block text-xs font-semibold text-gray-600 mb-6 -mt-4">
                {language === 'ar'
                  ? `الحركة من ${periodStart} حتى اليوم`
                  : `Movements from ${periodStart} onward`}
              </p>

              <div className="overflow-x-auto print:overflow-visible">
                <table className={cn("w-full text-right border-collapse border", tbBorder)}>
                  <thead>
                    <tr className={cn("border-b-2", ui.headRow)}>
                      <th rowSpan={2} className={cn("px-4 py-3 text-sm font-black uppercase border", ui.mutedText, tbBorder)}>{language === 'ar' ? 'كود الحساب' : 'Code'}</th>
                      <th rowSpan={2} className={cn("px-4 py-3 text-sm font-black uppercase border", ui.mutedText, tbBorder)}>{language === 'ar' ? 'اسم الحساب' : 'Account Name'}</th>
                      <th colSpan={2} className={cn("px-4 py-3 text-sm font-black uppercase border text-center", ui.mutedText, tbBorder)}>{language === 'ar' ? 'الأرصدة الافتتاحية' : 'Opening Balances'}</th>
                      <th colSpan={2} className={cn("px-4 py-3 text-sm font-black uppercase border text-center", ui.mutedText, tbBorder)}>{language === 'ar' ? 'الحركة خلال الفترة' : 'Movements'}</th>
                      <th colSpan={2} className={cn("px-4 py-3 text-sm font-black uppercase border text-center", ui.mutedText, tbBorder)}>{language === 'ar' ? 'الأرصدة الختامية' : 'Closing Balances'}</th>
                    </tr>
                    <tr className={cn("border-b-2", ui.borderSoft)}>
                      <th className={cn("px-4 py-2 text-xs font-bold border", ui.subtleText, tbBorder)}>{language === 'ar' ? 'مدين' : 'Debit'}</th>
                      <th className={cn("px-4 py-2 text-xs font-bold border", ui.subtleText, tbBorder)}>{language === 'ar' ? 'دائن' : 'Credit'}</th>
                      <th className={cn("px-4 py-2 text-xs font-bold border", ui.subtleText, tbBorder)}>{language === 'ar' ? 'مدين' : 'Debit'}</th>
                      <th className={cn("px-4 py-2 text-xs font-bold border", ui.subtleText, tbBorder)}>{language === 'ar' ? 'دائن' : 'Credit'}</th>
                      <th className={cn("px-4 py-2 text-xs font-bold border", ui.subtleText, tbBorder)}>{language === 'ar' ? 'مدين' : 'Debit'}</th>
                      <th className={cn("px-4 py-2 text-xs font-bold border", ui.subtleText, tbBorder)}>{language === 'ar' ? 'دائن' : 'Credit'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trialBalance.map((item) => (
                      <tr
                        key={item.code}
                        className={cn(
                          'border-b transition-colors',
                          ui.borderSoft,
                          ui.rowHover,
                          item.isInventory127Aggregate && (theme === 'dark' ? 'bg-blue-900/15' : 'bg-blue-50/80'),
                        )}
                      >
                        <td className={cn("px-4 py-3 font-mono text-sm border tabular-nums", tbBorder, item.isInventory127Aggregate && 'font-bold')}>{item.code}</td>
                        <td className={cn("px-4 py-3 font-bold border", tbBorder)}>{item.name}</td>
                        <td className={cn("px-4 py-3 font-mono text-sm border tabular-nums text-end", tbBorder)}>{item.openingDebit > 0 ? formatMoney(item.openingDebit) : '-'}</td>
                        <td className={cn("px-4 py-3 font-mono text-sm border tabular-nums text-end", tbBorder)}>{item.openingCredit > 0 ? formatMoney(item.openingCredit) : '-'}</td>
                        <td className={cn("px-4 py-3 font-mono text-sm border text-end text-blue-500 tabular-nums", tbBorder)}>{item.debitMovements > 0 ? formatMoney(item.debitMovements) : '-'}</td>
                        <td className={cn("px-4 py-3 font-mono text-sm border text-end text-red-500 tabular-nums", tbBorder)}>{item.creditMovements > 0 ? formatMoney(item.creditMovements) : '-'}</td>
                        <td className={cn("px-4 py-3 font-mono text-sm border text-end font-bold text-blue-600 tabular-nums", tbBorder)}>{item.closingDebit > 0 ? formatMoney(item.closingDebit) : '-'}</td>
                        <td className={cn("px-4 py-3 font-mono text-sm border text-end font-bold text-red-600 tabular-nums", tbBorder)}>{item.closingCredit > 0 ? formatMoney(item.closingCredit) : '-'}</td>
                      </tr>
                    ))}
                    <tr className={cn("font-black", theme === 'dark' ? "bg-blue-600/10" : "bg-blue-50")}>
                      <td colSpan={2} className={cn("px-4 py-4 text-center border uppercase tracking-wider", tbBorder)}>{language === 'ar' ? 'الإجمالي العام' : 'GRAND TOTAL'}</td>
                      <td className={cn("px-4 py-4 font-mono border text-end tabular-nums", tbBorder)}>{formatMoney(trialBalanceTotals.opDebit)}</td>
                      <td className={cn("px-4 py-4 font-mono border text-end tabular-nums", tbBorder)}>{formatMoney(trialBalanceTotals.opCredit)}</td>
                      <td className={cn("px-4 py-4 font-mono border text-end text-blue-600 tabular-nums", tbBorder)}>{formatMoney(trialBalanceTotals.movDebit)}</td>
                      <td className={cn("px-4 py-4 font-mono border text-end text-red-600 tabular-nums", tbBorder)}>{formatMoney(trialBalanceTotals.movCredit)}</td>
                      <td className={cn("px-4 py-4 font-mono border text-end text-blue-600 tabular-nums", tbBorder)}>{formatMoney(trialBalanceTotals.clDebit)}</td>
                      <td className={cn("px-4 py-4 font-mono border text-end text-red-600 tabular-nums", tbBorder)}>{formatMoney(trialBalanceTotals.clCredit)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Balance Check Analysis */}
                <div className={cn("p-6 rounded-2xl border", ui.cardMuted)}>
                  <h4 className="text-lg font-bold mb-4 flex items-center gap-2">
                    <Calculator className="text-blue-500" size={20} />
                    {language === 'ar' ? 'التحليل المحاسبي للاتزان' : 'Accounting Balance Analysis'}
                  </h4>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center text-sm">
                      <span className={ui.mutedText}>{language === 'ar' ? 'إجمالي الحركات المدينة' : 'Total Debit Movements'}</span>
                      <span className="font-mono font-bold text-blue-500 tabular-nums">{formatMoney(trialBalanceTotals.movDebit)}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className={ui.mutedText}>{language === 'ar' ? 'إجمالي الحركات الدائنة' : 'Total Credit Movements'}</span>
                      <span className="font-mono font-bold text-red-500 tabular-nums">{formatMoney(trialBalanceTotals.movCredit)}</span>
                    </div>
                    <div className={cn("pt-4 border-t flex justify-between items-center font-black",
                      ui.borderSoft,
                      Math.abs(trialBalanceTotals.movDebit - trialBalanceTotals.movCredit) < 0.1 ? "text-green-500" : "text-red-500"
                    )}>
                      <span>{language === 'ar' ? 'الفرق (يجب أن يكون صفراً)' : 'Difference (Must be Zero)'}</span>
                      <span className="font-mono tabular-nums">{formatMoney(trialBalanceTotals.movDebit - trialBalanceTotals.movCredit)}</span>
                    </div>
                  </div>
                </div>

                {/* Account Type Summary */}
                <div className={cn("p-6 rounded-2xl border", ui.cardMuted)}>
                  <h4 className="text-lg font-bold mb-4 flex items-center gap-2">
                    <TrendingUp className="text-green-500" size={20} />
                    {language === 'ar' ? 'تحليل طبيعة الحسابات' : 'Account Type Analysis'}
                  </h4>
                  <div className="space-y-3">
                    {['asset', 'liability', 'equity', 'revenue', 'expense'].map(type => {
                      const typeAccounts = accounts.filter(a => a.type === type);
                      const typeTotal = trialBalance
                        .filter((i) => {
                          const code = String(i.code).trim();
                          if (isInventory127AccountCode(code)) {
                            return type === 'asset' && code === INVENTORY127_AGG_CODE;
                          }
                          return typeAccounts.some((ta) => String(ta.accountCode || ta.code).trim() === code);
                        })
                        .reduce((sum, i) => sum + (i.closingDebit - i.closingCredit), 0);

                      const labelAr = type === 'asset' ? 'الأصول' : type === 'liability' ? 'الخصوم' : type === 'equity' ? 'حقوق الملكية' : type === 'revenue' ? 'الإيرادات' : 'المصروفات';
                      const labelEn = type.charAt(0).toUpperCase() + type.slice(1) + 's';

                      return (
                        <div key={type} className="flex justify-between items-center text-sm">
                          <span className={ui.mutedText}>{language === 'ar' ? labelAr : labelEn}</span>
                          <span className={cn("font-mono font-bold tabular-nums", typeTotal >= 0 ? "text-blue-500" : "text-red-500")}>
                            {formatMoney(Math.abs(typeTotal))}
                            <span className="text-[10px] ml-1 opacity-50 uppercase tracking-tighter">
                              {typeTotal >= 0 ? (language === 'ar' ? 'مدين' : 'DR') : (language === 'ar' ? 'دائن' : 'CR')}
                            </span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="mt-8 flex justify-end items-center gap-4">
                <div className={cn("px-6 py-3 rounded-xl border flex items-center gap-3", 
                  Math.abs(trialBalanceTotals.movDebit - trialBalanceTotals.movCredit) < 0.1 ? "bg-green-900/10 border-green-900/30 text-green-500" : "bg-red-900/10 border-red-900/30 text-red-500"
                )}>
                  <div className={cn("w-3 h-3 rounded-full animate-pulse", Math.abs(trialBalanceTotals.movDebit - trialBalanceTotals.movCredit) < 0.1 ? "bg-green-500" : "bg-red-500")}></div>
                  <span className="font-bold uppercase tracking-widest text-sm">
                    {Math.abs(trialBalanceTotals.movDebit - trialBalanceTotals.movCredit) < 0.1 ? 
                      (language === 'ar' ? 'الميزان متزن تماماً' : 'Ledger is Perfectly Balanced') : 
                      (language === 'ar' ? 'يوجد فرق في الاتزان' : 'Ledger Out of Balance')}
                  </span>
                </div>
              </div>
            </div>
            );
          })()}

          {/* Time & Schedule View */}
          {activeReport === 'time' && (
            <div className="p-8" dir={printPreviewDir}>
              <div
                className={cn(
                  'flex items-center gap-3 mb-8 report-print-doc-title',
                  currentPrintProfile.titleAlign === 'start' && 'justify-start text-start',
                  currentPrintProfile.titleAlign === 'center' && 'justify-center text-center',
                  currentPrintProfile.titleAlign === 'end' && 'justify-end text-end',
                  currentPrintProfile.showHeader && currentPrintProfile.headerShowTitle && 'hidden',
                )}
              >
                <Clock className="text-purple-500" size={32} />
                <h3 className="text-2xl font-black">{language === 'ar' ? 'تقرير الانحراف الزمني والجدول الزمني' : 'Schedule & Time Variance Report'}</h3>
              </div>

              <div className="overflow-x-auto print:overflow-visible">
                <table className="w-full text-right border-collapse">
                  <thead>
                    <tr className={cn("border-b-2", ui.borderSoft)}>
                      <th className={cn("px-4 py-4 text-sm font-black uppercase", ui.mutedText)}>{language === 'ar' ? 'البند' : 'Item'}</th>
                      <th className={cn("px-4 py-4 text-sm font-black uppercase", ui.mutedText)}>{language === 'ar' ? 'البدء' : 'Start'}</th>
                      <th className={cn("px-4 py-4 text-sm font-black uppercase", ui.mutedText)}>{language === 'ar' ? 'المدة (يوم)' : 'Duration'}</th>
                      <th className={cn("px-4 py-4 text-sm font-black uppercase", ui.mutedText)}>{language === 'ar' ? 'نهاية متوقعة' : 'Exp. Finish'}</th>
                      <th className={cn("px-4 py-4 text-sm font-black uppercase", ui.mutedText)}>{language === 'ar' ? 'إنجاز الأعمال (آخر مستخلص)' : 'Physical (latest IPC)'}</th>
                      <th className={cn("px-4 py-4 text-sm font-black uppercase", ui.mutedText)}>{language === 'ar' ? 'الوقت المنقضي (زمني)' : 'Elapsed (schedule)'}</th>
                      <th className={cn("px-4 py-4 text-sm font-black uppercase", ui.mutedText)}>{language === 'ar' ? 'الحالة الزمنية' : 'Schedule Status'}</th>
                    </tr>
                  </thead>
                  <tbody className={cn("divide-y", ui.divider)}>
                    {scopedBoqItems
                      .filter(item => (selectedProjectId === 'all' || item.projectId === selectedProjectId) && (selectedContractId === 'all' || item.contractId === selectedContractId))
                      .map((item, timeIdx) => {
                        const tenderQty = item.tenderQty ?? 0;
                        const executedQty = getExecutedQtyFromBillings(item, latestIpcByContract, scopedBillings);
                        const physicalPct = tenderQty > 0 ? (executedQty / tenderQty) * 100 : 0;

                        const duration = item.expectedDuration || 0;
                        const hasSchedule = !!(item.startDate && item.expectedDuration);

                        const now = new Date();
                        now.setHours(0, 0, 0, 0);

                        let start: Date | null = null;
                        let end: Date | null = null;
                        if (item.startDate && item.expectedDuration) {
                          const [sy, sm, sd] = normalizeDate(item.startDate).split('-').map(Number);
                          start = new Date(sy, sm - 1, sd);
                          end = new Date(sy, sm - 1, sd + item.expectedDuration);
                        }

                        const elapsedDays = start
                          ? Math.max(0, Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)))
                          : 0;
                        const timeProgress = duration > 0 ? (elapsedDays / duration) * 100 : 0;

                        const isCompleted = physicalPct >= 99.9;
                        const notStarted = start ? start > now : false;
                        const isDelayed = end ? end < now && !isCompleted : false;

                        return (
                          <tr key={item.id || `time-boq-${item.itemCode}-${timeIdx}`} className={cn("transition-colors text-sm", ui.rowHover)}>
                            <td className="px-4 py-4">
                              <span className="font-bold block">{item.itemCode}</span>
                              <span className={cn("text-xs line-clamp-1", ui.subtleText)}>{item.description}</span>
                            </td>
                            <td className="px-4 py-4 font-mono tabular-nums">{item.startDate ? normalizeDate(item.startDate) : '-'}</td>
                            <td className="px-4 py-4 font-mono tabular-nums">{duration || '-'}</td>
                            <td className="px-4 py-4 font-mono tabular-nums text-blue-500">{end ? end.toLocaleDateString(locale) : '-'}</td>
                            <td className="px-4 py-4">
                              <div className="space-y-1 min-w-[100px]">
                                <div className="flex justify-between text-[10px] font-mono tabular-nums">
                                  <span>{physicalPct.toFixed(1)}%</span>
                                </div>
                                <div className={cn("w-full h-1.5 rounded-full", ui.trackBg)}>
                                  <div
                                    className={cn(
                                      'h-full rounded-full transition-all duration-500',
                                      physicalPct >= 99.9 ? 'bg-green-500' : 'bg-blue-500',
                                    )}
                                    style={{ width: `${Math.min(physicalPct, 100)}%` }}
                                  />
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              {hasSchedule ? (
                                <div className="flex flex-col gap-0.5">
                                  <div className="flex items-center gap-2">
                                    <div className={cn("flex-1 h-1.5 rounded-full overflow-hidden min-w-[60px]", ui.trackBg)}>
                                      <div
                                        className={cn('h-full rounded-full', timeProgress > 100 ? 'bg-red-500' : 'bg-purple-500')}
                                        style={{ width: `${Math.min(timeProgress, 100)}%` }}
                                      />
                                    </div>
                                    <span className="text-[10px] font-mono tabular-nums">{elapsedDays} {language === 'ar' ? 'يوم' : 'd'}</span>
                                  </div>
                                  <span className={cn("text-[9px] font-mono", ui.subtleText)}>
                                    {language === 'ar' ? 'تقدم زمني' : 'Time'} {timeProgress.toFixed(0)}%
                                  </span>
                                </div>
                              ) : (
                                <span className={cn("text-[10px]", ui.subtleText)}>—</span>
                              )}
                            </td>
                            <td className="px-4 py-4">
                              {isCompleted ? (
                                <span className={cn("px-2 py-1 rounded-md text-[10px] font-bold uppercase", theme === 'dark' ? "bg-green-900/20 text-green-400" : "bg-green-50 text-green-700")}>
                                  {language === 'ar' ? 'مكتمل' : 'Completed'}
                                </span>
                              ) : !hasSchedule ? (
                                <span className={cn("text-[10px]", ui.subtleText)}>
                                  {language === 'ar' ? 'غير مجدول زمنياً' : 'Not scheduled'}
                                </span>
                              ) : notStarted ? (
                                <span className={cn("px-2 py-1 rounded-md text-[10px] font-bold uppercase", theme === 'dark' ? "bg-gray-800 text-gray-400" : "bg-gray-100 text-gray-600")}>
                                  {language === 'ar' ? 'لم يبدأ' : 'Not started'}
                                </span>
                              ) : isDelayed ? (
                                <span className={cn("px-2 py-1 rounded-md text-[10px] font-bold uppercase", theme === 'dark' ? "bg-red-900/20 text-red-400" : "bg-red-50 text-red-700")}>
                                  {language === 'ar' ? 'متأخر' : 'Delayed'}
                                </span>
                              ) : (
                                <span className={cn("px-2 py-1 rounded-md text-[10px] font-bold uppercase", theme === 'dark' ? "bg-blue-900/20 text-blue-400" : "bg-blue-50 text-blue-700")}>
                                  {language === 'ar' ? 'قيد التنفيذ' : 'In progress'}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        {activeReport === 'liquidity' && (
          <div className="print:p-0">
            <LiquidityReport embedded />
          </div>
        )}

        {activeReport === 'costs' && (
          <BoqCostBreakdownReport
            selectedProjectId={selectedProjectId}
            selectedContractId={selectedContractId}
            costLevel={costLevel}
            onCostLevelChange={setCostLevel}
            dateFrom={costDateFrom}
            dateTo={costDateTo}
            onDateFromChange={setCostDateFrom}
            onDateToChange={setCostDateTo}
            theme={theme}
            language={language}
            dir={printPreviewDir}
            locale={locale}
            ui={ui}
            t={t}
            hideDocTitle={currentPrintProfile.showHeader && currentPrintProfile.headerShowTitle}
          />
        )}
            </div>

            {currentPrintProfile.showFooter ? (
              <footer
                className="report-print-footer report-print-footer--screen border-t border-slate-200"
                data-footer-align={currentPrintProfile.footerAlign}
                style={{
                  textAlign:
                    currentPrintProfile.footerAlign === 'start'
                      ? 'start'
                      : currentPrintProfile.footerAlign === 'end'
                        ? 'end'
                        : 'center',
                }}
              >
                {(() => {
                  const companyLine = currentPrintProfile.footerShowCompany
                    ? language === 'ar'
                      ? companyInfo.companyName
                      : companyInfo.companyNameEn || companyInfo.companyName
                    : '';
                  const textParts: string[] = [];
                  if (currentPrintProfile.footerShowText) {
                    textParts.push(
                      language === 'ar'
                        ? companyInfo.footerText || 'نظام إدارة التكاليف'
                        : companyInfo.footerTextEn ||
                            companyInfo.footerText ||
                            'Cost Management System',
                    );
                  }
                  if (currentPrintProfile.footerExtraText.trim()) {
                    textParts.push(currentPrintProfile.footerExtraText.trim());
                  }
                  if (currentPrintProfile.footerShowNote) {
                    textParts.push(
                      language === 'ar'
                        ? 'تم استخراج هذا التقرير آلياً'
                        : 'This report was generated automatically',
                    );
                  }
                  const midLine = textParts.join(' · ');
                  const pageLine = currentPrintProfile.footerShowPageNum
                    ? language === 'ar'
                      ? 'صفحة 1'
                      : 'Page 1'
                    : '';
                  return (
                    <div className="report-print-footer-inner">
                      <p className="report-print-footer-line">{companyLine || '\u00a0'}</p>
                      <p className="report-print-footer-line">{midLine || '\u00a0'}</p>
                      <p className="report-print-footer-line">{pageLine || '\u00a0'}</p>
                    </div>
                  );
                })()}
              </footer>
            ) : null}
          </div>
        )}
      </div>{/* /report-print-area */}
      </div>{/* /report-page-viewer */}
    </div>
  );
}
