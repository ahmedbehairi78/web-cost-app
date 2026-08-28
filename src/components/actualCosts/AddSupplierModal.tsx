import React, { memo, useState } from 'react';
import { X } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../../lib/utils';

export type NewSupplierFields = {
  name: string;
  nameEn: string;
  taxNumber: string;
  phone: string;
  address: string;
  /** Subcontractor classification — omitted for material suppliers. */
  serviceKind?: 'works' | 'labour' | 'equipment' | 'vehicles' | 'housing';
};

type Props = {
  open: boolean;
  theme: string;
  language: string;
  cancelLabel: string;
  isSubmitting: boolean;
  supplierType: 'supplier' | 'subcontractor';
  /** When true, show works vs service kinds (21102 still). */
  askServiceKind?: boolean;
  computedAccountCode: string;
  onClose: () => void;
  onSubmit: (data: NewSupplierFields) => void | Promise<void>;
};

const EMPTY: NewSupplierFields = {
  name: '',
  nameEn: '',
  taxNumber: '',
  phone: '',
  address: '',
  serviceKind: 'works',
};

function AddSupplierModalInner({
  open,
  theme,
  language,
  cancelLabel,
  isSubmitting,
  supplierType,
  askServiceKind,
  computedAccountCode,
  onClose,
  onSubmit,
}: Props) {
  const [data, setData] = useState<NewSupplierFields>(EMPTY);
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
          <h3 className="text-lg font-bold">{isAr ? 'إضافة مورد / مقاول' : 'Add Supplier / Subcontractor'}</h3>
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
          <div className="space-y-1">
            <label className="text-xs text-gray-400 uppercase">{isAr ? 'النوع' : 'Type'}</label>
            <div className="flex gap-3">
              <button
                type="button"
                disabled
                className="flex-1 py-2 rounded-lg text-sm font-bold border transition-all bg-blue-600 border-blue-600 text-white cursor-not-allowed"
              >
                {supplierType === 'supplier'
                  ? isAr
                    ? 'مورد (21101)'
                    : 'Supplier (21101)'
                  : isAr
                    ? 'مقاول (21102)'
                    : 'Subcontractor (21102)'}
              </button>
            </div>
          </div>
          {supplierType === 'subcontractor' && askServiceKind && (
            <div className="space-y-1">
              <label className="text-xs text-gray-400 uppercase">{isAr ? 'تصنيف المقاول' : 'Contractor class'}</label>
              <select
                className={inputCls}
                value={data.serviceKind || 'works'}
                onChange={(e) => setData((p) => ({ ...p, serviceKind: e.target.value as NewSupplierFields['serviceKind'] }))}
              >
                <option value="works">{isAr ? 'تنفيذ بنود (قوائم كميات)' : 'Works (BOQ items)'}</option>
                <option value="labour">{isAr ? 'توريد عمال' : 'Labour supply'}</option>
                <option value="equipment">{isAr ? 'تأجير معدات' : 'Equipment rental'}</option>
                <option value="vehicles">{isAr ? 'سيارات' : 'Vehicles'}</option>
                <option value="housing">{isAr ? 'سكن' : 'Housing'}</option>
              </select>
            </div>
          )}
          <div className="space-y-1">
            <label className="text-xs text-gray-400 uppercase">{isAr ? 'كود الحساب (تلقائي)' : 'Account Code (Auto)'}</label>
            <input
              readOnly
              aria-label={isAr ? 'كود الحساب التلقائي' : 'Auto generated account code'}
              value={computedAccountCode}
              className={cn(
                'w-full border rounded-lg py-2 px-3 text-sm font-mono cursor-not-allowed opacity-60',
                theme === 'dark'
                  ? 'bg-gray-900 border-gray-800 text-blue-400'
                  : 'bg-gray-50 border-gray-200 text-blue-700',
              )}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-gray-400 uppercase">{isAr ? 'الاسم (عربي)' : 'Name (Arabic)'}</label>
            <input
              type="text"
              placeholder="الاسم بالعربية"
              className={inputCls}
              value={data.name}
              onChange={(e) => setData((p) => ({ ...p, name: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-gray-400 uppercase">{isAr ? 'الاسم (إنجليزي) *' : 'Name (English) *'}</label>
            <input
              required
              type="text"
              dir="ltr"
              placeholder="Name in English"
              className={inputCls}
              value={data.nameEn}
              onChange={(e) => setData((p) => ({ ...p, nameEn: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-gray-400 uppercase">{isAr ? 'رقم التسجيل الضريبي' : 'Tax Registration'}</label>
            <input
              type="text"
              aria-label={isAr ? 'رقم التسجيل الضريبي' : 'Tax registration'}
              className={inputCls}
              value={data.taxNumber}
              onChange={(e) => setData((p) => ({ ...p, taxNumber: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-gray-400 uppercase">{isAr ? 'رقم الهاتف' : 'Phone'}</label>
            <input
              type="text"
              aria-label={isAr ? 'رقم الهاتف' : 'Phone number'}
              className={inputCls}
              value={data.phone}
              onChange={(e) => setData((p) => ({ ...p, phone: e.target.value }))}
            />
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

export const AddSupplierModal = memo(AddSupplierModalInner);
