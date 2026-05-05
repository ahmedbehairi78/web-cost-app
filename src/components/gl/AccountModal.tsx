import React, { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { accountingService, Account, invalidateCoaCache } from '../../services/accountingService';
import { SearchableSelect } from '../ui/SearchableSelect';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  accounts: { id: string; accountCode: string; accountName: string; accountNameEn?: string; isGroup: boolean }[];
  theme: string;
  language: string;
  editingAccount?: Account | null;
  defaultParentCode?: string;
  defaultType?: Account['type'];
}

const EMPTY_FORM = {
  accountCode: '',
  accountName: '',
  accountNameEn: '',
  parentCode: '',
  type: 'asset' as 'asset' | 'liability' | 'equity' | 'revenue' | 'expense',
  isGroup: false,
  status: 'active' as 'active' | 'disabled',
};

function deriveStatementType(code: string) {
  const prefix = code.charAt(0);
  if (['1', '2', '3'].includes(prefix)) return 'balance_sheet';
  if (['4', '5'].includes(prefix)) return 'income_statement';
  return undefined;
}

export function AccountModal({ isOpen, onClose, accounts, theme, language, editingAccount, defaultParentCode, defaultType }: Props) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  useEffect(() => {
    if (editingAccount) {
      setForm({
        accountCode:   editingAccount.accountCode,
        accountName:   editingAccount.accountName,
        accountNameEn: editingAccount.accountNameEn || '',
        parentCode:    editingAccount.parentCode,
        type:          editingAccount.type,
        isGroup:       editingAccount.isGroup,
        status:        editingAccount.status || 'active',
      });
    } else {
      let nextCode = '';
      if (defaultParentCode) {
        const children = accounts.filter(a => a.accountCode.startsWith(defaultParentCode) && a.accountCode !== defaultParentCode && !a.accountCode.slice(defaultParentCode.length).includes('.'));
        const codes = children.map(a => parseInt(a.accountCode, 10)).filter(n => !isNaN(n));
        if (codes.length > 0) {
          nextCode = String(Math.max(...codes) + 1);
        } else {
          nextCode = defaultParentCode + '001';
        }
      }
      setForm({
        ...EMPTY_FORM,
        accountCode: nextCode,
        parentCode: defaultParentCode || '',
        type: defaultType || 'asset',
      });
    }
  }, [editingAccount, isOpen, defaultParentCode, defaultType]);

  const isEditMode = Boolean(editingAccount);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (isEditMode && editingAccount) {
        await accountingService.updateAccount(editingAccount.id, {
          ...form,
          statementType: deriveStatementType(form.accountCode),
        });
      } else {
        await addDoc(collection(db, 'chart_of_accounts'), {
          ...form,
          statementType: deriveStatementType(form.accountCode),
          createdAt: serverTimestamp(),
        });
        invalidateCoaCache();
      }
      setForm(EMPTY_FORM);
      onClose();
    } catch (error) {
      handleFirestoreError(error, isEditMode ? OperationType.UPDATE : OperationType.CREATE, 'chart_of_accounts');
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
              <h3 className="text-lg font-bold">
                {isEditMode
                  ? (language === 'ar' ? 'تعديل الحساب' : 'Edit Account')
                  : (language === 'ar' ? 'إضافة حساب جديد' : 'Add New Account')}
              </h3>
              <button type="button" onClick={onClose} className="text-gray-500 hover:text-white"><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'كود الحساب' : 'Account Code'}</label>
                <input
                  required
                  type="text"
                  className={inputCls}
                  placeholder="e.g. 1101"
                  value={form.accountCode}
                  onChange={(e) => setForm({ ...form, accountCode: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase">
                    {language === 'ar' ? 'الاسم العربي' : 'Arabic Name'}
                    <span className="text-red-500 mr-1">*</span>
                  </label>
                  <input
                    required
                    type="text"
                    dir="rtl"
                    className={inputCls}
                    placeholder="مثال: البنك"
                    value={form.accountName}
                    onChange={(e) => setForm({ ...form, accountName: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase">
                    {language === 'ar' ? 'الاسم الإنجليزي' : 'English Name'}
                    <span className="text-red-500 mr-1">*</span>
                  </label>
                  <input
                    required
                    type="text"
                    dir="ltr"
                    className={inputCls}
                    placeholder="e.g. Bank"
                    value={form.accountNameEn}
                    onChange={(e) => setForm({ ...form, accountNameEn: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'الحساب الأب' : 'Parent Account'}</label>
                <SearchableSelect
                  value={form.parentCode}
                  onChange={(v) => setForm({ ...form, parentCode: v })}
                  theme={theme}
                  dir={language === 'ar' ? 'rtl' : 'ltr'}
                  placeholder={language === 'ar' ? 'بدون (حساب رئيسي)' : 'None (Main Account)'}
                  options={accounts.filter(a => a.isGroup).map(a => ({
                    value: a.accountCode,
                    secondary: a.accountCode,
                    label: language === 'ar' ? a.accountName : (a.accountNameEn || a.accountName),
                  }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'النوع' : 'Type'}</label>
                  <select
                    required
                    className={cn(inputCls, 'appearance-none')}
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value as typeof form.type })}
                  >
                    <option value="asset">{language === 'ar' ? 'أصول' : 'Asset'}</option>
                    <option value="liability">{language === 'ar' ? 'خصوم' : 'Liability'}</option>
                    <option value="equity">{language === 'ar' ? 'حقوق ملكية' : 'Equity'}</option>
                    <option value="revenue">{language === 'ar' ? 'إيرادات' : 'Revenue'}</option>
                    <option value="expense">{language === 'ar' ? 'مصروفات' : 'Expense'}</option>
                  </select>
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <input
                    type="checkbox"
                    id="isGroupAccount"
                    className="rounded border-gray-800 bg-gray-900 text-blue-600 focus:ring-blue-500"
                    checked={form.isGroup}
                    onChange={(e) => setForm({ ...form, isGroup: e.target.checked })}
                  />
                  <label htmlFor="isGroupAccount" className="text-sm font-medium">
                    {language === 'ar' ? 'حساب رئيسي' : 'Group Account'}
                  </label>
                </div>
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 py-2 rounded-lg font-bold transition-colors text-white flex items-center justify-center gap-2"
                >
                  {isSubmitting && <Loader2 className="animate-spin" size={16} />}
                  {isEditMode
                    ? (language === 'ar' ? 'حفظ التعديلات' : 'Save Changes')
                    : (language === 'ar' ? 'حفظ الحساب' : 'Save Account')}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className={cn('flex-1 py-2 rounded-lg font-bold transition-colors', theme === 'dark' ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-100 hover:bg-gray-200 text-gray-900')}
                >
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
