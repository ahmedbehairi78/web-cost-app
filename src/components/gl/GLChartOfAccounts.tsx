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
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(['1', '11', '12', '2', '21', '22', '3', '31', '4', '41', '42', '5', '51', '52', '53'])
  );
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
    const BS = 'balance_sheet';
    const PL = 'income_statement';
    const defaults = [
      // ══════════════════════════════════════════════════════════════
      // 1 — الأصول [ميزانية]
      // ══════════════════════════════════════════════════════════════
      { accountCode: '1',    accountName: 'الأصول',                                 parentCode: '',    type: 'asset',     isGroup: true,  statementType: BS },
      // L2: الأصول المتداولة
      { accountCode: '11',   accountName: 'الأصول المتداولة',                       parentCode: '1',   type: 'asset',     isGroup: true,  statementType: BS },
      { accountCode: '111',  accountName: 'النقدية والبنوك',                        parentCode: '11',  type: 'asset',     isGroup: true,  statementType: BS },
      { accountCode: '1111', accountName: 'البنك',                                  parentCode: '111', type: 'asset',     isGroup: false, statementType: BS },
      { accountCode: '112',  accountName: 'العملاء والذمم المدينة',                 parentCode: '11',  type: 'asset',     isGroup: true,  statementType: BS },
      { accountCode: '1121', accountName: 'العملاء - مستخلصات تحت التحصيل',        parentCode: '112', type: 'asset',     isGroup: false, statementType: BS },
      { accountCode: '1122', accountName: 'محتجزات الضمان - عملاء',                parentCode: '112', type: 'asset',     isGroup: false, statementType: BS },
      { accountCode: '113',  accountName: 'المدفوعات المقدمة',                      parentCode: '11',  type: 'asset',     isGroup: true,  statementType: BS },
      { accountCode: '1131', accountName: 'مقدمات للموردين',                        parentCode: '113', type: 'asset',     isGroup: false, statementType: BS },
      { accountCode: '114',  accountName: 'حسابات ضريبية مدينة',                   parentCode: '11',  type: 'asset',     isGroup: true,  statementType: BS },
      { accountCode: '1141', accountName: 'ضريبة القيمة المضافة - مدخلات',         parentCode: '114', type: 'asset',     isGroup: false, statementType: BS },
      { accountCode: '1142', accountName: 'مصلحة الضرائب - خصم وإضافة',           parentCode: '114', type: 'asset',     isGroup: false, statementType: BS },
      { accountCode: '1143', accountName: 'التأمينات الاجتماعية',                   parentCode: '114', type: 'asset',     isGroup: false, statementType: BS },
      { accountCode: '1144', accountName: 'القوى العاملة',                          parentCode: '114', type: 'asset',     isGroup: false, statementType: BS },
      { accountCode: '115',  accountName: 'ذمم مدينة أخرى',                        parentCode: '11',  type: 'asset',     isGroup: true,  statementType: BS },
      { accountCode: '1151', accountName: 'حسابات مدينة متنوعة',                   parentCode: '115', type: 'asset',     isGroup: false, statementType: BS },
      // L2: الأصول غير المتداولة
      { accountCode: '12',   accountName: 'الأصول غير المتداولة',                   parentCode: '1',   type: 'asset',     isGroup: true,  statementType: BS },
      { accountCode: '121',  accountName: 'الأصول الثابتة',                         parentCode: '12',  type: 'asset',     isGroup: true,  statementType: BS },
      { accountCode: '1211', accountName: 'أصول ثابتة - تكلفة',                    parentCode: '121', type: 'asset',     isGroup: false, statementType: BS },
      { accountCode: '1212', accountName: 'مجمع الإهلاك (دائن)',                    parentCode: '121', type: 'asset',     isGroup: false, statementType: BS },
      { accountCode: '122',  accountName: 'أصول أخرى',                             parentCode: '12',  type: 'asset',     isGroup: true,  statementType: BS },
      { accountCode: '1221', accountName: 'أعمال قيد التنفيذ (WIP)',                parentCode: '122', type: 'asset',     isGroup: false, statementType: BS },
      // ══════════════════════════════════════════════════════════════
      // 2 — الخصوم [ميزانية]
      // ══════════════════════════════════════════════════════════════
      { accountCode: '2',    accountName: 'الخصوم',                                 parentCode: '',    type: 'liability', isGroup: true,  statementType: BS },
      // L2: الخصوم المتداولة
      { accountCode: '21',   accountName: 'الخصوم المتداولة',                       parentCode: '2',   type: 'liability', isGroup: true,  statementType: BS },
      { accountCode: '211',  accountName: 'ذمم دائنة تجارية',                      parentCode: '21',  type: 'liability', isGroup: true,  statementType: BS },
      { accountCode: '2111', accountName: 'الموردون',                               parentCode: '211', type: 'liability', isGroup: false, statementType: BS },
      { accountCode: '2112', accountName: 'مقاولو الباطن',                          parentCode: '211', type: 'liability', isGroup: false, statementType: BS },
      { accountCode: '212',  accountName: 'محتجزات الضمان - مقاولون',             parentCode: '21',  type: 'liability', isGroup: true,  statementType: BS },
      { accountCode: '2121', accountName: 'محتجزات ضمان الأعمال - مقاولون',       parentCode: '212', type: 'liability', isGroup: false, statementType: BS },
      { accountCode: '213',  accountName: 'دفعات مقدمة من العملاء',                parentCode: '21',  type: 'liability', isGroup: true,  statementType: BS },
      { accountCode: '2131', accountName: 'دفعات مقدمة من العملاء',                parentCode: '213', type: 'liability', isGroup: false, statementType: BS },
      { accountCode: '214',  accountName: 'التزامات ضريبية',                       parentCode: '21',  type: 'liability', isGroup: true,  statementType: BS },
      { accountCode: '2141', accountName: 'ضريبة القيمة المضافة - مخرجات',         parentCode: '214', type: 'liability', isGroup: false, statementType: BS },
      { accountCode: '2142', accountName: 'مصلحة الضرائب - خصم وإضافة (دائن)',   parentCode: '214', type: 'liability', isGroup: false, statementType: BS },
      { accountCode: '2143', accountName: 'التأمينات الاجتماعية (دائن)',           parentCode: '214', type: 'liability', isGroup: false, statementType: BS },
      { accountCode: '2144', accountName: 'القوى العاملة (دائن)',                  parentCode: '214', type: 'liability', isGroup: false, statementType: BS },
      { accountCode: '215',  accountName: 'مستحقات دائنة أخرى',                    parentCode: '21',  type: 'liability', isGroup: true,  statementType: BS },
      { accountCode: '2151', accountName: 'مصروفات مستحقة',                         parentCode: '215', type: 'liability', isGroup: false, statementType: BS },
      // L2: الخصوم غير المتداولة
      { accountCode: '22',   accountName: 'الخصوم غير المتداولة',                   parentCode: '2',   type: 'liability', isGroup: true,  statementType: BS },
      { accountCode: '221',  accountName: 'قروض طويلة الأجل',                      parentCode: '22',  type: 'liability', isGroup: true,  statementType: BS },
      { accountCode: '2211', accountName: 'قروض بنكية طويلة الأجل',                parentCode: '221', type: 'liability', isGroup: false, statementType: BS },
      // ══════════════════════════════════════════════════════════════
      // 3 — حقوق الملكية [ميزانية]
      // ══════════════════════════════════════════════════════════════
      { accountCode: '3',    accountName: 'حقوق الملكية',                           parentCode: '',    type: 'equity',    isGroup: true,  statementType: BS },
      { accountCode: '31',   accountName: 'رأس المال والاحتياطيات',                 parentCode: '3',   type: 'equity',    isGroup: true,  statementType: BS },
      { accountCode: '311',  accountName: 'رأس المال',                              parentCode: '31',  type: 'equity',    isGroup: true,  statementType: BS },
      { accountCode: '3111', accountName: 'رأس المال المدفوع',                      parentCode: '311', type: 'equity',    isGroup: false, statementType: BS },
      { accountCode: '312',  accountName: 'الاحتياطيات',                            parentCode: '31',  type: 'equity',    isGroup: true,  statementType: BS },
      { accountCode: '3121', accountName: 'احتياطي قانوني',                          parentCode: '312', type: 'equity',    isGroup: false, statementType: BS },
      { accountCode: '3122', accountName: 'احتياطيات أخرى',                         parentCode: '312', type: 'equity',    isGroup: false, statementType: BS },
      { accountCode: '313',  accountName: 'الأرباح المحتجزة',                       parentCode: '31',  type: 'equity',    isGroup: true,  statementType: BS },
      { accountCode: '3131', accountName: 'الأرباح المحتجزة',                       parentCode: '313', type: 'equity',    isGroup: false, statementType: BS },
      // ══════════════════════════════════════════════════════════════
      // 4 — الإيرادات [قائمة دخل]
      // ══════════════════════════════════════════════════════════════
      { accountCode: '4',    accountName: 'الإيرادات',                              parentCode: '',    type: 'revenue',   isGroup: true,  statementType: PL },
      { accountCode: '41',   accountName: 'إيرادات تشغيلية',                        parentCode: '4',   type: 'revenue',   isGroup: true,  statementType: PL },
      { accountCode: '411',  accountName: 'إيرادات عقود المقاولات',                 parentCode: '41',  type: 'revenue',   isGroup: true,  statementType: PL },
      { accountCode: '4111', accountName: 'إيرادات عقود مقاولات',                   parentCode: '411', type: 'revenue',   isGroup: false, statementType: PL },
      { accountCode: '4112', accountName: 'إيرادات خدمات إضافية',                   parentCode: '411', type: 'revenue',   isGroup: false, statementType: PL },
      { accountCode: '42',   accountName: 'إيرادات أخرى',                           parentCode: '4',   type: 'revenue',   isGroup: true,  statementType: PL },
      { accountCode: '421',  accountName: 'إيرادات غير تشغيلية',                    parentCode: '42',  type: 'revenue',   isGroup: true,  statementType: PL },
      { accountCode: '4211', accountName: 'إيرادات متنوعة',                          parentCode: '421', type: 'revenue',   isGroup: false, statementType: PL },
      // ══════════════════════════════════════════════════════════════
      // 5 — المصروفات [قائمة دخل]
      //   51 تكاليف العقود | 52 مصروفات تشغيلية | 53 مصروفات تمويلية
      // ══════════════════════════════════════════════════════════════
      { accountCode: '5',    accountName: 'المصروفات',                               parentCode: '',    type: 'expense',   isGroup: true,  statementType: PL },
      // 51 — تكاليف العقود (COGS)
      { accountCode: '51',   accountName: 'تكاليف العقود',                           parentCode: '5',   type: 'expense',   isGroup: true,  statementType: PL },
      { accountCode: '511',  accountName: 'تكاليف مباشرة',                           parentCode: '51',  type: 'expense',   isGroup: true,  statementType: PL },
      { accountCode: '5111', accountName: 'مواد البناء',                             parentCode: '511', type: 'expense',   isGroup: false, statementType: PL },
      { accountCode: '5112', accountName: 'عمالة مباشرة',                            parentCode: '511', type: 'expense',   isGroup: false, statementType: PL },
      { accountCode: '5113', accountName: 'مقاولو الباطن',                           parentCode: '511', type: 'expense',   isGroup: false, statementType: PL },
      { accountCode: '5114', accountName: 'معدات وآلات',                             parentCode: '511', type: 'expense',   isGroup: false, statementType: PL },
      { accountCode: '5115', accountName: 'نقل ولوجستيات',                           parentCode: '511', type: 'expense',   isGroup: false, statementType: PL },
      { accountCode: '512',  accountName: 'تكاليف غير مباشرة للموقع',               parentCode: '51',  type: 'expense',   isGroup: true,  statementType: PL },
      { accountCode: '5121', accountName: 'إشراف ميداني',                            parentCode: '512', type: 'expense',   isGroup: false, statementType: PL },
      { accountCode: '5122', accountName: 'مستلزمات الموقع',                         parentCode: '512', type: 'expense',   isGroup: false, statementType: PL },
      // 52 — مصروفات تشغيلية
      { accountCode: '52',   accountName: 'المصروفات التشغيلية',                     parentCode: '5',   type: 'expense',   isGroup: true,  statementType: PL },
      { accountCode: '521',  accountName: 'إدارية وعمومية',                          parentCode: '52',  type: 'expense',   isGroup: true,  statementType: PL },
      { accountCode: '5211', accountName: 'رواتب وأجور إدارية',                      parentCode: '521', type: 'expense',   isGroup: false, statementType: PL },
      { accountCode: '5212', accountName: 'إيجارات مكاتب',                           parentCode: '521', type: 'expense',   isGroup: false, statementType: PL },
      { accountCode: '5213', accountName: 'مرافق واتصالات',                          parentCode: '521', type: 'expense',   isGroup: false, statementType: PL },
      { accountCode: '5214', accountName: 'رسوم قانونية ومهنية',                     parentCode: '521', type: 'expense',   isGroup: false, statementType: PL },
      { accountCode: '5215', accountName: 'تأمينات',                                 parentCode: '521', type: 'expense',   isGroup: false, statementType: PL },
      { accountCode: '5216', accountName: 'إهلاك وإطفاء',                            parentCode: '521', type: 'expense',   isGroup: false, statementType: PL },
      { accountCode: '5217', accountName: 'مصروفات مكتبية وقرطاسية',                 parentCode: '521', type: 'expense',   isGroup: false, statementType: PL },
      { accountCode: '522',  accountName: 'مصروفات التسويق والبيع',                   parentCode: '52',  type: 'expense',   isGroup: true,  statementType: PL },
      { accountCode: '5221', accountName: 'دعاية وإعلان',                             parentCode: '522', type: 'expense',   isGroup: false, statementType: PL },
      // 53 — مصروفات تمويلية
      { accountCode: '53',   accountName: 'المصروفات التمويلية',                     parentCode: '5',   type: 'expense',   isGroup: true,  statementType: PL },
      { accountCode: '531',  accountName: 'تكاليف التمويل',                          parentCode: '53',  type: 'expense',   isGroup: true,  statementType: PL },
      { accountCode: '5311', accountName: 'فوائد بنكية',                             parentCode: '531', type: 'expense',   isGroup: false, statementType: PL },
      { accountCode: '5312', accountName: 'رسوم بنكية',                              parentCode: '531', type: 'expense',   isGroup: false, statementType: PL },
      { accountCode: '5313', accountName: 'خسائر فروق العملة',                       parentCode: '531', type: 'expense',   isGroup: false, statementType: PL },
    ];
    for (const acc of defaults) await addDoc(collection(db, 'chart_of_accounts'), { ...acc, status: 'active' });
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
            type: String(row['Type'] || row['النوع'] || 'asset').toLowerCase(),
            isGroup: String(row['Is Group'] || row['مجموعة'] || 'No').toLowerCase() === 'yes',
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
              theme === 'dark' ? 'hover:bg-gray-800/50 border-gray-800/20' : theme === 'soft' ? 'hover:bg-white/50 border-[#cfd8dc]' : 'hover:bg-gray-100 border-gray-100',
              level === 0 && (theme === 'dark' ? 'bg-gray-900/40 font-black text-blue-400 text-sm' : theme === 'soft' ? 'bg-[#eceff1]/60 font-black text-blue-600 text-sm' : 'bg-blue-50 font-black text-blue-700 text-sm'),
              level === 1 && (theme === 'dark' ? 'bg-gray-900/20 font-bold text-gray-200' : 'font-bold'),
              level === 2 && 'font-semibold text-sm',
              level >= 3 && 'text-sm',
              acc.status === 'disabled' && 'opacity-40 grayscale'
            )}
            style={{ [dir === 'rtl' ? 'paddingRight' : 'paddingLeft']: `${level * 20 + 16}px` }}
            onClick={() => acc.isGroup && toggleGroup(acc.accountCode)}
          >
            {acc.isGroup ? (isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <div className="w-3.5" />}
            <span className={cn('font-mono opacity-40 shrink-0', level === 0 ? 'text-sm w-8' : level === 1 ? 'text-xs w-10' : 'text-[11px] w-14')}>{acc.accountCode}</span>
            <span className={cn('flex-1', acc.status === 'disabled' && 'line-through')}>{acc.accountName}</span>
            <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
              {/* Statement type badge */}
              {acc.statementType && (
                <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded-sm font-black border shrink-0',
                  acc.statementType === 'balance_sheet'
                    ? 'bg-cyan-900/20 text-cyan-400 border-cyan-900/30'
                    : 'bg-amber-900/20 text-amber-400 border-amber-900/30'
                )}>
                  {acc.statementType === 'balance_sheet'
                    ? (language === 'ar' ? 'ميزانية' : 'B/S')
                    : (language === 'ar' ? 'قائمة دخل' : 'P&L')}
                </span>
              )}
              {/* Account type badge */}
              <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded-sm font-bold shrink-0',
                acc.type === 'asset'     ? 'bg-green-900/20 text-green-400' :
                acc.type === 'liability' ? 'bg-red-900/20 text-red-400' :
                acc.type === 'equity'    ? 'bg-purple-900/20 text-purple-400' :
                acc.type === 'revenue'   ? 'bg-blue-900/20 text-blue-400' :
                                           'bg-orange-900/20 text-orange-400'
              )}>
                {acc.type === 'asset'     ? (language === 'ar' ? 'أصول' : 'Asset') :
                 acc.type === 'liability' ? (language === 'ar' ? 'خصوم' : 'Liab') :
                 acc.type === 'equity'    ? (language === 'ar' ? 'ملكية' : 'Equity') :
                 acc.type === 'revenue'   ? (language === 'ar' ? 'إيرادات' : 'Rev') :
                                           (language === 'ar' ? 'مصروفات' : 'Exp')}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); handleToggleStatus(acc); }}
                className={cn('text-[10px] px-2 py-0.5 rounded font-bold transition-colors', acc.status === 'disabled' ? 'bg-green-600/20 text-green-500 hover:bg-green-600/30' : 'bg-red-600/20 text-red-500 hover:bg-red-600/30')}
              >
                {acc.status === 'disabled' ? (language === 'ar' ? 'تفعيل' : 'Activate') : (language === 'ar' ? 'تعطيل' : 'Disable')}
              </button>
              <button className="text-gray-500 hover:text-white"><Edit2 size={13} /></button>
              <button className="text-gray-500 hover:text-red-500"><Trash2 size={13} /></button>
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
