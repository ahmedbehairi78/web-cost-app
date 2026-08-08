import React, { memo, useState } from 'react';
import { X } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../../lib/utils';

export type NewExpenseAccountFields = {
  accountName: string;
  accountNameEn: string;
  accountCode: string;
  parentCode: string;
};

type Props = {
  open: boolean;
  theme: string;
  language: string;
  cancelLabel: string;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (data: NewExpenseAccountFields) => void | Promise<void>;
};

const EMPTY: NewExpenseAccountFields = {
  accountName: '',
  accountNameEn: '',
  accountCode: '',
  parentCode: '511',
};

function AddExpenseAccountModalInner({
  open,
  theme,
  language,
  cancelLabel,
  isSubmitting,
  onClose,
  onSubmit,
}: Props) {
  const [data, setData] = useState<NewExpenseAccountFields>(EMPTY);
  const isAr = language === 'ar';
  const inputCls = cn(
    'w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500',
    theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200',
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[60] p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className={cn(
          'w-full max-w-md border rounded-2xl shadow-2xl overflow-hidden',
          theme === 'dark' ? 'bg-[#1a1b1e] border-gray-800' : 'bg-white border-gray-200',
        )}
      >
        <div className="p-6 border-b flex justify-between items-center">
          <h3 className="text-lg font-bold">{isAr ? 'إضافة حساب مصروفات جديد' : 'Add Expense Account'}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={isAr ? 'إغلاق النافذة' : 'Close dialog'}
            title={isAr ? 'إغلاق النافذة' : 'Close dialog'}
            className="text-gray-500 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onSubmit(data);
          }}
          className="p-6 space-y-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-gray-400 uppercase">
                {isAr ? 'الاسم العربي' : 'Arabic Name'}
                <span className="text-red-500 ms-1">*</span>
              </label>
              <input
                required
                type="text"
                dir="rtl"
                placeholder="مثال: مواد خرسانة"
                className={inputCls}
                value={data.accountName}
                onChange={(e) => setData((p) => ({ ...p, accountName: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-400 uppercase">
                {isAr ? 'الاسم الإنجليزي' : 'English Name'}
                <span className="text-red-500 ms-1">*</span>
              </label>
              <input
                required
                type="text"
                dir="ltr"
                placeholder="e.g. Concrete Materials"
                className={inputCls}
                value={data.accountNameEn}
                onChange={(e) => setData((p) => ({ ...p, accountNameEn: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-gray-400 uppercase">{isAr ? 'كود الحساب' : 'Account Code'}</label>
            <input
              required
              type="text"
              placeholder="e.g. 51101002"
              className={inputCls}
              value={data.accountCode}
              onChange={(e) => setData((p) => ({ ...p, accountCode: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-gray-400 uppercase">{isAr ? 'الحساب الأب' : 'Parent Account'}</label>
            <select
              required
              aria-label={isAr ? 'الحساب الأب' : 'Parent account'}
              className={inputCls}
              value={data.parentCode}
              onChange={(e) => setData((p) => ({ ...p, parentCode: e.target.value }))}
            >
              <option value="511">{isAr ? '511 - تكاليف مباشرة' : '511 - Direct Costs'}</option>
              <option value="512">{isAr ? '512 - تكاليف غير مباشرة' : '512 - Indirect Costs'}</option>
              <option value="521">{isAr ? '521 - إدارية وعمومية' : '521 - G&A'}</option>
              <option value="531">{isAr ? '531 - تكاليف التمويل' : '531 - Financing'}</option>
            </select>
          </div>
          <div className="pt-4 flex gap-3">
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 py-2 rounded-lg font-bold transition-colors text-white"
            >
              {isSubmitting ? '...' : isAr ? 'حفظ' : 'Save'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className={cn(
                'flex-1 py-2 rounded-lg font-bold',
                theme === 'dark' ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300',
              )}
            >
              {cancelLabel}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

export const AddExpenseAccountModal = memo(AddExpenseAccountModalInner);
