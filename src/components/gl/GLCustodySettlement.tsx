import React, { useState, useMemo } from 'react';
import { Plus, Trash2, FileDown, FileUp, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { handleFirestoreError, OperationType } from '../../firebase';
import { accountingService, Account } from '../../services/accountingService';
import { AccountModal } from './AccountModal';

interface Transaction {
  id: string;
  date: string;
  description: string;
  reference: string;
  costCenterId?: string;
  entries: { accountCode: string; accountName: string; debit: number; credit: number }[];
  createdBy: string;
}

interface Props {
  accounts: Account[];
  transactions: Transaction[];
  theme: string;
  language: string;
  dir: string;
}

export function GLCustodySettlement({ accounts, transactions, theme, language, dir }: Props) {
  const [selectedCustodyAccount, setSelectedCustodyAccount] = useState('');
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [settlement, setSettlement] = useState({
    date: new Date().toISOString().split('T')[0],
    description: language === 'ar' ? 'تسوية عهدة' : 'Custody Settlement',
    items: [{ id: crypto.randomUUID(), accountCode: '', accountName: '', amount: 0, description: '' }]
  });

  const custodyBalance = useMemo(() => {
    if (!selectedCustodyAccount) return 0;
    return transactions.reduce((sum, tx) => {
      const entries = tx.entries.filter(e => e.accountCode === selectedCustodyAccount);
      return sum + entries.reduce((s, e) => s + (e.debit - e.credit), 0);
    }, 0);
  }, [transactions, selectedCustodyAccount]);

  const totalSettlement = settlement.items.reduce((s, i) => s + Number(i.amount), 0);

  const handleItemChange = (idx: number, field: keyof typeof settlement.items[0], value: string | number) => {
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
      await accountingService.createTransaction({
        date: settlement.date,
        description: settlement.description,
        reference: `SET-${Date.now().toString().slice(-6)}`,
        entries: [
          { accountCode: selectedCustodyAccount, accountName: custodyAcc?.accountName || '', debit: 0, credit: totalSettlement },
          ...settlement.items.map(item => ({ accountCode: item.accountCode, accountName: item.accountName, debit: Number(item.amount), credit: 0 }))
        ]
      });
      setSettlement({ date: new Date().toISOString().split('T')[0], description: language === 'ar' ? 'تسوية عهدة' : 'Custody Settlement', items: [{ id: crypto.randomUUID(), accountCode: '', accountName: '', amount: 0, description: '' }] });
      alert(language === 'ar' ? 'تم حفظ التسوية بنجاح' : 'Settlement saved successfully');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'transactions');
    } finally {
      setIsSubmitting(false);
    }
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
        accountCode: String(row['Account Code'] || row['كود الحساب'] || ''),
        accountName: String(row['Account Name'] || row['اسم الحساب'] || ''),
        amount: Number(row['Amount'] || row['المبلغ'] || 0),
        description: String(row['Description'] || row['البيان'] || '')
      })).filter(i => i.accountCode && i.amount > 0);
      if (imported.length > 0) setSettlement(prev => ({ ...prev, items: imported }));
    };
    reader.readAsBinaryString(file);
  };

  const inputCls = cn('w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500');

  const custodyAccounts = accounts.filter(a =>
    !a.isGroup && a.status !== 'disabled' &&
    (a.accountName.includes('عهدة') || a.accountName.includes('Custody') || a.accountCode.startsWith('1'))
  );

  return (
    <>
      <div className="space-y-6">
        <div className={cn('p-6 border rounded-xl shadow-sm transition-colors', theme === 'dark' ? 'bg-[#151619] border-gray-800' : theme === 'soft' ? 'bg-white border-[#cfd8dc]' : 'bg-white border-gray-200')}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-xs font-bold text-gray-500 uppercase">{language === 'ar' ? 'اختر العهدة' : 'Select Custody Account'}</label>
                <button type="button" onClick={() => setIsAccountModalOpen(true)} className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"><Plus size={12} />{language === 'ar' ? 'حساب جديد' : 'New Account'}</button>
              </div>
              <select
                value={selectedCustodyAccount}
                onChange={(e) => setSelectedCustodyAccount(e.target.value)}
                className={cn('w-full px-4 py-2 rounded-lg border focus:ring-2 focus:ring-blue-500 outline-none transition-all', theme === 'dark' ? 'bg-gray-900 border-gray-800 text-white' : 'bg-gray-50 border-gray-200')}
              >
                <option value="">{language === 'ar' ? '--- اختر عهدة ---' : '--- Select a Custody ---'}</option>
                {custodyAccounts.map(acc => <option key={acc.id} value={acc.accountCode}>{acc.accountCode} - {acc.accountName}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-2">{language === 'ar' ? 'رصيد العهدة الحالي' : 'Current Custody Balance'}</label>
              <div className={cn('px-4 py-2 rounded-lg border font-mono font-bold text-lg', theme === 'dark' ? 'bg-gray-900 border-gray-800 text-blue-400' : 'bg-gray-50 border-gray-200 text-blue-600')}>
                {custodyBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div className="flex items-end gap-2">
              <button onClick={handleExportExcel} className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-2 text-white"><FileDown size={16} />{language === 'ar' ? 'تصدير إكسل' : 'Export Excel'}</button>
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
                <button type="button" onClick={() => setSettlement({ ...settlement, items: [...settlement.items, { id: crypto.randomUUID(), accountCode: '', accountName: '', amount: 0, description: '' }] })} className="text-xs text-blue-400 hover:text-blue-300 font-bold flex items-center gap-1"><Plus size={14} />{language === 'ar' ? 'إضافة بند' : 'Add Item'}</button>
              </div>
              <div className="space-y-3">
                {settlement.items.map((item, idx) => (
                  <div key={item.id} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end bg-gray-900/40 p-3 rounded-lg border border-gray-800">
                    <div className="md:col-span-4 space-y-1">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] text-gray-500 uppercase">{language === 'ar' ? 'مصروف' : 'Expense Account'}</label>
                        <button type="button" onClick={() => setIsAccountModalOpen(true)} className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1"><Plus size={10} />{language === 'ar' ? 'جديد' : 'New'}</button>
                      </div>
                      <select className={inputCls} value={item.accountCode} onChange={(e) => handleItemChange(idx, 'accountCode', e.target.value)}>
                        <option value="">{language === 'ar' ? 'اختر حساب المصروف' : 'Select Expense'}</option>
                        {accounts.filter(a => !a.isGroup && a.status !== 'disabled' && a.type === 'expense').map(acc => <option key={acc.id} value={acc.accountCode}>{acc.accountCode} - {acc.accountName}</option>)}
                      </select>
                    </div>
                    <div className="md:col-span-2 space-y-1">
                      <label className="text-[10px] text-gray-500 uppercase">{language === 'ar' ? 'المبلغ' : 'Amount'}</label>
                      <input type="number" className={cn(inputCls, 'text-blue-400')} value={item.amount} onChange={(e) => handleItemChange(idx, 'amount', e.target.value)} />
                    </div>
                    <div className="md:col-span-5 space-y-1">
                      <label className="text-[10px] text-gray-500 uppercase">{language === 'ar' ? 'ملاحظات' : 'Notes'}</label>
                      <input type="text" className={inputCls} value={item.description} onChange={(e) => handleItemChange(idx, 'description', e.target.value)} />
                    </div>
                    <div className="md:col-span-1 flex justify-center pb-2">
                      <button type="button" onClick={() => setSettlement({ ...settlement, items: settlement.items.filter((_, i) => i !== idx) })} className="text-gray-500 hover:text-red-500 transition-colors"><Trash2 size={18} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-6 border-t border-gray-800 flex justify-between items-center">
              <div className="text-xl font-bold">
                <span className="text-gray-500 text-sm mr-2">{language === 'ar' ? 'إجمالي التسوية:' : 'Total Settlement:'}</span>
                <span className="text-blue-500 font-mono">{totalSettlement.toLocaleString()}</span>
              </div>
              <button type="submit" disabled={isSubmitting || !selectedCustodyAccount} className="bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:text-gray-400 px-12 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 text-white">
                {isSubmitting && <Loader2 className="animate-spin" size={18} />}
                {isSubmitting ? (language === 'ar' ? 'جاري الحفظ...' : 'Saving...') : (language === 'ar' ? 'حفظ التسوية' : 'Save Settlement')}
              </button>
            </div>
          </form>
        </div>
      </div>

      <AccountModal isOpen={isAccountModalOpen} onClose={() => setIsAccountModalOpen(false)} accounts={accounts} theme={theme} language={language} />
    </>
  );
}
