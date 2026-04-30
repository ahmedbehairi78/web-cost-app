import React, { useState, useMemo } from 'react';
import { Calculator, Printer } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Account } from '../../services/accountingService';
import { SearchableSelect } from '../ui/SearchableSelect';
// @ts-ignore
import html2pdf from 'html2pdf.js';

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
  transactions: Transaction[];
  accounts: Account[];
  theme: string;
  language: string;
  dir: string;
}

export function GLAccountStatement({ transactions, accounts, theme, language, dir }: Props) {
  const [selectedAccount, setSelectedAccount] = useState('');

  const accountTransactions = useMemo(() => {
    if (!selectedAccount) return [];
    return transactions
      .filter(tx => tx.entries.some(e => e.accountCode === selectedAccount))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [transactions, selectedAccount]);

  const handleExportPDF = () => {
    if (!selectedAccount) return;
    const account = accounts.find(a => a.accountCode === selectedAccount);
    const isAr = language === 'ar';
    const el = document.createElement('div');
    el.dir = isAr ? 'rtl' : 'ltr';
    el.style.padding = '40px';
    el.style.backgroundColor = '#ffffff';
    el.style.color = '#000000';

    let runningBalance = 0;
    el.innerHTML = `
      <div style="text-align:center;margin-bottom:30px;">
        <h1 style="font-size:24px;color:#1e3a8a;">${isAr ? 'كشف حساب تفصيلي' : 'Detailed Account Statement'}</h1>
        <p style="font-size:18px;font-weight:bold;">${account?.accountCode} - ${account?.accountName}</p>
        <p style="color:#666;font-size:12px;">${new Date().toLocaleDateString(isAr ? 'ar-EG' : 'en-US')}</p>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr style="background:#f8fafc;border-bottom:2px solid #1e3a8a;">
          <th style="padding:10px;border:1px solid #e2e8f0;">${isAr ? 'التاريخ' : 'Date'}</th>
          <th style="padding:10px;border:1px solid #e2e8f0;">${isAr ? 'البيان' : 'Description'}</th>
          <th style="padding:10px;border:1px solid #e2e8f0;text-align:center;">${isAr ? 'مدين' : 'Debit'}</th>
          <th style="padding:10px;border:1px solid #e2e8f0;text-align:center;">${isAr ? 'دائن' : 'Credit'}</th>
          <th style="padding:10px;border:1px solid #e2e8f0;text-align:center;">${isAr ? 'الرصيد' : 'Balance'}</th>
        </tr></thead>
        <tbody>
          ${accountTransactions.map(tx => {
            const entry = tx.entries.find(e => e.accountCode === selectedAccount)!;
            runningBalance += entry.debit - entry.credit;
            return `<tr>
              <td style="padding:8px;border:1px solid #e2e8f0;">${tx.date}</td>
              <td style="padding:8px;border:1px solid #e2e8f0;">${tx.description}</td>
              <td style="padding:8px;border:1px solid #e2e8f0;text-align:center;color:#3b82f6;">${entry.debit > 0 ? entry.debit.toLocaleString() : '-'}</td>
              <td style="padding:8px;border:1px solid #e2e8f0;text-align:center;color:#ef4444;">${entry.credit > 0 ? entry.credit.toLocaleString() : '-'}</td>
              <td style="padding:8px;border:1px solid #e2e8f0;text-align:center;font-weight:bold;color:${runningBalance >= 0 ? '#10b981' : '#ef4444'};">${runningBalance.toLocaleString()}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    html2pdf().set({ margin: 0.5, filename: `Ledger_${selectedAccount}_${new Date().toISOString().split('T')[0]}.pdf`, html2canvas: { scale: 2 }, jsPDF: { unit: 'in', format: 'letter' } }).from(el).save();
  };

  return (
    <div className="space-y-6">
      <div className={cn('p-6 border rounded-xl shadow-sm transition-colors', theme === 'dark' ? 'bg-[#151619] border-gray-800' : theme === 'soft' ? 'bg-white border-[#cfd8dc]' : 'bg-white border-gray-200')}>
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex-1">
            <label className="block text-xs font-bold text-gray-500 uppercase mb-2">{language === 'ar' ? 'اختر الحساب' : 'Select Account'}</label>
            <SearchableSelect
              value={selectedAccount}
              onChange={setSelectedAccount}
              theme={theme}
              dir={dir}
              placeholder={language === 'ar' ? '--- اختر حساباً ---' : '--- Select an Account ---'}
              options={accounts
                .filter(a => !a.isGroup && a.status !== 'disabled')
                .map(acc => ({
                  value: acc.accountCode,
                  secondary: acc.accountCode,
                  label: language === 'ar' ? acc.accountName : (acc.accountNameEn || acc.accountName),
                }))}
            />
          </div>
          <div className="flex gap-2 self-end">
            <button onClick={handleExportPDF} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-bold transition-colors flex items-center gap-2">
              <Printer size={16} />
              {language === 'ar' ? 'طباعة' : 'Print'}
            </button>
          </div>
        </div>
      </div>

      {!selectedAccount ? (
        <div className="flex flex-col items-center justify-center p-20 text-gray-500 border border-dashed border-gray-800 rounded-xl">
          <Calculator size={48} className="mb-4 opacity-20" />
          <h3 className="text-xl font-bold">{language === 'ar' ? 'كشف الحساب التفصيلي' : 'Detailed Account Statement'}</h3>
          <p className="mt-2">{language === 'ar' ? 'اختر حساباً من القائمة أعلاه لعرض حركته التفصيلية' : 'Select an account from the list above to view its detailed movement'}</p>
        </div>
      ) : (
        <div className={cn('border rounded-xl overflow-hidden shadow-sm', theme === 'dark' ? 'bg-[#151619] border-gray-800' : 'bg-white border-gray-200')}>
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className={cn('border-b', theme === 'dark' ? 'border-gray-800 bg-gray-900/30' : 'border-gray-200 bg-gray-50')}>
                  <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'التاريخ' : 'Date'}</th>
                  <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'البيان' : 'Description'}</th>
                  <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'مدين' : 'Debit'}</th>
                  <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'دائن' : 'Credit'}</th>
                  <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'الرصيد' : 'Balance'}</th>
                </tr>
              </thead>
              <tbody className={cn('divide-y transition-colors', theme === 'dark' ? 'divide-gray-800/50' : theme === 'soft' ? 'divide-[#cfd8dc]' : 'divide-gray-100')}>
                {(() => {
                  let balance = 0;
                  return accountTransactions.map(tx => {
                    const entry = tx.entries.find(e => e.accountCode === selectedAccount)!;
                    balance += entry.debit - entry.credit;
                    return (
                      <tr key={tx.id} className={cn('transition-colors', theme === 'dark' ? 'hover:bg-gray-800/20' : theme === 'soft' ? 'hover:bg-[#eceff1]/50' : 'hover:bg-gray-50')}>
                        <td className="px-6 py-4 text-sm font-mono text-gray-500">{tx.date}</td>
                        <td className="px-6 py-4 text-sm font-bold">{tx.description}</td>
                        <td className="px-6 py-4 text-sm font-mono text-blue-400">{entry.debit > 0 ? entry.debit.toLocaleString() : '-'}</td>
                        <td className="px-6 py-4 text-sm font-mono text-red-400">{entry.credit > 0 ? entry.credit.toLocaleString() : '-'}</td>
                        <td className={cn('px-6 py-4 text-sm font-mono font-bold', balance >= 0 ? 'text-green-400' : 'text-red-400')}>{balance.toLocaleString()}</td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
