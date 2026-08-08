import React, { Fragment, useMemo } from 'react';
import {
  CheckCircle2,
  Clock,
  Edit2,
  FileText,
  Printer,
  Receipt,
  Trash2,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { formatQuantity } from '../../lib/formatQuantity';
import {
  deductionPctLabel,
  groupIpcItemsByChapter,
  mapToIpcPrintItems,
  totalIpcDeductions,
} from '../../lib/ipcPrintData';
import { ManualHelpButton } from '../help/ManualHelpButton';

export interface PurchaseTransactionDetailRow {
  id: string;
  type: 'invoice' | 'ipc';
  supplierName: string;
  /** `credit` · `cash` — invoice only; missing treated as credit */
  paymentType?: string | null;
  projectId: string;
  contractId: string;
  date: string;
  referenceNumber: string;
  amount: number;
  vatAmount: number;
  whtAmount?: number;
  execGuaranteeAmount?: number;
  labourInsuranceAmount?: number;
  manpowerLevyAmount?: number;
  advancePaymentRecovery?: number;
  totalAmount: number;
  description: string;
  status: 'pending' | 'approved' | 'paid' | 'draft' | 'submitted';
  transactionId?: string;
  items?: Array<{
    boqItemId: string;
    itemCode: string;
    description: string;
    unit: string;
    rate: number;
    previousQty: number;
    currentQty: number;
    totalQty: number;
    amount: number;
    chapterName?: string;
    sectionName?: string;
    tenderQty?: number;
  }>;
  invoiceLines?: Array<{
    itemDescription?: string;
    description?: string;
    unit: string;
    quantity: number;
    unitCost?: number;
    rate?: number;
    materialCategoryId?: number;
  }>;
  inventoryAccountCode?: string;
  inventoryAccountName?: string;
  expenseAccountId?: string;
}

interface Props {
  tx: PurchaseTransactionDetailRow;
  tab: 'invoice' | 'ipc';
  theme: string;
  language: string;
  formatMoney: (value: number) => string;
  projectLabel?: string;
  contractLabel?: string;
  expenseAccountLabel?: string;
  canEdit: boolean;
  canDelete: boolean;
  canApprove?: boolean;
  ipcStatus: 'draft' | 'submitted' | 'approved' | 'pending' | 'paid';
  onEdit: () => void;
  onDelete: () => void;
  onApprove?: () => void;
  onPrint?: () => void;
}

type InvoiceDisplayLine = {
  itemDescription: string;
  unit: string;
  quantity: number;
  unitCost: number;
};

function normalizeInvoiceDisplayLine(raw: Record<string, unknown>): InvoiceDisplayLine {
  return {
    itemDescription: String(raw.itemDescription ?? raw.description ?? '').trim(),
    unit: String(raw.unit ?? 'EA'),
    quantity: Number(raw.quantity) || 0,
    unitCost: Number(raw.unitCost ?? raw.rate) || 0,
  };
}

function resolveInvoiceDisplayLines(
  tx: PurchaseTransactionDetailRow,
  language: string,
): InvoiceDisplayLine[] {
  const primary = Array.isArray(tx.invoiceLines) ? tx.invoiceLines : [];
  const fallback = Array.isArray(tx.items) ? tx.items : [];
  const source = primary.length > 0 ? primary : fallback;
  const mapped = source
    .map((line) => normalizeInvoiceDisplayLine(line as Record<string, unknown>))
    .filter((line) => line.itemDescription || line.quantity > 0 || line.unitCost > 0);

  if (mapped.length > 0) return mapped;

  const amount = Number(tx.amount) || 0;
  if (amount > 0) {
    return [
      {
        itemDescription:
          tx.description?.trim()
          || (language === 'ar' ? 'مبلغ الفاتورة (بدون بنود)' : 'Invoice amount (no line items)'),
        unit: '—',
        quantity: 1,
        unitCost: amount,
      },
    ];
  }
  return [];
}

function statusLabel(
  tab: 'invoice' | 'ipc',
  ipcStatus: Props['ipcStatus'],
  tx: PurchaseTransactionDetailRow,
  language: string,
): string {
  const isAr = language === 'ar';
  if (tab === 'ipc') {
    if (ipcStatus === 'approved') return isAr ? 'معتمد' : 'Approved';
    if (ipcStatus === 'submitted') return isAr ? 'بانتظار الاعتماد' : 'Awaiting approval';
    if (ipcStatus === 'draft') return isAr ? 'مسودة' : 'Draft';
    if (tx.status === 'paid') return isAr ? 'تم السداد' : 'Paid';
    return isAr ? 'معلق' : 'Pending';
  }
  if (tx.transactionId) return isAr ? 'مرحّلة' : 'Posted';
  if (tx.status === 'paid') return isAr ? 'تم السداد' : 'Paid';
  return isAr ? 'معلق' : 'Pending';
}

export function PurchaseTransactionDetail({
  tx,
  tab,
  theme,
  language,
  formatMoney,
  projectLabel,
  contractLabel,
  expenseAccountLabel,
  canEdit,
  canDelete,
  canApprove,
  ipcStatus,
  onEdit,
  onDelete,
  onApprove,
  onPrint,
}: Props) {
  const isAr = language === 'ar';
  const isDark = theme === 'dark';
  const sectionTitleCls = 'text-xs font-bold uppercase tracking-wide text-gray-500';
  const tableHeadCls = cn(
    'p-2 whitespace-nowrap',
    isDark ? 'border-b border-gray-800 bg-gray-900/50 text-gray-500' : 'border-b border-gray-200 bg-gray-50 text-gray-600',
  );
  const tableCellCls = cn('p-2', isDark ? 'text-gray-200' : 'text-gray-700');
  const label = statusLabel(tab, ipcStatus, tx, language);
  const posted = Boolean(tx.transactionId) || (tab === 'ipc' && ipcStatus === 'approved');

  const invoiceLines = useMemo(
    () => (tab === 'invoice' ? resolveInvoiceDisplayLines(tx, language) : []),
    [tab, tx, language],
  );
  const invoiceLinesSubtotal = useMemo(
    () => invoiceLines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0),
    [invoiceLines],
  );
  const printItems = mapToIpcPrintItems(tx.items ?? []);
  const chapters = groupIpcItemsByChapter(printItems, language as 'ar' | 'en');
  const works = Number(tx.amount) || 0;
  const totalDeductions =
    tab === 'ipc'
      ? totalIpcDeductions({
          variant: 'subcontractor',
          documentNumber: tx.referenceNumber,
          dateLabel: tx.date,
          items: printItems,
          worksValueExVat: works,
          vatAmount: tx.vatAmount,
          execGuaranteeAmount: tx.execGuaranteeAmount ?? 0,
          whtAmount: tx.whtAmount ?? 0,
          labourInsuranceAmount: tx.labourInsuranceAmount ?? 0,
          manpowerLevyAmount: tx.manpowerLevyAmount ?? 0,
          advancePaymentRecovery: tx.advancePaymentRecovery ?? 0,
          netPayable: tx.totalAmount,
        })
      : 0;

  return (
    <>
      <div className="flex flex-wrap justify-between items-start gap-3 mb-4">
        <div className="flex gap-3 min-w-0">
          <div
            className={cn(
              'w-10 h-10 rounded-lg flex items-center justify-center border shrink-0',
              isDark ? 'bg-gray-900 border-gray-800' : 'bg-gray-50 border-gray-200',
            )}
          >
            {tab === 'invoice' ? (
              <Receipt className="text-blue-500" size={20} />
            ) : (
              <FileText className="text-purple-500" size={20} />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold truncate">
                {tab === 'invoice'
                  ? isAr
                    ? `فاتورة: ${tx.referenceNumber || '—'}`
                    : `Invoice: ${tx.referenceNumber || '—'}`
                  : isAr
                    ? `مستخلص: ${tx.referenceNumber || '—'}`
                    : `IPC: ${tx.referenceNumber || '—'}`}
              </h3>
              <ManualHelpButton
                topicId={tab === 'invoice' ? 'costs.invoice.purchase' : 'costs.ipc.subcontractor'}
                size={14}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {tx.date}
              {projectLabel ? ` · ${projectLabel}` : ''}
              {contractLabel ? ` · ${contractLabel}` : ''}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">{tx.supplierName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {tab === 'invoice' && (
            <span
              className={cn(
                'text-[10px] font-bold px-2 py-1 rounded uppercase',
                tx.paymentType === 'cash'
                  ? 'bg-emerald-900/20 text-emerald-500'
                  : 'bg-sky-900/20 text-sky-500',
              )}
            >
              {tx.paymentType === 'cash'
                ? (isAr ? 'نقدية' : 'Cash')
                : (isAr ? 'آجلة' : 'Credit')}
            </span>
          )}
          <span
            className={cn(
              'text-[10px] font-bold px-2 py-1 rounded uppercase',
              posted || ipcStatus === 'approved' || tx.status === 'paid'
                ? 'bg-green-900/20 text-green-500'
                : ipcStatus === 'submitted'
                  ? 'bg-amber-900/20 text-amber-500'
                  : ipcStatus === 'draft'
                    ? 'bg-gray-800 text-gray-400'
                    : 'bg-yellow-900/20 text-yellow-500',
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
          {canDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="text-gray-500 hover:text-red-500 transition-colors"
              title={isAr ? 'حذف' : 'Delete'}
            >
              <Trash2 size={16} />
            </button>
          )}
          {canApprove && onApprove && (
            <button
              type="button"
              onClick={onApprove}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-600/90 text-white text-[10px] font-bold hover:bg-emerald-500 transition-colors"
            >
              <CheckCircle2 size={14} />
              {isAr ? 'اعتماد' : 'Approve'}
            </button>
          )}
          {onPrint && tab === 'ipc' && ipcStatus === 'approved' && (
            <button
              type="button"
              onClick={onPrint}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-600/90 text-white text-[10px] font-bold hover:bg-blue-500 transition-colors"
            >
              <Printer size={14} />
              {isAr ? 'طباعة' : 'Print'}
            </button>
          )}
        </div>
      </div>

      <div
        className={cn(
          'grid grid-cols-2 md:grid-cols-4 gap-4 py-4 border-t',
          isDark ? 'border-gray-800/50' : 'border-gray-100',
        )}
      >
        <div>
          <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">
            {isAr ? 'المبلغ (بدون ضريبة)' : 'Amount (ex-VAT)'}
          </p>
          <p className="text-sm font-bold">{formatMoney(works)}</p>
        </div>
        <div>
          <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">
            {isAr ? 'ضريبة القيمة المضافة' : 'VAT'}
          </p>
          <p className="text-sm font-bold text-blue-400">+{formatMoney(tx.vatAmount)}</p>
        </div>
        <div>
          <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">
            {isAr ? 'خصم وإضافة' : 'WHT'}
          </p>
          <p className="text-sm font-bold text-red-400">-{formatMoney(tx.whtAmount ?? 0)}</p>
        </div>
        <div>
          <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">
            {isAr ? 'الإجمالي' : 'Total'}
          </p>
          <p className="text-lg font-bold text-green-500">{formatMoney(tx.totalAmount)}</p>
        </div>
      </div>

      {tab === 'invoice' && tx.inventoryAccountCode && (
        <div className={cn('mt-4 pt-4 border-t text-sm', isDark ? 'border-gray-800/50' : 'border-gray-100')}>
          <span className="text-gray-500">{isAr ? 'مخزن المشروع:' : 'Project warehouse:'}</span>{' '}
          <span className="font-mono">{tx.inventoryAccountCode}</span>
          {tx.inventoryAccountName ? ` — ${tx.inventoryAccountName}` : ''}
        </div>
      )}

      {tab === 'invoice' && expenseAccountLabel && (
        <div className={cn('mt-2 text-sm', isDark ? 'text-gray-300' : 'text-gray-700')}>
          <span className="text-gray-500">{isAr ? 'حساب المصروف:' : 'Expense account:'}</span> {expenseAccountLabel}
        </div>
      )}

      {tab === 'invoice' && invoiceLines.length > 0 && (
        <div className={cn('mt-4 pt-4 border-t space-y-3', isDark ? 'border-gray-800/50' : 'border-gray-100')}>
          <h4 className={sectionTitleCls}>
            {isAr ? `بنود الفاتورة (${invoiceLines.length})` : `Invoice lines (${invoiceLines.length})`}
          </h4>
          <div className={cn('overflow-x-auto border rounded-xl', isDark ? 'border-gray-800' : 'border-gray-200')}>
            <table className={cn('w-full text-[10px] min-w-[520px]', isDark ? 'bg-transparent' : 'bg-white')}>
              <thead>
                <tr>
                  <th className={cn(tableHeadCls, 'text-start')}>#</th>
                  <th className={tableHeadCls}>{isAr ? 'الوصف' : 'Description'}</th>
                  <th className={cn(tableHeadCls, 'text-center')}>{isAr ? 'الوحدة' : 'Unit'}</th>
                  <th className={cn(tableHeadCls, 'text-center')}>{isAr ? 'الكمية' : 'Qty'}</th>
                  <th className={cn(tableHeadCls, 'text-center')}>{isAr ? 'سعر الوحدة' : 'Unit Cost'}</th>
                  <th className={cn(tableHeadCls, 'text-center')}>{isAr ? 'الإجمالي' : 'Total'}</th>
                </tr>
              </thead>
              <tbody className={cn('divide-y', isDark ? 'divide-gray-800' : 'divide-gray-100')}>
                {invoiceLines.map((line, idx) => {
                  const lineTotal = line.quantity * line.unitCost;
                  return (
                    <tr key={`inv-line-${idx}`}>
                      <td className={cn(tableCellCls, 'text-center text-gray-500 font-mono w-8')}>{idx + 1}</td>
                      <td className={tableCellCls}>{line.itemDescription || '—'}</td>
                      <td className={cn(tableCellCls, 'text-center')}>{line.unit || '—'}</td>
                      <td className={cn(tableCellCls, 'text-center font-mono')}>{formatQuantity(line.quantity, language)}</td>
                      <td className={cn(tableCellCls, 'text-center font-mono')}>{formatMoney(line.unitCost)}</td>
                      <td className={cn(tableCellCls, 'text-center font-mono font-bold text-blue-400')}>
                        {formatMoney(lineTotal)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className={cn('font-bold border-t', isDark ? 'border-gray-800 bg-gray-900/30' : 'border-gray-200 bg-gray-50')}>
                  <td colSpan={5} className={cn(tableCellCls, 'text-start')}>
                    {isAr ? 'إجمالي البنود (بدون ضريبة)' : 'Lines subtotal (ex-VAT)'}
                  </td>
                  <td className={cn(tableCellCls, 'text-center font-mono text-blue-400')}>
                    {formatMoney(invoiceLinesSubtotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {tab === 'ipc' && printItems.length > 0 && (
        <div className={cn('mt-4 pt-4 border-t space-y-3', isDark ? 'border-gray-800/50' : 'border-gray-100')}>
          <h4 className={sectionTitleCls}>{isAr ? 'بنود المستخلص' : 'IPC Items'}</h4>
          <div className={cn('overflow-x-auto border rounded-xl', isDark ? 'border-gray-800' : 'border-gray-200')}>
            <table className={cn('w-full text-[10px] min-w-[720px]', isDark ? 'bg-transparent' : 'bg-white')}>
              <thead>
                <tr>
                  <th className={tableHeadCls}>{isAr ? 'الفصل' : 'Chapter'}</th>
                  <th className={tableHeadCls}>{isAr ? 'القسم' : 'Section'}</th>
                  <th className={tableHeadCls}>{isAr ? 'البند' : 'Item'}</th>
                  <th className={cn(tableHeadCls, 'text-center')}>{isAr ? 'الوحدة' : 'Unit'}</th>
                  <th className={cn(tableHeadCls, 'text-center')}>{isAr ? 'السعر' : 'Rate'}</th>
                  <th className={cn(tableHeadCls, 'text-center')}>{isAr ? 'سابق' : 'Prev'}</th>
                  <th className={cn(tableHeadCls, 'text-center')}>{isAr ? 'حالي' : 'Curr'}</th>
                  <th className={cn(tableHeadCls, 'text-center')}>{isAr ? 'إجمالي' : 'Total'}</th>
                  <th className={cn(tableHeadCls, 'text-center')}>{isAr ? 'القيمة' : 'Amount'}</th>
                </tr>
              </thead>
              <tbody className={cn('divide-y', isDark ? 'divide-gray-800' : 'divide-gray-100')}>
                {chapters.map(({ chapterName, items }) => {
                  const chapterTotal = items.reduce((s, i) => s + i.amount, 0);
                  return (
                    <Fragment key={chapterName}>
                      {items.map((item, rowIdx) => (
                        <tr key={`${chapterName}-${item.itemCode}-${rowIdx}`}>
                          <td className={tableCellCls}>{chapterName}</td>
                          <td className={tableCellCls}>{item.sectionName || '—'}</td>
                          <td className={tableCellCls}>
                            <div className="max-w-[180px] truncate">{item.description}</div>
                            <div className="text-[8px] text-blue-400 font-mono">{item.itemCode}</div>
                          </td>
                          <td className={cn(tableCellCls, 'text-center')}>{item.unit}</td>
                          <td className={cn(tableCellCls, 'text-center font-mono text-green-500')}>
                            {formatMoney(item.rate)}
                          </td>
                          <td className={cn(tableCellCls, 'text-center font-mono text-gray-500')}>
                            {formatQuantity(item.previousQty, language)}
                          </td>
                          <td className={cn(tableCellCls, 'text-center font-mono')}>
                            {formatQuantity(item.currentQty, language)}
                          </td>
                          <td className={cn(tableCellCls, 'text-center font-mono')}>
                            {formatQuantity(item.totalQty, language)}
                          </td>
                          <td className={cn(tableCellCls, 'text-center font-mono font-bold text-blue-400')}>
                            {formatMoney(item.amount)}
                          </td>
                        </tr>
                      ))}
                      <tr className={cn('font-bold', isDark ? 'bg-purple-900/10 border-t border-gray-800' : 'bg-purple-50/80 border-t border-gray-200')}>
                        <td colSpan={8} className={cn(tableCellCls, 'text-start text-gray-400')}>
                          {isAr ? 'إجمالي الفصل:' : 'Chapter Total:'} {chapterName}
                        </td>
                        <td className={cn(tableCellCls, 'text-center font-mono text-blue-400')}>
                          {formatMoney(chapterTotal)}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'ipc' && (
        <div className={cn('mt-4 pt-4 border-t space-y-2', isDark ? 'border-gray-800/50' : 'border-gray-100')}>
          <h4 className={sectionTitleCls}>{isAr ? 'الاستقطاعات بالتفصيل' : 'Deductions Detail'}</h4>
          <div
            className={cn(
              'rounded-xl border p-4 space-y-2 text-sm',
              isDark ? 'border-gray-800 bg-gray-900/30' : 'border-gray-200 bg-gray-50',
            )}
          >
            {(tx.execGuaranteeAmount ?? 0) > 0 && (
              <div className="flex justify-between gap-4 text-xs">
                <span className="text-gray-500">
                  {isAr ? 'حجز ضمان أعمال' : 'Retention'} ({deductionPctLabel(tx.execGuaranteeAmount ?? 0, works)}):
                </span>
                <span>{formatMoney(tx.execGuaranteeAmount ?? 0)}</span>
              </div>
            )}
            {(tx.labourInsuranceAmount ?? 0) > 0 && (
              <div className="flex justify-between gap-4 text-xs">
                <span className="text-gray-500">
                  {isAr ? 'التأمينات' : 'Insurance'} ({deductionPctLabel(tx.labourInsuranceAmount ?? 0, works)}):
                </span>
                <span>{formatMoney(tx.labourInsuranceAmount ?? 0)}</span>
              </div>
            )}
            {(tx.manpowerLevyAmount ?? 0) > 0 && (
              <div className="flex justify-between gap-4 text-xs">
                <span className="text-gray-500">
                  {isAr ? 'القوى العاملة' : 'Manpower'} ({deductionPctLabel(tx.manpowerLevyAmount ?? 0, works, 3)}):
                </span>
                <span>{formatMoney(tx.manpowerLevyAmount ?? 0)}</span>
              </div>
            )}
            {(tx.advancePaymentRecovery ?? 0) > 0 && (
              <div className="flex justify-between gap-4 text-xs">
                <span className="text-gray-500">{isAr ? 'استرداد دفعة مقدمة:' : 'Advance recovery:'}</span>
                <span>{formatMoney(tx.advancePaymentRecovery ?? 0)}</span>
              </div>
            )}
            <div
              className={cn(
                'flex justify-between gap-4 pt-2 border-t font-bold',
                isDark ? 'border-gray-800' : 'border-gray-200',
              )}
            >
              <span className="text-red-400">{isAr ? 'إجمالي الاستقطاعات:' : 'Total deductions:'}</span>
              <span className="text-red-400">{formatMoney(totalDeductions)}</span>
            </div>
            <div
              className={cn(
                'flex justify-between gap-4 pt-2 border-t',
                isDark ? 'border-gray-800' : 'border-gray-200',
              )}
            >
              <span className="font-bold text-green-500">{isAr ? 'صافي المستحق:' : 'Net payable:'}</span>
              <span className="font-bold text-green-500 text-lg">{formatMoney(tx.totalAmount)}</span>
            </div>
          </div>
        </div>
      )}

      {tx.description?.trim() && (
        <div className={cn('mt-4 pt-4 border-t text-sm', isDark ? 'border-gray-800/50 text-gray-400' : 'border-gray-100 text-gray-600')}>
          <span className="font-bold uppercase text-[10px] text-gray-500 block mb-1">
            {isAr ? 'الوصف' : 'Description'}
          </span>
          {tx.description}
        </div>
      )}

      <div
        className={cn(
          'mt-4 pt-4 border-t flex flex-wrap items-center gap-3 text-[10px] text-gray-500',
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
