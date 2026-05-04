import React, { useState, useMemo, useEffect } from 'react';
import { Plus, Trash2, FileDown, FileUp, Loader2, X, Save } from 'lucide-react';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { accountingService, Account, invalidateCoaCache } from '../../services/accountingService';
import { AccountModal } from './AccountModal';
import { SearchableSelect } from '../ui/SearchableSelect';
import { cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

interface Transaction {
  id: string;
  date: string;
  description: string;
  reference: string;
  costCenterId?: string;
  entries: { accountCode: string; accountName: string; debit: number; credit: number }[];
  createdBy: string;
}

interface ContractOption {
  id: string;
  contractName: string;
  contractNumber: string;
}

interface Props {
  accounts: Account[];
  transactions: Transaction[];
  contracts: ContractOption[];
  theme: string;
  language: string;
  dir: string;
}

const DRAFT_KEY = 'custody_settlement_draft';

export function GLCustodySettlement({ accounts, transactions, contracts, theme, language, dir }: Props) {
  const [selectedCustodyAccount, setSelectedCustodyAccount] = useState('');
  const [isCustodyAccountModalOpen, setIsCustodyAccountModalOpen] = useState(false);
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [newExpenseData, setNewExpenseData] = useState({ accountName: '', accountNameEn: '', parentCode: '' });
  const [settlement, setSettlement] = useState({
    date: new Date().toISOString().split('T')[0],
    description: language === 'ar' ? 'تسوية عهدة' : 'Custody Settlement',
    items: [{ id: crypto.randomUUID(), contractId: '', accountCode: '', accountName: '', amount: 0, description: '' }]
  });

  useEffect(() => {
    setHasDraft(!!localStorage.getItem(DRAFT_KEY));
  }, []);

  const custodyBalance = useMemo(() => {
    if (!selectedCustodyAccount) return 0;
    return transactions.reduce((sum, tx) => {
      const entries = tx.entries.filter(e => e.accountCode === selectedCustodyAccount);
      return sum + entries.reduce((s, e) => s + (e.debit - e.credit), 0);
    }, 0);
  }, [transactions, selectedCustodyAccount]);

  const totalSettlement = settlement.items.reduce((s, i) => s + Number(i.amount), 0);

  const expenseParentGroups = useMemo(() =>
    accounts.filter(a => a.isGroup && a.accountCode.startsWith('5') && a.accountCode.length === 5),
    [accounts]
  );

  const computedExpenseCode = useMemo(() => {
    if (!newExpenseData.parentCode) return '';
    const siblings = accounts.filter(a => a.parentCode === newExpenseData.parentCode);
    const codes = siblings.map(a => parseInt(a.accountCode, 10)).filter(n => !isNaN(n));
    const parentNum = parseInt(newExpenseData.parentCode, 10);
    const defaultBase = parentNum * 1000 + 1;
    const maxCode = codes.length > 0 ? Math.max(...codes) : defaultBase - 1;
    return String(maxCode + 1);
  }, [newExpenseData.parentCode, accounts]);

  const handleItemChange = (idx: number, field: string, value: string | number) => {
    const next = [...settlement.items];
    next[idx] = { ...next[idx], [field]: value };
    if (field === 'accountCode') {
      const acc = accounts.find(a => a.accountCode === value);
      if (acc) next[idx] = { ...next[idx], accountName: acc.accountName };
    }
    setSettlement({ ...settlement, items: next });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustodyAccount || totalSettlement <= 0) return;
    setIsSubmitting(true);
    try {
      const custodyAcc = accounts.find(a => a.accountCode === selectedCustodyAccount);
      const ref = `SET-${Date.now().toString().slice(-6)}`;

      const groups = new Map<string, typeof settlement.items>();
      for (const item of settlement.items) {
        const key = item.contractId || '';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(item);
      }

      for (const [contractId, items] of groups) {
        const groupTotal = items.reduce((s, i) => s + Number(i.amount), 0);
        if (groupTotal <= 0) continue;
        await accountingService.createTransaction({
          date: settlement.date,
          description: settlement.description,
          reference: ref,
          ...(contractId ? { costCenterId: contractId } : {}),
          entries: [
            { accountCode: selectedCustodyAccount, accountName: custodyAcc?.accountName || '', debit: 0, credit: groupTotal },
            ...items.map(item => ({ accountCode: item.accountCode, accountName: item.accountName, debit: Number(item.amount), credit: 0 }))
          ]
        });
      }

      localStorage.removeItem(DRAFT_KEY);
      setHasDraft(false);
      setSettlement({ date: new Date().toISOString().split('T')[0], description: language === 'ar' ? 'تسوية عهدة' : 'Custody Settlement', items: [{ id: crypto.randomUUID(), contractId: '', accountCode: '', accountName: '', amount: 0, description: '' }] });
      alert(language === 'ar' ? 'تم حفظ التسوية بنجاح' : 'Settlement saved successfully');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'transactions');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveDraft = () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ settlement, selectedCustodyAccount }));
    setHasDraft(true);
    alert(language === 'ar' ? 'تم حفظ المسودة' : 'Draft saved');
  };

  const handleRestoreDraft = () => {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    setSettlement(parsed.settlement);
    if (parsed.selectedCustodyAccount) setSelectedCustodyAccount(parsed.selectedCustodyAccount);
    localStorage.removeItem(DRAFT_KEY);
    setHasDraft(false);
  };

  const handleDiscardDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
    setHasDraft(false);
  };

  const handleSaveExpenseAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newExpenseData.parentCode) {
      alert(language === 'ar' ? 'يجب اختيار حساب أب' : 'Parent account is required.');
      return;
    }
    if (!newExpenseData.accountNameEn.trim()) {
      alert(language === 'ar' ? 'الاسم الإنجليزي مطلوب' : 'English name is required.');
      return;
    }
    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'chart_of_accounts'), {
        accountCode: computedExpenseCode,
        accountName: newExpenseData.accountName || newExpenseData.accountNameEn,
        accountNameEn: newExpenseData.accountNameEn,
        parentCode: newExpenseData.parentCode,
        type: 'expense',
        isGroup: false,
        status: 'active',
        createdAt: serverTimestamp(),
      });
      invalidateCoaCache();
      setIsExpenseModalOpen(false);
      setNewExpenseData({ accountName: '', accountNameEn: '', parentCode: '' });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'chart_of_accounts');
    } finally { setIsSubmitting(false); }
  };

  const handleExportExcel = async () => {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.json_to_sheet(settlement.items.map(item => ({ 'Account Code': item.accountCode, 'Account Name': item.accountName, 'Amount': item.amount, 'Description': item.description })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'CustodySettlement');
    XLSX.writeFile(wb, `Custody_Settlement_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleImportExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(evt.target?.result as string, { type: 'binary' });
      const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      const imported = (data as Record<string, unknown>[]).map(row => ({
        id: crypto.randomUUID(),
        contractId: '',
        accountCode: String(row['Account Code'] || row['كود الحساب'] || ''),
        accountName: String(row['Account Name'] || row['اسم الحساب'] || ''),
        amount: Number(row['Amount'] || row['المبلغ'] || 0),
        description: String(row['Description'] || row['البيان'] || '')
      })).filter(i => i.accountCode && i.amount > 0);
      if (imported.length > 0) setSettlement(prev => ({ ...prev, items: imported }));
    };
    reader.readAsBinaryString(file);
  };

  const inputCls = cn('w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500 transition-colors',
    theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200 text-gray-900'
  );

  const custodyAccounts = accounts.filter(a =>
    !a.isGroup && a.status !== 'disabled' && a.accountCode.startsWith('12203')
  );

  const expenseAccounts = accounts.filter(a =>
    !a.isGroup && a.status !== 'disabled' && a.accountCode.startsWith('5') && a.accountCode.length === 8
  );

  return (
    <>
      <div className="space-y-4">

        {/* Draft restore banner */}
        <AnimatePresence>
          {hasDraft && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="flex items-center justify-between gap-4 px-5 py-3 rounded-xl border border-yellow-500/40 bg-yellow-500/10 text-yellow-400 text-sm"
            >
              <span className="font-medium">{language === 'ar' ? 'يوجد مسودة محفوظة — هل تريد استعادتها؟' : 'Saved draft found — restore it?'}</span>
              <div className="flex gap-2">
                <button type="button" onClick={handleRestoreDraft} className="px-3 py-1 rounded-lg bg-yellow-500 text-black font-bold text-xs hover:bg-yellow-400 transition-colors">{language === 'ar' ? 'استعادة' : 'Restore'}</button>
                <button type="button" onClick={handleDiscardDraft} className="px-3 py-1 rounded-lg bg-gray-700 text-gray-300 font-bold text-xs hover:bg-gray-600 transition-colors">{language === 'ar' ? 'تجاهل' : 'Discard'}</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className={cn('p-6 border rounded-xl shadow-sm transition-colors', theme === 'dark' ? 'bg-[#151619] border-gray-800' : theme === 'soft' ? 'bg-white border-[#cfd8dc]' : 'bg-white border-gray-200')}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-xs font-bold text-gray-500 uppercase">{language === 'ar' ? 'اختر العهدة' : 'Select Custody Account'}</label>
                <button type="button" onClick={() => setIsCustodyAccountModalOpen(true)} className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"><Plus size={12} />{language === 'ar' ? 'حساب جديد' : 'New Account'}</button>
              </div>
              <SearchableSelect
                value={selectedCustodyAccount}
                onChange={setSelectedCustodyAccount}
                theme={theme}
                dir={dir}
                placeholder={language === 'ar' ? '--- اختر عهدة ---' : '--- Select a Custody ---'}
                options={custodyAccounts.map(acc => ({
                  value: acc.accountCode,
                  secondary: acc.accountCode,
                  label: language === 'ar' ? acc.accountName : (acc.accountNameEn || acc.accountName),
                }))}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-2">{language === 'ar' ? 'رصيد العهدة الحالي' : 'Current Custody Balance'}</label>
              <div className={cn('px-4 py-2 rounded-lg border font-mono font-bold text-lg', theme === 'dark' ? 'bg-gray-900 border-gray-800 text-blue-400' : 'bg-gray-50 border-gray-200 text-blue-600')}>
                {custodyBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div className="flex items-end gap-2">
              <button type="button" onClick={handleExportExcel} className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-2 text-white"><FileDown size={16} />{language === 'ar' ? 'تصدير إكسل' : 'Export Excel'}</button>
              <label className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-2 text-white cursor-pointer"><FileUp size={16} />{language === 'ar' ? 'استيراد إكسل' : 'Import Excel'}<input type="file" className="hidden" accept=".xlsx, .xls" onChange={handleImportExcel} /></label>
            </div>
          </div>
        </div>

        <div className={cn('p-6 border rounded-xl shadow-sm transition-colors', theme === 'dark' ? 'bg-[#151619] border-gray-800' : theme === 'soft' ? 'bg-white border-[#cfd8dc]' : 'bg-white border-gray-200')}>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] text-gray-500 font-bold uppercase">{language === 'ar' ? 'تاريخ التسوية' : 'Settlement Date'}</label>
                <input type="date" className={inputCls} value={settlement.date} onChange={(e) => setSettlement({ ...settlement, date: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-gray-500 font-bold uppercase">{language === 'ar' ? 'وصف التسوية' : 'Settlement Description'}</label>
                <input type="text" className={inputCls} value={settlement.description} onChange={(e) => setSettlement({ ...settlement, description: e.target.value })} />
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h4 className="font-bold text-sm">{language === 'ar' ? 'بنود المصروفات' : 'Expense Items'}</h4>
                <button type="button" onClick={() => setSettlement({ ...settlement, items: [...settlement.items, { id: crypto.randomUUID(), contractId: '', accountCode: '', accountName: '', amount: 0, description: '' }] })} className="text-xs text-blue-400 hover:text-blue-300 font-bold flex items-center gap-1"><Plus size={14} />{language === 'ar' ? 'إضافة بند' : 'Add Item'}</button>
              </div>
              <div className="space-y-3">
                {settlement.items.map((item, idx) => (
                  <div key={item.id} className={cn('grid grid-cols-1 md:grid-cols-12 gap-3 items-end p-3 rounded-lg border', theme === 'dark' ? 'bg-gray-900/40 border-gray-800' : 'bg-gray-50 border-gray-200')}>
                    <div className="md:col-span-3 space-y-1">
                      <label className="text-[10px] text-gray-500 uppercase">{language === 'ar' ? 'مركز التكلفة' : 'Cost Center'}</label>
                      <SearchableSelect
                        value={item.contractId}
                        onChange={(v) => handleItemChange(idx, 'contractId', v)}
                        theme={theme}
                        dir={dir}
                        placeholder={language === 'ar' ? '--- بدون مركز ---' : '--- No Center ---'}
                        options={contracts.map(c => ({ value: c.id, secondary: c.contractNumber, label: c.contractName }))}
                      />
                    </div>
                    <div className="md:col-span-3 space-y-1">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] text-gray-500 uppercase">{language === 'ar' ? 'مصروف' : 'Expense Account'}</label>
                        <button type="button" onClick={() => setIsExpenseModalOpen(true)} className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1"><Plus size={10} />{language === 'ar' ? 'جديد' : 'New'}</button>
                      </div>
                      <SearchableSelect
                        value={item.accountCode}
                        onChange={(v) => {
                          const acc = accounts.find(a => a.accountCode === v);
                          handleItemChange(idx, 'accountCode', v);
                          if (acc) handleItemChange(idx, 'accountName', language === 'ar' ? acc.accountName : (acc.accountNameEn || acc.accountName));
                        }}
                        theme={theme}
                        dir={dir}
                        placeholder={language === 'ar' ? 'اختر حساب المصروف' : 'Select Expense'}
                        options={expenseAccounts.map(acc => ({
                          value: acc.accountCode,
                          secondary: acc.accountCode,
                          label: language === 'ar' ? acc.accountName : (acc.accountNameEn || acc.accountName),
                        }))}
                      />
                    </div>
                    <div className="md:col-span-2 space-y-1">
                      <label className="text-[10px] text-gray-500 uppercase">{language === 'ar' ? 'المبلغ' : 'Amount'}</label>
                      <input type="number" className={cn(inputCls, 'text-blue-400')} value={item.amount || ''} onChange={(e) => handleItemChange(idx, 'amount', e.target.value)} />
                    </div>
                    <div className="md:col-span-3 space-y-1">
                      <label className="text-[10px] text-gray-500 uppercase">{language === 'ar' ? 'ملاحظات' : 'Notes'}</label>
                      <input type="text" className={inputCls} value={item.description} onChange={(e) => handleItemChange(idx, 'description', e.target.value)} />
                    </div>
                    <div className="md:col-span-1 flex justify-center pb-2">
                      <button type="button" title={language === 'ar' ? 'حذف البند' : 'Remove item'} onClick={() => setSettlement({ ...settlement, items: settlement.items.filter((_, i) => i !== idx) })} className="text-gray-500 hover:text-red-500 transition-colors"><Trash2 size={18} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className={cn('pt-6 border-t flex justify-between items-center', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
              <div className="text-xl font-bold">
                <span className="text-gray-500 text-sm mr-2">{language === 'ar' ? 'إجمالي التسوية:' : 'Total Settlement:'}</span>
                <span className="text-blue-500 font-mono">{totalSettlement.toLocaleString()}</span>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={handleSaveDraft} className={cn('px-6 py-3 rounded-xl font-bold transition-all flex items-center gap-2', theme === 'dark' ? 'bg-gray-800 hover:bg-gray-700 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700')}>
                  <Save size={16} />
                  {language === 'ar' ? 'حفظ كمسودة' : 'Save Draft'}
                </button>
                <button type="submit" disabled={isSubmitting || !selectedCustodyAccount} className="bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:text-gray-400 px-12 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 text-white">
                  {isSubmitting && <Loader2 className="animate-spin" size={18} />}
                  {isSubmitting ? (language === 'ar' ? 'جاري الحفظ...' : 'Saving...') : (language === 'ar' ? 'حفظ التسوية' : 'Save Settlement')}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* Custody account modal (AccountModal) */}
      <AccountModal
        isOpen={isCustodyAccountModalOpen}
        onClose={() => setIsCustodyAccountModalOpen(false)}
        accounts={accounts}
        theme={theme}
        language={language}
        defaultParentCode="12203"
        defaultType="asset"
      />

      {/* New expense account modal */}
      <AnimatePresence>
        {isExpenseModalOpen && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[60] p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={cn('w-full max-w-md border rounded-2xl shadow-2xl overflow-hidden', theme === 'dark' ? 'bg-[#1a1b1e] border-gray-800' : 'bg-white border-gray-200')}
            >
              <div className={cn('p-5 border-b flex justify-between items-center', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
                <h3 className="text-base font-bold">{language === 'ar' ? 'إضافة حساب مصروف جديد' : 'New Expense Account'}</h3>
                <button type="button" title={language === 'ar' ? 'إغلاق' : 'Close'} onClick={() => setIsExpenseModalOpen(false)} className="text-gray-500 hover:text-gray-300 transition-colors"><X size={20} /></button>
              </div>
              <form onSubmit={handleSaveExpenseAccount} className="p-5 space-y-4">
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase font-bold">{language === 'ar' ? 'حساب الأب' : 'Parent Account'}</label>
                  <select
                    required
                    title={language === 'ar' ? 'حساب الأب' : 'Parent Account'}
                    value={newExpenseData.parentCode}
                    onChange={e => setNewExpenseData(p => ({ ...p, parentCode: e.target.value }))}
                    className={cn('w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500', theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200 text-gray-900')}
                  >
                    <option value="">{language === 'ar' ? '--- اختر الحساب الأب ---' : '--- Select Parent ---'}</option>
                    {expenseParentGroups.map(a => (
                      <option key={a.accountCode} value={a.accountCode}>
                        {a.accountCode} — {language === 'ar' ? a.accountName : (a.accountNameEn || a.accountName)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase font-bold">{language === 'ar' ? 'كود الحساب (تلقائي)' : 'Account Code (Auto)'}</label>
                  <input
                    readOnly
                    value={computedExpenseCode}
                    className={cn('w-full border rounded-lg py-2 px-3 text-sm font-mono cursor-not-allowed opacity-60', theme === 'dark' ? 'bg-gray-900 border-gray-800 text-blue-400' : 'bg-gray-50 border-gray-200 text-blue-700')}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase font-bold">{language === 'ar' ? 'اسم الحساب (عربي)' : 'Account Name (Arabic)'}</label>
                  <input
                    type="text"
                    value={newExpenseData.accountName}
                    onChange={e => setNewExpenseData(p => ({ ...p, accountName: e.target.value }))}
                    className={cn('w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500', theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200 text-gray-900')}
                    placeholder={language === 'ar' ? 'اسم الحساب بالعربية' : 'Arabic name'}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase font-bold">
                    {language === 'ar' ? 'اسم الحساب (إنجليزي) *' : 'Account Name (English) *'}
                  </label>
                  <input
                    required
                    type="text"
                    value={newExpenseData.accountNameEn}
                    onChange={e => setNewExpenseData(p => ({ ...p, accountNameEn: e.target.value }))}
                    className={cn('w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500', theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200 text-gray-900')}
                    placeholder="Account name in English"
                    dir="ltr"
                  />
                </div>
                <div className="pt-2 flex gap-3">
                  <button type="submit" disabled={isSubmitting || !computedExpenseCode} className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 py-2 rounded-lg font-bold transition-colors text-white text-sm">
                    {isSubmitting ? '...' : (language === 'ar' ? 'حفظ' : 'Save')}
                  </button>
                  <button type="button" onClick={() => setIsExpenseModalOpen(false)} className={cn('flex-1 py-2 rounded-lg font-bold text-sm', theme === 'dark' ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-200 hover:bg-gray-300')}>
                    {language === 'ar' ? 'إلغاء' : 'Cancel'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
