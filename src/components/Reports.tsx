import React, { useState, useEffect, useRef } from 'react';
import { collection, onSnapshot, query, doc, getDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useLanguage } from '../context/LanguageContext';
import * as XLSX from 'xlsx';
import { 
  TrendingUp,
  PieChart as PieChartIcon,
  Download,
  Loader2,
  Printer,
  FileText,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  Calculator,
  Building2,
  ChevronRight,
  ChevronLeft,
  Clock
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell,
  Legend,
  LineChart,
  Line
} from 'recharts';

interface Project {
  id: string;
  projectName: string;
  projectCode: string;
  totalContractValue: number;
  boqValue?: number;
  voValue?: number;
}

interface Contract {
  id: string;
  contractName: string;
  contractNumber: string;
  projectId: string;
}

interface Cost {
  id: string;
  projectId: string;
  amount: number;
  date: string;
  description: string;
}

interface Billing {
  id: string;
  projectId: string;
  contractId: string;
  netPayable: number;
  worksValueExVat?: number;
  status: string;
  date: any;
}

interface BOQItem {
  id: string;
  projectId: string;
  contractId: string;
  tenderAmount: number;
  tenderQty: number;
  startDate?: string;
  expectedDuration?: number;
  actualEndDate?: string;
  itemCode: string;
  description: string;
}

export function Reports() {
  const { t, language, theme, dir } = useLanguage();
  const [projects, setProjects] = useState<Project[]>([]);
  const [costs, setCosts] = useState<Cost[]>([]);
  const [purchaseTransactions, setPurchaseTransactions] = useState<any[]>([]);
  const [billings, setBillings] = useState<Billing[]>([]);
  const [boqItems, setBoqItems] = useState<BOQItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeReport, setActiveReport] = useState<'overview' | 'income' | 'budget' | 'balance' | 'trial' | 'time'>('overview');
  const [transactions, setTransactions] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [showCharts, setShowCharts] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('all');
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [selectedContractId, setSelectedContractId] = useState<string>('all');
  
  const reportRef = useRef<HTMLDivElement>(null);

  // Company Info State
  const [companyInfo, setCompanyInfo] = useState({
    companyName: language === 'ar' ? 'شركة النيل للمقاولات والاستثمار العقاري' : 'Nile Construction & Real Estate',
    headerLogo: 'https://picsum.photos/seed/construction/200/200',
    taxId: '123-456-789',
    address: language === 'ar' ? 'القاهرة، مصر' : 'Cairo, Egypt'
  });

  useEffect(() => {
    const fetchSettings = async () => {
      const settingsDoc = await getDoc(doc(db, 'settings', 'company_info'));
      if (settingsDoc.exists()) {
        setCompanyInfo(settingsDoc.data() as any);
      }
    };
    fetchSettings();
  }, [language]);

  useEffect(() => {
    setLoading(true);
    const unsubProjects = onSnapshot(query(collection(db, 'projects'), where('isDeleted', '==', false)), (snap) => {
      setProjects(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
    }, (err) => {
      console.error("Projects listener error:", err);
    });

    const unsubCosts = onSnapshot(query(collection(db, 'actual_costs'), where('isDeleted', '==', false)), (snap) => {
      setCosts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Cost)));
    }, (err) => {
      console.error("Costs listener error:", err);
    });

    const unsubBillings = onSnapshot(query(collection(db, 'billing'), where('isDeleted', '==', false)), (snap) => {
      setBillings(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Billing)));
    }, (err) => {
      console.error("Billings listener error:", err);
    });

    const unsubPurchaseTransactions = onSnapshot(query(collection(db, 'purchase_transactions'), where('isDeleted', '==', false)), (snap) => {
      setPurchaseTransactions(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => {
      console.error("Reports purchase transactions listener error:", err);
    });

    const unsubTransactions = onSnapshot(query(collection(db, 'transactions'), where('isDeleted', '==', false)), (snap) => {
      setTransactions(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => {
      console.error("Reports transactions listener error:", err);
    });

    const unsubAccounts = onSnapshot(collection(db, 'chart_of_accounts'), (snap) => {
      setAccounts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setLoading(false);
    }, (err) => {
      console.error("Reports accounts listener error:", err);
      setLoading(false);
    });

    const unsubBoqItems = onSnapshot(collection(db, 'boq_items'), (snap) => {
      setBoqItems(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BOQItem)));
    }, (err) => {
      console.error("Reports boq_items listener error:", err);
    });

    return () => {
      unsubProjects();
      unsubCosts();
      unsubBillings();
      unsubPurchaseTransactions();
      unsubTransactions();
      unsubAccounts();
      unsubBoqItems();
    };
  }, []);

  useEffect(() => {
    setSelectedContractId('all');
    if (selectedProjectId === 'all') {
      setContracts([]);
      return;
    }
    const q = query(collection(db, 'contracts'), where('projectId', '==', selectedProjectId));
    const unsub = onSnapshot(q, snap => {
      setContracts(snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Contract & { isDeleted?: boolean }))
        .filter(c => !c.isDeleted)
      );
    });
    return () => unsub();
  }, [selectedProjectId]);

  // Data Processing
  // When a specific contract is selected → contract-centric view
  // Otherwise → project-level aggregation
  const computeStats = (
    id: string,
    name: string,
    projectId: string,
    contractId: string | null,
    fallbackBoqValue: number,
    fallbackVoValue: number,
    fallbackBudget: number
  ) => {
    const txFilter = (t: any) =>
      t.projectId === projectId && (contractId === null || t.costCenterId === contractId);
    const billingFilter = (b: Billing) =>
      b.projectId === projectId && b.status !== 'draft' && (contractId === null || b.contractId === contractId);
    const boqFilter = (item: BOQItem) =>
      item.projectId === projectId && (contractId === null || item.contractId === contractId);

    const ledgerCosts = transactions.filter(txFilter).reduce((sum, t) => {
      const expense = (t.entries || []).filter((e: any) => e.accountCode.startsWith('5'));
      return sum + expense.reduce((s: number, e: any) => s + (e.debit - e.credit), 0);
    }, 0);

    const revenue = billings.filter(billingFilter)
      .reduce((sum, b) => sum + (b.worksValueExVat || 0), 0);

    const boqValue = boqItems.filter(boqFilter)
      .reduce((sum, item) => sum + (item.tenderAmount || 0), 0) || fallbackBoqValue;

    const voValue = contractId !== null ? 0 : fallbackVoValue;
    const budget = (boqValue + voValue) || fallbackBudget;

    return {
      id, name, budget, boqValue, voValue,
      costs: ledgerCosts, billings: revenue,
      profit: revenue - ledgerCosts,
      variance: budget - ledgerCosts,
      variancePct: budget > 0 ? ((budget - ledgerCosts) / budget) * 100 : 0,
      progress: budget > 0 ? (revenue / budget) * 100 : 0
    };
  };

  const projectStats = (() => {
    if (selectedContractId !== 'all') {
      // Contract-centric: one row per selected contract
      const contract = contracts.find(c => c.id === selectedContractId);
      const project = projects.find(p => p.id === selectedProjectId);
      if (!contract || !project) return [];
      const label = `${contract.contractName} (${contract.contractNumber})`;
      return [computeStats(contract.id, label, selectedProjectId, selectedContractId, 0, 0, 0)];
    }

    // Project-level aggregation
    const filtered = selectedProjectId === 'all'
      ? projects
      : projects.filter(p => p.id === selectedProjectId);

    return filtered.map(p =>
      computeStats(p.id, p.projectName, p.id, null, p.boqValue || 0, p.voValue || 0, p.totalContractValue || 0)
    );
  })();

  const totalRevenue = projectStats.reduce((sum, s) => sum + s.billings, 0);
  const totalCosts = projectStats.reduce((sum, s) => sum + s.costs, 0);
  const totalGrossProfit = totalRevenue - totalCosts;
  const totalBudget = projectStats.reduce((sum, s) => sum + s.budget, 0);

  // BOQ progress map: boqItemId → cumulative executed qty (from non-draft billings)
  const boqProgressMap = React.useMemo(() => {
    const map: Record<string, number> = {};
    billings.forEach(b => {
      if (!['submitted', 'approved', 'paid'].includes(b.status)) return;
      ((b as any).items || []).forEach((item: any) => {
        if (item.boqItemId && item.currentQty > 0) {
          map[item.boqItemId] = (map[item.boqItemId] || 0) + item.currentQty;
        }
      });
    });
    return map;
  }, [billings]);

  // Analytical Trial Balance Calculation
  const trialBalance = React.useMemo(() => {
    // 1. Get all unique account codes from COA and Transactions
    const coaCodes = accounts.map(a => a.accountCode || a.code).filter(Boolean);
    const txFilter = (t: any) =>
      !t.isDeleted &&
      (selectedProjectId === 'all' || t.projectId === selectedProjectId) &&
      (selectedContractId === 'all' || t.costCenterId === selectedContractId);

    const txCodes = transactions
      .filter(txFilter)
      .flatMap(t => (t.entries || []))
      .map((e: any) => e.accountCode)
      .filter(Boolean);

    const allUniqueCodes = Array.from(new Set([...coaCodes, ...txCodes]));

    const list = allUniqueCodes.map(code => {
      const coaAcc = accounts.find(a => (a.accountCode || a.code) === code);
      const name = coaAcc ? (coaAcc.accountName || (language === 'ar' ? coaAcc.nameAr : coaAcc.nameEn)) : (language === 'ar' ? `حساب غير معرف (${code})` : `Undefined Account (${code})`);

      const accEntries = transactions
        .filter(txFilter)
        .flatMap(t => (t.entries || []))
        .filter((e: any) => e.accountCode === code);
      
      const debitMovements = accEntries.reduce((sum, e) => sum + (Number(e.debit) || 0), 0);
      const creditMovements = accEntries.reduce((sum, e) => sum + (Number(e.credit) || 0), 0);

      // In a full implementation, opening balances would be fetched from a dedicated collection or previous period
      const openingDebit = 0; 
      const openingCredit = 0;

      const netBalance = (openingDebit + debitMovements) - (openingCredit + creditMovements);
      
      return {
        code,
        name,
        openingDebit,
        openingCredit,
        debitMovements,
        creditMovements,
        closingDebit: netBalance > 0 ? netBalance : 0,
        closingCredit: netBalance < 0 ? Math.abs(netBalance) : 0
      };
    })
    // Filter out accounts with zero activity and zero opening as requested ("يتضمن كل الحسابات التي لها قيود")
    .filter(item => item.openingDebit !== 0 || item.openingCredit !== 0 || item.debitMovements !== 0 || item.creditMovements !== 0)
    .sort((a, b) => a.code.localeCompare(b.code));

    return list;
  }, [accounts, transactions, language, selectedProjectId, selectedContractId]);

  const trialBalanceTotals = React.useMemo(() => {
    return trialBalance.reduce((acc, item) => ({
      opDebit: acc.opDebit + item.openingDebit,
      opCredit: acc.opCredit + item.openingCredit,
      movDebit: acc.movDebit + item.debitMovements,
      movCredit: acc.movCredit + item.creditMovements,
      clDebit: acc.clDebit + item.closingDebit,
      clCredit: acc.clCredit + item.closingCredit
    }), { opDebit: 0, opCredit: 0, movDebit: 0, movCredit: 0, clDebit: 0, clCredit: 0 });
  }, [trialBalance]);

  const exportToExcel = () => {
    let data: any[] = [];
    let filename = 'report.xlsx';

    if (activeReport === 'overview') {
      data = projectStats.map(s => ({
        [language === 'ar' ? 'المشروع' : 'Project']: s.name,
        [language === 'ar' ? 'قيمة جداول الكميات' : 'BOQ Value']: s.boqValue,
        [language === 'ar' ? 'أوامر التغيير' : 'VO Value']: s.voValue,
        [language === 'ar' ? 'الميزانية الإجمالية' : 'Total Budget']: s.budget,
        [language === 'ar' ? 'المصروفات' : 'Expenses']: s.costs,
        [language === 'ar' ? 'الإيرادات' : 'Revenue']: s.billings,
        [language === 'ar' ? 'نسبة الإنجاز' : 'Progress']: s.progress.toFixed(2) + '%'
      }));
      filename = 'Project_Overview.xlsx';
    } else if (activeReport === 'income') {
      data = projectStats.map(s => ({
        [language === 'ar' ? 'المشروع' : 'Project']: s.name,
        [language === 'ar' ? 'الإيرادات' : 'Revenue']: s.billings,
        [language === 'ar' ? 'التكاليف المباشرة' : 'Direct Costs']: s.costs,
        [language === 'ar' ? 'مجمل الربح' : 'Gross Profit']: s.profit,
        [language === 'ar' ? 'هامش الربح %' : 'Profit Margin %']: ((s.profit / (s.billings || 1)) * 100).toFixed(2) + '%'
      }));
      filename = 'Income_Statement.xlsx';
    } else if (activeReport === 'budget') {
      data = projectStats.map(s => ({
        [language === 'ar' ? 'المشروع' : 'Project']: s.name,
        [language === 'ar' ? 'قيمة جداول الكميات' : 'BOQ Value']: s.boqValue,
        [language === 'ar' ? 'أوامر التغيير' : 'VO Value']: s.voValue,
        [language === 'ar' ? 'الميزانية الإجمالية' : 'Total Budget']: s.budget,
        [language === 'ar' ? 'التكاليف الفعلية' : 'Actual Costs']: s.costs,
        [language === 'ar' ? 'الانحراف' : 'Variance']: s.variance,
        [language === 'ar' ? 'نسبة الانحراف %' : 'Variance %']: s.variancePct.toFixed(2) + '%'
      }));
      filename = 'Budget_vs_Actual.xlsx';
    } else if (activeReport === 'trial') {
      data = trialBalance.map(i => ({
        [language === 'ar' ? 'كود الحساب' : 'Code']: i.code,
        [language === 'ar' ? 'اسم الحساب' : 'Account Name']: i.name,
        [language === 'ar' ? 'رصيد أول - مدين' : 'Opening Debit']: i.openingDebit,
        [language === 'ar' ? 'رصيد أول - دائن' : 'Opening Credit']: i.openingCredit,
        [language === 'ar' ? 'حركة - مدين' : 'Debit Movements']: i.debitMovements,
        [language === 'ar' ? 'حركة - دائن' : 'Credit Movements']: i.creditMovements,
        [language === 'ar' ? 'رصيد آخر - مدين' : 'Closing Debit']: i.closingDebit,
        [language === 'ar' ? 'رصيد آخر - دائن' : 'Closing Credit']: i.closingCredit
      }));
      filename = 'Analytical_Trial_Balance.xlsx';
    } else if (activeReport === 'time') {
      data = boqItems
        .filter(item => (selectedProjectId === 'all' || item.projectId === selectedProjectId) && (selectedContractId === 'all' || item.contractId === selectedContractId))
        .map(item => {
          const startDate = item.startDate ? new Date(item.startDate) : null;
          const duration = item.expectedDuration || 0;
          const finishDate = startDate ? new Date(startDate.getTime() + duration * 24 * 60 * 60 * 1000) : null;
          const today = new Date();
          const elapsedDays = startDate ? Math.max(0, Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))) : 0;
          
          return {
            [language === 'ar' ? 'البند' : 'Item']: item.itemCode,
            [language === 'ar' ? 'الوصف' : 'Description']: item.description,
            [language === 'ar' ? 'تاريخ البدء' : 'Start Date']: item.startDate || '',
            [language === 'ar' ? 'المدة المتوقعة (يوم)' : 'Expected Duration (Days)']: item.expectedDuration || 0,
            [language === 'ar' ? 'النهاية المتوقعة' : 'Expected Finish']: finishDate ? finishDate.toLocaleDateString() : '',
            [language === 'ar' ? 'الأيام المنقضية' : 'Elapsed Days']: elapsedDays,
            [language === 'ar' ? 'الحالة' : 'Status']: !startDate ? (language === 'ar' ? 'غير مجدول' : 'Not Scheduled') : 
                               (elapsedDays > duration ? (language === 'ar' ? 'متأخر' : 'Delayed') : (language === 'ar' ? 'منتظم' : 'On Track'))
          };
        });
      filename = 'Project_Schedule.xlsx';
    } else {
      data = projectStats;
      filename = 'Project_Overview.xlsx';
    }

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Report");
    XLSX.writeFile(wb, filename);
  };

  const printReport = () => {
    window.print();
  };

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <Loader2 className="animate-spin text-blue-500" size={48} />
        <p className="text-gray-500">{language === 'ar' ? 'جاري إعداد التقارير المالية...' : 'Preparing financial reports...'}</p>
      </div>
    );
  }

  return (
    <div className={cn("p-8 min-h-screen transition-colors print:p-0 print:bg-white print:text-black", theme === 'dark' ? "bg-[#0a0a0a] text-gray-100" : "bg-gray-50 text-gray-900")} dir={dir}>
      {/* Report Header (Visible in Print) */}
      <div className="hidden print:flex justify-between items-center border-b-2 border-gray-900 pb-6 mb-8">
        <div className="flex items-center gap-4">
          <img src={companyInfo.headerLogo} alt="Logo" className="w-16 h-16 rounded-lg object-cover" referrerPolicy="no-referrer" />
          <div>
            <h1 className="text-2xl font-black">{companyInfo.companyName}</h1>
            <p className="text-sm text-gray-600">{companyInfo.address || (language === 'ar' ? 'القاهرة، مصر' : 'Cairo, Egypt')}</p>
            <p className="text-sm text-gray-600">{language === 'ar' ? 'الرقم الضريبي:' : 'Tax ID:'} {companyInfo.taxId}</p>
          </div>
        </div>
        <div className="text-right">
          <h2 className="text-xl font-bold uppercase tracking-widest">
            {activeReport === 'income' ? (language === 'ar' ? 'قائمة الدخل' : 'Income Statement') : 
             activeReport === 'budget' ? (language === 'ar' ? 'مقارنة الميزانية بالتكاليف' : 'Budget vs Actual Report') :
             activeReport === 'trial' ? (language === 'ar' ? 'ميزان المراجعة التحليلي' : 'Analytical Trial Balance') :
             (language === 'ar' ? 'نظرة عامة على المشاريع' : 'Project Overview')}
          </h2>
          <p className="text-sm text-gray-600">{new Date().toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US')}</p>
        </div>
      </div>

      {/* Controls (Hidden in Print) */}
      <header className="mb-8 print:hidden">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">{t('reports')}</h2>
            <p className="text-gray-400 mt-1">{language === 'ar' ? 'تحليلات مالية متقدمة وتقارير أداء المشاريع' : 'Advanced financial analytics and project performance reports'}</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            {/* Project Selector */}
            <div className={cn("flex items-center gap-2 px-4 py-2 rounded-xl border", theme === 'dark' ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200")}>
              <Building2 className="text-blue-500" size={18} />
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="bg-transparent text-sm font-bold outline-none cursor-pointer"
              >
                <option value="all">{language === 'ar' ? 'جميع المشاريع' : 'All Projects'}</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.projectName}</option>
                ))}
              </select>
            </div>

            {/* Contract Selector — visible whenever a project is selected */}
            {selectedProjectId !== 'all' && (
              <div className={cn("flex items-center gap-2 px-4 py-2 rounded-xl border", theme === 'dark' ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200")}>
                <FileText className="text-purple-500" size={18} />
                <select
                  title={language === 'ar' ? 'اختر العقد' : 'Select Contract'}
                  value={selectedContractId}
                  onChange={(e) => setSelectedContractId(e.target.value)}
                  className="bg-transparent text-sm font-bold outline-none cursor-pointer"
                >
                  <option value="all">{language === 'ar' ? 'جميع العقود' : 'All Contracts'}</option>
                  {contracts.map(c => (
                    <option key={c.id} value={c.id}>{c.contractName} — {c.contractNumber}</option>
                  ))}
                </select>
              </div>
            )}

            <button 
              onClick={() => setShowCharts(!showCharts)}
              className={cn("px-4 py-2 rounded-xl font-bold transition-all flex items-center gap-2 border", 
                showCharts ? "bg-blue-600/10 border-blue-600/20 text-blue-500" : "bg-gray-900 border-gray-800 text-gray-400")}
            >
              <BarChart3 size={18} />
              {language === 'ar' ? 'الرسوم البيانية' : 'Charts'}
            </button>
            <button 
              onClick={printReport}
              className="bg-gray-900 border border-gray-800 hover:bg-gray-800 px-4 py-2 rounded-xl font-bold transition-all flex items-center gap-2 text-white"
            >
              <Printer size={18} />
              {language === 'ar' ? 'طباعة' : 'Print'}
            </button>
            <button 
              onClick={exportToExcel}
              className="bg-green-600 hover:bg-green-500 px-4 py-2 rounded-xl font-bold transition-all flex items-center gap-2 shadow-lg shadow-green-900/20 text-white"
            >
              <Download size={18} />
              {language === 'ar' ? 'تصدير Excel' : 'Export Excel'}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 p-1 bg-gray-900/50 border border-gray-800 rounded-2xl w-fit">
          <button 
            onClick={() => setActiveReport('overview')}
            className={cn("px-6 py-2 rounded-xl text-sm font-bold transition-all", activeReport === 'overview' ? "bg-blue-600 text-white shadow-lg" : "text-gray-500 hover:text-gray-300")}
          >
            {language === 'ar' ? 'نظرة عامة' : 'Overview'}
          </button>
          <button 
            onClick={() => setActiveReport('income')}
            className={cn("px-6 py-2 rounded-xl text-sm font-bold transition-all", activeReport === 'income' ? "bg-blue-600 text-white shadow-lg" : "text-gray-500 hover:text-gray-300")}
          >
            {language === 'ar' ? 'قائمة الدخل' : 'Income Statement'}
          </button>
          <button 
            onClick={() => setActiveReport('budget')}
            className={cn("px-6 py-2 rounded-xl text-sm font-bold transition-all", activeReport === 'budget' ? "bg-blue-600 text-white shadow-lg" : "text-gray-500 hover:text-gray-300")}
          >
            {language === 'ar' ? 'الميزانية vs الفعلي' : 'Budget vs Actual'}
          </button>
          <button 
            onClick={() => setActiveReport('balance')}
            className={cn("px-6 py-2 rounded-xl text-sm font-bold transition-all", activeReport === 'balance' ? "bg-blue-600 text-white shadow-lg" : "text-gray-500 hover:text-gray-300")}
          >
            {language === 'ar' ? 'الميزانية العمومية' : 'Balance Sheet'}
          </button>
          <button 
            onClick={() => setActiveReport('trial')}
            className={cn("px-6 py-2 rounded-xl text-sm font-bold transition-all", activeReport === 'trial' ? "bg-blue-600 text-white shadow-lg" : "text-gray-500 hover:text-gray-300")}
          >
            {language === 'ar' ? 'ميزان المراجعة' : 'Trial Balance'}
          </button>
          <button 
            onClick={() => setActiveReport('time')}
            className={cn("px-6 py-2 rounded-xl text-sm font-bold transition-all", activeReport === 'time' ? "bg-blue-600 text-white shadow-lg" : "text-gray-500 hover:text-gray-300")}
          >
            {language === 'ar' ? 'الجدول الزمني' : 'Schedule'}
          </button>
        </div>
      </header>

      {/* Report Content */}
      <div ref={reportRef} className="space-y-8">
        
        {/* Charts Section (Optional) */}
        <AnimatePresence>
          {showCharts && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="grid grid-cols-1 lg:grid-cols-2 gap-8 print:hidden"
            >
              <div className={cn("p-6 border rounded-2xl shadow-xl", theme === 'dark' ? "bg-[#151619] border-gray-800" : "bg-white border-gray-200")}>
                <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
                  <TrendingUp className="text-green-500" size={20} />
                  {activeReport === 'income' ? (language === 'ar' ? 'تحليل الربحية (استحقاق)' : 'Profitability Analysis (Accrual)') : (language === 'ar' ? 'مقارنة الإيرادات بالمصروفات' : 'Revenue vs Spent')}
                </h3>
                <div className="h-[300px] w-full min-h-[300px]">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={50}>
                    <BarChart data={projectStats}>
                      <CartesianGrid strokeDasharray="3 3" stroke={theme === 'dark' ? "#333" : "#eee"} />
                      <XAxis dataKey="name" stroke="#888" fontSize={10} />
                      <YAxis stroke="#888" fontSize={10} />
                      <Tooltip contentStyle={{ backgroundColor: theme === 'dark' ? '#151619' : '#fff', border: 'none', borderRadius: '8px' }} />
                      <Legend />
                      <Bar dataKey="billings" name={language === 'ar' ? 'إيرادات الاستحقاق' : 'Accrued Revenue'} fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="costs" name={language === 'ar' ? 'التكاليف' : 'Costs'} fill="#ef4444" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className={cn("p-6 border rounded-2xl shadow-xl", theme === 'dark' ? "bg-[#151619] border-gray-800" : "bg-white border-gray-200")}>
                <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
                  <PieChartIcon className="text-blue-500" size={20} />
                  {language === 'ar' ? 'توزيع التكاليف حسب المشروع' : 'Cost Distribution by Project'}
                </h3>
                <div className="h-[300px] w-full min-h-[300px]">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={50}>
                    <PieChart>
                      <Pie
                        data={projectStats}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="costs"
                        nameKey="name"
                      >
                        {projectStats.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: theme === 'dark' ? '#151619' : '#fff', border: 'none', borderRadius: '8px' }} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Report Tables */}
        <div className={cn("border rounded-2xl overflow-hidden shadow-2xl print:border-none print:shadow-none", theme === 'dark' ? "bg-[#151619] border-gray-800" : "bg-white border-gray-200")}>
          
          {/* Income Statement View */}
          {activeReport === 'income' && (
            <div className="p-8">
              <div className="flex items-center gap-3 mb-8">
                <Calculator className="text-blue-500" size={32} />
                <h3 className="text-2xl font-black">{language === 'ar' ? 'قائمة الدخل التقديرية للمشاريع' : 'Estimated Project Income Statement'}</h3>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
                <div className={cn("p-6 rounded-2xl border", theme === 'dark' ? "bg-green-900/10 border-green-900/30" : "bg-green-50 border-green-200")}>
                  <p className="text-sm text-gray-500 font-bold uppercase mb-2">{language === 'ar' ? 'إجمالي الإيرادات (أساس الاستحقاق)' : 'Total Revenue (Accrual)'}</p>
                  <p className="text-3xl font-black text-green-500">{totalRevenue.toLocaleString()} <span className="text-sm font-normal">{language === 'ar' ? 'ج.م' : 'EGP'}</span></p>
                </div>
                <div className={cn("p-6 rounded-2xl border", theme === 'dark' ? "bg-red-900/10 border-red-900/30" : "bg-red-50 border-red-200")}>
                  <p className="text-sm text-gray-500 font-bold uppercase mb-2">{language === 'ar' ? 'إجمالي التكاليف المباشرة' : 'Total Direct Costs'}</p>
                  <p className="text-3xl font-black text-red-500">{totalCosts.toLocaleString()} <span className="text-sm font-normal">{language === 'ar' ? 'ج.م' : 'EGP'}</span></p>
                </div>
                <div className={cn("p-6 rounded-2xl border", theme === 'dark' ? "bg-blue-900/10 border-blue-900/30" : "bg-blue-50 border-blue-200")}>
                  <p className="text-sm text-gray-500 font-bold uppercase mb-2">{language === 'ar' ? 'صافي ربح المشاريع' : 'Net Project Profit'}</p>
                  <p className="text-3xl font-black text-blue-500">{totalGrossProfit.toLocaleString()} <span className="text-sm font-normal">{language === 'ar' ? 'ج.م' : 'EGP'}</span></p>
                </div>
              </div>

              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className={cn("border-b-2", theme === 'dark' ? "border-gray-800" : "border-gray-200")}>
                    <th className="px-6 py-4 text-sm font-black text-gray-400 uppercase">{language === 'ar' ? 'المشروع' : 'Project'}</th>
                    <th className="px-6 py-4 text-sm font-black text-gray-400 uppercase">{language === 'ar' ? 'الإيرادات' : 'Revenue'}</th>
                    <th className="px-6 py-4 text-sm font-black text-gray-400 uppercase">{language === 'ar' ? 'التكاليف' : 'Costs'}</th>
                    <th className="px-6 py-4 text-sm font-black text-gray-400 uppercase">{language === 'ar' ? 'الربح' : 'Profit'}</th>
                    <th className="px-6 py-4 text-sm font-black text-gray-400 uppercase">{language === 'ar' ? 'هامش الربح' : 'Margin'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {projectStats.map((stat) => (
                    <tr key={stat.id} className="hover:bg-gray-900/20 transition-colors">
                      <td className="px-6 py-4 font-bold">{stat.name}</td>
                      <td className="px-6 py-4 font-mono">{stat.billings.toLocaleString()}</td>
                      <td className="px-6 py-4 font-mono text-red-400">{stat.costs.toLocaleString()}</td>
                      <td className={cn("px-6 py-4 font-mono font-bold", stat.profit >= 0 ? "text-green-500" : "text-red-500")}>
                        {stat.profit.toLocaleString()}
                      </td>
                      <td className="px-6 py-4">
                        <span className={cn("px-3 py-1 rounded-full text-xs font-bold", stat.profit >= 0 ? "bg-green-900/20 text-green-400" : "bg-red-900/20 text-red-400")}>
                          {((stat.profit / (stat.billings || 1)) * 100).toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Budget vs Actual View */}
          {activeReport === 'budget' && (
            <div className="p-8">
              <div className="flex items-center gap-3 mb-8">
                <BarChart3 className="text-orange-500" size={32} />
                <h3 className="text-2xl font-black">{language === 'ar' ? 'تقرير مقارنة الميزانية بالتكاليف الفعلية' : 'Budget vs Actual Cost Report'}</h3>
              </div>

              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className={cn("border-b-2", theme === 'dark' ? "border-gray-800" : "border-gray-200")}>
                    <th className="px-6 py-4 text-sm font-black text-gray-400 uppercase">{language === 'ar' ? 'المشروع' : 'Project'}</th>
                    <th className="px-6 py-4 text-sm font-black text-gray-400 uppercase">{language === 'ar' ? 'قيمة جداول الكميات' : 'BOQ Value'}</th>
                    <th className="px-6 py-4 text-sm font-black text-gray-400 uppercase">{language === 'ar' ? 'أوامر التغيير' : 'VO Value'}</th>
                    <th className="px-6 py-4 text-sm font-black text-gray-400 uppercase">{language === 'ar' ? 'إجمالي الميزانية' : 'Total Budget'}</th>
                    <th className="px-6 py-4 text-sm font-black text-gray-400 uppercase">{language === 'ar' ? 'التكاليف الفعلية' : 'Actual Costs'}</th>
                    <th className="px-6 py-4 text-sm font-black text-gray-400 uppercase">{language === 'ar' ? 'الانحراف' : 'Variance'}</th>
                    <th className="px-6 py-4 text-sm font-black text-gray-400 uppercase">{language === 'ar' ? 'الحالة' : 'Status'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {projectStats.map((stat) => (
                    <tr key={`stat-budget-${stat.id}`} className="hover:bg-gray-900/20 transition-colors text-sm">
                      <td className="px-6 py-4 font-bold whitespace-nowrap">{stat.name}</td>
                      <td className="px-6 py-4 font-mono">{stat.boqValue.toLocaleString()}</td>
                      <td className="px-6 py-4 font-mono text-orange-400">{stat.voValue.toLocaleString()}</td>
                      <td className="px-6 py-4 font-mono font-bold">{stat.budget.toLocaleString()}</td>
                      <td className="px-6 py-4 font-mono text-blue-400">{stat.costs.toLocaleString()}</td>
                      <td className={cn("px-6 py-4 font-mono font-bold", stat.variance >= 0 ? "text-green-500" : "text-red-500")}>
                        {stat.variance.toLocaleString()}
                        <span className="text-[10px] block font-normal opacity-60">({stat.variancePct.toFixed(1)}%)</span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          {stat.variance >= 0 ? (
                            <ArrowDownRight className="text-green-500" size={16} />
                          ) : (
                            <ArrowUpRight className="text-red-500" size={16} />
                          )}
                          <span className={cn("text-xs font-bold", stat.variance >= 0 ? "text-green-500" : "text-red-500")}>
                            {stat.variance >= 0 ? (language === 'ar' ? 'تحت الميزانية' : 'Under Budget') : (language === 'ar' ? 'تجاوز الميزانية' : 'Over Budget')}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className={cn("border-t-2 font-black", theme === 'dark' ? "bg-gray-900/50 border-gray-800" : "bg-gray-50 border-gray-200")}>
                    <td className="px-6 py-4">{language === 'ar' ? 'الإجمالي' : 'Total'}</td>
                    <td className="px-6 py-4 font-mono">{projectStats.reduce((s, st) => s + st.boqValue, 0).toLocaleString()}</td>
                    <td className="px-6 py-4 font-mono">{projectStats.reduce((s, st) => s + st.voValue, 0).toLocaleString()}</td>
                    <td className="px-6 py-4 font-mono">{totalBudget.toLocaleString()}</td>
                    <td className="px-6 py-4 font-mono">{totalCosts.toLocaleString()}</td>
                    <td className={cn("px-6 py-4 font-mono", (totalBudget - totalCosts) >= 0 ? "text-green-500" : "text-red-500")}>
                      {(totalBudget - totalCosts).toLocaleString()}
                    </td>
                    <td className="px-6 py-4"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Overview View */}
          {activeReport === 'overview' && (
            <div className="p-8">
              <div className="flex items-center gap-3 mb-8">
                <Building2 className="text-blue-500" size={32} />
                <h3 className="text-2xl font-black">{language === 'ar' ? 'نظرة عامة على الأداء المالي للمشاريع' : 'Project Financial Performance Overview'}</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className={cn("p-6 rounded-2xl border", theme === 'dark' ? "bg-gray-900/50 border-gray-800" : "bg-white border-gray-200")}>
                  <p className="text-xs text-gray-500 font-bold uppercase mb-2">{language === 'ar' ? 'إجمالي قيمة المشروع (جداول الكميات)' : 'Total Project Value (BOQ)'}</p>
                  <p className="text-2xl font-black text-blue-500">{projectStats.reduce((s, st) => s + st.boqValue, 0).toLocaleString()}</p>
                </div>
                <div className={cn("p-6 rounded-2xl border", theme === 'dark' ? "bg-gray-900/50 border-gray-800" : "bg-white border-gray-200")}>
                  <p className="text-xs text-gray-500 font-bold uppercase mb-2">{language === 'ar' ? 'إجمالي أوامر التغيير (VO)' : 'Total Variation Orders'}</p>
                  <p className="text-2xl font-black text-orange-500">{projectStats.reduce((s, st) => s + st.voValue, 0).toLocaleString()}</p>
                </div>
                <div className={cn("p-6 rounded-2xl border", theme === 'dark' ? "bg-blue-600/10 border-blue-600/20" : "bg-blue-50 border-blue-200")}>
                  <p className="text-xs text-blue-600 font-bold uppercase mb-2">{language === 'ar' ? 'إجمالي الميزانية العمومية' : 'Total Combined Budget'}</p>
                  <p className="text-2xl font-black text-blue-600">{totalBudget.toLocaleString()}</p>
                </div>
              </div>

              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className={cn("border-b-2", theme === 'dark' ? "border-gray-800" : "border-gray-200")}>
                    <th className="px-6 py-4 text-sm font-black text-gray-400 uppercase">{t('project')}</th>
                    <th className="px-6 py-4 text-sm font-black text-gray-400 uppercase">{language === 'ar' ? 'قيمة جداول الكميات' : 'BOQ Value'}</th>
                    <th className="px-6 py-4 text-sm font-black text-gray-400 uppercase">{language === 'ar' ? 'أوامر التغيير' : 'VO Value'}</th>
                    <th className="px-6 py-4 text-sm font-black text-gray-400 uppercase">{language === 'ar' ? 'إجمالي الميزانية' : 'Total Budget'}</th>
                    <th className="px-6 py-4 text-sm font-black text-gray-400 uppercase">{language === 'ar' ? 'الإيرادات (استحقاق)' : 'Revenue (Accrual)'}</th>
                    <th className="px-6 py-4 text-sm font-black text-gray-400 uppercase">{language === 'ar' ? 'نسبة الإنجاز' : 'Progress'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {projectStats.map((stat) => (
                    <tr key={`stat-progress-${stat.id}`} className="hover:bg-gray-900/20 transition-colors text-sm">
                      <td className="px-6 py-4 font-bold whitespace-nowrap">{stat.name}</td>
                      <td className="px-6 py-4 font-mono">{stat.boqValue.toLocaleString()}</td>
                      <td className="px-6 py-4 font-mono text-orange-400">{stat.voValue.toLocaleString()}</td>
                      <td className="px-6 py-4 font-mono font-bold">{stat.budget.toLocaleString()}</td>
                      <td className="px-6 py-4 font-mono text-green-400">{stat.billings.toLocaleString()}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden min-w-[60px]">
                            <div 
                              className="h-full bg-blue-500 rounded-full" 
                              style={{ width: `${Math.min(stat.progress, 100)}%` }}
                            />
                          </div>
                          <span className="text-xs font-mono font-bold">{stat.progress.toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className={cn("border-t-2 font-black", theme === 'dark' ? "bg-gray-900/50 border-gray-800" : "bg-gray-50 border-gray-200")}>
                    <td className="px-6 py-4">{language === 'ar' ? 'الإجمالي' : 'Total'}</td>
                    <td className="px-6 py-4 font-mono">{projectStats.reduce((s, st) => s + st.boqValue, 0).toLocaleString()}</td>
                    <td className="px-6 py-4 font-mono">{projectStats.reduce((s, st) => s + st.voValue, 0).toLocaleString()}</td>
                    <td className="px-6 py-4 font-mono">{totalBudget.toLocaleString()}</td>
                    <td className="px-6 py-4 font-mono">{totalRevenue.toLocaleString()}</td>
                    <td className="px-6 py-4 font-mono text-blue-500">{(totalBudget > 0 ? (totalRevenue / totalBudget * 100) : 0).toFixed(1)}%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Balance Sheet View */}
          {activeReport === 'balance' && (
            <div className="p-8">
              <div className="flex items-center gap-3 mb-8">
                <Calculator className="text-blue-500" size={32} />
                <h3 className="text-2xl font-black">{language === 'ar' ? 'الميزانية العمومية' : 'Balance Sheet'}</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                {/* Assets */}
                <div className="space-y-6">
                  <h4 className="text-xl font-bold border-b pb-2 text-blue-500">{language === 'ar' ? 'الأصول' : 'Assets'}</h4>
                  <div className="space-y-4">
                    {accounts.filter(a => a.type === 'asset' && !a.isGroup).map(acc => {
                      const balance = transactions.reduce((sum, t) => {
                        const entry = t.entries.find((e: any) => e.accountCode === acc.accountCode);
                        return sum + (entry ? entry.debit - entry.credit : 0);
                      }, 0);
                      return (
                        <div key={`asset-${acc.id}`} className="flex justify-between items-center">
                          <span className="text-gray-400">{acc.accountName}</span>
                          <span className="font-mono font-bold">{balance.toLocaleString()}</span>
                        </div>
                      );
                    })}
                    <div className="pt-4 border-t flex justify-between items-center font-black text-lg">
                      <span>{language === 'ar' ? 'إجمالي الأصول' : 'Total Assets'}</span>
                      <span className="text-blue-500">
                        {accounts.filter(a => a.type === 'asset' && !a.isGroup).reduce((total, acc) => {
                          return total + transactions.reduce((sum, t) => {
                            const entry = t.entries.find((e: any) => e.accountCode === acc.accountCode);
                            return sum + (entry ? entry.debit - entry.credit : 0);
                          }, 0);
                        }, 0).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Liabilities & Equity */}
                <div className="space-y-12">
                  <div className="space-y-6">
                    <h4 className="text-xl font-bold border-b pb-2 text-red-500">{language === 'ar' ? 'الخصوم' : 'Liabilities'}</h4>
                    <div className="space-y-4">
                      {accounts.filter(a => a.type === 'liability' && !a.isGroup).map(acc => {
                        const balance = transactions.reduce((sum, t) => {
                          const entry = t.entries.find((e: any) => e.accountCode === acc.accountCode);
                          return sum + (entry ? entry.credit - entry.debit : 0);
                        }, 0);
                        return (
                          <div key={`liab-${acc.id}`} className="flex justify-between items-center">
                            <span className="text-gray-400">{acc.accountName}</span>
                            <span className="font-mono font-bold">{balance.toLocaleString()}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-6">
                    <h4 className="text-xl font-bold border-b pb-2 text-green-500">{language === 'ar' ? 'حقوق الملكية' : 'Equity'}</h4>
                    <div className="space-y-4">
                      {accounts.filter(a => a.type === 'equity' && !a.isGroup).map(acc => {
                        const balance = transactions.reduce((sum, t) => {
                          const entry = t.entries.find((e: any) => e.accountCode === acc.accountCode);
                          return sum + (entry ? entry.credit - entry.debit : 0);
                        }, 0);
                        return (
                          <div key={`equity-${acc.id}`} className="flex justify-between items-center">
                            <span className="text-gray-400">{acc.accountName}</span>
                            <span className="font-mono font-bold">{balance.toLocaleString()}</span>
                          </div>
                        );
                      })}
                      {/* Net Income */}
                      <div className="flex justify-between items-center italic text-gray-400">
                        <span>{language === 'ar' ? 'صافي الدخل (الفترة الحالية)' : 'Net Income (Current Period)'}</span>
                        <span className="font-mono">{totalGrossProfit.toLocaleString()}</span>
                      </div>
                      <div className="pt-4 border-t flex justify-between items-center font-black text-lg">
                        <span>{language === 'ar' ? 'إجمالي الخصوم وحقوق الملكية' : 'Total Liabilities & Equity'}</span>
                        <span className="text-green-500">
                          {(
                            accounts.filter(a => (a.type === 'liability' || a.type === 'equity') && !a.isGroup).reduce((total, acc) => {
                              return total + transactions.reduce((sum, t) => {
                                const entry = t.entries.find((e: any) => e.accountCode === acc.accountCode);
                                return sum + (entry ? entry.credit - entry.debit : 0);
                              }, 0);
                            }, 0) + totalGrossProfit
                          ).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Analytical Trial Balance View */}
          {activeReport === 'trial' && (
            <div className="p-8">
              <div className="flex items-center gap-3 mb-8">
                <BarChart3 className="text-blue-500" size={32} />
                <h3 className="text-2xl font-black">{language === 'ar' ? 'ميزان المراجعة التحليلي' : 'Analytical Trial Balance'}</h3>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-right border-collapse border border-gray-800">
                  <thead>
                    <tr className={cn("border-b-2 bg-gray-900/10", theme === 'dark' ? "border-gray-800" : "border-gray-200")}>
                      <th rowSpan={2} className="px-4 py-3 text-sm font-black text-gray-400 uppercase border border-gray-800">{language === 'ar' ? 'كود الحساب' : 'Code'}</th>
                      <th rowSpan={2} className="px-4 py-3 text-sm font-black text-gray-400 uppercase border border-gray-800">{language === 'ar' ? 'اسم الحساب' : 'Account Name'}</th>
                      <th colSpan={2} className="px-4 py-3 text-sm font-black text-gray-400 uppercase border border-gray-800 text-center">{language === 'ar' ? 'الأرصدة الافتتاحية' : 'Opening Balances'}</th>
                      <th colSpan={2} className="px-4 py-3 text-sm font-black text-gray-400 uppercase border border-gray-800 text-center">{language === 'ar' ? 'الحركة خلال الفترة' : 'Movements'}</th>
                      <th colSpan={2} className="px-4 py-3 text-sm font-black text-gray-400 uppercase border border-gray-800 text-center">{language === 'ar' ? 'الأرصدة الختامية' : 'Closing Balances'}</th>
                    </tr>
                    <tr className={cn("border-b-2", theme === 'dark' ? "border-gray-800" : "border-gray-200")}>
                      <th className="px-4 py-2 text-xs font-bold text-gray-500 border border-gray-800">{language === 'ar' ? 'مدين' : 'Debit'}</th>
                      <th className="px-4 py-2 text-xs font-bold text-gray-500 border border-gray-800">{language === 'ar' ? 'دائن' : 'Credit'}</th>
                      <th className="px-4 py-2 text-xs font-bold text-gray-500 border border-gray-800">{language === 'ar' ? 'مدين' : 'Debit'}</th>
                      <th className="px-4 py-2 text-xs font-bold text-gray-500 border border-gray-800">{language === 'ar' ? 'دائن' : 'Credit'}</th>
                      <th className="px-4 py-2 text-xs font-bold text-gray-500 border border-gray-800">{language === 'ar' ? 'مدين' : 'Debit'}</th>
                      <th className="px-4 py-2 text-xs font-bold text-gray-500 border border-gray-800">{language === 'ar' ? 'دائن' : 'Credit'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trialBalance.map((item) => (
                      <tr key={item.code} className={cn("border-b transition-colors", theme === 'dark' ? "border-gray-800 hover:bg-white/5" : "border-gray-100 hover:bg-gray-50")}>
                        <td className="px-4 py-3 font-mono text-sm border border-gray-800">{item.code}</td>
                        <td className="px-4 py-3 font-bold border border-gray-800">{item.name}</td>
                        <td className="px-4 py-3 font-mono text-sm border border-gray-800 text-center">{item.openingDebit > 0 ? item.openingDebit.toLocaleString() : '-'}</td>
                        <td className="px-4 py-3 font-mono text-sm border border-gray-800 text-center">{item.openingCredit > 0 ? item.openingCredit.toLocaleString() : '-'}</td>
                        <td className="px-4 py-3 font-mono text-sm border border-gray-800 text-center text-blue-400">{item.debitMovements > 0 ? item.debitMovements.toLocaleString() : '-'}</td>
                        <td className="px-4 py-3 font-mono text-sm border border-gray-800 text-center text-red-400">{item.creditMovements > 0 ? item.creditMovements.toLocaleString() : '-'}</td>
                        <td className="px-4 py-3 font-mono text-sm border border-gray-800 text-center font-bold text-blue-500">{item.closingDebit > 0 ? item.closingDebit.toLocaleString() : '-'}</td>
                        <td className="px-4 py-3 font-mono text-sm border border-gray-800 text-center font-bold text-red-500">{item.closingCredit > 0 ? item.closingCredit.toLocaleString() : '-'}</td>
                      </tr>
                    ))}
                    <tr className="bg-blue-600/5 font-black">
                      <td colSpan={2} className="px-4 py-4 text-center border border-gray-800 uppercase tracking-wider">{language === 'ar' ? 'الإجمالي العام' : 'GRAND TOTAL'}</td>
                      <td className="px-4 py-4 font-mono border border-gray-800 text-center">{trialBalanceTotals.opDebit.toLocaleString()}</td>
                      <td className="px-4 py-4 font-mono border border-gray-800 text-center">{trialBalanceTotals.opCredit.toLocaleString()}</td>
                      <td className="px-4 py-4 font-mono border border-gray-800 text-center text-blue-500">{trialBalanceTotals.movDebit.toLocaleString()}</td>
                      <td className="px-4 py-4 font-mono border border-gray-800 text-center text-red-500">{trialBalanceTotals.movCredit.toLocaleString()}</td>
                      <td className="px-4 py-4 font-mono border border-gray-800 text-center text-blue-500">{trialBalanceTotals.clDebit.toLocaleString()}</td>
                      <td className="px-4 py-4 font-mono border border-gray-800 text-center text-red-500">{trialBalanceTotals.clCredit.toLocaleString()}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              
              <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Balance Check Analysis */}
                <div className={cn("p-6 rounded-2xl border", theme === 'dark' ? "bg-gray-900/50 border-gray-800" : "bg-white border-gray-200")}>
                  <h4 className="text-lg font-bold mb-4 flex items-center gap-2">
                    <Calculator className="text-blue-500" size={20} />
                    {language === 'ar' ? 'التحليل المحاسبي للاتزان' : 'Accounting Balance Analysis'}
                  </h4>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-400">{language === 'ar' ? 'إجمالي الحركات المدينة' : 'Total Debit Movements'}</span>
                      <span className="font-mono font-bold text-blue-500">{trialBalanceTotals.movDebit.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-400">{language === 'ar' ? 'إجمالي الحركات الدائنة' : 'Total Credit Movements'}</span>
                      <span className="font-mono font-bold text-red-500">{trialBalanceTotals.movCredit.toLocaleString()}</span>
                    </div>
                    <div className={cn("pt-4 border-t flex justify-between items-center font-black", 
                      Math.abs(trialBalanceTotals.movDebit - trialBalanceTotals.movCredit) < 0.1 ? "text-green-500" : "text-red-500"
                    )}>
                      <span>{language === 'ar' ? 'الفرق (يجب أن يكون صفراً)' : 'Difference (Must be Zero)'}</span>
                      <span className="font-mono">{(trialBalanceTotals.movDebit - trialBalanceTotals.movCredit).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                </div>

                {/* Account Type Summary */}
                <div className={cn("p-6 rounded-2xl border", theme === 'dark' ? "bg-gray-900/50 border-gray-800" : "bg-white border-gray-200")}>
                  <h4 className="text-lg font-bold mb-4 flex items-center gap-2">
                    <TrendingUp className="text-green-500" size={20} />
                    {language === 'ar' ? 'تحليل طبيعة الحسابات' : 'Account Type Analysis'}
                  </h4>
                  <div className="space-y-3">
                    {['asset', 'liability', 'equity', 'revenue', 'expense'].map(type => {
                      const typeAccounts = accounts.filter(a => a.type === type);
                      const typeTotal = trialBalance
                        .filter(i => typeAccounts.some(ta => (ta.accountCode || ta.code) === i.code))
                        .reduce((sum, i) => sum + (i.closingDebit - i.closingCredit), 0);
                      
                      const labelAr = type === 'asset' ? 'الأصول' : type === 'liability' ? 'الخصوم' : type === 'equity' ? 'حقوق الملكية' : type === 'revenue' ? 'الإيرادات' : 'المصروفات';
                      const labelEn = type.charAt(0).toUpperCase() + type.slice(1) + 's';

                      return (
                        <div key={type} className="flex justify-between items-center text-sm">
                          <span className="text-gray-400">{language === 'ar' ? labelAr : labelEn}</span>
                          <span className={cn("font-mono font-bold", typeTotal >= 0 ? "text-blue-500" : "text-red-500")}>
                            {Math.abs(typeTotal).toLocaleString()} 
                            <span className="text-[10px] ml-1 opacity-50 uppercase tracking-tighter">
                              {typeTotal >= 0 ? (language === 'ar' ? 'مدين' : 'DR') : (language === 'ar' ? 'دائن' : 'CR')}
                            </span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="mt-8 flex justify-end items-center gap-4">
                <div className={cn("px-6 py-3 rounded-xl border flex items-center gap-3", 
                  Math.abs(trialBalanceTotals.movDebit - trialBalanceTotals.movCredit) < 0.1 ? "bg-green-900/10 border-green-900/30 text-green-500" : "bg-red-900/10 border-red-900/30 text-red-500"
                )}>
                  <div className={cn("w-3 h-3 rounded-full animate-pulse", Math.abs(trialBalanceTotals.movDebit - trialBalanceTotals.movCredit) < 0.1 ? "bg-green-500" : "bg-red-500")}></div>
                  <span className="font-bold uppercase tracking-widest text-sm">
                    {Math.abs(trialBalanceTotals.movDebit - trialBalanceTotals.movCredit) < 0.1 ? 
                      (language === 'ar' ? 'الميزان متزن تماماً' : 'Ledger is Perfectly Balanced') : 
                      (language === 'ar' ? 'يوجد فرق في الاتزان' : 'Ledger Out of Balance')}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Time & Schedule View */}
          {activeReport === 'time' && (
            <div className="p-8">
              <div className="flex items-center gap-3 mb-8">
                <Clock className="text-purple-500" size={32} />
                <h3 className="text-2xl font-black">{language === 'ar' ? 'تقرير الانحراف الزمني والجدول الزمني' : 'Schedule & Time Variance Report'}</h3>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-right border-collapse">
                  <thead>
                    <tr className={cn("border-b-2", theme === 'dark' ? "border-gray-800" : "border-gray-200")}>
                      <th className="px-4 py-4 text-sm font-black text-gray-400 uppercase">{language === 'ar' ? 'البند' : 'Item'}</th>
                      <th className="px-4 py-4 text-sm font-black text-gray-400 uppercase">{language === 'ar' ? 'البدء' : 'Start'}</th>
                      <th className="px-4 py-4 text-sm font-black text-gray-400 uppercase">{language === 'ar' ? 'المدة (يوم)' : 'Duration'}</th>
                      <th className="px-4 py-4 text-sm font-black text-gray-400 uppercase">{language === 'ar' ? 'نهاية متوقعة' : 'Exp. Finish'}</th>
                      <th className="px-4 py-4 text-sm font-black text-gray-400 uppercase">{language === 'ar' ? 'الوقت المنقضي' : 'Elapsed'}</th>
                      <th className="px-4 py-4 text-sm font-black text-gray-400 uppercase">{language === 'ar' ? 'الحالة الزمنية' : 'Schedule Status'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/50">
                    {boqItems
                      .filter(item => (selectedProjectId === 'all' || item.projectId === selectedProjectId) && (selectedContractId === 'all' || item.contractId === selectedContractId))
                      .map((item) => {
                        const executedQty = boqProgressMap[item.id] || 0;
                        const progressPct = item.tenderQty > 0 ? (executedQty / item.tenderQty) * 100 : 0;
                        const isCompleted = !!item.actualEndDate || progressPct >= 99.9;

                        const startDate = item.startDate ? new Date(item.startDate + 'T00:00:00') : null;
                        const duration = item.expectedDuration || 0;
                        const finishDate = item.actualEndDate
                          ? new Date(item.actualEndDate + 'T00:00:00')
                          : startDate && duration ? new Date(startDate.getTime() + duration * 86400000) : null;

                        const today = new Date();
                        const elapsedDays = startDate ? Math.max(0, Math.floor((today.getTime() - startDate.getTime()) / 86400000)) : 0;
                        const timeProgress = duration > 0 ? (elapsedDays / duration) * 100 : 0;

                        return (
                          <tr key={item.id} className="hover:bg-gray-900/20 transition-colors text-sm">
                            <td className="px-4 py-4">
                              <span className="font-bold block">{item.itemCode}</span>
                              <span className="text-xs text-gray-500 line-clamp-1">{item.description}</span>
                            </td>
                            <td className="px-4 py-4 font-mono">{item.startDate || '-'}</td>
                            <td className="px-4 py-4 font-mono">{duration || '-'}</td>
                            <td className={cn("px-4 py-4 font-mono", isCompleted ? "text-green-400" : "text-blue-400")}>
                              {finishDate ? finishDate.toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US') : '-'}
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden min-w-[60px]">
                                  <div
                                    className={cn("h-full rounded-full", isCompleted ? "bg-green-500" : timeProgress > 100 ? "bg-red-500" : "bg-purple-500")}
                                    style={{ width: `${Math.min(isCompleted ? 100 : timeProgress, 100)}%` }}
                                  />
                                </div>
                                <span className="text-[10px] font-mono">
                                  {isCompleted ? `${progressPct.toFixed(0)}%` : `${elapsedDays} ${language === 'ar' ? 'يوم' : 'd'}`}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              {isCompleted ? (
                                <span className="px-2 py-1 rounded-md text-[10px] font-bold uppercase bg-green-900/20 text-green-500">
                                  {language === 'ar' ? 'مكتمل' : 'Completed'}
                                </span>
                              ) : !startDate ? (
                                <span className="text-gray-600 text-[10px]">{language === 'ar' ? 'غير مجدول' : 'Not Scheduled'}</span>
                              ) : timeProgress > 100 ? (
                                <span className="px-2 py-1 rounded-md text-[10px] font-bold uppercase bg-red-900/20 text-red-500">
                                  {language === 'ar' ? 'متأخر' : 'Overdue'}
                                </span>
                              ) : timeProgress > 80 ? (
                                <span className="px-2 py-1 rounded-md text-[10px] font-bold uppercase bg-orange-900/20 text-orange-500">
                                  {language === 'ar' ? 'أوشك على الانتهاء' : 'Near Finish'}
                                </span>
                              ) : (
                                <span className="px-2 py-1 rounded-md text-[10px] font-bold uppercase bg-blue-900/20 text-blue-500">
                                  {language === 'ar' ? 'قيد التنفيذ' : 'On Track'}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer (Visible in Print) */}
      <div className="hidden print:block mt-12 pt-6 border-t border-gray-300 text-center text-xs text-gray-500">
        <p>{companyInfo.companyName} - {language === 'ar' ? 'نظام إدارة التكاليف - جميع الحقوق محفوظة © 2024' : 'Cost Management System - All Rights Reserved © 2024'}</p>
        <p className="mt-1">{language === 'ar' ? 'تم استخراج هذا التقرير آلياً' : 'This report was generated automatically'}</p>
      </div>

      {/* Print Styles */}
      <style>{`
        @media print {
          body {
            background: white !important;
            color: black !important;
          }
          .print\\:hidden {
            display: none !important;
          }
          .print\\:block {
            display: block !important;
          }
          .print\\:flex {
            display: flex !important;
          }
          .print\\:p-0 {
            padding: 0 !important;
          }
          .print\\:border-none {
            border: none !important;
          }
          .print\\:shadow-none {
            box-shadow: none !important;
          }
          table {
            width: 100% !important;
            border-collapse: collapse !important;
          }
          th, td {
            border: 1px solid #eee !important;
            padding: 12px !important;
          }
          @page {
            margin: 2cm;
          }
        }
      `}</style>
    </div>
  );
}
