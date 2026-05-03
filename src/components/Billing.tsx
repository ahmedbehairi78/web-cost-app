import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { BILLING_DEFAULTS } from '../constants/billingDefaults';
import {
  Plus,
  FileText,
  CheckCircle2,
  Clock,
  Briefcase,
  X,
  Trash2,
  Edit2,
  Printer,
  Loader2
} from 'lucide-react';
import * as XLSX from 'xlsx';
import html2pdf from 'html2pdf.js';
import { collection, onSnapshot, query, where, orderBy, addDoc, updateDoc, writeBatch, doc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { accountingService } from '../services/accountingService';
import { cn, normalizeDate } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../context/LanguageContext';
import { IPCFormModal } from './billing/IPCFormModal';

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
  contractId?: string;
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
  rateOverheadPct: number;
  rateProfitPct: number;
  unitRateTotal: number;
}

interface BillingItem {
  boqItemId: string;
  chapterCode?: string;
  chapterName?: string;
  workTypeCode?: string;
  sectionCode?: string;
  sectionName?: string;
  itemCode: string;
  description: string;
  unit: string;
  rate: number;
  tenderQty?: number;
  previousQty: number;
  currentQty: number;
  totalQty: number;
  amount: number;
}

type FirestoreDate = string | Date | { seconds: number; toDate(): Date };

interface BillingIPC {
  id: string;
  projectId: string;
  contractId: string;
  billingNumber: string;
  date: FirestoreDate;
  items: BillingItem[];
  worksValueExVat: number;
  vatAmount: number;
  execGuaranteeAmount: number;
  whtAmount: number;
  labourInsuranceAmount: number;
  manpowerLevyAmount: number;
  advancePaymentRecovery: number;
  netPayable: number;
  status: 'draft' | 'review' | 'submitted' | 'approved' | 'paid';
  transactionId?: string;
  isDeleted?: boolean;
}

export function Billing() {
  const { t, language, theme, dir } = useLanguage();
  const [projects, setProjects] = useState<Project[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedContractId, setSelectedContractId] = useState<string>('');
  const [boqItems, setBoqItems] = useState<BOQItem[]>([]);
  const [billings, setBillings] = useState<BillingIPC[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIPC, setEditingIPC] = useState<BillingIPC | null>(null);
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

  // Form State
  const [formData, setFormData] = useState({
    billingNumber: '',
    date: new Date().toISOString().split('T')[0],
    items: [] as BillingItem[],
    vatPct: BILLING_DEFAULTS.VAT_PCT,
    execGuaranteePct: BILLING_DEFAULTS.EXEC_GUARANTEE_PCT,
    whtPct: BILLING_DEFAULTS.WHT_PCT,
    labourInsurancePct: BILLING_DEFAULTS.LABOUR_INSURANCE_PCT,
    manpowerLevyPct: BILLING_DEFAULTS.MANPOWER_LEVY_PCT,
    advancePaymentRecovery: 0,
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
      setBillings([]);
      setBoqItems([]);
      return;
    }
    setLoading(true);
    
    // Fetch Billings
    const qBilling = query(
      collection(db, 'billing'), 
      where('contractId', '==', selectedContractId),
      where('isDeleted', '==', false),
      orderBy('date', 'desc')
    );
    const unsubBilling = onSnapshot(qBilling, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BillingIPC));
      setBillings(data);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'billing');
    });

    // Fetch BOQ Items
    const qBoq = query(
      collection(db, 'boq_items'),
      where('contractId', '==', selectedContractId),
      orderBy('itemCode')
    );
    const unsubBoq = onSnapshot(qBoq, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BOQItem));
      setBoqItems(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'boq_items');
    });

    return () => {
      unsubBilling();
      unsubBoq();
    };
  }, [selectedContractId]);

  const worksValueExVat = useMemo(
    () => formData.items.reduce((sum, item) => sum + item.amount, 0),
    [formData.items]
  );

  const calculateDeductions = useMemo(() => {
    const vat = worksValueExVat * (formData.vatPct / 100);
    const exec = worksValueExVat * (formData.execGuaranteePct / 100);
    const wht = worksValueExVat * (formData.whtPct / 100);
    const insurance = worksValueExVat * (formData.labourInsurancePct / 100);
    const levy = worksValueExVat * (formData.manpowerLevyPct / 100);
    const advance = formData.advancePaymentRecovery;
    const net = worksValueExVat + vat - exec - wht - insurance - levy - advance;
    return { vat, exec, wht, insurance, levy, advance, net };
  }, [worksValueExVat, formData.vatPct, formData.execGuaranteePct, formData.whtPct, formData.labourInsurancePct, formData.manpowerLevyPct, formData.advancePaymentRecovery]);

  const handleExportExcel = () => {
    const isAr = language === 'ar';
    const headers = [
      isAr ? 'الفصل' : 'Chapter',
      isAr ? 'القسم' : 'Section',
      isAr ? 'كود البند' : 'Item Code',
      isAr ? 'البيان' : 'Description',
      isAr ? 'الوحدة' : 'Unit',
      isAr ? 'الكمية التعاقدية' : 'Tender Qty',
      isAr ? 'الفئة' : 'Rate',
      isAr ? 'الكمية السابقة' : 'Prev Qty',
      isAr ? 'الكمية الحالية' : 'Curr Qty',
      isAr ? 'إجمالي الكمية' : 'Total Qty',
      isAr ? 'نسبة التنفيذ' : 'Comp %',
      isAr ? 'القيمة' : 'Amount'
    ];

    const aoa: (string | number | null | undefined)[][] = [headers];

    // Group items by chapter
    const chapters: { [key: string]: BillingItem[] } = {};
    formData.items.forEach(item => {
      const chapter = item.chapterName || (isAr ? 'غير مصنف' : 'Uncategorized');
      if (!chapters[chapter]) chapters[chapter] = [];
      chapters[chapter].push(item);
    });

    let totalWorksValue = 0;

    Object.entries(chapters).forEach(([chapterName, items]) => {
      const chapterTotal = items.reduce((sum, item) => sum + item.amount, 0);
      totalWorksValue += chapterTotal;

      items.forEach(item => {
        aoa.push([
          item.chapterName,
          item.sectionName,
          item.itemCode,
          item.description,
          item.unit,
          item.tenderQty,
          item.rate,
          item.previousQty,
          item.currentQty,
          item.totalQty,
          (item.tenderQty ? (item.totalQty / item.tenderQty) * 100 : 0).toFixed(2) + '%',
          item.amount
        ]);
      });

      // Add Chapter Subtotal Row
      aoa.push([
        isAr ? `إجمالي الفصل: ${chapterName}` : `Chapter Total: ${chapterName}`,
        '', '', '', '', '', '', '', '', '', '',
        chapterTotal
      ]);
      aoa.push([]); // Empty row for spacing
    });

    // Add Summary Section
    const { vat, exec, wht, insurance, levy, advance, net } = calculateDeductions;
    
    aoa.push([]);
    aoa.push([isAr ? 'الملخص المالي' : 'Financial Summary']);
    aoa.push([isAr ? 'قيمة الأعمال (بدون ضريبة):' : 'Work Value (Excl. VAT):', '', '', '', '', '', '', '', '', '', '', totalWorksValue]);
    aoa.push([isAr ? 'ضريبة القيمة المضافة (+):' : 'VAT Amount (+):', '', '', '', '', '', '', '', '', '', '', vat]);
    aoa.push([isAr ? 'حجز ضمان أعمال (10%):' : 'Execution Guarantee (10%):', '', '', '', '', '', '', '', '', '', '', exec]);
    aoa.push([isAr ? 'مصلحة الضرائب - خصم وإضافة (1%):' : 'WHT (1%):', '', '', '', '', '', '', '', '', '', '', wht]);
    aoa.push([isAr ? 'حجز تحت حساب التأمينات:' : 'Labour Insurance:', '', '', '', '', '', '', '', '', '', '', insurance]);
    aoa.push([isAr ? 'حجز تحت حساب القوى العاملة:' : 'Manpower Levy:', '', '', '', '', '', '', '', '', '', '', levy]);
    if (advance > 0) {
      aoa.push([isAr ? 'استرداد دفعة مقدمة:' : 'Advance Recovery:', '', '', '', '', '', '', '', '', '', '', advance]);
    }
    aoa.push([isAr ? 'إجمالي الاستقطاعات:' : 'Total Deductions:', '', '', '', '', '', '', '', '', '', '', (exec + wht + insurance + levy + advance)]);
    aoa.push([isAr ? 'صافي المستحق الصرف:' : 'Net Payable:', '', '', '', '', '', '', '', '', '', '', net]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "IPC Items");
    XLSX.writeFile(wb, `${formData.billingNumber || 'IPC'}_Export.xlsx`);
  };

  const handleImportExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = XLSX.utils.sheet_to_json(ws) as Record<string, unknown>[];

      const updatedItems = [...formData.items];
      data.forEach(row => {
        const itemCode = row[language === 'ar' ? 'كود البند' : 'Item Code'] as string | undefined;
        const currQty = Number(row[language === 'ar' ? 'الكمية الحالية' : 'Curr Qty']);
        
        if (itemCode !== undefined && !isNaN(currQty)) {
          const idx = updatedItems.findIndex(item => item.itemCode === String(itemCode));
          if (idx !== -1) {
            const item = updatedItems[idx];
            const totalQty = item.previousQty + currQty;
            updatedItems[idx] = {
              ...item,
              currentQty: currQty,
              totalQty: totalQty,
              amount: totalQty * item.rate
            };
          }
        }
      });

      setFormData({ ...formData, items: updatedItems });
    };
    reader.readAsBinaryString(file);
  };

  const safePct = (num: number, denom: number, fallback: number) =>
    denom > 0 ? (num / denom) * 100 : fallback;

  const handleOpenModal = useCallback((ipc?: BillingIPC) => {
    if (ipc) {
      setEditingIPC(ipc);
      setFormData({
        billingNumber: ipc.billingNumber,
        date: normalizeDate(ipc.date),
        items: ipc.items,
        vatPct: safePct(ipc.vatAmount, ipc.worksValueExVat, BILLING_DEFAULTS.VAT_PCT),
        execGuaranteePct: safePct(ipc.execGuaranteeAmount, ipc.worksValueExVat, BILLING_DEFAULTS.EXEC_GUARANTEE_PCT),
        whtPct: safePct(ipc.whtAmount, ipc.worksValueExVat, BILLING_DEFAULTS.WHT_PCT),
        labourInsurancePct: safePct(ipc.labourInsuranceAmount, ipc.worksValueExVat, BILLING_DEFAULTS.LABOUR_INSURANCE_PCT),
        manpowerLevyPct: safePct(ipc.manpowerLevyAmount, ipc.worksValueExVat, BILLING_DEFAULTS.MANPOWER_LEVY_PCT),
        advancePaymentRecovery: ipc.advancePaymentRecovery || 0,
      });
    } else {
      setEditingIPC(null);
      // Initialize form with BOQ items
      const initialItems: BillingItem[] = boqItems.map(boq => {
        // Calculate previous quantity from existing billings (excluding drafts)
        const previousQty = billings.reduce((sum, b) => {
          if (b.status === 'draft') return sum;
          const item = b.items?.find(i => i.boqItemId === boq.id);
          return sum + (item?.currentQty || 0);
        }, 0);

        return {
          boqItemId: boq.id,
          chapterCode: boq.chapterCode,
          chapterName: boq.chapterName,
          workTypeCode: boq.workTypeCode,
          sectionCode: boq.sectionCode,
          sectionName: boq.sectionName,
          itemCode: boq.itemCode,
          description: boq.description,
          unit: boq.unit,
          rate: boq.unitRateTotal,
          tenderQty: boq.tenderQty,
          previousQty,
          currentQty: 0,
          totalQty: previousQty,
          amount: 0
        };
      });

      setFormData({
        billingNumber: `IPC-${billings.length + 1}`,
        date: new Date().toISOString().split('T')[0],
        items: initialItems,
        vatPct: BILLING_DEFAULTS.VAT_PCT,
        execGuaranteePct: BILLING_DEFAULTS.EXEC_GUARANTEE_PCT,
        whtPct: BILLING_DEFAULTS.WHT_PCT,
        labourInsurancePct: BILLING_DEFAULTS.LABOUR_INSURANCE_PCT,
        manpowerLevyPct: BILLING_DEFAULTS.MANPOWER_LEVY_PCT,
        advancePaymentRecovery: 0,
      });
    }
    setIsModalOpen(true);
  }, [billings, boqItems]);

  const handleItemQtyChange = (idx: number, qty: number) => {
    const newItems = [...formData.items];
    const item = newItems[idx];
    item.currentQty = qty;
    item.totalQty = item.previousQty + qty;
    item.amount = qty * item.rate;
    setFormData({ ...formData, items: newItems });
  };

  const handleItemRateChange = (idx: number, rate: number) => {
    const newItems = [...formData.items];
    const item = newItems[idx];
    item.rate = rate;
    item.amount = item.currentQty * rate;
    setFormData({ ...formData, items: newItems });
  };

  const handleSubmit = async (e?: React.FormEvent, forcedStatus?: 'draft' | 'submitted') => {
    if (e) e.preventDefault();
    if (!selectedContractId) return;
    setIsSubmitting(true);
    const { vat, exec, wht, insurance, levy, advance, net } = calculateDeductions;
    const contract = contracts.find(c => c.id === selectedContractId);
    
    // Determine the status: if forcedStatus is provided (from Draft button), use it. 
    // Otherwise use editingIPC.status or default to 'submitted'.
    const finalStatus = forcedStatus || (editingIPC ? editingIPC.status : 'submitted');

    try {
      let transactionId = editingIPC?.transactionId;

      // Only record in GL if not a draft
      if (finalStatus !== 'draft') {
        transactionId = await accountingService.recordIPC({
          worksValue: worksValueExVat,
          vatAmount: vat,
          netPayable: net,
          execGuarantee: exec,
          whtAmount: wht,
          labourInsurance: insurance,
          manpowerLevy: levy,
          advancePaymentRecovery: advance,
          description: `${language === 'ar' ? 'مستخلص رقم' : 'IPC No'} ${formData.billingNumber}`,
          projectId: selectedProjectId,
          contractId: selectedContractId,
          date: formData.date,
          contractName: contract?.contractName || 'N/A',
          transactionId: editingIPC?.transactionId
        });
      } else if (editingIPC?.transactionId) {
        transactionId = "";
      }

      const billingData = {
        projectId: selectedProjectId,
        contractId: selectedContractId,
        billingNumber: formData.billingNumber,
        items: formData.items,
        worksValueExVat: worksValueExVat,
        vatAmount: vat,
        execGuaranteeAmount: exec,
        whtAmount: wht,
        labourInsuranceAmount: insurance,
        manpowerLevyAmount: levy,
        advancePaymentRecovery: advance,
        netPayable: net,
        status: finalStatus,
        date: formData.date,
        transactionId: transactionId || "",
        isDeleted: false
      };

      if (editingIPC) {
        // Revert to draft: atomically soft-delete the GL entry and clear transactionId
        if (finalStatus === 'draft' && editingIPC.transactionId) {
          const batch = writeBatch(db);
          batch.update(doc(db, 'transactions', editingIPC.transactionId), { isDeleted: true });
          batch.update(doc(db, 'billing', editingIPC.id), billingData);
          await batch.commit();
        } else {
          await updateDoc(doc(db, 'billing', editingIPC.id), billingData);
        }
      } else {
        await addDoc(collection(db, 'billing'), billingData);
      }

      setIsModalOpen(false);
      setEditingIPC(null);
    } catch (error) {
      handleFirestoreError(error, editingIPC ? OperationType.UPDATE : OperationType.CREATE, 'billing');
    } finally {
      setIsSubmitting(false);
    }
  };

  const { vat, exec, insurance, levy, net } = calculateDeductions;

  const formatDate = (date: FirestoreDate | null | undefined) => {
    const locale = language === 'ar' ? 'ar-EG' : 'en-US';
    if (!date) return 'N/A';
    try {
      if (typeof date === 'string') return new Date(date).toLocaleDateString(locale);
      if (date instanceof Date) return date.toLocaleDateString(locale);
      return date.toDate().toLocaleDateString(locale);
    } catch {
      return 'N/A';
    }
  };

  const handleDownloadPDF = (ipc: BillingIPC) => {
    const project = projects.find(p => p.id === ipc.projectId);
    const contract = contracts.find(c => c.id === ipc.contractId);
    const isAr = language === 'ar';

    const element = document.createElement('div');
    element.dir = isAr ? 'rtl' : 'ltr';
    element.style.padding = '20px';
    element.style.fontFamily = isAr ? 'Arial, sans-serif' : 'inherit';
    element.style.color = '#000000';
    
    element.innerHTML = `
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="font-size: 24px; color: #1e3a8a;">${isAr ? 'مستخلص جاري' : 'Interim Payment Certificate (IPC)'}</h1>
      </div>
      
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; font-size: 14px;">
        <div>
          <p><strong>${isAr ? 'رقم المستخلص:' : 'IPC Number:'}</strong> ${ipc.billingNumber}</p>
          <p><strong>${isAr ? 'التاريخ:' : 'Date:'}</strong> ${formatDate(ipc.date)}</p>
          <p><strong>${isAr ? 'المشروع:' : 'Project:'}</strong> ${project?.projectName || 'N/A'}</p>
        </div>
        <div>
          <p><strong>${isAr ? 'العقد:' : 'Contract:'}</strong> ${contract?.contractName || 'N/A'}</p>
          <p><strong>${isAr ? 'الحالة:' : 'Status:'}</strong> ${ipc.status.toUpperCase()}</p>
        </div>
      </div>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px; font-size: 9px;">
        <thead>
          <tr style="background-color: #2563eb; color: white;">
            <th style="border: 1px solid #ddd; padding: 4px;">${isAr ? 'الفصل' : 'Chapter'}</th>
            <th style="border: 1px solid #ddd; padding: 4px;">${isAr ? 'القسم' : 'Section'}</th>
            <th style="border: 1px solid #ddd; padding: 4px;">${isAr ? 'كود البند' : 'Item Code'}</th>
            <th style="border: 1px solid #ddd; padding: 4px;">${isAr ? 'الوحدة' : 'Unit'}</th>
            <th style="border: 1px solid #ddd; padding: 4px;">${isAr ? 'الكمية' : 'Tender Qty'}</th>
            <th style="border: 1px solid #ddd; padding: 4px;">${isAr ? 'السعر' : 'Price'}</th>
            <th style="border: 1px solid #ddd; padding: 4px;">${isAr ? 'سابق' : 'Prev'}</th>
            <th style="border: 1px solid #ddd; padding: 4px;">${isAr ? 'حالي' : 'Curr'}</th>
            <th style="border: 1px solid #ddd; padding: 4px;">${isAr ? 'اجمالي' : 'Total'}</th>
            <th style="border: 1px solid #ddd; padding: 4px;">${isAr ? 'نسبة التنفيذ' : 'Exec %'}</th>
            <th style="border: 1px solid #ddd; padding: 4px;">${isAr ? 'القيمة' : 'Value'}</th>
          </tr>
        </thead>
        <tbody>
          ${(() => {
            const chapters: { [key: string]: BillingItem[] } = {};
            ipc.items?.forEach(item => {
              const chapter = item.chapterName || (isAr ? 'غير مصنف' : 'Uncategorized');
              if (!chapters[chapter]) chapters[chapter] = [];
              chapters[chapter].push(item);
            });

            return Object.entries(chapters).map(([chapterName, items]) => {
              const chapterTotal = items.reduce((sum, item) => sum + item.amount, 0);
              const rows = items.map(item => {
                const execPct = item.tenderQty ? (item.totalQty / item.tenderQty) * 100 : 0;
                return `
                  <tr>
                    <td style="border: 1px solid #ddd; padding: 4px;">${chapterName}</td>
                    <td style="border: 1px solid #ddd; padding: 4px;">${item.sectionName || '-'}</td>
                    <td style="border: 1px solid #ddd; padding: 4px; text-align: center;">${item.itemCode}</td>
                    <td style="border: 1px solid #ddd; padding: 4px; text-align: center;">${item.unit}</td>
                    <td style="border: 1px solid #ddd; padding: 4px; text-align: center;">${(item.tenderQty || 0).toLocaleString()}</td>
                    <td style="border: 1px solid #ddd; padding: 4px; text-align: center;">${item.rate.toLocaleString()}</td>
                    <td style="border: 1px solid #ddd; padding: 4px; text-align: center;">${item.previousQty.toLocaleString()}</td>
                    <td style="border: 1px solid #ddd; padding: 4px; text-align: center;">${item.currentQty.toLocaleString()}</td>
                    <td style="border: 1px solid #ddd; padding: 4px; text-align: center;">${item.totalQty.toLocaleString()}</td>
                    <td style="border: 1px solid #ddd; padding: 4px; text-align: center;">${execPct.toFixed(1)}%</td>
                    <td style="border: 1px solid #ddd; padding: 4px; text-align: center;">${item.amount.toLocaleString()}</td>
                  </tr>
                `;
              }).join('');

              return `
                ${rows}
                <tr style="background-color: #f3f4f6; font-weight: bold;">
                  <td colspan="10" style="border: 1px solid #ddd; padding: 6px; text-align: left;">${isAr ? 'إجمالي الفصل:' : 'Chapter Total:'} ${chapterName}</td>
                  <td style="border: 1px solid #ddd; padding: 6px; text-align: center;">${chapterTotal.toLocaleString()}</td>
                </tr>
              `;
            }).join('');
          })()}
        </tbody>
      </table>

      <div style="margin-top: 20px; border-top: 2px solid #eee; padding-top: 20px; font-size: 14px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
          <span>${isAr ? 'قيمة الأعمال (بدون ضريبة):' : 'Work Value (Excl. VAT):'}</span>
          <strong>${ipc.worksValueExVat.toLocaleString()} EGP</strong>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
          <span>${isAr ? 'قيمة الضريبة المضافة:' : 'VAT Amount:'}</span>
          <strong>${ipc.vatAmount.toLocaleString()} EGP</strong>
        </div>
        
        <div style="margin: 15px 0; padding: 10px; background-color: #f9fafb; border-radius: 4px;">
          <h3 style="font-size: 14px; margin-bottom: 10px; border-bottom: 1px solid #ddd; padding-bottom: 5px;">${isAr ? 'الاستقطاعات بالتفصيل' : 'Deductions Detail'}</h3>
          <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
            <span>${isAr ? `حجز ضمان أعمال (${((ipc.execGuaranteeAmount / ipc.worksValueExVat) * 100).toFixed(1)}%):` : `Execution Guarantee (${((ipc.execGuaranteeAmount / ipc.worksValueExVat) * 100).toFixed(1)}%):`}</span>
            <span>${ipc.execGuaranteeAmount.toLocaleString()} EGP</span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
            <span>${isAr ? `مصلحة الضرائب - خصم وإضافة (${((ipc.whtAmount / ipc.worksValueExVat) * 100).toFixed(1)}%):` : `WHT (${((ipc.whtAmount / ipc.worksValueExVat) * 100).toFixed(1)}%):`}</span>
            <span>${(ipc.whtAmount || 0).toLocaleString()} EGP</span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
            <span>${isAr ? `حجز تحت حساب التأمينات (${((ipc.labourInsuranceAmount / ipc.worksValueExVat) * 100).toFixed(1)}%):` : `Labour Insurance (${((ipc.labourInsuranceAmount / ipc.worksValueExVat) * 100).toFixed(1)}%):`}</span>
            <span>${ipc.labourInsuranceAmount.toLocaleString()} EGP</span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
            <span>${isAr ? `حجز تحت حساب القوى العاملة (${((ipc.manpowerLevyAmount / ipc.worksValueExVat) * 100).toFixed(3)}%):` : `Manpower Levy (${((ipc.manpowerLevyAmount / ipc.worksValueExVat) * 100).toFixed(3)}%):`}</span>
            <span>${ipc.manpowerLevyAmount.toLocaleString()} EGP</span>
          </div>
          ${(ipc.advancePaymentRecovery || 0) > 0 ? `
          <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
            <span>${isAr ? 'استرداد دفعة مقدمة:' : 'Advance Recovery:'}</span>
            <span>${ipc.advancePaymentRecovery.toLocaleString()} EGP</span>
          </div>
          ` : ''}
          <div style="display: flex; justify-content: space-between; margin-top: 5px; font-weight: bold; border-top: 1px dashed #ccc; padding-top: 5px;">
            <span>${isAr ? 'إجمالي الاستقطاعات:' : 'Total Deductions:'}</span>
            <span>${(ipc.execGuaranteeAmount + (ipc.whtAmount || 0) + ipc.labourInsuranceAmount + ipc.manpowerLevyAmount + (ipc.advancePaymentRecovery || 0)).toLocaleString()} EGP</span>
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; font-size: 18px; color: #16a34a; border-top: 1px solid #eee; padding-top: 10px;">
          <span>${isAr ? 'صافي المستحق الصرف:' : 'Net Payable:'}</span>
          <strong>${ipc.netPayable.toLocaleString()} EGP</strong>
        </div>
      </div>
    `;

    const opt = {
      margin: 10,
      filename: `IPC_${ipc.billingNumber}.pdf`,
      image: { type: 'jpeg' as const, quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm' as const, format: 'a4' as const, orientation: 'landscape' as const }
    };

    html2pdf().set(opt).from(element).save();
  };

  const handleUpdateStatus = async (ipcId: string, newStatus: BillingIPC['status']) => {
    try {
      const { updateDoc, doc } = await import('firebase/firestore');
      await updateDoc(doc(db, 'billing', ipcId), { status: newStatus });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'billing');
    }
  };

  const handleDeleteIPC = (ipc: BillingIPC) => {
    setConfirmConfig({
      isOpen: true,
      title: language === 'ar' ? 'تأكيد الحذف' : 'Confirm Delete',
      message: language === 'ar' ? 'هل أنت متأكد من حذف هذا المستخلص؟ سيتم حذف القيد المحاسبي المرتبط به أيضاً.' : 'Are you sure you want to delete this IPC? The associated journal entry will also be deleted.',
      onConfirm: async () => {
        setIsSubmitting(true);
        try {
          // 1. Delete the billing document
          await accountingService.softDelete('billing', ipc.id);
          
          // 2. Delete the associated transaction if it exists
          if (ipc.transactionId) {
            await accountingService.deleteTransaction(ipc.transactionId);
          }
          setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, 'billing');
        } finally {
          setIsSubmitting(false);
        }
      }
    });
  };

  const handleClearIPCs = async () => {
    if (!selectedContractId) return;
    
    setConfirmConfig({
      isOpen: true,
      title: language === 'ar' ? 'تأكيد المسح' : 'Confirm Clear',
      message: language === 'ar' ? 'هل أنت متأكد من رغبتك في مسح كافة مستخلصات هذا العقد؟' : 'Are you sure you want to clear all IPCs for this contract?',
      onConfirm: async () => {
        setIsSubmitting(true);
        try {
          const { updateDoc, doc, getDocs } = await import('firebase/firestore');
          const q = query(collection(db, 'billing'), where('contractId', '==', selectedContractId), where('isDeleted', '==', false));
          const snapshot = await getDocs(q);
          
          const deletePromises = snapshot.docs.map(d => updateDoc(doc(db, 'billing', d.id), { isDeleted: true }));
          await Promise.all(deletePromises);
          
          setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, 'billing');
        } finally {
          setIsSubmitting(false);
        }
      }
    });
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
          <h2 className="text-3xl font-bold tracking-tight">{t('billing')}</h2>
          <p className="text-gray-400 mt-1">{language === 'ar' ? 'إدارة مستخلصات الأعمال، الاستقطاعات، والتحصيل' : 'Manage business IPCs, deductions, and collections'}</p>
        </div>
        <div className="flex gap-2">
          <button 
            disabled={!selectedContractId || isSubmitting || billings.length === 0}
            onClick={handleClearIPCs}
            className="bg-red-900/20 hover:bg-red-900/40 text-red-500 px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 border border-red-900/50"
          >
            <Trash2 size={18} />
            {language === 'ar' ? 'تفريغ' : 'Clear'}
          </button>
          <button 
            disabled={!selectedContractId}
            onClick={() => handleOpenModal()}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-600 px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 text-white"
          >
            <Plus size={18} />
            {language === 'ar' ? 'مستخلص جديد' : 'New IPC'}
          </button>
        </div>
      </header>

      {/* Selectors */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div className={cn("border p-4 rounded-xl flex items-center gap-4", theme === 'dark' ? "bg-[#151619] border-gray-800" : "bg-white border-gray-200 shadow-sm")}>
          <div className="p-2 bg-blue-900/20 rounded-lg text-blue-500">
            <Briefcase size={20} />
          </div>
          <div className="flex-1">
            <label className="text-[10px] text-gray-500 font-bold uppercase block mb-1">{language === 'ar' ? 'المشروع' : 'Project'}</label>
            <select 
              className={cn("bg-transparent text-lg font-bold outline-none w-full cursor-pointer", theme === 'dark' ? "text-white" : "text-gray-900")}
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
            >
              <option value="" disabled>{language === 'ar' ? 'اختر المشروع' : 'Select Project'}</option>
              {projects.map(p => (
                <option key={p.id} value={p.id} className={theme === 'dark' ? "bg-[#151619]" : "bg-white"}>{p.projectName} ({p.projectCode})</option>
              ))}
            </select>
          </div>
        </div>

        <div className={cn("border p-4 rounded-xl flex items-center gap-4", theme === 'dark' ? "bg-[#151619] border-gray-800" : "bg-white border-gray-200 shadow-sm")}>
          <div className="p-2 bg-purple-900/20 rounded-lg text-purple-500">
            <FileText size={20} />
          </div>
          <div className="flex-1">
            <label className="text-[10px] text-gray-500 font-bold uppercase block mb-1">{language === 'ar' ? 'العقد' : 'Contract'}</label>
            <select 
              className={cn("bg-transparent text-lg font-bold outline-none w-full cursor-pointer", theme === 'dark' ? "text-white" : "text-gray-900")}
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

      {/* Billing List */}
      <div className="grid grid-cols-1 gap-4">
        {loading ? (
          <div className="p-12 text-center text-gray-500 flex flex-col items-center gap-4">
            <Loader2 className="animate-spin text-blue-500" size={32} />
            {language === 'ar' ? 'جاري تحميل المستخلصات...' : 'Loading IPCs...'}
          </div>
        ) : billings.length === 0 ? (
          <div className="p-12 text-center text-gray-500">{language === 'ar' ? 'لا توجد مستخلصات مسجلة لهذا المشروع.' : 'No IPCs recorded for this project.'}</div>
        ) : (
          billings.map((ipc) => (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              key={ipc.id} 
              className={cn(
                "border rounded-xl p-6 transition-all group", 
                theme === 'dark' ? "bg-[#151619] border-gray-800 hover:border-gray-700" : 
                theme === 'soft' ? "bg-white border-[#cfd8dc] hover:border-[#546e7a]" : 
                "bg-white border-gray-200 hover:border-blue-200 shadow-sm"
              )}
            >
              <div className="flex justify-between items-start mb-4">
                <div className="flex gap-4">
                  <div className={cn(
                    "w-10 h-10 rounded-lg flex items-center justify-center border", 
                    theme === 'dark' ? "bg-gray-900 border-gray-800" : 
                    theme === 'soft' ? "bg-[#eceff1] border-[#cfd8dc]" : 
                    "bg-gray-50 border-gray-200"
                  )}>
                    <FileText className="text-blue-500" size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold">{language === 'ar' ? 'مستخلص رقم:' : 'IPC No:'} {ipc.billingNumber}</h3>
                    <p className="text-xs text-gray-500 mt-1">{language === 'ar' ? 'بتاريخ:' : 'Date:'} {formatDate(ipc.date)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={cn(
                    "text-[10px] font-bold px-2 py-1 rounded uppercase",
                    ipc.status === 'paid' ? "bg-green-900/20 text-green-500" : 
                    ipc.status === 'draft' ? "bg-gray-800 border border-gray-700 text-gray-400" :
                    ipc.status === 'review' ? "bg-blue-900/20 text-blue-500" :
                    "bg-yellow-900/20 text-yellow-500"
                  )}>
                    {ipc.status === 'paid' ? (language === 'ar' ? 'تم التحصيل' : 'Paid') : 
                     ipc.status === 'draft' ? (language === 'ar' ? 'مسودة' : 'Draft') :
                     ipc.status === 'review' ? (language === 'ar' ? 'قيد المراجعة' : 'Under Review') :
                     (language === 'ar' ? 'تم الاعتماد' : 'Approved')}
                  </span>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handleOpenModal(ipc)}
                      className="text-gray-500 hover:text-blue-500 transition-colors"
                      title={language === 'ar' ? 'تعديل' : 'Edit'}
                    >
                      <Edit2 size={16} />
                    </button>
                    <button 
                      onClick={() => handleDeleteIPC(ipc)}
                      className="text-gray-500 hover:text-red-500 transition-colors"
                      title={language === 'ar' ? 'حذف' : 'Delete'}
                    >
                      <Trash2 size={16} />
                    </button>
                    {ipc.status === 'submitted' && (
                      <button 
                        onClick={() => handleUpdateStatus(ipc.id, 'review')}
                        className="text-gray-500 hover:text-blue-500 transition-colors"
                        title={language === 'ar' ? 'إرسال للمراجعة' : 'Send for Review'}
                      >
                        <Clock size={16} />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className={cn("grid grid-cols-2 md:grid-cols-4 gap-6 py-4 border-t mt-4", theme === 'dark' ? "border-gray-800/50" : "border-gray-100")}>
                <div>
                  <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">{language === 'ar' ? 'قيمة الأعمال' : 'Work Value'}</p>
                  <p className="text-sm font-bold">{ipc.worksValueExVat.toLocaleString()} <span className="text-[10px] font-normal opacity-50">{language === 'ar' ? 'ج.م' : 'EGP'}</span></p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">{language === 'ar' ? 'ضريبة القيمة المضافة' : 'VAT'}</p>
                  <p className="text-sm font-bold text-blue-400">+{ipc.vatAmount.toLocaleString()} <span className="text-[10px] font-normal opacity-50">{language === 'ar' ? 'ج.م' : 'EGP'}</span></p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">{language === 'ar' ? 'إجمالي الاستقطاعات' : 'Total Deductions'}</p>
                  <p className="text-sm font-bold text-red-400">-{ (ipc.execGuaranteeAmount + (ipc.whtAmount || 0) + ipc.labourInsuranceAmount + ipc.manpowerLevyAmount + (ipc.advancePaymentRecovery || 0)).toLocaleString() } <span className="text-[10px] font-normal opacity-50">{language === 'ar' ? 'ج.م' : 'EGP'}</span></p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">{language === 'ar' ? 'صافي المستحق' : 'Net Payable'}</p>
                  <p className="text-lg font-bold text-green-500">{ipc.netPayable.toLocaleString()} <span className="text-[10px] font-normal opacity-50">{language === 'ar' ? 'ج.م' : 'EGP'}</span></p>
                </div>
              </div>

              <div className={cn("mt-4 pt-4 border-t flex justify-between items-center", theme === 'dark' ? "border-gray-800/50" : "border-gray-100")}>
                <div className="flex gap-4">
                  <div className="flex items-center gap-1 text-[10px] text-gray-500">
                    <CheckCircle2 size={12} className="text-green-500" />
                    <span>{language === 'ar' ? 'تم اعتماد المكتب الفني' : 'Technical Office Approved'}</span>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-gray-500">
                    <Clock size={12} className="text-yellow-500" />
                    <span>{language === 'ar' ? 'في انتظار تحويل البنك' : 'Awaiting Bank Transfer'}</span>
                  </div>
                </div>
                <button 
                  onClick={() => handleDownloadPDF(ipc)}
                  className="text-blue-500 hover:text-blue-400 text-xs font-bold flex items-center gap-1 bg-blue-500/10 px-3 py-1.5 rounded-lg transition-colors"
                >
                  <Printer size={14} />
                  {language === 'ar' ? 'طباعة' : 'Print'}
                </button>
              </div>
            </motion.div>
          ))
        )}
      </div>

      {/* Modals */}
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

        <IPCFormModal
          isOpen={isModalOpen}
          editingIPC={editingIPC}
          formData={formData}
          setFormData={setFormData}
          isSubmitting={isSubmitting}
          contracts={contracts}
          selectedContractId={selectedContractId}
          onClose={() => setIsModalOpen(false)}
          onSubmit={(status) => handleSubmit(undefined, status)}
          onItemQtyChange={handleItemQtyChange}
          onItemRateChange={handleItemRateChange}
          theme={theme}
          language={language}
          dir={dir}
        />

      </AnimatePresence>
    </div>
  );
}
