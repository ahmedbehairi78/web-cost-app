import React, { memo, type MutableRefObject } from 'react';
import { Download, Upload, Plus, Trash2 } from 'lucide-react';
import { cn, roundMoney2 } from '../../lib/utils';
import { formatNumber } from '../../lib/numberLocale';
import { SpreadsheetCellInput } from '../ui/SpreadsheetCellInput';
import { SearchableSelect } from '../ui/SearchableSelect';
import { ipcLinePeriodValue, ipcLineToDateValue } from '../../lib/ipcProgressValue';

export type IpcGridItem = {
  boqItemId?: string;
  /** Client BOQ item that receives cost load. */
  clientBoqItemId?: string;
  itemCode?: string;
  description?: string;
  unit?: string;
  tenderQty?: number;
  rate: number;
  previousQty: number;
  currentQty: number;
  totalQty: number;
  completionPct?: number;
  previousCompletionPct?: number;
  amount?: number;
};

export type ClientBoqOption = {
  value: string;
  label: string;
  secondary?: string;
};

type Props = {
  theme: string;
  language: string;
  items: IpcGridItem[];
  gridRefs: MutableRefObject<(HTMLInputElement | null)[][]>;
  clientBoqOptions: ClientBoqOption[];
  readOnly?: boolean;
  onExportTemplate: () => void;
  onImportExcel: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onAddLine: () => void;
  onRemoveLine: (idx: number) => void;
  onFieldChange: (
    idx: number,
    field:
      | 'description'
      | 'unit'
      | 'itemCode'
      | 'tenderQty'
      | 'rate'
      | 'currentQty'
      | 'completionPct'
      | 'clientBoqItemId',
    value: string | number,
  ) => void;
};

function IpcItemsGridInner({
  theme,
  language,
  items,
  gridRefs,
  clientBoqOptions,
  readOnly = false,
  onExportTemplate,
  onImportExcel,
  onAddLine,
  onRemoveLine,
  onFieldChange,
}: Props) {
  const isAr = language === 'ar';
  const colCount = 5;

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <h4 className="text-sm font-bold text-gray-400 uppercase">
          {isAr ? 'بنود المستخلص (تحليل مقاول)' : 'IPC Items (subcontractor breakdown)'}
        </h4>
        {!readOnly && (
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={onAddLine}
              className="text-xs bg-emerald-900/30 text-emerald-400 hover:bg-emerald-900/50 px-3 py-1 rounded flex items-center gap-1"
            >
              <Plus size={14} />
              {isAr ? 'بند' : 'Add'}
            </button>
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
        )}
      </div>
      <p className={cn('text-[10px]', theme === 'dark' ? 'text-gray-500' : 'text-gray-500')}>
        {isAr
          ? 'كل سطر عمل فرعي بتكلفة مقاول — اربطه ببند قائمة كميات العميل لتحميل التكلفة. القيمة = الكمية × الفئة × نسبة الإنجاز %.'
          : 'Each row is a subcontractor work line — link it to a client BOQ item for cost loading. Value = qty × rate × completion %.'}
      </p>
      <div
        className={cn(
          'border rounded-xl overflow-auto max-h-[min(55vh,32rem)]',
          theme === 'dark' ? 'border-gray-800' : 'border-gray-200',
        )}
      >
        <table className="w-full min-w-[72rem] text-xs text-right">
          <thead
            className={cn(
              'sticky top-0 z-10',
              theme === 'dark' ? 'bg-gray-900/95 text-gray-400' : 'bg-gray-50 text-gray-600',
            )}
          >
            <tr>
              <th className="p-2 whitespace-nowrap">{isAr ? 'كود' : 'Code'}</th>
              <th className="p-2 min-w-[12rem]">{isAr ? 'البيان' : 'Desc'}</th>
              <th className="p-2">{isAr ? 'الوحدة' : 'Unit'}</th>
              <th className="p-2 min-w-[10rem]">{isAr ? 'بند العميل' : 'Client BOQ'}</th>
              <th className="p-2">{isAr ? 'كمية عقد' : 'Tender'}</th>
              <th className="p-2 min-w-[5rem]">{isAr ? 'الفئة' : 'Rate'}</th>
              <th className="p-2">{isAr ? 'سابق' : 'Prev'}</th>
              <th className="p-2 min-w-[5rem]">{isAr ? 'حالي' : 'Curr'}</th>
              <th className="p-2 min-w-[4.5rem]">{isAr ? 'نسبة %' : 'Comp %'}</th>
              <th className="p-2">{isAr ? 'قيمة الفترة' : 'Period'}</th>
              <th className="p-2">{isAr ? 'حتى تاريخه' : 'To-date'}</th>
              {!readOnly && <th className="p-2 w-8" />}
            </tr>
          </thead>
          <tbody className={cn('divide-y', theme === 'dark' ? 'divide-gray-800' : 'divide-gray-200')}>
            {items.length === 0 ? (
              <tr>
                <td
                  colSpan={readOnly ? 11 : 12}
                  className={cn('p-6 text-center', theme === 'dark' ? 'text-gray-500' : 'text-gray-400')}
                >
                  {isAr
                    ? 'لا بنود — استورد من إكسل أو أضف بنداً واربطه ببند العميل.'
                    : 'No lines — import Excel or add a line and link a client BOQ item.'}
                </td>
              </tr>
            ) : (
              items.map((item, idx) => {
                const toDate = ipcLineToDateValue(item);
                const period = ipcLinePeriodValue(item);
                return (
                  <tr
                    key={`${item.itemCode || 'row'}-${idx}`}
                    className={theme === 'dark' ? 'hover:bg-gray-900/40' : 'hover:bg-gray-50'}
                  >
                    <td className="p-1">
                      {readOnly ? (
                        <span className="font-mono whitespace-nowrap px-1">{item.itemCode}</span>
                      ) : (
                        <SpreadsheetCellInput
                          type="text"
                          row={idx}
                          col={0}
                          rowCount={items.length}
                          colCount={colCount}
                          gridRefs={gridRefs}
                          variant="qty"
                          theme={theme}
                          value={item.itemCode ?? ''}
                          onChange={(e) => onFieldChange(idx, 'itemCode', e.target.value)}
                        />
                      )}
                    </td>
                    <td className="p-1 min-w-[12rem]">
                      {readOnly ? (
                        <span className="leading-snug">{item.description}</span>
                      ) : (
                        <SpreadsheetCellInput
                          type="text"
                          row={idx}
                          col={1}
                          rowCount={items.length}
                          colCount={colCount}
                          gridRefs={gridRefs}
                          variant="qty"
                          theme={theme}
                          className="text-start min-w-[12rem]"
                          value={item.description ?? ''}
                          onChange={(e) => onFieldChange(idx, 'description', e.target.value)}
                        />
                      )}
                    </td>
                    <td className="p-1">
                      {readOnly ? (
                        item.unit
                      ) : (
                        <SpreadsheetCellInput
                          type="text"
                          row={idx}
                          col={2}
                          rowCount={items.length}
                          colCount={colCount}
                          gridRefs={gridRefs}
                          variant="qty"
                          theme={theme}
                          value={item.unit ?? ''}
                          onChange={(e) => onFieldChange(idx, 'unit', e.target.value)}
                        />
                      )}
                    </td>
                    <td className="p-1 min-w-[10rem]">
                      {readOnly ? (
                        <span className="text-[10px]">
                          {clientBoqOptions.find((o) => o.value === item.clientBoqItemId)?.label
                            || item.clientBoqItemId
                            || '—'}
                        </span>
                      ) : (
                        <SearchableSelect
                          theme={theme}
                          dir={isAr ? 'rtl' : 'ltr'}
                          value={item.clientBoqItemId || ''}
                          onChange={(v) => onFieldChange(idx, 'clientBoqItemId', v)}
                          placeholder={isAr ? 'بند العميل' : 'Client BOQ'}
                          options={clientBoqOptions}
                        />
                      )}
                    </td>
                    <td className="p-2 font-mono text-gray-400 whitespace-nowrap">
                      {formatNumber(item.tenderQty ?? 0)}
                    </td>
                    <td className="p-1">
                      {readOnly ? (
                        formatNumber(item.rate)
                      ) : (
                        <SpreadsheetCellInput
                          type="number"
                          step="0.01"
                          inputMode="decimal"
                          row={idx}
                          col={3}
                          rowCount={items.length}
                          colCount={colCount}
                          gridRefs={gridRefs}
                          variant="rate"
                          theme={theme}
                          value={Number.isFinite(item.rate) ? roundMoney2(item.rate) : ''}
                          onChange={(e) => onFieldChange(idx, 'rate', Number(e.target.value))}
                        />
                      )}
                    </td>
                    <td className="p-2 font-mono text-gray-500 whitespace-nowrap">{item.previousQty}</td>
                    <td className="p-1">
                      {readOnly ? (
                        item.currentQty
                      ) : (
                        <SpreadsheetCellInput
                          type="number"
                          step="0.01"
                          inputMode="decimal"
                          row={idx}
                          col={4}
                          rowCount={items.length}
                          colCount={colCount}
                          gridRefs={gridRefs}
                          variant="qty"
                          theme={theme}
                          value={item.currentQty}
                          onChange={(e) => onFieldChange(idx, 'currentQty', Number(e.target.value))}
                        />
                      )}
                    </td>
                    <td className="p-1">
                      {readOnly ? (
                        `${Number(item.completionPct ?? 0)}%`
                      ) : (
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          inputMode="decimal"
                          className={cn(
                            'w-full min-w-[4rem] border rounded py-1.5 px-2 text-center outline-none focus:border-blue-500 font-mono text-sm',
                            theme === 'dark'
                              ? 'bg-gray-900 border-gray-700 text-amber-300'
                              : 'bg-white border-gray-300 text-amber-800',
                          )}
                          value={Number.isFinite(Number(item.completionPct)) ? Number(item.completionPct) : ''}
                          onChange={(e) => onFieldChange(idx, 'completionPct', Number(e.target.value))}
                          aria-label={isAr ? 'نسبة الإنجاز' : 'Completion %'}
                        />
                      )}
                    </td>
                    <td className="p-2 font-mono whitespace-nowrap">{formatNumber(period)}</td>
                    <td className="p-2 font-mono font-bold whitespace-nowrap">{formatNumber(toDate)}</td>
                    {!readOnly && (
                      <td className="p-1">
                        <button
                          type="button"
                          onClick={() => onRemoveLine(idx)}
                          className="p-1 text-red-400 hover:bg-red-500/10 rounded"
                          aria-label={isAr ? 'حذف البند' : 'Remove line'}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export const IpcItemsGrid = memo(IpcItemsGridInner);
