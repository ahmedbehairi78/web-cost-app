import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, CheckCircle2, Layers, Loader2, Lock, Pencil, Plus, RefreshCw, RotateCcw, Save, Shield, Unlock, X } from 'lucide-react';
import { IncomeStatementClosingPanel } from './gl/IncomeStatementClosingPanel';
import { PeriodLockPanel } from './gl/PeriodLockPanel';
import { periodRangeForCadence, type ClosingType, type PeriodCadence } from '../lib/accountingPeriodCadence';
import toast from 'react-hot-toast';
import { cn } from '../lib/utils';
import { useLanguage } from '../context/LanguageContext';
import { usePermissions } from '../context/PermissionsContext';
import { overheadAllocationApi } from '../services/local/modulesApi';
import { ApiError } from '../lib/apiClient';
import { MONEY_TOLERANCE, roundMoney } from '../lib/money';
import { ManualHelpButton } from './help/ManualHelpButton';

import type { AppTheme } from '../lib/shellTheme';
type Theme = AppTheme;

type DistributionBasis = 'billing_works' | 'contract_value' | 'equal';
type BoqLoadingBasis = 'boq_value' | 'boq_qty' | 'equal';

type Period = {
  id: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  distributionBasis?: string;
  boqLoadingBasis?: string;
  notes?: string | null;
};

type PreviewLine = {
  indirectCenterId: string;
  indirectCenterCode: string;
  indirectCenterName?: string;
  accountCode: string;
  accountName?: string | null;
  contractId: string;
  contractName: string;
  contractNumber: string;
  weight: number;
  ratio: number;
  amount: number;
  computedAmount?: number;
  revenue: number;
};

type JournalPreview = {
  indirectCenterCode: string;
  indirectCenterName: string;
  accountCode: string;
  reference: string;
  description: string;
  poolAmount: number;
  allocatedTotal: number;
  entries: Array<{
    side: 'debit' | 'credit';
    accountCode: string;
    amount: number;
    costCenterLabel: string;
  }>;
};

type Preview = {
  pools: Array<{ indirectCenterId: string; indirectCenterCode: string; indirectCenterName: string; accountCode: string; poolAmount: number }>;
  weights: Array<{ contractId: string; contractName: string; contractNumber: string; weight: number; ratio: number }>;
  revenue: Array<{ contractId: string; contractName: string; contractNumber: string; revenue: number; ratio: number; weight?: number }>;
  totalWeight: number;
  totalRevenue: number;
  distributionBasis?: string;
  boqLoadingBasis?: string;
  lines: PreviewLine[];
  computedLines?: PreviewLine[];
  hasProposedLines?: boolean;
  isAdjusted?: boolean;
  totalPoolAmount?: number;
  totalAllocated?: number;
  contractSummaries?: Array<{ contractId: string; contractName: string; contractNumber: string; totalAllocated: number; lineCount: number }>;
  journalPreviews?: JournalPreview[];
  indirectCenterSelection?: Array<{
    id: string;
    code: string;
    name: string;
    nameEn?: string | null;
    included: boolean;
    poolTotal: number;
  }>;
  includedIndirectCenterIds?: string[];
  excludedPoolTotal?: number;
};

type ClosedLine = {
  contractNumber: string;
  contractName: string;
  indirectCenterCode: string;
  accountCode: string;
  amount: number;
};

type EditableLine = PreviewLine & { key: string };

const BALANCE_EPS = MONEY_TOLERANCE;

function lineKey(l: Pick<PreviewLine, 'indirectCenterId' | 'accountCode' | 'contractId'>) {
  return `${l.indirectCenterId}|${l.accountCode}|${l.contractId}`;
}

function poolGroupKey(indirectCenterId: string, accountCode: string) {
  return `${indirectCenterId}|${accountCode}`;
}

function toEditableLines(lines: PreviewLine[]): EditableLine[] {
  return lines.map((l) => ({ ...l, key: lineKey(l) }));
}

const CADENCE_OPTIONS: PeriodCadence[] = ['monthly', 'quarterly', 'semi_annual', 'annual'];

const CLOSING_TYPES: Array<{ id: ClosingType; icon: typeof Layers }> = [
  { id: 'oha', icon: Layers },
  { id: 'income_statement', icon: BarChart3 },
  { id: 'period_lock', icon: Shield },
];

export function OverheadAllocation({ embedded = false }: { embedded?: boolean }) {
  const { t, language, theme, dir, locale, formatMoney } = useLanguage();
  const { can } = usePermissions();
  const canWrite = can('overhead').create || can('overhead').edit;
  const qDefault = useMemo(() => periodRangeForCadence('quarterly'), []);
  const fmtNum = (n: number) => formatMoney(n);

  const [closingType, setClosingType] = useState<ClosingType>('oha');
  const [cadence, setCadence] = useState<PeriodCadence>('quarterly');
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [editableLines, setEditableLines] = useState<EditableLine[]>([]);
  const [closedLines, setClosedLines] = useState<ClosedLine[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [closing, setClosing] = useState(false);
  const [savingAdjustments, setSavingAdjustments] = useState(false);
  const [savingBasis, setSavingBasis] = useState(false);
  const [savingCenters, setSavingCenters] = useState(false);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [showJournalPreview, setShowJournalPreview] = useState(true);
  const [form, setForm] = useState({
    label: qDefault.label,
    periodStart: qDefault.start,
    periodEnd: qDefault.end,
    notes: '',
    distributionBasis: 'billing_works' as DistributionBasis,
    boqLoadingBasis: 'boq_value' as BoqLoadingBasis,
  });

  const loadPeriods = useCallback(async () => {
    setLoading(true);
    try {
      const rows = (await overheadAllocationApi.listPeriods()) as Period[];
      setPeriods(rows);
      if (!selectedId && rows[0]) setSelectedId(rows[0].id);
    } catch {
      toast.error(t('overhead_close_failed'));
    } finally {
      setLoading(false);
    }
  }, [selectedId, t]);

  useEffect(() => {
    void loadPeriods();
  }, [loadPeriods]);

  const selected = useMemo(() => periods.find((p) => p.id === selectedId), [periods, selectedId]);

  const applyPreview = useCallback((data: Preview) => {
    setPreview(data);
    setEditableLines(toEditableLines(data.lines ?? []));
  }, []);

  const loadPreview = useCallback(async (id: string) => {
    setPreviewLoading(true);
    try {
      const data = (await overheadAllocationApi.preview(id)) as Preview;
      applyPreview(data);
    } catch {
      setPreview(null);
      setEditableLines([]);
      toast.error(t('overhead_close_failed'));
    } finally {
      setPreviewLoading(false);
    }
  }, [applyPreview, t]);

  const loadClosedLines = useCallback(async (id: string) => {
    try {
      const rows = (await overheadAllocationApi.listLines(id)) as ClosedLine[];
      setClosedLines(rows);
    } catch {
      setClosedLines([]);
    }
  }, []);

  useEffect(() => {
    if (!selectedId || !selected) {
      setPreview(null);
      setEditableLines([]);
      setClosedLines([]);
      return;
    }
    if (selected.status === 'draft') {
      void loadPreview(selectedId);
      setClosedLines([]);
    } else {
      setPreview(null);
      setEditableLines([]);
      void loadClosedLines(selectedId);
    }
  }, [selectedId, selected, loadPreview, loadClosedLines]);

  const isDirty = useMemo(() => {
    if (!preview?.lines?.length) return false;
    const saved = new Map(preview.lines.map((l) => [lineKey(l), l.amount]));
    return editableLines.some((l) => {
      const prev = saved.get(l.key);
      return prev === undefined || Math.abs(prev - l.amount) > BALANCE_EPS;
    });
  }, [preview, editableLines]);

  const poolBalances = useMemo(() => {
    if (!preview?.pools?.length) return [];
    return preview.pools.map((pool) => {
      const key = poolGroupKey(pool.indirectCenterId, pool.accountCode);
      const allocated = roundMoney(
        editableLines
          .filter((l) => poolGroupKey(l.indirectCenterId, l.accountCode) === key)
          .reduce((s, l) => s + (Number(l.amount) || 0), 0),
      );
      return {
        key,
        pool,
        allocated,
        balanced: Math.abs(allocated - pool.poolAmount) <= BALANCE_EPS,
      };
    });
  }, [preview, editableLines]);

  const localContractSummaries = useMemo(() => {
    const map = new Map<string, { contractId: string; contractName: string; contractNumber: string; totalAllocated: number; lineCount: number }>();
    for (const l of editableLines) {
      if (l.amount <= BALANCE_EPS) continue;
      const prev = map.get(l.contractId);
      if (prev) {
        prev.totalAllocated = roundMoney(prev.totalAllocated + l.amount);
        prev.lineCount += 1;
      } else {
        map.set(l.contractId, {
          contractId: l.contractId,
          contractName: l.contractName,
          contractNumber: l.contractNumber,
          totalAllocated: l.amount,
          lineCount: 1,
        });
      }
    }
    return [...map.values()].sort((a, b) => b.totalAllocated - a.totalAllocated);
  }, [editableLines]);

  const allPoolsBalanced = poolBalances.every((p) => p.balanced);
  const hasPools = (preview?.pools?.length ?? 0) > 0;
  const displayContractSummaries = isDirty ? localContractSummaries : (preview?.contractSummaries ?? localContractSummaries);

  const inputCls = cn(
    'w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500',
    theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200',
  );
  const btnSmCls = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold';

  const basisLabel = (basis: string) => {
    if (basis === 'contract_value') return t('overhead_distribution_contract');
    if (basis === 'equal') return t('overhead_distribution_equal');
    return t('overhead_distribution_billing');
  };

  const handleCreate = async () => {
    if (!form.label.trim() || !form.periodStart || !form.periodEnd) return;
    try {
      const row = (await overheadAllocationApi.createPeriod({
        label: form.label.trim(),
        periodStart: form.periodStart,
        periodEnd: form.periodEnd,
        notes: form.notes.trim() || undefined,
        distributionBasis: form.distributionBasis,
        boqLoadingBasis: form.boqLoadingBasis,
      })) as Period;
      const next = periodRangeForCadence(cadence);
      setForm({
        label: next.label,
        periodStart: next.start,
        periodEnd: next.end,
        notes: '',
        distributionBasis: 'billing_works',
        boqLoadingBasis: 'boq_value',
      });
      await loadPeriods();
      setSelectedId(row.id);
      toast.success(t('save'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.error(t('overhead_period_duplicate'));
      } else {
        toast.error(e instanceof Error ? e.message : t('overhead_close_failed'));
      }
    }
  };

  const handleUpdateBasis = async (patch: { distributionBasis?: DistributionBasis; boqLoadingBasis?: BoqLoadingBasis }) => {
    if (!selectedId || !selected || selected.status !== 'draft') return;
    setSavingBasis(true);
    try {
      await overheadAllocationApi.updatePeriod(selectedId, patch);
      await loadPeriods();
      void loadPreview(selectedId);
      toast.success(t('save'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('overhead_close_failed'));
    } finally {
      setSavingBasis(false);
    }
  };

  const persistIncludedCenters = async (ids: string[]) => {
    if (!selectedId || !selected || selected.status !== 'draft' || !canWrite) return;
    setSavingCenters(true);
    try {
      await overheadAllocationApi.updatePeriod(selectedId, { includedIndirectCenterIds: ids });
      await loadPreview(selectedId);
      toast.success(t('save'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('overhead_close_failed'));
    } finally {
      setSavingCenters(false);
    }
  };

  const handleToggleCenter = (centerId: string, included: boolean) => {
    if (!preview?.indirectCenterSelection?.length) return;
    const current = preview.indirectCenterSelection.filter((c) => c.included).map((c) => c.id);
    const next = included
      ? [...new Set([...current, centerId])]
      : current.filter((id) => id !== centerId);
    void persistIncludedCenters(next);
  };

  const handleSelectAllCenters = () => {
    if (!preview?.indirectCenterSelection?.length) return;
    void persistIncludedCenters(preview.indirectCenterSelection.map((c) => c.id));
  };

  const handleDeselectAllCenters = () => {
    void persistIncludedCenters([]);
  };

  const handleLineAmountChange = (key: string, raw: string) => {
    const parsed = parseFloat(raw.replace(/,/g, ''));
    const amount = Number.isFinite(parsed) ? Math.max(0, roundMoney(parsed)) : 0;
    setEditableLines((rows) => rows.map((r) => (r.key === key ? { ...r, amount } : r)));
  };

  const buildProposedPayload = () =>
    editableLines
      .filter((l) => l.amount > BALANCE_EPS)
      .map((l) => ({
        indirectCenterId: l.indirectCenterId,
        contractId: l.contractId,
        accountCode: l.accountCode,
        amount: l.amount,
      }));

  const handleSaveAdjustments = async () => {
    if (!selectedId || !allPoolsBalanced) {
      toast.error(t('overhead_pool_balance_bad'));
      return;
    }
    setSavingAdjustments(true);
    try {
      const data = (await overheadAllocationApi.saveProposedLines(selectedId, buildProposedPayload())) as Preview;
      applyPreview(data);
      toast.success(t('overhead_saved_adjustments'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('overhead_close_failed'));
    } finally {
      setSavingAdjustments(false);
    }
  };

  const handleResetComputed = async () => {
    if (!selectedId) return;
    setSavingAdjustments(true);
    try {
      const data = (await overheadAllocationApi.clearProposedLines(selectedId)) as Preview;
      applyPreview(data);
      toast.success(t('overhead_reset_done'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('overhead_close_failed'));
    } finally {
      setSavingAdjustments(false);
    }
  };

  const handleRejectLocal = () => {
    if (!preview?.lines) return;
    setEditableLines(toEditableLines(preview.lines));
    toast.success(t('overhead_reset_done'));
  };

  const handleClose = async () => {
    if (!selectedId) return;
    if (isDirty) {
      toast.error(t('overhead_unsaved_changes'));
      return;
    }
    if (!allPoolsBalanced) {
      toast.error(t('overhead_pool_balance_bad'));
      return;
    }
    setClosing(true);
    try {
      await overheadAllocationApi.close(selectedId);
      toast.success(t('overhead_closed'));
      setShowApprovalModal(false);
      await loadPeriods();
      setPreview(null);
      setEditableLines([]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('overhead_close_failed');
      toast.error(msg.includes('zero') || msg.includes('Cannot close') ? t('overhead_no_revenue') : msg);
    } finally {
      setClosing(false);
    }
  };

  const handleReopen = async () => {
    if (!selectedId || !canWrite) return;
    try {
      await overheadAllocationApi.reopen(selectedId);
      toast.success(t('save'));
      await loadPeriods();
      void loadPreview(selectedId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('overhead_close_failed'));
    }
  };

  const openApproval = () => {
    if (isDirty) {
      toast.error(t('overhead_unsaved_changes'));
      return;
    }
    if (!allPoolsBalanced) {
      toast.error(t('overhead_pool_balance_bad'));
      return;
    }
    setShowApprovalModal(true);
  };

  const cardCls = cn(
    'rounded-xl border p-4',
    theme === 'dark' ? 'border-gray-800 bg-gray-900/40' : theme === 'soft' ? 'border-[#cfd8dc] bg-white' : 'border-gray-200 bg-white',
  );

  const sectionTitleCls = 'text-xs font-bold uppercase tracking-wide text-gray-500 mb-2';

  const applyCadenceToForm = (nextCadence: PeriodCadence) => {
    const range = periodRangeForCadence(nextCadence);
    setCadence(nextCadence);
    setForm((f) => ({
      ...f,
      label: range.label,
      periodStart: range.start,
      periodEnd: range.end,
    }));
  };

  const cadenceLabel = (c: PeriodCadence) => {
    if (c === 'monthly') return t('gl_periods_cadence_monthly');
    if (c === 'semi_annual') return t('gl_periods_cadence_semi_annual');
    if (c === 'annual') return t('gl_periods_cadence_annual');
    return t('gl_periods_cadence_quarterly');
  };

  const closingTypeLabel = (type: ClosingType) =>
    type === 'income_statement'
      ? t('gl_periods_type_income')
      : type === 'period_lock'
        ? t('period_lock_title')
        : t('gl_periods_type_oha');

  const closingTypeDesc = (type: ClosingType) =>
    type === 'income_statement'
      ? t('gl_periods_type_income_desc')
      : type === 'period_lock'
        ? t('period_lock_desc')
        : t('gl_periods_type_oha_desc');

  return (
    <div className={cn('min-h-screen transition-colors', embedded ? 'p-0' : 'p-8', !embedded && (theme === 'dark' ? 'bg-[#0a0a0a] text-gray-100' : 'bg-gray-50 text-gray-900'))} dir={dir}>
      {!embedded && (
        <header className="mb-6">
          <h2 className="text-3xl font-bold">{t('overhead_module_title')}</h2>
          <p className="text-sm text-gray-400 mt-1">{t('overhead_module_desc')}</p>
        </header>
      )}

      <div
        className={cn(
          'flex flex-col md:flex-row md:items-start gap-4',
          dir === 'rtl' ? 'md:flex-row-reverse' : '',
        )}
      >
        <div className="flex-1 min-w-0 md:flex-[3] space-y-4 order-2 md:order-none">
        {closingType !== 'period_lock' && (
        <aside className={cn(cardCls, 'space-y-4')}>
          <div>
            <h3 className="font-bold text-sm">{t('gl_periods_settings_title')}</h3>
          </div>

          {closingType === 'oha' && (
            <div>
              <p className={sectionTitleCls}>{t('gl_periods_list_title')}</p>
              {loading ? (
                <Loader2 className="animate-spin mx-auto" size={20} />
              ) : periods.length === 0 ? (
                <p className="text-xs text-gray-500">{t('gl_periods_empty_list')}</p>
              ) : (
                <ul className="space-y-1 max-h-28 overflow-auto">
                  {periods.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(p.id)}
                        className={cn(
                          'w-full text-start px-2.5 py-1 rounded-lg text-sm border transition-colors',
                          selectedId === p.id
                            ? 'bg-blue-600 text-white border-blue-600'
                            : theme === 'dark'
                              ? 'text-gray-300 border-gray-800 hover:bg-gray-800'
                              : 'text-gray-700 border-gray-200 hover:bg-gray-50',
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0 min-h-[1.25rem] leading-tight">
                          <span className="font-bold shrink-0">{p.label}</span>
                          <span className="text-xs opacity-80 shrink-0">{p.periodStart} → {p.periodEnd}</span>
                          <span className="text-[10px] opacity-75 shrink-0">
                            {p.status === 'closed' ? t('overhead_status_closed') : t('overhead_status_draft')}
                          </span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className={cn('pt-3 border-t space-y-3', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
            <p className={sectionTitleCls}>{t('gl_periods_dates_title')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="min-w-0">
                <label className="text-xs text-gray-500 block mb-1">{t('overhead_label')}</label>
                <input
                  className={inputCls}
                  placeholder={t('overhead_label')}
                  value={form.label}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                />
              </div>
              <div className="min-w-0">
                <label className="text-xs text-gray-500 block mb-1">{t('overhead_period_start')}</label>
                <input
                  type="date"
                  aria-label={t('overhead_period_start')}
                  className={inputCls}
                  value={form.periodStart}
                  onChange={(e) => setForm((f) => ({ ...f, periodStart: e.target.value }))}
                />
              </div>
              <div className="min-w-0">
                <label className="text-xs text-gray-500 block mb-1">{t('overhead_period_end')}</label>
                <input
                  type="date"
                  aria-label={t('overhead_period_end')}
                  className={inputCls}
                  value={form.periodEnd}
                  onChange={(e) => setForm((f) => ({ ...f, periodEnd: e.target.value }))}
                />
              </div>
            </div>
          </div>

          {closingType === 'oha' && (
            <div className={cn('pt-3 border-t space-y-3', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="min-w-0">
                  <label className="text-xs text-gray-500 block mb-1">{t('overhead_revenue_basis')}</label>
                  <select
                    className={inputCls}
                    value={selected?.status === 'draft' && selectedId ? (selected.distributionBasis ?? 'billing_works') : form.distributionBasis}
                    disabled={!!(selected?.status === 'draft' && selectedId && savingBasis)}
                    onChange={(e) => {
                      const v = e.target.value as DistributionBasis;
                      if (selected?.status === 'draft' && selectedId) {
                        void handleUpdateBasis({ distributionBasis: v });
                      } else {
                        setForm((f) => ({ ...f, distributionBasis: v }));
                      }
                    }}
                  >
                    <option value="billing_works">{t('overhead_distribution_billing')}</option>
                    <option value="contract_value">{t('overhead_distribution_contract')}</option>
                    <option value="equal">{t('overhead_distribution_equal')}</option>
                  </select>
                </div>
                <div className="min-w-0">
                  <label className="text-xs text-gray-500 block mb-1">{t('overhead_boq_loading_basis')}</label>
                  <select
                    className={inputCls}
                    value={selected?.status === 'draft' && selectedId ? (selected.boqLoadingBasis ?? 'boq_value') : form.boqLoadingBasis}
                    disabled={!!(selected?.status === 'draft' && selectedId && savingBasis)}
                    onChange={(e) => {
                      const v = e.target.value as BoqLoadingBasis;
                      if (selected?.status === 'draft' && selectedId) {
                        void handleUpdateBasis({ boqLoadingBasis: v });
                      } else {
                        setForm((f) => ({ ...f, boqLoadingBasis: v }));
                      }
                    }}
                  >
                    <option value="boq_value">{t('overhead_boq_value')}</option>
                    <option value="boq_qty">{t('overhead_boq_qty')}</option>
                    <option value="equal">{t('overhead_boq_equal')}</option>
                  </select>
                </div>
              </div>
              {canWrite && (
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  className={cn(btnSmCls, 'bg-blue-600 text-white')}
                >
                  <Plus size={14} /> {t('overhead_new_period')}
                </button>
              )}
            </div>
          )}
        </aside>
        )}

        {closingType === 'income_statement' ? (
          <IncomeStatementClosingPanel
            periodStart={form.periodStart}
            periodEnd={form.periodEnd}
            label={form.label}
            cadence={cadence}
            theme={theme}
            compact
          />
        ) : closingType === 'period_lock' ? (
          <PeriodLockPanel theme={theme} compact />
        ) : (
        <div className={cardCls}>
          <p className={cn(sectionTitleCls, 'mb-2')}>{t('overhead_periods')}</p>
          {!selected ? (
            <p className="text-gray-500 text-xs py-4 text-center">{t('gl_periods_select_or_create')}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div>
                  <h3 className="text-sm font-bold">{selected.label}</h3>
                  <p className="text-[11px] text-gray-400">{selected.periodStart} — {selected.periodEnd}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">{basisLabel(selected.distributionBasis ?? 'billing_works')}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {selected.status === 'draft' && (
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => selectedId && void loadPreview(selectedId)} className={cn('inline-flex items-center gap-1 border', btnSmCls)}>
                        <RefreshCw size={12} /> {t('overhead_preview')}
                      </button>
                      <ManualHelpButton topicId="ledger.overhead.close" size={14} />
                    </div>
                  )}
                  {selected.status === 'draft' && canWrite && hasPools && (
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={openApproval} className={cn('inline-flex items-center gap-1 bg-amber-600 text-white font-bold', btnSmCls)}>
                        <Lock size={12} /> {t('overhead_approve_close')}
                      </button>
                      <ManualHelpButton topicId="ledger.overhead.close" size={16} />
                    </div>
                  )}
                  {selected.status === 'closed' && canWrite && (
                    <button type="button" onClick={() => void handleReopen()} className={cn('inline-flex items-center gap-1 border border-red-500 text-red-500 font-bold', btnSmCls)}>
                      <Unlock size={12} /> {t('overhead_reopen')}
                    </button>
                  )}
                </div>
              </div>

              {previewLoading ? (
                <Loader2 className="animate-spin mx-auto" />
              ) : preview && selected.status === 'draft' ? (
                <div className="space-y-5">
                  <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4">
                    <h4 className="font-bold text-sm mb-1">{t('overhead_review_title')}</h4>
                    <p className="text-xs text-gray-500">{t('overhead_review_desc')}</p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {preview.isAdjusted || preview.hasProposedLines ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-600 font-bold">
                          <Pencil size={12} /> {t('overhead_adjusted_badge')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-600 font-bold">
                          <CheckCircle2 size={12} /> {t('overhead_computed_badge')}
                        </span>
                      )}
                      {isDirty && (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-500 font-bold">
                          <AlertTriangle size={12} /> {t('overhead_unsaved_changes')}
                        </span>
                      )}
                    </div>
                  </div>

                  {(preview.indirectCenterSelection?.length ?? 0) > 0 && (
                    <div className={cn('rounded-xl border p-4', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
                      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                        <div>
                          <h4 className="font-bold text-sm">{t('overhead_included_centers')}</h4>
                          <p className="text-xs text-gray-500 mt-1">{t('overhead_included_centers_hint')}</p>
                        </div>
                        {canWrite && (
                          <div className="flex gap-2 text-xs">
                            <button type="button" disabled={savingCenters} onClick={handleSelectAllCenters} className="px-2 py-1 rounded border">
                              {t('overhead_select_all_centers')}
                            </button>
                            <button type="button" disabled={savingCenters} onClick={handleDeselectAllCenters} className="px-2 py-1 rounded border">
                              {t('overhead_deselect_all_centers')}
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="space-y-2">
                        {preview.indirectCenterSelection!.map((c) => {
                          const label = language === 'ar' ? c.name : (c.nameEn || c.name);
                          return (
                            <label
                              key={c.id}
                              className={cn(
                                'flex flex-wrap items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer',
                                c.included
                                  ? theme === 'dark' ? 'border-blue-800/50 bg-blue-900/20' : 'border-blue-200 bg-blue-50/50'
                                  : theme === 'dark' ? 'border-gray-800 opacity-70' : 'border-gray-200 opacity-80',
                                (!canWrite || savingCenters) && 'pointer-events-none opacity-60',
                              )}
                            >
                              <input
                                type="checkbox"
                                className="rounded border-gray-500"
                                checked={c.included}
                                disabled={!canWrite || savingCenters}
                                onChange={(e) => handleToggleCenter(c.id, e.target.checked)}
                              />
                              <span className="font-mono text-xs text-gray-500">{c.code}</span>
                              <span className="text-sm font-medium flex-1 min-w-[8rem]">{label}</span>
                              <span className="text-xs text-gray-500">{t('overhead_center_period_expense')}:</span>
                              <span className={cn('text-sm font-bold tabular-nums', c.included ? 'text-orange-500' : 'text-gray-400')}>
                                {fmtNum(c.poolTotal)}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      {(preview.excludedPoolTotal ?? 0) > BALANCE_EPS && (
                        <p className="text-xs text-amber-600 mt-3">
                          {t('overhead_excluded_pool')}: {fmtNum(preview.excludedPoolTotal ?? 0)}
                        </p>
                      )}
                      {savingCenters && <Loader2 className="animate-spin mt-2" size={16} />}
                    </div>
                  )}

                  {!hasPools ? (
                    <p className="text-sm text-gray-500">{t('overhead_no_pools')}</p>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        <div className={cn('p-3 rounded-xl border', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
                          <p className="text-[10px] uppercase text-gray-500">{t('overhead_summary_pool')}</p>
                          <p className="text-lg font-black text-orange-500 tabular-nums">{fmtNum(preview.totalPoolAmount ?? 0)}</p>
                        </div>
                        <div className={cn('p-3 rounded-xl border', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
                          <p className="text-[10px] uppercase text-gray-500">{t('overhead_summary_allocated')}</p>
                          <p className={cn('text-lg font-black tabular-nums', allPoolsBalanced ? 'text-emerald-500' : 'text-red-500')}>
                            {fmtNum(editableLines.reduce((s, l) => s + l.amount, 0))}
                          </p>
                        </div>
                        <div className={cn('p-3 rounded-xl border', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
                          <p className="text-[10px] uppercase text-gray-500">{t('overhead_summary_contracts')}</p>
                          <p className="text-lg font-black text-blue-500 tabular-nums">{displayContractSummaries.length}</p>
                        </div>
                      </div>

                      {canWrite && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={savingAdjustments || !isDirty || !allPoolsBalanced}
                            onClick={() => void handleSaveAdjustments()}
                            className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-bold disabled:opacity-40"
                          >
                            {savingAdjustments ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
                            {t('overhead_save_adjustments')}
                          </button>
                          <button
                            type="button"
                            disabled={savingAdjustments}
                            onClick={() => void handleResetComputed()}
                            className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border text-sm"
                          >
                            <RotateCcw size={14} /> {t('overhead_reset_computed')}
                          </button>
                          {isDirty && (
                            <button type="button" onClick={handleRejectLocal} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-red-500/50 text-red-500 text-sm">
                              <X size={14} /> {t('overhead_reject_changes')}
                            </button>
                          )}
                        </div>
                      )}

                      <div>
                        <h4 className="font-bold text-sm mb-2">{t('overhead_pool')}</h4>
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-500 border-b">
                              <th className="py-1 text-start">{t('indirect_centers_code')}</th>
                              <th className="py-1 text-start">{language === 'ar' ? 'حساب' : 'Account'}</th>
                              <th className="py-1 text-end">{t('total_amount')}</th>
                              <th className="py-1 text-end">{language === 'ar' ? 'موزّع' : 'Allocated'}</th>
                              <th className="py-1 text-end">{language === 'ar' ? 'حالة' : 'Status'}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {poolBalances.map(({ pool, allocated, balanced }) => (
                              <tr key={`${pool.indirectCenterCode}-${pool.accountCode}`} className="border-b border-gray-800/30">
                                <td className="py-1">{pool.indirectCenterCode}</td>
                                <td className="py-1 font-mono">{pool.accountCode}</td>
                                <td className="py-1 text-end">{fmtNum(pool.poolAmount)}</td>
                                <td className={cn('py-1 text-end font-bold', balanced ? 'text-emerald-500' : 'text-red-500')}>{fmtNum(allocated)}</td>
                                <td className="py-1 text-end text-[10px]">{balanced ? t('overhead_pool_balance_ok') : t('overhead_pool_balance_bad')}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {displayContractSummaries.length > 0 && (
                        <div>
                          <h4 className="font-bold text-sm mb-2">{t('overhead_per_contract')}</h4>
                          <table className="w-full text-xs mb-2">
                            <thead>
                              <tr className="text-gray-500 border-b">
                                <th className="py-1 text-start">{language === 'ar' ? 'عقد' : 'Contract'}</th>
                                <th className="py-1 text-end">{language === 'ar' ? 'محمّل' : 'Allocated'}</th>
                                <th className="py-1 text-end">{language === 'ar' ? 'سطور' : 'Lines'}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {displayContractSummaries.map((c) => (
                                <tr key={c.contractId} className="border-b border-gray-800/20">
                                  <td className="py-1">{c.contractNumber} {c.contractName}</td>
                                  <td className="py-1 text-end font-bold">{fmtNum(c.totalAllocated)}</td>
                                  <td className="py-1 text-end">{c.lineCount}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {(preview.weights?.length ?? preview.revenue?.length ?? 0) > 0 && (
                        <details className="rounded-xl border border-gray-700/30 p-3">
                          <summary className="font-bold text-sm cursor-pointer">{t('overhead_contract_weights')}</summary>
                          <table className="w-full text-xs mt-3">
                            <thead>
                              <tr className="text-gray-500 border-b">
                                <th className="py-1 text-start">{language === 'ar' ? 'عقد' : 'Contract'}</th>
                                <th className="py-1 text-end">{t('overhead_weight_col')}</th>
                                <th className="py-1 text-end">%</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(preview.weights ?? preview.revenue.map((r) => ({ ...r, weight: r.revenue ?? r.weight ?? 0 }))).map((w) => (
                                <tr key={w.contractId} className="border-b border-gray-800/20">
                                  <td className="py-1">{w.contractNumber} {w.contractName}</td>
                                  <td className="py-1 text-end">{(w.weight ?? w.revenue ?? 0).toLocaleString(locale)}</td>
                                  <td className="py-1 text-end">{w.ratio.toFixed(1)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </details>
                      )}

                      <div>
                        <h4 className="font-bold text-sm mb-2">{t('overhead_preview')}</h4>
                        <div className="overflow-x-auto max-h-[28rem] border rounded-xl">
                          <table className="w-full text-xs">
                            <thead className="sticky top-0 z-10 bg-gray-900/90">
                              <tr className="text-gray-500 border-b">
                                <th className="py-2 px-2 text-start">{t('indirect_centers_code')}</th>
                                <th className="py-2 px-2 text-start">{language === 'ar' ? 'عقد' : 'Contract'}</th>
                                <th className="py-2 px-2 text-end">{language === 'ar' ? 'تلقائي' : 'Auto'}</th>
                                <th className="py-2 px-2 text-end">{language === 'ar' ? 'محمّل' : 'Allocated'}</th>
                                {canWrite && <th className="py-2 px-2 text-end">{t('overhead_edit_amount')}</th>}
                              </tr>
                            </thead>
                            <tbody>
                              {editableLines.map((l) => {
                                const delta = l.computedAmount !== undefined ? l.amount - l.computedAmount : 0;
                                const showDelta = Math.abs(delta) > BALANCE_EPS;
                                return (
                                  <tr key={l.key} className="border-b border-gray-800/20">
                                    <td className="py-1 px-2">{l.indirectCenterCode} / {l.accountCode}</td>
                                    <td className="py-1 px-2">{l.contractNumber} {l.contractName}</td>
                                    <td className="py-1 px-2 text-end text-gray-500">{l.computedAmount !== undefined ? fmtNum(l.computedAmount) : '—'}</td>
                                    <td className={cn('py-1 px-2 text-end font-bold', showDelta ? 'text-amber-500' : '')}>
                                      {fmtNum(l.amount)}
                                      {showDelta && (
                                        <span className="block text-[10px] font-normal text-gray-500">
                                          {t('overhead_delta')}: {delta > 0 ? '+' : ''}{fmtNum(delta)}
                                        </span>
                                      )}
                                    </td>
                                    {canWrite && (
                                      <td className="py-1 px-2 text-end">
                                        <input
                                          type="number"
                                          min={0}
                                          step={0.01}
                                          aria-label={t('overhead_edit_amount')}
                                          className={cn('w-24 text-end border rounded px-2 py-1 font-mono', theme === 'dark' ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200')}
                                          value={l.amount}
                                          onChange={(e) => handleLineAmountChange(l.key, e.target.value)}
                                        />
                                      </td>
                                    )}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {(preview.journalPreviews?.length ?? 0) > 0 && (
                        <div>
                          <button
                            type="button"
                            onClick={() => setShowJournalPreview((v) => !v)}
                            className="font-bold text-sm mb-2 underline-offset-2 hover:underline"
                          >
                            {t('overhead_journal_preview')} {showJournalPreview ? '▾' : '▸'}
                          </button>
                          <p className="text-[10px] text-gray-500 mb-2">{t('overhead_journal_gl_note')}</p>
                          {showJournalPreview && (
                            <div className="space-y-3 max-h-96 overflow-auto">
                              {preview.journalPreviews!.map((j) => (
                                <div key={j.reference} className={cn('rounded-xl border p-3 text-xs', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
                                  <div className="font-bold mb-1">{j.reference}</div>
                                  <div className="text-gray-500 mb-2">{j.description}</div>
                                  <div className="font-mono text-[10px] text-gray-500 mb-2">
                                    {language === 'ar' ? 'بركة' : 'Pool'}: {fmtNum(j.poolAmount)} → {fmtNum(j.allocatedTotal)}
                                  </div>
                                  <table className="w-full">
                                    <thead>
                                      <tr className="text-gray-500">
                                        <th className="text-start py-0.5">{language === 'ar' ? 'جهة' : 'Side'}</th>
                                        <th className="text-start py-0.5">{language === 'ar' ? 'حساب' : 'Account'}</th>
                                        <th className="text-start py-0.5">{language === 'ar' ? 'مركز' : 'Center'}</th>
                                        <th className="text-end py-0.5">{language === 'ar' ? 'مبلغ' : 'Amount'}</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {j.entries.map((e, idx) => (
                                        <tr key={idx} className="border-t border-gray-800/20">
                                          <td className="py-0.5">{e.side === 'debit' ? t('overhead_journal_debit') : t('overhead_journal_credit')}</td>
                                          <td className="py-0.5 font-mono">{e.accountCode}</td>
                                          <td className="py-0.5">{e.costCenterLabel}</td>
                                          <td className="py-0.5 text-end">{fmtNum(e.amount)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ) : selected.status === 'closed' ? (
                <div className="space-y-3">
                  <p className="text-sm text-green-600">{t('overhead_status_closed')}</p>
                  <h4 className="font-bold text-sm">{t('overhead_allocated_lines')}</h4>
                  <div className="overflow-x-auto max-h-96">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-500 border-b">
                          <th className="py-1 text-start">{t('indirect_centers_code')}</th>
                          <th className="py-1 text-start">{language === 'ar' ? 'عقد' : 'Contract'}</th>
                          <th className="py-1 text-start">{language === 'ar' ? 'حساب' : 'Account'}</th>
                          <th className="py-1 text-end">{language === 'ar' ? 'محمّل' : 'Amount'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {closedLines.map((l, i) => (
                          <tr key={i} className="border-b border-gray-800/20">
                            <td className="py-1">{l.indirectCenterCode}</td>
                            <td className="py-1">{l.contractNumber} {l.contractName}</td>
                            <td className="py-1 font-mono">{l.accountCode}</td>
                            <td className="py-1 text-end">{Number(l.amount).toLocaleString(locale)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
        )}
        </div>

        <aside className={cn(cardCls, 'w-full md:flex-[2] md:min-w-[17rem] md:max-w-[24rem] shrink-0 space-y-4 md:sticky md:top-4 order-1 md:order-none')}>
          <div>
            <h3 className="font-bold text-sm">{t('gl_periods_closing_type_title')}</h3>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">{t('gl_periods_closing_type_hint')}</p>
          </div>

          <div className="space-y-2.5">
            {CLOSING_TYPES.map(({ id, icon: Icon }) => {
              const active = closingType === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setClosingType(id)}
                  className={cn(
                    'w-full text-start rounded-lg border px-3 py-3 transition-colors',
                    active
                      ? id === 'income_statement'
                        ? 'border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500/30'
                        : id === 'period_lock'
                          ? 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/30'
                          : 'border-blue-500 bg-blue-500/10 ring-1 ring-blue-500/30'
                      : theme === 'dark'
                        ? 'border-gray-800 hover:bg-gray-800/50'
                        : 'border-gray-200 hover:bg-gray-50',
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <div className={cn(
                      'p-1.5 rounded-lg shrink-0',
                      active
                        ? id === 'income_statement'
                          ? 'bg-emerald-600 text-white'
                          : id === 'period_lock'
                            ? 'bg-amber-600 text-white'
                            : 'bg-blue-600 text-white'
                        : theme === 'dark' ? 'bg-gray-800 text-gray-400' : 'bg-gray-100 text-gray-500',
                    )}>
                      <Icon size={16} />
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-sm leading-snug">{closingTypeLabel(id)}</div>
                      {active && (
                        <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">{closingTypeDesc(id)}</p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className={cn('pt-3 border-t space-y-3', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
            <p className={sectionTitleCls}>{t('gl_periods_cadence_title')}</p>
            <div className="grid grid-cols-2 gap-2.5">
              {CADENCE_OPTIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  disabled={closingType === 'period_lock'}
                  onClick={() => applyCadenceToForm(c)}
                  className={cn(
                    btnSmCls,
                    'border justify-center py-2 text-xs',
                    closingType === 'period_lock'
                      ? 'opacity-40 cursor-not-allowed border-gray-300'
                      : cadence === c
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : theme === 'dark'
                          ? 'border-gray-700 text-gray-300 hover:bg-gray-800'
                          : 'border-gray-200 text-gray-700 hover:bg-gray-50',
                  )}
                >
                  {cadenceLabel(c)}
                </button>
              ))}
            </div>
            {closingType === 'period_lock' && (
              <p className="text-[10px] text-gray-500">{t('period_lock_quarterly_only')}</p>
            )}
          </div>
        </aside>
      </div>

      {showApprovalModal && preview && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4">
          <div className={cn('w-full max-w-lg rounded-2xl border p-6 shadow-2xl', theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200')} dir={dir}>
            <h3 className="text-lg font-black mb-2">{t('overhead_approve_confirm')}</h3>
            <p className="text-sm text-gray-500 mb-4">{t('overhead_approve_confirm_msg')}</p>
            <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
              <div className={cn('p-3 rounded-xl border', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
                <p className="text-xs text-gray-500">{t('overhead_summary_pool')}</p>
                <p className="font-black text-orange-500">{fmtNum(preview.totalPoolAmount ?? 0)}</p>
              </div>
              <div className={cn('p-3 rounded-xl border', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
                <p className="text-xs text-gray-500">{t('overhead_summary_allocated')}</p>
                <p className="font-black text-emerald-500">{fmtNum(preview.totalAllocated ?? 0)}</p>
              </div>
              <div className={cn('p-3 rounded-xl border col-span-2', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
                <p className="text-xs text-gray-500">{t('overhead_journal_preview')}</p>
                <p className="font-bold">{preview.journalPreviews?.length ?? 0} {language === 'ar' ? 'قيود OHA' : 'OHA journals'}</p>
              </div>
            </div>
            {preview.isAdjusted && (
              <p className="text-xs text-amber-500 mb-3 flex items-center gap-1">
                <AlertTriangle size={14} /> {t('overhead_adjusted_badge')}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowApprovalModal(false)} className="px-4 py-2 rounded-lg border text-sm">
                {t('overhead_cancel_review')}
              </button>
              <button
                type="button"
                disabled={closing}
                onClick={() => void handleClose()}
                className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-bold disabled:opacity-50"
              >
                {closing ? <Loader2 className="animate-spin" size={14} /> : <Lock size={14} />}
                {t('overhead_approve_close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
