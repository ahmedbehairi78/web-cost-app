import React, { useState, useEffect } from 'react';
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Clock, 
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
  Loader2
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  LineChart, 
  Line,
  AreaChart,
  Area
} from 'recharts';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '../firebase';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { sortByDateFieldDesc } from '../lib/firestoreSorts';
import { useLanguage } from '../context/LanguageContext';

export function Dashboard() {
  const { t, language, theme } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [stats, setStats] = useState({
    totalBudget: 0,
    totalSpent: 0,
    totalCollected: 0,
    pendingBilling: 0
  });
  const [alerts, setAlerts] = useState<any[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);
  const [recentTransactions, setRecentTransactions] = useState<any[]>([]);

  useEffect(() => {
    const unsubs: (() => void)[] = [];
    const ready = {
      projects: false,
      transactions: false,
      boq: false,
    };

    const finishRefresh = () => {
      if (ready.projects && ready.transactions && ready.boq) {
        setLoading(false);
        setRefreshing(false);
      }
    };

    const handleStatsUpdate = (projectsData: any[], transData: any[], boqItems: any[]) => {
      setRecentTransactions(transData.slice(0, 5));

      // Calculate from transactions (Source of Truth)
      const totalSpent = transData.reduce((sum, t: any) => {
        const expenseEntries = t.entries?.filter((e: any) => e.accountCode?.startsWith('5')) || [];
        return sum + expenseEntries.reduce((s: number, e: any) => s + (e.debit || 0), 0);
      }, 0);

      const totalCollected = transData.reduce((sum, t: any) => {
        const isCollection = t.entries?.some((e: any) => e.accountCode === '1101' && e.debit > 0) &&
                            t.entries?.some((e: any) => e.accountCode === '1102' && e.credit > 0);
        if (!isCollection) return sum;
        const cashEntry = t.entries?.find((e: any) => e.accountCode === '1101');
        return sum + (cashEntry?.debit || 0);
      }, 0);

      const totalRevenue = transData.reduce((sum, t: any) => {
        const revenueEntries = t.entries?.filter((e: any) => e.accountCode === '41') || [];
        return sum + revenueEntries.reduce((s: number, e: any) => s + (e.credit || 0), 0);
      }, 0);

      const pendingBilling = totalRevenue - totalCollected;
      const totalBudget = boqItems.reduce((sum, i: any) => sum + (i.tenderAmount || 0), 0);

      setStats({
        totalBudget,
        totalSpent,
        totalCollected,
        pendingBilling
      });
    };

    let projectsData: any[] = [];
    let transData: any[] = [];
    let boqItems: any[] = [];

    const unsubProjects = onSnapshot(collection(db, 'projects'), (snapshot) => {
      projectsData = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter((project: any) => project.isDeleted !== true);
      ready.projects = true;
      handleStatsUpdate(projectsData, transData, boqItems);
      finishRefresh();
    }, (err) => {
      console.error("Dashboard projects listener error:", err);
      ready.projects = true;
      setLoading(false);
      setRefreshing(false);
    });

    const unsubTransactions = onSnapshot(collection(db, 'transactions'), (snapshot) => {
      transData = sortByDateFieldDesc(
        snapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .filter((transaction: any) => transaction.isDeleted !== true),
        'date'
      );
      ready.transactions = true;
      handleStatsUpdate(projectsData, transData, boqItems);
      finishRefresh();
    }, (err) => {
      console.error("Dashboard transactions listener error:", err);
      ready.transactions = true;
      setLoading(false);
      setRefreshing(false);
    });

    const unsubBOQ = onSnapshot(collection(db, 'boq_items'), (snapshot) => {
      boqItems = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter((item: any) => item.isDeleted !== true);
      ready.boq = true;
      handleStatsUpdate(projectsData, transData, boqItems);
      finishRefresh();
    }, (err) => {
      console.error("Dashboard boq_items listener error:", err);
      ready.boq = true;
      setLoading(false);
      setRefreshing(false);
    });

    unsubs.push(unsubProjects, unsubTransactions, unsubBOQ);

    setChartData([
      { name: language === 'ar' ? 'يناير' : 'Jan', revenue: 400000, cost: 240000 },
      { name: language === 'ar' ? 'فبراير' : 'Feb', revenue: 300000, cost: 139800 },
      { name: language === 'ar' ? 'مارس' : 'Mar', revenue: 200000, cost: 980000 },
      { name: language === 'ar' ? 'أبريل' : 'Apr', revenue: 278000, cost: 390800 },
      { name: language === 'ar' ? 'مايو' : 'May', revenue: 189000, cost: 480000 },
      { name: language === 'ar' ? 'يونيو' : 'Jun', revenue: 239000, cost: 380000 },
    ]);

    return () => {
      unsubs.forEach(unsub => unsub());
    }; 
  }, [language, refreshKey]);

  const handleRefreshData = () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshKey((current) => current + 1);
  };

  const statCards = [
    { label: t('total_contracts'), value: stats.totalBudget, icon: DollarSign, color: 'text-blue-500', trend: '+0%' },
    { label: t('actual_costs'), value: stats.totalSpent, icon: TrendingDown, color: 'text-red-500', trend: '+0%' },
    { label: t('cash_collections'), value: stats.totalCollected, icon: TrendingUp, color: 'text-green-500', trend: '+0%' },
    { label: t('pending_billing'), value: stats.pendingBilling, icon: Clock, color: 'text-yellow-500', trend: t('alert') },
  ];

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-500 p-8 text-center">
        <Loader2 className="animate-spin text-blue-500 mb-4" size={48} />
        <p>{language === 'ar' ? 'جاري تجميع البيانات المالية...' : 'Aggregating financial data...'}</p>
      </div>
    );
  }

  return (
    <div className={cn("p-8 space-y-8 min-h-screen transition-colors", theme === 'dark' ? "bg-[#0a0a0a] text-gray-100" : "bg-gray-50 text-gray-900")}>
      <header className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{language === 'ar' ? 'نظرة عامة على المحفظة' : 'Portfolio Overview'}</h2>
          <p className="text-gray-400 mt-1">{language === 'ar' ? 'متابعة الأداء المالي والتدفق النقدي لكافة المشاريع' : 'Monitor financial performance and cash flow across all projects'}</p>
        </div>
        <div className="flex gap-3">
          <button className={cn("px-4 py-2 rounded-md text-sm font-medium transition-colors", theme === 'dark' ? "bg-gray-800 hover:bg-gray-700" : "bg-white border border-gray-200 hover:bg-gray-50")}>{language === 'ar' ? 'تصدير تقرير PDF' : 'Export PDF'}</button>
          <button
            onClick={handleRefreshData}
            disabled={refreshing}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed px-4 py-2 rounded-md text-sm font-medium transition-colors text-white flex items-center gap-2"
          >
            {refreshing && <Loader2 size={16} className="animate-spin" />}
            {language === 'ar' ? 'تحديث البيانات' : 'Refresh Data'}
          </button>
        </div>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((stat, i) => (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            key={stat.label}
            className={cn("border p-6 rounded-xl transition-all group", theme === 'dark' ? "bg-[#151619] border-gray-800 hover:border-gray-700" : "bg-white border-gray-200 hover:border-blue-200 shadow-sm")}
          >
            <div className="flex justify-between items-start">
              <div className={cn("p-2 rounded-lg", theme === 'dark' ? "bg-gray-900" : "bg-gray-50", stat.color)}>
                <stat.icon size={24} />
              </div>
              <span className={cn(
                "text-[10px] font-bold px-2 py-1 rounded flex items-center gap-1",
                stat.color === 'text-red-500' ? "bg-red-900/20 text-red-400" : "bg-green-900/20 text-green-400"
              )}>
                {stat.trend}
              </span>
            </div>
            <div className="mt-4">
              <p className="text-sm text-gray-400 font-medium">{stat.label}</p>
              <h3 className="text-2xl font-bold mt-1">{stat.value.toLocaleString()} <span className="text-xs font-normal text-gray-500">{language === 'ar' ? 'ج.م' : 'EGP'}</span></h3>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Cash Flow Chart */}
        <div className={cn("lg:col-span-2 border p-6 rounded-xl", theme === 'dark' ? "bg-[#151619] border-gray-800" : "bg-white border-gray-200 shadow-sm")}>
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <BarChart3 className="text-blue-500" size={20} />
              {t('cash_flow_analysis')}
            </h3>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={theme === 'dark' ? "#1f2937" : "#e5e7eb"} vertical={false} />
                <XAxis dataKey="name" stroke="#6b7280" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#6b7280" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value/1000}k`} />
                <Tooltip 
                  contentStyle={{ backgroundColor: theme === 'dark' ? '#111827' : '#ffffff', border: `1px solid ${theme === 'dark' ? '#374151' : '#e5e7eb'}`, borderRadius: '8px' }}
                  itemStyle={{ fontSize: '12px' }}
                />
                <Area type="monotone" dataKey="revenue" stroke="#3b82f6" fillOpacity={1} fill="url(#colorRev)" name={language === 'ar' ? 'الإيرادات' : 'Revenue'} />
                <Area type="monotone" dataKey="cost" stroke="#ef4444" fillOpacity={1} fill="url(#colorCost)" name={language === 'ar' ? 'التكاليف' : 'Costs'} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recent Transactions */}
        <div className={cn("border p-6 rounded-xl", theme === 'dark' ? "bg-[#151619] border-gray-800" : "bg-white border-gray-200 shadow-sm")}>
          <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
            <Clock className="text-blue-500" size={20} />
            {language === 'ar' ? 'أحدث القيود المحاسبية' : 'Recent Journal Entries'}
          </h3>
          <div className="space-y-4">
            {recentTransactions.length === 0 ? (
              <div className="p-8 text-center text-gray-500 border border-dashed rounded-lg border-gray-800">
                {language === 'ar' ? 'لا توجد قيود حالياً' : 'No entries yet'}
              </div>
            ) : (
              recentTransactions.map((t, i) => (
                <div key={i} className="flex justify-between items-center p-3 rounded-lg bg-gray-900/50 border border-gray-800">
                  <div>
                    <p className="text-sm font-bold">{t.description}</p>
                    <p className="text-[10px] text-gray-500">{t.date}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-mono font-bold text-blue-400">
                      {t.entries.reduce((sum: number, e: any) => sum + e.debit, 0).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
          <button className="w-full mt-6 py-2 text-sm text-blue-400 hover:text-blue-300 transition-colors font-medium">
            {language === 'ar' ? 'عرض كافة القيود ←' : 'View all entries ←'}
          </button>
        </div>
      </div>
    </div>
  );
}
