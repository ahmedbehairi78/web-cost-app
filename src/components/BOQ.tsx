import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  Search, 
  ChevronRight, 
  ChevronDown, 
  FileText, 
  Layers, 
  Hash,
  Calculator,
  MoreVertical,
  Edit2,
  Trash2,
  AlertCircle,
  Briefcase,
  X,
  Download,
  Upload,
  FileSpreadsheet,
  Loader2
} from 'lucide-react';
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
  createdAt?: any;
}

export function BOQ() {
  const { t, language, theme, dir } = useLanguage();
  const [projects, setProjects] = useState<Project[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedContractId, setSelectedContractId] = useState<string>('');
  const [items, setItems] = useState<BOQItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<BOQItem | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
    rateProfitPct: 12
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
        rateProfitPct: 12
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
      rateProfitPct: item.rateProfitPct
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

  const totalBOQAmount = items.reduce((sum, item) => sum + (item.tenderAmount || 0), 0);

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
      'نسبة الربح %': item.rateProfitPct
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
      'نسبة الربح %': 12
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
        for (const row of jsonData as any[]) {
          const chapterCode = String(row['كود الفصل'] || '');
          const chapterName = String(row['اسم الفصل'] || '');
          const workTypeCode = String(row['كود نوع العمل'] || '');
          const sectionCode = String(row['كود القسم'] || '');
          const sectionName = String(row['اسم القسم'] || '');
          const itemCode = String(row['كود البند'] || '');
          const description = String(row['وصف البند'] || '');
          const unit = String(row['الوحدة'] || '');
          const tenderQty = Number(row['الكمية'] || 0);
          const rateMaterials = Number(row['تكلفة المواد'] || 0);
          const rateLabour = Number(row['تكلفة العمالة'] || 0);
          const rateEquipment = Number(row['تكلفة المعدات'] || 0);
          const rateOverheadPct = Number(row['نسبة المصاريف العمومية %'] || 10);
          const rateProfitPct = Number(row['نسبة الربح %'] || 12);

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
    <div className="p-8 bg-[#0a0a0a] min-h-screen text-gray-100" dir="rtl">
      <header className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">جدول الكميات (BOQ)</h2>
          <p className="text-gray-400 mt-1">إدارة بنود التعاقد، الكميات، وتحليل الأسعار</p>
        </div>
        <div className="flex gap-4">
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-gray-500 font-bold uppercase">إجمالي قيمة المشروع</span>
            <span className="text-xl font-bold text-blue-500">{totalBOQAmount.toLocaleString()} <span className="text-xs font-normal">ج.م</span></span>
          </div>
          
          <div className="flex gap-2">
            <button 
              onClick={handleExportTemplate}
              className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 border border-gray-700"
              title="تصدير قالب"
            >
              <Download size={18} />
              تصدير
            </button>
            <button 
              disabled={!selectedContractId || isSubmitting}
              onClick={() => fileInputRef.current?.click()}
              className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 border border-gray-700 disabled:opacity-50"
              title="استيراد قالب"
            >
              <Upload size={18} />
              استيراد
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
                  rateProfitPct: 12
                });
                setIsModalOpen(true);
              }}
              className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-600 px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 text-white"
            >
              <Plus size={18} />
              بند جديد
            </button>
            <button 
              disabled={!selectedContractId || isSubmitting || items.length === 0}
              onClick={handleClearBOQ}
              className="bg-red-900/20 hover:bg-red-900/40 text-red-500 px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 border border-red-900/50"
              title="تفريغ الجدول"
            >
              <Trash2 size={18} />
              تفريغ
            </button>
          </div>
      </header>

      {/* Selectors */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div className="bg-[#151619] border border-gray-800 p-4 rounded-xl flex items-center gap-4">
          <div className="p-2 bg-blue-900/20 rounded-lg text-blue-500">
            <Briefcase size={20} />
          </div>
          <div className="flex-1">
            <label className="text-[10px] text-gray-500 font-bold uppercase block mb-1">المشروع</label>
            <select 
              className="bg-transparent text-lg font-bold outline-none w-full cursor-pointer"
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
            >
              {projects.map(p => (
                <option key={p.id} value={p.id} className="bg-[#151619]">{p.projectName} ({p.projectCode})</option>
              ))}
            </select>
          </div>
        </div>

        <div className="bg-[#151619] border border-gray-800 p-4 rounded-xl flex items-center gap-4">
          <div className="p-2 bg-purple-900/20 rounded-lg text-purple-500">
            <FileText size={20} />
          </div>
          <div className="flex-1">
            <label className="text-[10px] text-gray-500 font-bold uppercase block mb-1">العقد</label>
            <select 
              className="bg-transparent text-lg font-bold outline-none w-full cursor-pointer"
              value={selectedContractId}
              onChange={(e) => setSelectedContractId(e.target.value)}
              disabled={!selectedProjectId}
            >
              <option value="" disabled>اختر العقد</option>
              {contracts.map(c => (
                <option key={c.id} value={c.id} className="bg-[#151619]">{c.contractName} ({c.contractNumber})</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* BOQ Table */}
      <div className="bg-[#151619] border border-gray-800 rounded-xl overflow-hidden shadow-2xl">
        <table className="w-full text-right border-collapse">
          <thead>
            <tr className="bg-gray-900/50 border-b border-gray-800 text-[10px] font-bold text-gray-400 uppercase">
              <th className="p-4 w-24">{language === 'ar' ? 'الفصل' : 'Chapter'}</th>
              <th className="p-4 w-24">{language === 'ar' ? 'القسم' : 'Section'}</th>
              <th className="p-4 w-20">{language === 'ar' ? 'الكود' : 'Code'}</th>
              <th className="p-4">{language === 'ar' ? 'الوصف' : 'Description'}</th>
              <th className="p-4 w-16">{language === 'ar' ? 'الوحدة' : 'Unit'}</th>
              <th className="p-4 w-20">{language === 'ar' ? 'الكمية' : 'Qty'}</th>
              <th className="p-4 w-24">{language === 'ar' ? 'سعر الوحدة' : 'Unit Rate'}</th>
              <th className="p-4 w-24">{language === 'ar' ? 'الإجمالي' : 'Total'}</th>
              <th className="p-4 w-12"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="p-12 text-center text-gray-500">جاري تحميل البنود...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={9} className="p-12 text-center text-gray-500">لا توجد بنود مسجلة لهذا المشروع.</td></tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors group">
                  <td className="p-4 text-xs">
                    <div className="font-bold">{item.chapterName}</div>
                    <div className="text-[8px] opacity-50">{item.chapterCode}</div>
                  </td>
                  <td className="p-4 text-xs">
                    <div>{item.sectionName}</div>
                    <div className="text-[8px] opacity-50">{item.sectionCode}</div>
                  </td>
                  <td className="p-4 font-mono text-xs text-blue-400">{item.itemCode}</td>
                  <td className="p-4 text-sm font-medium">{item.description}</td>
                  <td className="p-4 text-sm text-gray-400">{item.unit}</td>
                  <td className="p-4 text-sm font-bold">{item.tenderQty.toLocaleString()}</td>
                  <td className="p-4 text-sm font-bold text-green-400">{item.unitRateTotal?.toLocaleString()}</td>
                  <td className="p-4 text-sm font-bold">{item.tenderAmount?.toLocaleString()}</td>
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
              className="bg-[#151619] border border-gray-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-gray-800 flex justify-between items-center bg-gray-900/50">
                <h3 className="text-lg font-bold text-red-500">{confirmConfig.title}</h3>
                <button onClick={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))} className="text-gray-500 hover:text-white transition-colors">
                  <X size={20} />
                </button>
              </div>
              <div className="p-6">
                <p className="text-gray-300">{confirmConfig.message}</p>
              </div>
              <div className="p-6 border-t border-gray-800 flex justify-end gap-3 bg-gray-900/30">
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

        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-[#151619] border border-gray-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-gray-800 flex justify-between items-center bg-gray-900/50">
                <h3 className="text-xl font-bold">{editingItem ? 'تعديل البند التعاقدي' : 'إضافة بند تعاقدي جديد'}</h3>
                <button onClick={() => setIsModalOpen(false)} className="text-gray-500 hover:text-white transition-colors">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase">كود الفصل</label>
                    <input 
                      type="text" 
                      className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-4 text-sm outline-none focus:border-blue-500 transition-colors"
                      value={formData.chapterCode}
                      onChange={(e) => setFormData({...formData, chapterCode: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase">اسم الفصل</label>
                    <input 
                      type="text" 
                      className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-4 text-sm outline-none focus:border-blue-500 transition-colors"
                      value={formData.chapterName}
                      onChange={(e) => setFormData({...formData, chapterName: e.target.value})}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase">كود نوع العمل</label>
                    <input 
                      type="text" 
                      className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-4 text-sm outline-none focus:border-blue-500 transition-colors"
                      value={formData.workTypeCode}
                      onChange={(e) => setFormData({...formData, workTypeCode: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase">كود القسم</label>
                    <input 
                      type="text" 
                      className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-4 text-sm outline-none focus:border-blue-500 transition-colors"
                      value={formData.sectionCode}
                      onChange={(e) => setFormData({...formData, sectionCode: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase">اسم القسم</label>
                    <input 
                      type="text" 
                      className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-4 text-sm outline-none focus:border-blue-500 transition-colors"
                      value={formData.sectionName}
                      onChange={(e) => setFormData({...formData, sectionName: e.target.value})}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase">كود البند</label>
                    <input 
                      required
                      type="text" 
                      placeholder="مثال: 1.1.1"
                      className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-4 text-sm outline-none focus:border-blue-500 transition-colors"
                      value={formData.itemCode}
                      onChange={(e) => setFormData({...formData, itemCode: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase">الوحدة</label>
                    <input 
                      required
                      type="text" 
                      placeholder="م3، م2، طن..."
                      className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-4 text-sm outline-none focus:border-blue-500 transition-colors"
                      value={formData.unit}
                      onChange={(e) => setFormData({...formData, unit: e.target.value})}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-400 uppercase">وصف البند</label>
                  <textarea 
                    required
                    rows={2}
                    placeholder="أدخل وصفاً تفصيلياً للبند..."
                    className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-4 text-sm outline-none focus:border-blue-500 transition-colors resize-none"
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                  />
                </div>

                <div className="grid grid-cols-3 gap-4 p-4 bg-gray-900/30 rounded-xl border border-gray-800/50">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase">الكمية التعاقدية</label>
                    <input 
                      required
                      type="number" 
                      className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-4 text-sm outline-none focus:border-blue-500 transition-colors"
                      value={formData.tenderQty}
                      onChange={(e) => setFormData({...formData, tenderQty: Number(e.target.value)})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase">المواد (Direct)</label>
                    <input 
                      type="number" 
                      className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-4 text-sm outline-none focus:border-blue-500 transition-colors"
                      value={formData.rateMaterials}
                      onChange={(e) => setFormData({...formData, rateMaterials: Number(e.target.value)})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase">العمالة (Direct)</label>
                    <input 
                      type="number" 
                      className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-4 text-sm outline-none focus:border-blue-500 transition-colors"
                      value={formData.rateLabour}
                      onChange={(e) => setFormData({...formData, rateLabour: Number(e.target.value)})}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase">المعدات (Direct)</label>
                    <input 
                      type="number" 
                      className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-4 text-sm outline-none focus:border-blue-500 transition-colors"
                      value={formData.rateEquipment}
                      onChange={(e) => setFormData({...formData, rateEquipment: Number(e.target.value)})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase">المصاريف %</label>
                    <input 
                      type="number" 
                      className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-4 text-sm outline-none focus:border-blue-500 transition-colors"
                      value={formData.rateOverheadPct}
                      onChange={(e) => setFormData({...formData, rateOverheadPct: Number(e.target.value)})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase">الربح %</label>
                    <input 
                      type="number" 
                      className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 px-4 text-sm outline-none focus:border-blue-500 transition-colors"
                      value={formData.rateProfitPct}
                      onChange={(e) => setFormData({...formData, rateProfitPct: Number(e.target.value)})}
                    />
                  </div>
                </div>

                <div className="pt-4 flex gap-3">
                  <button 
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2"
                  >
                    {isSubmitting ? 'جاري الحفظ...' : 'حفظ البند'}
                  </button>
                  <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 bg-gray-800 hover:bg-gray-700 py-3 rounded-xl font-bold transition-all"
                  >
                    إلغاء
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

