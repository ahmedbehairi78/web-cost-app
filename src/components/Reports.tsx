import React, { useState, useEffect, useRef } from 'react';
import { collection, onSnapshot, query, orderBy, doc, getDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useLanguage } from '../context/LanguageContext';
import * as XLSX from 'xlsx';
import { JournalEntry } from '../services/accountingService';
import { SearchableSelect } from './ui/SearchableSelect';
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
  netPayable: number;
  worksValueExVat?: number;
  status: string;
  date: string | { toDate(): Date } | Date;
}

interface BOQItem {
  id: string;
  projectId: string;
  tenderAmount: number;
  startDate?: string;
  expectedDuration?: number;
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
  const [periodStart, setPeriodStart] = useState(() => `${new Date().getFullYear()}-01-01`);
  
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
        setCompanyInfo(settingsDoc.data() as typeof companyInfo);
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

  // Data Processing
  const filteredProjects = selectedProjectId === 'all' 
    ? projects 
    : projects.filter(p => p.id === selectedProjectId);

  const projectStats = filteredProjects.map(p => {
    // Costs from General Ledger (transactions) - includes ActualCosts, Purchases, and manual JVs
    // We sum all accounts starting with '5' (Expenses) associated with this project
    const ledgerCosts = transactions
      .filter(t => t.projectId === p.id)
      .reduce((sum, t) => {
        const expenseEntries = (t.entries || []).filter((e: JournalEntry) =>
          e.accountCode.startsWith('5')
        );
        return sum + expenseEntries.reduce((s: number, e: JournalEntry) => s + (e.debit - e.credit), 0);
      }, 0);

    // Billings/Revenues (Accrual Basis: using gross works value before deductions)
    const projectRevenue = billings
      .filter(b => b.projectId === p.id && b.status !== 'draft')
      .reduce((sum, b) => sum + (b.worksValueExVat || 0), 0);
    
    // Automatically calculate BOQ Value from BOQ Items if they exist, otherwise fallback to project field
    const calculatedBoqValue = boqItems
      .filter(item => item.projectId === p.id)
      .reduce((sum, item) => sum + (item.tenderAmount || 0), 0);

    const boqValue = calculatedBoqValue > 0 ? calculatedBoqValue : (p.boqValue || 0);
    const voValue = p.voValue || 0;
    const budget = (boqValue + voValue) || p.totalContractValue || 0;
    
    return {
      id: p.id,
      name: p.projectName,
      budget,
      boqValue,
      voValue,
      costs: ledgerCosts,
      billings: projectRevenue,
      profit: projectRevenue - ledgerCosts,
      variance: budget - ledgerCosts,
      variancePct: budget > 0 ? ((budget - ledgerCosts) / budget) * 100 : 0,
      progress: budget > 0 ? (projectRevenue / budget) * 100 : 0
    };
  });

  const totalRevenue = projectStats.reduce((sum, s) => sum + s.billings, 0);
  const totalCosts = projectStats.reduce((sum, s) => sum + s.costs, 0);
  const totalGrossProfit = totalRevenue - totalCosts;
  const totalBudget = projectStats.reduce((sum, s) => sum + s.budget, 0);

  // Analytical Trial Balance Calculation
  const trialBalance = React.useMemo(() => {
    // 1. Get all unique account codes from COA and Transactions
    const coaCodes = accounts.map(a => a.accountCode || a.code).filter(Boolean);
    const allTx = transactions.filter(t => !t.isDeleted && (selectedProjectId === 'all' || t.projectId === selectedProjectId));
    const txCodes = allTx
      .flatMap(t => (t.entries || []))
      .map(e => e.accountCode)
      .filter(Boolean);
    
    const allUniqueCodes = Array.from(new Set([...coaCodes, ...txCodes]));

    // 2. Split transactions into before-period (opening) and in-period (movements)
    const beforePeriodTx = allTx.filter(t => t.date < periodStart);
    const inPeriodTx     = allTx.filter(t => t.date >= periodStart);

    // 3. Map data for each code
    const list = allUniqueCodes.map(code => {
      const coaAcc = accounts.find(a => (a.accountCode || a.code) === code);
      const name = coaAcc
        ? (language === 'ar'
            ? (coaAcc.accountName || coaAcc.nameAr || code)
            : (coaAcc.accountNameEn || coaAcc.accountName || coaAcc.nameEn || code))
        : (language === 'ar' ? `حساب غير معرف (${code})` : `Undefined Account (${code})`);

      const entriesBefore = beforePeriodTx.flatMap(t => (t.entries || [])).filter(e => e.accountCode === code);
      const entriesIn     = inPeriodTx.flatMap(t => (t.entries || [])).filter(e => e.accountCode === code);

      const openingNet    = entriesBefore.reduce((s, e) => s + (Number(e.debit) || 0) - (Number(e.credit) || 0), 0);
      const openingDebit  = openingNet > 0 ? openingNet : 0;
      const openingCredit = openingNet < 0 ? Math.abs(openingNet) : 0;

      const debitMovements  = entriesIn.reduce((s, e) => s + (Number(e.debit)  || 0), 0);
      const creditMovements = entriesIn.reduce((s, e) => s + (Number(e.credit) || 0), 0);

      const closingNet    = openingNet + debitMovements - creditMovements;
      const closingDebit  = closingNet > 0 ? closingNet : 0;
      const closingCredit = closingNet < 0 ? Math.abs(closingNet) : 0;

      return { code, name, openingDebit, openingCredit, debitMovements, creditMovements, closingDebit, closingCredit };
    })
    .filter(item => item.openingDebit !== 0 || item.openingCredit !== 0 || item.debitMovements !== 0 || item.creditMovements !== 0)
    .sort((a, b) => a.code.localeCompare(b.code));

    return list;
  }, [accounts, transactions, language, selectedProjectId, periodStart]);

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

  // GL-based P&L — filtered by selected project, grouped by account prefix
  const glPnL = React.useMemo(() => {
    const tx = transactions.filter(
      t => !t.isDeleted && (selectedProjectId === 'all' || t.projectId === selectedProjectId)
    );

    const sumByPrefix = (prefix: string, nature: 'debit' | 'credit') =>
      tx.reduce((sum, t) =>
        sum + (t.entries || [])
          .filter((e: JournalEntry) => e.accountCode.startsWith(prefix))
          .reduce((s: number, e: JournalEntry) =>
            nature === 'debit' ? s + (e.debit - e.credit) : s + (e.credit - e.debit), 0),
        0);

    // Per leaf-account balances for detail lines
    const leafBalances: Record<string, number> = {};
    accounts
      .filter(a => !a.isGroup && /^[45]/.test(a.accountCode || ''))
      .forEach(acc => {
        const code = acc.accountCode || '';
        leafBalances[code] = tx.reduce((sum, t) => {
          const entry = (t.entries || []).find((e: JournalEntry) => e.accountCode === code);
          return sum + (entry ? entry.debit - entry.credit : 0);
        }, 0);
      });

    const revenue = sumByPrefix('4', 'credit');
    const cogs    = sumByPrefix('51', 'debit');
    const opex    = sumByPrefix('52', 'debit');
    const finex   = sumByPrefix('53', 'debit');
    const gross   = revenue - cogs;
    const ebit    = gross - opex;
    const net     = ebit - finex;
    return { revenue, cogs, opex, finex, gross, ebit, net, leafBalances };
  }, [transactions, accounts, selectedProjectId]);

  // Balance sheet account balances — always company-wide (not project-filtered)
  const balanceSheet = React.useMemo(() => {
    const allTx = transactions.filter(t => !t.isDeleted);

    const accBal = (code: string, nature: 'debit' | 'credit') => {
      const net = allTx.reduce((sum, t) => {
        const entry = (t.entries || []).find((e: JournalEntry) => e.accountCode === code);
        return sum + (entry ? entry.debit - entry.credit : 0);
      }, 0);
      return nature === 'debit' ? net : -net;
    };

    const sectionBal = (prefix: string, nature: 'debit' | 'credit') =>
      accounts
        .filter(a => !a.isGroup && (a.accountCode || '').startsWith(prefix) && a.status !== 'disabled')
        .reduce((sum, acc) => sum + accBal(acc.accountCode || '', nature), 0);

    // All-transactions net profit for equity section
    const allRevenue = transactions.filter(t => !t.isDeleted).reduce((sum, t) =>
      sum + (t.entries || []).filter((e: JournalEntry) => e.accountCode.startsWith('4'))
        .reduce((s: number, e: JournalEntry) => s + (e.credit - e.debit), 0), 0);
    const allCosts = transactions.filter(t => !t.isDeleted).reduce((sum, t) =>
      sum + (t.entries || []).filter((e: JournalEntry) => e.accountCode.startsWith('5'))
        .reduce((s: number, e: JournalEntry) => s + (e.debit - e.credit), 0), 0);
    const netProfitForBS = allRevenue - allCosts;

    const currentAssets    = sectionBal('11', 'debit');
    const nonCurrentAssets = sectionBal('12', 'debit');
    const totalAssets      = currentAssets + nonCurrentAssets;
    const currentLiab      = sectionBal('21', 'credit');
    const nonCurrentLiab   = sectionBal('22', 'credit');
    const totalLiab        = currentLiab + nonCurrentLiab;
    const equityAccounts   = sectionBal('3', 'credit');
    const totalEquity      = equityAccounts + netProfitForBS;
    const totalLE          = totalLiab + totalEquity;

    return {
      currentAssets, nonCurrentAssets, totalAssets,
      currentLiab, nonCurrentLiab, totalLiab,
      equityAccounts, netProfitForBS, totalEquity, totalLE,
      isBalanced: Math.abs(totalAssets - totalLE) < 1,
      accBal, sectionBal,
    };
  }, [transactions, accounts]);

  const exportToExcel = () => {
    let data: Record<string, unknown>[] = [];
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
        .filter(item => selectedProjectId === 'all' || item.projectId === selectedProjectId)
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
            <div className="flex items-center gap-2">
              <Building2 className="text-blue-500 shrink-0" size={18} />
              <SearchableSelect
                value={selectedProjectId}
                onChange={setSelectedProjectId}
                theme={theme}
                dir={dir}
                className="w-56"
                placeholder={language === 'ar' ? 'جميع المشاريع' : 'All Projects'}
                options={[
                  { value: 'all', label: language === 'ar' ? 'جميع المشاريع' : 'All Projects' },
                  ...projects.map(p => ({ value: p.id, label: p.projectName })),
                ]}
              />
            </div>

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
          {activeReport === 'income' && (() => {
            const baseRevenue = glPnL.revenue || totalRevenue;
            const pct = (v: number) => baseRevenue > 0 ? ((v / baseRevenue) * 100).toFixed(1) + '%' : '—';
            const fmt = (v: number, cost = false) =>
              v === 0 ? '—' : cost ? `(${Math.abs(v).toLocaleString()})` : v.toLocaleString();

            // Rows of leaf accounts for a given prefix
            const leafRows = (prefix: string, isCost: boolean) =>
              accounts
                .filter(a => !a.isGroup && (a.accountCode || '').startsWith(prefix))
                .map(acc => {
                  const bal = glPnL.leafBalances[acc.accountCode] || 0;
                  if (bal === 0) return null;
                  return (
                    <div key={acc.id} className={cn('flex justify-between items-center px-8 py-2 border-b text-sm', theme === 'dark' ? 'border-gray-800/30 hover:bg-white/[0.02]' : 'border-gray-100 hover:bg-gray-50/60')}>
                      <span className={cn('ps-4', theme === 'dark' ? 'text-gray-400' : 'text-gray-500')}>{acc.accountName}</span>
                      <span className={cn('font-mono tabular-nums', isCost ? 'text-red-400' : 'text-emerald-400')}>{fmt(bal, isCost)}</span>
                    </div>
                  );
                });

            const SectionHeader = ({ label, color }: { label: string; color: string }) => (
              <div className={cn('px-6 py-2.5 border-b font-black text-xs uppercase tracking-widest flex items-center gap-2', color)}>
                {label}
              </div>
            );
            const SubHeader = ({ label }: { label: string }) => (
              <div className={cn('px-8 py-1.5 border-b text-[11px] font-bold uppercase tracking-wider text-gray-500 ps-12', theme === 'dark' ? 'border-gray-800/30 bg-gray-900/20' : 'border-gray-100 bg-gray-50/50')}>
                ▸ {label}
              </div>
            );
            const TotalRow = ({ label, value, color }: { label: string; value: string; color: string }) => (
              <div className={cn('flex justify-between items-center px-6 py-3 font-bold border-b text-sm', theme === 'dark' ? 'bg-gray-900/30 border-gray-800' : 'bg-gray-50 border-gray-200')}>
                <span>{label}</span>
                <span className={cn('font-mono tabular-nums', color)}>{value}</span>
              </div>
            );
            const ProfitRow = ({ label, sub, value, pctVal, color, borderColor, bg }: { label: string; sub: string; value: number; pctVal: string; color: string; borderColor: string; bg: string }) => (
              <div className={cn('flex justify-between items-center px-6 py-4 font-black border-b-4', bg, borderColor)}>
                <div className="flex items-center gap-3">
                  <span className={cn('text-base', color)}>{label}</span>
                  <span className="text-xs font-normal opacity-50">{sub}</span>
                </div>
                <div className="text-end">
                  <div className={cn('font-mono tabular-nums text-lg', color)}>{value.toLocaleString()}</div>
                  <div className="text-xs font-normal opacity-50">{pctVal} {language === 'ar' ? 'هامش' : 'margin'}</div>
                </div>
              </div>
            );

            const has511 = accounts.some(a => !a.isGroup && (a.accountCode || '').startsWith('511') && (glPnL.leafBalances[a.accountCode] || 0) !== 0);
            const has512 = accounts.some(a => !a.isGroup && (a.accountCode || '').startsWith('512') && (glPnL.leafBalances[a.accountCode] || 0) !== 0);
            const has521 = accounts.some(a => !a.isGroup && (a.accountCode || '').startsWith('521') && (glPnL.leafBalances[a.accountCode] || 0) !== 0);
            const has522 = accounts.some(a => !a.isGroup && (a.accountCode || '').startsWith('522') && (glPnL.leafBalances[a.accountCode] || 0) !== 0);
            const has531 = accounts.some(a => !a.isGroup && (a.accountCode || '').startsWith('531') && (glPnL.leafBalances[a.accountCode] || 0) !== 0);

            return (
              <div className="p-8" dir={dir}>
                {/* Title */}
                <div className="text-center mb-8">
                  <h3 className="text-2xl font-black">{language === 'ar' ? 'قائمة الدخل' : 'Income Statement'}</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {language === 'ar' ? 'للفترة المنتهية في ' : 'For the period ending '}
                    {new Date().toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US')}
                  </p>
                  {selectedProjectId !== 'all' && (
                    <span className="mt-2 inline-block px-3 py-1 text-xs font-bold rounded-full bg-blue-600/10 text-blue-400 border border-blue-600/20">
                      {projects.find(p => p.id === selectedProjectId)?.projectName}
                    </span>
                  )}
                </div>

                {/* KPI Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                  {[
                    { label: language === 'ar' ? 'مجموع الإيرادات'   : 'Total Revenue',    value: baseRevenue,   color: 'text-emerald-500', bg: theme === 'dark' ? 'bg-emerald-900/10 border-emerald-900/30' : 'bg-emerald-50 border-emerald-200' },
                    { label: language === 'ar' ? 'مجمل الربح'        : 'Gross Profit',      value: glPnL.gross,   color: glPnL.gross  >= 0 ? 'text-blue-500'   : 'text-red-500', bg: glPnL.gross  >= 0 ? (theme === 'dark' ? 'bg-blue-900/10 border-blue-900/30'     : 'bg-blue-50 border-blue-200')     : (theme === 'dark' ? 'bg-red-900/10 border-red-900/30'   : 'bg-red-50 border-red-200'),   pct: pct(glPnL.gross)  },
                    { label: language === 'ar' ? 'ربح التشغيل (EBIT)': 'Operating Profit',  value: glPnL.ebit,    color: glPnL.ebit   >= 0 ? 'text-violet-500' : 'text-red-500', bg: glPnL.ebit   >= 0 ? (theme === 'dark' ? 'bg-violet-900/10 border-violet-900/30' : 'bg-violet-50 border-violet-200') : (theme === 'dark' ? 'bg-red-900/10 border-red-900/30'   : 'bg-red-50 border-red-200'),   pct: pct(glPnL.ebit)   },
                    { label: language === 'ar' ? 'صافي الربح'        : 'Net Profit',        value: glPnL.net,     color: glPnL.net    >= 0 ? 'text-amber-500' : 'text-red-500', bg: glPnL.net    >= 0 ? (theme === 'dark' ? 'bg-amber-900/10 border-amber-900/30'   : 'bg-amber-50 border-amber-200')   : (theme === 'dark' ? 'bg-red-900/10 border-red-900/30'   : 'bg-red-50 border-red-200'),   pct: pct(glPnL.net)    },
                  ].map((k, i) => (
                    <div key={i} className={cn('p-5 rounded-2xl border', k.bg)}>
                      <p className="text-xs font-bold uppercase text-gray-500 mb-2">{k.label}</p>
                      <p className={cn('text-xl font-black tabular-nums', k.color)}>{k.value.toLocaleString()}</p>
                      {k.pct && <p className="text-xs text-gray-400 mt-1 font-mono">{k.pct} {language === 'ar' ? 'هامش' : 'margin'}</p>}
                    </div>
                  ))}
                </div>

                {/* P&L Statement */}
                <div className={cn('rounded-2xl border overflow-hidden mb-10', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>

                  {/* ── REVENUE ── */}
                  <SectionHeader label={language === 'ar' ? 'الإيرادات' : 'Revenue'} color={theme === 'dark' ? 'bg-emerald-900/10 border-emerald-900/20 text-emerald-400' : 'bg-emerald-50 border-emerald-100 text-emerald-700'} />
                  {leafRows('41', false)}
                  {leafRows('42', false)}
                  {glPnL.revenue === 0 && totalRevenue > 0 && (
                    <div className={cn('flex justify-between items-center px-8 py-2 border-b text-sm ps-12', theme === 'dark' ? 'border-gray-800/30' : 'border-gray-100')}>
                      <span className="text-gray-400">{language === 'ar' ? 'إيرادات المستخلصات (استحقاق)' : 'Billing Revenue (Accrual)'}</span>
                      <span className="font-mono text-emerald-400">{totalRevenue.toLocaleString()}</span>
                    </div>
                  )}
                  <TotalRow label={language === 'ar' ? 'مجموع الإيرادات' : 'Total Revenue'} value={baseRevenue.toLocaleString()} color="text-emerald-500" />

                  {/* ── CONTRACT COSTS ── */}
                  <SectionHeader label={language === 'ar' ? 'تكاليف العقود' : 'Contract Costs'} color={theme === 'dark' ? 'bg-red-900/10 border-red-900/20 text-red-400' : 'bg-red-50 border-red-100 text-red-700'} />
                  {has511 && <SubHeader label={language === 'ar' ? 'تكاليف مباشرة' : 'Direct Costs'} />}
                  {leafRows('511', true)}
                  {has512 && <SubHeader label={language === 'ar' ? 'تكاليف غير مباشرة للموقع' : 'Indirect Site Costs'} />}
                  {leafRows('512', true)}
                  <TotalRow label={language === 'ar' ? 'مجموع تكاليف العقود' : 'Total Contract Costs'} value={fmt(glPnL.cogs, true)} color="text-red-500" />

                  {/* GROSS PROFIT */}
                  <ProfitRow
                    label={language === 'ar' ? 'مجمل ربح العقود' : 'Gross Profit'}
                    sub="Gross Profit"
                    value={glPnL.gross}
                    pctVal={pct(glPnL.gross)}
                    color={glPnL.gross >= 0 ? 'text-blue-500' : 'text-red-500'}
                    borderColor={glPnL.gross >= 0 ? 'border-blue-500' : 'border-red-500'}
                    bg={glPnL.gross >= 0 ? (theme === 'dark' ? 'bg-blue-900/10' : 'bg-blue-50') : (theme === 'dark' ? 'bg-red-900/10' : 'bg-red-50')}
                  />

                  {/* ── OPERATING EXPENSES ── */}
                  {(glPnL.opex > 0 || has521 || has522) && (
                    <>
                      <SectionHeader label={language === 'ar' ? 'المصروفات التشغيلية' : 'Operating Expenses'} color={theme === 'dark' ? 'bg-orange-900/10 border-orange-900/20 text-orange-400' : 'bg-orange-50 border-orange-100 text-orange-700'} />
                      {leafRows('521', true)}
                      {leafRows('522', true)}
                      <TotalRow label={language === 'ar' ? 'مجموع المصروفات التشغيلية' : 'Total Operating Expenses'} value={fmt(glPnL.opex, true)} color="text-orange-500" />
                    </>
                  )}

                  {/* EBIT */}
                  <ProfitRow
                    label={language === 'ar' ? 'ربح التشغيل' : 'Operating Profit'}
                    sub="EBIT"
                    value={glPnL.ebit}
                    pctVal={pct(glPnL.ebit)}
                    color={glPnL.ebit >= 0 ? 'text-violet-500' : 'text-red-500'}
                    borderColor={glPnL.ebit >= 0 ? 'border-violet-500' : 'border-red-500'}
                    bg={glPnL.ebit >= 0 ? (theme === 'dark' ? 'bg-violet-900/10' : 'bg-violet-50') : (theme === 'dark' ? 'bg-red-900/10' : 'bg-red-50')}
                  />

                  {/* ── FINANCIAL EXPENSES ── */}
                  {(glPnL.finex > 0 || has531) && (
                    <>
                      <SectionHeader label={language === 'ar' ? 'المصروفات التمويلية' : 'Financial Expenses'} color={theme === 'dark' ? 'bg-rose-900/10 border-rose-900/20 text-rose-400' : 'bg-rose-50 border-rose-100 text-rose-700'} />
                      {leafRows('531', true)}
                      <TotalRow label={language === 'ar' ? 'مجموع المصروفات التمويلية' : 'Total Financial Expenses'} value={fmt(glPnL.finex, true)} color="text-rose-500" />
                    </>
                  )}

                  {/* NET PROFIT */}
                  <div className={cn('flex justify-between items-center px-6 py-5 font-black',
                    glPnL.net >= 0
                      ? (theme === 'dark' ? 'bg-amber-900/10 text-amber-400' : 'bg-amber-50 text-amber-700')
                      : (theme === 'dark' ? 'bg-red-900/10 text-red-400'    : 'bg-red-50 text-red-700')
                  )}>
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">★</span>
                      <span className="text-xl">{language === 'ar' ? 'صافي الربح للفترة' : 'Net Profit for the Period'}</span>
                    </div>
                    <div className="text-end">
                      <div className="font-mono tabular-nums text-2xl">{glPnL.net.toLocaleString()}</div>
                      <div className="text-xs font-normal opacity-60">{pct(glPnL.net)} {language === 'ar' ? 'هامش' : 'margin'}</div>
                    </div>
                  </div>
                </div>

                {/* Project Breakdown Table */}
                <div>
                  <h4 className="font-bold text-base mb-4 flex items-center gap-2">
                    <Building2 className="text-blue-500" size={18} />
                    {language === 'ar' ? 'تفصيل حسب المشروع (بيانات المستخلصات)' : 'Project Breakdown (Billing Data)'}
                  </h4>
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className={cn('border-b-2', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
                        <th className="px-4 py-3 font-black text-gray-400 uppercase text-start">{language === 'ar' ? 'المشروع' : 'Project'}</th>
                        <th className="px-4 py-3 font-black text-gray-400 uppercase text-end">{language === 'ar' ? 'الإيرادات' : 'Revenue'}</th>
                        <th className="px-4 py-3 font-black text-gray-400 uppercase text-end">{language === 'ar' ? 'التكاليف' : 'Costs'}</th>
                        <th className="px-4 py-3 font-black text-gray-400 uppercase text-end">{language === 'ar' ? 'الربح' : 'Profit'}</th>
                        <th className="px-4 py-3 font-black text-gray-400 uppercase text-end">{language === 'ar' ? 'هامش' : 'Margin'}</th>
                      </tr>
                    </thead>
                    <tbody className={cn('divide-y', theme === 'dark' ? 'divide-gray-800/40' : 'divide-gray-100')}>
                      {projectStats.map(stat => (
                        <tr key={stat.id} className={cn('transition-colors', theme === 'dark' ? 'hover:bg-white/[0.02]' : 'hover:bg-gray-50')}>
                          <td className="px-4 py-3 font-bold">{stat.name}</td>
                          <td className="px-4 py-3 font-mono tabular-nums text-end text-emerald-400">{stat.billings.toLocaleString()}</td>
                          <td className="px-4 py-3 font-mono tabular-nums text-end text-red-400">({stat.costs.toLocaleString()})</td>
                          <td className={cn('px-4 py-3 font-mono tabular-nums text-end font-bold', stat.profit >= 0 ? 'text-blue-400' : 'text-red-500')}>{stat.profit.toLocaleString()}</td>
                          <td className="px-4 py-3 text-end">
                            <span className={cn('px-2 py-1 rounded-full text-xs font-bold', stat.profit >= 0 ? 'bg-blue-900/20 text-blue-400' : 'bg-red-900/20 text-red-400')}>
                              {((stat.profit / (stat.billings || 1)) * 100).toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className={cn('border-t-2 font-black', theme === 'dark' ? 'border-gray-800 bg-gray-900/30' : 'border-gray-200 bg-gray-50')}>
                        <td className="px-4 py-3">{language === 'ar' ? 'الإجمالي' : 'Total'}</td>
                        <td className="px-4 py-3 font-mono tabular-nums text-end text-emerald-400">{totalRevenue.toLocaleString()}</td>
                        <td className="px-4 py-3 font-mono tabular-nums text-end text-red-400">({totalCosts.toLocaleString()})</td>
                        <td className={cn('px-4 py-3 font-mono tabular-nums text-end', totalGrossProfit >= 0 ? 'text-blue-400' : 'text-red-500')}>{totalGrossProfit.toLocaleString()}</td>
                        <td className="px-4 py-3 text-end">
                          <span className={cn('px-2 py-1 rounded-full text-xs font-bold', totalGrossProfit >= 0 ? 'bg-blue-900/20 text-blue-400' : 'bg-red-900/20 text-red-400')}>
                            {((totalGrossProfit / (totalRevenue || 1)) * 100).toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            );
          })()}

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
          {activeReport === 'balance' && (() => {
            const bs = balanceSheet;

            // Render leaf accounts within a L3 prefix group
            const BSLeafRows = ({ prefix, nature }: { prefix: string; nature: 'debit' | 'credit' }) => {
              const rows = accounts
                .filter(a => !a.isGroup && (a.accountCode || '').startsWith(prefix) && a.status !== 'disabled')
                .map(acc => {
                  const bal = bs.accBal(acc.accountCode || '', nature);
                  if (bal === 0) return null;
                  return (
                    <div key={acc.id} className="flex justify-between items-center py-1.5 text-sm ps-4">
                      <span className={theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}>{acc.accountName}</span>
                      <span className="font-mono tabular-nums">{bal.toLocaleString()}</span>
                    </div>
                  );
                });
              return <>{rows}</>;
            };

            // Render an L3 sub-group: header + leaf rows + optional subtotal
            const BSGroup = ({ prefix, nature, label }: { prefix: string; nature: 'debit' | 'credit'; label: string }) => {
              const leafAccounts = accounts.filter(a => !a.isGroup && (a.accountCode || '').startsWith(prefix) && a.status !== 'disabled');
              const total = leafAccounts.reduce((s, a) => s + bs.accBal(a.accountCode || '', nature), 0);
              if (total === 0 && leafAccounts.every(a => bs.accBal(a.accountCode || '', nature) === 0)) return null;
              return (
                <div className="mb-3">
                  <div className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1 pb-1 border-b border-dashed border-gray-700/30">{label}</div>
                  <BSLeafRows prefix={prefix} nature={nature} />
                  {leafAccounts.length > 1 && total !== 0 && (
                    <div className="flex justify-between items-center py-1 text-sm font-semibold border-t border-gray-700/20 mt-1 pt-1">
                      <span className="text-gray-400 text-xs">{language === 'ar' ? 'مجموع' : 'Sub-total'}</span>
                      <span className="font-mono tabular-nums text-xs">{total.toLocaleString()}</span>
                    </div>
                  )}
                </div>
              );
            };

            const SectionTitle = ({ label, color }: { label: string; color: string }) => (
              <div className={cn('text-base font-black pb-2 mb-3 border-b-2', color)}>{label}</div>
            );
            const SectionTotal = ({ label, value, color }: { label: string; value: number; color: string }) => (
              <div className={cn('flex justify-between items-center pt-3 mt-3 border-t font-black text-base', color)}>
                <span>{label}</span>
                <span className="font-mono tabular-nums">{value.toLocaleString()}</span>
              </div>
            );

            // Build L3 group labels from accounts array
            const l3Label = (code: string, fallback: string) =>
              accounts.find(a => a.accountCode === code)?.accountName || fallback;

            return (
              <div className="p-8" dir={dir}>
                {/* Title */}
                <div className="text-center mb-8">
                  <h3 className="text-2xl font-black">{language === 'ar' ? 'الميزانية العمومية' : 'Balance Sheet'}</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {language === 'ar' ? 'بتاريخ ' : 'As of '}
                    {new Date().toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US')}
                  </p>
                </div>

                {/* Balance indicator */}
                <div className={cn('flex items-center justify-center gap-3 mb-8 px-6 py-3 rounded-xl border w-fit mx-auto',
                  bs.isBalanced
                    ? (theme === 'dark' ? 'bg-green-900/10 border-green-900/30 text-green-400' : 'bg-green-50 border-green-200 text-green-700')
                    : (theme === 'dark' ? 'bg-red-900/10 border-red-900/30 text-red-400'   : 'bg-red-50 border-red-200 text-red-700')
                )}>
                  <div className={cn('w-2.5 h-2.5 rounded-full animate-pulse', bs.isBalanced ? 'bg-green-500' : 'bg-red-500')} />
                  <span className="font-bold text-sm uppercase tracking-wider">
                    {bs.isBalanced
                      ? (language === 'ar' ? 'الميزانية متوازنة' : 'Balanced')
                      : (language === 'ar' ? `فرق: ${Math.abs(bs.totalAssets - bs.totalLE).toLocaleString()}` : `Out of balance by ${Math.abs(bs.totalAssets - bs.totalLE).toLocaleString()}`)}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-10">

                  {/* ════ LEFT: ASSETS ════ */}
                  <div>
                    {/* Current Assets */}
                    <SectionTitle label={language === 'ar' ? 'الأصول المتداولة' : 'Current Assets'} color="text-blue-500 border-blue-500/40" />
                    <BSGroup prefix="111" nature="debit" label={l3Label('111', language === 'ar' ? 'النقدية والبنوك' : 'Cash & Banks')} />
                    <BSGroup prefix="112" nature="debit" label={l3Label('112', language === 'ar' ? 'العملاء والذمم المدينة' : 'Receivables')} />
                    <BSGroup prefix="113" nature="debit" label={l3Label('113', language === 'ar' ? 'مدفوعات مقدمة' : 'Advances')} />
                    <BSGroup prefix="114" nature="debit" label={l3Label('114', language === 'ar' ? 'حسابات ضريبية مدينة' : 'Tax Receivables')} />
                    <BSGroup prefix="115" nature="debit" label={l3Label('115', language === 'ar' ? 'ذمم مدينة أخرى' : 'Other Receivables')} />
                    <SectionTotal label={language === 'ar' ? 'مجموع الأصول المتداولة' : 'Total Current Assets'} value={bs.currentAssets} color="text-blue-500" />

                    <div className="mt-8">
                      {/* Non-Current Assets */}
                      <SectionTitle label={language === 'ar' ? 'الأصول غير المتداولة' : 'Non-Current Assets'} color="text-blue-400 border-blue-400/30" />
                      <BSGroup prefix="121" nature="debit" label={l3Label('121', language === 'ar' ? 'الأصول الثابتة' : 'Fixed Assets')} />
                      <BSGroup prefix="122" nature="debit" label={l3Label('122', language === 'ar' ? 'أصول أخرى' : 'Other Assets')} />
                      <SectionTotal label={language === 'ar' ? 'مجموع الأصول غير المتداولة' : 'Total Non-Current Assets'} value={bs.nonCurrentAssets} color="text-blue-400" />
                    </div>

                    {/* Grand Total Assets */}
                    <div className={cn('flex justify-between items-center mt-6 pt-4 border-t-4 font-black text-lg', 'border-blue-600 text-blue-500')}>
                      <span>{language === 'ar' ? 'إجمالي الأصول' : 'Total Assets'}</span>
                      <span className="font-mono tabular-nums">{bs.totalAssets.toLocaleString()}</span>
                    </div>
                  </div>

                  {/* ════ RIGHT: LIABILITIES & EQUITY ════ */}
                  <div>
                    {/* Current Liabilities */}
                    <SectionTitle label={language === 'ar' ? 'الخصوم المتداولة' : 'Current Liabilities'} color="text-red-500 border-red-500/40" />
                    <BSGroup prefix="211" nature="credit" label={l3Label('211', language === 'ar' ? 'ذمم دائنة تجارية' : 'Trade Payables')} />
                    <BSGroup prefix="212" nature="credit" label={l3Label('212', language === 'ar' ? 'محتجزات الضمان' : 'Retention Payables')} />
                    <BSGroup prefix="213" nature="credit" label={l3Label('213', language === 'ar' ? 'دفعات مقدمة من العملاء' : 'Customer Advances')} />
                    <BSGroup prefix="214" nature="credit" label={l3Label('214', language === 'ar' ? 'التزامات ضريبية' : 'Tax Liabilities')} />
                    <BSGroup prefix="215" nature="credit" label={l3Label('215', language === 'ar' ? 'مستحقات أخرى' : 'Other Payables')} />
                    <SectionTotal label={language === 'ar' ? 'مجموع الخصوم المتداولة' : 'Total Current Liabilities'} value={bs.currentLiab} color="text-red-500" />

                    <div className="mt-8">
                      {/* Non-Current Liabilities */}
                      <SectionTitle label={language === 'ar' ? 'الخصوم غير المتداولة' : 'Non-Current Liabilities'} color="text-red-400 border-red-400/30" />
                      <BSGroup prefix="221" nature="credit" label={l3Label('221', language === 'ar' ? 'قروض طويلة الأجل' : 'Long-term Loans')} />
                      <SectionTotal label={language === 'ar' ? 'مجموع الخصوم غير المتداولة' : 'Total Non-Current Liabilities'} value={bs.nonCurrentLiab} color="text-red-400" />
                    </div>

                    <div className="mt-8">
                      {/* Equity */}
                      <SectionTitle label={language === 'ar' ? 'حقوق الملكية' : 'Equity'} color="text-emerald-500 border-emerald-500/40" />
                      <BSGroup prefix="311" nature="credit" label={l3Label('311', language === 'ar' ? 'رأس المال' : 'Share Capital')} />
                      <BSGroup prefix="312" nature="credit" label={l3Label('312', language === 'ar' ? 'الاحتياطيات' : 'Reserves')} />
                      <BSGroup prefix="313" nature="credit" label={l3Label('313', language === 'ar' ? 'الأرباح المحتجزة' : 'Retained Earnings')} />
                      {/* Current period net profit */}
                      <div className={cn('flex justify-between items-center py-1.5 text-sm ps-4 italic', bs.netProfitForBS >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        <span>{language === 'ar' ? 'صافي ربح الفترة الحالية' : 'Current Period Net Profit'}</span>
                        <span className="font-mono tabular-nums">{bs.netProfitForBS.toLocaleString()}</span>
                      </div>
                      <SectionTotal label={language === 'ar' ? 'مجموع حقوق الملكية' : 'Total Equity'} value={bs.totalEquity} color="text-emerald-500" />
                    </div>

                    {/* Grand Total L&E */}
                    <div className={cn('flex justify-between items-center mt-6 pt-4 border-t-4 font-black text-lg', 'border-emerald-600 text-emerald-500')}>
                      <span>{language === 'ar' ? 'إجمالي الخصوم وحقوق الملكية' : 'Total Liabilities & Equity'}</span>
                      <span className="font-mono tabular-nums">{bs.totalLE.toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                {/* Working capital note */}
                <div className={cn('mt-8 p-4 rounded-xl border text-sm flex justify-between items-center', theme === 'dark' ? 'bg-gray-900/30 border-gray-800' : 'bg-gray-50 border-gray-200')}>
                  <span className="text-gray-400 font-bold">{language === 'ar' ? 'رأس المال العامل (الأصول المتداولة − الخصوم المتداولة)' : 'Working Capital (Current Assets − Current Liabilities)'}</span>
                  <span className={cn('font-mono font-black tabular-nums', (bs.currentAssets - bs.currentLiab) >= 0 ? 'text-blue-400' : 'text-red-400')}>
                    {(bs.currentAssets - bs.currentLiab).toLocaleString()}
                  </span>
                </div>
              </div>
            );
          })()}

          {/* Analytical Trial Balance View */}
          {activeReport === 'trial' && (
            <div className="p-8">
              <div className="flex flex-wrap items-center gap-4 mb-8">
                <BarChart3 className="text-blue-500" size={32} />
                <h3 className="text-2xl font-black flex-1">{language === 'ar' ? 'ميزان المراجعة التحليلي' : 'Analytical Trial Balance'}</h3>
                <div className="flex items-center gap-3">
                  <label className="text-xs font-bold text-gray-400 uppercase whitespace-nowrap">
                    {language === 'ar' ? 'بداية الفترة' : 'Period Start'}
                  </label>
                  <input
                    type="date"
                    value={periodStart}
                    onChange={(e) => setPeriodStart(e.target.value)}
                    className={cn('border rounded-lg py-1.5 px-3 text-sm outline-none focus:border-blue-500 transition-colors', theme === 'dark' ? 'bg-gray-900 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900')}
                  />
                  <span className={cn('text-[11px] px-2 py-1 rounded font-bold', theme === 'dark' ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-50 text-blue-700')}>
                    {language === 'ar'
                      ? `الحركة من ${periodStart} حتى اليوم`
                      : `Movements from ${periodStart} onward`}
                  </span>
                </div>
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
                      .filter(item => selectedProjectId === 'all' || item.projectId === selectedProjectId)
                      .map((item) => {
                        const startDate = item.startDate ? new Date(item.startDate) : null;
                        const duration = item.expectedDuration || 0;
                        const finishDate = startDate ? new Date(startDate.getTime() + duration * 24 * 60 * 60 * 1000) : null;
                        
                        const today = new Date();
                        const elapsedDays = startDate ? Math.max(0, Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))) : 0;
                        const timeProgress = duration > 0 ? (elapsedDays / duration) * 100 : 0;
                        
                        return (
                          <tr key={item.id} className="hover:bg-gray-900/20 transition-colors text-sm">
                            <td className="px-4 py-4">
                              <span className="font-bold block">{item.itemCode}</span>
                              <span className="text-xs text-gray-500 line-clamp-1">{item.description}</span>
                            </td>
                            <td className="px-4 py-4 font-mono">{item.startDate || '-'}</td>
                            <td className="px-4 py-4 font-mono">{duration}</td>
                            <td className="px-4 py-4 font-mono text-blue-400">{finishDate ? finishDate.toLocaleDateString() : '-'}</td>
                            <td className="px-4 py-4">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden min-w-[60px]">
                                  <div 
                                    className={cn("h-full rounded-full", timeProgress > 100 ? "bg-red-500" : "bg-purple-500")}
                                    style={{ width: `${Math.min(timeProgress, 100)}%` }}
                                  />
                                </div>
                                <span className="text-[10px] font-mono">{elapsedDays} {language === 'ar' ? 'يوم' : 'd'}</span>
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              {startDate ? (
                                <span className={cn(
                                  "px-2 py-1 rounded-md text-[10px] font-bold uppercase",
                                  timeProgress > 100 ? "bg-red-900/20 text-red-500" : 
                                  timeProgress > 80 ? "bg-orange-900/20 text-orange-500" :
                                  "bg-green-900/20 text-green-500"
                                )}>
                                  {timeProgress > 100 ? (language === 'ar' ? 'متأخر' : 'Overdue') : 
                                   timeProgress > 80 ? (language === 'ar' ? 'أوشك على الانتهاء' : 'Near Finish') :
                                   (language === 'ar' ? 'قيد التنفيذ' : 'On Track')}
                                </span>
                              ) : (
                                <span className="text-gray-600 text-[10px]">{language === 'ar' ? 'غير مجدول' : 'Not Scheduled'}</span>
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
