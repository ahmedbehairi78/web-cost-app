import React, { useState, useEffect, useMemo } from 'react';
import {
  Plus,
  FileText,
  Edit2,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Clock,
  Briefcase,
  X,
  Download,
  Upload,
  Loader2
} from 'lucide-react';
import { BOQItemFormModal } from './boq/BOQItemFormModal';
import { ContractFormModal } from './boq/ContractFormModal';
import { collection, onSnapshot, query, where, orderBy, addDoc, serverTimestamp, deleteDoc, doc, getDocs, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../context/LanguageContext';
import * as XLSX from 'xlsx';

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

interface BOQItem {
  id: string;
  projectId: string;
  contractId: string;
  chapterCode: string;
  chapterName: string;
  workTypeCode: string;
  sectionCode: string;
  sectionName: string;
  itemCode: string;
  description: string;
  unit: string;
  tenderQty: number;
  rateMaterials: number;
  rateLabour: number;
  rateEquipment: number;
  rateDirect: number;
  rateOverheadPct: number;
  rateProfitPct: number;
  unitRateTotal: number;
  tenderAmount: number;
  startDate?: string;
  expectedDuration?: number;
  createdAt?: { toDate(): Date } | Date | string;
}

export function BOQ() {
  const { t, language, theme, dir } = useLanguage();
  const [projects, setProjects] = useState<Project[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedContractId, setSelectedContractId] = useState<string>('');
  const [items, setItems] = useState<BOQItem[]>([]);
  const [progressMap, setProgressMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isContractModalOpen, setIsContractModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<BOQItem | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // New Contract Form State
  const [contractFormData, setContractFormData] = useState({
    contractName: '',
    contractNumber: ''
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
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Form State
  const [formData, setFormData] = useState({
    chapterCode: '',
    chapterName: '',
    workTypeCode: '',
    sectionCode: '',
    sectionName: '',
    itemCode: '',
    description: '',
    unit: '',
    tenderQty: 0,
    rateMaterials: 0,
    rateLabour: 0,
    rateEquipment: 0,
    rateOverheadPct: 10,
    rateProfitPct: 12,
    startDate: '',
    expectedDuration: 0
  });

  useEffect(() => {
    const q = query(collection(db, 'projects'), where('isDeleted', '==', false), orderBy('projectCode'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
      setProjects(data);
      if (data.length > 0 && !selectedProjectId) {
        setSelectedProjectId(data[0].id);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'projects');
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      setContracts([]);
      setSelectedContractId('');
      return;
    }
    const q = query(collection(db, 'contracts'), where('projectId', '==', selectedProjectId), where('isDeleted', '==', false));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Contract));
      setContracts(data);
      if (data.length > 0) {
        setSelectedContractId(data[0].id);
      } else {
        setSelectedContractId('');
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'contracts');
    });
    return () => unsubscribe();
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedContractId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(
      collection(db, 'boq_items'), 
      where('contractId', '==', selectedContractId),
      orderBy('itemCode')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BOQItem));
      setItems(data);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'boq_items');
    });
    return () => unsubscribe();
  }, [selectedContractId]);

  // Calculate project progress from IPCs
  useEffect(() => {
    if (!selectedContractId) {
      setProgressMap({});
      return;
    }

    const q = query(
      collection(db, 'billing'),
      where('contractId', '==', selectedContractId),
      where('status', 'in', ['approved', 'paid'])
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const progress: Record<string, number> = {};
      
      snapshot.docs.forEach(doc => {
        const ipc = doc.data();
        if (ipc.items && Array.isArray(ipc.items)) {
          ipc.items.forEach((item: { boqItemId?: string; currentQty?: number }) => {
            if (item.boqItemId) {
              const currentTotal = progress[item.boqItemId] || 0;
              progress[item.boqItemId] = currentTotal + (item.currentQty || 0);
            }
          });
        }
      });
      
      setProgressMap(progress);
    }, (error) => {
      console.error("Error fetching progress for BOQ items:", error);
    });

    return () => unsubscribe();
  }, [selectedContractId]);

  const handleContractSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) return;
    setIsSubmitting(true);

    try {
      const docRef = await addDoc(collection(db, 'contracts'), {
        ...contractFormData,
        projectId: selectedProjectId,
        isDeleted: false,
        createdAt: serverTimestamp()
      });
      setIsContractModalOpen(false);
      setContractFormData({ contractName: '', contractNumber: '' });
      setSelectedContractId(docRef.id);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'contracts');
    } finally {
      setIsSubmitting(false);
    }
  };

  const calculateRates = () => {
    const direct = formData.rateMaterials + formData.rateLabour + formData.rateEquipment;
    const overheadAmt = direct * (formData.rateOverheadPct / 100);
    const subtotal = direct + overheadAmt;
    const profitAmt = subtotal * (formData.rateProfitPct / 100);
    const total = subtotal + profitAmt;
    return { direct, total, tenderAmount: total * formData.tenderQty };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    const { direct, total, tenderAmount } = calculateRates();
    
    try {
      const itemData = {
        ...formData,
        projectId: selectedProjectId,
        contractId: selectedContractId,
        rateDirect: direct,
        unitRateTotal: total,
        tenderAmount: tenderAmount,
        createdAt: editingItem ? editingItem.createdAt : serverTimestamp()
      };

      if (editingItem) {
        await updateDoc(doc(db, 'boq_items', editingItem.id), itemData);
      } else {
        await addDoc(collection(db, 'boq_items'), itemData);
      }

      setIsModalOpen(false);
      setEditingItem(null);
      setFormData({
        chapterCode: '',
        chapterName: '',
        workTypeCode: '',
        sectionCode: '',
        sectionName: '',
        itemCode: '',
        description: '',
        unit: '',
        tenderQty: 0,
        rateMaterials: 0,
        rateLabour: 0,
        rateEquipment: 0,
        rateOverheadPct: 10,
        rateProfitPct: 12,
        startDate: '',
        expectedDuration: 0
      });
    } catch (error) {
      handleFirestoreError(error, editingItem ? OperationType.UPDATE : OperationType.CREATE, 'boq_items');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClearBOQ = async () => {
    if (!selectedContractId) return;
    
    setConfirmConfig({
      isOpen: true,
      title: language === 'ar' ? 'تأكيد المسح' : 'Confirm Clear',
      message: language === 'ar' ? 'هل أنت متأكد من رغبتك في مسح كافة بنود جدول الكميات لهذا العقد؟ لا يمكن التراجع عن هذه الخطوة.' : 'Are you sure you want to clear all BOQ items for this contract? This action cannot be undone.',
      onConfirm: async () => {
        setIsSubmitting(true);
        try {
          const q = query(collection(db, 'boq_items'), where('contractId', '==', selectedContractId));
          const snapshot = await getDocs(q);
          
          const deletePromises = snapshot.docs.map(d => deleteDoc(doc(db, 'boq_items', d.id)));
          await Promise.all(deletePromises);
          
          setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, 'boq_items');
        } finally {
          setIsSubmitting(false);
        }
      }
    });
  };

  const handleEditItem = (item: BOQItem) => {
    setEditingItem(item);
    setFormData({
      chapterCode: item.chapterCode || '',
      chapterName: item.chapterName || '',
      workTypeCode: item.workTypeCode || '',
      sectionCode: item.sectionCode || '',
      sectionName: item.sectionName || '',
      itemCode: item.itemCode,
      description: item.description,
      unit: item.unit,
      tenderQty: item.tenderQty,
      rateMaterials: item.rateMaterials || 0,
      rateLabour: item.rateLabour || 0,
      rateEquipment: item.rateEquipment || 0,
      rateOverheadPct: item.rateOverheadPct,
      rateProfitPct: item.rateProfitPct,
      startDate: item.startDate || '',
      expectedDuration: item.expectedDuration || 0
    });
    setIsModalOpen(true);
  };

  const handleDeleteItem = async (itemId: string) => {
    setConfirmConfig({
      isOpen: true,
      title: language === 'ar' ? 'حذف البند' : 'Delete Item',
      message: language === 'ar' ? 'هل أنت متأكد من حذف هذا البند؟' : 'Are you sure you want to delete this item?',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'boq_items', itemId));
          setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, 'boq_items');
        }
      }
    });
  };

  const totalBOQAmount = useMemo(() => items.reduce((sum, item) => sum + (item.tenderAmount || 0), 0), [items]);

  const handleExportTemplate = () => {
    const data = items.length > 0 ? items.map(item => ({
      'كود الفصل': item.chapterCode || '',
      'اسم الفصل': item.chapterName || '',
      'كود نوع العمل': item.workTypeCode || '',
      'كود القسم': item.sectionCode || '',
      'اسم القسم': item.sectionName || '',
      'كود البند': item.itemCode,
      'وصف البند': item.description,
      'الوحدة': item.unit,
      'الكمية': item.tenderQty,
      'تكلفة المواد': item.rateMaterials || 0,
      'تكلفة العمالة': item.rateLabour || 0,
      'تكلفة المعدات': item.rateEquipment || 0,
      'نسبة المصاريف العمومية %': item.rateOverheadPct,
      'نسبة الربح %': item.rateProfitPct,
      'تاريخ بدء العمل': item.startDate || '',
      'مدة التنفيذ المتوقعة': item.expectedDuration || 0
    })) : [{
      'كود الفصل': '01',
      'اسم الفصل': 'الأعمال الترابية',
      'كود نوع العمل': '01',
      'كود القسم': '01',
      'اسم القسم': 'الحفر',
      'كود البند': '1.1',
      'وصف البند': 'حفر في جميع أنواع التربة',
      'الوحدة': 'م3',
      'الكمية': 100,
      'تكلفة المواد': 0,
      'تكلفة العمالة': 30,
      'تكلفة المعدات': 20,
      'نسبة المصاريف العمومية %': 10,
      'نسبة الربح %': 12,
      'تاريخ بدء العمل': '2024-01-01',
      'مدة التنفيذ المتوقعة': 30
    }];

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "BOQ");
    
    // Set column widths
    const wscols = [
      { wch: 12 }, // Chapter Code
      { wch: 20 }, // Chapter Name
      { wch: 15 }, // Work Type Code
      { wch: 12 }, // Section Code
      { wch: 20 }, // Section Name
      { wch: 15 }, // Item Code
      { wch: 40 }, // Description
      { wch: 10 }, // Unit
      { wch: 15 }, // Qty
      { wch: 15 }, // Mat
      { wch: 15 }, // Lab
      { wch: 15 }, // Equip
      { wch: 15 }, // Overhead
      { wch: 15 }, // Profit
      { wch: 20 }, // Start Date
      { wch: 20 }, // Duration
    ];
    ws['!cols'] = wscols;

    XLSX.writeFile(wb, `BOQ_Template_${selectedContractId || 'New'}.xlsx`);
  };

  const handleImportTemplate = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedContractId) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const data = new Uint8Array(event.target?.result as ArrayBuffer);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);
      
      setIsSubmitting(true);
      try {
        const getVal = (row: Record<string, unknown>, key: string, fallback: unknown = 0): unknown => {
          if (row[key] !== undefined) return row[key];
          const normalizedKey = key.trim();
          for (const k in row) {
            if (k.trim() === normalizedKey) return row[k];
          }
          return fallback;
        };

        for (const row of jsonData as Record<string, unknown>[]) {
          const chapterCode = String(getVal(row, 'كود الفصل', ''));
          const chapterName = String(getVal(row, 'اسم الفصل', ''));
          const workTypeCode = String(getVal(row, 'كود نوع العمل', ''));
          const sectionCode = String(getVal(row, 'كود القسم', ''));
          const sectionName = String(getVal(row, 'اسم القسم', ''));
          const itemCode = String(getVal(row, 'كود البند', ''));
          const description = String(getVal(row, 'وصف البند', ''));
          const unit = String(getVal(row, 'الوحدة', ''));
          const tenderQty = Number(getVal(row, 'الكمية', 0));
          const rateMaterials = Number(getVal(row, 'تكلفة المواد', 0));
          const rateLabour = Number(getVal(row, 'تكلفة العمالة', 0));
          const rateEquipment = Number(getVal(row, 'تكلفة المعدات', 0));
          const rateOverheadPct = Number(getVal(row, 'نسبة المصاريف العمومية %', 10));
          const rateProfitPct = Number(getVal(row, 'نسبة الربح %', 12));
          const startDate = getVal(row, 'تاريخ بدء العمل', '');
          const expectedDuration = Number(getVal(row, 'مدة التنفيذ المتوقعة', 0));

          if (!itemCode || !description) continue;

          const direct = rateMaterials + rateLabour + rateEquipment;
          const overheadAmt = direct * (rateOverheadPct / 100);
          const subtotal = direct + overheadAmt;
          const profitAmt = subtotal * (rateProfitPct / 100);
          const total = subtotal + profitAmt;

          await addDoc(collection(db, 'boq_items'), {
            chapterCode,
            chapterName,
            workTypeCode,
            sectionCode,
            sectionName,
            itemCode,
            description,
            unit,
            tenderQty,
            rateMaterials,
            rateLabour,
            rateEquipment,
            rateOverheadPct,
            rateProfitPct,
            startDate,
            expectedDuration,
            projectId: selectedProjectId,
            contractId: selectedContractId,
            rateDirect: direct,
            unitRateTotal: total,
            tenderAmount: total * tenderQty,
            createdAt: serverTimestamp()
          });
        }
        alert('تم استيراد البيانات بنجاح');
      } catch (error) {
        console.error('Import error:', error);
        alert('حدث خطأ أثناء الاستيراد');
      } finally {
        setIsSubmitting(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
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
          <h2 className="text-3xl font-bold tracking-tight">{language === 'ar' ? 'جدول الكميات (BOQ)' : 'Bill of Quantities (BOQ)'}</h2>
          <p className="text-gray-400 mt-1">{language === 'ar' ? 'إدارة بنود التعاقد، الكميات، وتحليل الأسعار' : 'Manage contract items, quantities, and price analysis'}</p>
        </div>
        <div className="flex gap-4">
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-gray-500 font-bold uppercase">{language === 'ar' ? 'إجمالي قيمة المشروع' : 'Total Project Value'}</span>
            <span className="text-xl font-bold text-blue-500">{totalBOQAmount.toLocaleString()} <span className="text-xs font-normal">{language === 'ar' ? 'ج.م' : 'EGP'}</span></span>
          </div>
          
          <div className="flex gap-2">
            <button 
              onClick={handleExportTemplate}
              className={cn(
                "px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 border",
                theme === 'dark' ? "bg-gray-800 hover:bg-gray-700 text-gray-300 border-gray-700" : 
                theme === 'soft' ? "bg-white hover:bg-[#eceff1] text-[#37474f] border-[#cfd8dc]" :
                "bg-white hover:bg-gray-50 text-gray-700 border-gray-200 shadow-sm"
              )}
              title={language === 'ar' ? 'تصدير قالب' : 'Export Template'}
            >
              <Download size={18} />
              {language === 'ar' ? 'تصدير' : 'Export'}
            </button>
            <button 
              disabled={!selectedContractId || isSubmitting}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 border disabled:opacity-50",
                theme === 'dark' ? "bg-gray-800 hover:bg-gray-700 text-gray-300 border-gray-700" : 
                theme === 'soft' ? "bg-white hover:bg-[#eceff1] text-[#37474f] border-[#cfd8dc]" :
                "bg-white hover:bg-gray-50 text-gray-700 border-gray-200 shadow-sm"
              )}
              title={language === 'ar' ? 'استيراد قالب' : 'Import Template'}
            >
              <Upload size={18} />
              {language === 'ar' ? 'استيراد' : 'Import'}
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept=".xlsx, .xls" 
              onChange={handleImportTemplate}
            />
          </div>

            <button 
              disabled={!selectedContractId || isSubmitting}
              onClick={() => {
                setEditingItem(null);
                setFormData({
                  chapterCode: '',
                  chapterName: '',
                  workTypeCode: '',
                  sectionCode: '',
                  sectionName: '',
                  itemCode: '',
                  description: '',
                  unit: '',
                  tenderQty: 0,
                  rateMaterials: 0,
                  rateLabour: 0,
                  rateEquipment: 0,
                  rateOverheadPct: 10,
                  rateProfitPct: 12,
                  startDate: '',
                  expectedDuration: 0
                });
                setIsModalOpen(true);
              }}
              className="bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:text-gray-400 px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 text-white"
            >
              <Plus size={18} />
              {language === 'ar' ? 'بند جديد' : 'New Item'}
            </button>
            <button 
              disabled={!selectedContractId || isSubmitting || items.length === 0}
              onClick={handleClearBOQ}
              className="bg-red-900/20 hover:bg-red-900/40 text-red-500 px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 border border-red-900/50"
              title={language === 'ar' ? 'تفريغ الجدول' : 'Clear Table'}
            >
              <Trash2 size={18} />
              {language === 'ar' ? 'تفريغ' : 'Clear'}
            </button>
          </div>
      </header>

      {/* Selectors */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div className={cn(
          "border p-4 rounded-xl flex items-center gap-4",
          theme === 'dark' ? "bg-[#151619] border-gray-800" : 
          theme === 'soft' ? "bg-white border-[#cfd8dc]" : 
          "bg-white border-gray-200 shadow-sm"
        )}>
          <div className="p-2 bg-blue-900/20 rounded-lg text-blue-500">
            <Briefcase size={20} />
          </div>
          <div className="flex-1">
            <label className="text-[10px] text-gray-500 font-bold uppercase block mb-1">{language === 'ar' ? 'المشروع' : 'Project'}</label>
            <select 
              className={cn(
                "bg-transparent text-lg font-bold outline-none w-full cursor-pointer",
                theme === 'dark' ? "text-white" : "text-gray-900"
              )}
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
            >
              {projects.map(p => (
                <option key={p.id} value={p.id} className={theme === 'dark' ? "bg-[#151619]" : "bg-white"}>{p.projectName} ({p.projectCode})</option>
              ))}
            </select>
          </div>
        </div>

        <div className={cn(
          "border p-4 rounded-xl flex items-center gap-4",
          theme === 'dark' ? "bg-[#151619] border-gray-800" : 
          theme === 'soft' ? "bg-white border-[#cfd8dc]" : 
          "bg-white border-gray-200 shadow-sm"
        )}>
          <div className="p-2 bg-purple-900/20 rounded-lg text-purple-500">
            <FileText size={20} />
          </div>
          <div className="flex-1">
            <div className="flex justify-between items-center mb-1">
              <label className="text-[10px] text-gray-500 font-bold uppercase block">{language === 'ar' ? 'العقد' : 'Contract'}</label>
              <button 
                onClick={() => setIsContractModalOpen(true)}
                disabled={!selectedProjectId}
                className="p-1 px-2 bg-purple-900/20 text-purple-500 rounded text-[10px] font-black uppercase flex items-center gap-1 hover:bg-purple-900/30 transition-colors disabled:opacity-50"
              >
                <Plus size={10} />
                {language === 'ar' ? 'إضافة عقد' : 'Add Contract'}
              </button>
            </div>
            <select 
              className={cn(
                "bg-transparent text-lg font-bold outline-none w-full cursor-pointer",
                theme === 'dark' ? "text-white" : "text-gray-900"
              )}
              value={selectedContractId}
              onChange={(e) => setSelectedContractId(e.target.value)}
              disabled={!selectedProjectId}
            >
              <option value="" disabled>{language === 'ar' ? 'اختر العقد' : 'Select Contract'}</option>
              {contracts.map(c => (
                <option key={c.id} value={c.id} className={theme === 'dark' ? "bg-[#151619]" : "bg-white"}>{c.contractName} ({c.contractNumber})</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* BOQ Table */}
      <div className={cn(
        "border rounded-xl overflow-hidden shadow-2xl",
        theme === 'dark' ? "bg-[#151619] border-gray-800" : 
        theme === 'soft' ? "bg-white border-[#cfd8dc]" : 
        "bg-white border-gray-200"
      )}>
        <table className="w-full text-right border-collapse">
          <thead>
            <tr className={cn(
              "border-b text-[10px] font-bold text-gray-400 uppercase",
              theme === 'dark' ? "bg-gray-900/50 border-gray-800" : 
              theme === 'soft' ? "bg-[#eceff1] border-[#cfd8dc]" : 
              "bg-gray-50 border-gray-100"
            )}>
              <th className="p-4 w-24">{language === 'ar' ? 'الفصل' : 'Chapter'}</th>
              <th className="p-4 w-24">{language === 'ar' ? 'القسم' : 'Section'}</th>
              <th className="p-4 w-20">{language === 'ar' ? 'كود النوع' : 'Type'}</th>
              <th className="p-4 w-20">{language === 'ar' ? 'الكود' : 'Code'}</th>
              <th className="p-4">{language === 'ar' ? 'الوصف' : 'Description'}</th>
              <th className="p-4 w-16">{language === 'ar' ? 'الوحدة' : 'Unit'}</th>
              <th className="p-4 w-20">{language === 'ar' ? 'الكمية' : 'Qty'}</th>
              <th className="p-4 w-24 whitespace-nowrap">{language === 'ar' ? 'بدء العمل' : 'Start Date'}</th>
              <th className="p-4 w-16 whitespace-nowrap">{language === 'ar' ? 'المدة' : 'Dur.'}</th>
              <th className="p-4 w-24 whitespace-nowrap">{language === 'ar' ? 'نهاية العمل' : 'End Date'}</th>
              <th className="p-4 w-20 whitespace-nowrap">{language === 'ar' ? 'الإنجاز' : 'Progress'}</th>
              <th className="p-4 w-24 whitespace-nowrap">{language === 'ar' ? 'الحالة' : 'Status'}</th>
              <th className="p-4 w-20 whitespace-normal text-[8px]">{language === 'ar' ? 'مواد' : 'Mat.'}</th>
              <th className="p-4 w-20 whitespace-normal text-[8px]">{language === 'ar' ? 'عمالة' : 'Lab.'}</th>
              <th className="p-4 w-20 whitespace-normal text-[8px]">{language === 'ar' ? 'معدات' : 'Equip.'}</th>
              <th className="p-4 w-12 whitespace-normal text-[8px]">{language === 'ar' ? 'م.ع %' : 'OH%'}</th>
              <th className="p-4 w-12 whitespace-normal text-[8px]">{language === 'ar' ? 'ربح %' : 'Prof%'}</th>
              <th className="p-4 w-24">{language === 'ar' ? 'سعر الوحدة' : 'Unit Rate'}</th>
              <th className="p-4 w-24">{language === 'ar' ? 'الإجمالي' : 'Total'}</th>
              <th className="p-4 w-12"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={20} className="p-12 text-center text-gray-500">{language === 'ar' ? 'جاري تحميل البنود...' : 'Loading items...'}</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={20} className="p-12 text-center text-gray-500">{language === 'ar' ? 'لا توجد بنود مسجلة لهذا المشروع.' : 'No items recorded for this project.'}</td></tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className={cn(
                  "border-b transition-colors group",
                  theme === 'dark' ? "border-gray-800/50 hover:bg-gray-800/30" : 
                  theme === 'soft' ? "border-[#cfd8dc] hover:bg-[#eceff1]" : 
                  "border-gray-100 hover:bg-gray-50"
                )}>
                  <td className="p-4 text-[10px]">
                    <div className="font-bold whitespace-nowrap overflow-hidden text-ellipsis max-w-[80px]">{item.chapterName}</div>
                    <div className="text-[8px] opacity-50">{item.chapterCode}</div>
                  </td>
                  <td className="p-4 text-[10px]">
                    <div className="whitespace-nowrap overflow-hidden text-ellipsis max-w-[80px]">{item.sectionName}</div>
                    <div className="text-[8px] opacity-50">{item.sectionCode}</div>
                  </td>
                  <td className="p-4 text-[10px] font-mono text-gray-500">{item.workTypeCode || '-'}</td>
                  <td className="p-4 font-mono text-[10px] text-blue-400">{item.itemCode}</td>
                  <td className="p-4 text-xs font-medium max-w-[150px] whitespace-normal">
                    <div className="line-clamp-2" title={item.description}>{item.description}</div>
                  </td>
                  <td className="p-4 text-xs text-gray-400">{item.unit}</td>
                  <td className="p-4 text-xs font-bold">{item.tenderQty.toLocaleString()}</td>
                  <td className="p-4 text-[10px] font-mono text-gray-400">
                    {item.startDate ? new Date(item.startDate).toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US') : '-'}
                  </td>
                  <td className="p-4 text-[10px] font-mono">
                    {item.expectedDuration ? (
                      <div className="flex items-center gap-1">
                        <Clock size={12} className="text-gray-500" />
                        <span>{item.expectedDuration}</span>
                      </div>
                    ) : '-'}
                  </td>
                  <td className={cn(
                    "p-4 text-[10px] font-mono font-bold",
                    (() => {
                      if (!item.startDate || !item.expectedDuration) return "text-gray-500";
                      const start = new Date(item.startDate);
                      const end = new Date(start.getTime() + (item.expectedDuration * 24 * 60 * 60 * 1000));
                      const totalExecuted = progressMap[item.id] || 0;
                      const progressPct = item.tenderQty > 0 ? (totalExecuted / item.tenderQty) * 100 : 0;
                      const isDelayed = end < new Date() && progressPct < 99.9;
                      return isDelayed ? "text-red-500" : "text-blue-500";
                    })()
                  )}>
                    {(() => {
                      if (!item.startDate || !item.expectedDuration) return '-';
                      const start = new Date(item.startDate);
                      const end = new Date(start.getTime() + (item.expectedDuration * 24 * 60 * 60 * 1000));
                      return end.toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US');
                    })()}
                  </td>
                  <td className="p-4">
                    {(() => {
                      const totalExecuted = progressMap[item.id] || 0;
                      const progressPct = item.tenderQty > 0 ? (totalExecuted / item.tenderQty) * 100 : 0;
                      return (
                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px] font-mono">
                            <span>{progressPct.toFixed(1)}%</span>
                          </div>
                          <div className={cn("w-full h-0.5 bg-gray-800 rounded-full")}>
                            <div 
                              className={cn(
                                "h-full rounded-full transition-all duration-500",
                                progressPct >= 100 ? "bg-green-500" : "bg-blue-500"
                              )}
                              style={{ width: `${Math.min(progressPct, 100)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })()}
                  </td>
                  <td className="p-4">
                    {(() => {
                      if (!item.startDate || !item.expectedDuration) return null;
                      const start = new Date(item.startDate);
                      const end = new Date(start.getTime() + (item.expectedDuration * 24 * 60 * 60 * 1000));
                      const totalExecuted = progressMap[item.id] || 0;
                      const progressPct = item.tenderQty > 0 ? (totalExecuted / item.tenderQty) * 100 : 0;
                      
                      const isCompleted = progressPct >= 99.9;
                      const isDelayed = end < new Date() && !isCompleted;

                      if (isCompleted) {
                        return (
                          <div className="flex items-center gap-1 text-[8px] font-bold text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded-full w-fit">
                            <CheckCircle2 size={8} />
                            {language === 'ar' ? 'مكتمل' : 'Done'}
                          </div>
                        );
                      }

                      if (isDelayed) {
                        return (
                          <div className="flex items-center gap-1 text-[8px] font-bold text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded-full w-fit">
                            <AlertCircle size={8} />
                            {language === 'ar' ? 'متأخر' : 'Late'}
                          </div>
                        );
                      }

                      return (
                        <div className="flex items-center gap-1 text-[8px] font-bold text-blue-500 bg-blue-500/10 px-1.5 py-0.5 rounded-full w-fit">
                          <Clock size={8} />
                          {language === 'ar' ? 'جاري' : 'Runs'}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="p-4 text-[10px] font-mono text-gray-400">{item.rateMaterials?.toLocaleString()}</td>
                  <td className="p-4 text-[10px] font-mono text-gray-400">{item.rateLabour?.toLocaleString()}</td>
                  <td className="p-4 text-[10px] font-mono text-gray-400">{item.rateEquipment?.toLocaleString()}</td>
                  <td className="p-4 text-[10px] font-mono text-gray-500">{item.rateOverheadPct}%</td>
                  <td className="p-4 text-[10px] font-mono text-gray-500">{item.rateProfitPct}%</td>
                  <td className="p-4 text-xs font-bold text-blue-400">{item.unitRateTotal?.toLocaleString()}</td>
                  <td className="p-4 text-xs font-bold text-green-400">{item.tenderAmount?.toLocaleString()}</td>
                  <td className="p-4 text-left">
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => handleEditItem(item)}
                        className="text-blue-500 hover:text-blue-400 p-1"
                        title="تعديل"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button 
                        onClick={() => handleDeleteItem(item.id)}
                        className="text-red-500 hover:text-red-400 p-1"
                        title="حذف"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {confirmConfig.isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={cn(
                "border rounded-2xl w-full max-w-md overflow-hidden shadow-2xl",
                theme === 'dark' ? "bg-[#151619] border-gray-800" : 
                theme === 'soft' ? "bg-white border-[#cfd8dc]" : 
                "bg-white border-gray-200"
              )}
            >
              <div className={cn(
                "p-6 border-b flex justify-between items-center",
                theme === 'dark' ? "bg-gray-900/50 border-gray-800" : 
                theme === 'soft' ? "bg-[#eceff1] border-[#cfd8dc]" : 
                "bg-gray-50 border-gray-200"
              )}>
                <h3 className="text-lg font-bold text-red-500">{confirmConfig.title}</h3>
                <button onClick={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))} className="text-gray-500 hover:text-red-500 transition-colors">
                  <X size={20} />
                </button>
              </div>
              <div className="p-6">
                <p className={theme === 'dark' ? "text-gray-300" : "text-gray-600"}>{confirmConfig.message}</p>
              </div>
              <div className={cn(
                "p-6 border-t flex justify-end gap-3",
                theme === 'dark' ? "bg-gray-900/30 border-gray-800" : 
                theme === 'soft' ? "bg-[#eceff1] border-[#cfd8dc]" : 
                "bg-gray-50 border-gray-200"
              )}>
                <button 
                  onClick={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                >
                  {language === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>
                <button 
                  onClick={confirmConfig.onConfirm}
                  disabled={isSubmitting}
                  className="px-6 py-2 rounded-lg text-sm font-bold bg-red-600 hover:bg-red-500 text-white transition-colors flex items-center gap-2"
                >
                  {isSubmitting && <Loader2 className="animate-spin" size={16} />}
                  {language === 'ar' ? 'تأكيد' : 'Confirm'}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        <ContractFormModal
          isOpen={isContractModalOpen}
          contractFormData={contractFormData}
          setContractFormData={setContractFormData}
          isSubmitting={isSubmitting}
          onSubmit={handleContractSubmit}
          onClose={() => setIsContractModalOpen(false)}
          theme={theme}
          language={language}
        />
        <BOQItemFormModal
          isOpen={isModalOpen}
          editingItem={editingItem}
          formData={formData}
          setFormData={setFormData}
          isSubmitting={isSubmitting}
          onSubmit={handleSubmit}
          onClose={() => { setIsModalOpen(false); setEditingItem(null); }}
          theme={theme}
          language={language}
        />
      </AnimatePresence>
    </div>
  );
}

