import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { cn } from '../lib/utils';
import { useLanguage } from '../context/LanguageContext';
import { normalizeDate } from '../lib/utils';
import { AccountCodes } from '../services/accountingService';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface Contract { id: string; contractName: string; contractNumber: string; projectId: string }
interface Project  { id: string; projectName: string }
interface BillingDoc {
  id: string;
  contractId: string;
  status: string;
  worksValueExVat: number;
  vatAmount: number;
  retentionAmount?: number;
  execGuaranteeAmount?: number;
  isDeleted?: boolean;
}
interface GlEntry   { accountCode: string; debit: number; credit: number }
interface GlTx      { id: string; costCenterId?: string; entries: GlEntry[]; isDeleted?: boolean }

export function LiquidityReport() {
  const { language, theme, dir } = useLanguage();

  const [contracts,  setContracts]  = useState<Contract[]>([]);
  const [projects,   setProjects]   = useState<Project[]>([]);
  const [billing,    setBilling]    = useState<BillingDoc[]>([]);
  const [glTxs,      setGlTxs]     = useState<GlTx[]>([]);
  const [glAccounts, setGlAccounts] = useState<{ accountCode: string; accountName: string }[]>([]);
  const [loading,    setLoading]    = useState(true);

  useEffect(() => {
    setLoading(true);
    const unsubs = [
      onSnapshot(query(collection(db, 'contracts'),    where('isDeleted', '!=', true)),
        s => setContracts(s.docs.map(d => ({ id: d.id, ...d.data() } as Contract))),
        e => handleFirestoreError(e, OperationType.LIST, 'contracts')),
      onSnapshot(query(collection(db, 'projects'),     where('isDeleted', '==', false)),
        s => setProjects(s.docs.map(d => ({ id: d.id, ...d.data() } as Project))),
        e => handleFirestoreError(e, OperationType.LIST, 'projects')),
      onSnapshot(query(collection(db, 'billing'),      where('isDeleted', '!=', true)),
        s => { setBilling(s.docs.map(d => ({ id: d.id, ...d.data() } as BillingDoc))); setLoading(false); },
        e => { handleFirestoreError(e, OperationType.LIST, 'billing'); setLoading(false); }),
      onSnapshot(query(collection(db, 'transactions'), where('isDeleted', '!=', true)),
        s => setGlTxs(s.docs.map(d => ({ id: d.id, ...d.data() } as GlTx))),
        e => handleFirestoreError(e, OperationType.LIST, 'transactions')),
      onSnapshot(query(collection(db, 'chart_of_accounts'), where('isGroup', '==', false)),
        s => setGlAccounts(s.docs.map(d => ({ ...(d.data() as { accountCode: string; accountName: string }) }))),
        e => handleFirestoreError(e, OperationType.LIST, 'chart_of_accounts')),
    ];
    return () => unsubs.forEach(u => u());
  }, []);

  const projectsMap = useMemo(() => {
    const m = new Map<string, Project>();
    projects.forEach(p => m.set(p.id, p));
    return m;
  }, [projects]);

  const cashBalance = useMemo(() =>
    glTxs.reduce((sum, tx) => {
      const cashEntries = tx.entries.filter(e => e.accountCode.startsWith('111'));
      return sum + cashEntries.reduce((s, e) => s + (e.debit - e.credit), 0);
    }, 0),
  [glTxs]);

  const contractRows = useMemo(() => {
    return contracts.map(contract => {
      const billedDocs = billing.filter(b =>
        b.contractId === contract.id &&
        ['submitted', 'approved', 'paid'].includes(b.status)
      );
      const totalBilled    = billedDocs.reduce((s, b) => s + (b.worksValueExVat || 0) + (b.vatAmount || 0), 0);
      const totalRetention = billedDocs.reduce((s, b) => s + (b.retentionAmount || b.execGuaranteeAmount || 0), 0);

      const contractTxs = glTxs.filter(tx => tx.costCenterId === contract.id);

      const totalCollected = contractTxs.reduce((sum, tx) => {
        const cashDebit = tx.entries
          .filter(e => e.accountCode.startsWith('111') && e.debit > 0)
          .reduce((s, e) => s + e.debit, 0);
        const receivableCredit = tx.entries
          .filter(e => e.accountCode === AccountCodes.RECEIVABLES && e.credit > 0)
          .reduce((s, e) => s + e.credit, 0);
        return sum + Math.min(cashDebit, receivableCredit);
      }, 0);

      const totalAdvances = contractTxs.reduce((sum, tx) =>
        sum + tx.entries.filter(e => e.accountCode === AccountCodes.ADVANCE_PAYMENT && e.credit > 0).reduce((s, e) => s + e.credit, 0),
      0);

      const uncollected = totalBilled - totalCollected - totalRetention;

      return { contract, totalBilled, totalCollected, totalAdvances, totalRetention, uncollected };
    });
  }, [contracts, billing, glTxs]);

  const totals = useMemo(() =>
    contractRows.reduce((acc, r) => ({
      billed:     acc.billed     + r.totalBilled,
      collected:  acc.collected  + r.totalCollected,
      advances:   acc.advances   + r.totalAdvances,
      retention:  acc.retention  + r.totalRetention,
      uncollected:acc.uncollected + r.uncollected,
    }), { billed: 0, collected: 0, advances: 0, retention: 0, uncollected: 0 }),
  [contractRows]);

  const fmt = (n: number) => n.toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  const cardCls = cn(
    'p-5 border rounded-xl shadow-sm',
    theme === 'dark'  ? 'bg-[#151619] border-gray-800'   :
    theme === 'soft'  ? 'bg-white border-[#cfd8dc]'       :
                        'bg-white border-gray-200',
  );
  const tableBorderCls = theme === 'dark' ? 'border-gray-800' : theme === 'soft' ? 'border-[#cfd8dc]' : 'border-gray-200';
  const theadCls = theme === 'dark' ? 'bg-gray-900/40 border-gray-800' : theme === 'soft' ? 'bg-[#eceff1] border-[#cfd8dc]' : 'bg-gray-50 border-gray-200';
  const rowHoverCls = theme === 'dark' ? 'hover:bg-gray-800/30' : 'hover:bg-gray-50/60';

  return (
    <div className={cn('p-8 min-h-screen transition-colors', theme === 'dark' ? 'bg-[#0a0a0a] text-gray-100' : 'bg-gray-50 text-gray-900')} dir={dir}>

      {/* Header */}
      <header className="mb-6">
        <h2 className="text-3xl font-bold tracking-tight">{language === 'ar' ? 'تقرير السيولة' : 'Liquidity Report'}</h2>
        <p className="text-gray-400 mt-1 text-sm">
          {language === 'ar' ? 'وضع التحصيلات والمستحقات لكل عقد' : 'Collections and receivables status per contract'}
        </p>
      </header>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className={cardCls}>
          <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">{language === 'ar' ? 'رصيد النقدية والبنوك' : 'Cash & Banks Balance'}</p>
          <p className={cn('text-2xl font-black font-mono', cashBalance >= 0 ? 'text-green-500' : 'text-red-500')}>{fmt(cashBalance)}</p>
          <div className="mt-1 flex items-center gap-1 text-[10px]">
            {cashBalance > 0 ? <TrendingUp size={12} className="text-green-500" /> : cashBalance < 0 ? <TrendingDown size={12} className="text-red-500" /> : <Minus size={12} className="text-gray-500" />}
            <span className="text-gray-500">{language === 'ar' ? 'إجمالي حسابات 111xxx' : 'All 111xxx accounts'}</span>
          </div>
        </div>
        <div className={cardCls}>
          <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">{language === 'ar' ? 'إجمالي المستخلصات' : 'Total Billed'}</p>
          <p className="text-2xl font-black font-mono text-blue-500">{fmt(totals.billed)}</p>
        </div>
        <div className={cardCls}>
          <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">{language === 'ar' ? 'إجمالي التحصيلات' : 'Total Collected'}</p>
          <p className="text-2xl font-black font-mono text-green-500">{fmt(totals.collected)}</p>
        </div>
        <div className={cardCls}>
          <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">{language === 'ar' ? 'غير محصل (صافي)' : 'Net Uncollected'}</p>
          <p className={cn('text-2xl font-black font-mono', totals.uncollected > 0 ? 'text-orange-500' : 'text-gray-400')}>{fmt(totals.uncollected)}</p>
        </div>
      </div>

      {/* Per-contract table */}
      <div className={cn('border rounded-2xl overflow-hidden shadow-sm', theme === 'dark' ? 'bg-[#151619] border-gray-800' : 'bg-white border-gray-200')}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className={cn('border-b text-xs font-black text-gray-400 uppercase', theadCls)}>
                <th className="px-5 py-3 text-start">{language === 'ar' ? 'العقد' : 'Contract'}</th>
                <th className="px-5 py-3 text-start">{language === 'ar' ? 'المشروع' : 'Project'}</th>
                <th className="px-5 py-3 text-end">{language === 'ar' ? 'المستخلصات' : 'Billed'}</th>
                <th className="px-5 py-3 text-end">{language === 'ar' ? 'التحصيلات' : 'Collected'}</th>
                <th className="px-5 py-3 text-end">{language === 'ar' ? 'دفعات مقدمة' : 'Advances'}</th>
                <th className="px-5 py-3 text-end">{language === 'ar' ? 'المحتجزات' : 'Retention'}</th>
                <th className="px-5 py-3 text-end">{language === 'ar' ? 'غير محصل' : 'Uncollected'}</th>
                <th className="px-5 py-3 text-end">{language === 'ar' ? 'نسبة التحصيل' : 'Collection %'}</th>
              </tr>
            </thead>
            <tbody className={cn('divide-y', tableBorderCls)}>
              {loading ? (
                <tr><td colSpan={8} className="py-12 text-center text-gray-500">{language === 'ar' ? 'جاري التحميل...' : 'Loading...'}</td></tr>
              ) : contractRows.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-gray-500">{language === 'ar' ? 'لا توجد عقود.' : 'No contracts.'}</td></tr>
              ) : contractRows.map(({ contract, totalBilled, totalCollected, totalAdvances, totalRetention, uncollected }) => {
                const collectionPct = totalBilled > 0 ? (totalCollected / totalBilled) * 100 : 0;
                const project = projectsMap.get(contract.projectId);
                return (
                  <tr key={contract.id} className={cn('transition-colors', rowHoverCls)}>
                    <td className="px-5 py-3 font-semibold">
                      <div>{contract.contractName}</div>
                      <div className="text-[10px] text-gray-500 font-mono">{contract.contractNumber}</div>
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{project?.projectName || '—'}</td>
                    <td className="px-5 py-3 font-mono text-end">{fmt(totalBilled)}</td>
                    <td className="px-5 py-3 font-mono text-end text-green-500">{fmt(totalCollected)}</td>
                    <td className="px-5 py-3 font-mono text-end text-blue-400">{fmt(totalAdvances)}</td>
                    <td className="px-5 py-3 font-mono text-end text-orange-400">{fmt(totalRetention)}</td>
                    <td className={cn('px-5 py-3 font-mono font-bold text-end', uncollected > 0 ? 'text-red-400' : 'text-gray-400')}>
                      {fmt(uncollected)}
                    </td>
                    <td className="px-5 py-3 text-end">
                      <div className="flex items-center justify-end gap-2">
                        <div className={cn('w-20 h-1.5 rounded-full overflow-hidden', theme === 'dark' ? 'bg-gray-800' : 'bg-gray-200')}>
                          <div className="h-full bg-green-500 rounded-full" style={{ width: `${Math.min(100, collectionPct)}%` }} />
                        </div>
                        <span className="text-xs font-mono w-10 text-end">{collectionPct.toFixed(0)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {contractRows.length > 0 && (
              <tfoot>
                <tr className={cn('border-t font-black text-sm', theadCls)}>
                  <td className="px-5 py-3" colSpan={2}>{language === 'ar' ? 'الإجمالي' : 'Total'}</td>
                  <td className="px-5 py-3 font-mono text-end">{fmt(totals.billed)}</td>
                  <td className="px-5 py-3 font-mono text-end text-green-500">{fmt(totals.collected)}</td>
                  <td className="px-5 py-3 font-mono text-end text-blue-400">{fmt(totals.advances)}</td>
                  <td className="px-5 py-3 font-mono text-end text-orange-400">{fmt(totals.retention)}</td>
                  <td className={cn('px-5 py-3 font-mono text-end', totals.uncollected > 0 ? 'text-red-400' : 'text-gray-400')}>{fmt(totals.uncollected)}</td>
                  <td className="px-5 py-3" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
