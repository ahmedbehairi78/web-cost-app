import React, { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  accounts: { id: string; accountCode: string; accountName: string; isGroup: boolean }[];
  theme: string;
  language: string;
}

export function AccountModal({ isOpen, onClose, accounts, theme, language }: Props) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState({
    accountCode: '',
    accountName: '',
    parentCode: '',
    type: 'asset' as const,
    isGroup: false,
    status: 'active' as const,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'chart_of_accounts'), { ...form, createdAt: serverTimestamp() });
      setForm({ accountCode: '', accountName: '', parentCode: '', type: 'asset', isGroup: false, status: 'active' });
      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'chart_of_accounts');
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputCls = cn(
    'w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500',
    theme === 'dark' ? 'bg-gray-900 border-gray-800' : theme === 'soft' ? 'bg-white border-[#cfd8dc]' : 'bg-white border-gray-300 text-gray-900'
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className={cn('border rounded-2xl w-full max-w-md overflow-hidden shadow-2xl', theme === 'dark' ? 'bg-[#1a1b1e] border-gray-800' : theme === 'soft' ? 'bg-white border-[#cfd8dc]' : 'bg-white border-gray-200')}
          >
            <div className={cn('p-6 border-b flex justify-between items-center', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
              <h3 className="text-lg font-bold">{language === 'ar' ? 'إضافة حساب جديد' : 'Add New Account'}</h3>
              <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'كود الحساب' : 'Account Code'}</label>
                <input required type="text" className={inputCls} placeholder="e.g. 1101" value={form.accountCode} onChange={(e) => setForm({ ...form, accountCode: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'اسم الحساب' : 'Account Name'}</label>
                <input required type="text" className={inputCls} value={form.accountName} onChange={(e) => setForm({ ...form, accountName: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'الحساب الأب' : 'Parent Account'}</label>
                <select className={cn(inputCls, 'appearance-none')} value={form.parentCode} onChange={(e) => setForm({ ...form, parentCode: e.target.value })}>
                  <option value="">{language === 'ar' ? 'بدون (حساب رئيسي)' : 'None (Main Account)'}</option>
                  {accounts.filter(a => a.isGroup).map(a => (
                    <option key={a.id} value={a.accountCode}>{a.accountCode} - {a.accountName}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'النوع' : 'Type'}</label>
                  <select required className={cn(inputCls, 'appearance-none')} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as any })}>
                    <option value="asset">{language === 'ar' ? 'أصول' : 'Asset'}</option>
                    <option value="liability">{language === 'ar' ? 'خصوم' : 'Liability'}</option>
                    <option value="equity">{language === 'ar' ? 'حقوق ملكية' : 'Equity'}</option>
                    <option value="revenue">{language === 'ar' ? 'إيرادات' : 'Revenue'}</option>
                    <option value="expense">{language === 'ar' ? 'مصروفات' : 'Expense'}</option>
                  </select>
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <input type="checkbox" id="isGroupAccount" className="rounded border-gray-800 bg-gray-900 text-blue-600 focus:ring-blue-500" checked={form.isGroup} onChange={(e) => setForm({ ...form, isGroup: e.target.checked })} />
                  <label htmlFor="isGroupAccount" className="text-sm font-medium">{language === 'ar' ? 'حساب رئيسي' : 'Group Account'}</label>
                </div>
              </div>
              <div className="pt-4 flex gap-3">
                <button type="submit" disabled={isSubmitting} className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 py-2 rounded-lg font-bold transition-colors text-white flex items-center justify-center gap-2">
                  {isSubmitting && <Loader2 className="animate-spin" size={16} />}
                  {language === 'ar' ? 'حفظ الحساب' : 'Save Account'}
                </button>
                <button type="button" onClick={onClose} className={cn('flex-1 py-2 rounded-lg font-bold transition-colors', theme === 'dark' ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-100 hover:bg-gray-200 text-gray-900')}>
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
