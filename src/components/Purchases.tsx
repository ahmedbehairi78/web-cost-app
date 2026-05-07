import React, { useState, useEffect, useMemo } from 'react';
import { 
  Plus, 
  Search, 
  ShoppingCart, 
  X, 
  FileText, 
  Receipt, 
  Calculator,
  Loader2,
  Calendar,
  DollarSign,
  Briefcase,
  CheckCircle2,
  Clock,
  Filter,
  ArrowRight,
  Download,
  Upload,
  Trash2,
  AlertTriangle
} from 'lucide-react';
import { collection, onSnapshot, query, addDoc, serverTimestamp, where, orderBy, limit, writeBatch, doc } from 'firebase/firestore';
import { BILLING_DEFAULTS } from '../constants/billingDefaults';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { accountingService, invalidateCoaCache } from '../services/accountingService';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useLanguage } from '../context/LanguageContext';
import * as XLSX from 'xlsx';
import { SearchableSelect } from './ui/SearchableSelect';
import { LISTENER_PURCHASE_BOQ_CAP, LISTENER_PURCHASE_TX_CAP } from '../constants/dataLimits';

interface PurchaseTransaction {
  id: string;
  type: 'invoice' | 'ipc';
  supplierId: string;
  supplierName: string;
  projectId: string;
  contractId: string;
  date: string;
  referenceNumber: string;
  amount: number;
  vatAmount: number;
  whtAmount: number;
  totalAmount: number;
  description: string;
  status: 'pending' | 'approved' | 'paid';
  createdAt?: { toDate(): Date } | Date | string | null;
  transactionId?: string;
  isDeleted?: boolean;
}

interface BillingItem {
  boqItemId: string;
  itemCode: string;
  description: string;
  unit: string;
  rate: number;
  previousQty: number;
  currentQty: number;
  totalQty: number;
  amount: number;
}

export function Purchases() {
  const { t, language, theme, dir } = useLanguage();
  const [transactions, setTransactions] = useState<PurchaseTransaction[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [boqItems, setBoqItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [modalType, setModalType] = useState<'invoice' | 'ipc'>('invoice');
  const [searchTerm, setSearchTerm] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    supplierId: '',
    projectId: '',
    contractId: '',
    expenseAccountId: '',
    date: new Date().toISOString().split('T')[0],
    referenceNumber: '',
    amount: 0,
    vatPct: BILLING_DEFAULTS.VAT_PCT,
    whtPct: BILLING_DEFAULTS.WHT_PCT,
    execGuaranteePct: 5,
    labourInsurancePct: 0,
    manpowerLevyPct: 0,
    advancePaymentRecovery: 0,
    description: '',
    items: [] as BillingItem[],
  });

  const [newAccountData, setNewAccountData] = useState({
    accountName: '',
    accountNameEn: '',
    accountCode: '',
    parentCode: '511',
  });

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

  const [newSupplierData, setNewSupplierData] = useState({
    name: '',
    taxNumber: '',
    phone: '',
    address: '',
    type: 'subcontractor' as 'supplier' | 'subcontractor',
  });

  useEffect(() => {
    setLoading(true);
    
    // Listen to transactions
    const qTx = query(
      collection(db, 'purchase_transactions'),
      where('isDeleted', '==', false),
      orderBy('createdAt', 'desc'),
      limit(LISTENER_PURCHASE_TX_CAP),
    );
    const unsubTx = onSnapshot(qTx, (snapshot) => {
      setTransactions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PurchaseTransaction)));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'purchase_transactions');
      setLoading(false);
    });

    // Listen to suppliers
    const qSuppliers = query(collection(db, 'suppliers'), where('isDeleted', '==', false));
    const unsubSuppliers = onSnapshot(qSuppliers, (snapshot) => {
      setSuppliers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'suppliers');
    });

    // Listen to projects
    const qProjects = query(collection(db, 'projects'), where('isDeleted', '==', false));
    const unsubProjects = onSnapshot(qProjects, (snapshot) => {
      setProjects(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'projects');
    });

    // Listen to contracts
    const qContracts = query(collection(db, 'contracts'), where('isDeleted', '==', false));
    const unsubContracts = onSnapshot(qContracts, (snapshot) => {
      setContracts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'contracts');
    });

    // Listen to accounts
    const qAccounts = query(collection(db, 'chart_of_accounts'), where('isGroup', '==', false));
    const unsubAccounts = onSnapshot(qAccounts, (snapshot) => {
      setAccounts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'chart_of_accounts');
    });

    // Listen to BOQ items for IPCs
    const qBoq = query(
      collection(db, 'boq_items'),
      where('isDeleted', '==', false),
      limit(LISTENER_PURCHASE_BOQ_CAP),
    );
    const unsubBoq = onSnapshot(qBoq, (snapshot) => {
      setBoqItems(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'boq_items');
    });

    return () => {
      unsubTx();
      unsubSuppliers();
      unsubProjects();
      unsubContracts();
      unsubAccounts();
      unsubBoq();
    };
  }, []);

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const docRef = await addDoc(collection(db, 'chart_of_accounts'), {
        ...newAccountData,
        type: 'expense',
        isGroup: false,
        createdAt: serverTimestamp()
      });
      invalidateCoaCache();
      setFormData({ ...formData, expenseAccountId: docRef.id });
      setShowAccountModal(false);
      setNewAccountData({ accountName: '', accountNameEn: '', accountCode: '', parentCode: '511' });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'chart_of_accounts');
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (modalType === 'ipc' && formData.projectId && formData.contractId) {
      const initialItems = boqItems
        .filter(boq => boq.projectId === formData.projectId && boq.contractId === formData.contractId)
        .map(boq => ({
          boqItemId: boq.id,
          itemCode: boq.itemCode,
          description: boq.description,
          unit: boq.unit,
          rate: boq.unitRateTotal,
          previousQty: 0,
          currentQty: 0,
          totalQty: 0,
          amount: 0
        }));
      setFormData(prev => ({ ...prev, items: initialItems }));
    }
  }, [formData.projectId, formData.contractId, modalType, boqItems]);

  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const batch = writeBatch(db);

      const supplierRef = doc(collection(db, 'suppliers'));
      batch.set(supplierRef, {
        ...newSupplierData,
        isDeleted: false,
        createdAt: serverTimestamp()
      });

      // Derive next sequential 8-digit code under the Suppliers group (21101)
      const existingCodes = accounts
        .filter(a => a.parentCode === '21101')
        .map(a => parseInt(a.accountCode, 10))
        .filter(n => !isNaN(n));
      const maxCode = existingCodes.length > 0 ? Math.max(...existingCodes) : 21101001;
      const nextAccountCode = String(maxCode + 1);

      const accountRef = doc(collection(db, 'chart_of_accounts'));
      batch.set(accountRef, {
        accountName: newSupplierData.name,
        accountNameEn: newSupplierData.name,
        accountCode: nextAccountCode,
        parentCode: '21101',
        type: 'liability',
        isGroup: false,
        supplierId: supplierRef.id,
        createdAt: serverTimestamp()
      });

      await batch.commit();
      invalidateCoaCache(); // new supplier account added — force COA re-fetch on next transaction

      setFormData({ ...formData, supplierId: supplierRef.id });
      setShowSupplierModal(false);
      setNewSupplierData({ name: '', taxNumber: '', phone: '', address: '', type: 'subcontractor' });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'suppliers');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExportTemplate = () => {
    const isAr = language === 'ar';
    const headers = [
      isAr ? 'كود البند' : 'Item Code',
      isAr ? 'البيان' : 'Description',
      isAr ? 'الوحدة' : 'Unit',
      isAr ? 'الفئة' : 'Rate',
      isAr ? 'الكمية السابقة' : 'Prev Qty',
      isAr ? 'الكمية الحالية' : 'Curr Qty'
    ];
    const aoa = [headers, ...formData.items.map(item => [
      item.itemCode,
      item.description,
      item.unit,
      item.rate,
      item.previousQty,
      0
    ])];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "IPC Template");
    XLSX.writeFile(wb, `Subcontractor_IPC_Template.xlsx`);
  };

  const handleImportExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws) as Record<string, unknown>[];
      const updatedItems = [...formData.items];
      data.forEach(row => {
        const itemCode = row[language === 'ar' ? 'كود البند' : 'Item Code'] as string | undefined;
        const currQty = Number(row[language === 'ar' ? 'الكمية الحالية' : 'Curr Qty']);
        if (itemCode !== undefined && !isNaN(currQty)) {
          const idx = updatedItems.findIndex(item => item.itemCode === String(itemCode));
          if (idx !== -1) {
            const item = updatedItems[idx];
            updatedItems[idx] = {
              ...item,
              currentQty: currQty,
              totalQty: item.previousQty + currQty,
              amount: (item.previousQty + currQty) * item.rate
            };
          }
        }
      });
      setFormData({ ...formData, items: updatedItems });
    };
    reader.readAsBinaryString(file);
  };

  const handleItemQtyChange = (idx: number, qty: number) => {
    const newItems = [...formData.items];
    const item = newItems[idx];
    item.currentQty = qty;
    item.totalQty = item.previousQty + qty;
    item.amount = item.totalQty * item.rate;
    setFormData({ ...formData, items: newItems });
  };

  const handleItemRateChange = (idx: number, rate: number) => {
    const newItems = [...formData.items];
    const item = newItems[idx];
    item.rate = rate;
    item.amount = item.totalQty * item.rate;
    setFormData({ ...formData, items: newItems });
  };

  const calculateIPCDeductions = () => {
    const worksValue = formData.items.reduce((sum, item) => sum + item.amount, 0);
    const vat = worksValue * (formData.vatPct / 100);
    const exec = worksValue * (formData.execGuaranteePct / 100);
    const wht = worksValue * (formData.whtPct / 100);
    const insurance = worksValue * (formData.labourInsurancePct / 100);
    const levy = worksValue * (formData.manpowerLevyPct / 100);
    const advance = formData.advancePaymentRecovery;
    const net = worksValue + vat - exec - wht - insurance - levy - advance;
    return { worksValue, vat, exec, wht, insurance, levy, advance, net };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const supplier = suppliers.find(s => s.id === formData.supplierId);
    const expenseAccount = accounts.find(a => a.id === formData.expenseAccountId);
    
    const { worksValue, vat, exec, wht, insurance, levy, advance, net } = 
      modalType === 'invoice' 
        ? { 
            worksValue: formData.amount, 
            vat: formData.amount * (formData.vatPct / 100), 
            wht: formData.amount * (formData.whtPct / 100),
            exec: 0, insurance: 0, levy: 0, advance: 0,
            net: formData.amount + (formData.amount * (formData.vatPct / 100)) - (formData.amount * (formData.whtPct / 100))
          }
        : calculateIPCDeductions();

    try {
      let transactionId = '';
      
      // 1. Record in accounting service first to get transactionId
      if (modalType === 'invoice' && expenseAccount) {
        transactionId = await accountingService.recordPurchaseInvoice({
          baseAmount: formData.amount,
          vatAmount: vat,
          whtAmount: wht,
          totalAmount: net,
          supplierName: supplier?.name || '',
          expenseAccountCode: expenseAccount.accountCode,
          expenseAccountName: expenseAccount.accountName,
          description: formData.description || `${t('invoice_entry')} - ${supplier?.name}`,
          projectId: formData.projectId,
          contractId: formData.contractId,
          date: formData.date
        });
      } else if (modalType === 'ipc') {
        transactionId = await accountingService.recordSubcontractorIPC({
          worksValue,
          vatAmount: vat,
          netPayable: net,
          execGuarantee: exec,
          whtAmount: wht,
          labourInsurance: insurance,
          manpowerLevy: levy,
          advancePaymentRecovery: advance,
          supplierName: supplier?.name || '',
          description: formData.description || `${t('ipc_entry')} - ${supplier?.name}`,
          projectId: formData.projectId,
          contractId: formData.contractId,
          date: formData.date
        });
      }

      // 2. Add to purchase_transactions collection
      await addDoc(collection(db, 'purchase_transactions'), {
        type: modalType,
        supplierId: formData.supplierId,
        supplierName: supplier?.name || '',
        projectId: formData.projectId,
        contractId: formData.contractId,
        expenseAccountId: formData.expenseAccountId,
        expenseAccountName: expenseAccount?.accountName || '',
        date: formData.date,
        referenceNumber: formData.referenceNumber,
        amount: worksValue,
        vatAmount: vat,
        whtAmount: wht,
        execGuaranteeAmount: exec,
        labourInsuranceAmount: insurance,
        manpowerLevyAmount: levy,
        advancePaymentRecovery: advance,
        totalAmount: net,
        description: formData.description,
        items: modalType === 'ipc' ? formData.items : null,
        status: 'pending',
        createdAt: serverTimestamp(),
        transactionId,
        isDeleted: false
      });
      
      setShowModal(false);
      resetForm();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'purchase_transactions');
    }
  };

  const resetForm = () => {
    setFormData({
      supplierId: '',
      projectId: '',
      contractId: '',
      expenseAccountId: '',
      date: new Date().toISOString().split('T')[0],
      referenceNumber: '',
      amount: 0,
      vatPct: 14,
      whtPct: 1,
      execGuaranteePct: 5,
      labourInsurancePct: 0,
      manpowerLevyPct: 0,
      advancePaymentRecovery: 0,
      description: '',
      items: [],
    });
  };

  const handleDeleteTransaction = (tx: PurchaseTransaction) => {
    setConfirmConfig({
      isOpen: true,
      title: language === 'ar' ? 'تأكيد الحذف' : 'Confirm Delete',
      message: language === 'ar' ? 'هل أنت متأكد من حذف هذه المعاملة؟ سيتم حذف القيد المحاسبي المرتبط به أيضاً.' : 'Are you sure you want to delete this transaction? The associated journal entry will also be deleted.',
      onConfirm: async () => {
        setLoading(true);
        try {
          // 1. Delete the purchase transaction document
          await accountingService.softDelete('purchase_transactions', tx.id);
          
          // 2. Delete the associated transaction if it exists
          if (tx.transactionId) {
            await accountingService.deleteTransaction(tx.transactionId);
          }
          setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, 'purchase_transactions');
        } finally {
          setLoading(false);
        }
      }
    });
  };

  const filteredTransactions = transactions.filter(tx =>
    tx.supplierName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    tx.referenceNumber.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // BOQ budget per contract: sum of tenderAmount for all non-deleted items
  const boqBudgetByContract = useMemo(() => {
    const map = new Map<string, number>();
    boqItems.forEach(item => {
      if (item.contractId && item.isDeleted !== true) {
        map.set(item.contractId, (map.get(item.contractId) || 0) + (item.tenderAmount || 0));
      }
    });
    return map;
  }, [boqItems]);

  // Total already spent per contract from existing purchase transactions
  const spentByContract = useMemo(() => {
    const map = new Map<string, number>();
    transactions.forEach(tx => {
      if (tx.contractId) {
        map.set(tx.contractId, (map.get(tx.contractId) || 0) + (tx.amount || 0));
      }
    });
    return map;
  }, [transactions]);

  // New amount being entered (invoice = direct amount, IPC = sum of item amounts)
  const newEntryAmount = modalType === 'invoice'
    ? formData.amount
    : formData.items.reduce((s, i) => s + i.amount, 0);

  const contractBudget = boqBudgetByContract.get(formData.contractId) || 0;
  const contractSpent = spentByContract.get(formData.contractId) || 0;
  const budgetExceeded = contractBudget > 0 && !!formData.contractId && (contractSpent + newEntryAmount) > contractBudget;
  const overByAmount = contractSpent + newEntryAmount - contractBudget;

  const handleOpenModal = (type: 'invoice' | 'ipc') => {
    setModalType(type);
    setShowModal(true);
  };

  return (
    <div className={cn("p-8 min-h-screen transition-colors", theme === 'dark' ? "bg-[#0a0a0a] text-gray-100" : "bg-gray-50 text-gray-900")} dir={dir}>
      <header className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{t('purchases')}</h2>
          <p className="text-gray-400 mt-1">{language === 'ar' ? 'إدارة المشتريات وفواتير الموردين ومستخلصات مقاولي الباطن' : 'Manage purchases, supplier invoices, and subcontractor IPCs'}</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => handleOpenModal('invoice')}
            className="bg-blue-600 hover:bg-blue-500 px-6 py-2 rounded-xl font-bold transition-all flex items-center gap-2 shadow-lg shadow-blue-900/20 text-white"
          >
            <Receipt size={20} />
            {t('invoice_entry')}
          </button>
          <button 
            onClick={() => handleOpenModal('ipc')}
            className="bg-purple-600 hover:bg-purple-500 px-6 py-2 rounded-xl font-bold transition-all flex items-center gap-2 shadow-lg shadow-purple-900/20 text-white"
          >
            <FileText size={20} />
            {t('ipc_entry')}
          </button>
        </div>
      </header>

      {/* Search and Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
        <div className={cn("lg:col-span-3 p-4 border rounded-xl flex items-center gap-4", theme === 'dark' ? "bg-[#151619] border-gray-800" : "bg-white border-gray-200 shadow-sm")}>
          <div className="relative flex-1">
            <Search className={cn("absolute top-1/2 -translate-y-1/2 text-gray-500", dir === 'rtl' ? "right-3" : "left-3")} size={18} />
            <input 
              type="text"
              placeholder={language === 'ar' ? 'البحث عن مورد، رقم فاتورة، أو بيان...' : 'Search for supplier, invoice number, or description...'}
              className={cn("w-full border rounded-lg py-2 text-sm outline-none focus:border-blue-500 transition-colors", 
                dir === 'rtl' ? "pr-10 pl-4" : "pl-10 pr-4",
                theme === 'dark' ? "bg-gray-900 border-gray-800" : "bg-gray-50 border-gray-200")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button className={cn("p-2 rounded-lg border", theme === 'dark' ? "bg-gray-900 border-gray-800 text-gray-400" : "bg-gray-50 border-gray-200 text-gray-600")}>
            <Filter size={18} />
          </button>
        </div>
        <div className={cn("p-4 border rounded-xl flex items-center justify-between", theme === 'dark' ? "bg-[#151619] border-gray-800" : "bg-white border-gray-200 shadow-sm")}>
          <div>
            <p className="text-[10px] text-gray-500 font-bold uppercase">{language === 'ar' ? 'إجمالي المشتريات' : 'Total Purchases'}</p>
            <p className="text-xl font-black text-blue-500">{transactions.reduce((sum, tx) => sum + tx.totalAmount, 0).toLocaleString()} <span className="text-xs font-normal opacity-50">EGP</span></p>
          </div>
          <div className="p-2 bg-blue-900/20 rounded-lg text-blue-500">
            <ShoppingCart size={20} />
          </div>
        </div>
      </div>

      {/* Transactions Table */}
      <div className={cn("border rounded-2xl overflow-hidden shadow-sm", theme === 'dark' ? "bg-[#151619] border-gray-800" : "bg-white border-gray-200")}>
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className={cn("border-b", theme === 'dark' ? "border-gray-800 bg-gray-900/30" : "border-gray-200 bg-gray-50")}>
                <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'التاريخ' : 'Date'}</th>
                <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'النوع' : 'Type'}</th>
                <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'المورد' : 'Supplier'}</th>
                <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'المرجع' : 'Reference'}</th>
                <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'المبلغ' : 'Amount'}</th>
                <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'الضريبة' : 'VAT'}</th>
                <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{t('wht_amount')}</th>
                <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'الإجمالي' : 'Total'}</th>
                <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase">{language === 'ar' ? 'الحالة' : 'Status'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center">
                    <Loader2 className="animate-spin inline-block text-blue-500 mb-2" size={24} />
                    <p className="text-gray-500">{language === 'ar' ? 'جاري التحميل...' : 'Loading...'}</p>
                  </td>
                </tr>
              ) : filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-gray-500">
                    {language === 'ar' ? 'لا توجد معاملات مسجلة.' : 'No transactions recorded.'}
                  </td>
                </tr>
              ) : filteredTransactions.map((tx) => (
                <tr key={tx.id} className="hover:bg-gray-800/20 transition-colors group">
                  <td className="px-6 py-4 text-sm font-mono text-gray-500">{tx.date}</td>
                  <td className="px-6 py-4 text-sm">
                    <span className={cn(
                      "px-2 py-1 rounded text-[10px] font-bold uppercase",
                      tx.type === 'invoice' ? "bg-blue-900/20 text-blue-400" : "bg-purple-900/20 text-purple-400"
                    )}>
                      {tx.type === 'invoice' ? (language === 'ar' ? 'فاتورة' : 'Invoice') : (language === 'ar' ? 'مستخلص' : 'IPC')}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm font-bold">{tx.supplierName}</td>
                  <td className="px-6 py-4 text-sm font-mono text-gray-400">{tx.referenceNumber}</td>
                  <td className="px-6 py-4 text-sm font-mono">{tx.amount.toLocaleString()}</td>
                  <td className="px-6 py-4 text-sm font-mono text-blue-400">{tx.vatAmount.toLocaleString()}</td>
                  <td className="px-6 py-4 text-sm font-mono text-red-400">{tx.whtAmount?.toLocaleString() || 0}</td>
                  <td className="px-6 py-4 text-sm font-black">{tx.totalAmount.toLocaleString()}</td>
                  <td className="px-6 py-4 text-sm">
                    <div className="flex items-center gap-3">
                      <span className={cn(
                        "flex items-center gap-1 text-[10px] font-bold",
                        tx.status === 'paid' ? "text-green-500" : "text-yellow-500"
                      )}>
                        {tx.status === 'paid' ? <CheckCircle2 size={12} /> : <Clock size={12} />}
                        {tx.status === 'paid' ? (language === 'ar' ? 'تم السداد' : 'Paid') : (language === 'ar' ? 'معلق' : 'Pending')}
                      </span>
                      <button 
                        onClick={() => handleDeleteTransaction(tx)}
                        className="text-gray-500 hover:text-red-500 transition-colors"
                        title={language === 'ar' ? 'حذف' : 'Delete'}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Entry Modal */}
      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className={cn("w-full max-w-2xl border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]", theme === 'dark' ? "bg-[#151619] border-gray-800" : "bg-white border-gray-200")}
            >
              <div className={cn("p-6 border-b flex justify-between items-center shrink-0", theme === 'dark' ? "bg-gray-900/50 border-gray-800" : "bg-gray-50 border-gray-200")}>
                <h3 className="text-xl font-bold flex items-center gap-2">
                  {modalType === 'invoice' ? <Receipt className="text-blue-500" size={24} /> : <FileText className="text-purple-500" size={24} />}
                  {modalType === 'invoice' ? t('invoice_entry') : t('ipc_entry')}
                </h3>
                <button onClick={() => setShowModal(false)} className="text-gray-500 hover:text-white transition-colors">
                  <X size={24} />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-8 space-y-6 overflow-y-auto">
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-bold text-gray-400 uppercase">{t('supplier_name')}</label>
                      <button 
                        type="button"
                        onClick={() => setShowSupplierModal(true)}
                        className="text-[10px] text-blue-500 hover:underline flex items-center gap-1"
                      >
                        <Plus size={12} />
                        {language === 'ar' ? 'إضافة مقاول' : 'Add Subcontractor'}
                      </button>
                    </div>
                    <SearchableSelect
                      value={formData.supplierId}
                      onChange={(v) => setFormData({...formData, supplierId: v})}
                      theme={theme}
                      dir={dir}
                      placeholder={language === 'ar' ? 'اختر المورد/المقاول' : 'Select Supplier/Subcontractor'}
                      options={suppliers.map(s => ({ value: s.id, label: s.name }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase">{t('invoice_date')}</label>
                    <input 
                      required
                      type="date"
                      className={cn("w-full border rounded-xl py-3 px-4 text-sm outline-none focus:border-blue-500 transition-colors", theme === 'dark' ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200")}
                      value={formData.date}
                      onChange={(e) => setFormData({...formData, date: e.target.value})}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase">{t('project')}</label>
                    <SearchableSelect
                      value={formData.projectId}
                      onChange={(v) => setFormData({...formData, projectId: v, contractId: ''})}
                      theme={theme}
                      dir={dir}
                      placeholder={language === 'ar' ? 'اختر المشروع' : 'Select Project'}
                      options={projects.map(p => ({ value: p.id, label: p.projectName }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase">{t('contract')}</label>
                    <SearchableSelect
                      value={formData.contractId}
                      onChange={(v) => setFormData({...formData, contractId: v})}
                      theme={theme}
                      dir={dir}
                      placeholder={language === 'ar' ? 'اختر العقد' : 'Select Contract'}
                      options={contracts.filter(c => c.projectId === formData.projectId).map(c => ({ value: c.id, label: c.contractName }))}
                    />
                  </div>
                </div>

                {budgetExceeded && (
                  <div className="flex items-start gap-3 bg-yellow-500/10 border border-yellow-500/40 rounded-xl px-4 py-3">
                    <AlertTriangle size={18} className="text-yellow-400 shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-bold text-yellow-400">
                        {language === 'ar' ? 'تحذير: تجاوز ميزانية العقد' : 'Warning: Contract Budget Exceeded'}
                      </p>
                      <p className="text-yellow-300/80 text-xs mt-0.5">
                        {language === 'ar'
                          ? `الإجمالي بعد التسجيل سيتجاوز الميزانية بمقدار ${overByAmount.toLocaleString('ar-EG', { minimumFractionDigits: 2 })} — يمكنك المتابعة مع الأخذ بعين الاعتبار.`
                          : `Total after this entry will exceed budget by ${overByAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })} — you may still proceed.`}
                      </p>
                    </div>
                  </div>
                )}

                {modalType === 'invoice' ? (
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase">{t('invoice_number')}</label>
                      <input 
                        required
                        type="text"
                        className={cn("w-full border rounded-xl py-3 px-4 text-sm outline-none focus:border-blue-500 transition-colors", theme === 'dark' ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200")}
                        value={formData.referenceNumber}
                        onChange={(e) => setFormData({...formData, referenceNumber: e.target.value})}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase">{t('amount')}</label>
                      <div className="relative">
                        <input 
                          required
                          type="number"
                          className={cn("w-full border rounded-xl py-3 px-4 text-sm outline-none focus:border-blue-500 transition-colors", theme === 'dark' ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200")}
                          value={formData.amount}
                          onChange={(e) => setFormData({...formData, amount: Number(e.target.value)})}
                        />
                        <span className={cn("absolute top-1/2 -translate-y-1/2 text-gray-500 text-xs font-bold", dir === 'rtl' ? "left-4" : "right-4")}>EGP</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <h4 className="text-sm font-bold text-gray-400 uppercase">{language === 'ar' ? 'بنود المستخلص' : 'IPC Items'}</h4>
                      <div className="flex gap-2">
                        <button 
                          type="button"
                          onClick={handleExportTemplate}
                          className="text-xs bg-gray-800 hover:bg-gray-700 px-3 py-1 rounded flex items-center gap-1"
                        >
                          <Download size={14} />
                          {language === 'ar' ? 'تصدير نموذج' : 'Export Template'}
                        </button>
                        <label className="text-xs bg-blue-900/20 text-blue-400 hover:bg-blue-900/40 px-3 py-1 rounded flex items-center gap-1 cursor-pointer">
                          <Upload size={14} />
                          {language === 'ar' ? 'استيراد' : 'Import'}
                          <input type="file" className="hidden" accept=".xlsx,.xls" onChange={handleImportExcel} />
                        </label>
                      </div>
                    </div>
                    
                    <div className="border rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                      <table className="w-full text-xs text-right">
                        <thead className="bg-gray-900/50 sticky top-0">
                          <tr>
                            <th className="p-2">{language === 'ar' ? 'كود' : 'Code'}</th>
                            <th className="p-2">{language === 'ar' ? 'البيان' : 'Description'}</th>
                            <th className="p-2">{language === 'ar' ? 'الوحدة' : 'Unit'}</th>
                            <th className="p-2">{language === 'ar' ? 'الفئة' : 'Rate'}</th>
                            <th className="p-2">{language === 'ar' ? 'سابق' : 'Prev'}</th>
                            <th className="p-2">{language === 'ar' ? 'حالي' : 'Curr'}</th>
                            <th className="p-2">{language === 'ar' ? 'إجمالي' : 'Total'}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                          {formData.items.map((item, idx) => (
                            <tr key={item.boqItemId}>
                              <td className="p-2 font-mono">{item.itemCode}</td>
                              <td className="p-2 max-w-[150px] truncate">{item.description}</td>
                              <td className="p-2">{item.unit}</td>
                              <td className="p-2">
                                <input 
                                  type="number" 
                                  className="w-20 bg-gray-800 border-none rounded p-1 text-center outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                                  value={item.rate}
                                  onChange={(e) => handleItemRateChange(idx, Number(e.target.value))}
                                />
                              </td>
                              <td className="p-2 font-mono text-gray-500">{item.previousQty}</td>
                              <td className="p-2">
                                <input 
                                  type="number" 
                                  className="w-16 bg-gray-800 border-none rounded p-1 text-center outline-none focus:ring-1 focus:ring-blue-500"
                                  value={item.currentQty}
                                  onChange={(e) => handleItemQtyChange(idx, Number(e.target.value))}
                                />
                              </td>
                              <td className="p-2 font-mono font-bold">{(item.totalQty * item.rate).toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase">{t('wht_pct')}</label>
                    <select 
                      className={cn("w-full border rounded-xl py-3 px-4 text-sm outline-none focus:border-blue-500 transition-colors", theme === 'dark' ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200")}
                      value={formData.whtPct}
                      onChange={(e) => setFormData({...formData, whtPct: Number(e.target.value)})}
                    >
                      <option value="0">0%</option>
                      <option value="1">1%</option>
                      <option value="3">3%</option>
                      <option value="5">5%</option>
                    </select>
                  </div>
                  {modalType === 'ipc' && (
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase">{language === 'ar' ? 'نسبة ضمان الأعمال' : 'Retention %'}</label>
                      <select 
                        className={cn("w-full border rounded-xl py-3 px-4 text-sm outline-none focus:border-blue-500 transition-colors", theme === 'dark' ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200")}
                        value={formData.execGuaranteePct}
                        onChange={(e) => setFormData({...formData, execGuaranteePct: Number(e.target.value)})}
                      >
                        <option value="0">0%</option>
                        <option value="5">5%</option>
                        <option value="10">10%</option>
                      </select>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-gray-400 uppercase">{t('expense_account')}</label>
                    <button 
                      type="button"
                      onClick={() => setShowAccountModal(true)}
                      className="text-[10px] text-blue-500 hover:underline flex items-center gap-1"
                    >
                      <Plus size={12} />
                      {language === 'ar' ? 'إضافة حساب' : 'Add Account'}
                    </button>
                  </div>
                  <SearchableSelect
                    value={formData.expenseAccountId}
                    onChange={(v) => setFormData({...formData, expenseAccountId: v})}
                    theme={theme}
                    dir={dir}
                    placeholder={t('select_account')}
                    options={accounts.filter(a => a.type === 'expense' && !a.isGroup && a.status !== 'disabled').map(a => ({
                      value: a.id,
                      secondary: a.accountCode,
                      label: language === 'ar' ? a.accountName : (a.accountNameEn || a.accountName),
                    }))}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase">{t('description')}</label>
                  <textarea 
                    className={cn("w-full border rounded-xl py-3 px-4 text-sm outline-none focus:border-blue-500 transition-colors h-24 resize-none", theme === 'dark' ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200")}
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                  />
                </div>

                {/* Calculation Summary */}
                <div className={cn("p-4 rounded-xl space-y-2", theme === 'dark' ? "bg-gray-900/50" : "bg-gray-50")}>
                  {modalType === 'invoice' ? (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">{t('amount')}</span>
                        <span className="font-mono">{formData.amount.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">{t('vat')} (14%)</span>
                        <span className="font-mono text-blue-400">{(formData.amount * 0.14).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">{t('wht_amount')} ({formData.whtPct}%)</span>
                        <span className="font-mono text-red-400">{(formData.amount * (formData.whtPct / 100)).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between pt-2 border-t border-gray-800 font-bold">
                        <span>{t('total')}</span>
                        <span className="text-lg text-green-500">{(formData.amount + (formData.amount * 0.14) - (formData.amount * (formData.whtPct / 100))).toLocaleString()}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      {(() => {
                        const { worksValue, vat, exec, wht, net } = calculateIPCDeductions();
                        return (
                          <>
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-500">{language === 'ar' ? 'قيمة الأعمال' : 'Works Value'}</span>
                              <span className="font-mono">{worksValue.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-500">{t('vat')} (14%)</span>
                              <span className="font-mono text-blue-400">{vat.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-500">{language === 'ar' ? 'حجز ضمان أعمال' : 'Retention'} ({formData.execGuaranteePct}%)</span>
                              <span className="font-mono text-orange-400">-{exec.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-500">{t('wht_amount')} ({formData.whtPct}%)</span>
                              <span className="font-mono text-red-400">-{wht.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between pt-2 border-t border-gray-800 font-bold">
                              <span>{language === 'ar' ? 'صافي المستحق' : 'Net Payable'}</span>
                              <span className="text-lg text-green-500">{net.toLocaleString()}</span>
                            </div>
                          </>
                        );
                      })()}
                    </>
                  )}
                </div>

                <div className="flex gap-4 pt-4">
                  <button 
                    type="submit"
                    className="flex-1 bg-blue-600 hover:bg-blue-500 py-3 rounded-xl font-bold transition-all shadow-lg shadow-blue-900/20 text-white"
                  >
                    {language === 'ar' ? 'حفظ المعاملة' : 'Save Transaction'}
                  </button>
                  <button 
                    type="button"
                    onClick={() => setShowModal(false)}
                    className={cn("flex-1 py-3 rounded-xl font-bold transition-all", theme === 'dark' ? "bg-gray-800 hover:bg-gray-700 text-white" : "bg-gray-200 hover:bg-gray-300 text-gray-700")}
                  >
                    {t('cancel')}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add Account Modal */}
      <AnimatePresence>
        {showAccountModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[60] p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={cn("w-full max-w-md border rounded-2xl shadow-2xl overflow-hidden", theme === 'dark' ? "bg-[#1a1b1e] border-gray-800" : "bg-white border-gray-200")}
            >
              <div className="p-6 border-b flex justify-between items-center">
                <h3 className="text-lg font-bold">{language === 'ar' ? 'إضافة حساب مصروفات جديد' : 'Add New Expense Account'}</h3>
                <button onClick={() => setShowAccountModal(false)} className="text-gray-500 hover:text-white">
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleSaveAccount} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-gray-400 uppercase">
                      {language === 'ar' ? 'الاسم العربي' : 'Arabic Name'}<span className="text-red-500 mr-1">*</span>
                    </label>
                    <input
                      required
                      type="text"
                      dir="rtl"
                      placeholder="مثال: مواد خرسانة"
                      className={cn("w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500", theme === 'dark' ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200")}
                      value={newAccountData.accountName}
                      onChange={(e) => setNewAccountData({...newAccountData, accountName: e.target.value})}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-400 uppercase">
                      {language === 'ar' ? 'الاسم الإنجليزي' : 'English Name'}<span className="text-red-500 mr-1">*</span>
                    </label>
                    <input
                      required
                      type="text"
                      dir="ltr"
                      placeholder="e.g. Concrete Materials"
                      className={cn("w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500", theme === 'dark' ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200")}
                      value={newAccountData.accountNameEn}
                      onChange={(e) => setNewAccountData({...newAccountData, accountNameEn: e.target.value})}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'كود الحساب' : 'Account Code'}</label>
                  <input
                    required
                    type="text"
                    placeholder="e.g. 5116"
                    className={cn("w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500", theme === 'dark' ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200")}
                    value={newAccountData.accountCode}
                    onChange={(e) => setNewAccountData({...newAccountData, accountCode: e.target.value})}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'الحساب الأب' : 'Parent Account'}</label>
                  <select
                    required
                    className={cn("w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500", theme === 'dark' ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200")}
                    value={newAccountData.parentCode}
                    onChange={(e) => setNewAccountData({...newAccountData, parentCode: e.target.value})}
                  >
                    <option value="511">{language === 'ar' ? '511 - تكاليف مباشرة' : '511 - Direct Costs'}</option>
                    <option value="512">{language === 'ar' ? '512 - تكاليف غير مباشرة للموقع' : '512 - Indirect Site Costs'}</option>
                    <option value="521">{language === 'ar' ? '521 - إدارية وعمومية' : '521 - General & Administrative'}</option>
                    <option value="522">{language === 'ar' ? '522 - تسويق وبيع' : '522 - Marketing & Sales'}</option>
                    <option value="531">{language === 'ar' ? '531 - تكاليف التمويل' : '531 - Financing Costs'}</option>
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
                    onClick={() => setShowAccountModal(false)}
                    className={cn("flex-1 py-2 rounded-lg font-bold transition-colors", theme === 'dark' ? "bg-gray-800 hover:bg-gray-700" : "bg-gray-200 hover:bg-gray-300")}
                  >
                    {t('cancel')}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add Supplier Modal */}
      <AnimatePresence>
        {showSupplierModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[60] p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={cn("w-full max-w-md border rounded-2xl shadow-2xl overflow-hidden", theme === 'dark' ? "bg-[#1a1b1e] border-gray-800" : "bg-white border-gray-200")}
            >
              <div className="p-6 border-b flex justify-between items-center">
                <h3 className="text-lg font-bold">{language === 'ar' ? 'إضافة مقاول باطن جديد' : 'Add New Subcontractor'}</h3>
                <button onClick={() => setShowSupplierModal(false)} className="text-gray-500 hover:text-white">
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleSaveSupplier} className="p-6 space-y-4">
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'اسم المقاول' : 'Subcontractor Name'}</label>
                  <input 
                    required
                    type="text" 
                    className={cn("w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500", theme === 'dark' ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200")}
                    value={newSupplierData.name}
                    onChange={(e) => setNewSupplierData({...newSupplierData, name: e.target.value})}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'رقم التسجيل الضريبي' : 'Tax Registration'}</label>
                  <input 
                    type="text" 
                    className={cn("w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500", theme === 'dark' ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200")}
                    value={newSupplierData.taxNumber}
                    onChange={(e) => setNewSupplierData({...newSupplierData, taxNumber: e.target.value})}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'رقم الهاتف' : 'Phone'}</label>
                  <input 
                    type="text" 
                    className={cn("w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500", theme === 'dark' ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200")}
                    value={newSupplierData.phone}
                    onChange={(e) => setNewSupplierData({...newSupplierData, phone: e.target.value})}
                  />
                </div>
                <div className="pt-4 flex gap-3">
                  <button 
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 py-2 rounded-lg font-bold transition-colors text-white"
                  >
                    {isSubmitting ? (language === 'ar' ? 'جاري الحفظ...' : 'Saving...') : (language === 'ar' ? 'حفظ المقاول' : 'Save Subcontractor')}
                  </button>
                  <button 
                    type="button"
                    onClick={() => setShowSupplierModal(false)}
                    className={cn("flex-1 py-2 rounded-lg font-bold transition-colors", theme === 'dark' ? "bg-gray-800 hover:bg-gray-700" : "bg-gray-200 hover:bg-gray-300")}
                  >
                    {t('cancel')}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {confirmConfig.isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={cn("border rounded-2xl w-full max-w-md overflow-hidden shadow-2xl", theme === 'dark' ? "bg-[#151619] border-gray-800" : "bg-white border-gray-200")}
            >
              <div className={cn("p-6 border-b flex justify-between items-center", theme === 'dark' ? "bg-gray-900/50 border-gray-800" : "bg-gray-50 border-gray-200")}>
                <h3 className="text-lg font-bold text-red-500">{confirmConfig.title}</h3>
                <button onClick={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))} className="text-gray-500 hover:text-white transition-colors">
                  <X size={20} />
                </button>
              </div>
              <div className="p-6">
                <p className={cn("text-sm", theme === 'dark' ? "text-gray-300" : "text-gray-600")}>{confirmConfig.message}</p>
              </div>
              <div className={cn("p-6 border-t flex justify-end gap-3", theme === 'dark' ? "bg-gray-900/30 border-gray-800" : "bg-gray-50 border-gray-200")}>
                <button 
                  onClick={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                >
                  {language === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>
                <button 
                  onClick={confirmConfig.onConfirm}
                  disabled={loading}
                  className="px-6 py-2 rounded-lg text-sm font-bold bg-red-600 hover:bg-red-500 text-white transition-colors flex items-center gap-2"
                >
                  {loading && <Loader2 className="animate-spin" size={16} />}
                  {language === 'ar' ? 'تأكيد' : 'Confirm'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
