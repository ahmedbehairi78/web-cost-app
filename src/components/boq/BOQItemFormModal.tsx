import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X, Loader2, Calculator } from 'lucide-react';
import { cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

interface BOQItem {
  id: string;
  itemCode: string;
  description: string;
}

interface FormData {
  chapterCode: string;
  chapterName: string;
  workTypeCode: string;
  sectionCode: string;
  sectionName: string;
  itemCode: string;
  description: string;
  unit: string;
  tenderQty: number;
  rateMaterials: number;
  rateLabour: number;
  rateEquipment: number;
  rateOverheadPct: number;
  rateProfitPct: number;
  startDate: string;
  expectedDuration: number;
}

interface Props {
  isOpen: boolean;
  editingItem: BOQItem | null;
  formData: FormData;
  setFormData: (d: FormData) => void;
  isSubmitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
  theme: string;
  language: string;
}

const schema = z.object({
  chapterCode: z.string(),
  chapterName: z.string(),
  workTypeCode: z.string(),
  sectionCode: z.string(),
  sectionName: z.string(),
  itemCode: z.string().min(1),
  description: z.string().min(1),
  unit: z.string().min(1),
  tenderQty: z.number().positive(),
  rateMaterials: z.number().min(0),
  rateLabour: z.number().min(0),
  rateEquipment: z.number().min(0),
  rateOverheadPct: z.number().min(0).max(100),
  rateProfitPct: z.number().min(0).max(100),
  startDate: z.string(),
  expectedDuration: z.number().min(0),
});

type FormValues = z.infer<typeof schema>;

export function BOQItemFormModal({ isOpen, editingItem, formData, setFormData, isSubmitting, onSubmit, onClose, theme, language }: Props) {
  const inputCls = cn(
    'w-full border rounded-lg py-2 px-4 text-sm outline-none focus:border-blue-500 transition-colors',
    theme === 'dark' ? 'bg-gray-900 border-gray-800' : theme === 'soft' ? 'bg-white border-[#cfd8dc]' : 'bg-white border-gray-200 shadow-sm'
  );
  const inputErrCls = cn(inputCls, 'border-red-500 focus:border-red-500');
  const monoInputCls = cn(inputCls, 'font-mono');
  const monoInputErrCls = cn(inputErrCls, 'font-mono');

  const { formState: { errors }, trigger, setValue, reset } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: formData,
  });

  useEffect(() => {
    if (isOpen) reset(formData);
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key: keyof FormData, value: string | number) => {
    setFormData({ ...formData, [key]: value });
    setValue(key as keyof FormValues, value as any);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const valid = await trigger();
    if (!valid) return;
    onSubmit(e);
  };

  const direct = formData.rateMaterials + formData.rateLabour + formData.rateEquipment;
  const overheadAmt = direct * (formData.rateOverheadPct / 100);
  const subtotal = direct + overheadAmt;
  const profitAmt = subtotal * (formData.rateProfitPct / 100);
  const unitRate = subtotal + profitAmt;
  const tenderAmount = unitRate * formData.tenderQty;

  const field = (label: string, key: keyof FormData, type: string = 'text', required = false) => {
    const hasError = !!errors[key as keyof FormValues];
    const isNum = type === 'number';
    const cls = isNum
      ? (hasError ? monoInputErrCls : monoInputCls)
      : (hasError ? inputErrCls : inputCls);
    return (
      <div className="space-y-1">
        <label className="text-[10px] font-bold text-gray-400 uppercase">{label}{required && <span className="text-red-500 ml-1">*</span>}</label>
        <input
          type={type}
          className={cls}
          value={formData[key] as any}
          onChange={(e) => set(key, isNum ? Number(e.target.value) : e.target.value)}
        />
        {hasError && (
          <p className="text-[10px] text-red-500">
            {language === 'ar' ? 'هذا الحقل مطلوب' : 'This field is required'}
          </p>
        )}
      </div>
    );
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className={cn('border rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl', theme === 'dark' ? 'bg-[#151619] border-gray-800' : theme === 'soft' ? 'bg-white border-[#cfd8dc]' : 'bg-white border-gray-200')}
          >
            <div className={cn('p-6 border-b flex justify-between items-center', theme === 'dark' ? 'bg-gray-900/50 border-gray-800' : theme === 'soft' ? 'bg-[#eceff1] border-[#cfd8dc]' : 'bg-gray-50 border-gray-200')}>
              <h3 className="text-xl font-bold">{editingItem ? (language === 'ar' ? 'تعديل البند التعاقدي' : 'Edit Contract Item') : (language === 'ar' ? 'إضافة بند جديد' : 'Add New Item')}</h3>
              <button onClick={onClose} className={cn('transition-colors', theme === 'dark' ? 'text-gray-500 hover:text-white' : 'text-gray-400 hover:text-gray-900')}><X size={20} /></button>
            </div>

            <form onSubmit={handleFormSubmit} className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {field(language === 'ar' ? 'كود الفصل' : 'Chapter Code', 'chapterCode')}
                {field(language === 'ar' ? 'اسم الفصل' : 'Chapter Name', 'chapterName')}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {field(language === 'ar' ? 'كود نوع العمل' : 'Work Type Code', 'workTypeCode')}
                {field(language === 'ar' ? 'كود القسم' : 'Section Code', 'sectionCode')}
                {field(language === 'ar' ? 'اسم القسم' : 'Section Name', 'sectionName')}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {field(language === 'ar' ? 'كود البند' : 'Item Code', 'itemCode', 'text', true)}
                    {field(language === 'ar' ? 'الوحدة' : 'Unit', 'unit', 'text', true)}
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-400 uppercase">
                      {language === 'ar' ? 'وصف البند' : 'Item Description'}<span className="text-red-500 ml-1">*</span>
                    </label>
                    <textarea
                      rows={3}
                      className={cn(errors.description ? inputErrCls : inputCls, 'resize-none')}
                      value={formData.description}
                      onChange={(e) => set('description', e.target.value)}
                    />
                    {errors.description && (
                      <p className="text-[10px] text-red-500">{language === 'ar' ? 'هذا الحقل مطلوب' : 'This field is required'}</p>
                    )}
                  </div>
                </div>

                <div className={cn('p-4 rounded-xl border space-y-4 h-fit', theme === 'dark' ? 'bg-gray-900/30 border-gray-800/50' : theme === 'soft' ? 'bg-[#eceff1] border-[#cfd8dc]' : 'bg-gray-50 border-gray-100 shadow-sm')}>
                  <div className="flex justify-between items-center border-b border-gray-800 pb-2 mb-2">
                    <span className="text-xs font-bold text-gray-500 uppercase">{language === 'ar' ? 'ملخص الحساب' : 'Calculation Summary'}</span>
                    <Calculator size={16} className="text-purple-400" />
                  </div>
                  <div className="space-y-3">
                    <div className="flex justify-between text-xs"><span className="text-gray-400">{language === 'ar' ? 'إجمالي التكلفة المباشرة' : 'Direct Cost'}</span><span className="font-mono">{direct.toLocaleString()}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-gray-400">{language === 'ar' ? 'مبلغ المصاريف' : 'Overhead Amt'} ({formData.rateOverheadPct}%)</span><span className="font-mono">{overheadAmt.toLocaleString()}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-gray-400">{language === 'ar' ? 'مبلغ الربح' : 'Profit Amt'} ({formData.rateProfitPct}%)</span><span className="font-mono text-purple-400">{profitAmt.toLocaleString()}</span></div>
                    <div className="pt-2 border-t border-gray-800 flex justify-between items-center"><span className="text-xs font-bold text-blue-400">{language === 'ar' ? 'سعر الوحدة النهائي' : 'Unit Rate'}</span><span className="font-mono font-black text-blue-400">{unitRate.toLocaleString()}</span></div>
                    <div className="flex justify-between items-center"><span className="text-xs font-bold text-green-400">{language === 'ar' ? 'إجمالي قيمة البند' : 'Item Total'}</span><span className="font-mono font-black text-green-400">{tenderAmount.toLocaleString()}</span></div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {field(language === 'ar' ? 'المواد (Direct)' : 'Materials (Direct)', 'rateMaterials', 'number')}
                {field(language === 'ar' ? 'العمالة (Direct)' : 'Labour (Direct)', 'rateLabour', 'number')}
                {field(language === 'ar' ? 'المعدات (Direct)' : 'Equipment (Direct)', 'rateEquipment', 'number')}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {field(language === 'ar' ? 'الكمية' : 'Quantity', 'tenderQty', 'number', true)}
                {field(language === 'ar' ? 'المصاريف %' : 'Overhead %', 'rateOverheadPct', 'number')}
                {field(language === 'ar' ? 'الربح %' : 'Profit %', 'rateProfitPct', 'number')}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {field(language === 'ar' ? 'تاريخ بدء العمل' : 'Start Date', 'startDate', 'date')}
                {field(language === 'ar' ? 'مدة التنفيذ المتوقعة (يوم)' : 'Expected Duration (Days)', 'expectedDuration', 'number')}
              </div>

              <div className="pt-4 flex gap-3">
                <button disabled={isSubmitting} type="submit" className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 text-white">
                  {isSubmitting && <Loader2 className="animate-spin" size={18} />}
                  {editingItem ? (language === 'ar' ? 'تحديث البند' : 'Update Item') : (language === 'ar' ? 'حفظ البند' : 'Save Item')}
                </button>
                <button type="button" onClick={onClose} className={cn('flex-1 py-3 rounded-xl font-bold transition-all', theme === 'dark' ? 'bg-gray-800 hover:bg-gray-700 text-white' : theme === 'soft' ? 'bg-[#cfd8dc] hover:bg-[#b0bec5] text-[#37474f]' : 'bg-gray-200 hover:bg-gray-300 text-gray-700')}>
                  {language === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
