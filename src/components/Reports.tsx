import React, { useState, useEffect, useRef } from 'react';
import { collection, onSnapshot, query, orderBy, doc, getDoc } from 'firebase/firestore';
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
  ChevronLeft
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
  date: any;
}

export function Reports() {
  const { t, language, theme, dir } = useLanguage();
  const [projects, setProjects] = useState<Project[]>([]);
  const [costs, setCosts] = useState<Cost[]>([]);
  const [billings, setBillings] = useState<Billing[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeReport, setActiveReport] = useState<'overview' | 'income' | 'budget' | 'balance'>('overview');
  const [transactions, setTransactions] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [showCharts, setShowCharts] = useState(true);
  
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
    const unsubProjects = onSnapshot(collection(db, 'projects'), (snap) => {
      setProjects(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
    }, (err) => {
      console.error("Projects listener error:", err);
    });

    const unsubCosts = onSnapshot(collection(db, 'actual_costs'), (snap) => {
      setCosts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Cost)));
    }, (err) => {
      console.error("Costs listener error:", err);
    });

    const unsubBillings = onSnapshot(collection(db, 'billing'), (snap) => {
      setBillings(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Billing)));
    }, (err) => {
      console.error("Billings listener error:", err);
    });

    const unsubTransactions = onSnapshot(collection(db, 'transactions'), (snap) => {
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

    return () => { 
      unsubProjects(); 
      unsubCosts(); 
      unsubBillings(); 
      unsubTransactions();
      unsubAccounts();
    };
  }, []);

  // Data Processing
  const projectStats = projects.map(p => {
    const projectCosts = costs.filter(c => c.projectId === p.id).reduce((sum, c) => sum + c.amount, 0);
    const projectBillings = billings.filter(b => b.projectId === p.id).reduce((sum, b) => sum + b.netPayable, 0);
    const budget = p.totalContractValue || 0;
    
    return {
      id: p.id,
      name: p.projectName,
      budget,
      costs: projectCosts,
      billings: projectBillings,
      profit: projectBillings - projectCosts,
      variance: budget - projectCosts,
      variancePct: budget > 0 ? ((budget - projectCosts) / budget) * 100 : 0,
      progress: budget > 0 ? (projectBillings / budget) * 100 : 0
    };
  });

  const totalRevenue = projectStats.reduce((sum, s) => sum + s.billings, 0);
  const totalCosts = projectStats.reduce((sum, s) => sum + s.costs, 0);
  const totalGrossProfit = totalRevenue - totalCosts;
  const totalBudget = projectStats.reduce((sum, s) => sum + s.budget, 0);

  const exportToExcel = () => {
    let data: any[] = [];
    let filename = 'report.xlsx';

    if (activeReport === 'income') {
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
        [language === 'ar' ? 'الميزانية المخططة' : 'Planned Budget']: s.budget,
        [language === 'ar' ? 'التكاليف الفعلية' : 'Actual Costs']: s.costs,
        [language === 'ar' ? 'الانحراف' : 'Variance']: s.variance,
        [language === 'ar' ? 'نسبة الانحراف %' : 'Variance %']: s.variancePct.toFixed(2) + '%'
      }));
      filename = 'Budget_vs_Actual.xlsx';
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
             (language === 'ar' ? 'نظرة عامة على المشاريع' : 'Project Overview')}
          </h2>
          <p className="text-sm text-gray-600">{new Date().toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US')}</p>
        </div>
      </div>

      {/* Controls (Hidden in Print) */}
      <header className="mb-8 print:hidden">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">{t('reports')}</h2>
            <p className="text-gray-400 mt-1">{language === 'ar' ? 'تحليلات مالية متقدمة وتقارير أداء المشاريع' : 'Advanced financial analytics and project performance reports'}</p>
          </div>
          <div className="flex gap-3">
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
                  {activeReport === 'income' ? (language === 'ar' ? 'تحليل الربحية' : 'Profitability Analysis') : (language === 'ar' ? 'مقارنة المحصل والمصروف' : 'Collected vs Spent')}
                </h3>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={projectStats}>
                      <CartesianGrid strokeDasharray="3 3" stroke={theme === 'dark' ? "#333" : "#eee"} />
                      <XAxis dataKey="name" stroke="#888" fontSize={10} />
                      <YAxis stroke="#888" fontSize={10} />
                      <Tooltip contentStyle={{ backgroundColor: theme === 'dark' ? '#151619' : '#fff', border: 'none', borderRadius: '8px' }} />
                      <Legend />
                      <Bar dataKey="billings" name={language === 'ar' ? 'الإيرادات' : 'Revenue'} fill="#10b981" radius={[4, 4, 0, 0]} />
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
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
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
                  <p className="text-sm text-gray-500 font-bold uppercase mb-2">{language === 'ar' ? 'إجمالي الإيرادات (المحصل)' : 'Total Revenue (Collected)'}</p>
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
                  {projectStats.map((stat, idx) => (
                    <tr key={idx} className="hover:bg-gray-900/20 transition-colors">
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
                    <th className="px-6 py-4 text-sm font-black text-gray-400 uppercase">{language === 'ar' ? 'الميزانية المخططة' : 'Planned Budget'}</th>
                    <th className="px-6 py-4 text-sm font-black text-gray-400 uppercase">{language === 'ar' ? 'التكاليف الفعلية' : 'Actual Costs'}</th>
                    <th className="px-6 py-4 text-sm font-black text-gray-400 uppercase">{language === 'ar' ? 'الانحراف' : 'Variance'}</th>
                    <th className="px-6 py-4 text-sm font-black text-gray-400 uppercase">{language === 'ar' ? 'الحالة' : 'Status'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {projectStats.map((stat, idx) => (
                    <tr key={idx} className="hover:bg-gray-900/20 transition-colors">
                      <td className="px-6 py-4 font-bold">{stat.name}</td>
                      <td className="px-6 py-4 font-mono">{stat.budget.toLocaleString()}</td>
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
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className={cn("border-b-2", theme === 'dark' ? "border-gray-800" : "border-gray-200")}>
                    <th className="px-6 py-4 text-sm font-black text-gray-400 uppercase">{t('project')}</th>
                    <th className="px-6 py-4 text-sm font-black text-gray-400 uppercase">{language === 'ar' ? 'الميزانية' : 'Budget'}</th>
                    <th className="px-6 py-4 text-sm font-black text-gray-400 uppercase">{language === 'ar' ? 'المصروفات' : 'Expenses'}</th>
                    <th className="px-6 py-4 text-sm font-black text-gray-400 uppercase">{language === 'ar' ? 'المحصل' : 'Collected'}</th>
                    <th className="px-6 py-4 text-sm font-black text-gray-400 uppercase">{language === 'ar' ? 'نسبة الإنجاز' : 'Progress'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {projectStats.map((stat, idx) => (
                    <tr key={idx} className="hover:bg-gray-900/20 transition-colors">
                      <td className="px-6 py-4 font-bold">{stat.name}</td>
                      <td className="px-6 py-4 font-mono">{stat.budget.toLocaleString()}</td>
                      <td className="px-6 py-4 font-mono text-red-400">{stat.costs.toLocaleString()}</td>
                      <td className="px-6 py-4 font-mono text-green-400">{stat.billings.toLocaleString()}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
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
                        <div key={acc.id} className="flex justify-between items-center">
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
                          <div key={acc.id} className="flex justify-between items-center">
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
                          <div key={acc.id} className="flex justify-between items-center">
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
