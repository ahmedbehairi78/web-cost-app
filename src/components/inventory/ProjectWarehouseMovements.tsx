import React, { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronUp, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useLanguage } from '../../context/LanguageContext';
import {
  inventoryApi,
  type ProjectInventoryMovement,
} from '../../services/local/modulesApi';
import { formatQuantity } from '../../lib/formatQuantity';
import toast from 'react-hot-toast';
import { btnGhost, fmtMoney, tableTh } from './inventoryUiShared';

const MOVEMENT_TYPE_LABELS: Record<
  ProjectInventoryMovement['movementType'],
  { ar: string; en: string }
> = {
  receipt: { ar: 'وارد', en: 'Receipt' },
  issue: { ar: 'صرف', en: 'Issue' },
  return: { ar: 'مرتجع', en: 'Return' },
  reserve: { ar: 'حجز', en: 'Reserve' },
  release: { ar: 'إلغاء حجز', en: 'Release' },
};

export function ProjectWarehouseMovements({ projectId, refreshKey }: { projectId: string; refreshKey: string }) {
  const { language, theme } = useLanguage();
  const ar = language === 'ar';
  const [movements, setMovements] = useState<ProjectInventoryMovement[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const data = await inventoryApi.projectMovements(projectId);
      setMovements(data.movements ?? []);
    } catch {
      toast.error(ar ? 'فشل تحميل حركات المخزن' : 'Failed to load warehouse movements');
    } finally {
      setLoading(false);
    }
  }, [projectId, ar]);

  useEffect(() => {
    if (expanded) void load();
  }, [expanded, load, refreshKey]);

  return (
    <div className={cn('mt-6 border rounded-xl overflow-hidden', theme === 'dark' ? 'border-gray-700' : 'border-gray-200')}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          'w-full flex items-center justify-between px-4 py-3 text-sm font-semibold transition-colors',
          theme === 'dark' ? 'bg-gray-800 hover:bg-gray-750' : 'bg-gray-50 hover:bg-gray-100',
        )}
      >
        <span>{ar ? 'تقرير حركة مخزن المشروع' : 'Project warehouse movement report'}</span>
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {expanded && (
        <div className="p-4">
          <div className="flex justify-end mb-2">
            <button type="button" onClick={() => void load()} className={btnGhost(theme)} title={ar ? 'تحديث' : 'Refresh'} aria-label={ar ? 'تحديث' : 'Refresh'}>
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            </button>
          </div>
          {loading ? (
            <div className={cn('flex items-center gap-2 py-6 text-sm', theme === 'dark' ? 'text-gray-500' : 'text-gray-400')}>
              <Loader2 className="w-4 h-4 animate-spin" />
              {ar ? 'جاري التحميل...' : 'Loading...'}
            </div>
          ) : movements.length === 0 ? (
            <p className={cn('text-sm py-4 text-center', theme === 'dark' ? 'text-gray-500' : 'text-gray-400')}>
              {ar ? 'لا توجد حركات مسجّلة بعد' : 'No movements recorded yet'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className={tableTh(theme)}>
                  <tr>
                    <th className="p-2">{ar ? 'التاريخ' : 'Date'}</th>
                    <th className={cn('p-2', ar ? 'text-right' : 'text-left')}>{ar ? 'الصنف' : 'Item'}</th>
                    <th className="p-2 text-center">{ar ? 'النوع' : 'Type'}</th>
                    <th className="p-2 text-center">{ar ? 'الكمية' : 'Qty'}</th>
                    <th className="p-2 text-center">{ar ? 'التكلفة' : 'Unit cost'}</th>
                    <th className="p-2">{ar ? 'المرجع' : 'Reference'}</th>
                  </tr>
                </thead>
                <tbody className={cn('divide-y', theme === 'dark' ? 'divide-gray-700' : 'divide-gray-100')}>
                  {movements.map((m) => {
                    const typeLabel = MOVEMENT_TYPE_LABELS[m.movementType] ?? { ar: m.movementType, en: m.movementType };
                    return (
                      <tr key={m.id}>
                        <td className="p-2 font-mono whitespace-nowrap">{m.createdAt?.slice(0, 16) ?? '—'}</td>
                        <td className="p-2">{m.materialName || m.materialCode || '—'}</td>
                        <td className="p-2 text-center">{ar ? typeLabel.ar : typeLabel.en}</td>
                        <td className="p-2 text-center font-mono">{formatQuantity(m.quantity, language)}</td>
                        <td className="p-2 text-center font-mono">{m.unitCost != null ? fmtMoney(m.unitCost) : '—'}</td>
                        <td className="p-2 text-gray-500">
                          {[m.referenceType, m.referenceId].filter(Boolean).join(' · ') || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
