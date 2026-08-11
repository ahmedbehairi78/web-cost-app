import { formatNumber } from '../../lib/numberLocale';
import React, { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Download, Calculator, X, Loader2, Printer, ChevronDown, ChevronUp } from 'lucide-react';
import { cn, roundMoney2 } from '../../lib/utils';
import { IPC_KIND, type IpcKind } from '../../constants/billingDefaults';
import { buildIpcCoverWorksSplit, ipcLineToDateAmount } from '../../lib/ipcCoverFromQtyList';
import { computeIpcBillingAmounts } from '../../lib/ipcBillingAmounts';
import { buildIpcCoverSchedule } from '../../lib/ipcCoverSchedule';
import { buildIpcCoverContractSums } from '../../lib/ipcCoverContractSums';
import type { VariationOrder } from '../../types';
import { ManualHelpButton } from '../help/ManualHelpButton';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { useLanguage } from '../../context/LanguageContext';
import { IpcCoverPanel } from './IpcCoverPanel';

const ipcSchema = z.object({
  billingNumber: z.string().min(1),
  date: z.string().min(1),
});

interface BOQItem {
  id: string;
  chapterCode: string;
  chapterName: string;
  workTypeCode: string;
  sectionCode: string;
  sectionName: string;
  itemCode: string;
  description: string;
  unit: string;
  tenderQty: number;
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

interface BillingIPC {
  id: string;
  billingNumber: string;
  date: any;
  items: BillingItem[];
  worksValueExVat: number;
  vatAmount: number;
  execGuaranteeAmount: number;
  whtAmount: number;
  labourInsuranceAmount: number;
  manpowerLevyAmount: number;
  advancePaymentTotal?: number;
  advancePaymentRecovery: number;
  netPayable: number;
  status: string;
  transactionId?: string;
}

interface Contract {
  id: string;
  contractName: string;
  contractNumber: string;
  projectId: string;
  startDate?: string | null;
  endDate?: string | null;
  contractValue?: number | null;
}

interface FormData {
  billingNumber: string;
  date: string;
  items: BillingItem[];
  vatPct: number;
  execGuaranteePct: number;
  whtPct: number;
  labourInsurancePct: number;
  manpowerLevyPct: number;
  performanceSecurityPct: number;
  syndicateStampPct: number;
  backChargeAmount: number;
  advancePaymentTotal?: number;
  advancePaymentRecovery: number;
  ipcKind: IpcKind;
}

interface Props {
  isOpen: boolean;
  editingIPC: BillingIPC | null;
  formData: FormData;
  setFormData: (data: FormData) => void;
  isSubmitting: boolean;
  contracts: Contract[];
  selectedContractId: string;
  onClose: () => void;
  onSubmit: (status: 'draft' | 'submitted') => void;
  onItemQtyChange: (idx: number, qty: number) => void;
  onItemRateChange: (idx: number, rate: number) => void;
  theme: string;
  language: string;
  dir: string;
  boqItemIdsWithCost?: ReadonlySet<string>;
  /** بعد اعتماد/إرسال المستخلص لا يُغيّر نوعه من الواجهة */
  ipcKindReadOnly?: boolean;
  onPrintPreview?: () => void;
  /** Preview Cover-JLL page only (A4 landscape, no qty list). */
  onPrintCoverPreview?: () => void;
  /** Count of IPC lines where totalQty > tenderQty (BOQ / VO sync). */
  boqExceedCount?: number;
  /** BOQ ids created by approved VOs — marks additional works on cover + row badge. */
  voCreatedBoqItemIds?: ReadonlySet<string>;
  /** Approved VOs for Cover-JLL contract sums. */
  approvedVariationOrders?: VariationOrder[];
  /** Approved MOS total claimed (materials on site). */
  materialsOnSiteTotal?: number;
  /** Σ netPayable of prior approved/paid IPCs for cover. */
  previousPayments?: number;
  /** Max prior recovery / back-charge to date (Cover stores cumulative). */
  priorAdvanceRecoveryToDate?: number;
  priorBackChargeToDate?: number;
}

const EMPTY_VO_IDS: ReadonlySet<string> = new Set();

export function IPCFormModal({
  isOpen, editingIPC, formData, setFormData, isSubmitting,
  contracts, selectedContractId, onClose, onSubmit,
  onItemQtyChange, onItemRateChange, theme, language, dir,
  boqItemIdsWithCost,
  ipcKindReadOnly = false,
  onPrintPreview,
  onPrintCoverPreview,
  boqExceedCount = 0,
  voCreatedBoqItemIds,
  approvedVariationOrders = [],
  materialsOnSiteTotal = 0,
  previousPayments = 0,
  priorAdvanceRecoveryToDate = 0,
  priorBackChargeToDate = 0,
}: Props) {
  const { t, formatMoney } = useLanguage();
  const voIds = voCreatedBoqItemIds ?? EMPTY_VO_IDS;
  const [showQtyItems, setShowQtyItems] = useState(false);
  const coverWorks = useMemo(
    () => buildIpcCoverWorksSplit(formData.items, voIds),
    [formData.items, voIds],
  );
  const selectedContract = contracts.find((c) => c.id === selectedContractId);
  const coverSchedule = useMemo(
    () =>
      buildIpcCoverSchedule({
        startDate: selectedContract?.startDate,
        endDate: selectedContract?.endDate,
        language,
      }),
    [selectedContract?.startDate, selectedContract?.endDate, language],
  );
  const coverContractSums = useMemo(
    () =>
      buildIpcCoverContractSums({
        originalContractSum: selectedContract?.contractValue,
        approvedVos: approvedVariationOrders,
      }),
    [selectedContract?.contractValue, approvedVariationOrders],
  );
  const { formState: { errors }, trigger, setValue, reset } = useForm({
    resolver: zodResolver(ipcSchema),
    defaultValues: { billingNumber: formData.billingNumber, date: formData.date },
  });

  useEffect(() => {
    if (isOpen) {
      reset({ billingNumber: formData.billingNumber, date: formData.date });
      setShowQtyItems(false);
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmitClick = async (status: 'draft' | 'submitted') => {
    const valid = await trigger(['billingNumber', 'date']);
    if (!valid) return;
    onSubmit(status);
  };

  const billingAmounts = useMemo(
    () =>
      computeIpcBillingAmounts({
        items: formData.items,
        voCreatedBoqItemIds: voIds,
        materialsOnSite: materialsOnSiteTotal,
        rates: {
          vatPct: formData.vatPct,
          whtPct: formData.whtPct,
          retentionPct: formData.execGuaranteePct,
          performancePct: formData.performanceSecurityPct,
          insurancePct: formData.labourInsurancePct,
          manpowerPct: formData.manpowerLevyPct,
          syndicatePct: formData.syndicateStampPct,
        },
        advancePaymentTotal: formData.advancePaymentTotal,
        advancePaymentRecovery: formData.advancePaymentRecovery,
        backChargeAmount: formData.backChargeAmount,
        previousPayments,
        priorAdvanceRecoveryToDate,
        priorBackChargeToDate,
      }),
    [
      formData.items,
      formData.vatPct,
      formData.whtPct,
      formData.execGuaranteePct,
      formData.performanceSecurityPct,
      formData.labourInsurancePct,
      formData.manpowerLevyPct,
      formData.syndicateStampPct,
      formData.advancePaymentTotal,
      formData.advancePaymentRecovery,
      formData.backChargeAmount,
      voIds,
      materialsOnSiteTotal,
      previousPayments,
      priorAdvanceRecoveryToDate,
      priorBackChargeToDate,
    ],
  );

  /** Period works (VAT-inclusive rates) — for Excel summary labels. */
  const worksValueExVat = billingAmounts.periodWorksInclVat;

  const calculateDeductions = () => ({
    vat: billingAmounts.vat,
    exec: billingAmounts.exec,
    wht: billingAmounts.wht,
    insurance: billingAmounts.insurance,
    levy: billingAmounts.levy,
    performanceSecurity: billingAmounts.performanceSecurity,
    syndicateStamp: billingAmounts.syndicateStamp,
    backCharge: formData.backChargeAmount,
    advance: formData.advancePaymentRecovery,
    net: billingAmounts.net,
  });

  const handleExportExcel = () => {
    const isAr = language === 'ar';
    const aoa: any[][] = [[isAr ? 'الفصل' : 'Chapter', isAr ? 'القسم' : 'Section', isAr ? 'كود البند' : 'Item Code', isAr ? 'البيان' : 'Description', isAr ? 'الوحدة' : 'Unit', isAr ? 'الكمية التعاقدية' : 'Tender Qty', isAr ? 'الفئة' : 'Rate', isAr ? 'الكمية السابقة' : 'Prev Qty', isAr ? 'الكمية الحالية' : 'Curr Qty', isAr ? 'إجمالي الكمية' : 'Total Qty', isAr ? 'نسبة التنفيذ' : 'Comp %', isAr ? 'القيمة' : 'Amount']];
    const { vat, exec, wht, insurance, levy, performanceSecurity, syndicateStamp, backCharge, advance, net } =
      calculateDeductions();
    const totalDeductions =
      exec + performanceSecurity + wht + insurance + levy + syndicateStamp + backCharge + advance;

    const chapters: { [k: string]: BillingItem[] } = {};
    formData.items.forEach(item => {
      const ch = item.chapterName || (isAr ? 'غير مصنف' : 'Uncategorized');
      if (!chapters[ch]) chapters[ch] = [];
      chapters[ch].push(item);
    });

    Object.entries(chapters).forEach(([chName, items]) => {
      const chTotal = items.reduce((s, i) => s + i.amount, 0);
      items.forEach(item => aoa.push([item.chapterName, item.sectionName, item.itemCode, item.description, item.unit, item.tenderQty, item.rate, item.previousQty, item.currentQty, item.totalQty, (item.tenderQty ? (item.totalQty / item.tenderQty) * 100 : 0).toFixed(2) + '%', item.amount]));
      aoa.push([isAr ? `إجمالي الفصل: ${chName}` : `Chapter Total: ${chName}`, '', '', '', '', '', '', '', '', '', '', chTotal]);
      aoa.push([]);
    });

    aoa.push(
      [],
      [isAr ? 'الملخص المالي' : 'Financial Summary'],
      [isAr ? 'قيمة الأعمال (بدون ضريبة):' : 'Work Value (Excl. VAT):', '', '', '', '', '', '', '', '', '', '', worksValueExVat],
      [isAr ? 'ضريبة القيمة المضافة (+):' : 'VAT Amount (+):', '', '', '', '', '', '', '', '', '', '', vat],
      [],
      [isAr ? 'تفاصيل المبالغ المحتجزة' : 'Retention Details'],
      [
        isAr ? 'نوع المحتجز' : 'Retention Type',
        isAr ? 'النسبة' : 'Rate',
        isAr ? 'قيمة الأعمال الخاضعة' : 'Base Amount',
        isAr ? 'قيمة المحتجز' : 'Retention Amount'
      ],
      [isAr ? 'حجز ضمان أعمال' : 'Retention', `${formData.execGuaranteePct}%`, worksValueExVat, exec],
      [isAr ? 'ضمان أداء' : 'Performance Security', `${formData.performanceSecurityPct}%`, worksValueExVat, performanceSecurity],
      [isAr ? 'مصلحة الضرائب - خصم وإضافة' : 'WHT', `${formData.whtPct}%`, worksValueExVat, wht],
      [isAr ? 'حجز تحت حساب التأمينات' : 'Labour Insurance', `${formData.labourInsurancePct}%`, worksValueExVat, insurance],
      [isAr ? 'القوى العاملة' : 'Labour Force', `${formData.manpowerLevyPct}%`, worksValueExVat, levy],
      [isAr ? 'دمغة نقابة المهندسين' : 'Syndicate Stamp', `${formData.syndicateStampPct}%`, worksValueExVat, syndicateStamp],
      [isAr ? 'إجمالي المبالغ المحتجزة' : 'Total Retentions', '', '', totalDeductions - advance],
    );
    if (backCharge > 0) {
      aoa.push([isAr ? 'خصومات ومبالغ محتجزة' : 'Back Charge', '', '', backCharge]);
    }
    if (advance > 0) {
      aoa.push([isAr ? 'استرداد دفعة مقدمة' : 'Advance Recovery', '', worksValueExVat, advance]);
    }
    aoa.push(
      [isAr ? 'إجمالي الاستقطاعات:' : 'Total Deductions:', '', '', '', '', '', '', '', '', '', '', totalDeductions],
      [isAr ? 'صافي المستحق الصرف:' : 'Net Payable:', '', '', '', '', '', '', '', '', '', '', net]
    );

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'IPC Items');
    XLSX.writeFile(wb, `${formData.billingNumber || 'IPC'}_Export.xlsx`);
  };

  const handleImportExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const wb = XLSX.read(evt.target?.result, { type: 'binary' });
      const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]) as any[];
      const updated = [...formData.items];
      data.forEach(row => {
        const itemCode = row[language === 'ar' ? 'كود البند' : 'Item Code'];
        const currQty = Number(row[language === 'ar' ? 'الكمية الحالية' : 'Curr Qty']);
        if (itemCode !== undefined && !isNaN(currQty)) {
          const idx = updated.findIndex(i => i.itemCode === String(itemCode));
          if (idx !== -1) {
            const item = updated[idx];
            const totalQty = item.previousQty + currQty;
            updated[idx] = {
              ...item,
              currentQty: currQty,
              totalQty,
              amount: currQty * item.rate,
            };
          }
        }
      });
      setFormData({ ...formData, items: updated });
    };
    reader.readAsBinaryString(file);
  };

  const handlePrintIPC = () => {
    onPrintPreview?.();
  };
  const handlePrintCover = () => {
    onPrintCoverPreview?.();
  };

  const { vat, exec, wht, insurance, levy, performanceSecurity, syndicateStamp, backCharge, advance, net } =
    calculateDeductions();

  const coverRates = {
    vatPct: formData.vatPct,
    whtPct: formData.whtPct,
    retentionPct: formData.execGuaranteePct,
    performancePct: formData.performanceSecurityPct,
    insurancePct: formData.labourInsurancePct,
    manpowerPct: formData.manpowerLevyPct,
    syndicatePct: formData.syndicateStampPct,
  };

  const inputCls = cn('w-full border rounded-lg py-2 px-4 text-sm outline-none focus:border-blue-500 transition-colors', theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200');

  const chapters: { [k: string]: typeof formData.items } = {};
  formData.items.forEach(item => {
    const ch = item.chapterName || (language === 'ar' ? 'غير مصنف' : 'Uncategorized');
    if (!chapters[ch]) chapters[ch] = [];
    chapters[ch].push(item);
  });

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto overscroll-contain bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className={cn(
              'border rounded-2xl w-full max-w-6xl max-h-[min(95dvh,calc(100vh-2rem))] flex flex-col overflow-hidden shadow-2xl my-auto',
              theme === 'dark' ? 'bg-[#151619] border-gray-800' : 'bg-white border-gray-200',
            )}
          >
            <div className={cn('p-4 sm:p-6 border-b flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center shrink-0', theme === 'dark' ? 'bg-gray-900/50 border-gray-800' : 'bg-gray-50 border-gray-200')}>
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 bg-blue-600 rounded-lg text-white shrink-0"><Calculator size={20} /></div>
                <div className="min-w-0">
                  <h3 className="text-xl font-bold">{editingIPC ? (language === 'ar' ? 'تعديل مستخلص الأعمال' : 'Edit IPC') : (language === 'ar' ? 'إنشاء مستخلص أعمال جديد' : 'Create New IPC')}</h3>
                  <p className="text-[10px] text-gray-500 truncate">{contracts.find(c => c.id === selectedContractId)?.contractName}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button type="button" onClick={handleExportExcel} className="text-xs bg-green-600 hover:bg-green-500 text-white px-3 py-1.5 rounded-lg flex items-center gap-2 transition-all"><Download size={14} />{language === 'ar' ? 'تصدير إكسل' : 'Export Excel'}</button>
                <label className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg flex items-center gap-2 transition-all cursor-pointer"><Plus size={14} />{language === 'ar' ? 'استيراد إكسل' : 'Import Excel'}<input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportExcel} /></label>
                <ManualHelpButton
                  topicId={formData.ipcKind === IPC_KIND.FINAL ? 'technical.billing.final' : 'technical.billing.interim'}
                  size={16}
                />
                <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors"><X size={20} /></button>
              </div>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); handleSubmitClick('submitted'); }} className="flex flex-col flex-1 min-h-0">
              <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 sm:p-6 space-y-6">
              {boqExceedCount > 0 ? (
                <div
                  className={cn(
                    'rounded-lg border px-4 py-3 text-sm flex items-start gap-2',
                    theme === 'dark'
                      ? 'border-amber-700/50 bg-amber-950/30 text-amber-200'
                      : 'border-amber-200 bg-amber-50 text-amber-900',
                  )}
                  role="status"
                >
                  <span className="flex-1">
                    {t('ipc_exceeds_boq_banner').replace('{count}', String(boqExceedCount))}
                  </span>
                  <ManualHelpButton topicId="technical.billing.qty_limits" size={14} />
                </div>
              ) : null}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase">{language === 'ar' ? 'رقم المستخلص' : 'IPC Number'}<span className="text-red-500 ml-1">*</span></label>
                  <input type="text" className={cn(inputCls, errors.billingNumber && 'border-red-500')} value={formData.billingNumber} onChange={(e) => { setFormData({ ...formData, billingNumber: e.target.value }); setValue('billingNumber', e.target.value); }} />
                  {errors.billingNumber && <p className="text-[10px] text-red-500">{language === 'ar' ? 'هذا الحقل مطلوب' : 'This field is required'}</p>}
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase">{language === 'ar' ? 'التاريخ' : 'Date'}<span className="text-red-500 ml-1">*</span></label>
                  <input type="date" className={cn(inputCls, errors.date && 'border-red-500')} value={formData.date} onChange={(e) => { setFormData({ ...formData, date: e.target.value }); setValue('date', e.target.value); }} />
                  {errors.date && <p className="text-[10px] text-red-500">{language === 'ar' ? 'هذا الحقل مطلوب' : 'This field is required'}</p>}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-gray-400 uppercase">{language === 'ar' ? 'نوع المستخلص' : 'IPC kind'}</label>
                {ipcKindReadOnly ? (
                  <div
                    className={cn(
                      'text-sm font-bold px-3 py-2 rounded-lg border w-fit',
                      formData.ipcKind === IPC_KIND.FINAL
                        ? theme === 'dark'
                          ? 'bg-violet-950/50 border-violet-800 text-violet-300'
                          : 'bg-violet-50 border-violet-200 text-violet-900'
                        : theme === 'dark'
                          ? 'bg-slate-900/50 border-slate-700 text-slate-300'
                          : 'bg-slate-50 border-slate-200 text-slate-800',
                    )}
                  >
                    {formData.ipcKind === IPC_KIND.FINAL
                      ? (language === 'ar' ? 'نهائي — إغلاق العقد في التقارير' : 'Final — closes contract in reports')
                      : (language === 'ar' ? 'جاري' : 'Interim')}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, ipcKind: IPC_KIND.INTERIM })}
                      className={cn(
                        'px-4 py-2 rounded-lg text-sm font-bold border transition-colors',
                        formData.ipcKind === IPC_KIND.INTERIM
                          ? theme === 'dark'
                            ? 'bg-blue-600 border-blue-500 text-white'
                            : 'bg-blue-600 border-blue-600 text-white'
                          : theme === 'dark'
                            ? 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-600'
                            : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400',
                      )}
                    >
                      {language === 'ar' ? 'مستخلص جاري' : 'Interim IPC'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, ipcKind: IPC_KIND.FINAL })}
                      className={cn(
                        'px-4 py-2 rounded-lg text-sm font-bold border transition-colors',
                        formData.ipcKind === IPC_KIND.FINAL
                          ? theme === 'dark'
                            ? 'bg-violet-700 border-violet-500 text-white'
                            : 'bg-violet-600 border-violet-600 text-white'
                          : theme === 'dark'
                            ? 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-600'
                            : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400',
                      )}
                    >
                      {language === 'ar' ? 'مستخلص نهائي' : 'Final IPC'}
                    </button>
                  </div>
                )}
                <p className="text-[10px] text-gray-500 leading-relaxed max-w-2xl">
                  {language === 'ar'
                    ? 'النهائي المعتمد يُظهر اكتمال الأعمال في التقارير ويمنع إصدار مستخلص جديد على هذا العقد حتى حذف المستخلص النهائي.'
                    : 'An approved final IPC marks work complete in reports and blocks new IPCs for this contract until the final IPC is removed.'}
                </p>
              </div>

              {/* Percentages (edit rates) */}
              <div className={cn('grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 p-4 rounded-xl border', theme === 'dark' ? 'bg-gray-900/30 border-gray-800/50' : 'bg-gray-50 border-gray-200')}>
                {[
                  { label: 'VAT %', field: 'vatPct' as const, value: formData.vatPct },
                  { label: language === 'ar' ? 'حجز ضمان %' : 'Retention %', field: 'execGuaranteePct' as const, value: formData.execGuaranteePct },
                  { label: language === 'ar' ? 'ضمان أداء %' : 'Perf. Security %', field: 'performanceSecurityPct' as const, value: formData.performanceSecurityPct },
                  { label: language === 'ar' ? 'خصم وإضافة %' : 'WHT %', field: 'whtPct' as const, value: formData.whtPct },
                  { label: language === 'ar' ? 'تأمينات %' : 'Insurance %', field: 'labourInsurancePct' as const, value: formData.labourInsurancePct },
                  { label: language === 'ar' ? 'قوى عاملة %' : 'Labour Force %', field: 'manpowerLevyPct' as const, value: formData.manpowerLevyPct },
                  { label: language === 'ar' ? 'دمغة نقابة %' : 'Syndicate %', field: 'syndicateStampPct' as const, value: formData.syndicateStampPct },
                  { label: language === 'ar' ? 'Back Charge' : 'Back Charge', field: 'backChargeAmount' as const, value: formData.backChargeAmount },
                  { label: language === 'ar' ? 'إجمالي المقدمة' : 'Total Advance Payment', field: 'advancePaymentTotal' as const, value: formData.advancePaymentTotal },
                  { label: language === 'ar' ? 'استرداد مقدمة' : 'Advance Recovery', field: 'advancePaymentRecovery' as const, value: formData.advancePaymentRecovery },
                ].map(({ label, field, value }) => (
                  <div key={field} className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase">{label}</label>
                    <input type="number" step="0.01" className={inputCls} value={value || ''} onChange={(e) => setFormData({ ...formData, [field]: Number(e.target.value) })} />
                  </div>
                ))}
              </div>

              <IpcCoverPanel
                cover={coverWorks}
                schedule={coverSchedule}
                contractSums={coverContractSums}
                formatMoney={formatMoney}
                language={language}
                theme={theme}
                dir={dir === 'rtl' ? 'rtl' : 'ltr'}
                asOfDate={formData.date}
                materialsOnSite={materialsOnSiteTotal}
                vatPct={formData.vatPct}
                rates={coverRates}
                advancePaymentTotal={formData.advancePaymentTotal || 0}
                advanceRecovery={formData.advancePaymentRecovery || 0}
                backCharge={formData.backChargeAmount || 0}
                previousPayments={previousPayments}
              />

              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => setShowQtyItems((v) => !v)}
                  className={cn(
                    'w-full flex items-center justify-between gap-2 px-4 py-3 rounded-xl border text-sm font-bold transition-colors',
                    theme === 'dark'
                      ? 'border-gray-800 bg-gray-900/40 text-blue-300 hover:bg-gray-900'
                      : 'border-gray-200 bg-gray-50 text-blue-700 hover:bg-gray-100',
                  )}
                >
                  <span>
                    {language === 'ar' ? 'بنود المستخلص (قائمة الكميات)' : 'IPC line items (quantities)'}
                    <span className="ms-2 text-[10px] font-normal opacity-70">({formData.items.length})</span>
                  </span>
                  {showQtyItems ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>
                {showQtyItems ? (
                <div className="overflow-x-auto border border-gray-800 rounded-xl">
                  <table className={cn('w-full text-right text-[10px] transition-colors', theme === 'dark' ? 'bg-transparent' : 'bg-white')}>
                    <thead>
                      <tr className={cn('transition-colors', theme === 'dark' ? 'border-b border-gray-800 bg-gray-900/50 text-gray-500' : 'border-b border-gray-200 bg-gray-50 text-gray-600')}>
                        <th className="p-2">{language === 'ar' ? 'الفصل' : 'Chapter'}</th>
                        <th className="p-2">{language === 'ar' ? 'القسم' : 'Section'}</th>
                        <th className="p-2">{language === 'ar' ? 'البند' : 'Item'}</th>
                        <th className="p-2">{language === 'ar' ? 'الوحدة' : 'Unit'}</th>
                        <th className="p-2">{language === 'ar' ? 'الكمية' : 'Qty'}</th>
                        <th className="p-2">{language === 'ar' ? 'السعر' : 'Rate'}</th>
                        <th className="p-2">{language === 'ar' ? 'سابق' : 'Prev'}</th>
                        <th className="p-2">{language === 'ar' ? 'حالي' : 'Curr'}</th>
                        <th className="p-2">{language === 'ar' ? 'إجمالي' : 'Total'}</th>
                        <th className="p-2">{language === 'ar' ? '% تنفيذ' : '% Comp'}</th>
                        <th className="p-2">{language === 'ar' ? 'القيمة' : 'Amount'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {Object.entries(chapters).map(([chapterName, items], chapterIdx) => {
                        const chapterTotal = items.reduce((s, i) => s + ipcLineToDateAmount(i), 0);
                        return (
                          <React.Fragment key={`ipc-ch-${chapterIdx}-${chapterName || '—'}`}>
                            {items.map((item, rowIdx) => {
                              const idx = formData.items.findIndex(fi => fi.boqItemId === item.boqItemId);
                              const pct = item.tenderQty ? (item.totalQty / item.tenderQty) * 100 : 0;
                              const rateNum = Number(item.rate);
                              const costLinked = boqItemIdsWithCost?.has(item.boqItemId);
                              const isVoAdditional = voIds.has(item.boqItemId);
                              return (
                                <tr
                                  key={`ipc-row-${chapterIdx}-${rowIdx}-${item.boqItemId || item.itemCode || 'x'}`}
                                  className={cn(
                                    costLinked &&
                                      (theme === 'dark'
                                        ? 'bg-amber-950/35 border-s-4 border-amber-500'
                                        : 'bg-amber-50/90 border-s-4 border-amber-500'),
                                  )}
                                >
                                  <td className="p-2"><div className="font-bold">{item.chapterName}</div><div className="text-[8px] opacity-50">{item.chapterCode}</div></td>
                                  <td className="p-2"><div>{item.sectionName}</div><div className="text-[8px] opacity-50">{item.sectionCode}</div></td>
                                  <td className="p-2">
                                    <div className="max-w-[150px] truncate font-medium flex items-center gap-1">
                                      {isVoAdditional ? (
                                        <span
                                          className={cn(
                                            'shrink-0 rounded px-1 py-px text-[7px] font-bold uppercase',
                                            theme === 'dark' ? 'bg-violet-600/40 text-violet-200' : 'bg-violet-100 text-violet-800',
                                          )}
                                          title={language === 'ar' ? 'بند أمر تغيير' : 'Variation order item'}
                                        >
                                          {language === 'ar' ? 'إضافي' : 'VO'}
                                        </span>
                                      ) : null}
                                      {costLinked ? (
                                        <span
                                          className={cn(
                                            'shrink-0 rounded px-1 py-px text-[7px] font-bold uppercase',
                                            theme === 'dark' ? 'bg-amber-600/40 text-amber-200' : 'bg-amber-200 text-amber-900',
                                          )}
                                          title={language === 'ar' ? 'مرتبط بتكاليف فعلية' : 'Linked to actual cost'}
                                        >
                                          {language === 'ar' ? 'تكلفة' : 'AC'}
                                        </span>
                                      ) : null}
                                      <span className="truncate">{item.description}</span>
                                    </div>
                                    <div className="text-[8px] text-blue-400">{item.itemCode}</div>
                                  </td>
                                  <td className="p-2 text-center text-gray-400">{item.unit}</td>
                                  <td className="p-2 font-mono text-gray-400">{formatNumber(item.tenderQty ?? 0)}</td>
                                  <td className="p-2">
                                    <input type="number" step="0.01" inputMode="decimal" className={cn('w-24 border rounded py-1.5 px-2 text-center outline-none focus:border-blue-500 transition-colors font-mono', theme === 'dark' ? 'bg-gray-900 border-gray-800 text-green-400' : 'bg-white border-gray-300 text-green-700')} value={Number.isFinite(rateNum) ? roundMoney2(rateNum) : ''} onChange={(e) => onItemRateChange(idx, Number(e.target.value))} />
                                  </td>
                                  <td className="p-2 font-mono text-gray-500">{item.previousQty}</td>
                                  <td className="p-2">
                                    <input type="number" step="0.01" inputMode="decimal" className={cn('w-24 border rounded py-1.5 px-2 text-center outline-none focus:border-blue-500 transition-colors font-mono', theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-300 text-gray-900')} value={item.currentQty} onChange={(e) => onItemQtyChange(idx, Number(e.target.value))} />
                                  </td>
                                  <td className="p-2 font-mono">{item.totalQty}</td>
                                  <td className="p-2">
                                    <div className="flex items-center gap-1">
                                      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden"><div className={cn('h-full transition-all', pct > 100 ? 'bg-red-500' : 'bg-blue-500')} style={{ width: `${Math.min(pct, 100)}%` }} /></div>
                                      <span className={cn('text-[8px] font-mono', pct > 100 ? 'text-red-500' : 'text-gray-400')}>{pct.toFixed(1)}%</span>
                                    </div>
                                  </td>
                                  <td className="p-2 font-mono font-bold text-blue-400">{formatNumber(ipcLineToDateAmount(item))}</td>
                                </tr>
                              );
                            })}
                            <tr className="bg-blue-900/10 font-bold border-t border-gray-800">
                              <td colSpan={10} className="p-3 text-left text-gray-400">{language === 'ar' ? 'إجمالي الفصل:' : 'Chapter Total:'} {chapterName}</td>
                              <td className="p-3 text-blue-400 font-mono">{formatNumber(chapterTotal)}</td>
                            </tr>
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                ) : null}
              </div>

              </div>

              {/* Actions — fixed strip at bottom of modal */}
              <div
                className={cn(
                  'shrink-0 p-4 border-t flex flex-wrap gap-3',
                  theme === 'dark' ? 'bg-[#151619] border-gray-800' : 'bg-white border-gray-200',
                )}
              >
                {editingIPC && (onPrintCoverPreview || onPrintPreview) && (
                  <>
                    {onPrintCoverPreview && (
                      <button
                        type="button"
                        onClick={handlePrintCover}
                        className="px-5 bg-indigo-600 hover:bg-indigo-500 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 text-white"
                      >
                        <Printer size={18} />
                        {t('ipc_print_cover_only')}
                      </button>
                    )}
                    {onPrintPreview && (
                      <button
                        type="button"
                        onClick={handlePrintIPC}
                        className="px-5 bg-green-600 hover:bg-green-500 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 text-white"
                      >
                        <Printer size={18} />
                        {t('ipc_print_full')}
                      </button>
                    )}
                  </>
                )}
                <button type="button" onClick={() => handleSubmitClick('draft')} disabled={isSubmitting} className={cn('flex-1 min-w-[8rem] py-3 rounded-xl font-bold transition-all border', theme === 'dark' ? 'bg-gray-800 hover:bg-gray-700 text-white border-gray-700' : 'bg-white hover:bg-gray-50 text-gray-700 border-gray-200')}>
                  {isSubmitting ? '...' : (language === 'ar' ? 'حفظ كمسودة' : 'Save as Draft')}
                </button>
                <button type="button" onClick={() => handleSubmitClick('submitted')} disabled={isSubmitting} className="flex-1 min-w-[8rem] bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 text-white">
                  {isSubmitting ? (language === 'ar' ? 'جاري الحفظ...' : 'Saving...') : (language === 'ar' ? 'اعتماد وحفظ المستخلص' : 'Approve & Save IPC')}
                </button>
                <button type="button" onClick={onClose} className={cn('flex-1 min-w-[8rem] py-3 rounded-xl font-bold transition-all', theme === 'dark' ? 'bg-gray-800 hover:bg-gray-700 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700')}>
                  {language === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
