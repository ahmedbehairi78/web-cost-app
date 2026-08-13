import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BarChart3, BookOpenCheck, CheckCircle2, Loader2, Lock, Unlock } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '../../lib/utils';
import { useLanguage } from '../../context/LanguageContext';
import { usePermissions } from '../../context/PermissionsContext';
import type { PeriodCadence } from '../../lib/accountingPeriodCadence';
import { dayAfterIsoDate } from '../../lib/fiscalClosingDates';
import {
  fiscalClosingsApi,
  type FiscalJournalPreviewEntry,
  type FiscalPeriodClosingRow,
} from '../../services/local/modulesApi';
import { ApiError } from '../../lib/apiClient';
import { JournalPreviewModal } from './JournalPreviewModal';

type Props = {
  periodStart: string;
  periodEnd: string;
  label: string;
  cadence: PeriodCadence;
  theme: string;
  compact?: boolean;
};

type PreviewKind = 'income' | 'opening' | null;

export function IncomeStatementClosingPanel({
  periodStart,
  periodEnd,
  label,
  cadence,
  theme,
  compact = false,
}: Props) {
  const { t, dir, formatMoney } = useLanguage();
  const { can } = usePermissions();
  const isAdmin = can('overhead').edit;
  const [rows, setRows] = useState<FiscalPeriodClosingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bsPreview, setBsPreview] = useState<{
    balanceGap: number;
    isBalanced: boolean;
    totalAssets: number;
    totalLiabEquity: number;
  } | null>(null);
  const [journalPreview, setJournalPreview] = useState<{
    kind: PreviewKind;
    entries: FiscalJournalPreviewEntry[];
    title: string;
  } | null>(null);

  const cardCls = cn(
    compact ? 'rounded-xl border p-3' : 'rounded-2xl border p-5',
    theme === 'dark' ? 'border-gray-800 bg-gray-900/40' : theme === 'soft' ? 'border-[#cfd8dc] bg-white' : 'border-gray-200 bg-white',
  );

  const cadenceLabel = {
    monthly: t('gl_periods_cadence_monthly'),
    quarterly: t('gl_periods_cadence_quarterly'),
    semi_annual: t('gl_periods_cadence_semi_annual'),
    annual: t('gl_periods_cadence_annual'),
  }[cadence];

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fiscalClosingsApi.list();
      setRows(list);
      setSelectedId((prev) => {
        if (prev && list.some((r) => r.id === prev)) return prev;
        const match = list.find((r) => r.periodStart === periodStart && r.periodEnd === periodEnd);
        return match?.id ?? list[0]?.id ?? null;
      });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('gl_periods_income_load_failed'));
    } finally {
      setLoading(false);
    }
  }, [periodEnd, periodStart, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selected || selected.status === 'draft') {
      setBsPreview(null);
      return;
    }
    let cancelled = false;
    void fiscalClosingsApi
      .previewBalanceSheet(selected.periodEnd)
      .then((p) => {
        if (!cancelled) {
          setBsPreview({
            balanceGap: p.balanceGap,
            isBalanced: p.isBalanced,
            totalAssets: p.totalAssets,
            totalLiabEquity: p.totalLiabEquity,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setBsPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const statusLabel = (status: string) => {
    const key = `gl_periods_income_status_${status}`;
    const v = t(key);
    return v === key ? status : v;
  };

  const handleCreate = async () => {
    if (!isAdmin) return;
    if (!label.trim() || !periodStart || !periodEnd) {
      toast.error(t('gl_periods_income_need_dates'));
      return;
    }
    setBusy(true);
    try {
      const row = await fiscalClosingsApi.create({
        label: label.trim(),
        periodStart,
        periodEnd,
        openingDate: dayAfterIsoDate(periodEnd),
      });
      toast.success(t('gl_periods_income_created'));
      await refresh();
      setSelectedId(row.id);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('gl_periods_income_create_failed'));
    } finally {
      setBusy(false);
    }
  };

  const openIncomePreview = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const p = await fiscalClosingsApi.previewIncomeClose(selected.periodStart, selected.periodEnd);
      setJournalPreview({
        kind: 'income',
        entries: p.entries,
        title: t('gl_periods_income_preview_pl_title'),
      });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('gl_periods_income_preview_failed'));
    } finally {
      setBusy(false);
    }
  };

  const openOpeningPreview = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const p = await fiscalClosingsApi.previewOpening(selected.periodEnd, selected.openingDate);
      setJournalPreview({
        kind: 'opening',
        entries: p.entries,
        title: t('gl_periods_income_preview_open_title'),
      });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('gl_periods_income_preview_failed'));
    } finally {
      setBusy(false);
    }
  };

  const confirmPreview = async () => {
    if (!selected || !journalPreview?.kind) return;
    setBusy(true);
    try {
      if (journalPreview.kind === 'income') {
        await fiscalClosingsApi.closeIncome(selected.id);
        toast.success(t('gl_periods_income_pl_closed'));
      } else {
        await fiscalClosingsApi.postOpening(selected.id);
        toast.success(t('gl_periods_income_opening_posted'));
      }
      setJournalPreview(null);
      await refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('gl_periods_income_action_failed'));
    } finally {
      setBusy(false);
    }
  };

  const handleApproveBs = async () => {
    if (!selected || !isAdmin) return;
    setBusy(true);
    try {
      await fiscalClosingsApi.approveBalanceSheet(selected.id);
      toast.success(t('gl_periods_income_bs_approved'));
      await refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('gl_periods_income_bs_unbalanced'));
    } finally {
      setBusy(false);
    }
  };

  const handleReopen = async () => {
    if (!selected || !isAdmin) return;
    if (!window.confirm(t('gl_periods_income_reopen_confirm'))) return;
    setBusy(true);
    try {
      await fiscalClosingsApi.reopen(selected.id);
      toast.success(t('gl_periods_income_reopened'));
      await refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('gl_periods_income_action_failed'));
    } finally {
      setBusy(false);
    }
  };

  const btnSm = cn(
    'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold disabled:opacity-50',
    theme === 'dark' ? 'border border-gray-700' : 'border border-gray-200',
  );

  return (
    <div className={cardCls} dir={dir}>
      <div className={cn('flex items-start gap-2', compact ? 'mb-2' : 'mb-4')}>
        <div className={cn('p-1.5 rounded-lg shrink-0', theme === 'dark' ? 'bg-emerald-900/30 text-emerald-400' : 'bg-emerald-50 text-emerald-700')}>
          <BarChart3 size={compact ? 16 : 22} />
        </div>
        <div>
          <h3 className={cn('font-bold', compact ? 'text-sm' : 'text-lg')}>{t('gl_periods_type_income')}</h3>
          <p className={cn('text-gray-500', compact ? 'text-[10px] mt-0.5 leading-snug' : 'text-sm mt-0.5')}>
            {t('gl_periods_type_income_desc')}
          </p>
        </div>
      </div>

      <dl className={cn('grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3', compact ? 'text-[11px]' : 'text-sm mb-5')}>
        <div className={cn('rounded-lg border px-2 py-1.5', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
          <dt className="text-[9px] uppercase text-gray-500">{t('overhead_label')}</dt>
          <dd className="font-bold mt-0.5 truncate">{label || '—'}</dd>
        </div>
        <div className={cn('rounded-lg border px-2 py-1.5', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
          <dt className="text-[9px] uppercase text-gray-500">{t('gl_periods_cadence_title')}</dt>
          <dd className="font-bold mt-0.5">{cadenceLabel}</dd>
        </div>
        <div className={cn('rounded-lg border px-2 py-1.5 col-span-2 sm:col-span-1', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
          <dt className="text-[9px] uppercase text-gray-500">{t('gl_periods_dates_title')}</dt>
          <dd className="font-mono text-[10px] mt-0.5">
            {periodStart} → {periodEnd}
          </dd>
        </div>
      </dl>

      <div
        className={cn(
          'rounded-lg border mb-2',
          compact ? 'p-2' : 'p-4 mb-4',
          theme === 'dark' ? 'border-emerald-900/40 bg-emerald-950/20' : 'border-emerald-200 bg-emerald-50/60',
        )}
      >
        <h4 className={cn('font-bold flex items-center gap-1.5 mb-1', compact ? 'text-[11px]' : 'text-sm mb-2')}>
          <BookOpenCheck size={compact ? 12 : 16} />
          {t('gl_periods_income_steps_title')}
        </h4>
        <ol
          className={cn(
            'list-decimal list-inside space-y-0.5 text-gray-600 dark:text-gray-300',
            compact ? 'text-[10px]' : 'text-sm space-y-1.5',
          )}
        >
          <li>{t('gl_periods_income_step_1')}</li>
          <li>{t('gl_periods_income_step_2')}</li>
          <li>{t('gl_periods_income_step_3')}</li>
        </ol>
      </div>

      {isAdmin && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleCreate()}
          className={cn(
            'inline-flex items-center rounded-lg bg-emerald-600 text-white font-bold mb-3',
            compact ? 'px-2 py-1 text-[11px]' : 'px-4 py-2 text-sm',
          )}
        >
          {busy ? <Loader2 className="animate-spin" size={14} /> : null}
          {t('gl_periods_income_create_cycle')}
        </button>
      )}

      {loading ? (
        <Loader2 className="animate-spin mx-auto my-4" />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {rows.length === 0 ? (
              <p className="text-xs text-gray-500">{t('gl_periods_income_empty')}</p>
            ) : (
              rows.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedId(r.id)}
                  className={cn(
                    btnSm,
                    selectedId === r.id && 'bg-emerald-600 text-white border-emerald-600',
                  )}
                >
                  {r.label} · {statusLabel(r.status)}
                </button>
              ))
            )}
          </div>

          {selected && (
            <div className={cn('rounded-lg border p-3 space-y-2', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
              <div className="flex flex-wrap justify-between gap-2 text-xs">
                <div>
                  <p className="font-bold">{selected.label}</p>
                  <p className="font-mono text-[10px] text-gray-500">
                    {selected.periodStart} → {selected.periodEnd}
                  </p>
                  <p className="mt-1">
                    {t('gl_periods_income_status')}: <strong>{statusLabel(selected.status)}</strong>
                  </p>
                  {selected.netProfit != null && (
                    <p>
                      {t('gl_periods_income_net_profit')}: {formatMoney(Number(selected.netProfit))}
                    </p>
                  )}
                </div>
                {isAdmin && selected.status !== 'draft' && (
                  <button type="button" className={cn(btnSm, 'border-red-500 text-red-500')} onClick={() => void handleReopen()} disabled={busy}>
                    <Unlock size={12} /> {t('gl_periods_income_reopen')}
                  </button>
                )}
              </div>

              {bsPreview && selected.status !== 'draft' && (
                <div
                  className={cn(
                    'rounded-md border px-2 py-1.5 text-[11px]',
                    bsPreview.isBalanced
                      ? theme === 'dark'
                        ? 'border-emerald-800 bg-emerald-950/30'
                        : 'border-emerald-200 bg-emerald-50'
                      : theme === 'dark'
                        ? 'border-amber-800 bg-amber-950/30'
                        : 'border-amber-200 bg-amber-50',
                  )}
                >
                  <p className="flex items-center gap-1 font-bold">
                    {bsPreview.isBalanced ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                    {bsPreview.isBalanced ? t('gl_periods_income_bs_balanced') : t('gl_periods_income_bs_unbalanced')}
                  </p>
                  <p>
                    {t('gl_periods_income_assets')}: {formatMoney(bsPreview.totalAssets)} ·{' '}
                    {t('gl_periods_income_le')}: {formatMoney(bsPreview.totalLiabEquity)} ·{' '}
                    {t('gl_periods_income_gap')}: {formatMoney(Math.abs(bsPreview.balanceGap))}
                  </p>
                </div>
              )}

              {isAdmin && (
                <div className="flex flex-wrap gap-1.5">
                  {selected.status === 'draft' && (
                    <button
                      type="button"
                      className={cn(btnSm, 'bg-emerald-600 text-white border-emerald-600')}
                      disabled={busy}
                      onClick={() => void openIncomePreview()}
                    >
                      <Lock size={12} /> {t('gl_periods_income_prepare')}
                    </button>
                  )}
                  {selected.status === 'pl_closed' && (
                    <button
                      type="button"
                      className={cn(btnSm, 'bg-blue-600 text-white border-blue-600')}
                      disabled={busy || (bsPreview != null && !bsPreview.isBalanced)}
                      onClick={() => void handleApproveBs()}
                    >
                      <CheckCircle2 size={12} /> {t('gl_periods_income_approve_bs')}
                    </button>
                  )}
                </div>
              )}

              {selected.status === 'bs_approved' && (
                <p className={cn('text-[11px]', theme === 'dark' ? 'text-emerald-400' : 'text-emerald-700')}>
                  {t('gl_periods_income_close_complete_hint')}
                </p>
              )}
            </div>
          )}

          {/* Opening balances — separate optional step; only on explicit button */}
          {selected && (selected.status === 'bs_approved' || selected.status === 'opening_posted') && (
            <div
              className={cn(
                'rounded-lg border p-3 space-y-2',
                theme === 'dark' ? 'border-violet-900/50 bg-violet-950/20' : 'border-violet-200 bg-violet-50/70',
              )}
            >
              <h4 className={cn('font-bold flex items-center gap-1.5', compact ? 'text-[11px]' : 'text-sm')}>
                <BookOpenCheck size={compact ? 12 : 16} />
                {t('gl_periods_income_opening_section_title')}
              </h4>
              <p className={cn(compact ? 'text-[10px]' : 'text-xs', 'text-gray-600 dark:text-gray-300')}>
                {t('gl_periods_income_opening_section_desc')}
              </p>
              <p className="font-mono text-[10px] text-gray-500">
                {t('gl_periods_income_opening_date')}: {selected.openingDate}
              </p>
              {selected.status === 'opening_posted' ? (
                <p className={cn('text-[11px] font-bold flex items-center gap-1', theme === 'dark' ? 'text-emerald-400' : 'text-emerald-700')}>
                  <CheckCircle2 size={12} /> {t('gl_periods_income_opening_posted')}
                </p>
              ) : (
                isAdmin && (
                  <button
                    type="button"
                    className={cn(btnSm, 'bg-violet-600 text-white border-violet-600')}
                    disabled={busy}
                    onClick={() => void openOpeningPreview()}
                  >
                    {busy ? <Loader2 className="animate-spin" size={12} /> : <BookOpenCheck size={12} />}
                    {t('gl_periods_income_post_opening')}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      )}

      {journalPreview && (
        <JournalPreviewModal
          open
          title={journalPreview.title}
          entries={journalPreview.entries}
          confirmLabel={
            journalPreview.kind === 'income'
              ? t('gl_periods_income_confirm_pl')
              : t('gl_periods_income_post_opening')
          }
          onConfirm={() => void confirmPreview()}
          onClose={() => setJournalPreview(null)}
          busy={busy}
        />
      )}
    </div>
  );
}
