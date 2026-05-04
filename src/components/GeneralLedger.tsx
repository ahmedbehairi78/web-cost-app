import React, { useState, useEffect, useMemo } from 'react';
import { FolderTree, BookOpen, Calculator, Wallet } from 'lucide-react';
import { collection, onSnapshot, query, orderBy, where, limit } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { cn } from '../lib/utils';
import { motion } from 'motion/react';
import { useLanguage } from '../context/LanguageContext';
import { Account } from '../services/accountingService';
import { GLChartOfAccounts } from './gl/GLChartOfAccounts';
import { GLJournalEntries } from './gl/GLJournalEntries';
import { GLAccountStatement } from './gl/GLAccountStatement';
import { GLCustodySettlement } from './gl/GLCustodySettlement';

interface Project { id: string; projectName: string; projectCode: string }
interface Contract { id: string; contractName: string; contractNumber: string; projectId: string }
interface Transaction {
  id: string;
  date: string;
  description: string;
  reference: string;
  costCenterId?: string;
  entries: { accountCode: string; accountName: string; debit: number; credit: number }[];
  createdBy: string;
}

type SubTab = 'coa' | 'journal' | 'ledger' | 'custody';

export function GeneralLedger() {
  const { language, theme, dir } = useLanguage();
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('coa');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transactionLimit, setTransactionLimit] = useState(50);
  const [fiscalYear, setFiscalYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);

  const contractsMap = useMemo(() => {
    const map = new Map<string, Contract>();
    contracts.forEach(c => map.set(c.id, c));
    return map;
  }, [contracts]);

  const projectsMap = useMemo(() => {
    const map = new Map<string, Project>();
    projects.forEach(p => map.set(p.id, p));
    return map;
  }, [projects]);

  useEffect(() => {
    setLoading(true);
    const unsubAccounts = onSnapshot(
      query(collection(db, 'chart_of_accounts'), orderBy('accountCode')),
      (snap) => setAccounts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Account))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'chart_of_accounts')
    );
    const unsubProjects = onSnapshot(
      query(collection(db, 'projects'), where('isDeleted', '==', false)),
      (snap) => setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() } as Project))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'projects')
    );
    const unsubContracts = onSnapshot(
      query(collection(db, 'contracts'), where('isDeleted', '==', false)),
      (snap) => setContracts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Contract))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'contracts')
    );
    const unsubTransactions = onSnapshot(
      query(
        collection(db, 'transactions'),
        where('isDeleted', '==', false),
        where('date', '>=', `${fiscalYear}-01-01`),
        where('date', '<=', `${fiscalYear}-12-31`),
        orderBy('date', 'desc'),
        limit(transactionLimit)
      ),
      (snap) => { setTransactions(snap.docs.map(d => ({ id: d.id, ...d.data() } as Transaction))); setLoading(false); },
      (err) => handleFirestoreError(err, OperationType.LIST, 'transactions')
    );
    return () => { unsubAccounts(); unsubProjects(); unsubContracts(); unsubTransactions(); };
  }, [transactionLimit, fiscalYear]);

  const tabs: { id: SubTab; icon: React.ReactNode; label: string }[] = [
    { id: 'coa',     icon: <FolderTree size={16} />, label: language === 'ar' ? 'شجرة الحسابات' : 'Chart of Accounts' },
    { id: 'journal', icon: <BookOpen size={16} />,   label: language === 'ar' ? 'دفتر اليومية'   : 'Journal Entries' },
    { id: 'ledger',  icon: <Calculator size={16} />, label: language === 'ar' ? 'كشف حساب'       : 'Account Statement' },
    { id: 'custody', icon: <Wallet size={16} />,     label: language === 'ar' ? 'تسويات عهد'     : 'Settlement of Custody' },
  ];

  return (
    <div className={cn('p-8 min-h-screen transition-colors', theme === 'dark' ? 'bg-[#0a0a0a] text-gray-100' : theme === 'soft' ? 'bg-[#eceff1] text-[#37474f]' : 'bg-gray-50 text-gray-900')} dir={dir}>
      <header className="mb-8">
        <h2 className="text-3xl font-bold tracking-tight">{language === 'ar' ? 'الأستاذ العام' : 'General Ledger'}</h2>
        <p className="text-gray-400 mt-1">{language === 'ar' ? 'إدارة القيود المحاسبية وشجرة الحسابات' : 'Manage journal entries and chart of accounts'}</p>
      </header>

      <div className={cn('flex gap-4 mb-8 border-b', theme === 'dark' ? 'border-gray-800' : theme === 'soft' ? 'border-[#cfd8dc]' : 'border-gray-200')}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveSubTab(tab.id)} className={cn('pb-4 px-2 text-sm font-bold transition-all relative', activeSubTab === tab.id ? 'text-blue-500' : 'text-gray-500 hover:text-gray-300')}>
            <div className="flex items-center gap-2">{tab.icon}{tab.label}</div>
            {activeSubTab === tab.id && <motion.div layoutId="glActiveTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500" />}
          </button>
        ))}
      </div>

      {activeSubTab === 'coa' && (
        <GLChartOfAccounts accounts={accounts} loading={loading} theme={theme} language={language} dir={dir} />
      )}
      {activeSubTab === 'journal' && (
        <GLJournalEntries
          transactions={transactions}
          transactionLimit={transactionLimit}
          onLoadMore={() => setTransactionLimit(prev => prev + 50)}
          accounts={accounts}
          contracts={contracts}
          projects={projects}
          contractsMap={contractsMap}
          projectsMap={projectsMap}
          theme={theme}
          language={language}
          dir={dir}
          fiscalYear={fiscalYear}
          onFiscalYearChange={(y) => { setFiscalYear(y); setTransactionLimit(50); }}
        />
      )}
      {activeSubTab === 'ledger' && (
        <GLAccountStatement transactions={transactions} accounts={accounts} theme={theme} language={language} dir={dir} />
      )}
      {activeSubTab === 'custody' && (
        <GLCustodySettlement accounts={accounts} transactions={transactions} contracts={contracts} theme={theme} language={language} dir={dir} />
      )}
    </div>
  );
}
