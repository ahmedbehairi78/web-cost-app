import React, { memo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';

export type InvoiceLineEditorRow = {
  id: string;
  materialCategoryId?: number;
  itemDescription: string;
  unit: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  inventoryUnitCost: number;
  boqItemIds?: string[];
};

export type InvoiceBoqOption = {
  id: string;
  itemCode?: string;
  description?: string;
  unit?: string;
};

export type InvoiceMaterialOption = {
  id: number;
  code?: string;
  name: string;
  unit: string;
};

type Props = {
  theme: string;
  language: string;
  inputCls: string;
  title: string;
  lines: InvoiceLineEditorRow[];
  boqItems: InvoiceBoqOption[];
  materialCategories: InvoiceMaterialOption[];
  showMaterials: boolean;
  formatMoney: (value: unknown) => string;
  onAddLine: () => void;
  onRemoveLine: (lineId: string) => void;
  onFieldChange: (lineId: string, field: 'itemDescription' | 'unit' | 'quantity' | 'unitCost', value: string | number) => void;
  onBoqToggle: (lineId: string, boqItemId: string) => void;
  onMaterialSelect: (lineId: string, materialCategoryId: string) => void;
};

function InvoiceLinesEditorInner({
  theme,
  language,
  inputCls,
  title,
  lines,
  boqItems,
  materialCategories,
  showMaterials,
  formatMoney,
  onAddLine,
  onRemoveLine,
  onFieldChange,
  onBoqToggle,
  onMaterialSelect,
}: Props) {
  const isAr = language === 'ar';
  return (
    <div className={cn('rounded-xl border p-4', theme === 'dark' ? 'border-gray-800 bg-gray-900/30' : 'border-gray-200 bg-gray-50')}>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-bold text-gray-400 uppercase">{title}</h4>
        <button
          type="button"
          onClick={onAddLine}
          className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded flex items-center gap-1"
        >
          <Plus size={12} />
          {isAr ? 'إضافة بند' : 'Add Line'}
        </button>
      </div>
      <div className="space-y-4 max-h-80 overflow-y-auto pe-1">
        {lines.map((line, lineIdx) => (
          <div
            key={line.id}
            className={cn('rounded-lg border p-3 space-y-3', theme === 'dark' ? 'border-gray-800 bg-gray-900/40' : 'border-gray-200 bg-white')}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-gray-400">
                {isAr ? `البند ${lineIdx + 1}` : `Line ${lineIdx + 1}`}
              </span>
              <button
                type="button"
                onClick={() => onRemoveLine(line.id)}
                className="text-red-400 hover:text-red-300"
                aria-label={isAr ? 'حذف البند' : 'Remove line'}
              >
                <Trash2 size={14} />
              </button>
            </div>
            {boqItems.length > 0 && (
              <div>
                <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">
                  {isAr ? 'ربط ببنود BOQ (اختياري)' : 'Link BOQ items (optional)'}
                </label>
                <div
                  className={cn(
                    'max-h-40 overflow-y-auto rounded-lg border p-2 space-y-1',
                    theme === 'dark' ? 'border-gray-700 bg-gray-900/50' : 'border-gray-300 bg-gray-50',
                  )}
                >
                  {boqItems.map((b, idx) => {
                    const selectedIds = line.boqItemIds || [];
                    const isChecked = selectedIds.includes(b.id);
                    return (
                      <label
                        key={b.id || `${b.itemCode || 'boq'}-${idx}`}
                        className={cn(
                          'flex items-start gap-2 p-2 rounded cursor-pointer text-xs hover:bg-opacity-50',
                          theme === 'dark' ? 'hover:bg-gray-800' : 'hover:bg-gray-200',
                          isChecked && (theme === 'dark' ? 'bg-blue-900/30' : 'bg-blue-50'),
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => onBoqToggle(line.id, b.id)}
                          className="mt-0.5 flex-shrink-0"
                        />
                        <span className={cn('flex-1', isChecked && 'font-medium')}>
                          <span className="font-mono text-blue-400">{b.itemCode}</span>
                          {' — '}
                          <span>{b.description}</span>
                          {' '}
                          <span className="text-gray-500">({b.unit})</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {(line.boqItemIds || []).length > 0 && (
                  <div className="mt-1 text-xs text-blue-400">
                    {isAr
                      ? `${(line.boqItemIds || []).length} بند مربوط`
                      : `${(line.boqItemIds || []).length} item(s) linked`}
                  </div>
                )}
              </div>
            )}
            {showMaterials && materialCategories.length > 0 && (
              <select
                className={cn(inputCls, 'py-2 px-3 w-full text-xs mb-2')}
                value={line.materialCategoryId || ''}
                onChange={(e) => onMaterialSelect(line.id, e.target.value)}
                title={isAr ? 'اختيار صنف المادة' : 'Select material category'}
                aria-label={isAr ? 'اختيار صنف المادة' : 'Select material category'}
              >
                <option value="">{isAr ? '— اختر الصنف —' : '— Select material —'}</option>
                {materialCategories.map((c, idx) => (
                  <option key={c.id || `${c.code || 'material'}-${idx}`} value={c.id}>
                    {c.code} — {c.name} ({c.unit})
                  </option>
                ))}
              </select>
            )}
            <div className="grid grid-cols-4 gap-2">
              <input
                type="text"
                aria-label={isAr ? 'وصف البند' : 'Line description'}
                placeholder={isAr ? 'الوصف' : 'Description'}
                className={cn(inputCls, 'py-2 px-3')}
                value={line.itemDescription}
                onChange={(e) => onFieldChange(line.id, 'itemDescription', e.target.value)}
                readOnly={showMaterials && !!line.materialCategoryId}
              />
              <input
                type="text"
                aria-label={isAr ? 'الوحدة' : 'Unit'}
                placeholder={isAr ? 'الوحدة' : 'Unit'}
                className={cn(inputCls, 'py-2 px-3')}
                value={line.unit}
                onChange={(e) => onFieldChange(line.id, 'unit', e.target.value)}
              />
              <input
                type="number"
                step="0.01"
                aria-label={isAr ? 'الكمية' : 'Quantity'}
                placeholder={isAr ? 'الكمية' : 'Qty'}
                className={cn(inputCls, 'py-2 px-3')}
                value={line.quantity || ''}
                onChange={(e) => onFieldChange(line.id, 'quantity', Number(e.target.value))}
              />
              <input
                type="number"
                step="0.01"
                aria-label={isAr ? 'سعر الوحدة' : 'Unit cost'}
                placeholder={isAr ? 'سعر الوحدة' : 'Unit Cost'}
                className={cn(inputCls, 'py-2 px-3')}
                value={line.unitCost || ''}
                onChange={(e) => onFieldChange(line.id, 'unitCost', Number(e.target.value))}
              />
            </div>
            <div className="text-xs text-gray-400 space-y-0.5">
              <div>
                {isAr ? 'إجمالي البند (بدون ضريبة)' : 'Line total (ex-VAT)'}:{' '}
                <span className="font-mono">{formatMoney(line.totalCost)}</span>
              </div>
              <div>
                {isAr ? 'تكلفة الوحدة للمخزون (شامل ض.ق.م)' : 'Inventory unit cost (incl. VAT)'}:{' '}
                <span className="font-mono text-blue-400">{formatMoney(line.inventoryUnitCost)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export const InvoiceLinesEditor = memo(InvoiceLinesEditorInner);
