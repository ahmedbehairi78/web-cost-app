import React, { useState, useEffect, useMemo } from 'react';
import { X, Loader2, Calculator, Plus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

interface ExistingItem {
  chapterCode: string;
  chapterName: string;
  workTypeCode: string;
  sectionCode: string;
  sectionName: string;
  itemCode: string;
}

interface FormData {
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
  startDate: string;
  expectedDuration: number;
}

interface Props {
  isOpen: boolean;
  editingItem: { id: string; itemCode: string; description: string } | null;
  formData: FormData;
  setFormData: (d: FormData) => void;
  isSubmitting: boolean;
  onSubmit: (e: React.FormEvent, resolved: FormData) => void;
  onClose: () => void;
  theme: string;
  language: string;
  existingItems?: ExistingItem[];
}

const NEW_OPTION = '__new__';

export function BOQItemFormModal({
  isOpen, editingItem, formData, setFormData, isSubmitting,
  onSubmit, onClose, theme, language, existingItems = [],
}: Props) {
  const isAr = language === 'ar';

  const [newChapterCode, setNewChapterCode] = useState('');
  const [newChapterName, setNewChapterName] = useState('');
  const [newWorkTypeCode, setNewWorkTypeCode] = useState('');
  const [newSectionCode, setNewSectionCode] = useState('');
  const [newSectionName, setNewSectionName] = useState('');
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});

  useEffect(() => {
    if (isOpen) {
      setNewChapterCode('');
      setNewChapterName('');
      setNewWorkTypeCode('');
      setNewSectionCode('');
      setNewSectionName('');
      setErrors({});
    }
  }, [isOpen]);

  const isNewChapter = formData.chapterCode === NEW_OPTION;
  const isNewWorkType = formData.workTypeCode === NEW_OPTION;
  const isNewSection = formData.sectionCode === NEW_OPTION;

  // ── Derived unique values from existing items ────────────────────────────

  const uniqueChapters = useMemo(() => {
    const map = new Map<string, string>();
    existingItems.forEach(i => { if (i.chapterCode) map.set(i.chapterCode, i.chapterName || i.chapterCode); });
    return Array.from(map.entries()).map(([code, name]) => ({ code, name })).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  }, [existingItems]);

  const uniqueWorkTypes = useMemo(() => {
    const chCode = isNewChapter ? newChapterCode : formData.chapterCode;
    if (!chCode) return [];
    const set = new Set<string>();
    existingItems.filter(i => i.chapterCode === chCode).forEach(i => { if (i.workTypeCode) set.add(i.workTypeCode); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [existingItems, formData.chapterCode, isNewChapter, newChapterCode]);

  const uniqueSections = useMemo(() => {
    const chCode = isNewChapter ? newChapterCode : formData.chapterCode;
    const wtCode = isNewWorkType ? newWorkTypeCode : formData.workTypeCode;
    if (!chCode || !wtCode) return [];
    const map = new Map<string, string>();
    existingItems
      .filter(i => i.chapterCode === chCode && i.workTypeCode === wtCode)
      .forEach(i => { if (i.sectionCode) map.set(i.sectionCode, i.sectionName || i.sectionCode); });
    return Array.from(map.entries()).map(([code, name]) => ({ code, name })).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  }, [existingItems, formData.chapterCode, formData.workTypeCode, isNewChapter, isNewWorkType, newChapterCode, newWorkTypeCode]);

  // ── Auto-generate item code ──────────────────────────────────────────────

  const suggestedItemCode = useMemo(() => {
    const chCode = isNewChapter ? newChapterCode : formData.chapterCode;
    const wtCode = isNewWorkType ? newWorkTypeCode : formData.workTypeCode;
    const scCode = isNewSection ? newSectionCode : formData.sectionCode;
    if (!chCode) return '';
    const peers = existingItems.filter(i =>
      i.chapterCode === chCode &&
      (!wtCode || i.workTypeCode === wtCode) &&
      (!scCode || i.sectionCode === scCode)
    );
    if (peers.length === 0) return `${chCode}.1`;
    const maxN = Math.max(0, ...peers.map(i => {
      const n = parseInt(i.itemCode.split('.').pop() || '0', 10);
      return isNaN(n) ? 0 : n;
    }));
    const base = peers[0].itemCode.split('.');
    base[base.length - 1] = String(maxN + 1);
    return base.join('.');
  }, [existingItems, formData.chapterCode, formData.workTypeCode, formData.sectionCode, isNewChapter, isNewWorkType, isNewSection, newChapterCode, newWorkTypeCode, newSectionCode]);

  useEffect(() => {
    if (!editingItem && suggestedItemCode && !formData.itemCode) {
      setFormData({ ...formData, itemCode: suggestedItemCode });
    }
  }, [suggestedItemCode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Helpers ──────────────────────────────────────────────────────────────

  const set = (key: keyof FormData, value: string | number) => {
    setErrors(prev => ({ ...prev, [key]: undefined }));
    setFormData({ ...formData, [key]: value });
  };

  const handleChapterChange = (code: string) => {
    const name = uniqueChapters.find(c => c.code === code)?.name || '';
    setFormData({ ...formData, chapterCode: code, chapterName: code === NEW_OPTION ? '' : name, workTypeCode: '', sectionCode: '', sectionName: '', itemCode: '' });
    setNewChapterCode('');
    setNewChapterName('');
    setNewWorkTypeCode('');
    setNewSectionCode('');
    setNewSectionName('');
    setErrors({});
  };

  const handleWorkTypeChange = (code: string) => {
    setFormData({ ...formData, workTypeCode: code, sectionCode: '', sectionName: '', itemCode: '' });
    setNewWorkTypeCode('');
    setNewSectionCode('');
    setNewSectionName('');
  };

  const handleSectionChange = (code: string) => {
    const name = uniqueSections.find(s => s.code === code)?.name || '';
    setFormData({ ...formData, sectionCode: code, sectionName: code === NEW_OPTION ? '' : name, itemCode: '' });
    setNewSectionCode('');
    setNewSectionName('');
  };

  const validate = () => {
    const errs: typeof errors = {};
    const effectiveChapter = isNewChapter ? newChapterCode : formData.chapterCode;
    const effectiveWorkType = isNewWorkType ? newWorkTypeCode : formData.workTypeCode;
    const effectiveSection = isNewSection ? newSectionCode : formData.sectionCode;
    if (!effectiveChapter) errs.chapterCode = isAr ? 'مطلوب' : 'Required';
    if (!effectiveWorkType) errs.workTypeCode = isAr ? 'مطلوب' : 'Required';
    if (!effectiveSection) errs.sectionCode = isAr ? 'مطلوب' : 'Required';
    if (!formData.itemCode) errs.itemCode = isAr ? 'مطلوب' : 'Required';
    if (!formData.description) errs.description = isAr ? 'مطلوب' : 'Required';
    if (!formData.unit) errs.unit = isAr ? 'مطلوب' : 'Required';
    if (!formData.tenderQty || formData.tenderQty <= 0) errs.tenderQty = isAr ? 'يجب أن تكون أكبر من 0' : 'Must be > 0';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    const resolved: FormData = {
      ...formData,
      chapterCode: isNewChapter ? newChapterCode : formData.chapterCode,
      chapterName: isNewChapter ? newChapterName : formData.chapterName,
      workTypeCode: isNewWorkType ? newWorkTypeCode : formData.workTypeCode,
      sectionCode: isNewSection ? newSectionCode : formData.sectionCode,
      sectionName: isNewSection ? newSectionName : formData.sectionName,
    };
    setFormData(resolved);
    onSubmit(e, resolved);
  };

  // ── Calculation ──────────────────────────────────────────────────────────

  const direct = formData.rateMaterials + formData.rateLabour + formData.rateEquipment;
  const overheadAmt = direct * (formData.rateOverheadPct / 100);
  const subtotal = direct + overheadAmt;
  const profitAmt = subtotal * (formData.rateProfitPct / 100);
  const unitRate = subtotal + profitAmt;
  const tenderAmount = unitRate * formData.tenderQty;

  // ── Shared styles ────────────────────────────────────────────────────────

  const inputCls = cn(
    'w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500 transition-colors',
    theme === 'dark' ? 'bg-gray-900 border-gray-800' : theme === 'soft' ? 'bg-white border-[#cfd8dc]' : 'bg-white border-gray-200 shadow-sm'
  );
  const errCls = cn(inputCls, 'border-red-500');
  const labelCls = 'text-[10px] font-bold text-gray-400 uppercase block mb-1';
  const selectCls = cn(inputCls, 'appearance-none');

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className={cn('border rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl', theme === 'dark' ? 'bg-[#151619] border-gray-800' : theme === 'soft' ? 'bg-white border-[#cfd8dc]' : 'bg-white border-gray-200')}
          >
            <div className={cn('p-6 border-b flex justify-between items-center', theme === 'dark' ? 'bg-gray-900/50 border-gray-800' : theme === 'soft' ? 'bg-[#eceff1] border-[#cfd8dc]' : 'bg-gray-50 border-gray-200')}>
              <h3 className="text-xl font-bold">{editingItem ? (isAr ? 'تعديل البند' : 'Edit Item') : (isAr ? 'إضافة بند جديد' : 'Add New Item')}</h3>
              <button type="button" onClick={onClose} className={cn('transition-colors', theme === 'dark' ? 'text-gray-500 hover:text-white' : 'text-gray-400 hover:text-gray-900')}><X size={20} /></button>
            </div>

            <form onSubmit={handleFormSubmit} className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">

              {/* ── Chapter ── */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className={labelCls}>{isAr ? 'كود الفصل' : 'Chapter Code'}</label>
                  <select
                    title={isAr ? 'كود الفصل' : 'Chapter Code'}
                    className={cn(errors.chapterCode ? errCls : selectCls)}
                    value={formData.chapterCode}
                    onChange={e => handleChapterChange(e.target.value)}
                  >
                    <option value="">{isAr ? '-- اختر فصلاً --' : '-- Select Chapter --'}</option>
                    {uniqueChapters.map(c => (
                      <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                    ))}
                    <option value={NEW_OPTION}>➕ {isAr ? 'فصل جديد' : 'New Chapter'}</option>
                  </select>
                  {errors.chapterCode && <p className="text-[10px] text-red-500">{errors.chapterCode}</p>}
                </div>
                <div className="space-y-1">
                  <label className={labelCls}>{isAr ? 'اسم الفصل' : 'Chapter Name'}</label>
                  {isNewChapter ? (
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        placeholder={isAr ? 'كود' : 'Code'}
                        className={inputCls}
                        value={newChapterCode}
                        onChange={e => setNewChapterCode(e.target.value)}
                      />
                      <input
                        placeholder={isAr ? 'الاسم' : 'Name'}
                        className={inputCls}
                        value={newChapterName}
                        onChange={e => setNewChapterName(e.target.value)}
                      />
                    </div>
                  ) : (
                    <input
                      className={inputCls}
                      value={formData.chapterName}
                      onChange={e => set('chapterName', e.target.value)}
                      placeholder={isAr ? 'يتعبأ تلقائياً' : 'Auto-filled'}
                    />
                  )}
                </div>
              </div>

              {/* ── Work Type ── */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className={labelCls}>{isAr ? 'كود نوع العمل' : 'Work Type Code'}</label>
                  <select
                    title={isAr ? 'كود نوع العمل' : 'Work Type Code'}
                    className={cn(errors.workTypeCode ? errCls : selectCls)}
                    value={formData.workTypeCode}
                    onChange={e => handleWorkTypeChange(e.target.value)}
                    disabled={!formData.chapterCode && !isNewChapter}
                  >
                    <option value="">{isAr ? '-- اختر نوع العمل --' : '-- Select Work Type --'}</option>
                    {uniqueWorkTypes.map(wt => (
                      <option key={wt} value={wt}>{wt}</option>
                    ))}
                    <option value={NEW_OPTION}>➕ {isAr ? 'نوع عمل جديد' : 'New Work Type'}</option>
                  </select>
                  {errors.workTypeCode && <p className="text-[10px] text-red-500">{errors.workTypeCode}</p>}
                </div>
                {isNewWorkType && (
                  <div className="space-y-1">
                    <label className={labelCls}>{isAr ? 'كود نوع العمل الجديد' : 'New Work Type Code'}</label>
                    <input
                      placeholder={isAr ? 'مثال: 02' : 'e.g. 02'}
                      className={inputCls}
                      value={newWorkTypeCode}
                      onChange={e => setNewWorkTypeCode(e.target.value)}
                    />
                  </div>
                )}
              </div>

              {/* ── Section ── */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className={labelCls}>{isAr ? 'كود القسم' : 'Section Code'}</label>
                  <select
                    title={isAr ? 'كود القسم' : 'Section Code'}
                    className={cn(errors.sectionCode ? errCls : selectCls)}
                    value={formData.sectionCode}
                    onChange={e => handleSectionChange(e.target.value)}
                    disabled={!formData.workTypeCode && !isNewWorkType}
                  >
                    <option value="">{isAr ? '-- اختر قسماً --' : '-- Select Section --'}</option>
                    {uniqueSections.map(s => (
                      <option key={s.code} value={s.code}>{s.code} — {s.name}</option>
                    ))}
                    <option value={NEW_OPTION}>➕ {isAr ? 'قسم جديد' : 'New Section'}</option>
                  </select>
                  {errors.sectionCode && <p className="text-[10px] text-red-500">{errors.sectionCode}</p>}
                </div>
                <div className="space-y-1">
                  <label className={labelCls}>{isAr ? 'اسم القسم' : 'Section Name'}</label>
                  {isNewSection ? (
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        placeholder={isAr ? 'كود' : 'Code'}
                        className={inputCls}
                        value={newSectionCode}
                        onChange={e => setNewSectionCode(e.target.value)}
                      />
                      <input
                        placeholder={isAr ? 'الاسم' : 'Name'}
                        className={inputCls}
                        value={newSectionName}
                        onChange={e => setNewSectionName(e.target.value)}
                      />
                    </div>
                  ) : (
                    <input
                      className={inputCls}
                      value={formData.sectionName}
                      onChange={e => set('sectionName', e.target.value)}
                      placeholder={isAr ? 'يتعبأ تلقائياً' : 'Auto-filled'}
                    />
                  )}
                </div>
              </div>

              {/* ── Item code + description ── */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className={labelCls}>
                        {isAr ? 'كود البند' : 'Item Code'}<span className="text-red-500 ml-1">*</span>
                      </label>
                      <div className="flex gap-1 items-center">
                        <input
                          className={cn(errors.itemCode ? errCls : inputCls, 'font-mono flex-1')}
                          value={formData.itemCode}
                          onChange={e => set('itemCode', e.target.value)}
                          placeholder={suggestedItemCode || (isAr ? 'كود البند' : 'Code')}
                        />
                        {suggestedItemCode && !formData.itemCode && (
                          <button
                            type="button"
                            title={isAr ? 'استخدام الكود التلقائي' : 'Use auto code'}
                            onClick={() => set('itemCode', suggestedItemCode)}
                            className="p-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors shrink-0"
                          >
                            <Plus size={14} />
                          </button>
                        )}
                      </div>
                      {errors.itemCode && <p className="text-[10px] text-red-500">{errors.itemCode}</p>}
                    </div>
                    <div className="space-y-1">
                      <label className={labelCls}>
                        {isAr ? 'الوحدة' : 'Unit'}<span className="text-red-500 ml-1">*</span>
                      </label>
                      <input
                        className={errors.unit ? errCls : inputCls}
                        value={formData.unit}
                        onChange={e => set('unit', e.target.value)}
                        list="unit-suggestions"
                        placeholder={isAr ? 'م3، م2، طن...' : 'm³, m², ton...'}
                      />
                      <datalist id="unit-suggestions">
                        {['م3', 'م2', 'م ط', 'طن', 'عدد', 'كجم', 'لتر', 'م'].map(u => <option key={u} value={u} />)}
                      </datalist>
                      {errors.unit && <p className="text-[10px] text-red-500">{errors.unit}</p>}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className={labelCls}>
                      {isAr ? 'وصف البند' : 'Item Description'}<span className="text-red-500 ml-1">*</span>
                    </label>
                    <textarea
                      rows={3}
                      title={isAr ? 'وصف البند' : 'Item Description'}
                      placeholder={isAr ? 'أدخل وصف البند...' : 'Enter item description...'}
                      className={cn(errors.description ? errCls : inputCls, 'resize-none')}
                      value={formData.description}
                      onChange={e => set('description', e.target.value)}
                    />
                    {errors.description && <p className="text-[10px] text-red-500">{errors.description}</p>}
                  </div>
                </div>

                {/* Calculation summary */}
                <div className={cn('p-4 rounded-xl border space-y-3 h-fit', theme === 'dark' ? 'bg-gray-900/30 border-gray-800/50' : theme === 'soft' ? 'bg-[#eceff1] border-[#cfd8dc]' : 'bg-gray-50 border-gray-100 shadow-sm')}>
                  <div className="flex justify-between items-center border-b border-gray-800 pb-2 mb-1">
                    <span className="text-xs font-bold text-gray-500 uppercase">{isAr ? 'ملخص الحساب' : 'Calculation'}</span>
                    <Calculator size={16} className="text-purple-400" />
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between"><span className="text-gray-400">{isAr ? 'تكلفة مباشرة' : 'Direct Cost'}</span><span className="font-mono">{direct.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">{isAr ? 'مصاريف' : 'Overhead'} ({formData.rateOverheadPct}%)</span><span className="font-mono">{overheadAmt.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">{isAr ? 'ربح' : 'Profit'} ({formData.rateProfitPct}%)</span><span className="font-mono text-purple-400">{profitAmt.toLocaleString()}</span></div>
                    <div className="pt-2 border-t border-gray-800 flex justify-between items-center"><span className="font-bold text-blue-400">{isAr ? 'سعر الوحدة' : 'Unit Rate'}</span><span className="font-mono font-black text-blue-400">{unitRate.toLocaleString()}</span></div>
                    <div className="flex justify-between items-center"><span className="font-bold text-green-400">{isAr ? 'إجمالي البند' : 'Item Total'}</span><span className="font-mono font-black text-green-400">{tenderAmount.toLocaleString()}</span></div>
                  </div>
                </div>
              </div>

              {/* ── Rates ── */}
              <div className="grid grid-cols-3 gap-4">
                {([
                  ['rateMaterials', isAr ? 'المواد' : 'Materials'],
                  ['rateLabour', isAr ? 'العمالة' : 'Labour'],
                  ['rateEquipment', isAr ? 'المعدات' : 'Equipment'],
                ] as [keyof FormData, string][]).map(([key, label]) => (
                  <div key={key} className="space-y-1">
                    <label className={labelCls}>{label}</label>
                    <input type="number" step="0.01" title={label} placeholder="0" className={cn(inputCls, 'font-mono')} value={(formData[key] as number) || ''} onChange={e => set(key, Number(e.target.value))} />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className={labelCls}>{isAr ? 'الكمية' : 'Quantity'}<span className="text-red-500 ml-1">*</span></label>
                  <input type="number" step="0.001" title={isAr ? 'الكمية' : 'Quantity'} placeholder="0" className={cn(errors.tenderQty ? errCls : cn(inputCls, 'font-mono'))} value={formData.tenderQty || ''} onChange={e => set('tenderQty', Number(e.target.value))} />
                  {errors.tenderQty && <p className="text-[10px] text-red-500">{errors.tenderQty}</p>}
                </div>
                <div className="space-y-1">
                  <label className={labelCls}>{isAr ? 'المصاريف %' : 'Overhead %'}</label>
                  <input type="number" step="0.1" title={isAr ? 'المصاريف %' : 'Overhead %'} placeholder="0" className={cn(inputCls, 'font-mono')} value={formData.rateOverheadPct || ''} onChange={e => set('rateOverheadPct', Number(e.target.value))} />
                </div>
                <div className="space-y-1">
                  <label className={labelCls}>{isAr ? 'الربح %' : 'Profit %'}</label>
                  <input type="number" step="0.1" title={isAr ? 'الربح %' : 'Profit %'} placeholder="0" className={cn(inputCls, 'font-mono')} value={formData.rateProfitPct || ''} onChange={e => set('rateProfitPct', Number(e.target.value))} />
                </div>
              </div>

              {/* ── Date + Duration ── */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className={labelCls}>{isAr ? 'تاريخ بدء العمل' : 'Start Date'}</label>
                  <input type="date" title={isAr ? 'تاريخ بدء العمل' : 'Start Date'} className={inputCls} value={formData.startDate} onChange={e => set('startDate', e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className={labelCls}>{isAr ? 'مدة التنفيذ (يوم)' : 'Duration (Days)'}</label>
                  <input type="number" title={isAr ? 'مدة التنفيذ بالأيام' : 'Duration in Days'} placeholder="0" className={cn(inputCls, 'font-mono')} value={formData.expectedDuration || ''} onChange={e => set('expectedDuration', Number(e.target.value))} />
                </div>
              </div>

              {/* ── Actions ── */}
              <div className="pt-4 flex gap-3">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 text-white"
                >
                  {isSubmitting && <Loader2 className="animate-spin" size={18} />}
                  {editingItem ? (isAr ? 'تحديث البند' : 'Update Item') : (isAr ? 'حفظ البند' : 'Save Item')}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className={cn('flex-1 py-3 rounded-xl font-bold transition-all', theme === 'dark' ? 'bg-gray-800 hover:bg-gray-700 text-white' : theme === 'soft' ? 'bg-[#cfd8dc] hover:bg-[#b0bec5] text-[#37474f]' : 'bg-gray-200 hover:bg-gray-300 text-gray-700')}
                >
                  {isAr ? 'إلغاء' : 'Cancel'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
