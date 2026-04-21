import React, { useState, useEffect, useMemo } from 'react';
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
  AlertCircle,
  Loader2,
  ChevronLast,
  Wallet,
  FileUp,
  FileDown
} from 'lucide-react';
import { collection, onSnapshot, query, orderBy, addDoc, where, serverTimestamp, limit, getDocs } from 'firebase/firestore';
// @ts-ignore
import * as XLSX from 'xlsx';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../context/LanguageContext';
// @ts-ignore
import html2pdf from 'html2pdf.js';
import { accountingService, Account, Transaction as ServiceTransaction, JournalEntry } from '../services/accountingService';

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
  }[];
  createdBy: string;
}

export function GeneralLedger() {
  const { t, language, theme, dir } = useLanguage();
  const [activeSubTab, setActiveSubTab] = useState<'coa' | 'journal' | 'ledger' | 'custody'>('coa');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transactionLimit, setTransactionLimit] = useState(50);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['1', '2', '3', '4', '5']));
  
  // Modal States
  const [isEntryModalOpen, setIsEntryModalOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isContractModalOpen, setIsContractModalOpen] = useState(false);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedLedgerAccount, setSelectedLedgerAccount] = useState<string>('');
  const [ledgerAccountTransactions, setLedgerAccountTransactions] = useState<Transaction[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  // Custody Settlement State
  const [selectedCustodyAccount, setSelectedCustodyAccount] = useState<string>('');
  const [custodySettlement, setCustodySettlement] = useState({
    date: new Date().toISOString().split('T')[0],
    description: language === 'ar' ? 'تسوية عهدة' : 'Custody Settlement',
    items: [{ id: crypto.randomUUID(), accountCode: '', accountName: '', amount: 0, description: '' }]
  });

  // Optimized lookups
  const contractsMap = useMemo(() => {
    const map = new Map();
    contracts.forEach(c => map.set(c.id, c));
    return map;
  }, [contracts]);

  const projectsMap = useMemo(() => {
    const map = new Map();
    projects.forEach(p => map.set(p.id, p));
    return map;
  }, [projects]);
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });
  const [entryForm, setEntryForm] = useState({
    date: new Date().toISOString().split('T')[0],
    description: '',
    costCenterId: '',
    entries: [
      { id: crypto.randomUUID(), accountCode: '', debit: 0, credit: 0 },
      { id: crypto.randomUUID(), accountCode: '', debit: 0, credit: 0 }
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

  const [accountForm, setAccountForm] = useState({
    accountCode: '',
    accountName: '',
    parentCode: '',
    type: 'asset' as const,
    isGroup: false,
    status: 'active' as const,
  });

  useEffect(() => {
    setLoading(true);
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
      query(collection(db, 'transactions'), where('isDeleted', '==', false), orderBy('date', 'desc'), limit(transactionLimit)),
      (snapshot) => {
        setTransactions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction)));
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
  }, [transactionLimit]);

  useEffect(() => {
    if (!selectedLedgerAccount) {
      setLedgerAccountTransactions([]);
      return;
    }
    setLedgerLoading(true);
    getDocs(
      query(collection(db, 'transactions'), where('isDeleted', '==', false), orderBy('date', 'asc'))
    ).then(snapshot => {
      const all = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
      setLedgerAccountTransactions(
        all.filter(tx => tx.entries.some(e => e.accountCode === selectedLedgerAccount))
      );
      setLedgerLoading(false);
    }).catch(err => {
      handleFirestoreError(err, OperationType.LIST, 'transactions');
      setLedgerLoading(false);
    });
  }, [selectedLedgerAccount]);

  const handleExportLedgerPDF = () => {
    if (!selectedLedgerAccount) return;
    
    const account = accounts.find(a => a.accountCode === selectedLedgerAccount);
    const isAr = language === 'ar';
    const element = document.createElement('div');
    element.dir = isAr ? 'rtl' : 'ltr';
    element.style.padding = '40px';
    element.style.backgroundColor = '#ffffff';
    element.style.color = '#000000';
    element.style.fontFamily = isAr ? 'Arial, sans-serif' : 'inherit';

    let runningBalance = 0;
    const accountTransactions = ledgerAccountTransactions;

    element.innerHTML = `
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="font-size: 24px; color: #1e3a8a; margin-bottom: 5px;">${isAr ? 'كشف حساب تفصيلي' : 'Detailed Account Statement'}</h1>
        <p style="font-size: 18px; font-weight: bold;">${account?.accountCode} - ${account?.accountName}</p>
        <p style="color: #666; font-size: 12px;">${new Date().toLocaleDateString(isAr ? 'ar-EG' : 'en-US')}</p>
      </div>

      <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
        <thead>
          <tr style="background-color: #f8fafc; border-bottom: 2px solid #1e3a8a;">
            <th style="padding: 10px; border: 1px solid #e2e8f0; text-align: ${isAr ? 'right' : 'left'};">${isAr ? 'التاريخ' : 'Date'}</th>
            <th style="padding: 10px; border: 1px solid #e2e8f0; text-align: ${isAr ? 'right' : 'left'};">${isAr ? 'البيان' : 'Description'}</th>
            <th style="padding: 10px; border: 1px solid #e2e8f0; text-align: center;">${isAr ? 'مدين' : 'Debit'}</th>
            <th style="padding: 10px; border: 1px solid #e2e8f0; text-align: center;">${isAr ? 'دائن' : 'Credit'}</th>
            <th style="padding: 10px; border: 1px solid #e2e8f0; text-align: center;">${isAr ? 'الرصيد' : 'Balance'}</th>
          </tr>
        </thead>
        <tbody>
          ${accountTransactions.map(tx => {
            const entry = tx.entries.find(e => e.accountCode === selectedLedgerAccount)!;
            runningBalance += (entry.debit - entry.credit);
            return `
              <tr>
                <td style="padding: 8px; border: 1px solid #e2e8f0;">${tx.date}</td>
                <td style="padding: 8px; border: 1px solid #e2e8f0;">${tx.description}</td>
                <td style="padding: 8px; border: 1px solid #e2e8f0; text-align: center; color: #3b82f6;">${entry.debit > 0 ? entry.debit.toLocaleString() : '-'}</td>
                <td style="padding: 8px; border: 1px solid #e2e8f0; text-align: center; color: #ef4444;">${entry.credit > 0 ? entry.credit.toLocaleString() : '-'}</td>
                <td style="padding: 8px; border: 1px solid #e2e8f0; text-align: center; font-weight: bold; color: ${runningBalance >= 0 ? '#10b981' : '#ef4444'};">
                  ${runningBalance.toLocaleString()}
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;

    const opt = {
      margin: 0.5,
      filename: `Ledger_${selectedLedgerAccount}_${new Date().toISOString().split('T')[0]}.pdf`,
      image: { type: 'jpeg' as const, quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'in' as const, format: 'letter' as const, orientation: 'portrait' as const }
    };

    html2pdf().set(opt).from(element).save();
  };

  const handleExportTransactionPDF = (tx: Transaction) => {
    const isAr = language === 'ar';
    const element = document.createElement('div');
    element.dir = isAr ? 'rtl' : 'ltr';
    element.style.padding = '40px';
    element.style.backgroundColor = '#ffffff';
    element.style.color = '#000000';
    element.style.fontFamily = isAr ? 'Arial, sans-serif' : 'inherit';

    const contract = contractsMap.get(tx.costCenterId);
    const project = projectsMap.get(contract?.projectId);

    element.innerHTML = `
      <div style="text-align: center; margin-bottom: 30px; border-bottom: 2px solid #1e3a8a; padding-bottom: 10px;">
        <h1 style="font-size: 24px; color: #1e3a8a; margin-bottom: 5px;">${isAr ? 'قيد محاسبي' : 'Journal Entry'}</h1>
        <p style="font-size: 14px; color: #666;">${tx.reference}</p>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; font-size: 14px;">
        <div>
          <p><strong>${isAr ? 'التاريخ:' : 'Date:'}</strong> ${tx.date}</p>
          <p><strong>${isAr ? 'البيان:' : 'Description:'}</strong> ${tx.description}</p>
        </div>
        <div>
          <p><strong>${isAr ? 'مركز التكلفة:' : 'Cost Center:'}</strong> ${contract ? `${contract.contractName} (${project?.projectName || '...'})` : '-'}</p>
        </div>
      </div>

      <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
        <thead>
          <tr style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0;">
            <th style="padding: 10px; border: 1px solid #e2e8f0; text-align: ${isAr ? 'right' : 'left'};">${isAr ? 'الحساب' : 'Account'}</th>
            <th style="padding: 10px; border: 1px solid #e2e8f0; text-align: center;">${isAr ? 'مدين' : 'Debit'}</th>
            <th style="padding: 10px; border: 1px solid #e2e8f0; text-align: center;">${isAr ? 'دائن' : 'Credit'}</th>
          </tr>
        </thead>
        <tbody>
          ${tx.entries.map(entry => `
            <tr>
              <td style="padding: 8px; border: 1px solid #e2e8f0;">
                <div>${entry.accountName}</div>
                <div style="font-size: 10px; color: #666;">${entry.accountCode}</div>
              </td>
              <td style="padding: 8px; border: 1px solid #e2e8f0; text-align: center; color: #3b82f6;">${entry.debit > 0 ? entry.debit.toLocaleString() : '-'}</td>
              <td style="padding: 8px; border: 1px solid #e2e8f0; text-align: center; color: #ef4444;">${entry.credit > 0 ? entry.credit.toLocaleString() : '-'}</td>
            </tr>
          `).join('')}
        </tbody>
        <tfoot>
          <tr style="background-color: #f8fafc; font-weight: bold;">
            <td style="padding: 10px; border: 1px solid #e2e8f0;">${isAr ? 'الإجمالي' : 'Total'}</td>
            <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center; color: #3b82f6;">${tx.entries.reduce((sum, e) => sum + e.debit, 0).toLocaleString()}</td>
            <td style="padding: 10px; border: 1px solid #e2e8f0; text-align: center; color: #ef4444;">${tx.entries.reduce((sum, e) => sum + e.credit, 0).toLocaleString()}</td>
          </tr>
        </tfoot>
      </table>
    `;

    const opt = {
      margin: 0.5,
      filename: `Entry_${tx.reference}.pdf`,
      image: { type: 'jpeg' as const, quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'in' as const, format: 'letter' as const, orientation: 'portrait' as const }
    };

    html2pdf().set(opt).from(element).save();
  };

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

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'chart_of_accounts'), {
        ...accountForm,
        createdAt: serverTimestamp(),
      });
      setIsAccountModalOpen(false);
      setAccountForm({
        accountCode: '',
        accountName: '',
        parentCode: '',
        type: 'asset',
        isGroup: false,
        status: 'active',
      });
    } catch (error) {
      console.error('Save Account Error:', error);
      alert(language === 'ar' ? 'فشل حفظ الحساب. يرجى التأكد من صلاحيات قاعدة البيانات.' : 'Failed to save account. Please check database permissions.');
      handleFirestoreError(error, OperationType.CREATE, 'chart_of_accounts');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteTransaction = (tx: Transaction) => {
    setConfirmConfig({
      isOpen: true,
      title: language === 'ar' ? 'تأكيد الحذف' : 'Confirm Delete',
      message: language === 'ar' ? 'هل أنت متأكد من حذف هذا القيد؟ لا يمكن التراجع عن هذه العملية.' : 'Are you sure you want to delete this entry? This action cannot be undone.',
      onConfirm: async () => {
        setIsSubmitting(true);
        try {
          await accountingService.deleteTransaction(tx.id);
          setSelectedTransaction(null);
          setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, 'transactions');
        } finally {
          setIsSubmitting(false);
        }
      }
    });
  };

  const handleAddEntryLine = () => {
    setEntryForm({
      ...entryForm,
      entries: [...entryForm.entries, { id: crypto.randomUUID(), accountCode: '', debit: 0, credit: 0 }]
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
    // @ts-ignore
    newEntries[index] = { ...newEntries[index], [field]: value };
    
    if (field === 'accountCode') {
      const account = accounts.find(a => a.accountCode === value);
      if (account) {
        // @ts-ignore
        newEntries[index].accountName = account.accountName;
      }
    }
    
    setEntryForm({ ...entryForm, entries: newEntries });
  };

  const handleCustodyItemChange = (index: number, field: string, value: any) => {
    const newItems = [...custodySettlement.items];
    // @ts-ignore
    newItems[index] = { ...newItems[index], [field]: value };
    
    if (field === 'accountCode') {
      const account = accounts.find(a => a.accountCode === value);
      if (account) {
        // @ts-ignore
        newItems[index].accountName = account.accountName;
      }
    }
    
    setCustodySettlement({ ...custodySettlement, items: newItems });
  };

  const handleSaveCustodySettlement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustodyAccount || custodySettlement.items.length === 0) return;

    const totalAmount = custodySettlement.items.reduce((sum, item) => sum + Number(item.amount), 0);
    if (totalAmount <= 0) return;

    setIsSubmitting(true);
    try {
      const custodyAcc = accounts.find(a => a.accountCode === selectedCustodyAccount);
      
      const entries = [
        // Credit the custody account
        {
          accountCode: selectedCustodyAccount,
          accountName: custodyAcc?.accountName || '',
          debit: 0,
          credit: totalAmount
        },
        // Debit the expense accounts
        ...custodySettlement.items.map(item => ({
          accountCode: item.accountCode,
          accountName: item.accountName,
          debit: Number(item.amount),
          credit: 0
        }))
      ];

      await accountingService.createTransaction({
        date: custodySettlement.date,
        description: custodySettlement.description,
        reference: `SET-${Date.now().toString().slice(-6)}`,
        entries
      });

      setCustodySettlement({
        date: new Date().toISOString().split('T')[0],
        description: language === 'ar' ? 'تسوية عهدة' : 'Custody Settlement',
        items: [{ id: crypto.randomUUID(), accountCode: '', accountName: '', amount: 0, description: '' }]
      });
      alert(language === 'ar' ? 'تم حفظ التسوية بنجاح' : 'Settlement saved successfully');
    } catch (error) {
      console.error('Custody Settlement error:', error);
      handleFirestoreError(error, OperationType.CREATE, 'transactions');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExportCustodyExcel = () => {
    const ws = XLSX.utils.json_to_sheet(custodySettlement.items.map(item => ({
      'Account Code': item.accountCode,
      'Account Name': item.accountName,
      'Amount': item.amount,
      'Description': item.description
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "CustodySettlement");
    XLSX.writeFile(wb, `Custody_Settlement_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleImportCustodyExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target?.result as string;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = XLSX.utils.sheet_to_json(ws);
      
      const importedItems = data.map((row: any) => ({
        id: crypto.randomUUID(),
        accountCode: String(row['Account Code'] || row['كود الحساب'] || ''),
        accountName: String(row['Account Name'] || row['اسم الحساب'] || ''),
        amount: Number(row['Amount'] || row['المبلغ'] || 0),
        description: String(row['Description'] || row['البيان'] || '')
      })).filter(item => item.accountCode && item.amount > 0);

      if (importedItems.length > 0) {
        setCustodySettlement(prev => ({
          ...prev,
          items: importedItems
        }));
      }
    };
    reader.readAsBinaryString(file);
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
        entries: [
          { id: crypto.randomUUID(), accountCode: '', debit: 0, credit: 0 }, 
          { id: crypto.randomUUID(), accountCode: '', debit: 0, credit: 0 }
        ]
      });
    } catch (error) {
      console.error('Save Entry Error:', error);
      alert(language === 'ar' ? 'فشل حفظ القيد. يرجى المحاولة مرة أخرى.' : 'Failed to save entry. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleAccountStatus = async (acc: Account) => {
    const newStatus = acc.status === 'disabled' ? 'active' : 'disabled';
    try {
      await accountingService.updateAccount(acc.id, { status: newStatus });
    } catch (error) {
      console.error('Toggle Status Error:', error);
      handleFirestoreError(error, OperationType.UPDATE, 'chart_of_accounts');
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
              "flex items-center gap-2 py-2 px-4 cursor-pointer border-b transition-colors group",
              theme === 'dark' ? "hover:bg-gray-800/50 border-gray-800/30" : 
              theme === 'soft' ? "hover:bg-white/50 border-[#cfd8dc]" :
              "hover:bg-gray-100 border-gray-100",
              level === 0 && (
                theme === 'dark' ? "bg-gray-900/30 font-bold text-blue-400" :
                theme === 'soft' ? "bg-white/40 font-bold text-blue-600" :
                "bg-gray-200/50 font-bold text-blue-700"
              ),
              acc.status === 'disabled' && "opacity-40 grayscale"
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
            <span className={cn("flex-1", acc.status === 'disabled' && "line-through")}>{acc.accountName}</span>
            
            <div className="flex items-center gap-4 opacity-0 group-hover:opacity-100 transition-opacity">
              {acc.status === 'disabled' ? (
                <button 
                  onClick={(e) => { e.stopPropagation(); handleToggleAccountStatus(acc); }}
                  className="text-[10px] bg-green-600/20 text-green-500 px-2 py-0.5 rounded font-bold hover:bg-green-600/30 transition-colors"
                >
                  {language === 'ar' ? 'تفعيل' : 'Activate'}
                </button>
              ) : (
                <button 
                  onClick={(e) => { e.stopPropagation(); handleToggleAccountStatus(acc); }}
                  className="text-[10px] bg-red-600/20 text-red-500 px-2 py-0.5 rounded font-bold hover:bg-red-600/30 transition-colors"
                >
                  {language === 'ar' ? 'تعطيل' : 'Disable'}
                </button>
              )}
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
    const initialAccounts = [
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

    for (const acc of initialAccounts) {
      await addDoc(collection(db, 'chart_of_accounts'), acc);
    }
  };

  const handleExportCOAExcel = () => {
    const ws = XLSX.utils.json_to_sheet(accounts.map(acc => ({
      'Account Code': acc.accountCode,
      'Account Name': acc.accountName,
      'Parent Code': acc.parentCode,
      'Type': acc.type,
      'Is Group': acc.isGroup ? 'Yes' : 'No',
      'Status': acc.status || 'active'
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ChartOfAccounts");
    XLSX.writeFile(wb, `COA_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleImportCOAExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const bstr = evt.target?.result as string;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = XLSX.utils.sheet_to_json(ws);
      
      setIsSubmitting(true);
      try {
        for (const row of data as any[]) {
          const acc = {
            accountCode: String(row['Account Code'] || row['كود الحساب'] || ''),
            accountName: String(row['Account Name'] || row['اسم الحساب'] || ''),
            parentCode: String(row['Parent Code'] || row['الحساب الأب'] || ''),
            type: (row['Type'] || row['النوع'] || 'asset').toLowerCase(),
            isGroup: (row['Is Group'] || row['مجموعة'] || 'No').toLowerCase() === 'yes',
            createdAt: serverTimestamp()
          };
          
          if (acc.accountCode && acc.accountName) {
            await addDoc(collection(db, 'chart_of_accounts'), acc);
          }
        }
        alert(language === 'ar' ? 'تم استيراد الحسابات بنجاح' : 'Accounts imported successfully');
      } catch (error) {
        console.error('Import COA Excel error:', error);
        handleFirestoreError(error, OperationType.CREATE, 'chart_of_accounts');
      } finally {
        setIsSubmitting(false);
      }
    };
    reader.readAsBinaryString(file);
  };

  return (
    <div className={cn(
      "p-8 min-h-screen transition-colors", 
      theme === 'dark' ? "bg-[#0a0a0a] text-gray-100" : 
      theme === 'soft' ? "bg-[#eceff1] text-[#37474f]" :
      "bg-gray-50 text-gray-900"
    )} dir={dir}>
      <header className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{language === 'ar' ? 'الأستاذ العام' : 'General Ledger'}</h2>
          <p className="text-gray-400 mt-1">{language === 'ar' ? 'إدارة القيود المحاسبية وشجرة الحسابات' : 'Manage journal entries and chart of accounts'}</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => {
              if (activeSubTab === 'coa') {
                setIsAccountModalOpen(true);
              } else {
                setIsEntryModalOpen(true);
              }
            }}
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
              className={cn(
                "border rounded-2xl w-full max-w-4xl overflow-hidden shadow-2xl transition-colors",
                theme === 'dark' ? "bg-[#151619] border-gray-800" : 
                theme === 'soft' ? "bg-white border-[#cfd8dc]" : 
                "bg-white border-gray-200"
              )}
            >
              <div className={cn(
                "p-6 border-b flex justify-between items-center transition-colors",
                theme === 'dark' ? "bg-gray-900/50 border-gray-800" : 
                theme === 'soft' ? "bg-[#eceff1] border-[#cfd8dc]" : 
                "bg-gray-50 border-gray-200"
              )}>
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
                      className={cn(
                        "w-full border rounded-lg py-2.5 px-4 text-sm outline-none focus:border-blue-500 transition-colors",
                        theme === 'dark' ? "bg-gray-900 border-gray-800" : 
                        theme === 'soft' ? "bg-white border-[#cfd8dc]" : 
                        "bg-white border-gray-300 text-gray-900"
                      )}
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
                      className={cn(
                        "w-full border rounded-lg py-2.5 px-4 text-sm outline-none focus:border-blue-500 transition-colors",
                        theme === 'dark' ? "bg-gray-900 border-gray-800" : 
                        theme === 'soft' ? "bg-white border-[#cfd8dc]" : 
                        "bg-white border-gray-300 text-gray-900"
                      )}
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
                    className={cn(
                      "w-full border rounded-lg py-2.5 px-4 text-sm outline-none focus:border-blue-500 transition-colors appearance-none",
                      theme === 'dark' ? "bg-gray-900 border-gray-800" : 
                      theme === 'soft' ? "bg-white border-[#cfd8dc]" : 
                      "bg-white border-gray-300 text-gray-900"
                    )}
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
                      <div key={entry.id} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                        <div className="md:col-span-5 space-y-1">
                          <label className="text-[10px] text-gray-500 uppercase">{language === 'ar' ? 'الحساب' : 'Account'}</label>
                          <select 
                            required
                            className={cn(
                              "w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500 transition-colors",
                              theme === 'dark' ? "bg-gray-900 border-gray-800" : 
                              theme === 'soft' ? "bg-white border-[#cfd8dc]" : 
                              "bg-white border-gray-300 text-gray-900"
                            )}
                            value={entry.accountCode}
                            onChange={(e) => handleEntryChange(idx, 'accountCode', e.target.value)}
                          >
                            <option value="">{language === 'ar' ? 'اختر الحساب' : 'Select Account'}</option>
                            {accounts.filter(acc => !acc.isGroup && acc.status !== 'disabled').map(acc => (
                              <option key={acc.id} value={acc.accountCode}>{acc.accountCode} - {acc.accountName}</option>
                            ))}
                          </select>
                        </div>
                        <div className="md:col-span-3 space-y-1">
                          <label className="text-[10px] text-gray-500 uppercase">{language === 'ar' ? 'مدين' : 'Debit'}</label>
                          <input 
                            type="number" 
                            step="0.01"
                            className={cn(
                              "w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500 transition-colors",
                              theme === 'dark' ? "bg-gray-900 border-gray-800 text-blue-400" : 
                              theme === 'soft' ? "bg-white border-[#cfd8dc] text-blue-600" : 
                              "bg-white border-gray-300 text-blue-700"
                            )}
                            value={entry.debit}
                            onChange={(e) => handleEntryChange(idx, 'debit', e.target.value)}
                          />
                        </div>
                        <div className="md:col-span-3 space-y-1">
                          <label className="text-[10px] text-gray-500 uppercase">{language === 'ar' ? 'دائن' : 'Credit'}</label>
                          <input 
                            type="number" 
                            step="0.01"
                            className={cn(
                              "w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500 transition-colors",
                              theme === 'dark' ? "bg-gray-900 border-gray-800 text-red-400" : 
                              theme === 'soft' ? "bg-white border-[#cfd8dc] text-red-600" : 
                              "bg-white border-gray-300 text-red-700"
                            )}
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

                <div className={cn(
                  "pt-6 border-t flex justify-between items-center transition-colors",
                  theme === 'dark' ? "border-gray-800" : theme === 'soft' ? "border-[#cfd8dc]" : "border-gray-200"
                )}>
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
                      className={cn(
                        "px-8 py-3 rounded-xl font-bold transition-all",
                        theme === 'dark' ? "bg-gray-800 hover:bg-gray-700" : 
                        theme === 'soft' ? "bg-[#eceff1] hover:bg-[#cfd8dc] text-[#37474f]" : 
                        "bg-gray-100 hover:bg-gray-200 text-gray-900"
                      )}
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

      {/* New Account Modal */}
      <AnimatePresence>
        {isAccountModalOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#1a1b1e] border border-gray-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-gray-800 flex justify-between items-center">
                <h3 className="text-lg font-bold">{language === 'ar' ? 'إضافة حساب جديد' : 'Add New Account'}</h3>
                <button onClick={() => setIsAccountModalOpen(false)} className="text-gray-500 hover:text-white">
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleSaveAccount} className="p-6 space-y-4">
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'كود الحساب' : 'Account Code'}</label>
                  <input 
                    required
                    type="text" 
                    className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500"
                    placeholder="e.g. 1101"
                    value={accountForm.accountCode}
                    onChange={(e) => setAccountForm({...accountForm, accountCode: e.target.value})}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'اسم الحساب' : 'Account Name'}</label>
                  <input 
                    required
                    type="text" 
                    className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500"
                    value={accountForm.accountName}
                    onChange={(e) => setAccountForm({...accountForm, accountName: e.target.value})}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'الحساب الأب' : 'Parent Account'}</label>
                  <select 
                    className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500 appearance-none"
                    value={accountForm.parentCode}
                    onChange={(e) => setAccountForm({...accountForm, parentCode: e.target.value})}
                  >
                    <option value="">{language === 'ar' ? 'بدون (حساب رئيسي)' : 'None (Main Account)'}</option>
                    {accounts.filter(a => a.isGroup).map(a => (
                      <option key={a.id} value={a.accountCode}>{a.accountCode} - {a.accountName}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'النوع' : 'Type'}</label>
                    <select 
                      required
                      className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500 appearance-none"
                      value={accountForm.type}
                      onChange={(e) => setAccountForm({...accountForm, type: e.target.value as any})}
                    >
                      <option value="asset">{language === 'ar' ? 'أصول' : 'Asset'}</option>
                      <option value="liability">{language === 'ar' ? 'خصوم' : 'Liability'}</option>
                      <option value="equity">{language === 'ar' ? 'حقوق ملكية' : 'Equity'}</option>
                      <option value="revenue">{language === 'ar' ? 'إيرادات' : 'Revenue'}</option>
                      <option value="expense">{language === 'ar' ? 'مصروفات' : 'Expense'}</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2 pt-6">
                    <input 
                      type="checkbox"
                      id="isGroup"
                      className="rounded border-gray-800 bg-gray-900 text-blue-600 focus:ring-blue-500"
                      checked={accountForm.isGroup}
                      onChange={(e) => setAccountForm({...accountForm, isGroup: e.target.checked})}
                    />
                    <label htmlFor="isGroup" className="text-sm font-medium">{language === 'ar' ? 'حساب رئيسي' : 'Group Account'}</label>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'الحالة' : 'Status'}</label>
                  <select 
                    className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500 appearance-none"
                    value={accountForm.status}
                    onChange={(e) => setAccountForm({...accountForm, status: e.target.value as any})}
                  >
                    <option value="active">{language === 'ar' ? 'نشط' : 'Active'}</option>
                    <option value="disabled">{language === 'ar' ? 'معطل' : 'Disabled'}</option>
                  </select>
                </div>
                <div className="pt-4 flex gap-3">
                  <button 
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 py-2 rounded-lg font-bold transition-colors text-white"
                  >
                    {isSubmitting ? (language === 'ar' ? 'جاري الحفظ...' : 'Saving...') : (language === 'ar' ? 'حفظ الحساب' : 'Save Account')}
                  </button>
                  <button 
                    type="button"
                    onClick={() => setIsAccountModalOpen(false)}
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
      <div className={cn(
        "flex gap-4 mb-8 border-b",
        theme === 'dark' ? "border-gray-800" : theme === 'soft' ? "border-[#cfd8dc]" : "border-gray-200"
      )}>
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
        <button 
          onClick={() => setActiveSubTab('custody')}
          className={cn(
            "pb-4 px-2 text-sm font-bold transition-all relative",
            activeSubTab === 'custody' ? "text-blue-500" : "text-gray-500 hover:text-gray-300"
          )}
        >
          <div className="flex items-center gap-2">
            <Wallet size={16} />
            {language === 'ar' ? 'تسويات عهد' : 'Settlement of Custody'}
          </div>
          {activeSubTab === 'custody' && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500" />}
        </button>
      </div>

      {activeSubTab === 'custody' && (
        <div className="space-y-6">
          <div className={cn(
            "p-6 border rounded-xl shadow-sm transition-colors", 
            theme === 'dark' ? "bg-[#151619] border-gray-800" : 
            theme === 'soft' ? "bg-white border-[#cfd8dc]" : 
            "bg-white border-gray-200"
          )}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-xs font-bold text-gray-500 uppercase">
                    {language === 'ar' ? 'اختر العهدة' : 'Select Custody Account'}
                  </label>
                  <button 
                    type="button"
                    onClick={() => setIsAccountModalOpen(true)}
                    className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
                  >
                    <Plus size={12} />
                    {language === 'ar' ? 'حساب جديد' : 'New Account'}
                  </button>
                </div>
                <select
                  value={selectedCustodyAccount}
                  onChange={(e) => setSelectedCustodyAccount(e.target.value)}
                  className={cn(
                    "w-full px-4 py-2 rounded-lg border focus:ring-2 focus:ring-blue-500 outline-none transition-all",
                    theme === 'dark' ? "bg-gray-900 border-gray-800 text-white" : "bg-gray-50 border-gray-200"
                  )}
                >
                  <option value="">{language === 'ar' ? '--- اختر عهدة ---' : '--- Select a Custody ---'}</option>
                  {accounts.filter(a => !a.isGroup && a.status !== 'disabled' && (a.accountName.includes('عهدة') || a.accountName.includes('Custody') || a.accountCode.startsWith('1'))).map(acc => (
                    <option key={acc.id} value={acc.accountCode}>
                      {acc.accountCode} - {acc.accountName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">
                  {language === 'ar' ? 'رصيد العهدة الحالي' : 'Current Custody Balance'}
                </label>
                <div className={cn("px-4 py-2 rounded-lg border font-mono font-bold text-lg", theme === 'dark' ? "bg-gray-900 border-gray-800 text-blue-400" : "bg-gray-50 border-gray-200 text-blue-600")}>
                  {(() => {
                    if (!selectedCustodyAccount) return '0.00';
                    const balance = transactions.reduce((sum, tx) => {
                      const entries = tx.entries.filter(e => e.accountCode === selectedCustodyAccount);
                      return sum + entries.reduce((s, e) => s + (e.debit - e.credit), 0);
                    }, 0);
                    return balance.toLocaleString(undefined, { minimumFractionDigits: 2 });
                  })()}
                </div>
              </div>
              <div className="flex items-end gap-2">
                <button 
                  onClick={handleExportCustodyExcel}
                  className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-2 text-white"
                >
                  <FileDown size={16} />
                  {language === 'ar' ? 'تصدير إكسل' : 'Export Excel'}
                </button>
                <label className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-2 text-white cursor-pointer">
                  <FileUp size={16} />
                  {language === 'ar' ? 'استيراد إكسل' : 'Import Excel'}
                  <input type="file" className="hidden" accept=".xlsx, .xls" onChange={handleImportCustodyExcel} />
                </label>
              </div>
            </div>
          </div>

          <div className={cn(
            "p-6 border rounded-xl shadow-sm transition-colors", 
            theme === 'dark' ? "bg-[#151619] border-gray-800" : 
            theme === 'soft' ? "bg-white border-[#cfd8dc]" : 
            "bg-white border-gray-200"
          )}>
            <form onSubmit={handleSaveCustodySettlement} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 font-bold uppercase">{language === 'ar' ? 'تاريخ التسوية' : 'Settlement Date'}</label>
                  <input 
                    type="date"
                    className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500"
                    value={custodySettlement.date}
                    onChange={(e) => setCustodySettlement({ ...custodySettlement, date: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 font-bold uppercase">{language === 'ar' ? 'وصف التسوية' : 'Settlement Description'}</label>
                  <input 
                    type="text"
                    className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500"
                    value={custodySettlement.description}
                    onChange={(e) => setCustodySettlement({ ...custodySettlement, description: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h4 className="font-bold text-sm">{language === 'ar' ? 'بنود المصروفات' : 'Expense Items'}</h4>
                  <button 
                    type="button"
                    onClick={() => setCustodySettlement({ ...custodySettlement, items: [...custodySettlement.items, { id: crypto.randomUUID(), accountCode: '', accountName: '', amount: 0, description: '' }] })}
                    className="text-xs text-blue-400 hover:text-blue-300 font-bold flex items-center gap-1"
                  >
                    <Plus size={14} />
                    {language === 'ar' ? 'إضافة بند' : 'Add Item'}
                  </button>
                </div>

                <div className="space-y-3">
                  {custodySettlement.items.map((item, idx) => (
                    <div key={item.id} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end bg-gray-900/40 p-3 rounded-lg border border-gray-800">
                      <div className="md:col-span-4 space-y-1">
                        <div className="flex justify-between items-center">
                          <label className="text-[10px] text-gray-500 uppercase">{language === 'ar' ? 'مصروف' : 'Expense Account'}</label>
                          <button 
                            type="button"
                            onClick={() => setIsAccountModalOpen(true)}
                            className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
                          >
                            <Plus size={10} />
                            {language === 'ar' ? 'جديد' : 'New'}
                          </button>
                        </div>
                        <select 
                          className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500"
                          value={item.accountCode}
                          onChange={(e) => handleCustodyItemChange(idx, 'accountCode', e.target.value)}
                        >
                          <option value="">{language === 'ar' ? 'اختر حساب المصروف' : 'Select Expense'}</option>
                          {accounts.filter(a => !a.isGroup && a.status !== 'disabled' && a.type === 'expense').map(acc => (
                            <option key={acc.id} value={acc.accountCode}>{acc.accountCode} - {acc.accountName}</option>
                          ))}
                        </select>
                      </div>
                      <div className="md:col-span-2 space-y-1">
                        <label className="text-[10px] text-gray-500 uppercase">{language === 'ar' ? 'المبلغ' : 'Amount'}</label>
                        <input 
                          type="number"
                          className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500 text-blue-400"
                          value={item.amount}
                          onChange={(e) => handleCustodyItemChange(idx, 'amount', e.target.value)}
                        />
                      </div>
                      <div className="md:col-span-5 space-y-1">
                        <label className="text-[10px] text-gray-500 uppercase">{language === 'ar' ? 'ملاحظات' : 'Notes'}</label>
                        <input 
                          type="text"
                          className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500"
                          value={item.description}
                          onChange={(e) => handleCustodyItemChange(idx, 'description', e.target.value)}
                        />
                      </div>
                      <div className="md:col-span-1 flex justify-center pb-2">
                        <button 
                          type="button"
                          onClick={() => setCustodySettlement({ ...custodySettlement, items: custodySettlement.items.filter((_, i) => i !== idx) })}
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
                <div className="text-xl font-bold">
                  <span className="text-gray-500 text-sm mr-2">{language === 'ar' ? 'إجمالي التسوية:' : 'Total Settlement:'}</span>
                  <span className="text-blue-500 font-mono">{custodySettlement.items.reduce((sum, item) => sum + Number(item.amount), 0).toLocaleString()}</span>
                </div>
                <button 
                  type="submit"
                  disabled={isSubmitting || !selectedCustodyAccount}
                  className="bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:text-gray-400 px-12 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 text-white"
                >
                  {isSubmitting ? (language === 'ar' ? 'جاري الحفظ...' : 'Saving...') : (language === 'ar' ? 'حفظ التسوية' : 'Save Settlement')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {activeSubTab === 'coa' && (
        <div className={cn(
          "border rounded-xl overflow-hidden shadow-2xl transition-colors", 
          theme === 'dark' ? "bg-[#151619] border-gray-800" : 
          theme === 'soft' ? "bg-white border-[#cfd8dc]" : 
          "bg-white border-gray-200"
        )}>
          <div className={cn(
            "p-4 border-b flex items-center gap-4 transition-colors", 
            theme === 'dark' ? "bg-gray-900/50 border-gray-800" : 
            theme === 'soft' ? "bg-[#eceff1] border-[#cfd8dc]" : 
            "bg-gray-50 border-gray-200"
          )}>
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
            <div className="flex gap-2">
              <button 
                onClick={handleExportCOAExcel}
                className="bg-green-600 hover:bg-green-500 px-4 py-2 rounded-md text-xs font-medium transition-colors flex items-center gap-2 text-white"
              >
                <FileDown size={14} />
                {language === 'ar' ? 'تصدير إكسل' : 'Export Excel'}
              </button>
              <label className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-md text-xs font-medium transition-colors flex items-center gap-2 text-white cursor-pointer">
                <FileUp size={14} />
                {language === 'ar' ? 'استيراد إكسل' : 'Import Excel'}
                <input type="file" className="hidden" accept=".xlsx, .xls" onChange={handleImportCOAExcel} />
              </label>
              {accounts.length === 0 && (
                <button 
                  onClick={seedAccounts}
                  className="bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-md text-xs font-medium transition-colors"
                >
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
              <div className="py-2">
                {renderAccount()}
              </div>
            )}
          </div>
        </div>
      )}

      {activeSubTab === 'journal' && (
        <div className={cn(
          "border rounded-xl overflow-hidden shadow-2xl transition-colors", 
          theme === 'dark' ? "bg-[#151619] border-gray-800" : 
          theme === 'soft' ? "bg-white border-[#cfd8dc]" : 
          "bg-white border-gray-200"
        )}>
          <div className={cn(
            "p-4 border-b flex items-center justify-between transition-colors", 
            theme === 'dark' ? "bg-gray-900/50 border-gray-800" : 
            theme === 'soft' ? "bg-[#eceff1] border-[#cfd8dc]" : 
            "bg-gray-50 border-gray-200"
          )}>
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
                <tr className={cn(
                  "border-b transition-colors", 
                  theme === 'dark' ? "border-gray-800 bg-gray-900/30" : 
                  theme === 'soft' ? "border-[#cfd8dc] bg-[#eceff1]" : 
                  "border-gray-200 bg-gray-50"
                )}>
                  <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'التاريخ' : 'Date'}</th>
                  <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'البيان' : 'Description'}</th>
                  <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'مركز التكلفة' : 'Cost Center'}</th>
                  <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'الحساب' : 'Account'}</th>
                  <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'مدين' : 'Debit'}</th>
                  <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'دائن' : 'Credit'}</th>
                </tr>
              </thead>
              <tbody className={cn(
                "divide-y transition-colors",
                theme === 'dark' ? "divide-gray-800/50" : theme === 'soft' ? "divide-[#cfd8dc]" : "divide-gray-100"
              )}>
                {transactions.map((tx) => (
                  <React.Fragment key={tx.id}>
                    {tx.entries.map((entry, idx) => (
                      <tr 
                        key={`${tx.id}-${idx}`} 
                        className={cn(
                          "transition-colors group cursor-pointer",
                          theme === 'dark' ? "hover:bg-gray-800/20" : 
                          theme === 'soft' ? "hover:bg-[#eceff1]/50" : 
                          "hover:bg-gray-50"
                        )}
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
                            const contract = contractsMap.get(tx.costCenterId);
                            const project = projectsMap.get(contract?.projectId);
                            return contract ? `${contract.contractName} (${project?.projectName || '...'})` : '-';
                          })() : ''}
                        </td>
                        <td className="px-6 py-4 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] text-gray-500">{entry.accountCode}</span>
                            <span>{entry.accountName}</span>
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
                    <tr className={cn(
                      "border-b transition-colors",
                      theme === 'dark' ? "bg-gray-900/10 border-gray-800/50" : 
                      theme === 'soft' ? "bg-[#eceff1]/20 border-[#cfd8dc]" : 
                      "bg-gray-50/50 border-gray-100"
                    )}>
                      <td colSpan={6} className="px-6 py-1 text-[10px] text-gray-500 italic">
                        {language === 'ar' ? 'مرجع: ' : 'Ref: '}{tx.reference}
                      </td>
                    </tr>
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
          
          {transactions.length >= transactionLimit && (
            <div className={cn(
              "p-4 border-t transition-colors flex justify-center",
              theme === 'dark' ? "border-gray-800" : theme === 'soft' ? "border-[#cfd8dc]" : "border-gray-200"
            )}>
              <button 
                onClick={() => setTransactionLimit(prev => prev + 50)}
                className="text-blue-400 hover:text-blue-300 text-sm font-bold flex items-center gap-2"
              >
                <ChevronLast size={16} />
                {language === 'ar' ? 'تحميل المزيد من القيود' : 'Load More Entries'}
              </button>
            </div>
          )}
        </div>
      )}

      {activeSubTab === 'ledger' && (
        <div className="space-y-6">
          <div className={cn(
            "p-6 border rounded-xl shadow-sm transition-colors", 
            theme === 'dark' ? "bg-[#151619] border-gray-800" : 
            theme === 'soft' ? "bg-white border-[#cfd8dc]" : 
            "bg-white border-gray-200"
          )}>
            <div className="flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex-1">
                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">
                  {language === 'ar' ? 'اختر الحساب' : 'Select Account'}
                </label>
                <select
                  value={selectedLedgerAccount}
                  onChange={(e) => setSelectedLedgerAccount(e.target.value)}
                  className={cn(
                    "w-full px-4 py-2 rounded-lg border focus:ring-2 focus:ring-blue-500 outline-none transition-all",
                    theme === 'dark' ? "bg-gray-900 border-gray-800 text-white" : "bg-gray-50 border-gray-200"
                  )}
                >
                  <option value="">{language === 'ar' ? '--- اختر حساباً ---' : '--- Select an Account ---'}</option>
                  {accounts.filter(a => !a.isGroup && a.status !== 'disabled').map(acc => (
                    <option key={acc.id} value={acc.accountCode}>
                      {acc.accountCode} - {acc.accountName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2 self-end">
                <button 
                  onClick={handleExportLedgerPDF}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-bold transition-colors flex items-center gap-2"
                >
                  <Printer size={16} />
                  {language === 'ar' ? 'طباعة' : 'Print'}
                </button>
              </div>
            </div>
          </div>

          {!selectedLedgerAccount ? (
            <div className="flex flex-col items-center justify-center p-20 text-gray-500 border border-dashed border-gray-800 rounded-xl">
              <Calculator size={48} className="mb-4 opacity-20" />
              <h3 className="text-xl font-bold">{language === 'ar' ? 'كشف الحساب التفصيلي' : 'Detailed Account Statement'}</h3>
              <p className="mt-2">{language === 'ar' ? 'اختر حساباً من القائمة أعلاه لعرض حركته التفصيلية' : 'Select an account from the list above to view its detailed movement'}</p>
            </div>
          ) : (
            <div className={cn("border rounded-xl overflow-hidden shadow-sm", theme === 'dark' ? "bg-[#151619] border-gray-800" : "bg-white border-gray-200")}>
              <div className="overflow-x-auto">
                <table className="w-full text-right border-collapse">
                  <thead>
                    <tr className={cn("border-b", theme === 'dark' ? "border-gray-800 bg-gray-900/30" : "border-gray-200 bg-gray-50")}>
                      <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'التاريخ' : 'Date'}</th>
                      <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'البيان' : 'Description'}</th>
                      <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'مدين' : 'Debit'}</th>
                      <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'دائن' : 'Credit'}</th>
                      <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'الرصيد' : 'Balance'}</th>
                    </tr>
                  </thead>
                  <tbody className={cn(
                    "divide-y transition-colors",
                    theme === 'dark' ? "divide-gray-800/50" : 
                    theme === 'soft' ? "divide-[#cfd8dc]" : 
                    "divide-gray-100"
                  )}>
                    {ledgerLoading ? (
                      <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                        <Loader2 size={20} className="animate-spin inline-block" />
                      </td></tr>
                    ) : (() => {
                      let runningBalance = 0;
                      return ledgerAccountTransactions.map(tx => {
                        const entry = tx.entries.find(e => e.accountCode === selectedLedgerAccount)!;
                        runningBalance += (entry.debit - entry.credit);
                        return (
                          <tr key={tx.id} className={cn(
                            "transition-colors",
                            theme === 'dark' ? "hover:bg-gray-800/20" : 
                            theme === 'soft' ? "hover:bg-[#eceff1]/50" : 
                            "hover:bg-gray-50"
                          )}>
                            <td className="px-6 py-4 text-sm font-mono text-gray-500">{tx.date}</td>
                            <td className="px-6 py-4 text-sm font-bold">{tx.description}</td>
                            <td className="px-6 py-4 text-sm font-mono text-blue-400">{entry.debit > 0 ? entry.debit.toLocaleString() : '-'}</td>
                            <td className="px-6 py-4 text-sm font-mono text-red-400">{entry.credit > 0 ? entry.credit.toLocaleString() : '-'}</td>
                            <td className={cn("px-6 py-4 text-sm font-mono font-bold", runningBalance >= 0 ? "text-green-400" : "text-red-400")}>
                              {runningBalance.toLocaleString()}
                            </td>
                          </tr>
                        );
                      });
                    })()}

                  </tbody>
                </table>
              </div>
            </div>
          )}
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
              className={cn(
                "border rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl transition-colors",
                theme === 'dark' ? "bg-[#151619] border-gray-800" : 
                theme === 'soft' ? "bg-white border-[#cfd8dc]" : 
                "bg-white border-gray-200"
              )}
            >
              <div className={cn(
                "p-6 border-b flex justify-between items-center transition-colors",
                theme === 'dark' ? "bg-gray-900/50 border-gray-800" : 
                theme === 'soft' ? "bg-[#eceff1] border-[#cfd8dc]" : 
                "bg-gray-50 border-gray-200"
              )}>
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
                        const contract = contractsMap.get(selectedTransaction.costCenterId);
                        const project = projectsMap.get(contract?.projectId);
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

                <div className={cn(
                  "flex gap-3 justify-end pt-4 border-t",
                  theme === 'dark' ? "border-gray-800" : theme === 'soft' ? "border-[#cfd8dc]" : "border-gray-100"
                )}>
                  <button 
                    onClick={() => handleDeleteTransaction(selectedTransaction)}
                    className="px-6 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-500 rounded-lg text-sm font-bold transition-colors flex items-center gap-2 mr-auto"
                  >
                    <Trash2 size={16} />
                    {language === 'ar' ? 'حذف القيد' : 'Delete Entry'}
                  </button>
                  <button 
                    onClick={() => handleExportTransactionPDF(selectedTransaction)}
                    className={cn(
                      "px-6 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2",
                      theme === 'dark' ? "bg-gray-800 hover:bg-gray-700 text-white" : 
                      theme === 'soft' ? "bg-white border border-[#cfd8dc] text-[#37474f] hover:bg-[#eceff1]" : 
                      "bg-gray-100 hover:bg-gray-200 text-gray-900"
                    )}
                  >
                    <Printer size={16} />
                    {language === 'ar' ? 'طباعة' : 'Print'}
                  </button>
                  <button 
                    onClick={() => setSelectedTransaction(null)}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-bold text-white transition-colors"
                  >
                    {language === 'ar' ? 'إغلاق' : 'Close'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {confirmConfig.isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={cn(
                "border rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl p-6 text-center transition-colors",
                theme === 'dark' ? "bg-[#1a1b1e] border-gray-800" : 
                theme === 'soft' ? "bg-white border-[#cfd8dc]" : 
                "bg-white border-gray-200"
              )}
            >
              <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="text-red-500" size={32} />
              </div>
              <h3 className="text-xl font-bold mb-2">{confirmConfig.title}</h3>
              <p className="text-gray-400 text-sm mb-8">{confirmConfig.message}</p>
              <div className="flex gap-3">
                <button
                  onClick={confirmConfig.onConfirm}
                  disabled={isSubmitting}
                  className="flex-1 bg-red-600 hover:bg-red-500 disabled:bg-red-800 py-3 rounded-xl font-bold transition-all text-white flex items-center justify-center gap-2"
                >
                  {isSubmitting && <Loader2 className="animate-spin" size={18} />}
                  {language === 'ar' ? 'تأكيد الحذف' : 'Confirm Delete'}
                </button>
                <button
                  onClick={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
                  disabled={isSubmitting}
                  className={cn(
                    "flex-1 py-3 rounded-xl font-bold transition-all",
                    theme === 'dark' ? "bg-gray-800 hover:bg-gray-700" : 
                    theme === 'soft' ? "bg-[#eceff1] hover:bg-[#cfd8dc] text-[#37474f]" : 
                    "bg-gray-100 hover:bg-gray-200"
                  )}
                >
                  {language === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
