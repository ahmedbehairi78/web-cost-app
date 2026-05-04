import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  Area,
  ScatterChart,
  Scatter,
  ZAxis,
  Legend
} from 'recharts';
import { collection, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { useLanguage } from '../context/LanguageContext';
import { type Transaction, type BOQItem, type Project, type JournalEntry } from '../types';
import { AccountCodes } from '../services/accountingService';
// @ts-ignore
import html2pdf from 'html2pdf.js';

export function Dashboard() {
  const { t, language, theme, locale } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [rawProjects, setRawProjects] = useState<Project[]>([]);
  const [rawTransactions, setRawTransactions] = useState<Transaction[]>([]);
  const [rawBoqItems, setRawBoqItems] = useState<BOQItem[]>([]);

  const { stats, chartData, recentTransactions } = useMemo(() => {
    let totalSpent = 0;
    let totalCollected = 0;
    let ipcCollected = 0;
    let totalRevenue = 0;
    const monthlyMap: Record<string, { name: string; revenue: number; cost: number; collections: number }> = {};

    rawTransactions.forEach((tx: Transaction) => {
      if (!tx.entries) return;
      const date = new Date(tx.date);
      const monthYear = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const monthName = date.toLocaleDateString(locale, { month: 'short', year: '2-digit' });

      if (!monthlyMap[monthYear]) {
        monthlyMap[monthYear] = { name: monthName, revenue: 0, cost: 0, collections: 0 };
      }

      tx.entries.forEach((e: JournalEntry) => {
        if (e.accountCode?.startsWith('5')) {
          const val = e.debit || 0;
          totalSpent += val;
          monthlyMap[monthYear].cost += val;
        }
        if (e.accountCode?.startsWith('4')) {
          const val = e.credit || 0;
          totalRevenue += val;
          monthlyMap[monthYear].revenue += val;
        }
      });

      const cashOrBankEntry = tx.entries.find((e: JournalEntry) => e.accountCode?.startsWith('111') && e.debit > 0);
      if (cashOrBankEntry) {
        const val = cashOrBankEntry.debit || 0;
        const isIpcCollection = tx.entries.some((e: JournalEntry) => e.accountCode === AccountCodes.RECEIVABLES && e.credit > 0);
        const isAdvancePayment = tx.entries.some((e: JournalEntry) => e.accountCode === AccountCodes.ADVANCE_PAYMENT && e.credit > 0);
        if (isIpcCollection || isAdvancePayment) {
          totalCollected += val;
          monthlyMap[monthYear].collections += val;
        }
        if (isIpcCollection) {
          ipcCollected += val;
        }
      }
    });

    const sortedMonths = Object.keys(monthlyMap).sort();
    let runningRevenue = 0;
    let runningCost = 0;
    let runningCollections = 0;

    const cumulativeData = sortedMonths.map(key => {
      runningRevenue += monthlyMap[key].revenue;
      runningCost += monthlyMap[key].cost;
      runningCollections += monthlyMap[key].collections;
      return {
        name: monthlyMap[key].name,
        revenue: runningRevenue,
        cost: runningCost,
        collections: runningCollections,
      };
    });

    const pendingBilling = totalRevenue - ipcCollected;
    const totalBudget = rawProjects.reduce((sum, p) => {
      const pExt = p as Project & { boqValue?: number; voValue?: number };
      const calculatedBoqValue = rawBoqItems
        .filter((item: BOQItem) => item.projectId === p.id)
        .reduce((s: number, item: BOQItem) => s + (item.tenderAmount || 0), 0);
      const boqValue = calculatedBoqValue > 0 ? calculatedBoqValue : (pExt.boqValue || 0);
      return sum + boqValue + (pExt.voValue || 0);
    }, 0);

    return {
      stats: { totalBudget, totalSpent, totalCollected, pendingBilling },
      chartData: cumulativeData.slice(-6),
      recentTransactions: rawTransactions.slice(0, 5),
    };
  }, [rawProjects, rawTransactions, rawBoqItems, locale]);

  useEffect(() => {
    setLoading(true);
    const unsubs: (() => void)[] = [];

    const unsubProjects = onSnapshot(query(collection(db, 'projects'), where('isDeleted', '==', false)), (snapshot) => {
      setRawProjects(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'projects');
      setLoading(false);
    });

    const unsubTransactions = onSnapshot(query(collection(db, 'transactions'), where('isDeleted', '==', false), orderBy('date', 'desc')), (snapshot) => {
      setRawTransactions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction)));
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'transactions');
      setLoading(false);
    });

    const unsubBOQ = onSnapshot(query(collection(db, 'boq_items'), where('isDeleted', '!=', true)), (snapshot) => {
      setRawBoqItems(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BOQItem)));
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'boq_items');
      setLoading(false);
    });

    unsubs.push(unsubProjects, unsubTransactions, unsubBOQ);
    return () => { unsubs.forEach(unsub => unsub()); };
  }, [refreshKey]);

  const handleRefresh = useCallback(() => {
    setLoading(true);
    setRefreshKey(prev => prev + 1);
  }, []);

  const handleExportPDF = () => {
    const isAr = language === 'ar';
    const element = document.createElement('div');
    element.dir = isAr ? 'rtl' : 'ltr';
    element.style.padding = '40px';
    element.style.backgroundColor = '#ffffff';
    element.style.color = '#000000';
    element.style.fontFamily = isAr ? 'Arial, sans-serif' : 'inherit';

    element.innerHTML = `
      <div style="text-align: center; margin-bottom: 40px;">
        <h1 style="font-size: 28px; color: #1e3a8a; margin-bottom: 10px;">${isAr ? 'تقرير ملخص المحفظة' : 'Portfolio Summary Report'}</h1>
        <p style="color: #666;">${new Date().toLocaleDateString(locale)}</p>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 40px;">
        <div style="padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <p style="font-size: 12px; color: #666; margin-bottom: 5px;">${isAr ? 'إجمالي قيمة العقود' : 'Total Contracts Value'}</p>
          <h2 style="font-size: 20px; font-weight: bold;">${stats.totalBudget.toLocaleString()} EGP</h2>
        </div>
        <div style="padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <p style="font-size: 12px; color: #666; margin-bottom: 5px;">${isAr ? 'إجمالي التكاليف الفعلية' : 'Total Actual Costs'}</p>
          <h2 style="font-size: 20px; font-weight: bold;">${stats.totalSpent.toLocaleString()} EGP</h2>
        </div>
        <div style="padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <p style="font-size: 12px; color: #666; margin-bottom: 5px;">${isAr ? 'إجمالي التحصيلات' : 'Total Collections'}</p>
          <h2 style="font-size: 20px; font-weight: bold;">${stats.totalCollected.toLocaleString()} EGP</h2>
        </div>
        <div style="padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <p style="font-size: 12px; color: #666; margin-bottom: 5px;">${isAr ? 'مستخلصات قيد التحصيل' : 'Pending Billing'}</p>
          <h2 style="font-size: 20px; font-weight: bold;">${stats.pendingBilling.toLocaleString()} EGP</h2>
        </div>
      </div>

      <div style="margin-top: 40px;">
        <h3 style="font-size: 18px; margin-bottom: 20px; border-bottom: 2px solid #1e3a8a; padding-bottom: 10px;">
          ${isAr ? 'أحدث المعاملات' : 'Recent Transactions'}
        </h3>
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="background-color: #f8fafc;">
              <th style="border: 1px solid #e2e8f0; padding: 12px; text-align: ${isAr ? 'right' : 'left'};">${isAr ? 'التاريخ' : 'Date'}</th>
              <th style="border: 1px solid #e2e8f0; padding: 12px; text-align: ${isAr ? 'right' : 'left'};">${isAr ? 'البيان' : 'Description'}</th>
              <th style="border: 1px solid #e2e8f0; padding: 12px; text-align: ${isAr ? 'right' : 'left'};">${isAr ? 'القيمة' : 'Amount'}</th>
            </tr>
          </thead>
          <tbody>
            ${recentTransactions.map((tx: Transaction) => `
              <tr>
                <td style="border: 1px solid #e2e8f0; padding: 12px;">${tx.date}</td>
                <td style="border: 1px solid #e2e8f0; padding: 12px;">${tx.description}</td>
                <td style="border: 1px solid #e2e8f0; padding: 12px;">${(tx.entries?.reduce((sum: number, e: JournalEntry) => sum + (e.debit || 0), 0) || 0).toLocaleString()} EGP</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div style="margin-top: 60px; text-align: center; font-size: 10px; color: #999;">
        <p>${isAr ? 'تم إنشاء هذا التقرير آلياً بواسطة نظام إدارة المشاريع' : 'This report was generated automatically by the Project Management System'}</p>
      </div>
    `;

    const opt = {
      margin: 0.5,
      filename: `Portfolio_Report_${new Date().toISOString().split('T')[0]}.pdf`,
      image: { type: 'jpeg' as const, quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'in' as const, format: 'letter' as const, orientation: 'portrait' as const }
    };

    html2pdf().set(opt).from(element).save();
  };

  const statCards = [
    { label: t('total_contracts'), value: stats.totalBudget, icon: DollarSign, color: 'text-blue-500', trend: '+0%' },
    { label: t('actual_costs'), value: stats.totalSpent, icon: TrendingDown, color: 'text-red-500', trend: '+0%' },
    { label: t('cash_collections'), value: stats.totalCollected, icon: TrendingUp, color: 'text-green-500', trend: '+0%' },
    { label: t('pending_billing'), value: stats.pendingBilling, icon: Clock, color: 'text-yellow-500', trend: t('alert') as string },
  ];

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-500 p-8 text-center">
        <Loader2 className="animate-spin text-blue-500 mb-4" size={48} />
        <p>{t('aggregating_data')}</p>
      </div>
    );
  }

  return (
    <div className={cn(
      "p-8 space-y-8 min-h-screen transition-colors", 
      theme === 'dark' ? "bg-[#0a0a0a] text-gray-100" : 
      theme === 'soft' ? "bg-[#eceff1] text-[#37474f]" :
      "bg-gray-50 text-gray-900"
    )}>
      <header className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{t('portfolio_overview')}</h2>
          <p className="text-gray-400 mt-1">{t('portfolio_subtitle')}</p>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleExportPDF}
            className={cn("px-4 py-2 rounded-md text-sm font-medium transition-colors", theme === 'dark' ? "bg-gray-800 hover:bg-gray-700" : "bg-white border border-gray-200 hover:bg-gray-50")}
          >
            {t('export_pdf')}
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-md text-sm font-medium transition-colors text-white flex items-center gap-2"
          >
            {loading && <Loader2 className="animate-spin" size={16} />}
            {t('refresh_data')}
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
            key={`${stat.label}-${i}`}
            className={cn(
              "border p-6 rounded-xl transition-all group", 
              theme === 'dark' ? "bg-[#151619] border-gray-800 hover:border-gray-700" : 
              theme === 'soft' ? "bg-white border-[#cfd8dc] hover:border-[#546e7a]" :
              "bg-white border-gray-200 hover:border-blue-200 shadow-sm"
            )}
          >
            <div className="flex justify-between items-start">
              <div className={cn("p-2 rounded-lg", theme === 'dark' ? "bg-gray-900" : theme === 'soft' ? "bg-[#eceff1]" : "bg-gray-50", stat.color)}>
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
              <h3 className="text-2xl font-bold mt-1">{stat.value.toLocaleString()} <span className="text-xs font-normal text-gray-500">{t('currency')}</span></h3>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Cash Flow Chart */}
        <div className={cn(
          "lg:col-span-2 border p-6 rounded-xl transition-colors", 
          theme === 'dark' ? "bg-[#0b0c0e] border-gray-800" : 
          theme === 'soft' ? "bg-white border-[#cfd8dc]" :
          "bg-white border-gray-200 shadow-sm"
        )}>
          <div className="flex justify-end items-center mb-6">
            <h3 className="text-lg font-bold flex items-center gap-2 flex-row-reverse" dir="rtl">
              <BarChart3 className="text-blue-500" size={20} />
              {t('cash_flow_analysis')}
            </h3>
          </div>
          <div className="h-[350px] w-full min-h-[350px]">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={50}>
              <BarChart data={chartData} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme === 'dark' ? "#1f2937" : "#e5e7eb"} opacity={0.3} />
                <XAxis 
                  dataKey="name" 
                  stroke="#4b5563" 
                  fontSize={12} 
                  tickLine={false} 
                  axisLine={false} 
                  dy={10}
                  reversed={language === 'ar'}
                />
                <YAxis 
                  stroke="#4b5563" 
                  fontSize={12} 
                  tickLine={false} 
                  axisLine={false} 
                  tickFormatter={(value) => `${value/1000}k`}
                  orientation={language === 'ar' ? "right" : "left"}
                  dx={language === 'ar' ? 10 : -10}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: theme === 'dark' ? '#111827' : theme === 'soft' ? '#ffffff' : '#ffffff', 
                    border: theme === 'dark' ? '1px solid #374151' : '1px solid #cfd8dc', 
                    borderRadius: '12px',
                    fontSize: '12px',
                    color: theme === 'dark' ? '#fff' : '#000'
                  }}
                  itemStyle={{ color: theme === 'dark' ? '#fff' : '#000' }}
                  cursor={{ fill: theme === 'dark' ? '#1f2937' : theme === 'soft' ? '#cfd8dc' : '#f3f4f6', opacity: 0.4 }}
                />
                <Legend 
                  verticalAlign="top" 
                  align={language === 'ar' ? 'right' : 'left'}
                  height={36}
                  iconType="circle"
                />
                <Bar 
                  name={t('chart_costs')}
                  dataKey="cost" 
                  fill="#ef4444" 
                  radius={[4, 4, 0, 0]} 
                  barSize={12}
                />
                <Bar 
                  name={t('chart_revenue')}
                  dataKey="revenue" 
                  fill="#3b82f6" 
                  radius={[4, 4, 0, 0]} 
                  barSize={12}
                />
                <Bar 
                  name={t('chart_collections')}
                  dataKey="collections" 
                  fill="#10b981" 
                  radius={[4, 4, 0, 0]} 
                  barSize={12}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recent Transactions */}
        <div className={cn(
          "border p-6 rounded-xl transition-colors", 
          theme === 'dark' ? "bg-[#151619] border-gray-800" : 
          theme === 'soft' ? "bg-white border-[#cfd8dc]" :
          "bg-white border-gray-200 shadow-sm"
        )}>
          <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
            <Clock className="text-blue-500" size={20} />
            {t('recent_entries')}
          </h3>
          <div className="space-y-4">
            {recentTransactions.length === 0 ? (
              <div className={cn(
                "p-8 text-center text-gray-500 border border-dashed rounded-lg",
                theme === 'dark' ? "border-gray-800" : "border-gray-200"
              )}>
                {t('no_entries')}
              </div>
            ) : (
              recentTransactions.map((t) => (
                <div key={t.id} className={cn(
                  "flex justify-between items-center p-3 rounded-lg border",
                  theme === 'dark' ? "bg-gray-900/50 border-gray-800" : 
                  theme === 'soft' ? "bg-[#eceff1] border-[#cfd8dc]" :
                  "bg-gray-50 border-gray-100"
                )}>
                  <div>
                    <p className="text-sm font-bold">{t.description}</p>
                    <p className="text-[10px] text-gray-500">{t.date}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-mono font-bold text-blue-400">
                      {t.entries.reduce((sum: number, e: JournalEntry) => sum + e.debit, 0).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
          <button type="button" className="w-full mt-6 py-2 text-sm text-blue-400 hover:text-blue-300 transition-colors font-medium">
            {t('view_all_entries')}
          </button>
        </div>
      </div>
    </div>
  );
}
