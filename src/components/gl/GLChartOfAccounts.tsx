import React, { useState } from 'react';
import { Search, ChevronRight, ChevronDown, Edit2, Trash2, FileDown, FileUp, Loader2 } from 'lucide-react';
import { collection, addDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { accountingService, Account } from '../../services/accountingService';
import { AccountModal } from './AccountModal';

interface Props {
  accounts: Account[];
  loading: boolean;
  theme: string;
  language: string;
  dir: string;
}

export function GLChartOfAccounts({ accounts, loading, theme, language, dir }: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['1', '2', '3', '4', '5']));
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toggleGroup = (code: string) => {
    const next = new Set(expandedGroups);
    if (next.has(code)) next.delete(code); else next.add(code);
    setExpandedGroups(next);
  };

  const handleToggleStatus = async (acc: Account) => {
    try {
      await accountingService.updateAccount(acc.id, { status: acc.status === 'disabled' ? 'active' : 'disabled' });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'chart_of_accounts');
    }
  };

  const seedAccounts = async () => {
    const defaults = [
      { accountCode: '1', accountName: 'الأصول', parentCode: '', type: 'asset', isGroup: true, status: 'active' },
      { accountCode: '11', accountName: 'الأصول المتداولة', parentCode: '1', type: 'asset', isGroup: true, status: 'active' },
      { accountCode: '1101', accountName: 'البنك', parentCode: '11', type: 'asset', isGroup: false, status: 'active' },
      { accountCode: '1102', accountName: 'العملاء - مستخلصات تحت التحصيل', parentCode: '11', type: 'asset', isGroup: false, status: 'active' },
      { accountCode: '2', accountName: 'الخصوم', parentCode: '', type: 'liability', isGroup: true, status: 'active' },
      { accountCode: '21', accountName: 'الموردين ومقاولي الباطن', parentCode: '2', type: 'liability', isGroup: false, status: 'active' },
      { accountCode: '3', accountName: 'حقوق الملكية', parentCode: '', type: 'equity', isGroup: true, status: 'active' },
      { accountCode: '4', accountName: 'الإيرادات', parentCode: '', type: 'revenue', isGroup: true, status: 'active' },
      { accountCode: '41', accountName: 'إيرادات عقود المقاولات', parentCode: '4', type: 'revenue', isGroup: false, status: 'active' },
      { accountCode: '5', accountName: 'المصروفات', parentCode: '', type: 'expense', isGroup: true, status: 'active' },
      { accountCode: '51', accountName: 'تكاليف مباشرة - مواد', parentCode: '5', type: 'expense', isGroup: false, status: 'active' },
      { accountCode: '52', accountName: 'تكاليف مباشرة - عمالة', parentCode: '5', type: 'expense', isGroup: false, status: 'active' },
    ];
    for (const acc of defaults) await addDoc(collection(db, 'chart_of_accounts'), acc);
  };

  const handleExportExcel = async () => {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.json_to_sheet(accounts.map(acc => ({
      'Account Code': acc.accountCode,
      'Account Name': acc.accountName,
      'Parent Code': acc.parentCode,
      'Type': acc.type,
      'Is Group': acc.isGroup ? 'Yes' : 'No',
      'Status': acc.status || 'active'
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ChartOfAccounts');
    XLSX.writeFile(wb, `COA_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleImportExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(evt.target?.result as string, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws);
      setIsSubmitting(true);
      try {
        for (const row of data as Record<string, unknown>[]) {
          const acc = {
            accountCode: String(row['Account Code'] || row['كود الحساب'] || ''),
            accountName: String(row['Account Name'] || row['اسم الحساب'] || ''),
            parentCode: String(row['Parent Code'] || row['الحساب الأب'] || ''),
            type: (row['Type'] || row['النوع'] || 'asset').toLowerCase(),
            isGroup: (row['Is Group'] || row['مجموعة'] || 'No').toLowerCase() === 'yes',
          };
          if (acc.accountCode && acc.accountName) await addDoc(collection(db, 'chart_of_accounts'), acc);
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, 'chart_of_accounts');
      } finally {
        setIsSubmitting(false);
      }
    };
    reader.readAsBinaryString(file);
  };

  const visibleAccounts = searchQuery
    ? accounts.filter(a => a.accountName.includes(searchQuery) || a.accountCode.includes(searchQuery))
    : accounts;

  const renderAccount = (parentCode: string = '', level: number = 0): React.ReactNode => {
    const filtered = visibleAccounts.filter(acc => acc.parentCode === parentCode);
    return filtered.map(acc => {
      const isExpanded = expandedGroups.has(acc.accountCode);
      return (
        <div key={acc.id} className="select-none">
          <div
            className={cn(
              'flex items-center gap-2 py-2 px-4 cursor-pointer border-b transition-colors group',
              theme === 'dark' ? 'hover:bg-gray-800/50 border-gray-800/30' : theme === 'soft' ? 'hover:bg-white/50 border-[#cfd8dc]' : 'hover:bg-gray-100 border-gray-100',
              level === 0 && (theme === 'dark' ? 'bg-gray-900/30 font-bold text-blue-400' : theme === 'soft' ? 'bg-white/40 font-bold text-blue-600' : 'bg-gray-200/50 font-bold text-blue-700'),
              acc.status === 'disabled' && 'opacity-40 grayscale'
            )}
            style={{ [dir === 'rtl' ? 'paddingRight' : 'paddingLeft']: `${level * 24 + 16}px` }}
            onClick={() => acc.isGroup && toggleGroup(acc.accountCode)}
          >
            {acc.isGroup ? (isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />) : <div className="w-4" />}
            <span className="font-mono text-xs opacity-50 w-16">{acc.accountCode}</span>
            <span className={cn('flex-1', acc.status === 'disabled' && 'line-through')}>{acc.accountName}</span>
            <div className="flex items-center gap-4 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => { e.stopPropagation(); handleToggleStatus(acc); }}
                className={cn('text-[10px] px-2 py-0.5 rounded font-bold transition-colors', acc.status === 'disabled' ? 'bg-green-600/20 text-green-500 hover:bg-green-600/30' : 'bg-red-600/20 text-red-500 hover:bg-red-600/30')}
              >
                {acc.status === 'disabled' ? (language === 'ar' ? 'تفعيل' : 'Activate') : (language === 'ar' ? 'تعطيل' : 'Disable')}
              </button>
              <span className={cn('text-[10px] uppercase px-2 py-0.5 rounded font-bold', acc.type === 'asset' ? 'bg-green-900/20 text-green-400' : acc.type === 'liability' ? 'bg-red-900/20 text-red-400' : acc.type === 'revenue' ? 'bg-blue-900/20 text-blue-400' : 'bg-gray-900/20 text-gray-400')}>
                {acc.type === 'asset' ? (language === 'ar' ? 'أصول' : 'Asset') : acc.type === 'liability' ? (language === 'ar' ? 'خصوم' : 'Liability') : acc.type === 'equity' ? (language === 'ar' ? 'حقوق ملكية' : 'Equity') : acc.type === 'revenue' ? (language === 'ar' ? 'إيرادات' : 'Revenue') : (language === 'ar' ? 'مصروفات' : 'Expense')}
              </span>
              <button className="text-gray-500 hover:text-white"><Edit2 size={14} /></button>
              <button className="text-gray-500 hover:text-red-500"><Trash2 size={14} /></button>
            </div>
          </div>
          <AnimatePresence>
            {acc.isGroup && isExpanded && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                {renderAccount(acc.accountCode, level + 1)}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      );
    });
  };

  return (
    <>
      <div className={cn('border rounded-xl overflow-hidden shadow-2xl transition-colors', theme === 'dark' ? 'bg-[#151619] border-gray-800' : theme === 'soft' ? 'bg-white border-[#cfd8dc]' : 'bg-white border-gray-200')}>
        <div className={cn('p-4 border-b flex items-center gap-4 transition-colors', theme === 'dark' ? 'bg-gray-900/50 border-gray-800' : theme === 'soft' ? 'bg-[#eceff1] border-[#cfd8dc]' : 'bg-gray-50 border-gray-200')}>
          <div className="relative flex-1">
            <Search className={cn('absolute top-1/2 -translate-y-1/2 text-gray-500', dir === 'rtl' ? 'right-3' : 'left-3')} size={18} />
            <input
              type="text"
              placeholder={language === 'ar' ? 'بحث في الحسابات...' : 'Search accounts...'}
              className={cn('w-full border rounded-lg py-2 text-sm outline-none focus:border-blue-500 transition-colors', dir === 'rtl' ? 'pr-10 pl-4' : 'pl-10 pr-4', theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <button onClick={handleExportExcel} className="bg-green-600 hover:bg-green-500 px-4 py-2 rounded-md text-xs font-medium transition-colors flex items-center gap-2 text-white">
              <FileDown size={14} />
              {language === 'ar' ? 'تصدير إكسل' : 'Export Excel'}
            </button>
            <label className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-md text-xs font-medium transition-colors flex items-center gap-2 text-white cursor-pointer">
              <FileUp size={14} />
              {language === 'ar' ? 'استيراد إكسل' : 'Import Excel'}
              {isSubmitting && <Loader2 className="animate-spin" size={12} />}
              <input type="file" className="hidden" accept=".xlsx, .xls" onChange={handleImportExcel} />
            </label>
            <button onClick={() => setIsAccountModalOpen(true)} className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-md text-xs font-medium transition-colors flex items-center gap-2 text-white">
              {language === 'ar' ? 'إضافة حساب' : 'Add Account'}
            </button>
            {accounts.length === 0 && (
              <button onClick={seedAccounts} className="bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-md text-xs font-medium transition-colors">
                {language === 'ar' ? 'توليد الشجرة الافتراضية' : 'Seed Default COA'}
              </button>
            )}
          </div>
        </div>
        <div className="overflow-y-auto max-h-[calc(100vh-350px)]">
          {loading ? (
            <div className="p-12 text-center text-gray-500">{language === 'ar' ? 'جاري التحميل...' : 'Loading...'}</div>
          ) : accounts.length === 0 ? (
            <div className="p-12 text-center text-gray-500">{language === 'ar' ? 'لا توجد حسابات.' : 'No accounts found.'}</div>
          ) : (
            <div className="py-2">{renderAccount()}</div>
          )}
        </div>
      </div>

      <AccountModal
        isOpen={isAccountModalOpen}
        onClose={() => setIsAccountModalOpen(false)}
        accounts={accounts}
        theme={theme}
        language={language}
      />
    </>
  );
}
