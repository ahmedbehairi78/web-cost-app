import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  Loader2,
  Plus,
  Printer,
  RefreshCw,
  Trash2,
  Unlock,
  Wallet,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useLanguage } from '../context/LanguageContext';
import { usePermissions } from '../context/PermissionsContext';
import { cn, listKey } from '../lib/utils';
import { isLocalBackend } from '../lib/dataBackend';
import { businessTodayYmd } from '../lib/businessCalendar';
import {
  CASH_BUDGET_PERIOD_TYPES,
  allocationSharePct,
  clampSettlementPct,
  computeCashBudgetSummary,
  glLeafOriginCode,
  obligationPayTarget,
  periodEndFor,
  settlementCashPool,
  subAccountLabel,
  summarizeAllocationByCostCenter,
  type CashBudgetPeriodType,
  type CostCenterAllocationTotal,
} from '../lib/cashBudget';
import { moduleAccess } from '../lib/permissions';
import { useReportDocumentPreview } from '../hooks/useReportDocumentPreview';
import type { CompanyPrintInfo } from '../lib/ipcPrintData';
import { ManualHelpButton } from './help/ManualHelpButton';
import {
  cashBudgetApi,
  settingsApi,
  type CashBudgetCustodyFloorRow,
  type CashBudgetLineRow,
  type CashBudgetPeriodRow,
} from '../services/local/modulesApi';

function errMessage(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return fallback;
}

function accountLabel(line: CashBudgetLineRow): string {
  return subAccountLabel(line.description, glLeafOriginCode(line.originId));
}

function projectLabel(line: CashBudgetLineRow, isAr: boolean, t: (key: string) => string): string {
  const ar = String(line.projectName ?? line.costCenterName ?? '').trim();
  const en = String(line.projectNameEn ?? line.costCenterNameEn ?? '').trim();
  const notes = String(line.notes ?? '').trim();
  if (isAr) return ar || notes || t('cb_no_project');
  return en || ar || notes || t('cb_no_project');
}

function formatAllocPct(pct: number): string {
  return `${pct.toFixed(2)}%`;
}

export function CashBudget() {
  const { t, language, theme, dir, formatMoney } = useLanguage();
  const { permissions } = usePermissions();
  const access = moduleAccess(permissions, 'cash_budget');
  const canWrite = access.create || access.edit;
  const isAr = language === 'ar';
  const isDark = theme === 'dark';

  const [periods, setPeriods] = useState<CashBudgetPeriodRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CashBudgetPeriodRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newType, setNewType] = useState<CashBudgetPeriodType>('weekly');
  const [newStart, setNewStart] = useState(businessTodayYmd());
  const [manualCategory, setManualCategory] = useState('other');
  const [manualDesc, setManualDesc] = useState('');
  const [manualAmount, setManualAmount] = useState('');
  const [custodyLeaves, setCustodyLeaves] = useState<CashBudgetCustodyFloorRow[]>([]);
  const [floorDrafts, setFloorDrafts] = useState<Record<string, string>>({});
  const [pctDraft, setPctDraft] = useState('100');
  const [companyInfo, setCompanyInfo] = useState<CompanyPrintInfo>({
    companyName: '',
    companyNameEn: '',
    headerLogo: '',
  });

  const { openDocPreview, ReportPreviewHost } = useReportDocumentPreview({
    language: language as 'ar' | 'en',
    t,
    formatMoney,
    companyInfo,
  });

  const inputCls = cn(
    'w-full border rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-blue-500',
    isDark ? 'bg-gray-900 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900',
  );
  const btnCls = cn(
    'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
    isDark ? 'bg-gray-800 hover:bg-gray-700 text-gray-100' : 'bg-gray-100 hover:bg-gray-200 text-gray-800',
  );
  const primaryBtn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50';

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await cashBudgetApi.list();
      setPeriods(rows ?? []);
    } catch (e) {
      toast.error(errMessage(e, t('cb_load_failed')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const row = await cashBudgetApi.get(id);
      setDetail(row);
    } catch (e) {
      toast.error(errMessage(e, t('cb_load_failed')));
    }
  }, [t]);

  const loadCustodyFloors = useCallback(async (asOf?: string) => {
    try {
      const rows = await cashBudgetApi.custodyFloors(asOf);
      setCustodyLeaves(rows ?? []);
      const drafts: Record<string, string> = {};
      for (const leaf of rows ?? []) {
        drafts[leaf.accountId] = String(Number(leaf.minBalance) || 0);
      }
      setFloorDrafts(drafts);
    } catch {
      /* picker is optional */
    }
  }, []);

  useEffect(() => {
    if (!isLocalBackend) return;
    void loadList();
    void settingsApi.getCompanyInfo().then((res) => {
      if (res.value) setCompanyInfo((prev) => ({ ...prev, ...res.value }));
    }).catch(() => { /* defaults */ });
  }, [loadList]);

  useEffect(() => {
    if (!isLocalBackend) return;
    void loadCustodyFloors(detail?.periodEnd);
  }, [loadCustodyFloors, detail?.periodEnd]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const summary = useMemo(() => {
    if (!detail) return null;
    return computeCashBudgetSummary({
      openingBank: Number(detail.openingBank),
      openingCash: Number(detail.openingCash),
      lines: (detail.lines ?? []).map((l) => ({
        side: l.side,
        category: l.category,
        amount: Number(l.amount),
        excluded: l.excluded,
      })),
    });
  }, [detail]);

  const obligationLines = useMemo(() => {
    const rows = (detail?.lines ?? []).filter((l) => l.side === 'obligation');
    return [...rows].sort((a, b) => {
      const name = accountLabel(a).localeCompare(accountLabel(b), isAr ? 'ar' : 'en');
      if (name !== 0) return name;
      const ca = projectLabel(a, isAr, t);
      const cb = projectLabel(b, isAr, t);
      return ca.localeCompare(cb, isAr ? 'ar' : 'en');
    });
  }, [detail, isAr, t]);

  const allocationPool = Number(detail?.distributablePool ?? 0);
  const settlementPct = clampSettlementPct(pctDraft);
  const settlementTarget = summary
    ? obligationPayTarget(summary.obligations, settlementPct)
    : 0;
  const payFromBanks = summary
    ? settlementCashPool(Number(detail?.bankPool ?? summary.openingBank), summary.obligations, settlementPct)
    : 0;

  const projectTotals = useMemo(
    () =>
      summarizeAllocationByCostCenter(
        obligationLines.map((l) => ({
          side: l.side,
          excluded: l.excluded,
          amount: Number(l.amount),
          allocatedCash: l.allocatedCash,
          costCenterName: projectLabel(l, isAr, t),
          costCenterNameEn: projectLabel(l, false, t),
          projectId: l.projectId,
          contractId: l.contractId,
          originId: l.originId,
        })),
        allocationPool,
      ),
    [obligationLines, isAr, t, allocationPool],
  );

  const isDraft = detail?.status === 'draft';
  const newEnd = periodEndFor(newType, newStart);

  useEffect(() => {
    if (!detail) return;
    setPctDraft(String(clampSettlementPct(detail.settlementPct)));
  }, [detail?.id, detail?.settlementPct]);

  const refreshAfterMutation = useCallback(async (id: string) => {
    await Promise.all([loadList(), loadDetail(id)]);
  }, [loadList, loadDetail]);

  const handleCreate = async () => {
    if (!canWrite) return;
    setBusy(true);
    try {
      const created = await cashBudgetApi.create({ periodType: newType, periodStart: newStart });
      toast.success(t('cb_created'));
      setSelectedId(created.id);
      await loadList();
      setDetail(created);
    } catch (e) {
      toast.error(errMessage(e, t('cb_save_failed')));
    } finally {
      setBusy(false);
    }
  };

  const handleSuggest = async () => {
    if (!detail || !canWrite) return;
    setBusy(true);
    try {
      const next = await cashBudgetApi.suggest(detail.id);
      setDetail(next);
      await loadList();
      toast.success(t('cb_suggested'));
    } catch (e) {
      toast.error(errMessage(e, t('cb_save_failed')));
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async () => {
    if (!detail || !canWrite) return;
    setBusy(true);
    try {
      const next = await cashBudgetApi.approve(detail.id, { settlementPct });
      setDetail(next);
      await loadList();
      toast.success(t('cb_approved'));
    } catch (e) {
      toast.error(errMessage(e, t('cb_save_failed')));
    } finally {
      setBusy(false);
    }
  };

  const handleReopen = async () => {
    if (!detail || !canWrite) return;
    setBusy(true);
    try {
      const next = await cashBudgetApi.reopen(detail.id);
      setDetail(next);
      await loadList();
      toast.success(t('cb_reopened'));
    } catch (e) {
      toast.error(errMessage(e, t('cb_save_failed')));
    } finally {
      setBusy(false);
    }
  };

  const handleDeletePeriod = async () => {
    if (!detail || !canWrite || !isDraft) return;
    setBusy(true);
    try {
      await cashBudgetApi.remove(detail.id);
      toast.success(t('cb_deleted'));
      setSelectedId(null);
      setDetail(null);
      await loadList();
    } catch (e) {
      toast.error(errMessage(e, t('cb_save_failed')));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveSettlementPct = async (raw?: string) => {
    if (!detail || !canWrite) return;
    const pct = clampSettlementPct(raw ?? pctDraft);
    setPctDraft(String(pct));
    if (clampSettlementPct(detail.settlementPct) === pct) return;
    setBusy(true);
    try {
      const next = await cashBudgetApi.patch(detail.id, { settlementPct: pct });
      setDetail(next);
      await loadList();
    } catch (e) {
      toast.error(errMessage(e, t('cb_save_failed')));
    } finally {
      setBusy(false);
    }
  };

  const handleAddManual = async () => {
    if (!detail || !canWrite) return;
    const amount = Number(manualAmount);
    if (!manualDesc.trim() || !(amount > 0)) {
      toast.error(t('cb_manual_invalid'));
      return;
    }
    setBusy(true);
    try {
      await cashBudgetApi.addLine(detail.id, {
        side: 'obligation',
        category: manualCategory || 'other',
        description: manualDesc.trim(),
        amount,
      });
      setManualDesc('');
      setManualAmount('');
      await refreshAfterMutation(detail.id);
      toast.success(t('cb_line_added'));
    } catch (e) {
      toast.error(errMessage(e, t('cb_save_failed')));
    } finally {
      setBusy(false);
    }
  };

  const handleToggleExcluded = async (line: CashBudgetLineRow) => {
    if (!detail || !canWrite || !isDraft) return;
    try {
      await cashBudgetApi.patchLine(detail.id, line.id, { excluded: !line.excluded });
      await refreshAfterMutation(detail.id);
    } catch (e) {
      toast.error(errMessage(e, t('cb_save_failed')));
    }
  };

  const handleDeleteLine = async (line: CashBudgetLineRow) => {
    if (!detail || !canWrite || line.origin !== 'manual') return;
    try {
      await cashBudgetApi.deleteLine(detail.id, line.id);
      await refreshAfterMutation(detail.id);
    } catch (e) {
      toast.error(errMessage(e, t('cb_save_failed')));
    }
  };

  const handleSaveFloor = async (accountId: string) => {
    if (!canWrite) return;
    const value = Number(floorDrafts[accountId]);
    try {
      await cashBudgetApi.setMinBalance(accountId, Number.isFinite(value) ? value : 0);
      await loadCustodyFloors(detail?.periodEnd);
      if (detail && canWrite && detail.status === 'draft') {
        const next = await cashBudgetApi.suggest(detail.id);
        setDetail(next);
        await loadList();
        toast.success(t('cb_min_saved_suggested'));
      } else {
        toast.success(t('cb_min_saved'));
      }
    } catch (e) {
      toast.error(errMessage(e, t('cb_save_failed')));
    }
  };

  const handlePrint = () => {
    if (!detail || !summary) return;
    const showAllocated = true;
    const obligationCols = [
      { key: 'description', header: t('cb_col_account'), width: 24 },
      { key: 'project', header: t('project'), width: 18 },
      { key: 'amount', header: t('cb_col_amount'), width: 14, money: true },
      ...(showAllocated
        ? [
            { key: 'allocated' as const, header: t('cb_col_allocated'), width: 14, money: true },
            { key: 'pct' as const, header: t('cb_col_alloc_pct'), width: 10 },
          ]
        : []),
    ];
    const obligationRows = obligationLines
      .filter((l) => !l.excluded)
      .map((l) => {
        const allocated = showAllocated ? Number(l.allocatedCash ?? 0) : 0;
        return {
          description: accountLabel(l),
          project: projectLabel(l, isAr, t),
          amount: Number(l.amount),
          allocated: showAllocated ? allocated : undefined,
          pct: showAllocated ? formatAllocPct(allocationSharePct(allocated, Number(detail.distributablePool ?? 0))) : undefined,
        };
      });
    const ccCols = [
      { key: 'name', header: t('project'), width: 28 },
      { key: 'obligation', header: t('cb_col_cc_obligation'), width: 14, money: true },
      ...(showAllocated
        ? [
            { key: 'allocated' as const, header: t('cb_col_cc_allocated'), width: 14, money: true },
            { key: 'pct' as const, header: t('cb_col_alloc_pct'), width: 10 },
          ]
        : []),
    ];
    const ccRows = projectTotals.map((row) => ({
      name: isAr ? row.name : row.nameEn,
      obligation: row.obligation,
      allocated: showAllocated ? row.allocated : undefined,
      pct: showAllocated ? formatAllocPct(row.pct) : undefined,
    }));
    const ccObligationTotal = projectTotals.reduce((s, r) => s + r.obligation, 0);
    const ccAllocatedTotal = projectTotals.reduce((s, r) => s + r.allocated, 0);
    openDocPreview({
      reportId: 'cash_budget',
      title: t('cash_budget'),
      scopeLabel: `${detail.periodNumber} · ${detail.periodStart} → ${detail.periodEnd}`,
      columns: obligationCols,
      rows: obligationRows,
      sections: [
        {
          kind: 'table',
          columns: obligationCols,
          rows: obligationRows,
          totals: {
            amount: summary.obligations,
            ...(showAllocated
              ? {
                  allocated: Number(detail.distributablePool ?? 0),
                  pct: formatAllocPct(100),
                }
              : {}),
          },
          totalsLabel: t('cb_kpi_obligations'),
          flow: true,
        },
        {
          kind: 'table',
          title: t('cb_by_project'),
          columns: ccCols,
          rows: ccRows,
          totals: {
            obligation: ccObligationTotal,
            ...(showAllocated
              ? { allocated: ccAllocatedTotal, pct: formatAllocPct(100) }
              : {}),
          },
          totalsLabel: t('cb_by_project'),
        },
      ],
      totals: {
        amount: summary.obligations,
        ...(showAllocated ? { allocated: Number(detail.distributablePool ?? 0) } : {}),
      },
      totalsLabel: t('cb_kpi_obligations'),
      footerNote: `${t('cb_kpi_banks')}: ${formatMoney(summary.openingBank)} · ${t('cb_kpi_cash')}: ${formatMoney(summary.openingCash)} · ${t('cb_kpi_sources')}: ${formatMoney(summary.periodSources)} · ${t('cb_kpi_obligations')}: ${formatMoney(summary.obligations)}${showAllocated ? ` · ${t('cb_col_allocated')}: ${formatMoney(detail.distributablePool ?? 0)}` : ''}`,
      filename: `cash-budget-${detail.periodNumber}`,
    });
  };

  const periodTypeLabel = (type: string) => {
    if (type === 'weekly') return t('cb_weekly');
    if (type === 'biweekly') return t('cb_biweekly');
    return t('cb_monthly');
  };

  const cardCls = cn(
    'rounded-xl border p-3',
    isDark ? 'border-gray-700 bg-gray-900/40' : 'border-gray-200 bg-white',
  );

  if (!isLocalBackend) {
    return (
      <div className="h-full flex items-center justify-center p-8 text-sm text-gray-500">
        {t('cb_local_only')}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0" dir={dir}>
      {ReportPreviewHost}
      <header className={cn('flex-shrink-0 px-4 py-3 border-b flex items-center gap-2 flex-wrap', isDark ? 'border-gray-800' : 'border-gray-200')}>
        <Wallet size={18} className="text-sky-600" />
        <h2 className="font-bold text-sm">{t('cash_budget')}</h2>
        <ManualHelpButton topicId="cash_budget.plan" />
        <span className="text-xs text-gray-500 flex-1 min-w-[12rem]">{t('cb_module_desc')}</span>
        <button type="button" className={btnCls} onClick={() => void loadList()} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
          {t('cb_refresh')}
        </button>
      </header>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className={cn('border-e overflow-y-auto p-3 space-y-3', isDark ? 'border-gray-800' : 'border-gray-200')}>
          {canWrite && (
            <div className={cardCls}>
              <p className="text-xs font-semibold mb-2">{t('cb_new_period')}</p>
              <label className="text-[11px] text-gray-500">{t('cb_period_type')}</label>
              <select className={cn(inputCls, 'mb-2')} value={newType} onChange={(e) => setNewType(e.target.value as CashBudgetPeriodType)}>
                {CASH_BUDGET_PERIOD_TYPES.map((type) => (
                  <option key={type} value={type}>{periodTypeLabel(type)}</option>
                ))}
              </select>
              <label className="text-[11px] text-gray-500">{t('cb_period_start')}</label>
              <input type="date" className={cn(inputCls, 'mb-1')} value={newStart} onChange={(e) => setNewStart(e.target.value)} />
              <p className="text-[11px] text-gray-500 mb-2">{t('cb_period_end')}: {newEnd || '—'}</p>
              <button type="button" className={primaryBtn} disabled={busy} onClick={() => void handleCreate()}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                {t('cb_create')}
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="animate-spin text-sky-500" size={20} /></div>
          ) : periods.length === 0 ? (
            <p className="text-xs text-gray-500 px-1">{t('cb_empty')}</p>
          ) : (
            <ul className="space-y-1">
              {periods.map((row, index) => {
                const active = row.id === selectedId;
                const gap = row.summary?.gap ?? 0;
                return (
                  <li key={listKey(row.id, index, 'cb')}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(row.id)}
                      className={cn(
                        'w-full text-start rounded-lg px-2.5 py-2 text-xs transition-colors',
                        active ? 'bg-blue-600 text-white' : isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-100',
                      )}
                    >
                      <div className="font-semibold">{row.periodNumber}</div>
                      <div className={active ? 'opacity-90' : 'text-gray-500'}>
                        {periodTypeLabel(row.periodType)} · {row.periodStart} → {row.periodEnd}
                      </div>
                      <div className="flex justify-between mt-0.5">
                        <span>{row.status === 'approved' ? t('cb_status_approved') : t('cb_status_draft')}</span>
                        <span className={cn(!active && (gap < 0 ? 'text-red-500' : 'text-emerald-600'))}>
                          {formatMoney(gap)}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <main className="overflow-y-auto p-4 space-y-4">
          {!detail ? (
            <div className="h-full min-h-[240px] flex items-center justify-center text-sm text-gray-500">
              {t('cb_select_period')}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold">{detail.periodNumber}</h3>
                <span className={cn(
                  'text-xs px-2 py-0.5 rounded-full',
                  detail.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800',
                )}>
                  {detail.status === 'approved' ? t('cb_status_approved') : t('cb_status_draft')}
                </span>
                <span className="text-xs text-gray-500">
                  {detail.periodStart} → {detail.periodEnd}
                </span>
                <div className="flex-1" />
                {isDraft && canWrite && (
                  <button type="button" className={btnCls} disabled={busy} onClick={() => void handleSuggest()}>
                    <RefreshCw size={14} /> {t('cb_suggest')}
                  </button>
                )}
                <button type="button" className={btnCls} onClick={handlePrint}>
                  <Printer size={14} /> {t('cb_print')}
                </button>
                {isDraft && canWrite && (
                  <button type="button" className={primaryBtn} disabled={busy} onClick={() => void handleApprove()}>
                    <Check size={14} /> {t('cb_approve')}
                  </button>
                )}
                {!isDraft && canWrite && (
                  <button type="button" className={btnCls} disabled={busy} onClick={() => void handleReopen()}>
                    <Unlock size={14} /> {t('cb_reopen')}
                  </button>
                )}
                {isDraft && canWrite && (
                  <button type="button" className={cn(btnCls, 'text-red-500')} disabled={busy} onClick={() => void handleDeletePeriod()}>
                    <Trash2 size={14} /> {t('cb_delete')}
                  </button>
                )}
              </div>

              {summary && (
                <div className="grid grid-cols-2 xl:grid-cols-6 gap-2">
                  <KpiCard label={t('cb_kpi_banks')} value={formatMoney(summary.openingBank)} isDark={isDark} />
                  <KpiCard label={t('cb_kpi_cash')} value={formatMoney(summary.openingCash)} isDark={isDark} />
                  <KpiCard label={t('cb_kpi_sources')} value={formatMoney(summary.periodSources)} isDark={isDark} />
                  <KpiCard label={t('cb_kpi_obligations')} value={formatMoney(summary.obligations)} isDark={isDark} />
                  <KpiCard
                    label={t('cb_gap')}
                    value={formatMoney(summary.gap)}
                    isDark={isDark}
                    tone={summary.gap < 0 ? 'bad' : 'good'}
                  />
                  <KpiCard label={t('cb_kpi_pay_plan')} value={formatMoney(payFromBanks)} isDark={isDark} />
                </div>
              )}
              <div className={cn(cardCls, 'flex flex-wrap items-end gap-2')}>
                  <div>
                    <label className="text-[11px] text-gray-500">{t('cb_settlement_pct')}</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      className={cn(inputCls, 'w-28')}
                      value={pctDraft}
                      disabled={busy || !canWrite}
                      onChange={(e) => setPctDraft(e.target.value)}
                      onBlur={() => void handleSaveSettlementPct()}
                    />
                  </div>
                  {[25, 50, 75, 100].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      className={cn(btnCls, clampSettlementPct(pctDraft) === pct && 'bg-blue-600 text-white hover:bg-blue-500')}
                      disabled={busy || !canWrite}
                      onClick={() => void handleSaveSettlementPct(String(pct))}
                    >
                      {pct}%
                    </button>
                  ))}
                  <p className="text-[11px] text-gray-500 flex-1 min-w-[12rem]">
                    {t('cb_settlement_pct_hint')} {settlementPct}% · {t('cb_kpi_pay_plan')}: {formatMoney(payFromBanks)}
                    {settlementTarget !== payFromBanks ? ` · ${t('cb_settlement_capped')}` : ''}
                  </p>
                </div>
              <p className="text-[11px] text-gray-500">{t('cb_equation_hint')}</p>
              <p className="text-[11px] text-gray-500">{t('cb_allocated_hint')}</p>

              <div className="space-y-3">
                <LineTable
                  lines={obligationLines}
                  t={t}
                  formatMoney={formatMoney}
                  isDark={isDark}
                  isAr={isAr}
                  showAllocated
                  allocationPool={allocationPool}
                  canEdit={Boolean(isDraft && canWrite)}
                  onToggleExcluded={handleToggleExcluded}
                  onDelete={handleDeleteLine}
                />
                {projectTotals.length > 0 && (
                  <CostCenterTotalsTable
                    title={t('cb_by_project')}
                    rows={projectTotals}
                    t={t}
                    formatMoney={formatMoney}
                    isDark={isDark}
                    isAr={isAr}
                    showAllocated
                  />
                )}
              </div>

              {isDraft && canWrite && (
                <div className={cardCls}>
                  <p className="text-xs font-semibold mb-2">{t('cb_add_manual')}</p>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <select className={inputCls} value={manualCategory} onChange={(e) => setManualCategory(e.target.value)}>
                      <option value="other">{t('cb_cat_other')}</option>
                      <option value="supplier">{t('cb_cat_supplier')}</option>
                      <option value="subcontractor">{t('cb_cat_subcontractor')}</option>
                      <option value="payroll">{t('cb_cat_payroll')}</option>
                    </select>
                    <input className={inputCls} value={manualDesc} onChange={(e) => setManualDesc(e.target.value)} placeholder={t('cb_col_description')} />
                    <input className={inputCls} type="number" step="0.01" min="0" value={manualAmount} onChange={(e) => setManualAmount(e.target.value)} placeholder={t('cb_col_amount')} />
                    <button type="button" className={primaryBtn} disabled={busy} onClick={() => void handleAddManual()}>
                      <Plus size={14} /> {t('cb_add_line')}
                    </button>
                  </div>
                </div>
              )}

              <div className={cardCls}>
                <p className="text-xs font-semibold mb-2">{t('cb_custody_floors')}</p>
                <p className="text-[11px] text-gray-500 mb-2">{t('cb_min_balance_hint')}</p>
                {custodyLeaves.length === 0 ? (
                  <p className="text-xs text-gray-500">{t('cb_no_custody_leaves')}</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500">
                        <th className="text-start font-medium py-1">{t('cb_col_account')}</th>
                        <th className="text-end font-medium py-1">{t('cb_floor_gl')}</th>
                        <th className="text-end font-medium py-1">{t('cb_min_balance')}</th>
                        <th className="text-end font-medium py-1">{t('cb_floor_shortfall')}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {custodyLeaves.map((acc, index) => (
                        <tr key={listKey(acc.accountId, index, 'floor')} className={isDark ? 'border-t border-gray-800' : 'border-t border-gray-100'}>
                          <td className="py-1.5">
                            {acc.accountCode} — {isAr ? acc.accountName : (acc.accountNameEn || acc.accountName)}
                          </td>
                          <td className="py-1.5 text-end tabular-nums">{formatMoney(acc.glBalance)}</td>
                          <td className="py-1.5 text-end">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              className={cn(inputCls, 'max-w-[8rem] ms-auto')}
                              value={floorDrafts[acc.accountId] ?? '0'}
                              disabled={!canWrite}
                              onChange={(e) => setFloorDrafts((prev) => ({ ...prev, [acc.accountId]: e.target.value }))}
                            />
                          </td>
                          <td className={cn(
                            'py-1.5 text-end tabular-nums font-medium',
                            Number(acc.replenish) > 0 ? 'text-amber-600' : 'text-gray-500',
                          )}>
                            {formatMoney(acc.replenish)}
                          </td>
                          <td className="py-1.5 text-end">
                            {canWrite && (
                              <button type="button" className={btnCls} onClick={() => void handleSaveFloor(acc.accountId)}>
                                {t('cb_save_floor')}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  isDark,
  tone,
}: {
  label: string;
  value: string;
  isDark: boolean;
  tone?: 'good' | 'bad';
}) {
  return (
    <div className={cn(
      'rounded-xl border p-3',
      isDark ? 'border-gray-700 bg-gray-900/40' : 'border-gray-200 bg-white',
      tone === 'good' && 'border-emerald-400/60',
      tone === 'bad' && 'border-red-400/60',
    )}>
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className={cn(
        'text-sm font-bold tabular-nums mt-1',
        tone === 'good' && 'text-emerald-600',
        tone === 'bad' && 'text-red-500',
      )}>
        {value}
      </div>
    </div>
  );
}

function LineTable({
  lines,
  t,
  formatMoney,
  isDark,
  isAr,
  showAllocated,
  allocationPool,
  canEdit,
  onToggleExcluded,
  onDelete,
}: {
  lines: CashBudgetLineRow[];
  t: (key: string) => string;
  formatMoney: (n: unknown) => string;
  isDark: boolean;
  isAr: boolean;
  showAllocated: boolean;
  allocationPool: number;
  canEdit: boolean;
  onToggleExcluded: (line: CashBudgetLineRow) => void;
  onDelete: (line: CashBudgetLineRow) => void;
}) {
  const allocatedTotal = lines.reduce((sum, line) => {
    if (line.excluded) return sum;
    return sum + Number(line.allocatedCash ?? 0);
  }, 0);
  return (
    <div className={cn('rounded-xl border overflow-hidden', isDark ? 'border-gray-700' : 'border-gray-200')}>
      {lines.length === 0 ? (
        <p className="px-3 py-4 text-xs text-gray-500">{t('cb_no_lines')}</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500">
              <th className="text-start font-medium px-3 py-1">{t('cb_col_account')}</th>
              <th className="text-start font-medium px-2 py-1">{t('project')}</th>
              <th className="text-end font-medium px-2 py-1">{t('cb_col_amount')}</th>
              {showAllocated && (
                <>
                  <th className="text-end font-medium px-2 py-1">{t('cb_col_allocated')}</th>
                  <th className="text-end font-medium px-2 py-1">{t('cb_col_alloc_pct')}</th>
                </>
              )}
              {canEdit && <th className="px-2" />}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const allocated = Number(line.allocatedCash ?? 0);
              return (
              <tr
                key={listKey(line.id, index, 'line')}
                className={cn(
                  isDark ? 'border-t border-gray-800' : 'border-t border-gray-100',
                  line.excluded && 'opacity-45 line-through',
                )}
              >
                <td className="px-3 py-1.5">
                  <div>{accountLabel(line)}</div>
                  {line.origin === 'manual' ? (
                    <div className="text-[10px] text-gray-500">{t('cb_origin_manual')}</div>
                  ) : null}
                  {line.category === 'custody_replenish' ? (
                    <div className="text-[10px] text-amber-600">{t('cb_cat_custody_replenish')}</div>
                  ) : null}
                </td>
                <td className="px-2 py-1.5">{projectLabel(line, isAr, t)}</td>
                <td className="px-2 py-1.5 text-end tabular-nums">{formatMoney(Number(line.amount))}</td>
                {showAllocated && (
                  <>
                    <td className="px-2 py-1.5 text-end tabular-nums">{formatMoney(allocated)}</td>
                    <td className="px-2 py-1.5 text-end tabular-nums">
                      {line.excluded ? '—' : formatAllocPct(allocationSharePct(allocated, allocationPool))}
                    </td>
                  </>
                )}
                {canEdit && (
                  <td className="px-2 py-1.5 whitespace-nowrap text-end">
                    <button type="button" className="text-[11px] text-blue-600 hover:underline" onClick={() => onToggleExcluded(line)}>
                      {line.excluded ? t('cb_include') : t('cb_exclude')}
                    </button>
                    {line.origin === 'manual' && (
                      <button type="button" className="text-[11px] text-red-500 hover:underline ms-2" onClick={() => onDelete(line)}>
                        {t('cb_delete')}
                      </button>
                    )}
                  </td>
                )}
              </tr>
              );
            })}
          </tbody>
          {showAllocated && (
            <tfoot>
              <tr className={cn(isDark ? 'border-t border-gray-700' : 'border-t border-gray-200')}>
                <td className="px-3 py-1.5 font-semibold" colSpan={2}>{t('cb_col_allocated')}</td>
                <td />
                <td className="px-2 py-1.5 text-end tabular-nums font-semibold">{formatMoney(allocatedTotal)}</td>
                <td className="px-2 py-1.5 text-end tabular-nums font-semibold">{formatAllocPct(allocationPool > 0 ? 100 : 0)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      )}
    </div>
  );
}

function CostCenterTotalsTable({
  title,
  rows,
  t,
  formatMoney,
  isDark,
  isAr,
  showAllocated,
}: {
  title: string;
  rows: CostCenterAllocationTotal[];
  t: (key: string) => string;
  formatMoney: (n: unknown) => string;
  isDark: boolean;
  isAr: boolean;
  showAllocated: boolean;
}) {
  const obligationTotal = rows.reduce((sum, row) => sum + row.obligation, 0);
  const allocatedTotal = rows.reduce((sum, row) => sum + row.allocated, 0);
  return (
    <div className={cn('rounded-xl border overflow-hidden', isDark ? 'border-gray-700' : 'border-gray-200')}>
      <div className={cn('px-3 py-2 text-xs font-semibold', isDark ? 'bg-gray-900' : 'bg-gray-50')}>{title}</div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-500">
            <th className="text-start font-medium px-3 py-1">{t('project')}</th>
            <th className="text-end font-medium px-2 py-1">{t('cb_col_cc_obligation')}</th>
            {showAllocated && (
              <>
                <th className="text-end font-medium px-2 py-1">{t('cb_col_cc_allocated')}</th>
                <th className="text-end font-medium px-2 py-1">{t('cb_col_alloc_pct')}</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={listKey(row.key, index, 'cc')}
              className={isDark ? 'border-t border-gray-800' : 'border-t border-gray-100'}
            >
              <td className="px-3 py-1.5">{isAr ? row.name : row.nameEn}</td>
              <td className="px-2 py-1.5 text-end tabular-nums">{formatMoney(row.obligation)}</td>
              {showAllocated && (
                <>
                  <td className="px-2 py-1.5 text-end tabular-nums">{formatMoney(row.allocated)}</td>
                  <td className="px-2 py-1.5 text-end tabular-nums">{formatAllocPct(row.pct)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={cn(isDark ? 'border-t border-gray-700' : 'border-t border-gray-200')}>
            <td className="px-3 py-1.5 font-semibold">{t('cb_kpi_obligations')}</td>
            <td className="px-2 py-1.5 text-end tabular-nums font-semibold">{formatMoney(obligationTotal)}</td>
            {showAllocated && (
              <>
                <td className="px-2 py-1.5 text-end tabular-nums font-semibold">{formatMoney(allocatedTotal)}</td>
                <td className="px-2 py-1.5 text-end tabular-nums font-semibold">{formatAllocPct(allocatedTotal > 0 ? 100 : 0)}</td>
              </>
            )}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
