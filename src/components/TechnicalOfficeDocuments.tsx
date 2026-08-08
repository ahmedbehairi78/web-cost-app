import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Inbox, ExternalLink, Loader2, Filter, GitBranch, ArrowRight, CheckCircle2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { useLanguage } from '../context/LanguageContext';
import { useApiQuery } from '../hooks/useApiQuery';
import {
  billingApi,
  contractsApi,
  documentRegistryApi,
  mosCertificatesApi,
  variationOrdersApi,
  type ContractDocumentCycleSummary,
  type ContractProgressSummary,
  type DocumentRegistryRecord,
} from '../services/local/modulesApi';
import { isErpTheme } from '../lib/erpBrand';
import type { PendingBillingFocus, PendingBoqFocus } from '../lib/shellNavigation';
import { useUserAccessScope } from '../hooks/useUserAccessScope';
import { JournalPreviewModal, type JournalPreviewEntry } from './gl/JournalPreviewModal';
import { ipcApproveErrorToastMessage } from '../lib/ipcApproveErrorMessage';
import { formatQuantity } from '../lib/formatQuantity';
import toast from 'react-hot-toast';

type DocTypeFilter = '' | 'mos' | 'ipc' | 'vo';
type StatusFilter = '' | 'draft' | 'submitted' | 'review' | 'approved' | 'paid';

type RegistryTimelineEvent = {
  id: string;
  docType: string;
  sourceEntityId: string;
  documentNo: string;
  documentDate?: string | null;
  status: string;
  amount?: number | null;
  needsAction?: boolean;
};

type RegistryTimeline = {
  contractId: string;
  events: RegistryTimelineEvent[];
};

type ContractRow = {
  id: string;
  projectId: string;
  contractName: string;
  contractNumber: string;
};

function docTypeLabel(docType: string, t: (key: string) => string): string {
  if (docType === 'mos') return t('doc_registry_type_mos');
  if (docType === 'ipc') return t('doc_registry_type_ipc');
  if (docType === 'vo') return t('doc_registry_type_vo');
  return docType;
}

function statusLabel(status: string, t: (key: string) => string): string {
  const key = `doc_registry_status_${status}`;
  const translated = t(key);
  return translated === key ? status : translated;
}

function docTypeTimelineClass(docType: string, theme: string): string {
  if (docType === 'mos') {
    return theme === 'dark'
      ? 'border-violet-700/50 hover:border-violet-500/70 bg-violet-950/20'
      : 'border-violet-200 hover:border-violet-400 bg-violet-50/50';
  }
  if (docType === 'vo') {
    return theme === 'dark'
      ? 'border-orange-700/50 hover:border-orange-500/70 bg-orange-950/20'
      : 'border-orange-200 hover:border-orange-400 bg-orange-50/50';
  }
  return theme === 'dark'
    ? 'border-blue-700/50 hover:border-blue-500/50'
    : 'border-blue-200 hover:border-blue-300';
}

function cycleNextStepLabel(step: ContractDocumentCycleSummary['suggestedNextStep'], t: (key: string) => string): string {
  if (step === 'mos') return t('doc_cycle_next_mos');
  if (step === 'vo') return t('doc_cycle_next_vo');
  if (step === 'ipc') return t('doc_cycle_next_ipc');
  return t('doc_cycle_next_none');
}

export function TechnicalOfficeDocuments({
  embedded = false,
  onOpenDocument,
}: {
  embedded?: boolean;
  onOpenDocument?: (focus: PendingBillingFocus | PendingBoqFocus) => void;
}) {
  const { t, theme, dir, formatMoney, language } = useLanguage();
  const { isAdmin, isProjectsManager } = useUserAccessScope();
  const canApprove = isAdmin || isProjectsManager;
  const [inboxOnly, setInboxOnly] = useState(true);
  const [docType, setDocType] = useState<DocTypeFilter>('');
  const [status, setStatus] = useState<StatusFilter>('');
  const [contractFilter, setContractFilter] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [showAllProgress, setShowAllProgress] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [ipcPreview, setIpcPreview] = useState<{
    ipcId: string;
    entries: JournalPreviewEntry[];
    reference: string;
    description: string;
  } | null>(null);

  const { data: contracts = [] } = useApiQuery<ContractRow>(
    async () => {
      const rows = (await contractsApi.list()) as Record<string, unknown>[];
      return rows
        .filter((r) => r.isDeleted !== true)
        .map((r) => ({
          id: String(r.id),
          projectId: String(r.projectId ?? ''),
          contractName: String(r.contractName ?? ''),
          contractNumber: String(r.contractNumber ?? ''),
        }));
    },
    [],
    { enabled: true },
  );

  const { data: rows = [], loading, error } = useApiQuery(
    () =>
      documentRegistryApi.list({
        inbox: inboxOnly,
        docType: docType || undefined,
        status: status || undefined,
        contractId: contractFilter || undefined,
        limit: 200,
      }),
    [inboxOnly, docType, status, contractFilter, refreshKey],
    { enabled: true, refreshKey },
  );

  const { data: timelineData = [] } = useApiQuery<RegistryTimeline>(
    () =>
      contractFilter
        ? documentRegistryApi.timeline(contractFilter).then((r) => [r])
        : Promise.resolve([]),
    [contractFilter, refreshKey],
    { enabled: !!contractFilter, refreshKey },
  );
  const timeline = timelineData[0];

  const { data: cycleData = [] } = useApiQuery<ContractDocumentCycleSummary>(
    () =>
      contractFilter
        ? documentRegistryApi.contractCycle(contractFilter).then((r) => [r])
        : Promise.resolve([]),
    [contractFilter, refreshKey],
    { enabled: !!contractFilter, refreshKey },
  );
  const cycle = cycleData[0];

  const { data: progressData = [] } = useApiQuery<ContractProgressSummary>(
    () =>
      contractFilter
        ? documentRegistryApi.contractProgress(contractFilter).then((r) => [r])
        : Promise.resolve([]),
    [contractFilter, refreshKey],
    { enabled: !!contractFilter, refreshKey },
  );
  const progress = progressData[0];

  const progressRows = useMemo(() => {
    if (!progress?.rows) return [];
    const sorted = [...progress.rows].sort((a, b) => b.progressPct - a.progressPct);
    return showAllProgress ? sorted : sorted.slice(0, 12);
  }, [progress?.rows, showAllProgress]);

  useEffect(() => {
    setShowAllProgress(false);
  }, [contractFilter]);

  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => {
        if (a.needsAction !== b.needsAction) return a.needsAction ? -1 : 1;
        return (b.documentDate ?? '').localeCompare(a.documentDate ?? '');
      }),
    [rows],
  );

  const shellPad = embedded ? 'px-6 py-6' : 'px-8 py-8';

  const openRow = (row: DocumentRegistryRecord) => {
    if (!row.contractId) return;
    if (row.docType === 'vo') {
      onOpenDocument?.({
        contractId: row.contractId,
        projectId: row.projectId ?? undefined,
        variationOrderId: row.sourceEntityId,
      });
      return;
    }
    onOpenDocument?.({
      contractId: row.contractId,
      projectId: row.projectId ?? undefined,
      docType: row.docType === 'mos' ? 'mos' : row.docType === 'ipc' ? 'ipc' : undefined,
      entityId: row.sourceEntityId,
    });
  };

  const bumpRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    window.dispatchEvent(new CustomEvent('notifications:refresh'));
  }, []);

  const handleApproveRow = useCallback(
    async (row: DocumentRegistryRecord) => {
      if (!canApprove || !row.needsAction || row.actionKind !== 'approve') return;
      const key = `${row.docType}:${row.sourceEntityId}`;
      setBusyKey(key);
      try {
        if (row.docType === 'mos') {
          await mosCertificatesApi.approve(row.sourceEntityId);
          toast.success(t('mos_approved'));
          bumpRefresh();
          return;
        }
        if (row.docType === 'vo') {
          await variationOrdersApi.approve(row.sourceEntityId);
          toast.success(t('vo_approved'));
          bumpRefresh();
          return;
        }
        if (row.docType === 'ipc') {
          const preview = await billingApi.journalPreview(row.sourceEntityId);
          setIpcPreview({
            ipcId: row.sourceEntityId,
            entries: preview.entries,
            reference: preview.reference,
            description: preview.description,
          });
        }
      } catch {
        toast.error(t('doc_registry_approve_failed'));
      } finally {
        setBusyKey(null);
      }
    },
    [bumpRefresh, canApprove, t],
  );

  const handleConfirmIpcApprove = useCallback(async () => {
    if (!ipcPreview) return;
    setBusyKey(`ipc:${ipcPreview.ipcId}`);
    try {
      await billingApi.approve(ipcPreview.ipcId);
      setIpcPreview(null);
      toast.success(t('ipc_approved_toast'));
      bumpRefresh();
    } catch (err) {
      toast.error(ipcApproveErrorToastMessage(err, t));
    } finally {
      setBusyKey(null);
    }
  }, [bumpRefresh, ipcPreview, t]);

  const pendingInboxCount = useMemo(
    () => sorted.filter((r) => r.needsAction && r.actionKind === 'approve').length,
    [sorted],
  );

  return (
    <div className={cn('min-h-[320px]', shellPad)} dir={dir}>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h3 className="text-xl font-bold flex items-center gap-2">
            <Inbox size={20} className={isErpTheme(theme) ? 'text-[var(--erp-primary)]' : 'text-blue-500'} />
            {t('technical_menu_documents')}
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            {t('doc_registry_desc')}
            {canApprove && pendingInboxCount > 0 ? (
              <span className="ms-2 text-amber-600 dark:text-amber-400 font-semibold">
                · {t('doc_registry_pending_count').replace('{n}', String(pendingInboxCount))}
              </span>
            ) : null}
          </p>
        </div>
      </div>

      <div
        className={cn(
          'flex flex-wrap items-center gap-3 mb-4 p-3 rounded-xl border',
          theme === 'dark' ? 'border-gray-800 bg-[#151619]' : 'border-gray-200 bg-white',
        )}
      >
        <Filter size={16} className="text-gray-400 shrink-0" />
        <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={inboxOnly}
            onChange={(e) => setInboxOnly(e.target.checked)}
            className="rounded border-gray-400"
          />
          {t('doc_registry_inbox_only')}
        </label>
        <select
          value={contractFilter}
          onChange={(e) => setContractFilter(e.target.value)}
          className={cn(
            'text-sm rounded-lg border px-2 py-1.5 min-w-[180px]',
            theme === 'dark' ? 'bg-[#0a0a0a] border-gray-700' : 'bg-gray-50 border-gray-300',
          )}
        >
          <option value="">{t('doc_registry_all_contracts')}</option>
          {contracts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.contractNumber} — {c.contractName}
            </option>
          ))}
        </select>
        <select
          value={docType}
          onChange={(e) => setDocType(e.target.value as DocTypeFilter)}
          className={cn(
            'text-sm rounded-lg border px-2 py-1.5',
            theme === 'dark' ? 'bg-[#0a0a0a] border-gray-700' : 'bg-gray-50 border-gray-300',
          )}
        >
          <option value="">{t('doc_registry_all_types')}</option>
          <option value="mos">{t('doc_registry_type_mos')}</option>
          <option value="ipc">{t('doc_registry_type_ipc')}</option>
          <option value="vo">{t('doc_registry_type_vo')}</option>
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          className={cn(
            'text-sm rounded-lg border px-2 py-1.5',
            theme === 'dark' ? 'bg-[#0a0a0a] border-gray-700' : 'bg-gray-50 border-gray-300',
          )}
        >
          <option value="">{t('doc_registry_all_statuses')}</option>
          <option value="draft">{t('doc_registry_status_draft')}</option>
          <option value="submitted">{t('doc_registry_status_submitted')}</option>
          <option value="review">{t('doc_registry_status_review')}</option>
          <option value="approved">{t('doc_registry_status_approved')}</option>
          <option value="paid">{t('doc_registry_status_paid')}</option>
        </select>
        <button
          type="button"
          onClick={() => setRefreshKey((k) => k + 1)}
          className="text-sm text-blue-500 hover:underline ms-auto"
        >
          {t('activity_refresh')}
        </button>
      </div>

      {contractFilter && cycle ? (
        <div
          className={cn(
            'mb-4 p-4 rounded-xl border',
            theme === 'dark' ? 'border-gray-800 bg-[#151619]' : 'border-gray-200 bg-white',
          )}
        >
          <div className="text-sm font-bold mb-3">{t('doc_cycle_title')}</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
            {(
              [
                { key: 'mos' as const, label: t('doc_cycle_mos'), data: cycle.mos, accent: 'violet' },
                { key: 'vo' as const, label: t('doc_cycle_vo'), data: cycle.vo, accent: 'orange' },
                { key: 'ipc' as const, label: t('doc_cycle_ipc'), data: cycle.ipc, accent: 'blue' },
              ] as const
            ).map(({ key, label, data, accent }) => (
              <div
                key={key}
                className={cn(
                  'rounded-lg border px-3 py-2',
                  accent === 'violet' && docTypeTimelineClass('mos', theme),
                  accent === 'orange' && docTypeTimelineClass('vo', theme),
                  accent === 'blue' && docTypeTimelineClass('ipc', theme),
                )}
              >
                <div className="text-[10px] uppercase font-bold text-gray-500">{label}</div>
                <div className="text-lg font-bold mt-1">{data.total}</div>
                <div className="text-[10px] text-gray-500 mt-1">
                  {t('doc_cycle_approved')}: {data.approved} · {t('doc_cycle_pending')}: {data.pending}
                </div>
                {data.latestNo ? (
                  <div className="text-[10px] font-mono text-gray-400 mt-1">{data.latestNo}</div>
                ) : null}
                {key === 'ipc' && 'billedAmount' in data ? (
                  <div className="text-[10px] mt-1 font-semibold">
                    {t('doc_cycle_billed')}: {formatMoney(data.billedAmount)}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <div className="text-xs text-gray-500">
            <span className="font-semibold">{t('doc_cycle_next')}:</span>{' '}
            {cycleNextStepLabel(cycle.suggestedNextStep, t)}
          </div>
        </div>
      ) : null}

      {contractFilter && progress ? (
        <div
          className={cn(
            'mb-4 p-4 rounded-xl border overflow-x-auto',
            theme === 'dark' ? 'border-gray-800 bg-[#151619]' : 'border-gray-200 bg-white',
          )}
        >
          <div className="text-sm font-bold mb-2">{t('doc_progress_title')}</div>
          <p className="text-xs text-gray-500 mb-3">
            {t('doc_progress_summary')
              .replace('{pct}', progress.totals.progressPct.toFixed(1))
              .replace('{mos}', formatQuantity(progress.totals.mosEquivalentQty, language))
              .replace('{ipc}', formatQuantity(progress.totals.ipcBilledQty, language))
              .replace('{exceed}', String(progress.totals.itemsExceedingTender))}
          </p>
          <table className="w-full text-xs">
            <thead className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>
              <tr>
                <th className="text-start py-1 pe-2">{t('doc_progress_col_item')}</th>
                <th className="text-end py-1 px-1">{t('doc_progress_col_tender')}</th>
                <th className="text-end py-1 px-1">{t('doc_progress_col_mos')}</th>
                <th className="text-end py-1 px-1">{t('doc_progress_col_ipc')}</th>
                <th className="text-end py-1 px-1">{t('doc_progress_col_cumulative')}</th>
                <th className="text-end py-1 ps-1">{t('doc_progress_col_pct')}</th>
              </tr>
            </thead>
            <tbody>
              {progressRows.map((row) => (
                <tr
                  key={row.boqItemId}
                  className={cn(
                    'border-t',
                    theme === 'dark' ? 'border-gray-800' : 'border-gray-100',
                    row.exceedsTender && (theme === 'dark' ? 'text-red-400' : 'text-red-600'),
                  )}
                >
                  <td className="py-1 pe-2 max-w-[200px] truncate" title={row.description}>
                    <span className="font-mono text-[10px] text-gray-500">{row.itemCode}</span>{' '}
                    {row.description}
                  </td>
                  <td className="text-end py-1 px-1 font-mono">{formatQuantity(row.tenderQty, language)}</td>
                  <td className="text-end py-1 px-1 font-mono">{formatQuantity(row.mosEquivalentQty, language)}</td>
                  <td className="text-end py-1 px-1 font-mono">{formatQuantity(row.ipcBilledQty, language)}</td>
                  <td className="text-end py-1 px-1 font-mono">{formatQuantity(row.cumulativeQty, language)}</td>
                  <td className="text-end py-1 ps-1 font-mono">{row.progressPct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {progress.rows.length > 12 ? (
            <button
              type="button"
              onClick={() => setShowAllProgress((v) => !v)}
              className="text-xs text-blue-500 hover:underline mt-2"
            >
              {showAllProgress ? t('doc_progress_show_less') : t('doc_progress_show_all')}
            </button>
          ) : null}
        </div>
      ) : null}

      {contractFilter && timeline?.events && timeline.events.length > 0 ? (
        <div
          className={cn(
            'mb-4 p-4 rounded-xl border overflow-x-auto',
            theme === 'dark' ? 'border-gray-800 bg-[#151619]' : 'border-gray-200 bg-white',
          )}
        >
          <div className="flex items-center gap-2 mb-3 text-sm font-bold">
            <GitBranch size={16} className="text-blue-500" />
            {t('doc_registry_timeline')}
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-3 text-[10px] text-gray-500">
            <span className="font-semibold uppercase">{t('doc_registry_timeline_legend')}:</span>
            {(['mos', 'vo', 'ipc'] as const).map((type) => (
              <span
                key={type}
                className={cn(
                  'rounded px-2 py-0.5 border font-bold',
                  docTypeTimelineClass(type, theme),
                )}
              >
                {docTypeLabel(type, t)}
              </span>
            ))}
          </div>
          <div className="flex items-stretch gap-2 min-w-max pb-1">
            {timeline.events.map((ev, idx) => (
              <React.Fragment key={ev.id}>
                {idx > 0 ? (
                  <div className="flex items-center text-gray-400 px-1">
                    <ArrowRight size={14} className={dir === 'rtl' ? 'rotate-180' : ''} />
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    if (ev.docType === 'vo') {
                      onOpenDocument?.({
                        contractId: contractFilter,
                        projectId: contracts.find((c) => c.id === contractFilter)?.projectId,
                        variationOrderId: ev.sourceEntityId,
                      });
                      return;
                    }
                    onOpenDocument?.({
                      contractId: contractFilter,
                      projectId: contracts.find((c) => c.id === contractFilter)?.projectId,
                      docType: ev.docType === 'mos' ? 'mos' : 'ipc',
                      entityId: ev.sourceEntityId,
                    });
                  }}
                  className={cn(
                    'text-start rounded-lg border px-3 py-2 min-w-[140px] transition-colors',
                    docTypeTimelineClass(ev.docType, theme),
                    ev.needsAction && (theme === 'dark' ? 'ring-1 ring-amber-600/50' : 'ring-1 ring-amber-300'),
                  )}
                >
                  <div className="text-[10px] uppercase font-bold text-gray-500">
                    {docTypeLabel(ev.docType, t)}
                  </div>
                  <div className="font-mono text-xs font-bold mt-0.5">{ev.documentNo}</div>
                  <div className="text-[10px] text-gray-500 mt-1">{ev.documentDate ?? '—'}</div>
                  <div className="text-[10px] font-mono mt-0.5">
                    {ev.amount != null && ev.amount !== 0 ? formatMoney(ev.amount) : '—'}
                  </div>
                  <div className="text-[10px] mt-1">{statusLabel(ev.status, t)}</div>
                </button>
              </React.Fragment>
            ))}
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-blue-500" size={28} />
        </div>
      ) : error ? (
        <p className="text-sm text-red-500 text-center py-8">{t('doc_registry_load_error')}</p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-12">{t('doc_registry_empty')}</p>
      ) : (
        <div className={cn('overflow-x-auto rounded-xl border', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
          <table className="w-full text-sm">
            <thead className={theme === 'dark' ? 'bg-[#151619] text-gray-400' : 'bg-gray-50 text-gray-600'}>
              <tr>
                <th className="text-start px-3 py-2 font-semibold">{t('doc_registry_col_number')}</th>
                <th className="text-start px-3 py-2 font-semibold">{t('doc_registry_col_type')}</th>
                <th className="text-start px-3 py-2 font-semibold">{t('doc_registry_col_contract')}</th>
                <th className="text-start px-3 py-2 font-semibold">{t('doc_registry_col_date')}</th>
                <th className="text-start px-3 py-2 font-semibold">{t('doc_registry_col_status')}</th>
                <th className="text-end px-3 py-2 font-semibold">{t('doc_registry_col_amount')}</th>
                <th className="text-center px-3 py-2 font-semibold min-w-[120px]">{t('doc_registry_col_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row: DocumentRegistryRecord) => (
                <tr
                  key={row.id}
                  className={cn(
                    'border-t',
                    theme === 'dark' ? 'border-gray-800 hover:bg-white/5' : 'border-gray-100 hover:bg-gray-50',
                    row.needsAction && (theme === 'dark' ? 'bg-amber-950/20' : 'bg-amber-50/80'),
                  )}
                >
                  <td className="px-3 py-2 font-mono text-xs font-bold">{row.documentNo}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex flex-col gap-0.5">
                      <span>{docTypeLabel(row.docType, t)}</span>
                      {row.docType === 'mos' && row.phase && (
                        <span className="text-[10px] text-gray-500">
                          {row.phase === 'initial' ? t('mos_phase_initial') : t('mos_phase_periodic')}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <div>{row.contract?.contractName ?? '—'}</div>
                    <div className="text-gray-500">{row.project?.projectName ?? ''}</div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.documentDate ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase',
                        row.needsAction
                          ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                          : row.status === 'approved' || row.status === 'paid'
                            ? 'bg-green-500/15 text-green-600 dark:text-green-400'
                            : 'bg-gray-500/15 text-gray-500',
                      )}
                    >
                      {statusLabel(row.status, t)}
                      {row.needsAction && row.actionKind === 'approve' ? ` · ${t('ipc_approve')}` : null}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-end font-mono text-xs">
                    {row.amount != null ? formatMoney(Number(row.amount)) : '—'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <div className="inline-flex flex-col items-center gap-1">
                      {canApprove && row.needsAction && row.actionKind === 'approve' ? (
                        <button
                          type="button"
                          disabled={busyKey === `${row.docType}:${row.sourceEntityId}`}
                          onClick={() => void handleApproveRow(row)}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-green-600 hover:text-green-500 disabled:opacity-50"
                        >
                          {busyKey === `${row.docType}:${row.sourceEntityId}` ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <CheckCircle2 size={14} />
                          )}
                          {t('ipc_approve')}
                        </button>
                      ) : null}
                      {onOpenDocument && row.contractId ? (
                        <button
                          type="button"
                          onClick={() => openRow(row)}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-blue-500 hover:text-blue-400"
                        >
                          <ExternalLink size={14} />
                          {t('doc_registry_open_row')}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <JournalPreviewModal
        open={ipcPreview != null}
        title={t('ipc_approve_preview_title')}
        reference={ipcPreview?.reference}
        description={ipcPreview?.description}
        entries={ipcPreview?.entries ?? []}
        confirmLabel={t('ipc_approve_confirm')}
        busy={busyKey === `ipc:${ipcPreview?.ipcId}`}
        onConfirm={() => void handleConfirmIpcApprove()}
        onClose={() => setIpcPreview(null)}
      />
    </div>
  );
}
