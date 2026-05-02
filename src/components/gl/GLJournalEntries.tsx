import React, { useState } from 'react';
import {
  Plus, Calendar, Filter, Printer, Download, Trash2, X, Loader2, AlertCircle, ChevronLast
} from 'lucide-react';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { accountingService, Account } from '../../services/accountingService';
// @ts-ignore
import html2pdf from 'html2pdf.js';
import { SearchableSelect } from '../ui/SearchableSelect';

interface Transaction {
  id: string;
  date: string;
  description: string;
  reference: string;
  costCenterId?: string;
  entries: { accountCode: string; accountName: string; debit: number; credit: number }[];
  createdBy: string;
}

interface Contract { id: string; contractName: string; contractNumber: string; projectId: string }
interface Project { id: string; projectName: string; projectCode: string }

interface Props {
  transactions: Transaction[];
  transactionLimit: number;
  onLoadMore: () => void;
  accounts: Account[];
  contracts: Contract[];
  projects: Project[];
  contractsMap: Map<string, Contract>;
  projectsMap: Map<string, Project>;
  theme: string;
  language: string;
  dir: string;
  fiscalYear: number;
  onFiscalYearChange: (year: number) => void;
}

export function GLJournalEntries({
  transactions, transactionLimit, onLoadMore,
  accounts, contracts, projects, contractsMap, projectsMap,
  theme, language, dir, fiscalYear, onFiscalYearChange
}: Props) {
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: currentYear - 2020 + 2 }, (_, i) => 2020 + i);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [isEntryModalOpen, setIsEntryModalOpen] = useState(false);
  const [isContractModalOpen, setIsContractModalOpen] = useState(false);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<{ isOpen: boolean; title: string; message: string; onConfirm: () => void }>({
    isOpen: false, title: '', message: '', onConfirm: () => {}
  });

  const [entryForm, setEntryForm] = useState({
    date: new Date().toISOString().split('T')[0],
    description: '',
    costCenterId: '',
    entries: [
      { id: crypto.randomUUID(), accountCode: '', accountName: '', debit: 0, credit: 0 },
      { id: crypto.randomUUID(), accountCode: '', accountName: '', debit: 0, credit: 0 }
    ]
  });

  const [contractForm, setContractForm] = useState({ contractName: '', contractNumber: '', projectId: '' });
  const [projectForm, setProjectForm] = useState({ projectName: '', projectCode: '', clientName: '', budget: 0, startDate: new Date().toISOString().split('T')[0] });

  const inputCls = (extra = '') => cn(
    'w-full border rounded-lg py-2.5 px-4 text-sm outline-none focus:border-blue-500 transition-colors',
    theme === 'dark' ? 'bg-gray-900 border-gray-800' : theme === 'soft' ? 'bg-white border-[#cfd8dc]' : 'bg-white border-gray-300 text-gray-900',
    extra
  );

  const handleEntryChange = (idx: number, field: keyof typeof entryForm.entries[0], value: string | number) => {
    const next = [...entryForm.entries];
    next[idx] = { ...next[idx], [field]: value };
    if (field === 'accountCode') {
      const acc = accounts.find(a => a.accountCode === value);
      if (acc) next[idx] = { ...next[idx], accountName: language === 'ar' ? acc.accountName : (acc.accountNameEn || acc.accountName) };
    }
    setEntryForm({ ...entryForm, entries: next });
  };

  const handleSaveEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entryForm.costCenterId) {
      alert(language === 'ar' ? 'يجب اختيار مركز تكلفة (عقد) للقيد.' : 'Cost center (Contract) is required.');
      return;
    }
    const totalDebit = entryForm.entries.reduce((s, e) => s + Number(e.debit), 0);
    const totalCredit = entryForm.entries.reduce((s, e) => s + Number(e.credit), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      alert(language === 'ar' ? 'القيد غير متزن!' : 'Entry is not balanced!');
      return;
    }
    setIsSubmitting(true);
    try {
      const selectedContract = contracts.find(c => c.id === entryForm.costCenterId);
      await accountingService.createTransaction({
        date: entryForm.date,
        description: entryForm.description,
        costCenterId: entryForm.costCenterId,
        projectId: selectedContract?.projectId || '',
        entries: entryForm.entries.map(e => ({
          accountCode: e.accountCode,
          accountName: accounts.find(a => a.accountCode === e.accountCode)?.accountName || '',
          debit: Number(e.debit),
          credit: Number(e.credit)
        }))
      });
      setIsEntryModalOpen(false);
      setEntryForm({ date: new Date().toISOString().split('T')[0], description: '', costCenterId: '', entries: [{ id: crypto.randomUUID(), accountCode: '', accountName: '', debit: 0, credit: 0 }, { id: crypto.randomUUID(), accountCode: '', accountName: '', debit: 0, credit: 0 }] });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'transactions');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveContract = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const docRef = await addDoc(collection(db, 'contracts'), { ...contractForm, isDeleted: false, createdAt: serverTimestamp() });
      setEntryForm(prev => ({ ...prev, costCenterId: docRef.id }));
      setIsContractModalOpen(false);
      setContractForm({ contractName: '', contractNumber: '', projectId: '' });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'contracts');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const docRef = await addDoc(collection(db, 'projects'), { ...projectForm, status: 'active', isDeleted: false, createdAt: serverTimestamp() });
      setContractForm(prev => ({ ...prev, projectId: docRef.id }));
      setIsProjectModalOpen(false);
      setProjectForm({ projectName: '', projectCode: '', clientName: '', budget: 0, startDate: new Date().toISOString().split('T')[0] });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'projects');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteTransaction = (tx: Transaction) => {
    setConfirmConfig({
      isOpen: true,
      title: language === 'ar' ? 'تأكيد الحذف' : 'Confirm Delete',
      message: language === 'ar' ? 'هل أنت متأكد من حذف هذا القيد؟' : 'Are you sure you want to delete this entry?',
      onConfirm: async () => {
        setIsSubmitting(true);
        try {
          await accountingService.deleteTransaction(tx.id);
          setSelectedTransaction(null);
          setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, 'transactions');
        } finally {
          setIsSubmitting(false);
        }
      }
    });
  };

  const handleExportPDF = (tx: Transaction) => {
    const isAr = language === 'ar';
    const el = document.createElement('div');
    el.dir = isAr ? 'rtl' : 'ltr';
    el.style.padding = '40px';
    el.style.backgroundColor = '#ffffff';
    el.style.color = '#000000';
    const contract = contractsMap.get(tx.costCenterId!);
    const project = projectsMap.get(contract?.projectId || '');
    el.innerHTML = `
      <div style="text-align:center;margin-bottom:30px;border-bottom:2px solid #1e3a8a;padding-bottom:10px;">
        <h1 style="font-size:24px;color:#1e3a8a;">${isAr ? 'قيد محاسبي' : 'Journal Entry'}</h1>
        <p style="color:#666;">${tx.reference}</p>
      </div>
      <p><strong>${isAr ? 'التاريخ:' : 'Date:'}</strong> ${tx.date}</p>
      <p><strong>${isAr ? 'البيان:' : 'Description:'}</strong> ${tx.description}</p>
      <p><strong>${isAr ? 'مركز التكلفة:' : 'Cost Center:'}</strong> ${contract ? `${contract.contractName} (${project?.projectName || '...'})` : '-'}</p>
      <table style="width:100%;border-collapse:collapse;margin-top:20px;">
        <thead><tr style="background:#f8fafc;">
          <th style="padding:8px;border:1px solid #e2e8f0;">${isAr ? 'الحساب' : 'Account'}</th>
          <th style="padding:8px;border:1px solid #e2e8f0;">${isAr ? 'مدين' : 'Debit'}</th>
          <th style="padding:8px;border:1px solid #e2e8f0;">${isAr ? 'دائن' : 'Credit'}</th>
        </tr></thead>
        <tbody>${tx.entries.map(e => `<tr><td style="padding:8px;border:1px solid #e2e8f0;">${e.accountName} (${e.accountCode})</td><td style="padding:8px;border:1px solid #e2e8f0;color:#3b82f6;">${e.debit > 0 ? e.debit.toLocaleString() : '-'}</td><td style="padding:8px;border:1px solid #e2e8f0;color:#ef4444;">${e.credit > 0 ? e.credit.toLocaleString() : '-'}</td></tr>`).join('')}</tbody>
      </table>`;
    html2pdf().set({ margin: 0.5, filename: `Entry_${tx.reference}.pdf`, html2canvas: { scale: 2 }, jsPDF: { unit: 'in', format: 'letter' } }).from(el).save();
  };

  const totalDebit = entryForm.entries.reduce((s, e) => s + Number(e.debit), 0);
  const totalCredit = entryForm.entries.reduce((s, e) => s + Number(e.credit), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  const modalBg = cn('border rounded-2xl w-full overflow-hidden shadow-2xl transition-colors', theme === 'dark' ? 'bg-[#151619] border-gray-800' : theme === 'soft' ? 'bg-white border-[#cfd8dc]' : 'bg-white border-gray-200');
  const modalHeader = cn('p-6 border-b flex justify-between items-center transition-colors', theme === 'dark' ? 'bg-gray-900/50 border-gray-800' : theme === 'soft' ? 'bg-[#eceff1] border-[#cfd8dc]' : 'bg-gray-50 border-gray-200');

  return (
    <>
      <div className="flex justify-end mb-4">
        <button onClick={() => setIsEntryModalOpen(true)} className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 text-white">
          <Plus size={18} />
          {language === 'ar' ? 'قيد جديد' : 'New Entry'}
        </button>
      </div>

      <div className={cn('border rounded-xl overflow-hidden shadow-2xl transition-colors', theme === 'dark' ? 'bg-[#151619] border-gray-800' : theme === 'soft' ? 'bg-white border-[#cfd8dc]' : 'bg-white border-gray-200')}>
        <div className={cn('p-4 border-b flex items-center justify-between transition-colors', theme === 'dark' ? 'bg-gray-900/50 border-gray-800' : theme === 'soft' ? 'bg-[#eceff1] border-[#cfd8dc]' : 'bg-gray-50 border-gray-200')}>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-gray-800 px-3 py-1.5 rounded-lg text-xs">
              <Calendar size={14} />
              <select
                value={fiscalYear}
                onChange={(e) => onFiscalYearChange(Number(e.target.value))}
                title={language === 'ar' ? 'اختر السنة المالية' : 'Select fiscal year'}
                className="bg-transparent outline-none text-xs cursor-pointer"
              >
                {yearOptions.map(y => (
                  <option key={y} value={y} className="bg-gray-900">{language === 'ar' ? `السنة ${y}` : `Year ${y}`}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 bg-gray-800 px-3 py-1.5 rounded-lg text-xs"><Filter size={14} /><span>{language === 'ar' ? 'تصفية' : 'Filter'}</span></div>
          </div>
          <div className="flex items-center gap-2">
            <button className="p-2 hover:bg-gray-800 rounded-lg transition-colors text-gray-400"><Printer size={18} /></button>
            <button className="p-2 hover:bg-gray-800 rounded-lg transition-colors text-gray-400"><Download size={18} /></button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className={cn('border-b transition-colors', theme === 'dark' ? 'border-gray-800 bg-gray-900/30' : theme === 'soft' ? 'border-[#cfd8dc] bg-[#eceff1]' : 'border-gray-200 bg-gray-50')}>
                <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'التاريخ' : 'Date'}</th>
                <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'البيان' : 'Description'}</th>
                <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'مركز التكلفة' : 'Cost Center'}</th>
                <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'الحساب' : 'Account'}</th>
                <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'مدين' : 'Debit'}</th>
                <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'دائن' : 'Credit'}</th>
              </tr>
            </thead>
            <tbody className={cn('divide-y transition-colors', theme === 'dark' ? 'divide-gray-800/50' : theme === 'soft' ? 'divide-[#cfd8dc]' : 'divide-gray-100')}>
              {transactions.map(tx => (
                <React.Fragment key={tx.id}>
                  {tx.entries.map((entry, idx) => (
                    <tr key={`${tx.id}-${idx}`} className={cn('transition-colors group cursor-pointer', theme === 'dark' ? 'hover:bg-gray-800/20' : theme === 'soft' ? 'hover:bg-[#eceff1]/50' : 'hover:bg-gray-50')} onClick={() => setSelectedTransaction(tx)}>
                      <td className="px-6 py-4 text-sm font-mono text-gray-500">{idx === 0 ? tx.date : ''}</td>
                      <td className="px-6 py-4 text-sm font-bold">{idx === 0 ? tx.description : ''}</td>
                      <td className="px-6 py-4 text-sm text-blue-400 font-medium">
                        {idx === 0 ? (() => { const c = contractsMap.get(tx.costCenterId!); const p = projectsMap.get(c?.projectId || ''); return c ? `${c.contractName} (${p?.projectName || '...'})` : '-'; })() : ''}
                      </td>
                      <td className="px-6 py-4 text-sm"><div className="flex items-center gap-2"><span className="font-mono text-[10px] text-gray-500">{entry.accountCode}</span><span>{entry.accountName}</span></div></td>
                      <td className="px-6 py-4 text-sm font-mono text-blue-400">{entry.debit > 0 ? entry.debit.toLocaleString() : ''}</td>
                      <td className="px-6 py-4 text-sm font-mono text-red-400">{entry.credit > 0 ? entry.credit.toLocaleString() : ''}</td>
                    </tr>
                  ))}
                  <tr className={cn('border-b transition-colors', theme === 'dark' ? 'bg-gray-900/10 border-gray-800/50' : theme === 'soft' ? 'bg-[#eceff1]/20 border-[#cfd8dc]' : 'bg-gray-50/50 border-gray-100')}>
                    <td colSpan={6} className="px-6 py-1 text-[10px] text-gray-500 italic">{language === 'ar' ? 'مرجع: ' : 'Ref: '}{tx.reference}</td>
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {transactions.length >= transactionLimit && (
          <div className={cn('p-4 border-t transition-colors flex justify-center', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
            <button onClick={onLoadMore} className="text-blue-400 hover:text-blue-300 text-sm font-bold flex items-center gap-2">
              <ChevronLast size={16} />
              {language === 'ar' ? 'تحميل المزيد من القيود' : 'Load More Entries'}
            </button>
          </div>
        )}
      </div>

      {/* New Entry Modal */}
      <AnimatePresence>
        {isEntryModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className={cn(modalBg, 'max-w-4xl')}>
              <div className={modalHeader}>
                <h3 className="text-xl font-bold">{language === 'ar' ? 'إضافة قيد محاسبي جديد' : 'Add New Journal Entry'}</h3>
                <button onClick={() => setIsEntryModalOpen(false)} className="text-gray-500 hover:text-white transition-colors"><X size={20} /></button>
              </div>
              <form onSubmit={handleSaveEntry} className="p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase">{language === 'ar' ? 'التاريخ' : 'Date'}</label>
                    <input required type="date" className={inputCls()} value={entryForm.date} onChange={(e) => setEntryForm({ ...entryForm, date: e.target.value })} />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-xs font-bold text-gray-400 uppercase">{language === 'ar' ? 'البيان' : 'Description'}</label>
                    <input required type="text" placeholder={language === 'ar' ? 'وصف القيد المحاسبي' : 'Entry description'} className={inputCls()} value={entryForm.description} onChange={(e) => setEntryForm({ ...entryForm, description: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-gray-400 uppercase">{language === 'ar' ? 'مركز التكلفة (العقد)' : 'Cost Center (Contract)'}</label>
                    <button type="button" onClick={() => setIsContractModalOpen(true)} className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1"><Plus size={12} />{language === 'ar' ? 'عقد جديد' : 'New Contract'}</button>
                  </div>
                  <SearchableSelect
                    value={entryForm.costCenterId}
                    onChange={(v) => setEntryForm({ ...entryForm, costCenterId: v })}
                    theme={theme}
                    dir={dir}
                    placeholder={language === 'ar' ? 'اختر العقد' : 'Select Contract'}
                    options={contracts.map(c => {
                      const p = projects.find(pr => pr.id === c.projectId);
                      return { value: c.id, secondary: c.contractNumber, label: `${c.contractName} — ${p?.projectName || ''}` };
                    })}
                  />
                </div>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h4 className="text-sm font-bold text-blue-400 uppercase tracking-wider">{language === 'ar' ? 'بنود القيد' : 'Entry Lines'}</h4>
                    <button type="button" onClick={() => setEntryForm({ ...entryForm, entries: [...entryForm.entries, { id: crypto.randomUUID(), accountCode: '', accountName: '', debit: 0, credit: 0 }] })} className="text-xs bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"><Plus size={14} />{language === 'ar' ? 'إضافة سطر' : 'Add Line'}</button>
                  </div>
                  <div className="space-y-3">
                    {entryForm.entries.map((entry, idx) => (
                      <div key={entry.id} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                        <div className="md:col-span-5 space-y-1">
                          <label className="text-[10px] text-gray-500 uppercase">{language === 'ar' ? 'الحساب' : 'Account'}</label>
                          <SearchableSelect
                            value={entry.accountCode}
                            onChange={(v) => handleEntryChange(idx, 'accountCode', v)}
                            theme={theme}
                            dir={dir}
                            placeholder={language === 'ar' ? 'اختر الحساب' : 'Select Account'}
                            options={accounts.filter(a => !a.isGroup && a.status !== 'disabled').map(a => ({
                              value: a.accountCode,
                              secondary: a.accountCode,
                              label: language === 'ar' ? a.accountName : (a.accountNameEn || a.accountName),
                            }))}
                          />
                        </div>
                        <div className="md:col-span-3 space-y-1">
                          <label className="text-[10px] text-gray-500 uppercase">{language === 'ar' ? 'مدين' : 'Debit'}</label>
                          <input type="number" step="0.01" className={cn(inputCls('py-2 px-3'), theme === 'dark' ? 'text-blue-400' : 'text-blue-700')} value={entry.debit} onChange={(e) => handleEntryChange(idx, 'debit', e.target.value)} />
                        </div>
                        <div className="md:col-span-3 space-y-1">
                          <label className="text-[10px] text-gray-500 uppercase">{language === 'ar' ? 'دائن' : 'Credit'}</label>
                          <input type="number" step="0.01" className={cn(inputCls('py-2 px-3'), theme === 'dark' ? 'text-red-400' : 'text-red-700')} value={entry.credit} onChange={(e) => handleEntryChange(idx, 'credit', e.target.value)} />
                        </div>
                        <div className="md:col-span-1 flex justify-center pb-2">
                          <button type="button" onClick={() => setEntryForm({ ...entryForm, entries: entryForm.entries.filter((_, i) => i !== idx) })} className="text-gray-500 hover:text-red-500 transition-colors"><Trash2 size={18} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className={cn('pt-6 border-t flex justify-between items-center transition-colors', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
                  <div className="flex gap-8 text-sm">
                    <div className="flex flex-col"><span className="text-gray-500 text-[10px] uppercase">{language === 'ar' ? 'إجمالي المدين' : 'Total Debit'}</span><span className="font-mono font-bold text-blue-400">{totalDebit.toLocaleString()}</span></div>
                    <div className="flex flex-col"><span className="text-gray-500 text-[10px] uppercase">{language === 'ar' ? 'إجمالي الدائن' : 'Total Credit'}</span><span className="font-mono font-bold text-red-400">{totalCredit.toLocaleString()}</span></div>
                    <div className="flex flex-col"><span className="text-gray-500 text-[10px] uppercase">{language === 'ar' ? 'الفرق' : 'Difference'}</span><span className={cn('font-mono font-bold', isBalanced ? 'text-green-500' : 'text-red-500')}>{(totalDebit - totalCredit).toLocaleString()}</span></div>
                  </div>
                  <div className="flex gap-3">
                    <button type="submit" disabled={isSubmitting} className="bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 px-8 py-3 rounded-xl font-bold transition-all flex items-center gap-2 text-white">
                      {isSubmitting ? (language === 'ar' ? 'جاري الحفظ...' : 'Saving...') : (language === 'ar' ? 'حفظ القيد' : 'Save Entry')}
                    </button>
                    <button type="button" onClick={() => setIsEntryModalOpen(false)} className={cn('px-8 py-3 rounded-xl font-bold transition-all', theme === 'dark' ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-100 hover:bg-gray-200 text-gray-900')}>
                      {language === 'ar' ? 'إلغاء' : 'Cancel'}
                    </button>
                  </div>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Contract Modal */}
      <AnimatePresence>
        {isContractModalOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-[#1a1b1e] border border-gray-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
              <div className="p-6 border-b border-gray-800 flex justify-between items-center">
                <h3 className="text-lg font-bold">{language === 'ar' ? 'إضافة عقد جديد' : 'Add New Contract'}</h3>
                <button onClick={() => setIsContractModalOpen(false)} className="text-gray-500 hover:text-white"><X size={20} /></button>
              </div>
              <form onSubmit={handleSaveContract} className="p-6 space-y-4">
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'اسم العقد' : 'Contract Name'}</label>
                  <input required type="text" className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500" value={contractForm.contractName} onChange={(e) => setContractForm({ ...contractForm, contractName: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'رقم العقد' : 'Contract Number'}</label>
                  <input required type="text" className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500" value={contractForm.contractNumber} onChange={(e) => setContractForm({ ...contractForm, contractNumber: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'المشروع المرتبط' : 'Linked Project'}</label>
                    <button type="button" onClick={() => setIsProjectModalOpen(true)} className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1"><Plus size={12} />{language === 'ar' ? 'مشروع جديد' : 'New Project'}</button>
                  </div>
                  <SearchableSelect
                    value={contractForm.projectId}
                    onChange={(v) => setContractForm({ ...contractForm, projectId: v })}
                    theme={theme}
                    dir={dir}
                    placeholder={language === 'ar' ? 'اختر المشروع' : 'Select Project'}
                    options={projects.map(p => ({ value: p.id, secondary: p.projectCode, label: p.projectName }))}
                  />
                </div>
                <div className="pt-4 flex gap-3">
                  <button type="submit" disabled={isSubmitting} className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 py-2 rounded-lg font-bold transition-colors text-white">{isSubmitting ? '...' : (language === 'ar' ? 'حفظ العقد' : 'Save Contract')}</button>
                  <button type="button" onClick={() => setIsContractModalOpen(false)} className="flex-1 bg-gray-800 hover:bg-gray-700 py-2 rounded-lg font-bold transition-colors">{language === 'ar' ? 'إلغاء' : 'Cancel'}</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Project Modal */}
      <AnimatePresence>
        {isProjectModalOpen && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/90 backdrop-blur-lg">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-[#1a1b1e] border border-gray-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
              <div className="p-6 border-b border-gray-800 flex justify-between items-center">
                <h3 className="text-lg font-bold">{language === 'ar' ? 'إضافة مشروع جديد' : 'Add New Project'}</h3>
                <button onClick={() => setIsProjectModalOpen(false)} className="text-gray-500 hover:text-white"><X size={20} /></button>
              </div>
              <form onSubmit={handleSaveProject} className="p-6 space-y-4">
                <div className="space-y-1"><label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'اسم المشروع' : 'Project Name'}</label><input required type="text" className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500" value={projectForm.projectName} onChange={(e) => setProjectForm({ ...projectForm, projectName: e.target.value })} /></div>
                <div className="space-y-1"><label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'كود المشروع' : 'Project Code'}</label><input required type="text" className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500" value={projectForm.projectCode} onChange={(e) => setProjectForm({ ...projectForm, projectCode: e.target.value })} /></div>
                <div className="space-y-1"><label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'العميل' : 'Client'}</label><input required type="text" className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500" value={projectForm.clientName} onChange={(e) => setProjectForm({ ...projectForm, clientName: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1"><label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'الميزانية' : 'Budget'}</label><input required type="number" className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500" value={projectForm.budget} onChange={(e) => setProjectForm({ ...projectForm, budget: Number(e.target.value) })} /></div>
                  <div className="space-y-1"><label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'تاريخ البدء' : 'Start Date'}</label><input required type="date" className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500" value={projectForm.startDate} onChange={(e) => setProjectForm({ ...projectForm, startDate: e.target.value })} /></div>
                </div>
                <div className="pt-4 flex gap-3">
                  <button type="submit" disabled={isSubmitting} className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 py-2 rounded-lg font-bold transition-colors text-white">{isSubmitting ? '...' : (language === 'ar' ? 'حفظ المشروع' : 'Save Project')}</button>
                  <button type="button" onClick={() => setIsProjectModalOpen(false)} className="flex-1 bg-gray-800 hover:bg-gray-700 py-2 rounded-lg font-bold transition-colors">{language === 'ar' ? 'إلغاء' : 'Cancel'}</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Transaction Detail Modal */}
      <AnimatePresence>
        {selectedTransaction && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className={cn(modalBg, 'max-w-2xl')}>
              <div className={modalHeader}>
                <div><h3 className="text-xl font-bold">{language === 'ar' ? 'تفاصيل القيد' : 'Journal Entry Details'}</h3><p className="text-xs text-gray-500 mt-1 font-mono">{selectedTransaction.reference}</p></div>
                <button onClick={() => setSelectedTransaction(null)} className="text-gray-500 hover:text-white transition-colors"><X size={20} /></button>
              </div>
              <div className="p-6 space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div><p className="text-[10px] text-gray-500 font-bold uppercase mb-1">{language === 'ar' ? 'التاريخ' : 'Date'}</p><p className="text-sm font-bold">{selectedTransaction.date}</p></div>
                  <div><p className="text-[10px] text-gray-500 font-bold uppercase mb-1">{language === 'ar' ? 'مركز التكلفة' : 'Cost Center'}</p><p className="text-sm font-bold">{(() => { const c = contractsMap.get(selectedTransaction.costCenterId!); const p = projectsMap.get(c?.projectId || ''); return c ? `${c.contractName} (${p?.projectName || '...'})` : '-'; })()}</p></div>
                  <div className="col-span-2"><p className="text-[10px] text-gray-500 font-bold uppercase mb-1">{language === 'ar' ? 'البيان' : 'Description'}</p><p className="text-sm font-bold">{selectedTransaction.description}</p></div>
                </div>
                <div className="border border-gray-800 rounded-xl overflow-hidden">
                  <table className="w-full text-right">
                    <thead><tr className="bg-gray-900/50 border-b border-gray-800"><th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase">{language === 'ar' ? 'الحساب' : 'Account'}</th><th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase">{language === 'ar' ? 'مدين' : 'Debit'}</th><th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase">{language === 'ar' ? 'دائن' : 'Credit'}</th></tr></thead>
                    <tbody className="divide-y divide-gray-800">
                      {selectedTransaction.entries.map((e, idx) => (
                        <tr key={idx} className="hover:bg-gray-800/20"><td className="px-4 py-3"><div className="flex flex-col"><span className="text-sm font-medium">{e.accountName}</span><span className="text-[10px] text-gray-500 font-mono">{e.accountCode}</span></div></td><td className="px-4 py-3 text-sm font-mono text-blue-400">{e.debit > 0 ? e.debit.toLocaleString() : '-'}</td><td className="px-4 py-3 text-sm font-mono text-red-400">{e.credit > 0 ? e.credit.toLocaleString() : '-'}</td></tr>
                      ))}
                    </tbody>
                    <tfoot><tr className="bg-gray-900/50 font-bold border-t border-gray-800"><td className="px-4 py-3 text-sm">{language === 'ar' ? 'الإجمالي' : 'Total'}</td><td className="px-4 py-3 text-sm font-mono text-blue-400">{selectedTransaction.entries.reduce((s, e) => s + e.debit, 0).toLocaleString()}</td><td className="px-4 py-3 text-sm font-mono text-red-400">{selectedTransaction.entries.reduce((s, e) => s + e.credit, 0).toLocaleString()}</td></tr></tfoot>
                  </table>
                </div>
                <div className={cn('flex gap-3 justify-end pt-4 border-t', theme === 'dark' ? 'border-gray-800' : 'border-gray-100')}>
                  <button onClick={() => handleDeleteTransaction(selectedTransaction)} className="px-6 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-500 rounded-lg text-sm font-bold transition-colors flex items-center gap-2 mr-auto"><Trash2 size={16} />{language === 'ar' ? 'حذف القيد' : 'Delete Entry'}</button>
                  <button onClick={() => handleExportPDF(selectedTransaction)} className={cn('px-6 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2', theme === 'dark' ? 'bg-gray-800 hover:bg-gray-700 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-900')}><Printer size={16} />{language === 'ar' ? 'طباعة' : 'Print'}</button>
                  <button onClick={() => setSelectedTransaction(null)} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-bold text-white transition-colors">{language === 'ar' ? 'إغلاق' : 'Close'}</button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Confirm Modal */}
      <AnimatePresence>
        {confirmConfig.isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className={cn('border rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl p-6 text-center transition-colors', theme === 'dark' ? 'bg-[#1a1b1e] border-gray-800' : 'bg-white border-gray-200')}>
              <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4"><AlertCircle className="text-red-500" size={32} /></div>
              <h3 className="text-xl font-bold mb-2">{confirmConfig.title}</h3>
              <p className="text-gray-400 text-sm mb-8">{confirmConfig.message}</p>
              <div className="flex gap-3">
                <button onClick={confirmConfig.onConfirm} disabled={isSubmitting} className="flex-1 bg-red-600 hover:bg-red-500 disabled:bg-red-800 py-3 rounded-xl font-bold text-white flex items-center justify-center gap-2">{isSubmitting && <Loader2 className="animate-spin" size={18} />}{language === 'ar' ? 'تأكيد الحذف' : 'Confirm Delete'}</button>
                <button onClick={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))} disabled={isSubmitting} className={cn('flex-1 py-3 rounded-xl font-bold', theme === 'dark' ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-100 hover:bg-gray-200')}>{language === 'ar' ? 'إلغاء' : 'Cancel'}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
