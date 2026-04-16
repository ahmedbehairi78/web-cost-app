import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  FolderTree, 
  ChevronRight, 
  ChevronDown, 
  Search,
  Edit2,
  Trash2,
  BookOpen,
  Calendar,
  Filter,
  ArrowRightLeft,
  Download,
  Printer,
  Calculator,
  X,
  AlertCircle
} from 'lucide-react';
import { collection, onSnapshot, query, orderBy, addDoc, where, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { cn } from '../lib/utils';
import { sortByDateFieldDesc } from '../lib/firestoreSorts';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../context/LanguageContext';
import { accountingService } from '../services/accountingService';

interface Account {
  id: string;
  accountCode: string;
  accountName: string;
  parentCode: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  isGroup: boolean;
}

interface Project {
  id: string;
  projectName: string;
  projectCode: string;
}

interface Contract {
  id: string;
  contractName: string;
  contractNumber: string;
  projectId: string;
}

interface Transaction {
  id: string;
  date: string;
  description: string;
  reference: string;
  costCenterId?: string;
  entries: {
    accountCode: string;
    accountName: string;
    debit: number;
    credit: number;
    note?: string;
  }[];
  createdBy: string;
}

export function GeneralLedger() {
  const { t, language, theme, dir } = useLanguage();
  const [activeSubTab, setActiveSubTab] = useState<'coa' | 'journal' | 'ledger'>('coa');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['1', '2', '3', '4', '5']));
  
  // Modal States
  const [isEntryModalOpen, setIsEntryModalOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isContractModalOpen, setIsContractModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [entryForm, setEntryForm] = useState({
    date: new Date().toISOString().split('T')[0],
    description: '',
    costCenterId: '',
    entries: [
      { accountCode: '', debit: 0, credit: 0 },
      { accountCode: '', debit: 0, credit: 0 }
    ]
  });

  const [projectForm, setProjectForm] = useState({
    projectName: '',
    projectCode: '',
    clientName: '',
    budget: 0,
    startDate: new Date().toISOString().split('T')[0],
  });

  const [contractForm, setContractForm] = useState({
    contractName: '',
    contractNumber: '',
    projectId: '',
  });

  useEffect(() => {
    setLoading(true);
    void accountingService.ensureDefaultChartAccounts();

    const unsubAccounts = onSnapshot(
      query(collection(db, 'chart_of_accounts'), orderBy('accountCode')),
      (snapshot) => {
        setAccounts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Account)));
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'chart_of_accounts')
    );

    const unsubProjects = onSnapshot(
      query(collection(db, 'projects'), where('isDeleted', '==', false)),
      (snapshot) => {
        setProjects(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'projects')
    );

    const unsubContracts = onSnapshot(
      query(collection(db, 'contracts'), where('isDeleted', '==', false)),
      (snapshot) => {
        setContracts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Contract)));
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'contracts')
    );

    const unsubTransactions = onSnapshot(
      collection(db, 'transactions'),
      (snapshot) => {
        const activeTransactions = snapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() } as Transaction))
          .filter((transaction) => (transaction as any).isDeleted !== true);
        setTransactions(sortByDateFieldDesc(activeTransactions, 'date'));
        setLoading(false);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'transactions')
    );

    return () => {
      unsubAccounts();
      unsubProjects();
      unsubContracts();
      unsubTransactions();
    };
  }, []);

  const handleSaveProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const docRef = await addDoc(collection(db, 'projects'), {
        ...projectForm,
        status: 'active',
        isDeleted: false,
        createdAt: serverTimestamp(),
      });
      setContractForm(prev => ({ ...prev, projectId: docRef.id }));
      setIsProjectModalOpen(false);
      setProjectForm({
        projectName: '',
        projectCode: '',
        clientName: '',
        budget: 0,
        startDate: new Date().toISOString().split('T')[0],
      });
    } catch (error) {
      console.error('Save Project Error:', error);
      alert(language === 'ar' ? 'فشل حفظ المشروع. يرجى التأكد من صلاحيات قاعدة البيانات.' : 'Failed to save project. Please check database permissions.');
      handleFirestoreError(error, OperationType.CREATE, 'projects');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveContract = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const docRef = await addDoc(collection(db, 'contracts'), {
        ...contractForm,
        isDeleted: false,
        createdAt: serverTimestamp(),
      });
      setEntryForm(prev => ({ ...prev, costCenterId: docRef.id }));
      setIsContractModalOpen(false);
      setContractForm({
        contractName: '',
        contractNumber: '',
        projectId: '',
      });
    } catch (error) {
      console.error('Save Contract Error:', error);
      alert(language === 'ar' ? 'فشل حفظ العقد. يرجى التأكد من صلاحيات قاعدة البيانات.' : 'Failed to save contract. Please check database permissions.');
      handleFirestoreError(error, OperationType.CREATE, 'contracts');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddEntryLine = () => {
    setEntryForm({
      ...entryForm,
      entries: [...entryForm.entries, { accountCode: '', debit: 0, credit: 0 }]
    });
  };

  const handleRemoveEntryLine = (index: number) => {
    setEntryForm({
      ...entryForm,
      entries: entryForm.entries.filter((_, i) => i !== index)
    });
  };

  const handleEntryChange = (index: number, field: string, value: any) => {
    const newEntries = [...entryForm.entries];
    newEntries[index] = { ...newEntries[index], [field]: value };
    setEntryForm({ ...entryForm, entries: newEntries });
  };

  const handleSaveEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!entryForm.costCenterId) {
      alert(language === 'ar' ? 'يجب اختيار مركز تكلفة (عقد) للقيد.' : 'Cost center (Contract) is required for the entry.');
      return;
    }

    const totalDebit = entryForm.entries.reduce((sum, e) => sum + Number(e.debit), 0);
    const totalCredit = entryForm.entries.reduce((sum, e) => sum + Number(e.credit), 0);

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      alert(language === 'ar' ? 'القيد غير متزن! يجب أن يتساوى إجمالي المدين مع الدائن.' : 'Entry is not balanced! Total Debit must equal Total Credit.');
      return;
    }

    setIsSubmitting(true);
    try {
      await accountingService.createTransaction({
        date: entryForm.date,
        description: entryForm.description,
        costCenterId: entryForm.costCenterId,
        projectId: entryForm.costCenterId, // Syncing both for compatibility
        entries: entryForm.entries.map(e => {
          const acc = accounts.find(a => a.accountCode === e.accountCode);
          return {
            accountCode: e.accountCode,
            accountName: acc?.accountName || '',
            debit: Number(e.debit),
            credit: Number(e.credit)
          };
        })
      });
      setIsEntryModalOpen(false);
      setEntryForm({
        date: new Date().toISOString().split('T')[0],
        description: '',
        costCenterId: '',
        entries: [{ accountCode: '', debit: 0, credit: 0 }, { accountCode: '', debit: 0, credit: 0 }]
      });
    } catch (error) {
      console.error('Save Entry Error:', error);
      alert(language === 'ar' ? 'فشل حفظ القيد. يرجى المحاولة مرة أخرى.' : 'Failed to save entry. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleGroup = (code: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(code)) newExpanded.delete(code);
    else newExpanded.add(code);
    setExpandedGroups(newExpanded);
  };

  const renderAccount = (parentCode: string = '', level: number = 0) => {
    const filtered = accounts.filter(acc => acc.parentCode === parentCode);
    
    return filtered.map(acc => {
      const isExpanded = expandedGroups.has(acc.accountCode);

      return (
        <div key={acc.id} className="select-none">
          <div 
            className={cn(
              "flex items-center gap-2 py-2 px-4 hover:bg-gray-800/50 cursor-pointer border-b border-gray-800/30 group transition-colors",
              level === 0 && "bg-gray-900/30 font-bold text-blue-400"
            )}
            style={{ [dir === 'rtl' ? 'paddingRight' : 'paddingLeft']: `${level * 24 + 16}px` }}
            onClick={() => acc.isGroup && toggleGroup(acc.accountCode)}
          >
            {acc.isGroup ? (
              isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />
            ) : (
              <div className="w-4" />
            )}
            <span className="font-mono text-xs opacity-50 w-16">{acc.accountCode}</span>
            <span className="flex-1">{acc.accountName}</span>
            
            <div className="flex items-center gap-4 opacity-0 group-hover:opacity-100 transition-opacity">
              <span className={cn(
                "text-[10px] uppercase px-2 py-0.5 rounded font-bold",
                acc.type === 'asset' ? "bg-green-900/20 text-green-400" :
                acc.type === 'liability' ? "bg-red-900/20 text-red-400" :
                acc.type === 'revenue' ? "bg-blue-900/20 text-blue-400" : "bg-gray-900/20 text-gray-400"
              )}>
                {acc.type === 'asset' ? (language === 'ar' ? 'أصول' : 'Asset') : 
                 acc.type === 'liability' ? (language === 'ar' ? 'خصوم' : 'Liability') : 
                 acc.type === 'equity' ? (language === 'ar' ? 'حقوق ملكية' : 'Equity') : 
                 acc.type === 'revenue' ? (language === 'ar' ? 'إيرادات' : 'Revenue') : (language === 'ar' ? 'مصروفات' : 'Expense')}
              </span>
              <button className="text-gray-500 hover:text-white"><Edit2 size={14} /></button>
              <button className="text-gray-500 hover:text-red-500"><Trash2 size={14} /></button>
            </div>
          </div>
          
          <AnimatePresence>
            {acc.isGroup && isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                {renderAccount(acc.accountCode, level + 1)}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      );
    });
  };

  const seedAccounts = async () => {
    await accountingService.ensureDefaultChartAccounts();
    return;

    const initialAccounts = [
      { accountCode: '1', accountName: 'الأصول', parentCode: '', type: 'asset', isGroup: true },
      { accountCode: '11', accountName: 'الأصول المتداولة', parentCode: '1', type: 'asset', isGroup: true },
      { accountCode: '1101', accountName: 'البنك', parentCode: '11', type: 'asset', isGroup: false },
      { accountCode: '1102', accountName: 'العملاء - مستخلصات تحت التحصيل', parentCode: '11', type: 'asset', isGroup: false },
      { accountCode: '2', accountName: 'الخصوم', parentCode: '', type: 'liability', isGroup: true },
      { accountCode: '21', accountName: 'الموردين ومقاولي الباطن', parentCode: '2', type: 'liability', isGroup: false },
      { accountCode: '3', accountName: 'حقوق الملكية', parentCode: '', type: 'equity', isGroup: true },
      { accountCode: '4', accountName: 'الإيرادات', parentCode: '', type: 'revenue', isGroup: true },
      { accountCode: '41', accountName: 'إيرادات عقود المقاولات', parentCode: '4', type: 'revenue', isGroup: false },
      { accountCode: '5', accountName: 'المصروفات', parentCode: '', type: 'expense', isGroup: true },
      { accountCode: '51', accountName: 'تكاليف مباشرة - مواد', parentCode: '5', type: 'expense', isGroup: false },
      { accountCode: '52', accountName: 'تكاليف مباشرة - عمالة', parentCode: '5', type: 'expense', isGroup: false },
    ];

    for (const acc of initialAccounts) {
      await addDoc(collection(db, 'chart_of_accounts'), acc);
    }
  };

  return (
    <div className={cn("p-8 min-h-screen transition-colors", theme === 'dark' ? "bg-[#0a0a0a] text-gray-100" : "bg-gray-50 text-gray-900")} dir={dir}>
      <header className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{language === 'ar' ? 'الأستاذ العام' : 'General Ledger'}</h2>
          <p className="text-gray-400 mt-1">{language === 'ar' ? 'إدارة القيود المحاسبية وشجرة الحسابات' : 'Manage journal entries and chart of accounts'}</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => setIsEntryModalOpen(true)}
            className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 text-white"
          >
            <Plus size={18} />
            {activeSubTab === 'coa' ? (language === 'ar' ? 'إضافة حساب' : 'Add Account') : (language === 'ar' ? 'قيد جديد' : 'New Entry')}
          </button>
        </div>
      </header>

      {/* New Entry Modal */}
      <AnimatePresence>
        {isEntryModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-[#151619] border border-gray-800 rounded-2xl w-full max-w-4xl overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-gray-800 flex justify-between items-center bg-gray-900/50">
                <h3 className="text-xl font-bold">{language === 'ar' ? 'إضافة قيد محاسبي جديد' : 'Add New Journal Entry'}</h3>
                <button onClick={() => setIsEntryModalOpen(false)} className="text-gray-500 hover:text-white transition-colors">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSaveEntry} className="p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase">{language === 'ar' ? 'التاريخ' : 'Date'}</label>
                    <input 
                      required
                      type="date" 
                      className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2.5 px-4 text-sm outline-none focus:border-blue-500 transition-colors"
                      value={entryForm.date}
                      onChange={(e) => setEntryForm({...entryForm, date: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-xs font-bold text-gray-400 uppercase">{language === 'ar' ? 'البيان' : 'Description'}</label>
                    <input 
                      required
                      type="text" 
                      placeholder={language === 'ar' ? 'وصف القيد المحاسبي' : 'Entry description'}
                      className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2.5 px-4 text-sm outline-none focus:border-blue-500 transition-colors"
                      value={entryForm.description}
                      onChange={(e) => setEntryForm({...entryForm, description: e.target.value})}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-gray-400 uppercase">{language === 'ar' ? 'مركز التكلفة (العقد)' : 'Cost Center (Contract)'}</label>
                    <button 
                      type="button"
                      onClick={() => setIsContractModalOpen(true)}
                      className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
                    >
                      <Plus size={12} />
                      {language === 'ar' ? 'عقد جديد' : 'New Contract'}
                    </button>
                  </div>
                  <select 
                    required
                    className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2.5 px-4 text-sm outline-none focus:border-blue-500 transition-colors appearance-none"
                    value={entryForm.costCenterId}
                    onChange={(e) => setEntryForm({...entryForm, costCenterId: e.target.value})}
                  >
                    <option value="">{language === 'ar' ? 'اختر العقد' : 'Select Contract'}</option>
                    {contracts.map(c => {
                      const project = projects.find(p => p.id === c.projectId);
                      return (
                        <option key={c.id} value={c.id}>
                          {c.contractName} ({c.contractNumber}) - {project?.projectName || '...'}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h4 className="text-sm font-bold text-blue-400 uppercase tracking-wider">{language === 'ar' ? 'بنود القيد' : 'Entry Lines'}</h4>
                    <button 
                      type="button"
                      onClick={handleAddEntryLine}
                      className="text-xs bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
                    >
                      <Plus size={14} />
                      {language === 'ar' ? 'إضافة سطر' : 'Add Line'}
                    </button>
                  </div>

                  <div className="space-y-3">
                    {entryForm.entries.map((entry, idx) => (
                      <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                        <div className="md:col-span-5 space-y-1">
                          <label className="text-[10px] text-gray-500 uppercase">{language === 'ar' ? 'الحساب' : 'Account'}</label>
                          <select 
                            required
                            className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500 transition-colors"
                            value={entry.accountCode}
                            onChange={(e) => handleEntryChange(idx, 'accountCode', e.target.value)}
                          >
                            <option value="">{language === 'ar' ? 'اختر الحساب' : 'Select Account'}</option>
                            {accounts.filter(acc => !acc.isGroup).map(acc => (
                              <option key={acc.id} value={acc.accountCode}>{acc.accountCode} - {acc.accountName}</option>
                            ))}
                          </select>
                        </div>
                        <div className="md:col-span-3 space-y-1">
                          <label className="text-[10px] text-gray-500 uppercase">{language === 'ar' ? 'مدين' : 'Debit'}</label>
                          <input 
                            type="number" 
                            step="0.01"
                            className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500 transition-colors text-blue-400"
                            value={entry.debit}
                            onChange={(e) => handleEntryChange(idx, 'debit', e.target.value)}
                          />
                        </div>
                        <div className="md:col-span-3 space-y-1">
                          <label className="text-[10px] text-gray-500 uppercase">{language === 'ar' ? 'دائن' : 'Credit'}</label>
                          <input 
                            type="number" 
                            step="0.01"
                            className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500 transition-colors text-red-400"
                            value={entry.credit}
                            onChange={(e) => handleEntryChange(idx, 'credit', e.target.value)}
                          />
                        </div>
                        <div className="md:col-span-1 flex justify-center pb-2">
                          <button 
                            type="button"
                            onClick={() => handleRemoveEntryLine(idx)}
                            className="text-gray-500 hover:text-red-500 transition-colors"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-6 border-t border-gray-800 flex justify-between items-center">
                  <div className="flex gap-8 text-sm">
                    <div className="flex flex-col">
                      <span className="text-gray-500 text-[10px] uppercase">{language === 'ar' ? 'إجمالي المدين' : 'Total Debit'}</span>
                      <span className="font-mono font-bold text-blue-400">{entryForm.entries.reduce((sum, e) => sum + Number(e.debit), 0).toLocaleString()}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-gray-500 text-[10px] uppercase">{language === 'ar' ? 'إجمالي الدائن' : 'Total Credit'}</span>
                      <span className="font-mono font-bold text-red-400">{entryForm.entries.reduce((sum, e) => sum + Number(e.credit), 0).toLocaleString()}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-gray-500 text-[10px] uppercase">{language === 'ar' ? 'الفرق' : 'Difference'}</span>
                      <span className={cn("font-mono font-bold", Math.abs(entryForm.entries.reduce((sum, e) => sum + Number(e.debit), 0) - entryForm.entries.reduce((sum, e) => sum + Number(e.credit), 0)) < 0.01 ? "text-green-500" : "text-red-500")}>
                        {(entryForm.entries.reduce((sum, e) => sum + Number(e.debit), 0) - entryForm.entries.reduce((sum, e) => sum + Number(e.credit), 0)).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button 
                      type="submit"
                      disabled={isSubmitting}
                      className="bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:text-gray-400 px-8 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 text-white"
                    >
                      {isSubmitting ? (language === 'ar' ? 'جاري الحفظ...' : 'Saving...') : (language === 'ar' ? 'حفظ القيد' : 'Save Entry')}
                    </button>
                    <button 
                      type="button"
                      onClick={() => setIsEntryModalOpen(false)}
                      className="bg-gray-800 hover:bg-gray-700 px-8 py-3 rounded-xl font-bold transition-all"
                    >
                      {language === 'ar' ? 'إلغاء' : 'Cancel'}
                    </button>
                  </div>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      
      {/* New Contract Modal */}
      <AnimatePresence>
        {isContractModalOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#1a1b1e] border border-gray-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-gray-800 flex justify-between items-center">
                <h3 className="text-lg font-bold">{language === 'ar' ? 'إضافة عقد جديد' : 'Add New Contract'}</h3>
                <button onClick={() => setIsContractModalOpen(false)} className="text-gray-500 hover:text-white">
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleSaveContract} className="p-6 space-y-4">
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'اسم العقد' : 'Contract Name'}</label>
                  <input 
                    required
                    type="text" 
                    className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500"
                    value={contractForm.contractName}
                    onChange={(e) => setContractForm({...contractForm, contractName: e.target.value})}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'رقم العقد' : 'Contract Number'}</label>
                  <input 
                    required
                    type="text" 
                    className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500"
                    value={contractForm.contractNumber}
                    onChange={(e) => setContractForm({...contractForm, contractNumber: e.target.value})}
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'المشروع المرتبط' : 'Linked Project'}</label>
                    <button 
                      type="button"
                      onClick={() => setIsProjectModalOpen(true)}
                      className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
                    >
                      <Plus size={12} />
                      {language === 'ar' ? 'مشروع جديد' : 'New Project'}
                    </button>
                  </div>
                  <select 
                    required
                    className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500 appearance-none"
                    value={contractForm.projectId}
                    onChange={(e) => setContractForm({...contractForm, projectId: e.target.value})}
                  >
                    <option value="">{language === 'ar' ? 'اختر المشروع' : 'Select Project'}</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.projectName} ({p.projectCode})</option>
                    ))}
                  </select>
                </div>
                <div className="pt-4 flex gap-3">
                  <button 
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 py-2 rounded-lg font-bold transition-colors text-white"
                  >
                    {isSubmitting ? (language === 'ar' ? 'جاري الحفظ...' : 'Saving...') : (language === 'ar' ? 'حفظ العقد' : 'Save Contract')}
                  </button>
                  <button 
                    type="button"
                    onClick={() => setIsContractModalOpen(false)}
                    className="flex-1 bg-gray-800 hover:bg-gray-700 py-2 rounded-lg font-bold transition-colors"
                  >
                    {language === 'ar' ? 'إلغاء' : 'Cancel'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* New Project Modal */}
      <AnimatePresence>
        {isProjectModalOpen && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/90 backdrop-blur-lg">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#1a1b1e] border border-gray-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-gray-800 flex justify-between items-center">
                <h3 className="text-lg font-bold">{language === 'ar' ? 'إضافة مشروع جديد' : 'Add New Project'}</h3>
                <button onClick={() => setIsProjectModalOpen(false)} className="text-gray-500 hover:text-white">
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleSaveProject} className="p-6 space-y-4">
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'اسم المشروع' : 'Project Name'}</label>
                  <input 
                    required
                    type="text" 
                    className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500"
                    value={projectForm.projectName}
                    onChange={(e) => setProjectForm({...projectForm, projectName: e.target.value})}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'كود المشروع' : 'Project Code'}</label>
                  <input 
                    required
                    type="text" 
                    className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500"
                    value={projectForm.projectCode}
                    onChange={(e) => setProjectForm({...projectForm, projectCode: e.target.value})}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'العميل' : 'Client'}</label>
                  <input 
                    required
                    type="text" 
                    className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500"
                    value={projectForm.clientName}
                    onChange={(e) => setProjectForm({...projectForm, clientName: e.target.value})}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'الميزانية' : 'Budget'}</label>
                    <input 
                      required
                      type="number" 
                      className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500"
                      value={projectForm.budget}
                      onChange={(e) => setProjectForm({...projectForm, budget: Number(e.target.value)})}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'تاريخ البدء' : 'Start Date'}</label>
                    <input 
                      required
                      type="date" 
                      className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500"
                      value={projectForm.startDate}
                      onChange={(e) => setProjectForm({...projectForm, startDate: e.target.value})}
                    />
                  </div>
                </div>
                <div className="pt-4 flex gap-3">
                  <button 
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 py-2 rounded-lg font-bold transition-colors text-white"
                  >
                    {isSubmitting ? (language === 'ar' ? 'جاري الحفظ...' : 'Saving...') : (language === 'ar' ? 'حفظ المشروع' : 'Save Project')}
                  </button>
                  <button 
                    type="button"
                    onClick={() => setIsProjectModalOpen(false)}
                    className="flex-1 bg-gray-800 hover:bg-gray-700 py-2 rounded-lg font-bold transition-colors"
                  >
                    {language === 'ar' ? 'إلغاء' : 'Cancel'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Tabs */}
      <div className="flex gap-4 mb-8 border-b border-gray-800">
        <button 
          onClick={() => setActiveSubTab('coa')}
          className={cn(
            "pb-4 px-2 text-sm font-bold transition-all relative",
            activeSubTab === 'coa' ? "text-blue-500" : "text-gray-500 hover:text-gray-300"
          )}
        >
          <div className="flex items-center gap-2">
            <FolderTree size={16} />
            {language === 'ar' ? 'شجرة الحسابات' : 'Chart of Accounts'}
          </div>
          {activeSubTab === 'coa' && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500" />}
        </button>
        <button 
          onClick={() => setActiveSubTab('journal')}
          className={cn(
            "pb-4 px-2 text-sm font-bold transition-all relative",
            activeSubTab === 'journal' ? "text-blue-500" : "text-gray-500 hover:text-gray-300"
          )}
        >
          <div className="flex items-center gap-2">
            <BookOpen size={16} />
            {language === 'ar' ? 'دفتر اليومية' : 'Journal Entries'}
          </div>
          {activeSubTab === 'journal' && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500" />}
        </button>
        <button 
          onClick={() => setActiveSubTab('ledger')}
          className={cn(
            "pb-4 px-2 text-sm font-bold transition-all relative",
            activeSubTab === 'ledger' ? "text-blue-500" : "text-gray-500 hover:text-gray-300"
          )}
        >
          <div className="flex items-center gap-2">
            <Calculator size={16} />
            {language === 'ar' ? 'كشف حساب' : 'Account Statement'}
          </div>
          {activeSubTab === 'ledger' && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500" />}
        </button>
      </div>

      {activeSubTab === 'coa' && (
        <div className={cn("border rounded-xl overflow-hidden shadow-2xl", theme === 'dark' ? "bg-[#151619] border-gray-800" : "bg-white border-gray-200")}>
          <div className={cn("p-4 border-b flex items-center gap-4", theme === 'dark' ? "bg-gray-900/50 border-gray-800" : "bg-gray-50 border-gray-200")}>
            <div className="relative flex-1">
              <Search className={cn("absolute top-1/2 -translate-y-1/2 text-gray-500", dir === 'rtl' ? "right-3" : "left-3")} size={18} />
              <input 
                type="text" 
                placeholder={language === 'ar' ? 'بحث في الحسابات...' : 'Search accounts...'}
                className={cn("w-full border rounded-lg py-2 text-sm outline-none focus:border-blue-500 transition-colors", 
                  dir === 'rtl' ? "pr-10 pl-4" : "pl-10 pr-4",
                  theme === 'dark' ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            {accounts.length === 0 && (
              <button 
                onClick={seedAccounts}
                className="bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-md text-xs font-medium transition-colors"
              >
                {language === 'ar' ? 'توليد الشجرة الافتراضية' : 'Seed Default COA'}
              </button>
            )}
          </div>
          <div className="overflow-y-auto max-h-[calc(100vh-350px)]">
            {loading ? (
              <div className="p-12 text-center text-gray-500">{language === 'ar' ? 'جاري التحميل...' : 'Loading...'}</div>
            ) : accounts.length === 0 ? (
              <div className="p-12 text-center text-gray-500">{language === 'ar' ? 'لا توجد حسابات.' : 'No accounts found.'}</div>
            ) : (
              <div className="py-2">
                {renderAccount()}
              </div>
            )}
          </div>
        </div>
      )}

      {activeSubTab === 'journal' && (
        <div className={cn("border rounded-xl overflow-hidden shadow-2xl", theme === 'dark' ? "bg-[#151619] border-gray-800" : "bg-white border-gray-200")}>
          <div className={cn("p-4 border-b flex items-center justify-between", theme === 'dark' ? "bg-gray-900/50 border-gray-800" : "bg-gray-50 border-gray-200")}>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 bg-gray-800 px-3 py-1.5 rounded-lg text-xs">
                <Calendar size={14} />
                <span>{language === 'ar' ? 'آخر 30 يوم' : 'Last 30 Days'}</span>
              </div>
              <div className="flex items-center gap-2 bg-gray-800 px-3 py-1.5 rounded-lg text-xs">
                <Filter size={14} />
                <span>{language === 'ar' ? 'تصفية' : 'Filter'}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="p-2 hover:bg-gray-800 rounded-lg transition-colors text-gray-400"><Printer size={18} /></button>
              <button className="p-2 hover:bg-gray-800 rounded-lg transition-colors text-gray-400"><Download size={18} /></button>
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className={cn("border-b", theme === 'dark' ? "border-gray-800 bg-gray-900/30" : "border-gray-200 bg-gray-50")}>
                  <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'التاريخ' : 'Date'}</th>
                  <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'البيان' : 'Description'}</th>
                  <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'مركز التكلفة' : 'Cost Center'}</th>
                  <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'الحساب' : 'Account'}</th>
                  <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'مدين' : 'Debit'}</th>
                  <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'دائن' : 'Credit'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {transactions.map((tx) => (
                  <React.Fragment key={tx.id}>
                    {tx.entries.map((entry, idx) => (
                      <tr 
                        key={`${tx.id}-${idx}`} 
                        className="hover:bg-gray-800/20 transition-colors group cursor-pointer"
                        onClick={() => setSelectedTransaction(tx)}
                      >
                        <td className="px-6 py-4 text-sm font-mono text-gray-500">
                          {idx === 0 ? tx.date : ''}
                        </td>
                        <td className="px-6 py-4 text-sm font-bold">
                          {idx === 0 ? tx.description : ''}
                        </td>
                        <td className="px-6 py-4 text-sm text-blue-400 font-medium">
                          {idx === 0 ? (() => {
                            const contract = contracts.find(c => c.id === tx.costCenterId);
                            const project = projects.find(p => p.id === contract?.projectId);
                            return contract ? `${contract.contractName} (${project?.projectName || '...'})` : '-';
                          })() : ''}
                        </td>
                        <td className="px-6 py-4 text-sm">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[10px] text-gray-500">{entry.accountCode}</span>
                              <span>{entry.accountName}</span>
                            </div>
                            {entry.note && (
                              <span className="text-[10px] text-gray-500">{entry.note}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm font-mono text-blue-400">
                          {entry.debit > 0 ? entry.debit.toLocaleString() : ''}
                        </td>
                        <td className="px-6 py-4 text-sm font-mono text-red-400">
                          {entry.credit > 0 ? entry.credit.toLocaleString() : ''}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-gray-900/10 border-b border-gray-800/50">
                      <td colSpan={6} className="px-6 py-1 text-[10px] text-gray-600 italic">
                        {language === 'ar' ? 'مرجع: ' : 'Ref: '}{tx.reference}
                      </td>
                    </tr>
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeSubTab === 'ledger' && (
        <div className="flex flex-col items-center justify-center p-20 text-gray-500 border border-dashed border-gray-800 rounded-xl">
          <Calculator size={48} className="mb-4 opacity-20" />
          <h3 className="text-xl font-bold">{language === 'ar' ? 'كشف الحساب التفصيلي' : 'Detailed Account Statement'}</h3>
          <p className="mt-2">{language === 'ar' ? 'اختر حساباً من الشجرة لعرض حركته التفصيلية هنا' : 'Select an account from the tree to view its detailed movement here'}</p>
        </div>
      )}

      {/* View Transaction Modal */}
      <AnimatePresence>
        {selectedTransaction && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-[#151619] border border-gray-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-gray-800 flex justify-between items-center bg-gray-900/50">
                <div>
                  <h3 className="text-xl font-bold">{language === 'ar' ? 'تفاصيل القيد' : 'Journal Entry Details'}</h3>
                  <p className="text-xs text-gray-500 mt-1 font-mono">{selectedTransaction.reference}</p>
                </div>
                <button onClick={() => setSelectedTransaction(null)} className="text-gray-500 hover:text-white transition-colors">
                  <X size={20} />
                </button>
              </div>

              <div className="p-6 space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">{language === 'ar' ? 'التاريخ' : 'Date'}</p>
                    <p className="text-sm font-bold">{selectedTransaction.date}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">{language === 'ar' ? 'مركز التكلفة' : 'Cost Center'}</p>
                    <p className="text-sm font-bold">
                      {(() => {
                        const contract = contracts.find(c => c.id === selectedTransaction.costCenterId);
                        const project = projects.find(p => p.id === contract?.projectId);
                        return contract ? `${contract.contractName} (${project?.projectName || '...'})` : '-';
                      })()}
                    </p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">{language === 'ar' ? 'البيان' : 'Description'}</p>
                    <p className="text-sm font-bold">{selectedTransaction.description}</p>
                  </div>
                </div>

                <div className="border border-gray-800 rounded-xl overflow-hidden">
                  <table className="w-full text-right">
                    <thead>
                      <tr className="bg-gray-900/50 border-b border-gray-800">
                        <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase">{language === 'ar' ? 'الحساب' : 'Account'}</th>
                        <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase">{language === 'ar' ? 'مدين' : 'Debit'}</th>
                        <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase">{language === 'ar' ? 'دائن' : 'Credit'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {selectedTransaction.entries.map((entry, idx) => (
                        <tr key={idx} className="hover:bg-gray-800/20">
                          <td className="px-4 py-3">
                            <div className="flex flex-col">
                              <span className="text-sm font-medium">{entry.accountName}</span>
                              <span className="text-[10px] text-gray-500 font-mono">{entry.accountCode}</span>
                              {entry.note && (
                                <span className="text-[10px] text-gray-500 mt-1">{entry.note}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm font-mono text-blue-400">
                            {entry.debit > 0 ? entry.debit.toLocaleString() : '-'}
                          </td>
                          <td className="px-4 py-3 text-sm font-mono text-red-400">
                            {entry.credit > 0 ? entry.credit.toLocaleString() : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-900/50 font-bold border-t border-gray-800">
                        <td className="px-4 py-3 text-sm">{language === 'ar' ? 'الإجمالي' : 'Total'}</td>
                        <td className="px-4 py-3 text-sm font-mono text-blue-400">
                          {selectedTransaction.entries.reduce((sum, e) => sum + e.debit, 0).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-sm font-mono text-red-400">
                          {selectedTransaction.entries.reduce((sum, e) => sum + e.credit, 0).toLocaleString()}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <div className="flex gap-3 justify-end pt-4">
                  <button 
                    onClick={() => window.print()}
                    className="px-6 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-bold transition-colors flex items-center gap-2"
                  >
                    <Printer size={16} />
                    {language === 'ar' ? 'طباعة' : 'Print'}
                  </button>
                  <button 
                    onClick={() => setSelectedTransaction(null)}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-bold transition-colors"
                  >
                    {language === 'ar' ? 'إغلاق' : 'Close'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
