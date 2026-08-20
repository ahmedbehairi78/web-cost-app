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
  computeCashBudgetSummary,
  isCustodyCashLeafCode,
  periodEndFor,
  type CashBudgetPeriodType,
} from '../lib/cashBudget';
import { moduleAccess } from '../lib/permissions';
import { useReportDocumentPreview } from '../hooks/useReportDocumentPreview';
import type { CompanyPrintInfo } from '../lib/ipcPrintData';
import { ManualHelpButton } from './help/ManualHelpButton';
import {
  cashBudgetApi,
  chartOfAccountsApi,
  settingsApi,
  type CashBudgetLineRow,
  type CashBudgetPeriodRow,
  type CashBudgetSide,
} from '../services/local/modulesApi';

type CoaRow = {
  id: string;
  accountCode: string;
  accountName: string;
  accountNameEn?: string;
  isGroup?: boolean;
  status?: string;
  minBalance?: number;
};

const CATEGORY_KEYS: Record<string, string> = {
  supplier: 'cb_cat_supplier',
  subcontractor: 'cb_cat_subcontractor',
  custody_settlement: 'cb_cat_custody_settlement',
  custody_replenish: 'cb_cat_custody_replenish',
  payroll: 'cb_cat_payroll',
  other: 'cb_cat_other',
  opening_bank: 'cb_cat_opening_bank',
  opening_cash: 'cb_cat_opening_cash',
  collection: 'cb_cat_collection',
};

function errMessage(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return fallback;
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
  const [manualSide, setManualSide] = useState<CashBudgetSide>('obligation');
  const [manualCategory, setManualCategory] = useState('other');
  const [manualDesc, setManualDesc] = useState('');
  const [manualAmount, setManualAmount] = useState('');
  const [custodyLeaves, setCustodyLeaves] = useState<CoaRow[]>([]);
  const [floorDrafts, setFloorDrafts] = useState<Record<string, string>>({});
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

  const loadCustodyFloors = useCallback(async () => {
    try {
      const rows = (await chartOfAccountsApi.list()) as CoaRow[];
      const leaves = rows.filter(
        (a) => !a.isGroup && a.status !== 'disabled' && isCustodyCashLeafCode(a.accountCode),
      );
      setCustodyLeaves(leaves);
      const drafts: Record<string, string> = {};
      for (const leaf of leaves) {
        drafts[leaf.id] = String(Number(leaf.minBalance) || 0);
      }
      setFloorDrafts(drafts);
    } catch {
      /* picker is optional */
    }
  }, []);

  useEffect(() => {
    if (!isLocalBackend) return;
    void loadList();
    void loadCustodyFloors();
    void settingsApi.getCompanyInfo().then((res) => {
      if (res.value) setCompanyInfo((prev) => ({ ...prev, ...res.value }));
    }).catch(() => { /* defaults */ });
  }, [loadList, loadCustodyFloors]);

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

  const obligationLines = useMemo(
    () => (detail?.lines ?? []).filter((l) => l.side === 'obligation'),
    [detail],
  );
  const sourceLines = useMemo(
    () => (detail?.lines ?? []).filter((l) => l.side === 'source' && l.category !== 'opening_bank' && l.category !== 'opening_cash'),
    [detail],
  );

  const isDraft = detail?.status === 'draft';
  const newEnd = periodEndFor(newType, newStart);

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
      const next = await cashBudgetApi.approve(detail.id);
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
        side: manualSide,
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
      toast.success(t('cb_min_saved'));
      await loadCustodyFloors();
    } catch (e) {
      toast.error(errMessage(e, t('cb_save_failed')));
    }
  };

  const handlePrint = () => {
    if (!detail || !summary) return;
    const rows = [...obligationLines, ...sourceLines].map((l) => ({
      side: t(l.side === 'obligation' ? 'cb_obligations' : 'cb_sources'),
      category: t(CATEGORY_KEYS[l.category] ?? 'cb_cat_other'),
      description: l.description,
      amount: l.excluded ? 0 : Number(l.amount),
      excluded: l.excluded ? t('cb_excluded') : '',
      dueDate: l.dueDate || '—',
    }));
    openDocPreview({
      reportId: 'cash_budget',
      title: t('cash_budget'),
      scopeLabel: `${detail.periodNumber} · ${detail.periodStart} → ${detail.periodEnd}`,
      columns: [
        { key: 'side', header: t('cb_col_side'), width: 12 },
        { key: 'category', header: t('cb_col_category'), width: 14 },
        { key: 'description', header: t('cb_col_description'), width: 28 },
        { key: 'dueDate', header: t('cb_col_due'), width: 10 },
        { key: 'amount', header: t('cb_col_amount'), width: 12, money: true },
        { key: 'excluded', header: t('cb_excluded'), width: 8 },
      ],
      rows,
      totals: {
        amount: summary.gap,
      },
      totalsLabel: t('cb_gap'),
      footerNote: `${t('cb_kpi_banks')}: ${formatMoney(summary.openingBank)} · ${t('cb_kpi_cash')}: ${formatMoney(summary.openingCash)} · ${t('cb_kpi_sources')}: ${formatMoney(summary.periodSources)} · ${t('cb_kpi_obligations')}: ${formatMoney(summary.obligations)}`,
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
                <div className="grid grid-cols-2 xl:grid-cols-5 gap-2">
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
                </div>
              )}
              <p className="text-[11px] text-gray-500">{t('cb_equation_hint')}</p>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <LineTable
                  title={t('cb_obligations')}
                  lines={obligationLines}
                  t={t}
                  formatMoney={formatMoney}
                  isDark={isDark}
                  canEdit={Boolean(isDraft && canWrite)}
                  onToggleExcluded={handleToggleExcluded}
                  onDelete={handleDeleteLine}
                />
                <LineTable
                  title={t('cb_sources')}
                  lines={sourceLines}
                  t={t}
                  formatMoney={formatMoney}
                  isDark={isDark}
                  canEdit={Boolean(isDraft && canWrite)}
                  onToggleExcluded={handleToggleExcluded}
                  onDelete={handleDeleteLine}
                />
              </div>

              {isDraft && canWrite && (
                <div className={cardCls}>
                  <p className="text-xs font-semibold mb-2">{t('cb_add_manual')}</p>
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                    <select className={inputCls} value={manualSide} onChange={(e) => setManualSide(e.target.value as CashBudgetSide)}>
                      <option value="obligation">{t('cb_obligations')}</option>
                      <option value="source">{t('cb_sources')}</option>
                    </select>
                    <select className={inputCls} value={manualCategory} onChange={(e) => setManualCategory(e.target.value)}>
                      <option value="other">{t('cb_cat_other')}</option>
                      <option value="supplier">{t('cb_cat_supplier')}</option>
                      <option value="subcontractor">{t('cb_cat_subcontractor')}</option>
                      <option value="custody_settlement">{t('cb_cat_custody_settlement')}</option>
                      <option value="payroll">{t('cb_cat_payroll')}</option>
                      <option value="collection">{t('cb_cat_collection')}</option>
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
                        <th className="text-end font-medium py-1">{t('cb_min_balance')}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {custodyLeaves.map((acc, index) => (
                        <tr key={listKey(acc.id, index, 'floor')} className={isDark ? 'border-t border-gray-800' : 'border-t border-gray-100'}>
                          <td className="py-1.5">
                            {acc.accountCode} — {isAr ? acc.accountName : (acc.accountNameEn || acc.accountName)}
                          </td>
                          <td className="py-1.5 text-end">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              className={cn(inputCls, 'max-w-[8rem] ms-auto')}
                              value={floorDrafts[acc.id] ?? '0'}
                              disabled={!canWrite}
                              onChange={(e) => setFloorDrafts((prev) => ({ ...prev, [acc.id]: e.target.value }))}
                            />
                          </td>
                          <td className="py-1.5 text-end">
                            {canWrite && (
                              <button type="button" className={btnCls} onClick={() => void handleSaveFloor(acc.id)}>
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
  title,
  lines,
  t,
  formatMoney,
  isDark,
  canEdit,
  onToggleExcluded,
  onDelete,
}: {
  title: string;
  lines: CashBudgetLineRow[];
  t: (key: string) => string;
  formatMoney: (n: unknown) => string;
  isDark: boolean;
  canEdit: boolean;
  onToggleExcluded: (line: CashBudgetLineRow) => void;
  onDelete: (line: CashBudgetLineRow) => void;
}) {
  return (
    <div className={cn('rounded-xl border overflow-hidden', isDark ? 'border-gray-700' : 'border-gray-200')}>
      <div className={cn('px-3 py-2 text-xs font-semibold', isDark ? 'bg-gray-900' : 'bg-gray-50')}>{title}</div>
      {lines.length === 0 ? (
        <p className="px-3 py-4 text-xs text-gray-500">{t('cb_no_lines')}</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500">
              <th className="text-start font-medium px-3 py-1">{t('cb_col_description')}</th>
              <th className="text-end font-medium px-2 py-1">{t('cb_col_amount')}</th>
              {canEdit && <th className="px-2" />}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr
                key={listKey(line.id, index, 'line')}
                className={cn(
                  isDark ? 'border-t border-gray-800' : 'border-t border-gray-100',
                  line.excluded && 'opacity-45 line-through',
                )}
              >
                <td className="px-3 py-1.5">
                  <div>{line.description}</div>
                  <div className="text-[10px] text-gray-500">
                    {t(CATEGORY_KEYS[line.category] ?? 'cb_cat_other')}
                    {line.dueDate ? ` · ${line.dueDate}` : ''}
                    {line.origin === 'manual' ? ` · ${t('cb_origin_manual')}` : ''}
                  </div>
                </td>
                <td className="px-2 py-1.5 text-end tabular-nums">{formatMoney(Number(line.amount))}</td>
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
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
