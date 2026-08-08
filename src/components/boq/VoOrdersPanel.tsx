import React, { useCallback, useEffect, useState } from 'react';
import { ManualHelpButton } from '../help/ManualHelpButton';
import {
  FileDiff,
  CheckCircle2,
  Loader2,
  Send,
  Trash2,
  XCircle,
  Printer,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { variationOrdersApi } from '../../services/local/modulesApi';
import { cn, listKey } from '../../lib/utils';
import { formatNumber } from '../../lib/numberLocale';
import type { VariationOrder, VariationOrderLine, VoStatus } from '../../types';
import toast from 'react-hot-toast';

export interface VoBoqItemRef {
  id: string;
  chapterCode?: string;
  chapterName?: string;
  workTypeCode?: string;
  sectionCode?: string;
  sectionName?: string;
  itemCode: string;
  description: string;
  unit: string;
  tenderQty: number;
  rateMaterials?: number;
  rateLabour?: number;
  rateEquipment?: number;
  rateOverheadPct?: number;
  rateProfitPct?: number;
  unitRateTotal: number;
  tenderAmount: number;
}

interface Props {
  contractId: string;
  canWrite: boolean;
  canApprove: boolean;
  theme: string;
  refreshSignal: number;
  highlightOrderId?: string | null;
  onChanged: () => void;
  onNewOrder: () => void;
  onPrint?: (order: VariationOrder) => void;
  /** When set, renders VO sections as table body rows inside the BOQ table. */
  inline?: boolean;
  /** Live BOQ items keyed by id — used to enrich approved `new_item` rows. */
  boqItemsById?: Map<string, VoBoqItemRef>;
  /** Report VO-created BOQ item ids so the parent can exclude them from the original list. */
  onOrdersLoaded?: (orders: VariationOrder[]) => void;
  /** Column count of the host BOQ table (actions + data + optional local cols). */
  colSpan?: number;
  hasLocalExtraCols?: boolean;
}

export function VoOrdersPanel({
  contractId,
  canWrite,
  canApprove,
  theme,
  refreshSignal,
  highlightOrderId,
  onChanged,
  onNewOrder,
  onPrint,
  inline = false,
  boqItemsById,
  onOrdersLoaded,
  colSpan = 20,
  hasLocalExtraCols = false,
}: Props) {
  const { t, formatMoney } = useLanguage();
  const isDark = theme === 'dark';
  const isSoft = theme === 'soft';

  const [orders, setOrders] = useState<VariationOrder[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [localRefresh, setLocalRefresh] = useState(0);

  useEffect(() => {
    if (!contractId) {
      setOrders([]);
      onOrdersLoaded?.([]);
      return;
    }
    let cancelled = false;
    setListLoading(true);
    variationOrdersApi
      .list({ contractId })
      .then((rows) => {
        if (cancelled) return;
        const sorted = [...rows].sort((a, b) => (a.sequenceNo ?? 0) - (b.sequenceNo ?? 0));
        setOrders(sorted);
        onOrdersLoaded?.(sorted);
      })
      .catch(() => {
        if (cancelled) return;
        setOrders([]);
        onOrdersLoaded?.([]);
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [contractId, refreshSignal, localRefresh, onOrdersLoaded]);

  useEffect(() => {
    if (!highlightOrderId || orders.length === 0) return;
    const timer = window.setTimeout(() => {
      document.getElementById(`vo-order-${highlightOrderId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [highlightOrderId, orders]);

  const runAction = useCallback(
    async (id: string, action: 'submit' | 'approve' | 'reject' | 'delete') => {
      setBusyId(id);
      try {
        if (action === 'submit') await variationOrdersApi.submit(id);
        else if (action === 'approve') await variationOrdersApi.approve(id);
        else if (action === 'reject') await variationOrdersApi.reject(id);
        else await variationOrdersApi.delete(id);

        const msgKey =
          action === 'submit'
            ? 'vo_submitted'
            : action === 'approve'
              ? 'vo_approved'
              : action === 'reject'
                ? 'vo_rejected'
                : 'vo_deleted';
        toast.success(t(msgKey));
        setLocalRefresh((k) => k + 1);
        onChanged();
      } catch (err) {
        const msg = err instanceof Error && err.message ? err.message : t('vo_action_failed');
        toast.error(msg);
      } finally {
        setBusyId(null);
      }
    },
    [onChanged, t],
  );

  const statusLabel = (status: VoStatus): string => {
    const key = `vo_status_${status}`;
    const translated = t(key);
    return translated === key ? status : translated;
  };

  const statusCls = (status: VoStatus): string =>
    status === 'approved'
      ? 'bg-green-500/15 text-green-500'
      : status === 'rejected'
        ? 'bg-red-500/15 text-red-500'
        : status === 'submitted'
          ? 'bg-amber-500/15 text-amber-500'
          : 'bg-gray-500/15 text-gray-400';

  const sectionBandCls = cn(
    isDark ? 'bg-indigo-950/40 text-indigo-100' : isSoft ? 'bg-indigo-50 text-[#37474f]' : 'bg-indigo-50 text-indigo-950',
  );
  const totalBandCls = cn(
    'border-t font-bold text-[10px]',
    isDark ? 'bg-indigo-950/25 border-indigo-900/50 text-indigo-100' :
    isSoft ? 'bg-indigo-50/80 border-indigo-100 text-[#37474f]' :
    'bg-indigo-50/70 border-indigo-100 text-indigo-900',
  );
  const lineRowCls = cn(
    'border-b transition-colors',
    isDark ? 'border-indigo-900/30 bg-indigo-950/10' :
    isSoft ? 'border-indigo-100/80 bg-indigo-50/40' :
    'border-indigo-50 bg-indigo-50/30',
  );

  const stickyActionCls = (extra?: string) =>
    cn(
      'p-2 align-middle sticky right-0 z-10 border-l shadow-[inset_1px_0_0_rgba(0,0,0,0.06)]',
      isDark ? 'border-gray-800' : isSoft ? 'border-[#cfd8dc]' : 'border-gray-200',
      extra,
    );

  const renderLineRow = (order: VariationOrder, line: VariationOrderLine, lineIdx: number) => {
    const created = line.createdBoqItemId ? boqItemsById?.get(line.createdBoqItemId) : undefined;
    const typeLabel =
      line.lineType === 'new_item'
        ? t('vo_line_new_item')
        : line.lineType === 'adjust'
          ? t('vo_line_adjust')
          : t('vo_line_delete_item');

    const chapterName = created?.chapterName ?? line.chapterName ?? '';
    const chapterCode = created?.chapterCode ?? line.chapterCode ?? '';
    const sectionName = created?.sectionName ?? line.sectionName ?? '';
    const sectionCode = created?.sectionCode ?? line.sectionCode ?? '';
    const workType = created?.workTypeCode ?? line.workTypeCode ?? '-';
    const itemCode =
      created?.itemCode ??
      line.itemCode ??
      line.boqItemCode ??
      '';
    const description =
      created?.description ??
      line.description ??
      line.boqItemDescription ??
      '';
    const unit = created?.unit ?? line.unit ?? line.boqItemUnit ?? '';

    let qty: number | null = null;
    let unitRate: number | null = null;
    if (line.lineType === 'new_item') {
      qty = created?.tenderQty ?? Number(line.tenderQty ?? 0);
      unitRate = created?.unitRateTotal ?? Number(line.unitRateTotal ?? 0);
    } else if (line.lineType === 'adjust') {
      qty = line.newTenderQty != null ? Number(line.newTenderQty) : Number(line.boqTenderQty ?? 0);
      unitRate = line.newUnitRate != null ? Number(line.newUnitRate) : Number(line.boqUnitRate ?? 0);
    } else {
      qty = line.boqTenderQty != null ? Number(line.boqTenderQty) : null;
      unitRate = line.boqUnitRate != null ? Number(line.boqUnitRate) : null;
    }

    const amount = Number(line.lineAmount ?? created?.tenderAmount ?? 0);
    const amountCls = amount < 0 ? 'text-red-400' : 'text-green-400';

    return (
      <tr key={listKey(line.id, lineIdx, `${order.id}-line`)} className={lineRowCls}>
        <td className={stickyActionCls(isDark ? 'bg-[#12141a]/95' : isSoft ? 'bg-[#f5f8fb]' : 'bg-indigo-50/90')}>
          <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded', statusCls(order.status))}>
            {typeLabel}
          </span>
        </td>
        <td className="p-4 text-[10px]">
          <div className="font-bold whitespace-nowrap overflow-hidden text-ellipsis max-w-[80px]">{chapterName || '—'}</div>
          <div className="text-[8px] opacity-50">{chapterCode}</div>
        </td>
        <td className="p-4 text-[10px]">
          <div className="whitespace-nowrap overflow-hidden text-ellipsis max-w-[80px]">{sectionName || '—'}</div>
          <div className="text-[8px] opacity-50">{sectionCode}</div>
        </td>
        <td className="p-4 text-[10px] font-mono text-gray-500">{workType || '-'}</td>
        <td className="p-4 font-mono text-[10px] text-indigo-400">{itemCode || '—'}</td>
        <td className="p-4 text-xs font-medium max-w-[150px] whitespace-normal">
          <div className="line-clamp-2" title={description}>{description || '—'}</div>
        </td>
        <td className="p-4 text-xs text-gray-400">{unit || '—'}</td>
        <td className="p-4 text-xs font-bold">{qty != null ? formatNumber(qty) : '—'}</td>
        <td className="p-4 text-[10px] font-mono text-gray-400">—</td>
        <td className="p-4 text-[10px] font-mono">—</td>
        <td className="p-4 text-[10px] font-mono text-gray-500">—</td>
        <td className="p-4 text-[10px] text-gray-500">—</td>
        <td className="p-4 text-[10px] text-gray-500">—</td>
        <td className="p-4 text-[10px] font-mono text-gray-400">
          {created?.rateMaterials != null ? formatNumber(created.rateMaterials) : '—'}
        </td>
        <td className="p-4 text-[10px] font-mono text-gray-400">
          {created?.rateLabour != null ? formatNumber(created.rateLabour) : '—'}
        </td>
        <td className="p-4 text-[10px] font-mono text-gray-400">
          {created?.rateEquipment != null ? formatNumber(created.rateEquipment) : '—'}
        </td>
        <td className="p-4 text-[10px] font-mono text-gray-500">
          {created?.rateOverheadPct != null ? `${created.rateOverheadPct}%` : '—'}
        </td>
        <td className="p-4 text-[10px] font-mono text-gray-500">
          {created?.rateProfitPct != null ? `${created.rateProfitPct}%` : '—'}
        </td>
        <td className="p-4 text-xs font-bold text-indigo-400">
          {unitRate != null ? formatNumber(unitRate) : '—'}
        </td>
        <td className={cn('p-4 text-xs font-bold', amountCls)}>{formatNumber(amount)}</td>
        {hasLocalExtraCols ? (
          <>
            <td className="p-4 text-xs font-mono text-gray-500">—</td>
            <td className="p-4 text-xs font-mono text-gray-500">—</td>
          </>
        ) : null}
      </tr>
    );
  };

  const renderOrderActions = (order: VariationOrder) => {
    const busy = busyId === order.id;
    return (
      <div className="inline-flex items-center gap-1 flex-wrap justify-end">
        {onPrint && (order.status === 'approved' || order.status === 'submitted') ? (
          <button
            type="button"
            onClick={() => onPrint(order)}
            className="p-1 text-blue-500 hover:text-blue-400"
            title={t('vo_print')}
          >
            <Printer size={14} />
          </button>
        ) : null}
        {canWrite && order.status === 'draft' ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runAction(order.id, 'submit')}
              className="p-1 text-amber-500 hover:text-amber-400"
              title={t('vo_submit')}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runAction(order.id, 'delete')}
              className="p-1 text-red-500 hover:text-red-400"
              title={t('delete')}
            >
              <Trash2 size={14} />
            </button>
          </>
        ) : null}
        {canApprove && order.status === 'submitted' ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runAction(order.id, 'approve')}
              className="p-1 text-green-500 hover:text-green-400"
              title={t('ipc_approve')}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runAction(order.id, 'reject')}
              className="p-1 text-red-500 hover:text-red-400"
              title={t('vo_reject')}
            >
              <XCircle size={14} />
            </button>
          </>
        ) : null}
      </div>
    );
  };

  if (!inline) {
    // Legacy standalone panel — kept for any non-BOQ host; BOQ uses inline.
    const panelCls = cn(
      'rounded-xl border overflow-hidden mt-6',
      isDark ? 'bg-[#151619] border-gray-800' : 'bg-white border-gray-200 shadow-sm',
    );
    return (
      <div className={panelCls}>
        <div className={cn('flex items-center justify-between gap-2 px-4 py-3 border-b', isDark ? 'border-gray-800' : 'border-gray-200')}>
          <div className="flex items-center gap-2">
            <FileDiff size={18} className="text-blue-500" />
            <h3 className="font-bold text-sm">{t('vo_section_title')}</h3>
            <ManualHelpButton topicId="technical.boq.vo" size={14} />
          </div>
          {canWrite ? (
            <button
              type="button"
              onClick={onNewOrder}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-500"
            >
              {t('vo_new_order')}
            </button>
          ) : null}
        </div>
        {listLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="animate-spin text-blue-500" size={24} />
          </div>
        ) : orders.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">{t('vo_empty')}</p>
        ) : (
          <ul className="divide-y divide-gray-800/30 px-4 py-2">
            {orders.map((order, oi) => (
              <li key={listKey(order.id, oi, `vo-${order.voNumber}`)} className="py-3 flex items-center justify-between gap-3">
                <div>
                  <div className="font-mono text-xs font-bold">{order.voNumber}</div>
                  <div className="text-xs text-gray-500">{formatMoney(Number(order.totalValue))}</div>
                </div>
                {renderOrderActions(order)}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (listLoading) {
    return (
      <tbody>
        <tr>
          <td colSpan={colSpan} className="p-6 text-center text-gray-500">
            <Loader2 className="inline animate-spin text-blue-500 me-2" size={18} />
            {t('loading_items')}
          </td>
        </tr>
      </tbody>
    );
  }

  if (orders.length === 0) {
    return (
      <tbody>
        <tr className={sectionBandCls}>
          <td
            className={stickyActionCls(
              cn(sectionBandCls, isDark ? 'bg-indigo-950/50' : isSoft ? 'bg-indigo-50' : 'bg-indigo-50'),
            )}
          >
            {canWrite ? (
              <button
                type="button"
                onClick={onNewOrder}
                className="text-[10px] font-semibold px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-500"
              >
                {t('vo_new_order')}
              </button>
            ) : null}
          </td>
          <td colSpan={colSpan - 1} className="p-4">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <FileDiff size={14} className="text-indigo-500" />
              <span>{t('vo_section_title')}</span>
              <ManualHelpButton topicId="technical.boq.vo" size={12} />
              <span className="text-gray-500 font-normal">— {t('vo_empty')}</span>
            </div>
          </td>
        </tr>
      </tbody>
    );
  }

  return (
    <>
      {orders.map((order, oi) => {
        const highlighted = highlightOrderId === order.id;
        const headerBg = cn(
          sectionBandCls,
          highlighted && (isDark ? 'ring-1 ring-inset ring-blue-500/50' : 'ring-1 ring-inset ring-blue-400'),
        );
        return (
          <tbody key={listKey(order.id, oi, `vo-body-${order.voNumber}`)}>
            <tr id={`vo-order-${order.id}`} className={headerBg}>
              <td
                className={stickyActionCls(
                  cn(headerBg, isDark ? 'bg-indigo-950/55' : isSoft ? 'bg-indigo-50' : 'bg-indigo-50'),
                )}
              >
                {renderOrderActions(order)}
              </td>
              <td colSpan={colSpan - 1} className="p-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <FileDiff size={14} className="text-indigo-500 shrink-0" />
                  <span className="font-bold">
                    {t('vo_inline_section_title')} {order.voNumber}
                  </span>
                  {order.title ? <span className="opacity-80">{order.title}</span> : null}
                  {order.voDate ? (
                    <span className="font-mono text-[10px] opacity-70">{order.voDate}</span>
                  ) : null}
                  <span className={cn('px-2 py-0.5 rounded text-[10px] font-bold uppercase', statusCls(order.status))}>
                    {statusLabel(order.status)}
                  </span>
                  {oi === 0 ? <ManualHelpButton topicId="technical.boq.vo" size={12} /> : null}
                  {canWrite && oi === 0 ? (
                    <button
                      type="button"
                      onClick={onNewOrder}
                      className="ms-auto text-[10px] font-semibold px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-500"
                    >
                      {t('vo_new_order')}
                    </button>
                  ) : null}
                </div>
                {order.notes ? <p className="text-[10px] opacity-60 mt-1">{order.notes}</p> : null}
              </td>
            </tr>
            {order.lines.length === 0 ? (
              <tr className={lineRowCls}>
                <td colSpan={colSpan} className="p-4 text-center text-xs text-gray-500">
                  {t('vo_empty_lines')}
                </td>
              </tr>
            ) : (
              order.lines.map((line, lineIdx) => renderLineRow(order, line, lineIdx))
            )}
            <tr className={totalBandCls}>
              <td
                className={stickyActionCls(
                  cn(totalBandCls, isDark ? 'bg-indigo-950/40' : isSoft ? 'bg-indigo-50/90' : 'bg-indigo-50/80'),
                )}
              />
              <td colSpan={12} className="p-4 text-xs uppercase tracking-wide">
                {t('vo_section_total')} — {order.voNumber}
              </td>
              <td className="p-4" />
              <td className="p-4" />
              <td className="p-4" />
              <td className="p-4" />
              <td className="p-4" />
              <td className="p-4" />
              <td
                className={cn(
                  'p-4 text-xs',
                  Number(order.totalValue) < 0 ? 'text-red-400' : 'text-indigo-400',
                )}
              >
                {formatNumber(Number(order.totalValue || 0))}
              </td>
              {hasLocalExtraCols ? (
                <>
                  <td className="p-4" />
                  <td className="p-4" />
                </>
              ) : null}
            </tr>
          </tbody>
        );
      })}
    </>
  );
}
