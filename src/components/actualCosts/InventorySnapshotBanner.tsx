import React, { memo } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { formatQuantity } from '../../lib/formatQuantity';

export type InventorySnapshotRow = {
  id: number | string;
  projectId?: string;
  contractId?: string;
  contractNumber?: string;
  materialCategoryId?: number | string;
  itemDescription: string;
  unit: string;
  quantityBalance: number;
  quantityAvailable: number;
  unitCost: number;
};

type Props = {
  items: InventorySnapshotRow[];
  theme: string;
  language: string;
  formatMoney: (value: unknown) => string;
  onDismiss: () => void;
};

function InventorySnapshotBannerInner({ items, theme, language, formatMoney, onDismiss }: Props) {
  if (items.length === 0) return null;
  const isAr = language === 'ar';
  return (
    <div className={cn('mb-6 rounded-xl border p-4', theme === 'dark' ? 'border-green-800 bg-green-950/30' : 'border-green-200 bg-green-50')}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 size={18} className="text-green-600" />
          <span className="font-bold text-green-700 dark:text-green-400 text-sm">
            {isAr ? 'رصيد المخزون المحدَّث بعد الفاتورة' : 'Updated Inventory Balance After Invoice'}
          </span>
        </div>
        <button
          type="button"
          aria-label={isAr ? 'إغلاق' : 'Close'}
          title={isAr ? 'إغلاق' : 'Close'}
          onClick={onDismiss}
          className="text-gray-400 hover:text-gray-600"
        >
          <X size={16} />
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 border-b">
              <th className="pb-1 text-start">{isAr ? 'الصنف' : 'Item'}</th>
              <th className="pb-1 text-center">{isAr ? 'الوحدة' : 'Unit'}</th>
              <th className="pb-1 text-center">{isAr ? 'الرصيد' : 'Balance'}</th>
              <th className="pb-1 text-center">{isAr ? 'المتاح' : 'Available'}</th>
              <th className="pb-1 text-center">{isAr ? 'سعر الوحدة' : 'Unit Cost'}</th>
              <th className="pb-1 text-end">{isAr ? 'العقد' : 'Contract'}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr
                key={item.id || `${item.projectId || 'project'}-${item.materialCategoryId || item.itemDescription}-${idx}`}
                className="border-t border-dashed"
              >
                <td className="py-1 font-medium">{item.itemDescription}</td>
                <td className="py-1 text-center">{item.unit}</td>
                <td className="py-1 text-center font-mono font-bold">{formatQuantity(item.quantityBalance, language)}</td>
                <td className="py-1 text-center font-mono text-green-700 font-bold">{formatQuantity(item.quantityAvailable, language)}</td>
                <td className="py-1 text-center font-mono">{formatMoney(item.unitCost)}</td>
                <td className="py-1 text-end text-gray-500">{item.contractNumber || item.contractId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export const InventorySnapshotBanner = memo(InventorySnapshotBannerInner);
