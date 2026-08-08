import React, { useMemo } from 'react';
import { X, RefreshCw, AlertTriangle } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { MONEY_TOLERANCE } from '../../lib/money';

/** Lenient journal line accepted by the preview (accountName optional, debit/credit may default). */
export interface JournalPreviewEntry {
  accountCode: string | number;
  accountName?: string;
  debit?: number;
  credit?: number;
  costCenterId?: string | null;
}

export interface JournalPreviewModalProps {
  open: boolean;
  title?: string;
  reference?: string;
  description?: string;
  entries: JournalPreviewEntry[];
  /** Resolve a cost-center id to a display label (optional). */
  resolveCostCenter?: (id: string) => string | undefined;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Shared, read-only preview of a journal (debit/credit lines + balance check)
 * shown before posting. Used by Payroll accrual, client/subcontractor IPC, OHA.
 */
export function JournalPreviewModal({
  open,
  title,
  reference,
  description,
  entries,
  resolveCostCenter,
  confirmLabel,
  busy,
  onConfirm,
  onClose,
}: JournalPreviewModalProps) {
  const { language, formatMoney } = useLanguage();

  const { totalDebit, totalCredit, balanced } = useMemo(() => {
    const td = entries.reduce((s, e) => s + (Number(e.debit) || 0), 0);
    const tc = entries.reduce((s, e) => s + (Number(e.credit) || 0), 0);
    return { totalDebit: td, totalCredit: tc, balanced: Math.abs(td - tc) <= MONEY_TOLERANCE };
  }, [entries]);

  if (!open) return null;

  const th = 'px-2 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400';
  const td = 'px-2 py-1.5 text-xs text-gray-800 dark:text-gray-100';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold">{title ?? (language === 'ar' ? 'معاينة القيد' : 'Journal Preview')}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={18} /></button>
        </div>

        <div className="p-4 space-y-3">
          {(reference || description) && (
            <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
              {description && <div><span className="font-medium">{language === 'ar' ? 'البيان' : 'Description'}: </span>{description}</div>}
              {reference && <div className="font-mono"><span className="font-medium">{language === 'ar' ? 'المرجع' : 'Reference'}: </span>{reference}</div>}
            </div>
          )}

          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-800 text-start">
                <tr>
                  <th className={`${th} text-start`}>{language === 'ar' ? 'الحساب' : 'Account'}</th>
                  <th className={`${th} text-start`}>{language === 'ar' ? 'مركز التكلفة' : 'Cost Center'}</th>
                  <th className={`${th} text-end`}>{language === 'ar' ? 'مدين' : 'Debit'}</th>
                  <th className={`${th} text-end`}>{language === 'ar' ? 'دائن' : 'Credit'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {entries.map((e, i) => {
                  const cc = e.costCenterId ? (resolveCostCenter?.(e.costCenterId) ?? e.costCenterId) : '';
                  return (
                    <tr key={i}>
                      <td className={td}>
                        <span className="font-mono text-gray-400 me-1">{e.accountCode}</span>
                        {e.accountName}
                      </td>
                      <td className={`${td} text-gray-500`}>{cc}</td>
                      <td className={`${td} text-end tabular-nums`}>{Number(e.debit) > 0 ? formatMoney(e.debit) : ''}</td>
                      <td className={`${td} text-end tabular-nums`}>{Number(e.credit) > 0 ? formatMoney(e.credit) : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-gray-50 dark:bg-gray-800 font-semibold">
                <tr>
                  <td className={td} colSpan={2}>{language === 'ar' ? 'الإجمالي' : 'Total'}</td>
                  <td className={`${td} text-end tabular-nums`}>{formatMoney(totalDebit)}</td>
                  <td className={`${td} text-end tabular-nums`}>{formatMoney(totalCredit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {!balanced && (
            <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
              <AlertTriangle size={14} />
              {language === 'ar' ? 'القيد غير متوازن — لا يمكن الترحيل' : 'Journal is not balanced — cannot post'}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-700">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
            {language === 'ar' ? 'إلغاء' : 'Cancel'}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy || !balanced || entries.length === 0}
            className="px-4 py-2 text-sm rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-medium disabled:opacity-60 inline-flex items-center gap-1"
          >
            {busy ? <RefreshCw size={14} className="animate-spin" /> : null}
            {confirmLabel ?? (language === 'ar' ? 'تأكيد وترحيل' : 'Confirm & Post')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default JournalPreviewModal;
