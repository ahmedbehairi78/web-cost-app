import React, { memo, type MutableRefObject } from 'react';
import { Download, Upload } from 'lucide-react';
import { cn, roundMoney2 } from '../../lib/utils';
import { formatNumber } from '../../lib/numberLocale';
import { SpreadsheetCellInput } from '../ui/SpreadsheetCellInput';

export type IpcGridItem = {
  boqItemId?: string;
  itemCode?: string;
  description?: string;
  unit?: string;
  tenderQty?: number;
  rate: number;
  previousQty: number;
  currentQty: number;
  totalQty: number;
};

type Props = {
  theme: string;
  language: string;
  items: IpcGridItem[];
  gridRefs: MutableRefObject<(HTMLInputElement | null)[][]>;
  onExportTemplate: () => void;
  onImportExcel: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRateChange: (idx: number, rate: number) => void;
  onQtyChange: (idx: number, qty: number) => void;
};

function IpcItemsGridInner({
  theme,
  language,
  items,
  gridRefs,
  onExportTemplate,
  onImportExcel,
  onRateChange,
  onQtyChange,
}: Props) {
  const isAr = language === 'ar';
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h4 className="text-sm font-bold text-gray-400 uppercase">{isAr ? 'بنود المستخلص' : 'IPC Items'}</h4>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onExportTemplate}
            className="text-xs bg-gray-800 hover:bg-gray-700 px-3 py-1 rounded flex items-center gap-1"
          >
            <Download size={14} />
            {isAr ? 'نموذج' : 'Template'}
          </button>
          <label className="text-xs bg-blue-900/20 text-blue-400 hover:bg-blue-900/40 px-3 py-1 rounded flex items-center gap-1 cursor-pointer">
            <Upload size={14} />
            {isAr ? 'استيراد' : 'Import'}
            <input
              type="file"
              aria-label={isAr ? 'استيراد ملف إكسل' : 'Import Excel file'}
              title={isAr ? 'استيراد ملف إكسل' : 'Import Excel file'}
              className="hidden"
              accept=".xlsx,.xls"
              onChange={onImportExcel}
            />
          </label>
        </div>
      </div>
      <div
        className={cn(
          'border rounded-xl overflow-auto max-h-[min(55vh,32rem)]',
          theme === 'dark' ? 'border-gray-800' : 'border-gray-200',
        )}
      >
        <table className="w-full min-w-[52rem] text-xs text-right">
          <thead
            className={cn(
              'sticky top-0 z-10',
              theme === 'dark' ? 'bg-gray-900/95 text-gray-400' : 'bg-gray-50 text-gray-600',
            )}
          >
            <tr>
              <th className="p-2 whitespace-nowrap">{isAr ? 'كود' : 'Code'}</th>
              <th className="p-2 min-w-[14rem]">{isAr ? 'البيان' : 'Desc'}</th>
              <th className="p-2">{isAr ? 'الوحدة' : 'Unit'}</th>
              <th className="p-2">{isAr ? 'الكمية' : 'Qty'}</th>
              <th className="p-2 min-w-[5.5rem]">{isAr ? 'الفئة' : 'Rate'}</th>
              <th className="p-2">{isAr ? 'سابق' : 'Prev'}</th>
              <th className="p-2 min-w-[5.5rem]">{isAr ? 'حالي' : 'Curr'}</th>
              <th className="p-2">{isAr ? 'إجمالي' : 'Total'}</th>
            </tr>
          </thead>
          <tbody className={cn('divide-y', theme === 'dark' ? 'divide-gray-800' : 'divide-gray-200')}>
            {items.map((item, idx) => (
              <tr
                key={item.boqItemId || `${item.itemCode || 'ipc-item'}-${idx}`}
                className={theme === 'dark' ? 'hover:bg-gray-900/40' : 'hover:bg-gray-50'}
              >
                <td className="p-2 font-mono whitespace-nowrap">{item.itemCode}</td>
                <td className="p-2 min-w-[14rem] max-w-[22rem] whitespace-normal leading-snug" title={item.description}>
                  {item.description}
                </td>
                <td className="p-2 whitespace-nowrap">{item.unit}</td>
                <td className="p-2 font-mono text-gray-400 whitespace-nowrap">{formatNumber(item.tenderQty ?? 0)}</td>
                <td className="p-2">
                  <SpreadsheetCellInput
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    row={idx}
                    col={0}
                    rowCount={items.length}
                    colCount={2}
                    gridRefs={gridRefs}
                    variant="rate"
                    theme={theme}
                    aria-label={isAr ? `سعر البند ${item.itemCode}` : `Rate for ${item.itemCode}`}
                    value={Number.isFinite(item.rate) ? roundMoney2(item.rate) : ''}
                    onChange={(e) => onRateChange(idx, Number(e.target.value))}
                  />
                </td>
                <td className="p-2 font-mono text-gray-500 whitespace-nowrap">{item.previousQty}</td>
                <td className="p-2">
                  <SpreadsheetCellInput
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    row={idx}
                    col={1}
                    rowCount={items.length}
                    colCount={2}
                    gridRefs={gridRefs}
                    variant="qty"
                    theme={theme}
                    aria-label={isAr ? `الكمية الحالية للبند ${item.itemCode}` : `Current quantity for ${item.itemCode}`}
                    value={item.currentQty}
                    onChange={(e) => onQtyChange(idx, Number(e.target.value))}
                  />
                </td>
                <td className="p-2 font-mono font-bold whitespace-nowrap">{formatNumber(item.totalQty * item.rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export const IpcItemsGrid = memo(IpcItemsGridInner);
