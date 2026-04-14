import React, { useState, useEffect } from 'react';
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
  Upload
} from 'lucide-react';
import { collection, onSnapshot, query, addDoc, serverTimestamp, where, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { accountingService } from '../services/accountingService';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useLanguage } from '../context/LanguageContext';
import * as XLSX from 'xlsx';

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
  createdAt: any;
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

  const [formData, setFormData] = useState({
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
    items: [] as BillingItem[],
  });

  const [newAccountData, setNewAccountData] = useState({
    accountName: '',
    accountCode: '',
    parentCode: '5', // Default to Expenses
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
    const qTx = query(collection(db, 'purchase_transactions'), orderBy('createdAt', 'desc'));
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
    });

    // Listen to projects
    const qProjects = query(collection(db, 'projects'), where('isDeleted', '==', false));
    const unsubProjects = onSnapshot(qProjects, (snapshot) => {
      setProjects(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    // Listen to contracts
    const qContracts = query(collection(db, 'contracts'), where('isDeleted', '==', false));
    const unsubContracts = onSnapshot(qContracts, (snapshot) => {
      setContracts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    // Listen to accounts
    const qAccounts = query(collection(db, 'chart_of_accounts'), where('isGroup', '==', false));
    const unsubAccounts = onSnapshot(qAccounts, (snapshot) => {
      setAccounts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    // Listen to BOQ items for IPCs
    const qBoq = query(collection(db, 'boq_items'));
    const unsubBoq = onSnapshot(qBoq, (snapshot) => {
      setBoqItems(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
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
      setFormData({ ...formData, expenseAccountId: docRef.id });
      setShowAccountModal(false);
      setNewAccountData({ accountName: '', accountCode: '', parentCode: '5' });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'chart_of_accounts');
    } finally {
      setIsSubmitting(false);
    }
  };

  const [isSubmitting, setIsSubmitting] = useState(false);

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
      // 1. Add to suppliers collection
      const supplierRef = await addDoc(collection(db, 'suppliers'), {
        ...newSupplierData,
        isDeleted: false,
        createdAt: serverTimestamp()
      });

      // 2. Add to chart of accounts
      await addDoc(collection(db, 'chart_of_accounts'), {
        accountName: newSupplierData.name,
        accountCode: `210${Math.floor(Math.random() * 1000)}`, // Simple auto-code for now
        parentCode: '21', // Suppliers
        type: 'liability',
        isGroup: false,
        createdAt: serverTimestamp()
      });

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
      const data = XLSX.utils.sheet_to_json(ws) as any[];
      const updatedItems = [...formData.items];
      data.forEach(row => {
        const itemCode = row[language === 'ar' ? 'كود البند' : 'Item Code'];
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
      });

      // Record in accounting service
      if (modalType === 'invoice' && expenseAccount) {
        await accountingService.recordPurchaseInvoice({
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
        await accountingService.recordSubcontractorIPC({
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

  const filteredTransactions = transactions.filter(tx => 
    tx.supplierName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    tx.referenceNumber.toLowerCase().includes(searchTerm.toLowerCase())
  );

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
                    <span className={cn(
                      "flex items-center gap-1 text-[10px] font-bold",
                      tx.status === 'paid' ? "text-green-500" : "text-yellow-500"
                    )}>
                      {tx.status === 'paid' ? <CheckCircle2 size={12} /> : <Clock size={12} />}
                      {tx.status === 'paid' ? (language === 'ar' ? 'تم السداد' : 'Paid') : (language === 'ar' ? 'معلق' : 'Pending')}
                    </span>
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
                    <select 
                      required
                      className={cn("w-full border rounded-xl py-3 px-4 text-sm outline-none focus:border-blue-500 transition-colors", theme === 'dark' ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200")}
                      value={formData.supplierId}
                      onChange={(e) => setFormData({...formData, supplierId: e.target.value})}
                    >
                      <option value="">{language === 'ar' ? 'اختر المورد/المقاول' : 'Select Supplier/Subcontractor'}</option>
                      {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
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
                    <select 
                      required
                      className={cn("w-full border rounded-xl py-3 px-4 text-sm outline-none focus:border-blue-500 transition-colors", theme === 'dark' ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200")}
                      value={formData.projectId}
                      onChange={(e) => setFormData({...formData, projectId: e.target.value})}
                    >
                      <option value="">{language === 'ar' ? 'اختر المشروع' : 'Select Project'}</option>
                      {projects.map(p => <option key={p.id} value={p.id}>{p.projectName}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase">{t('contract')}</label>
                    <select 
                      required
                      className={cn("w-full border rounded-xl py-3 px-4 text-sm outline-none focus:border-blue-500 transition-colors", theme === 'dark' ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200")}
                      value={formData.contractId}
                      onChange={(e) => setFormData({...formData, contractId: e.target.value})}
                      disabled={!formData.projectId}
                    >
                      <option value="">{language === 'ar' ? 'اختر العقد' : 'Select Contract'}</option>
                      {contracts.filter(c => c.projectId === formData.projectId).map(c => <option key={c.id} value={c.id}>{c.contractName}</option>)}
                    </select>
                  </div>
                </div>

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
                            <tr key={idx}>
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
                  <select 
                    required
                    className={cn("w-full border rounded-xl py-3 px-4 text-sm outline-none focus:border-blue-500 transition-colors", theme === 'dark' ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200")}
                    value={formData.expenseAccountId}
                    onChange={(e) => setFormData({...formData, expenseAccountId: e.target.value})}
                  >
                    <option value="">{t('select_account')}</option>
                    {accounts.filter(a => a.type === 'expense').map(a => (
                      <option key={a.id} value={a.id}>{a.accountCode} - {a.accountName}</option>
                    ))}
                  </select>
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
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'اسم الحساب' : 'Account Name'}</label>
                  <input 
                    required
                    type="text" 
                    className={cn("w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500", theme === 'dark' ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200")}
                    value={newAccountData.accountName}
                    onChange={(e) => setNewAccountData({...newAccountData, accountName: e.target.value})}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 uppercase">{language === 'ar' ? 'كود الحساب' : 'Account Code'}</label>
                  <input 
                    required
                    type="text" 
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
                    <option value="5">{language === 'ar' ? '5 - المصروفات' : '5 - Expenses'}</option>
                    <option value="51">{language === 'ar' ? '51 - تكاليف مباشرة - مواد' : '51 - Direct Costs - Materials'}</option>
                    <option value="52">{language === 'ar' ? '52 - تكاليف مباشرة - عمالة' : '52 - Direct Costs - Labour'}</option>
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
    </div>
  );
}
