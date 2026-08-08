import React from 'react';
import { CheckCircle2, Clock, Edit2, FileDown, Printer } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { CustodySettlementRecord, CustodySettlementStatus } from '../gl/GLCustodySettlement';

interface Props {
  settlement: CustodySettlementRecord;
  theme: string;
  language: string;
  formatMoney: (value: number) => string;
  projectLabel: string;
  contractLabel: (contractId: string) => string;
  posted: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onExport: () => void;
  onPrint: () => void;
}

function statusLabel(status: CustodySettlementStatus, posted: boolean, language: string): string {
  const isAr = language === 'ar';
  if (posted || status === 'approved') return isAr ? 'معتمد' : 'Approved';
  if (status === 'submitted') return isAr ? 'بانتظار الاعتماد' : 'Pending approval';
  return isAr ? 'مسودة' : 'Draft';
}

export function CustodySettlementDetail({
  settlement,
  theme,
  language,
  formatMoney,
  projectLabel,
  contractLabel,
  posted,
  canEdit,
  onEdit,
  onExport,
  onPrint,
}: Props) {
  const isAr = language === 'ar';
  const isDark = theme === 'dark';
  const sectionTitleCls = 'text-xs font-bold uppercase tracking-wide text-gray-500';
  const tableHeadCls = cn(
    'p-2 whitespace-nowrap',
    isDark ? 'border-b border-gray-800 bg-gray-900/50 text-gray-500' : 'border-b border-gray-200 bg-gray-50 text-gray-600',
  );
  const tableCellCls = cn('p-2 text-sm', isDark ? 'text-gray-200' : 'text-gray-700');
  const label = statusLabel(settlement.status, posted, language);

  return (
    <>
      <div className="flex flex-wrap justify-between items-start gap-3 mb-4">
        <div className="min-w-0">
          <h3 className="font-bold">{settlement.settlementNumber}</h3>
          <p className="text-xs text-gray-500 mt-1">
            {settlement.date} · {projectLabel}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {isAr ? 'العهدة:' : 'Custody:'} {settlement.custodyAccountName || settlement.custodyAccountCode}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <span
            className={cn(
              'text-[10px] font-bold px-2 py-1 rounded uppercase',
              posted || settlement.status === 'approved'
                ? 'bg-green-900/20 text-green-500'
                : settlement.status === 'submitted'
                  ? 'bg-amber-900/20 text-amber-500'
                  : 'bg-gray-800 text-gray-400',
            )}
          >
            {label}
          </span>
          {canEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="text-gray-500 hover:text-blue-500 transition-colors"
              title={isAr ? 'تعديل' : 'Edit'}
            >
              <Edit2 size={16} />
            </button>
          )}
          <button
            type="button"
            onClick={onExport}
            className="text-green-500 hover:text-green-400 transition-colors"
            title={isAr ? 'تصدير' : 'Export'}
          >
            <FileDown size={16} />
          </button>
          <button
            type="button"
            onClick={onPrint}
            className="text-blue-500 hover:text-blue-400 transition-colors"
            title={isAr ? 'طباعة' : 'Print'}
          >
            <Printer size={16} />
          </button>
        </div>
      </div>

      <div
        className={cn(
          'grid grid-cols-2 md:grid-cols-3 gap-4 py-4 border-t',
          isDark ? 'border-gray-800/50' : 'border-gray-100',
        )}
      >
        <div>
          <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">{isAr ? 'عدد البنود' : 'Lines'}</p>
          <p className="text-sm font-bold">{settlement.items.length}</p>
        </div>
        <div>
          <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">{isAr ? 'إجمالي التسوية' : 'Total'}</p>
          <p className="text-lg font-bold text-green-500">{formatMoney(Number(settlement.totalAmount))}</p>
        </div>
        <div>
          <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">{isAr ? 'القيد' : 'Journal'}</p>
          <p className="text-sm font-bold">
            {posted ? (
              <span className="text-green-500">{isAr ? 'مرحّل' : 'Posted'}</span>
            ) : (
              <span className="text-gray-500">—</span>
            )}
          </p>
        </div>
      </div>

      {settlement.description?.trim() && (
        <div className={cn('mt-2 text-sm', isDark ? 'text-gray-400' : 'text-gray-600')}>
          {settlement.description}
        </div>
      )}

      <div className={cn('mt-4 pt-4 border-t space-y-3', isDark ? 'border-gray-800/50' : 'border-gray-100')}>
        <h4 className={sectionTitleCls}>{isAr ? 'بنود المصروفات' : 'Expense Items'}</h4>
        {settlement.items.length === 0 ? (
          <p className="text-xs text-gray-500">{isAr ? 'لا توجد بنود.' : 'No line items.'}</p>
        ) : (
          <div className={cn('overflow-x-auto border rounded-xl', isDark ? 'border-gray-800' : 'border-gray-200')}>
            <table className={cn('w-full min-w-[520px]', isDark ? 'bg-transparent' : 'bg-white')}>
              <thead>
                <tr>
                  <th className={tableHeadCls}>{isAr ? 'مركز التكلفة' : 'Cost center'}</th>
                  <th className={tableHeadCls}>{isAr ? 'حساب المصروف' : 'Expense account'}</th>
                  <th className={tableHeadCls}>{isAr ? 'الوصف' : 'Description'}</th>
                  <th className={cn(tableHeadCls, 'text-center')}>{isAr ? 'المبلغ' : 'Amount'}</th>
                </tr>
              </thead>
              <tbody className={cn('divide-y', isDark ? 'divide-gray-800' : 'divide-gray-100')}>
                {settlement.items.map((item, idx) => (
                  <tr key={item.id || `line-${idx}`}>
                    <td className={tableCellCls}>
                      {item.contractId ? contractLabel(item.contractId) : '—'}
                    </td>
                    <td className={tableCellCls}>
                      <div>{item.accountName || item.accountCode}</div>
                      <div className="text-[10px] font-mono text-gray-500">{item.accountCode}</div>
                    </td>
                    <td className={tableCellCls}>{item.description || '—'}</td>
                    <td className={cn(tableCellCls, 'text-center font-mono font-bold')}>
                      {formatMoney(Number(item.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={cn('font-bold border-t', isDark ? 'border-gray-800 bg-gray-900/30' : 'border-gray-200 bg-gray-50')}>
                  <td colSpan={3} className={cn(tableCellCls, 'text-start')}>
                    {isAr ? 'الإجمالي' : 'Total'}
                  </td>
                  <td className={cn(tableCellCls, 'text-center font-mono text-green-500')}>
                    {formatMoney(Number(settlement.totalAmount))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <div
        className={cn(
          'mt-4 pt-4 border-t flex items-center gap-2 text-[10px] text-gray-500',
          isDark ? 'border-gray-800/50' : 'border-gray-100',
        )}
      >
        {posted ? (
          <span className="inline-flex items-center gap-1 text-green-500 font-bold">
            <CheckCircle2 size={12} />
            {isAr ? 'مرحّل في دفتر اليومية' : 'Posted to GL'}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1">
            <Clock size={12} className="text-yellow-500" />
            {isAr ? 'لم يُرحّل بعد' : 'Not posted yet'}
          </span>
        )}
      </div>
    </>
  );
}
