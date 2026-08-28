import React, { memo } from 'react';
import {
  Edit2,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Clock,
  ScrollText,
  Package,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { formatNumber } from '../../lib/numberLocale';
import type { BoqRowViewModel } from './boqRowViewModel';

type Props = {
  row: BoqRowViewModel;
  theme: string;
  isLocalBackend: boolean;
  linkCount: number;
  formatMoney: (n: number) => string;
  labels: {
    done: string;
    late: string;
    running: string;
    notStarted: string;
    edit: string;
    changeOrders: string;
    delete: string;
    materials: string;
  };
  onEdit: (id: string) => void;
  onChangeOrder: (id: string) => void;
  onDelete: (id: string) => void;
  onMaterials: (id: string) => void;
};

function BoqItemRowInner({
  row,
  theme,
  isLocalBackend,
  linkCount,
  formatMoney,
  labels,
  onEdit,
  onChangeOrder,
  onDelete,
  onMaterials,
}: Props) {
  return (
    <tr
      className={cn(
        'border-b transition-colors group',
        theme === 'dark'
          ? 'border-gray-800/50 hover:bg-gray-800/30'
          : theme === 'soft'
            ? 'border-[#cfd8dc] hover:bg-[#eceff1]'
            : 'border-gray-100 hover:bg-gray-50',
      )}
    >
      <td
        className={cn(
          'p-2 align-middle sticky right-0 z-10 border-l shadow-[inset_1px_0_0_rgba(0,0,0,0.06)]',
          theme === 'dark'
            ? 'bg-[#151619]/95 border-gray-800 group-hover:bg-gray-800/50'
            : theme === 'soft'
              ? 'bg-white border-[#cfd8dc] group-hover:bg-[#eceff1]'
              : 'bg-white border-gray-200 group-hover:bg-gray-50',
        )}
      >
        <div className="flex items-center justify-end gap-1 flex-nowrap">
          {isLocalBackend && (
            <button
              type="button"
              onClick={() => onMaterials(row.id)}
              className="text-emerald-500 hover:text-emerald-400 p-1 shrink-0 relative"
              title={labels.materials}
            >
              <Package size={16} />
              {linkCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-blue-600 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                  {linkCount}
                </span>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => onEdit(row.id)}
            className="text-blue-500 hover:text-blue-400 p-1 shrink-0"
            title={labels.edit}
          >
            <Edit2 size={16} />
          </button>
          <button
            type="button"
            onClick={() => onChangeOrder(row.id)}
            className="text-amber-500 hover:text-amber-400 p-1 shrink-0"
            title={labels.changeOrders}
          >
            <ScrollText size={16} />
          </button>
          <button
            type="button"
            onClick={() => onDelete(row.id)}
            className="text-red-500 hover:text-red-400 p-1 shrink-0"
            title={labels.delete}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </td>
      <td className="p-4 text-[10px]">
        <div className="font-bold whitespace-nowrap overflow-hidden text-ellipsis max-w-[80px]">{row.chapterName}</div>
        <div className="text-[8px] opacity-50">{row.chapterCode}</div>
      </td>
      <td className="p-4 text-[10px]">
        <div className="whitespace-nowrap overflow-hidden text-ellipsis max-w-[80px]">{row.sectionName}</div>
        <div className="text-[8px] opacity-50">{row.sectionCode}</div>
      </td>
      <td className="p-4 text-[10px] font-mono text-gray-500">{row.workTypeCode || '-'}</td>
      <td className="p-4 font-mono text-[10px] text-blue-400">{row.itemCode}</td>
      <td className="p-4 text-xs font-medium max-w-[150px] whitespace-normal">
        <div className="line-clamp-2" title={row.description}>
          {row.description}
        </div>
      </td>
      <td className="p-4 text-[10px]">
        <span
          className={cn(
            'inline-flex rounded-full px-2 py-0.5 font-bold',
            row.scopeType === 'optional'
              ? 'bg-amber-500/15 text-amber-600'
              : 'bg-emerald-500/10 text-emerald-600',
          )}
        >
          {row.scopeLabel}
        </span>
      </td>
      <td className="p-4 text-xs text-gray-400">{row.unit}</td>
      <td className="p-4 text-xs font-bold">{formatNumber(row.tenderQty)}</td>
      <td className="p-4 text-[10px] font-mono text-gray-400">{row.startDateKey || '-'}</td>
      <td className="p-4 text-[10px] font-mono">
        {row.expectedDuration ? (
          <div className="flex items-center gap-1">
            <Clock size={12} className="text-gray-500" />
            <span>{row.expectedDuration}</span>
          </div>
        ) : (
          '-'
        )}
      </td>
      <td className={cn('p-4 text-[10px] font-mono font-bold', row.endDateClass)}>{row.endDateLabel}</td>
      <td className="p-4">
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] font-mono">
            <span>{row.progressPct.toFixed(1)}%</span>
          </div>
          <div className={cn('w-full h-0.5 bg-gray-800 rounded-full')}>
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                row.progressPct >= 100 ? 'bg-green-500' : 'bg-blue-500',
              )}
              style={{ width: `${Math.min(row.progressPct, 100)}%` }}
            />
          </div>
        </div>
      </td>
      <td className="p-4">
        {row.status === 'done' && (
          <div className="flex items-center gap-1 text-[8px] font-bold text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded-full w-fit">
            <CheckCircle2 size={8} />
            {labels.done}
          </div>
        )}
        {row.status === 'not_started' && (
          <div className="flex items-center gap-1 text-[8px] font-bold text-gray-400 bg-gray-500/10 px-1.5 py-0.5 rounded-full w-fit">
            <Clock size={8} />
            {labels.notStarted}
          </div>
        )}
        {row.status === 'late' && (
          <div className="flex items-center gap-1 text-[8px] font-bold text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded-full w-fit">
            <AlertCircle size={8} />
            {labels.late}
          </div>
        )}
        {row.status === 'running' && (
          <div className="flex items-center gap-1 text-[8px] font-bold text-blue-500 bg-blue-500/10 px-1.5 py-0.5 rounded-full w-fit">
            <Clock size={8} />
            {labels.running}
          </div>
        )}
      </td>
      <td className="p-4 text-[10px] font-mono text-gray-400">{formatNumber(row.rateMaterials)}</td>
      <td className="p-4 text-[10px] font-mono text-gray-400">{formatNumber(row.rateLabour)}</td>
      <td className="p-4 text-[10px] font-mono text-gray-400">{formatNumber(row.rateEquipment)}</td>
      <td className="p-4 text-[10px] font-mono text-gray-500">{row.rateOverheadPct}%</td>
      <td className="p-4 text-[10px] font-mono text-gray-500">{row.rateProfitPct}%</td>
      <td className="p-4 text-xs font-bold text-blue-400">{formatNumber(row.unitRateTotal)}</td>
      <td className="p-4 text-xs font-bold text-green-400">{formatNumber(row.tenderAmount)}</td>
      {isLocalBackend && (
        <>
          <td className="p-4 text-xs font-mono text-orange-300">
            {row.actualConsumed > 0 ? formatMoney(row.actualConsumed) : '—'}
          </td>
          <td className="p-4 text-xs font-mono text-cyan-300">
            {row.inventoryBalance !== null
              ? formatNumber(row.inventoryBalance, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
              : '—'}
          </td>
        </>
      )}
    </tr>
  );
}

export const BoqItemRow = memo(BoqItemRowInner);
