import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Download, Calculator, X, Loader2, Printer } from 'lucide-react';
import { cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
// @ts-ignore
import html2pdf from 'html2pdf.js';

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
  advancePaymentRecovery: number;
  netPayable: number;
  status: string;
  transactionId?: string;
}

interface Contract { id: string; contractName: string; contractNumber: string; projectId: string }

interface FormData {
  billingNumber: string;
  date: string;
  items: BillingItem[];
  vatPct: number;
  execGuaranteePct: number;
  whtPct: number;
  labourInsurancePct: number;
  manpowerLevyPct: number;
  advancePaymentRecovery: number;
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
}

export function IPCFormModal({
  isOpen, editingIPC, formData, setFormData, isSubmitting,
  contracts, selectedContractId, onClose, onSubmit,
  onItemQtyChange, onItemRateChange, theme, language, dir
}: Props) {
  const { formState: { errors }, trigger, setValue, reset } = useForm({
    resolver: zodResolver(ipcSchema),
    defaultValues: { billingNumber: formData.billingNumber, date: formData.date },
  });

  useEffect(() => {
    if (isOpen) reset({ billingNumber: formData.billingNumber, date: formData.date });
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmitClick = async (status: 'draft' | 'submitted') => {
    const valid = await trigger(['billingNumber', 'date']);
    if (!valid) return;
    onSubmit(status);
  };

  const worksValueExVat = formData.items.reduce((s, i) => s + i.amount, 0);

  const calculateDeductions = () => {
    const vat = worksValueExVat * (formData.vatPct / 100);
    const exec = worksValueExVat * (formData.execGuaranteePct / 100);
    const wht = worksValueExVat * (formData.whtPct / 100);
    const insurance = worksValueExVat * (formData.labourInsurancePct / 100);
    const levy = worksValueExVat * (formData.manpowerLevyPct / 100);
    const advance = formData.advancePaymentRecovery;
    return { vat, exec, wht, insurance, levy, advance, net: worksValueExVat + vat - exec - wht - insurance - levy - advance };
  };

  const handleExportExcel = () => {
    const isAr = language === 'ar';
    const aoa: any[][] = [[isAr ? 'الفصل' : 'Chapter', isAr ? 'القسم' : 'Section', isAr ? 'كود البند' : 'Item Code', isAr ? 'البيان' : 'Description', isAr ? 'الوحدة' : 'Unit', isAr ? 'الكمية التعاقدية' : 'Tender Qty', isAr ? 'الفئة' : 'Rate', isAr ? 'الكمية السابقة' : 'Prev Qty', isAr ? 'الكمية الحالية' : 'Curr Qty', isAr ? 'إجمالي الكمية' : 'Total Qty', isAr ? 'نسبة التنفيذ' : 'Comp %', isAr ? 'القيمة' : 'Amount']];
    const { vat, exec, wht, insurance, levy, advance, net } = calculateDeductions();

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

    aoa.push([], [isAr ? 'الملخص المالي' : 'Financial Summary'], [isAr ? 'قيمة الأعمال (بدون ضريبة):' : 'Work Value (Excl. VAT):', '', '', '', '', '', '', '', '', '', '', worksValueExVat], [isAr ? 'ضريبة القيمة المضافة (+):' : 'VAT Amount (+):', '', '', '', '', '', '', '', '', '', '', vat]);
    aoa.push([isAr ? 'صافي المستحق الصرف:' : 'Net Payable:', '', '', '', '', '', '', '', '', '', '', net]);

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
            updated[idx] = { ...item, currentQty: currQty, totalQty, amount: totalQty * item.rate };
          }
        }
      });
      setFormData({ ...formData, items: updated });
    };
    reader.readAsBinaryString(file);
  };

  const handlePrintIPC = () => {
    if (!editingIPC) return;
    const isAr = language === 'ar';
    const el = document.createElement('div');
    el.dir = isAr ? 'rtl' : 'ltr';
    el.style.padding = '20px';
    el.style.fontFamily = 'Arial, sans-serif';
    el.style.color = '#000000';
    el.innerHTML = `<div style="text-align:center;margin-bottom:30px;"><h1 style="font-size:24px;color:#1e3a8a;">${isAr ? 'مستخلص جاري' : 'Interim Payment Certificate (IPC)'}</h1></div><p><strong>${isAr ? 'رقم المستخلص:' : 'IPC Number:'}</strong> ${editingIPC.billingNumber}</p><p><strong>${isAr ? 'صافي المستحق الصرف:' : 'Net Payable:'}</strong> ${editingIPC.netPayable.toLocaleString()} EGP</p>`;
    html2pdf().set({ margin: 10, filename: `IPC_${editingIPC.billingNumber}.pdf`, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' } }).from(el).save();
  };

  const { vat, exec, wht, insurance, levy, advance, net } = calculateDeductions();

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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className={cn('border rounded-2xl w-full max-w-6xl overflow-hidden shadow-2xl', theme === 'dark' ? 'bg-[#151619] border-gray-800' : 'bg-white border-gray-200')}
          >
            <div className={cn('p-6 border-b flex justify-between items-center', theme === 'dark' ? 'bg-gray-900/50 border-gray-800' : 'bg-gray-50 border-gray-200')}>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-600 rounded-lg text-white"><Calculator size={20} /></div>
                <div>
                  <h3 className="text-xl font-bold">{editingIPC ? (language === 'ar' ? 'تعديل مستخلص الأعمال' : 'Edit IPC') : (language === 'ar' ? 'إنشاء مستخلص أعمال جديد' : 'Create New IPC')}</h3>
                  <p className="text-[10px] text-gray-500">{contracts.find(c => c.id === selectedContractId)?.contractName}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={handleExportExcel} className="text-xs bg-green-600 hover:bg-green-500 text-white px-3 py-1.5 rounded-lg flex items-center gap-2 transition-all"><Download size={14} />{language === 'ar' ? 'تصدير إكسل' : 'Export Excel'}</button>
                <label className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg flex items-center gap-2 transition-all cursor-pointer"><Plus size={14} />{language === 'ar' ? 'استيراد إكسل' : 'Import Excel'}<input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportExcel} /></label>
                <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors"><X size={20} /></button>
              </div>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); handleSubmitClick('submitted'); }} className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
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

              {/* Items table */}
              <div className="space-y-4">
                <h4 className="text-sm font-bold text-blue-400 uppercase tracking-wider">{language === 'ar' ? 'بنود الأعمال' : 'Work Items'}</h4>
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
                      {Object.entries(chapters).map(([chapterName, items]) => {
                        const chapterTotal = items.reduce((s, i) => s + i.amount, 0);
                        return (
                          <React.Fragment key={chapterName}>
                            {items.map((item) => {
                              const idx = formData.items.findIndex(fi => fi.boqItemId === item.boqItemId);
                              const pct = item.tenderQty ? (item.totalQty / item.tenderQty) * 100 : 0;
                              return (
                                <tr key={item.boqItemId}>
                                  <td className="p-2"><div className="font-bold">{item.chapterName}</div><div className="text-[8px] opacity-50">{item.chapterCode}</div></td>
                                  <td className="p-2"><div>{item.sectionName}</div><div className="text-[8px] opacity-50">{item.sectionCode}</div></td>
                                  <td className="p-2"><div className="max-w-[150px] truncate font-medium">{item.description}</div><div className="text-[8px] text-blue-400">{item.itemCode}</div></td>
                                  <td className="p-2 text-center text-gray-400">{item.unit}</td>
                                  <td className="p-2 font-mono text-gray-400">{item.tenderQty?.toLocaleString()}</td>
                                  <td className="p-2">
                                    <input type="number" step="0.01" inputMode="decimal" className={cn('w-24 border rounded py-1.5 px-2 text-center outline-none focus:border-blue-500 transition-colors font-mono', theme === 'dark' ? 'bg-gray-900 border-gray-800 text-green-400' : 'bg-white border-gray-300 text-green-700')} value={item.rate ? parseFloat(item.rate.toFixed(2)) : ''} onChange={(e) => onItemRateChange(idx, Number(e.target.value))} />
                                  </td>
                                  <td className="p-2 font-mono text-gray-500">{item.previousQty}</td>
                                  <td className="p-2">
                                    <input type="number" step="0.01" inputMode="decimal" className={cn('w-24 border rounded py-1.5 px-2 text-center outline-none focus:border-blue-500 transition-colors font-mono', theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-300 text-gray-900')} value={item.currentQty || ''} onChange={(e) => onItemQtyChange(idx, Number(e.target.value))} />
                                  </td>
                                  <td className="p-2 font-mono">{item.totalQty}</td>
                                  <td className="p-2">
                                    <div className="flex items-center gap-1">
                                      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden"><div className={cn('h-full transition-all', pct > 100 ? 'bg-red-500' : 'bg-blue-500')} style={{ width: `${Math.min(pct, 100)}%` }} /></div>
                                      <span className={cn('text-[8px] font-mono', pct > 100 ? 'text-red-500' : 'text-gray-400')}>{pct.toFixed(1)}%</span>
                                    </div>
                                  </td>
                                  <td className="p-2 font-mono font-bold text-blue-400">{item.amount.toLocaleString()}</td>
                                </tr>
                              );
                            })}
                            <tr className="bg-blue-900/10 font-bold border-t border-gray-800">
                              <td colSpan={10} className="p-3 text-left text-gray-400">{language === 'ar' ? 'إجمالي الفصل:' : 'Chapter Total:'} {chapterName}</td>
                              <td className="p-3 text-blue-400 font-mono">{chapterTotal.toLocaleString()}</td>
                            </tr>
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Percentages */}
              <div className={cn('grid grid-cols-3 md:grid-cols-6 gap-4 p-4 rounded-xl border', theme === 'dark' ? 'bg-gray-900/30 border-gray-800/50' : 'bg-gray-50 border-gray-200')}>
                {[
                  { label: 'VAT %', field: 'vatPct', value: formData.vatPct },
                  { label: language === 'ar' ? 'ضمان أعمال %' : 'Guarantee %', field: 'execGuaranteePct', value: formData.execGuaranteePct },
                  { label: language === 'ar' ? 'خصم وإضافة %' : 'WHT %', field: 'whtPct', value: formData.whtPct },
                  { label: language === 'ar' ? 'تأمينات %' : 'Insurance %', field: 'labourInsurancePct', value: formData.labourInsurancePct },
                  { label: language === 'ar' ? 'قوى عاملة %' : 'Manpower %', field: 'manpowerLevyPct', value: formData.manpowerLevyPct },
                  { label: language === 'ar' ? 'استرداد دفعة مقدمة' : 'Advance Recovery', field: 'advancePaymentRecovery', value: formData.advancePaymentRecovery },
                ].map(({ label, field, value }) => (
                  <div key={field} className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase">{label}</label>
                    <input type="number" className={inputCls} value={value || ''} onChange={(e) => setFormData({ ...formData, [field]: Number(e.target.value) })} />
                  </div>
                ))}
              </div>

              {/* Summary */}
              <div className={cn('rounded-xl p-6 space-y-3 border', theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-gray-50 border-gray-200')}>
                <div className="flex justify-between text-sm"><span className="text-gray-500">{language === 'ar' ? 'قيمة الأعمال:' : 'Work Value:'}</span><span className="font-bold">{worksValueExVat.toLocaleString()} {language === 'ar' ? 'ج.م' : 'EGP'}</span></div>
                <div className="flex justify-between text-sm"><span className="text-gray-500">{language === 'ar' ? 'ضريبة القيمة المضافة (+):' : 'VAT (+):'}</span><span className="font-bold text-blue-400">{vat.toLocaleString()} {language === 'ar' ? 'ج.م' : 'EGP'}</span></div>
                <div className="flex justify-between text-sm"><span className="text-gray-500">{language === 'ar' ? 'إجمالي الاستقطاعات (-):' : 'Total Deductions (-):'}</span><span className="font-bold text-red-400">{(exec + wht + insurance + levy + advance).toLocaleString()} {language === 'ar' ? 'ج.م' : 'EGP'}</span></div>
                <div className={cn('pt-3 border-t flex justify-between items-center', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
                  <span className="text-lg font-bold">{language === 'ar' ? 'صافي المستحق للتحصيل:' : 'Net Payable:'}</span>
                  <span className="text-2xl font-black text-green-500">{net.toLocaleString()} {language === 'ar' ? 'ج.م' : 'EGP'}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="pt-4 flex gap-3">
                {editingIPC && (
                  <button type="button" onClick={handlePrintIPC} className="px-6 bg-green-600 hover:bg-green-500 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 text-white"><Printer size={18} />{language === 'ar' ? 'طباعة' : 'Print'}</button>
                )}
                <button type="button" onClick={() => handleSubmitClick('draft')} disabled={isSubmitting} className={cn('flex-1 py-3 rounded-xl font-bold transition-all border', theme === 'dark' ? 'bg-gray-800 hover:bg-gray-700 text-white border-gray-700' : 'bg-white hover:bg-gray-50 text-gray-700 border-gray-200')}>
                  {isSubmitting ? '...' : (language === 'ar' ? 'حفظ كمسودة' : 'Save as Draft')}
                </button>
                <button type="button" onClick={() => handleSubmitClick('submitted')} disabled={isSubmitting} className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 text-white">
                  {isSubmitting ? (language === 'ar' ? 'جاري الحفظ...' : 'Saving...') : (language === 'ar' ? 'اعتماد وحفظ المستخلص' : 'Approve & Save IPC')}
                </button>
                <button type="button" onClick={onClose} className={cn('flex-1 py-3 rounded-xl font-bold transition-all', theme === 'dark' ? 'bg-gray-800 hover:bg-gray-700 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700')}>
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
