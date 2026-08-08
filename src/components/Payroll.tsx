import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { Users, Plus, Upload, Download, Printer, RefreshCw, X, Check, Edit2, Trash2, FileText, ChevronLeft, Wallet, ClipboardCheck, Settings2, Clock, Briefcase, CalendarX, RotateCcw, Info, AlertTriangle, Search } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useApiQuery } from '../hooks/useApiQuery';
import { useChartOfAccountsRef } from '../hooks/useChartOfAccountsRef';
import { useErpModuleView } from '../hooks/useErpModuleView';
import {
  payrollApi,
  attendanceApi,
  banksApi,
  costCentersApi,
  leaveTypesApi,
  officialHolidaysApi,
  leaveBalancesApi,
  settingsApi,
  type PayrollEmployee,
  type PayrollRun,
  type PayrollRunLine,
  type PayrollLineInput,
  type CostCenterRow,
  type AttendanceRule,
  type AttendancePreviewRow,
  type LeaveType,
  type OfficialHoliday,
  type EmployeeLeaveBalance,
  type JournalPreviewResponse,
} from '../services/local/modulesApi';
import { NetworkQueuedError } from '../services/local/modulesApi';
import { useFormDraftAutosave } from '../hooks/useFormDraftAutosave';
import { useOfflineUserId } from '../hooks/useOfflineUserId';
import { FormDraftRestoreBanner } from './offline/FormDraftRestoreBanner';
import { FORM_DRAFT_KEYS } from '../lib/offline/formDraftKeys';
import { JournalPreviewModal } from './gl/JournalPreviewModal';
import { useReportDocumentPreview } from '../hooks/useReportDocumentPreview';
import type { CompanyPrintInfo } from '../lib/ipcPrintData';
import {
  downloadEmployeesTemplate,
  parseEmployeesFile,
  parseAttendanceFile,
  downloadAttendanceTemplate,
  exportPayrollRegister,
  type AttendanceImportRow,
} from '../lib/payrollExcel';
import { computeEgyptEmployeeStatutory } from '../lib/egyptPayrollStatutory';
import { isPayrollPaymentAccount } from '../lib/chartOfAccountsPicker';
import { cn } from '../lib/utils';
import toast from 'react-hot-toast';
import { ManualHelpButton } from './help/ManualHelpButton';
import type { ManualTopicId } from '../lib/operationsManual';
import type { Theme } from '../lib/shellTheme';

// ─── Constants ─────────────────────────────────────────────────────────────────

type Tab = 'employees' | 'runs' | 'leave' | 'settings';

const DIRECT_LABOUR_CODE = '51102001';
const ADMIN_SALARY_CODE = '52101001';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  accrued: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  paid: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
};

const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function payrollCardBg(theme: Theme) {
  return theme === 'dark'
    ? 'bg-gray-900 border-gray-800'
    : theme === 'soft'
      ? 'bg-white/80 border-gray-200/80'
      : 'bg-white border-gray-200';
}

function splitSidebarCls(theme: Theme) {
  return cn(
    'rounded-xl border p-4 w-full md:flex-[2] md:min-w-[17rem] md:max-w-[24rem] shrink-0 space-y-4 md:sticky md:top-4 order-1 md:order-none',
    payrollCardBg(theme),
  );
}

function splitMainCls() {
  return 'flex-1 min-w-0 md:flex-[3] space-y-4 order-2 md:order-none';
}

function splitRowCls(dir: string) {
  return cn('flex flex-col md:flex-row md:items-start gap-4', dir === 'rtl' ? 'md:flex-row-reverse' : '');
}

function splitSelectCls(theme: Theme) {
  return cn(
    'w-full rounded-lg border px-3 py-2 text-sm font-bold outline-none focus:border-blue-500 transition-colors',
    theme === 'dark' ? 'bg-gray-900 border-gray-800 text-white' : 'bg-white border-gray-200 text-gray-900',
  );
}

function splitLabelCls(theme: Theme) {
  return cn('block text-xs font-bold mb-1.5', theme === 'dark' ? 'text-gray-400' : 'text-gray-500');
}

function splitSectionTitleCls() {
  return 'text-xs font-bold uppercase tracking-wide text-gray-500';
}

function splitActiveListBtn(active: boolean, theme: Theme) {
  return cn(
    'w-full text-start px-2.5 py-2 rounded-lg text-sm border transition-colors',
    active
      ? 'bg-blue-600 text-white border-blue-600'
      : theme === 'dark'
        ? 'text-gray-300 border-gray-800 hover:bg-gray-800'
        : 'text-gray-700 border-gray-200 hover:bg-gray-50',
  );
}

function splitEmptyPaneCls(theme: Theme) {
  return cn('border rounded-xl p-12 text-center', theme === 'dark' ? 'border-gray-800 bg-[#151619]' : 'border-gray-200 bg-white');
}

function runStatusLabel(status: string, ar: boolean) {
  if (status === 'draft') return ar ? 'مسودة' : 'Draft';
  if (status === 'accrued') return ar ? 'مستحق' : 'Accrued';
  return ar ? 'مدفوع' : 'Paid';
}

function lineGross(l: { basicSalary?: number; overtime?: number; bonus?: number; incentiveKpi?: number; otherEarnings?: number }): number {
  return (Number(l.basicSalary) || 0) + (Number(l.overtime) || 0) + (Number(l.bonus) || 0) + (Number(l.incentiveKpi) || 0) + (Number(l.otherEarnings) || 0);
}
function lineDeductions(l: { socialInsurance?: number; incomeTax?: number; advances?: number; penalties?: number; otherDeductions?: number }): number {
  return (Number(l.socialInsurance) || 0) + (Number(l.incomeTax) || 0) + (Number(l.advances) || 0) + (Number(l.penalties) || 0) + (Number(l.otherDeductions) || 0);
}

/** Recalculate Egyptian SI + income tax from current earnings (bonus/KPI included). */
function withEgyptStatutory<T extends {
  basicSalary?: number;
  overtime?: number;
  bonus?: number;
  incentiveKpi?: number;
  otherEarnings?: number;
  socialInsurance?: number;
  incomeTax?: number;
}>(line: T): T {
  const { socialInsurance, incomeTax } = computeEgyptEmployeeStatutory(lineGross(line));
  return { ...line, socialInsurance, incomeTax };
}

/** Money fields editable manually in the run sheet (after days import). */
const MANUAL_MONEY_FIELDS = ['bonus', 'incentiveKpi', 'advances'] as const;
/** Fields filled from employee master + days import — display only in draft table. */
const IMPORT_DRIVEN_FIELDS = ['basicSalary', 'overtime', 'penalties'] as const;
const AUTO_STATUTORY_FIELDS = ['socialInsurance', 'incomeTax'] as const;

// ─── Employee Modal ─────────────────────────────────────────────────────────────

interface EmployeeModalProps {
  employee?: PayrollEmployee;
  costCenters: CostCenterRow[];
  onClose: () => void;
  onSaved: () => void;
}

interface AllocRow {
  costCenterId: string;
  costCenterType: string | null;
  expenseAccountCode: string;
  percentage: string;
}

function EmployeeModal({ employee, costCenters, onClose, onSaved }: EmployeeModalProps) {
  const { language } = useLanguage();
  const [form, setForm] = useState({
    employeeCode: employee?.employeeCode ?? '',
    name: employee?.name ?? '',
    nameEn: employee?.nameEn ?? '',
    department: employee?.department ?? '',
    jobTitle: employee?.jobTitle ?? '',
    defaultCostCenterId: employee?.defaultCostCenterId ?? '',
    defaultExpenseAccountCode: employee?.defaultExpenseAccountCode ?? '',
    basicSalary: employee?.basicSalary != null ? String(employee.basicSalary) : '',
    hireDate: employee?.hireDate ?? '',
    birthDate: employee?.birthDate ?? '',
    priorInsuranceMonths: employee?.priorInsuranceMonths != null ? String(employee.priorInsuranceMonths) : '',
    phoneE164: employee?.phoneE164 ?? '',
    whatsappOptIn: employee?.whatsappOptIn ?? false,
    status: employee?.status ?? 'active',
  });
  const [saving, setSaving] = useState(false);
  const [allocs, setAllocs] = useState<AllocRow[]>([]);
  const set = useCallback(<K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v })), []);

  const offlineUserId = useOfflineUserId();
  const employeeDraftValue = useMemo(() => ({ form, allocs }), [form, allocs]);
  const {
    clearDraft: clearEmployeeDraft,
    restorePrompt: employeeRestorePrompt,
    acceptRestore: acceptEmployeeRestore,
    dismissRestore: dismissEmployeeRestore,
  } = useFormDraftAutosave({
    userId: offlineUserId,
    draftKey: FORM_DRAFT_KEYS.payrollEmployeeNew,
    value: employeeDraftValue,
    enabled: !employee,
    isEmpty: (v) => !String(v.form?.employeeCode || '').trim() && !String(v.form?.name || '').trim(),
  });

  // Load the employee's existing default cost-center split when editing
  useEffect(() => {
    let cancelled = false;
    if (employee) {
      payrollApi.getEmployeeAllocations(employee.id)
        .then((rows) => {
          if (cancelled) return;
          setAllocs(rows.map((r) => ({
            costCenterId: r.costCenterId,
            costCenterType: r.costCenterType,
            expenseAccountCode: r.expenseAccountCode ?? '',
            percentage: String(r.percentage),
          })));
        })
        .catch(() => { /* no allocations yet */ });
    }
    return () => { cancelled = true; };
  }, [employee]);

  const onCostCenterChange = useCallback((id: string) => {
    const cc = costCenters.find((c) => c.id === id);
    setForm((f) => ({
      ...f,
      defaultCostCenterId: id,
      defaultExpenseAccountCode: f.defaultExpenseAccountCode || (cc?.type === 'indirect' ? ADMIN_SALARY_CODE : DIRECT_LABOUR_CODE),
    }));
  }, [costCenters]);

  const addAlloc = useCallback(() => setAllocs((a) => [...a, { costCenterId: '', costCenterType: null, expenseAccountCode: '', percentage: '' }]), []);
  const removeAlloc = useCallback((idx: number) => setAllocs((a) => a.filter((_, i) => i !== idx)), []);
  const updateAlloc = useCallback((idx: number, patch: Partial<AllocRow>) => {
    setAllocs((a) => a.map((row, i) => {
      if (i !== idx) return row;
      const next = { ...row, ...patch };
      if (patch.costCenterId !== undefined) {
        const cc = costCenters.find((c) => c.id === patch.costCenterId);
        next.costCenterType = cc?.type ?? null;
        if (!next.expenseAccountCode) next.expenseAccountCode = cc?.type === 'indirect' ? ADMIN_SALARY_CODE : DIRECT_LABOUR_CODE;
      }
      return next;
    }));
  }, [costCenters]);

  const allocTotal = useMemo(() => allocs.reduce((s, r) => s + (Number(r.percentage) || 0), 0), [allocs]);
  const allocValid = allocs.length === 0 || Math.abs(allocTotal - 100) < 0.01;

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.employeeCode.trim() || !form.name.trim()) {
      toast.error(language === 'ar' ? 'الكود والاسم مطلوبان' : 'Code and name are required');
      return;
    }
    const cleanAllocs = allocs.filter((r) => r.costCenterId && Number(r.percentage) > 0);
    if (cleanAllocs.length && Math.abs(cleanAllocs.reduce((s, r) => s + Number(r.percentage), 0) - 100) > 0.01) {
      toast.error(language === 'ar' ? 'مجموع نسب التوزيع يجب أن يساوي 100%' : 'Allocation percentages must total 100%');
      return;
    }
    setSaving(true);
    try {
      const cc = costCenters.find((c) => c.id === form.defaultCostCenterId);
      const payload = {
        employeeCode: form.employeeCode.trim(),
        name: form.name.trim(),
        nameEn: form.nameEn.trim() || null,
        department: form.department.trim() || null,
        jobTitle: form.jobTitle.trim() || null,
        defaultCostCenterId: form.defaultCostCenterId || null,
        defaultCostCenterType: cc?.type ?? null,
        defaultExpenseAccountCode: form.defaultExpenseAccountCode.trim() || null,
        basicSalary: form.basicSalary === '' ? 0 : Number(form.basicSalary),
        hireDate: form.hireDate || null,
        birthDate: form.birthDate || null,
        priorInsuranceMonths: form.priorInsuranceMonths === '' ? null : Number(form.priorInsuranceMonths),
        phoneE164: form.phoneE164.trim() || null,
        whatsappOptIn: form.whatsappOptIn,
        status: form.status,
      };
      const saved = employee
        ? await payrollApi.updateEmployee(employee.id, payload)
        : await payrollApi.createEmployee(payload);
      // Persist the default cost-center split (empty array clears it)
      await payrollApi.setEmployeeAllocations(saved.id, cleanAllocs.map((r) => ({
        costCenterId: r.costCenterId,
        costCenterType: r.costCenterType,
        expenseAccountCode: r.expenseAccountCode.trim() || null,
        expenseAccountName: costCenters.find((c) => c.id === r.costCenterId)?.name ?? null,
        percentage: Number(r.percentage),
      })));
      if (!employee) await clearEmployeeDraft();
      toast.success(employee ? (language === 'ar' ? 'تم حفظ التعديلات' : 'Employee updated') : (language === 'ar' ? 'تمت إضافة الموظف' : 'Employee added'));
      onSaved();
    } catch (err) {
      if (err instanceof NetworkQueuedError) {
        if (!employee) {
          await clearEmployeeDraft();
          onSaved();
        }
        return;
      }
      toast.error(String(err));
    } finally {
      setSaving(false);
    }
  }, [form, allocs, employee, costCenters, language, onSaved, clearEmployeeDraft]);

  const inputCls = 'w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">{employee ? (language === 'ar' ? 'تعديل موظف' : 'Edit Employee') : (language === 'ar' ? 'موظف جديد' : 'New Employee')}</h2>
            <ManualHelpButton topicId="payroll.employee.master" size={14} />
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 grid grid-cols-2 gap-3">
          {!employee && (
            <div className="col-span-2">
              <FormDraftRestoreBanner
                show={Boolean(employeeRestorePrompt)}
                updatedAt={employeeRestorePrompt?.updatedAt}
                onRestore={() => {
                  const p = employeeRestorePrompt?.payload;
                  if (p?.form) setForm(p.form);
                  if (p?.allocs) setAllocs(p.allocs);
                  acceptEmployeeRestore();
                }}
                onDiscard={() => { void dismissEmployeeRestore(); }}
              />
            </div>
          )}
          <div>
            <label className="block text-xs text-gray-500 mb-1">{language === 'ar' ? 'كود الموظف *' : 'Employee Code *'}</label>
            <input className={cn(inputCls, 'font-mono')} value={form.employeeCode} onChange={(e) => set('employeeCode', e.target.value)} disabled={!!employee} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">{language === 'ar' ? 'الاسم *' : 'Name *'}</label>
            <input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">{language === 'ar' ? 'الإدارة' : 'Department'}</label>
            <input className={inputCls} value={form.department} onChange={(e) => set('department', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">{language === 'ar' ? 'المسمى الوظيفي' : 'Job Title'}</label>
            <input className={inputCls} value={form.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">{language === 'ar' ? 'تاريخ الميلاد' : 'Birth Date'}</label>
            <input type="date" className={inputCls} value={form.birthDate} onChange={(e) => set('birthDate', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">{language === 'ar' ? 'تاريخ التعيين' : 'Hire Date'}</label>
            <input type="date" className={inputCls} value={form.hireDate} onChange={(e) => set('hireDate', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">{language === 'ar' ? 'مدة التأمين السابقة (شهر)' : 'Prior Insurance (months)'}</label>
            <input type="number" step="1" min="0" className={inputCls} value={form.priorInsuranceMonths} onChange={(e) => set('priorInsuranceMonths', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">{language === 'ar' ? 'رقم الهاتف (واتساب)' : 'Phone (WhatsApp)'}</label>
            <input className={cn(inputCls, 'font-mono')} placeholder="+201234567890" value={form.phoneE164} onChange={(e) => set('phoneE164', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">{language === 'ar' ? 'مركز التكلفة الافتراضي' : 'Default Cost Center'}</label>
            <select className={inputCls} value={form.defaultCostCenterId} onChange={(e) => onCostCenterChange(e.target.value)}>
              <option value="">{language === 'ar' ? '— اختر —' : '— Select —'}</option>
              {costCenters.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">{language === 'ar' ? 'حساب المصروف' : 'Expense Account'}</label>
            <input className={cn(inputCls, 'font-mono')} placeholder={ADMIN_SALARY_CODE} value={form.defaultExpenseAccountCode} onChange={(e) => set('defaultExpenseAccountCode', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">{language === 'ar' ? 'الراتب الأساسي' : 'Basic Salary'}</label>
            <input type="number" step="1" min="0" className={inputCls} value={form.basicSalary} onChange={(e) => set('basicSalary', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">{language === 'ar' ? 'الحالة' : 'Status'}</label>
            <select className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value)}>
              <option value="active">{language === 'ar' ? 'نشط' : 'Active'}</option>
              <option value="inactive">{language === 'ar' ? 'غير نشط' : 'Inactive'}</option>
            </select>
          </div>
          <div className="col-span-2 flex items-center gap-2 pt-1">
            <input id="emp-wa-optin" type="checkbox" className="w-4 h-4" checked={form.whatsappOptIn} onChange={(e) => set('whatsappOptIn', e.target.checked)} />
            <label htmlFor="emp-wa-optin" className="text-xs text-gray-600 dark:text-gray-300">{language === 'ar' ? 'الموافقة على استقبال إشعارات الراتب عبر واتساب' : 'Opt-in to receive salary notifications via WhatsApp'}</label>
          </div>

          {/* Default cost-center split */}
          <div className="col-span-2 border-t border-gray-200 dark:border-gray-700 pt-3 mt-1">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{language === 'ar' ? 'توزيع التكلفة الافتراضي (مراكز ونِسَب)' : 'Default cost split (centers & %)'}</span>
              <button type="button" onClick={addAlloc} className="text-xs px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 inline-flex items-center gap-1"><Plus size={12} />{language === 'ar' ? 'إضافة مركز' : 'Add center'}</button>
            </div>
            <p className="text-[11px] text-gray-400 mb-2">{language === 'ar' ? 'اتركه فارغاً لاستخدام مركز التكلفة الافتراضي الواحد. عند التعبئة يجب أن يساوي المجموع 100%.' : 'Leave empty to use the single default cost center. When used, the total must equal 100%.'}</p>
            {allocs.map((row, idx) => (
              <div key={idx} className="flex items-center gap-2 mb-2">
                <select className={cn(inputCls, 'flex-1')} value={row.costCenterId} onChange={(e) => updateAlloc(idx, { costCenterId: e.target.value })}>
                  <option value="">{language === 'ar' ? '— اختر —' : '— Select —'}</option>
                  {costCenters.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
                </select>
                <input className={cn(inputCls, 'w-24 font-mono')} placeholder={language === 'ar' ? 'حساب' : 'Acct'} value={row.expenseAccountCode} onChange={(e) => updateAlloc(idx, { expenseAccountCode: e.target.value })} />
                <input type="number" step="0.01" min="0" max="100" className={cn(inputCls, 'w-20')} placeholder="%" value={row.percentage} onChange={(e) => updateAlloc(idx, { percentage: e.target.value })} />
                <button type="button" onClick={() => removeAlloc(idx)} className="text-red-500 hover:text-red-700 p-1"><Trash2 size={14} /></button>
              </div>
            ))}
            {allocs.length > 0 && (
              <div className={cn('text-xs font-medium', allocValid ? 'text-green-600' : 'text-red-600')}>
                {language === 'ar' ? 'المجموع' : 'Total'}: {allocTotal.toFixed(2)}%
              </div>
            )}
          </div>

          <div className="col-span-2 flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">{language === 'ar' ? 'إلغاء' : 'Cancel'}</button>
            <button type="submit" disabled={saving || !allocValid} className="px-4 py-2 text-sm rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-medium disabled:opacity-60">
              {saving ? <RefreshCw size={14} className="animate-spin inline mr-1" /> : null}
              {language === 'ar' ? 'حفظ' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── New Run Modal ───────────────────────────────────────────────────────────

interface RunModalProps {
  employees: PayrollEmployee[];
  costCenters: CostCenterRow[];
  onClose: () => void;
  onCreated: (run: PayrollRun) => void;
}

function RunModal({ employees, costCenters, onClose, onCreated }: RunModalProps) {
  const { language } = useLanguage();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [description, setDescription] = useState('');
  const [populate, setPopulate] = useState(true);
  const [saving, setSaving] = useState(false);
  const months = language === 'ar' ? MONTHS_AR : MONTHS_EN;

  const handleCreate = useCallback(async () => {
    setSaving(true);
    try {
      let lines: PayrollLineInput[] = [];
      if (populate) {
        const active = employees.filter((e) => e.status === 'active');
        lines = active.map((e) => {
          const cc = costCenters.find((c) => c.id === e.defaultCostCenterId);
          return {
            employeeId: e.id,
            employeeCode: e.employeeCode,
            employeeName: e.name,
            department: e.department,
            costCenterId: e.defaultCostCenterId,
            costCenterType: e.defaultCostCenterType,
            costCenterCode: cc?.code ?? null,
            expenseAccountCode: e.defaultExpenseAccountCode ?? (e.defaultCostCenterType === 'indirect' ? ADMIN_SALARY_CODE : DIRECT_LABOUR_CODE),
            expenseAccountName: e.defaultExpenseAccountName,
            basicSalary: Number(e.basicSalary) || 0,
          };
        });
      }
      const run = await payrollApi.createRun({ periodMonth: month, periodYear: year, description: description.trim() || undefined, lines });
      toast.success(language === 'ar' ? `تم إنشاء كشف ${run.runNumber}` : `Run ${run.runNumber} created`);
      onCreated(run);
    } catch (err) {
      if (err instanceof NetworkQueuedError) {
        onClose();
        return;
      }
      toast.error(String(err));
    } finally {
      setSaving(false);
    }
  }, [month, year, description, populate, employees, costCenters, language, onCreated, onClose]);

  const inputCls = 'w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">{language === 'ar' ? 'كشف رواتب جديد' : 'New Payroll Sheet'}</h2>
            <ManualHelpButton topicId="payroll.run.create_edit" size={14} />
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={18} /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">{language === 'ar' ? 'الشهر' : 'Month'}</label>
              <select className={inputCls} value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {months.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{language === 'ar' ? 'السنة' : 'Year'}</label>
              <input type="number" className={inputCls} value={year} onChange={(e) => setYear(Number(e.target.value))} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">{language === 'ar' ? 'وصف' : 'Description'}</label>
            <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={populate} onChange={(e) => setPopulate(e.target.checked)} />
            {language === 'ar' ? `تعبئة من الموظفين النشطين (${employees.filter((e) => e.status === 'active').length})` : `Populate from active employees (${employees.filter((e) => e.status === 'active').length})`}
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">{language === 'ar' ? 'إلغاء' : 'Cancel'}</button>
            <button onClick={handleCreate} disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-medium disabled:opacity-60">
              {saving ? <RefreshCw size={14} className="animate-spin inline mr-1" /> : null}
              {language === 'ar' ? 'إنشاء' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Pay Modal ───────────────────────────────────────────────────────────────

interface PayModalProps {
  run: PayrollRun;
  paymentAccounts: { code: string; name: string }[];
  onClose: () => void;
  onPaid: () => void;
}

function PayModal({ run, paymentAccounts, onClose, onPaid }: PayModalProps) {
  const { language, formatMoney } = useLanguage();
  const [accountCode, setAccountCode] = useState(paymentAccounts[0]?.code ?? '');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  const handlePay = useCallback(async () => {
    if (!accountCode) {
      toast.error(language === 'ar' ? 'اختر حساب البنك أو النقدية' : 'Select a bank/cash account');
      return;
    }
    setSaving(true);
    try {
      const acc = paymentAccounts.find((a) => a.code === accountCode);
      await payrollApi.pay(run.id, { paymentAccountCode: accountCode, paymentAccountName: acc?.name, paymentDate });
      toast.success(language === 'ar' ? 'تم تسجيل سداد الرواتب' : 'Payroll payment recorded');
      onPaid();
    } catch (err) {
      if (err instanceof NetworkQueuedError) {
        onClose();
        return;
      }
      toast.error(String(err));
    } finally {
      setSaving(false);
    }
  }, [accountCode, paymentDate, run.id, paymentAccounts, language, onPaid]);

  const inputCls = 'w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold">{language === 'ar' ? 'سداد الأجور والمرتبات' : 'Pay Salaries & Wages'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={18} /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="p-3 rounded-lg bg-sky-50 dark:bg-sky-900/20 text-sm flex items-center justify-between">
            <span className="text-gray-600 dark:text-gray-300">{language === 'ar' ? 'صافي المستحق' : 'Net Payable'}</span>
            <span className="font-bold text-sky-700 dark:text-sky-300 tabular-nums">{formatMoney(run.totalNet)}</span>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">{language === 'ar' ? 'حساب الدفع (بنك / نقدية)' : 'Payment Account (Bank / Cash)'}</label>
            <select className={inputCls} value={accountCode} onChange={(e) => setAccountCode(e.target.value)}>
              <option value="">{language === 'ar' ? '— اختر —' : '— Select —'}</option>
              {paymentAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">{language === 'ar' ? 'تاريخ السداد' : 'Payment Date'}</label>
            <input type="date" className={inputCls} value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">{language === 'ar' ? 'إلغاء' : 'Cancel'}</button>
            <button onClick={handlePay} disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-green-600 hover:bg-green-700 text-white font-medium disabled:opacity-60 flex items-center gap-2">
              {saving ? <RefreshCw size={14} className="animate-spin" /> : <Wallet size={14} />}
              {language === 'ar' ? 'تأكيد السداد' : 'Confirm Payment'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Attendance Rules Panel ───────────────────────────────────────────────────

// ─── Attendance rule helpers (mirror server/src/lib/payrollAttendance.ts) ───────

const ATTENDANCE_DEFAULTS: Required<Omit<AttendanceRule, 'id'>> = {
  workingDaysPerMonth: 26,
  dailyWorkHours: 8,
  overtimeMultiplier: 1.25,
  lateGraceMins: 5,
  lateTier1Mins: 15,
  lateTier2Mins: 30,
  lateTier3Mins: 60,
  lateAboveTier3: 'full',
  absenceDeduction: 'daily_rate',
  absenceFixedAmount: 0,
};

type AttendanceForm = Omit<AttendanceRule, 'id'>;
type LateTier = 'none' | 'warning' | 'quarter_day' | 'half_day' | 'full_day';

const TIER_LABEL_KEY: Record<LateTier, string> = {
  none: 'payroll_tier_none',
  warning: 'payroll_tier_warning',
  quarter_day: 'payroll_tier_quarter',
  half_day: 'payroll_tier_half',
  full_day: 'payroll_tier_full',
};

const TIER_BADGE: Record<LateTier, string> = {
  none: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  quarter_day: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  half_day: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  full_day: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

function classifyLateTier(effectiveLate: number, r: AttendanceForm): LateTier {
  if (effectiveLate <= 0) return 'none';
  if (effectiveLate <= r.lateTier1Mins) return 'warning';
  if (effectiveLate <= r.lateTier2Mins) return 'quarter_day';
  if (effectiveLate <= r.lateTier3Mins) return 'half_day';
  return r.lateAboveTier3 === 'full' ? 'full_day' : 'half_day';
}

function tierFraction(tier: LateTier): number {
  if (tier === 'quarter_day') return 0.25;
  if (tier === 'half_day') return 0.5;
  if (tier === 'full_day') return 1;
  return 0;
}

interface AttendanceFormErrors {
  workingDaysPerMonth?: string;
  dailyWorkHours?: string;
  overtimeMultiplier?: string;
  lateTierOrder?: string;
}

function validateAttendanceForm(f: AttendanceForm, t: (k: string) => string): AttendanceFormErrors {
  const errors: AttendanceFormErrors = {};
  if (!(f.workingDaysPerMonth > 0)) errors.workingDaysPerMonth = t('payroll_err_positive');
  if (!(f.dailyWorkHours > 0)) errors.dailyWorkHours = t('payroll_err_positive');
  if (!(f.overtimeMultiplier >= 1)) errors.overtimeMultiplier = t('payroll_err_multiplier');
  if (!(f.lateGraceMins < f.lateTier1Mins && f.lateTier1Mins < f.lateTier2Mins && f.lateTier2Mins < f.lateTier3Mins)) {
    errors.lateTierOrder = t('payroll_err_tier_order');
  }
  return errors;
}

function AttendanceSettingsCard({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
      <header className="flex items-start gap-2.5 px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40">
        <div className="mt-0.5 text-sky-600 dark:text-sky-400">{icon}</div>
        <div>
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{title}</h3>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">{hint}</p>
        </div>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function AttendanceRulesPanel({ embedded = false }: { embedded?: boolean }) {
  const { t, language, formatMoney } = useLanguage();
  const [refreshKey, setRefreshKey] = useState(0);
  const { data: ruleRows, loading } = useApiQuery(() => attendanceApi.getRules().then((r) => [r]), [refreshKey]);
  const rule = ruleRows[0];
  const [form, setForm] = useState<AttendanceForm | null>(null);
  const [saving, setSaving] = useState(false);

  // Live-preview sample inputs
  const [sampleBasic, setSampleBasic] = useState(8000);
  const [sampleAbsent, setSampleAbsent] = useState(1);
  const [sampleLate, setSampleLate] = useState(40);
  const [sampleOt, setSampleOt] = useState(6);

  useEffect(() => {
    if (rule) {
      setForm({
        workingDaysPerMonth: rule.workingDaysPerMonth,
        dailyWorkHours: rule.dailyWorkHours,
        overtimeMultiplier: rule.overtimeMultiplier,
        lateGraceMins: rule.lateGraceMins,
        lateTier1Mins: rule.lateTier1Mins,
        lateTier2Mins: rule.lateTier2Mins,
        lateTier3Mins: rule.lateTier3Mins,
        lateAboveTier3: rule.lateAboveTier3,
        absenceDeduction: rule.absenceDeduction,
        absenceFixedAmount: rule.absenceFixedAmount ?? 0,
      });
    }
  }, [rule]);

  const errors = useMemo(() => (form ? validateAttendanceForm(form, t) : {}), [form, t]);
  const hasErrors = Object.keys(errors).length > 0;

  const dirty = useMemo(() => {
    if (!form || !rule) return false;
    return (Object.keys(form) as (keyof AttendanceForm)[]).some((k) => form[k] !== (rule[k] ?? ATTENDANCE_DEFAULTS[k]));
  }, [form, rule]);

  const ladder = useMemo(() => {
    if (!form) return [];
    return [
      { tier: 'none' as LateTier, range: `≤ ${form.lateGraceMins}` },
      { tier: 'warning' as LateTier, range: `${form.lateGraceMins + 1} – ${form.lateGraceMins + form.lateTier1Mins}` },
      { tier: 'quarter_day' as LateTier, range: `${form.lateGraceMins + form.lateTier1Mins + 1} – ${form.lateGraceMins + form.lateTier2Mins}` },
      { tier: 'half_day' as LateTier, range: `${form.lateGraceMins + form.lateTier2Mins + 1} – ${form.lateGraceMins + form.lateTier3Mins}` },
      { tier: (form.lateAboveTier3 === 'full' ? 'full_day' : 'half_day') as LateTier, range: `> ${form.lateGraceMins + form.lateTier3Mins}` },
    ];
  }, [form]);

  const preview = useMemo(() => {
    if (!form || form.workingDaysPerMonth <= 0 || form.dailyWorkHours <= 0) return null;
    const dailyRate = Math.round(sampleBasic / form.workingDaysPerMonth);
    const hourlyRate = Math.round(dailyRate / form.dailyWorkHours);
    const overtimePay = Math.round(Math.max(0, sampleOt) * hourlyRate * form.overtimeMultiplier);
    const absenceDed = form.absenceDeduction === 'fixed'
      ? Math.round(Math.max(0, sampleAbsent) * (form.absenceFixedAmount ?? 0))
      : Math.round(Math.max(0, sampleAbsent) * dailyRate);
    const effectiveLate = Math.max(0, sampleLate - form.lateGraceMins);
    const tier = classifyLateTier(effectiveLate, form);
    const lateDed = Math.round(dailyRate * tierFraction(tier));
    const net = Math.round(sampleBasic + overtimePay - absenceDed - lateDed);
    return { dailyRate, hourlyRate, overtimePay, absenceDed, lateDed, tier, net };
  }, [form, sampleBasic, sampleAbsent, sampleLate, sampleOt]);

  const handleSave = useCallback(async () => {
    if (!form || hasErrors) return;
    setSaving(true);
    try {
      await attendanceApi.updateRules(form);
      toast.success(t('payroll_attendance_saved'));
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSaving(false);
    }
  }, [form, hasErrors, t]);

  const handleReset = useCallback(() => {
    setForm({ ...ATTENDANCE_DEFAULTS });
  }, []);

  if (loading || !form) {
    return <div className="flex justify-center py-16"><RefreshCw size={20} className="animate-spin text-sky-500" /></div>;
  }

  const inputCls = 'w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500';
  const errInputCls = 'border-red-400 dark:border-red-500 focus:ring-red-500/40 focus:border-red-500';
  const labelCls = 'block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1';

  const numField = (key: keyof AttendanceForm, label: string, unit: string, step = '1', invalid = false) => (
    <div>
      <label className={labelCls}>{label}</label>
      <div className="relative">
        <input
          type="number"
          step={step}
          className={cn(inputCls, 'pe-12', invalid && errInputCls)}
          value={(form[key] as number | string) ?? ''}
          onChange={(e) => setForm((f) => (f ? { ...f, [key]: e.target.value === '' ? 0 : Number(e.target.value) } : f))}
        />
        <span className="absolute inset-y-0 end-3 flex items-center text-[11px] text-gray-400 pointer-events-none">{unit}</span>
      </div>
    </div>
  );

  return (
    <div className={cn('space-y-5', embedded ? 'w-full' : 'max-w-5xl')}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        {!embedded && (
          <div className="flex items-start gap-2.5">
            <Settings2 size={20} className="mt-0.5 text-blue-600" />
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('payroll_attendance_rules')}</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('payroll_rules_subtitle')}</p>
            </div>
          </div>
        )}
        <div className={cn('flex items-center gap-2', embedded && 'ms-auto w-full justify-end')}>
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <RotateCcw size={13} />{t('payroll_reset_defaults')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || hasErrors || !dirty}
            title={!dirty ? t('payroll_no_changes') : undefined}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
            {t('payroll_save_rules')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Work basics */}
        <AttendanceSettingsCard icon={<Briefcase size={17} />} title={t('payroll_section_work_basics')} hint={t('payroll_section_work_basics_hint')}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {numField('workingDaysPerMonth', t('payroll_working_days'), t('payroll_unit_days'), '1', !!errors.workingDaysPerMonth)}
            {numField('dailyWorkHours', t('payroll_daily_hours'), t('payroll_unit_hours'), '0.5', !!errors.dailyWorkHours)}
            {numField('overtimeMultiplier', t('payroll_overtime_multiplier'), t('payroll_unit_times'), '0.01', !!errors.overtimeMultiplier)}
          </div>
          {(errors.workingDaysPerMonth || errors.dailyWorkHours || errors.overtimeMultiplier) && (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-red-600 dark:text-red-400">
              <AlertTriangle size={12} />{errors.overtimeMultiplier ?? errors.workingDaysPerMonth ?? errors.dailyWorkHours}
            </p>
          )}
        </AttendanceSettingsCard>

        {/* Absence policy */}
        <AttendanceSettingsCard icon={<CalendarX size={17} />} title={t('payroll_section_absence_policy')} hint={t('payroll_section_absence_policy_hint')}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{t('payroll_absence_deduction')}</label>
              <select
                className={inputCls}
                value={form.absenceDeduction}
                onChange={(e) => setForm((f) => (f ? { ...f, absenceDeduction: e.target.value } : f))}
              >
                <option value="daily_rate">{t('payroll_absence_daily_rate')}</option>
                <option value="fixed">{t('payroll_absence_fixed')}</option>
              </select>
            </div>
            {form.absenceDeduction === 'fixed' && numField('absenceFixedAmount', t('payroll_absence_fixed'), language === 'ar' ? 'ج.م' : 'EGP', '1'            )}
          </div>
        </AttendanceSettingsCard>

        {/* Late policy + ladder (full width) */}
        <div className="lg:col-span-2">
          <AttendanceSettingsCard icon={<Clock size={17} />} title={t('payroll_section_late_policy')} hint={t('payroll_section_late_policy_hint')}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {numField('lateGraceMins', t('payroll_grace_mins'), t('payroll_unit_mins'), '1', !!errors.lateTierOrder)}
              {numField('lateTier1Mins', t('payroll_late_tier1'), t('payroll_unit_mins'), '1', !!errors.lateTierOrder)}
              {numField('lateTier2Mins', t('payroll_late_tier2'), t('payroll_unit_mins'), '1', !!errors.lateTierOrder)}
              {numField('lateTier3Mins', t('payroll_late_tier3'), t('payroll_unit_mins'), '1', !!errors.lateTierOrder)}
            </div>
            <div className="mt-3">
              <label className={labelCls}>{t('payroll_above_tier3')}</label>
              <div className="flex gap-2">
                {(['full', 'half'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setForm((f) => (f ? { ...f, lateAboveTier3: opt } : f))}
                    className={cn(
                      'px-3 py-1.5 text-xs rounded-lg border transition-colors',
                      form.lateAboveTier3 === opt
                        ? 'bg-sky-600 border-sky-600 text-white'
                        : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800',
                    )}
                  >
                    {opt === 'full' ? t('payroll_above_full') : t('payroll_above_half')}
                  </button>
                ))}
              </div>
            </div>
            {errors.lateTierOrder && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-red-600 dark:text-red-400">
                <AlertTriangle size={12} />{errors.lateTierOrder}
              </p>
            )}

            {/* Visual ladder */}
            <div className="mt-4">
              <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5">
                <Info size={12} />{t('payroll_ladder_title')}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                {ladder.map((row, i) => (
                  <div key={i} className="rounded-lg border border-gray-200 dark:border-gray-700 p-2.5 text-center">
                    <div className="text-[11px] text-gray-400 mb-1">{t('payroll_ladder_range')}</div>
                    <div className="text-xs font-semibold text-gray-700 dark:text-gray-200 tabular-nums mb-1.5">{row.range}</div>
                    <span className={cn('inline-block px-2 py-0.5 rounded-full text-[10px] font-medium', TIER_BADGE[row.tier])}>
                      {t(TIER_LABEL_KEY[row.tier])}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </AttendanceSettingsCard>
        </div>

        {/* Live impact preview (full width) */}
        <div className="lg:col-span-2">
          <AttendanceSettingsCard icon={<Wallet size={17} />} title={t('payroll_preview_title')} hint={t('payroll_preview_hint')}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className={labelCls}>{t('payroll_preview_basic')}</label>
                <input type="number" step="1" className={inputCls} value={sampleBasic} onChange={(e) => setSampleBasic(Number(e.target.value) || 0)} />
              </div>
              <div>
                <label className={labelCls}>{t('payroll_days_absent')}</label>
                <input type="number" step="1" className={inputCls} value={sampleAbsent} onChange={(e) => setSampleAbsent(Number(e.target.value) || 0)} />
              </div>
              <div>
                <label className={labelCls}>{t('payroll_late_mins')}</label>
                <input type="number" step="1" className={inputCls} value={sampleLate} onChange={(e) => setSampleLate(Number(e.target.value) || 0)} />
              </div>
              <div>
                <label className={labelCls}>{t('payroll_overtime_hours')}</label>
                <input type="number" step="0.5" className={inputCls} value={sampleOt} onChange={(e) => setSampleOt(Number(e.target.value) || 0)} />
              </div>
            </div>

            {preview && (
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                <div className="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800/60 text-center">
                  <div className="text-[10px] text-gray-500">{t('payroll_preview_daily_value')}</div>
                  <div className="text-sm font-bold text-gray-700 dark:text-gray-200 tabular-nums">{formatMoney(preview.dailyRate)}</div>
                </div>
                <div className="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800/60 text-center">
                  <div className="text-[10px] text-gray-500">{t('payroll_preview_hourly_value')}</div>
                  <div className="text-sm font-bold text-gray-700 dark:text-gray-200 tabular-nums">{formatMoney(preview.hourlyRate)}</div>
                </div>
                <div className="p-2.5 rounded-lg bg-green-50 dark:bg-green-900/20 text-center">
                  <div className="text-[10px] text-gray-500">{t('payroll_preview_overtime_pay')}</div>
                  <div className="text-sm font-bold text-green-600 dark:text-green-300 tabular-nums">{formatMoney(preview.overtimePay)}</div>
                </div>
                <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 text-center">
                  <div className="text-[10px] text-gray-500">{t('payroll_absence_amount')}</div>
                  <div className="text-sm font-bold text-red-600 dark:text-red-300 tabular-nums">{formatMoney(preview.absenceDed)}</div>
                </div>
                <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 text-center">
                  <div className="text-[10px] text-gray-500">{t('payroll_late_amount')}</div>
                  <div className="text-sm font-bold text-red-600 dark:text-red-300 tabular-nums">{formatMoney(preview.lateDed)}</div>
                  <span className={cn('inline-block mt-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium', TIER_BADGE[preview.tier])}>
                    {t(TIER_LABEL_KEY[preview.tier])}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-sky-50 dark:bg-sky-900/20 text-center">
                  <div className="text-[10px] text-gray-500">{t('payroll_preview_net')}</div>
                  <div className="text-sm font-bold text-sky-700 dark:text-sky-300 tabular-nums">{formatMoney(preview.net)}</div>
                </div>
              </div>
            )}
          </AttendanceSettingsCard>
        </div>
      </div>
    </div>
  );
}

// ─── Official holidays panel ────────────────────────────────────────────────────

function OfficialHolidaysPanel({ embedded = false }: { embedded?: boolean }) {
  const { t, language } = useLanguage();
  const [year, setYear] = useState(new Date().getFullYear());
  const [refreshKey, setRefreshKey] = useState(0);
  const { data: holidays, loading } = useApiQuery(() => officialHolidaysApi.list(year), [year, refreshKey]);
  const [draft, setDraft] = useState<{ holidayDate: string; nameAr: string; nameEn: string }>({ holidayDate: `${year}-01-01`, nameAr: '', nameEn: '' });
  const [saving, setSaving] = useState(false);

  const inputCls = 'border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40';
  const reload = () => setRefreshKey((k) => k + 1);

  const handleAdd = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.holidayDate) || !draft.nameAr.trim()) {
      toast.error(language === 'ar' ? 'أدخل تاريخاً واسماً صحيحين' : 'Enter a valid date and name');
      return;
    }
    setSaving(true);
    try {
      await officialHolidaysApi.create({ holidayDate: draft.holidayDate, nameAr: draft.nameAr.trim(), nameEn: (draft.nameEn || draft.nameAr).trim() });
      toast.success(t('payroll_holiday_added'));
      setDraft({ holidayDate: `${year}-01-01`, nameAr: '', nameEn: '' });
      reload();
    } catch (err) { toast.error(String(err)); } finally { setSaving(false); }
  };

  const handleDelete = async (h: OfficialHoliday) => {
    if (!confirm(language === 'ar' ? `حذف «${h.nameAr}»؟` : `Delete "${h.nameEn}"?`)) return;
    try { await officialHolidaysApi.remove(h.id); reload(); } catch (err) { toast.error(String(err)); }
  };

  const body = (
    <>
      <div className="flex items-center gap-2 mb-3">
        <label className="text-xs text-gray-500">{t('payroll_year')}</label>
        <input type="number" step="1" className={cn(inputCls, 'w-24')} value={year} onChange={(e) => setYear(Number(e.target.value) || year)} />
      </div>

      <div className="flex flex-wrap items-end gap-2 mb-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/40">
        <div>
          <label className="block text-[11px] text-gray-500 mb-1">{t('payroll_holiday_date')}</label>
          <input type="date" className={inputCls} value={draft.holidayDate} onChange={(e) => setDraft((d) => ({ ...d, holidayDate: e.target.value }))} />
        </div>
        <div className="flex-1 min-w-[140px]">
          <label className="block text-[11px] text-gray-500 mb-1">{t('payroll_holiday_name_ar')}</label>
          <input type="text" className={cn(inputCls, 'w-full')} value={draft.nameAr} onChange={(e) => setDraft((d) => ({ ...d, nameAr: e.target.value }))} />
        </div>
        <div className="flex-1 min-w-[140px]">
          <label className="block text-[11px] text-gray-500 mb-1">{t('payroll_holiday_name_en')}</label>
          <input type="text" className={cn(inputCls, 'w-full')} value={draft.nameEn} onChange={(e) => setDraft((d) => ({ ...d, nameEn: e.target.value }))} />
        </div>
        <button onClick={handleAdd} disabled={saving} className="flex items-center gap-1 px-3 py-2 text-xs rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-60"><Plus size={13} />{t('payroll_holiday_add')}</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><RefreshCw size={18} className="animate-spin text-blue-500" /></div>
      ) : holidays.length === 0 ? (
        <p className="text-xs text-gray-400 py-4 text-center">{t('payroll_holidays_empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 text-start">{t('payroll_holiday_date')}</th>
                <th className="px-3 py-2 text-start">{t('payroll_holiday_name_ar')}</th>
                <th className="px-3 py-2 text-start">{t('payroll_holiday_name_en')}</th>
                <th className="px-3 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {holidays.map((h) => (
                <tr key={h.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-3 py-2 tabular-nums">{h.holidayDate}</td>
                  <td className="px-3 py-2">{h.nameAr}</td>
                  <td className="px-3 py-2 text-gray-500">{h.nameEn}</td>
                  <td className="px-3 py-2 text-center">
                    <button onClick={() => handleDelete(h)} className="p-1 rounded text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[11px] text-gray-400">{t('payroll_holidays_islamic_note')}</p>
    </>
  );

  if (embedded) {
    return <div className="space-y-2">{body}</div>;
  }

  return (
    <AttendanceSettingsCard icon={<CalendarX size={17} />} title={t('payroll_holidays_title')} hint={t('payroll_holidays_hint')}>
      {body}
    </AttendanceSettingsCard>
  );
}

// ─── Leave types panel ──────────────────────────────────────────────────────────

function LeaveTypesPanel({ embedded = false }: { embedded?: boolean }) {
  const { t, language } = useLanguage();
  const [refreshKey, setRefreshKey] = useState(0);
  const { data: types, loading } = useApiQuery(() => leaveTypesApi.list(), [refreshKey]);
  const [savingId, setSavingId] = useState<string | null>(null);

  const patch = async (lt: LeaveType, data: Partial<LeaveType>) => {
    setSavingId(lt.id);
    try { await leaveTypesApi.update(lt.id, data); setRefreshKey((k) => k + 1); }
    catch (err) { toast.error(String(err)); }
    finally { setSavingId(null); }
  };

  const tableBody = loading ? (
    <div className="flex justify-center py-6"><RefreshCw size={18} className="animate-spin text-blue-500" /></div>
  ) : (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-800 text-xs text-gray-500">
          <tr>
            <th className="px-3 py-2 text-start">{t('payroll_leave_type')}</th>
            <th className="px-3 py-2 text-center">{t('payroll_leave_paid')}</th>
            <th className="px-3 py-2 text-center">{t('payroll_leave_default_days')}</th>
          </tr>
        </thead>
        <tbody>
          {types.map((lt) => (
            <tr key={lt.id} className={cn('border-t border-gray-100 dark:border-gray-800', savingId === lt.id && 'opacity-60')}>
              <td className="px-3 py-2 font-medium">{language === 'ar' ? lt.nameAr : lt.nameEn}</td>
              <td className="px-3 py-2 text-center">
                <button
                  onClick={() => patch(lt, { paid: !lt.paid })}
                  className={cn('px-2 py-0.5 rounded-full text-[11px] font-medium', lt.paid ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300')}
                >
                  {lt.paid ? t('payroll_leave_paid_yes') : t('payroll_leave_paid_no')}
                </button>
              </td>
              <td className="px-3 py-2 text-center">
                <input
                  type="number"
                  step="1"
                  className="w-20 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs bg-white dark:bg-gray-800 text-center tabular-nums"
                  defaultValue={lt.defaultAnnualDays}
                  onBlur={(e) => {
                    const v = Math.max(0, Math.trunc(Number(e.target.value) || 0));
                    if (v !== lt.defaultAnnualDays) patch(lt, { defaultAnnualDays: v });
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  if (embedded) {
    return <div className="space-y-2">{tableBody}</div>;
  }

  return (
    <AttendanceSettingsCard icon={<Briefcase size={17} />} title={t('payroll_leave_types_title')} hint={t('payroll_leave_types_hint')}>
      {tableBody}
    </AttendanceSettingsCard>
  );
}

// ─── Employee leave balances panel ──────────────────────────────────────────────

function LeaveBalancesPanel() {
  const { t, language } = useLanguage();
  const [year, setYear] = useState(new Date().getFullYear());
  const [refreshKey, setRefreshKey] = useState(0);
  const [initializing, setInitializing] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const { data: balances, loading } = useApiQuery(() => leaveBalancesApi.list({ year }), [year, refreshKey]);

  const inputCls = 'border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40';
  const reload = () => setRefreshKey((k) => k + 1);

  const handleInit = async () => {
    setInitializing(true);
    try {
      const res = await leaveBalancesApi.initialize(year);
      toast.success(language === 'ar' ? `تم إنشاء ${res.created} رصيد` : `${res.created} balances created`);
      reload();
    } catch (err) { toast.error(String(err)); } finally { setInitializing(false); }
  };

  const handleRecompute = async () => {
    setRecomputing(true);
    try {
      const res = await leaveBalancesApi.recomputeUsed(year);
      toast.success(language === 'ar' ? `تم تحديث ${res.updated} رصيد` : `${res.updated} balances updated`);
      reload();
    } catch (err) { toast.error(String(err)); } finally { setRecomputing(false); }
  };

  const saveCell = async (b: EmployeeLeaveBalance, patch: Partial<Pick<EmployeeLeaveBalance, 'entitledDays' | 'carriedDays' | 'usedDays'>>) => {
    try {
      await leaveBalancesApi.upsert({
        employeeId: b.employeeId,
        leaveTypeId: b.leaveTypeId,
        year: b.year,
        entitledDays: patch.entitledDays ?? b.entitledDays,
        carriedDays: patch.carriedDays ?? b.carriedDays,
        usedDays: patch.usedDays ?? b.usedDays,
        notes: b.notes,
      });
      reload();
    } catch (err) { toast.error(String(err)); }
  };

  const numCell = (b: EmployeeLeaveBalance, key: 'entitledDays' | 'carriedDays' | 'usedDays') => (
    <input
      type="number"
      step="0.5"
      className="w-20 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs bg-white dark:bg-gray-800 text-center tabular-nums"
      defaultValue={b[key]}
      onBlur={(e) => {
        const v = Number(e.target.value) || 0;
        if (v !== b[key]) saveCell(b, { [key]: v });
      }}
    />
  );

  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2.5">
          <ClipboardCheck size={20} className="mt-0.5 text-sky-600" />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('payroll_leave_balances_title')}</h2>
              <ManualHelpButton topicId="payroll.leave.balances" size={14} />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('payroll_leave_balances_hint')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">{t('payroll_year')}</label>
          <input type="number" step="1" className={cn(inputCls, 'w-24')} value={year} onChange={(e) => setYear(Number(e.target.value) || year)} />
          <button onClick={handleRecompute} disabled={recomputing} className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg border border-sky-300 dark:border-sky-700 text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-900/20 font-medium disabled:opacity-60">
            {recomputing ? <RefreshCw size={13} className="animate-spin" /> : <RotateCcw size={13} />}{t('payroll_leave_recompute')}
          </button>
          <button onClick={handleInit} disabled={initializing} className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-medium disabled:opacity-60">
            {initializing ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />}{t('payroll_leave_init')}
          </button>
        </div>
      </div>
      <p className="text-[11px] text-gray-400 -mt-1">{t('payroll_leave_recompute_hint')}</p>

      {loading ? (
        <div className="flex justify-center py-16"><RefreshCw size={20} className="animate-spin text-sky-500" /></div>
      ) : balances.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-gray-400 gap-2">
          <ClipboardCheck size={40} className="opacity-30" />
          <p className="text-sm">{t('payroll_leave_balances_empty')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 text-start">{t('payroll_employee_code')}</th>
                <th className="px-3 py-2 text-start">{t('payroll_employee_name')}</th>
                <th className="px-3 py-2 text-start">{t('payroll_leave_type')}</th>
                <th className="px-3 py-2 text-center">{t('payroll_leave_entitled')}</th>
                <th className="px-3 py-2 text-center">{t('payroll_leave_carried')}</th>
                <th className="px-3 py-2 text-center">{t('payroll_leave_used')}</th>
                <th className="px-3 py-2 text-center">{t('payroll_leave_remaining')}</th>
              </tr>
            </thead>
            <tbody>
              {balances.map((b) => {
                const remaining = Math.round((b.entitledDays + b.carriedDays - b.usedDays) * 100) / 100;
                return (
                  <tr key={b.id} className="border-t border-gray-100 dark:border-gray-800">
                    <td className="px-3 py-2 tabular-nums text-gray-500">{b.employeeCode}</td>
                    <td className="px-3 py-2 font-medium">{b.employeeName}</td>
                    <td className="px-3 py-2">{language === 'ar' ? b.leaveTypeNameAr : b.leaveTypeNameEn}</td>
                    <td className="px-3 py-2 text-center">{numCell(b, 'entitledDays')}</td>
                    <td className="px-3 py-2 text-center">{numCell(b, 'carriedDays')}</td>
                    <td className="px-3 py-2 text-center">{numCell(b, 'usedDays')}</td>
                    <td className={cn('px-3 py-2 text-center font-bold tabular-nums', remaining < 0 ? 'text-red-600' : 'text-green-600 dark:text-green-300')}>{remaining}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Attendance Preview Modal ───────────────────────────────────────────────────

interface AttendancePreviewModalProps {
  preview: AttendancePreviewRow[];
  onClose: () => void;
  onApply: () => void;
  applying: boolean;
}

function AttendancePreviewModal({ preview, onClose, onApply, applying }: AttendancePreviewModalProps) {
  const { t, formatMoney, language } = useLanguage();
  const unmatched = preview.filter((p) => !p.matched).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 className="font-semibold text-sm">{t('payroll_preview_attendance')}</h3>
          <button onClick={onClose} className="p-1 rounded text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        {unmatched > 0 && (
          <div className="mx-4 mt-3 px-3 py-2 text-xs rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200">
            {unmatched} {t('payroll_attendance_no_match')}
          </div>
        )}
        <div className="flex-1 overflow-auto p-4">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 sticky top-0">
              <tr>
                <th className="px-2 py-2 text-start">{language === 'ar' ? 'كود' : 'Code'}</th>
                <th className="px-2 py-2 text-start">{language === 'ar' ? 'الاسم' : 'Name'}</th>
                <th className="px-2 py-2 text-end">{t('payroll_days_present')}</th>
                <th className="px-2 py-2 text-end">{t('payroll_days_absent')}</th>
                <th className="px-2 py-2 text-end">{t('payroll_days_paid_leave')}</th>
                <th className="px-2 py-2 text-end">{t('payroll_late_mins')}</th>
                <th className="px-2 py-2 text-end">{t('payroll_overtime_hours')}</th>
                <th className="px-2 py-2 text-end">{language === 'ar' ? 'أساسي' : 'Basic'}</th>
                <th className="px-2 py-2 text-end">{language === 'ar' ? 'إضافي' : 'OT'}</th>
                <th className="px-2 py-2 text-end">{language === 'ar' ? 'أيام جزاء' : 'Pen. days'}</th>
                <th className="px-2 py-2 text-end">{language === 'ar' ? 'جزاءات' : 'Pen. EGP'}</th>
                <th className="px-2 py-2 text-end">{t('payroll_absence_amount')}</th>
                <th className="px-2 py-2 text-end">{t('payroll_late_amount')}</th>
                <th className="px-2 py-2 text-end">{language === 'ar' ? 'تأمينات' : 'Ins.'}</th>
                <th className="px-2 py-2 text-end">{language === 'ar' ? 'ضريبة' : 'Tax'}</th>
                <th className="px-2 py-2 text-end">{language === 'ar' ? 'صافي' : 'Net'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {preview.map((p) => (
                <tr key={p.employeeCode} className={!p.matched || p.basicSalary <= 0 ? 'bg-amber-50/50 dark:bg-amber-900/10' : undefined}>
                  <td className="px-2 py-1.5 font-mono">{p.employeeCode}</td>
                  <td className="px-2 py-1.5">
                    {p.employeeName}
                    {p.warning && <div className="text-[10px] text-amber-700 dark:text-amber-300">{p.warning}</div>}
                  </td>
                  <td className="px-2 py-1.5 text-end tabular-nums">{p.daysPresent}</td>
                  <td className="px-2 py-1.5 text-end tabular-nums text-red-600">{p.daysAbsent}</td>
                  <td className="px-2 py-1.5 text-end tabular-nums text-sky-600">{p.daysPaidLeave}</td>
                  <td className="px-2 py-1.5 text-end tabular-nums">{p.lateMinutes}</td>
                  <td className="px-2 py-1.5 text-end tabular-nums">{p.overtimeHours}</td>
                  <td className="px-2 py-1.5 text-end tabular-nums font-medium">{formatMoney(p.basicSalary)}</td>
                  <td className="px-2 py-1.5 text-end tabular-nums text-green-600">{formatMoney(p.overtime)}</td>
                  <td className="px-2 py-1.5 text-end tabular-nums">{p.penaltyDays ?? 0}</td>
                  <td className="px-2 py-1.5 text-end tabular-nums text-red-600">{formatMoney(p.penaltyDaysDeduction ?? 0)}</td>
                  <td className="px-2 py-1.5 text-end tabular-nums text-red-600">{formatMoney(p.absenceDeduction)}</td>
                  <td className="px-2 py-1.5 text-end tabular-nums text-red-600">{formatMoney(p.lateDeduction)}</td>
                  <td className="px-2 py-1.5 text-end tabular-nums text-sky-600">{formatMoney(p.socialInsurance)}</td>
                  <td className="px-2 py-1.5 text-end tabular-nums text-red-600">{formatMoney(p.incomeTax)}</td>
                  <td className="px-2 py-1.5 text-end tabular-nums font-medium">{formatMoney(p.netSalary)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600">{language === 'ar' ? 'إلغاء' : 'Cancel'}</button>
          <button onClick={onApply} disabled={applying || preview.length === 0} className="px-4 py-2 text-sm rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-medium disabled:opacity-60 flex items-center gap-2">
            {applying ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
            {t('payroll_apply_attendance')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Run Detail ──────────────────────────────────────────────────────────────

type EditableLine = PayrollLineInput & { _key: string };

interface RunDetailProps {
  runId: string;
  costCenters: CostCenterRow[];
  paymentAccounts: { code: string; name: string }[];
  onBack: () => void;
  onChanged: () => void;
  embedded?: boolean;
}

function RunDetail({ runId, costCenters, paymentAccounts, onBack, onChanged, embedded = false }: RunDetailProps) {
  const { language, t, formatMoney } = useLanguage();
  const [refreshKey, setRefreshKey] = useState(0);
  const { data: runRows, loading } = useApiQuery(() => payrollApi.getRun(runId).then((r) => [r]), [runId, refreshKey]);
  const { data: leaveTypes } = useApiQuery(() => leaveTypesApi.list(), []);
  const run = runRows[0];
  const [lines, setLines] = useState<EditableLine[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const [companyInfo, setCompanyInfo] = useState<CompanyPrintInfo>({
    companyName: '',
    companyNameEn: '',
    headerLogo: '',
  });

  useEffect(() => {
    void settingsApi
      .getCompanyInfo()
      .then((res) => {
        if (res.value) setCompanyInfo((prev) => ({ ...prev, ...res.value }));
      })
      .catch(() => {
        /* defaults */
      });
  }, []);

  const { openDocPreview, ReportPreviewHost } = useReportDocumentPreview({
    language: language as 'ar' | 'en',
    t,
    formatMoney,
    companyInfo,
  });
  // true when editLines differ from last server fetch (lines !== null)
  const hasDirtyLines = lines !== null;
  const attendanceFileRef = useRef<HTMLInputElement>(null);
  const [attendancePreview, setAttendancePreview] = useState<AttendancePreviewRow[] | null>(null);
  const [attendanceImportId, setAttendanceImportId] = useState<string | null>(null);
  const [attendanceParsedLines, setAttendanceParsedLines] = useState<AttendanceImportRow[] | null>(null);
  const [applyingAttendance, setApplyingAttendance] = useState(false);
  const [accruePreview, setAccruePreview] = useState<JournalPreviewResponse | null>(null);
  const [allocLine, setAllocLine] = useState<PayrollRunLine | null>(null);
  const [notifying, setNotifying] = useState(false);

  const isDraft = run?.status === 'draft';

  const costCenterLabel = useCallback((id: string) => {
    const cc = costCenters.find((c) => c.id === id);
    return cc ? `${cc.code} — ${cc.name}` : undefined;
  }, [costCenters]);

  // Initialize editable lines from server data (always refresh SI/tax display from gross)
  const initLines = useCallback((serverLines: PayrollRunLine[]): EditableLine[] =>
    serverLines.map((l, i) => withEgyptStatutory({
      _key: l.id || `row-${i}`,
      employeeId: l.employeeId,
      employeeCode: l.employeeCode,
      employeeName: l.employeeName,
      department: l.department,
      costCenterId: l.costCenterId,
      costCenterType: l.costCenterType,
      costCenterCode: l.costCenterCode,
      expenseAccountCode: l.expenseAccountCode,
      expenseAccountName: l.expenseAccountName,
      basicSalary: Number(l.basicSalary) || 0,
      overtime: Number(l.overtime) || 0,
      bonus: Number(l.bonus) || 0,
      incentiveKpi: Number(l.incentiveKpi) || 0,
      otherEarnings: Number(l.otherEarnings) || 0,
      socialInsurance: Number(l.socialInsurance) || 0,
      incomeTax: Number(l.incomeTax) || 0,
      advances: Number(l.advances) || 0,
      penalties: Number(l.penalties) || 0,
      otherDeductions: Number(l.otherDeductions) || 0,
      notes: l.notes,
    })), []);

  const editLines = lines ?? (run?.lines ? initLines(run.lines) : []);

  const updateCell = useCallback((key: string, field: keyof PayrollLineInput, value: string | number) => {
    setLines((prev) => {
      const base = prev ?? (run?.lines ? initLines(run.lines) : []);
      return base.map((l) => {
        if (l._key !== key) return l;
        return withEgyptStatutory({ ...l, [field]: value });
      });
    });
  }, [run, initLines]);

  const onCostCenterChange = useCallback((key: string, id: string) => {
    const cc = costCenters.find((c) => c.id === id);
    setLines((prev) => {
      const base = prev ?? (run?.lines ? initLines(run.lines) : []);
      return base.map((l) => (l._key === key ? {
        ...l,
        costCenterId: id || null,
        costCenterType: cc?.type ?? null,
        costCenterCode: cc?.code ?? null,
        expenseAccountCode: l.expenseAccountCode || (cc?.type === 'indirect' ? ADMIN_SALARY_CODE : DIRECT_LABOUR_CODE),
      } : l));
    });
  }, [costCenters, run, initLines]);

  const addRow = useCallback(() => {
    setLines((prev) => {
      const base = prev ?? (run?.lines ? initLines(run.lines) : []);
      return [...base, { _key: `new-${Date.now()}`, employeeCode: '', employeeName: '', basicSalary: 0 }];
    });
  }, [run, initLines]);

  const removeRow = useCallback((key: string) => {
    setLines((prev) => {
      const base = prev ?? (run?.lines ? initLines(run.lines) : []);
      return base.filter((l) => l._key !== key);
    });
  }, [run, initLines]);

  const handleSaveLines = useCallback(async () => {
    if (!run) return;
    setBusy(true);
    try {
      const payload: PayrollLineInput[] = editLines
        .filter((l) => l.employeeCode?.trim() || l.employeeName?.trim())
        .map(({ _key, ...rest }) => rest);
      await payrollApi.replaceLines(run.id, payload);
      toast.success(language === 'ar' ? 'تم حفظ بنود الكشف' : 'Sheet lines saved');
      setLines(null);
      setRefreshKey((k) => k + 1);
      onChanged();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setBusy(false);
    }
  }, [run, editLines, language, onChanged]);

  const handleAttendanceImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !run) return;
    setBusy(true);
    try {
      const rows = await parseAttendanceFile(file, leaveTypes);
      if (!rows.length) {
        toast.error(language === 'ar' ? 'الملف فارغ' : 'File is empty');
        return;
      }
      const hasMetrics = rows.some(
        (r) =>
          (r.daysPresent ?? 0) > 0
          || (r.daysAbsent ?? 0) > 0
          || (r.overtimeHours ?? 0) > 0
          || (r.directPenalties ?? 0) > 0
          || (r.lateMinutes ?? 0) > 0
          || (r.daysPaidLeave ?? 0) > 0,
      );
      if (!hasMetrics) {
        toast.error(
          language === 'ar'
            ? 'لم تُقرأ أرقام الحضور/الإضافي/الجزاءات من الملف — تحقق من الأعمدة أو أعد تنزيل قالب الأيام'
            : 'No attendance/OT/penalty numbers were read — check columns or re-download the days template',
        );
        return;
      }
      const imp = await attendanceApi.createImport({
        periodMonth: run.periodMonth,
        periodYear: run.periodYear,
        fileName: file.name,
        lines: rows,
      });
      setAttendanceImportId(imp.id);
      setAttendanceParsedLines(rows);
      const { preview } = await attendanceApi.previewAttendance(run.id, {
        importId: imp.id,
        lines: rows,
      });
      setAttendancePreview(preview);
      const unmatched = preview.filter((p) => !p.matched).length;
      const zeroBasic = preview.filter((p) => p.matched && p.basicSalary <= 0).length;
      if (unmatched > 0) {
        toast.error(
          language === 'ar'
            ? `${unmatched} كود غير موجود في سجل الموظفين — لن يُحسب الأساسي`
            : `${unmatched} code(s) not in employee master — basic salary will be zero`,
        );
      } else if (zeroBasic > 0) {
        toast.error(
          language === 'ar'
            ? `${zeroBasic} موظف بدون راتب أساسي في السجل — حدّث الراتب في بطاقة الموظف`
            : `${zeroBasic} employee(s) have zero basic salary on the master record`,
        );
      }
    } catch (err) {
      toast.error(String(err));
    } finally {
      setBusy(false);
      if (attendanceFileRef.current) attendanceFileRef.current.value = '';
    }
  }, [run, language, leaveTypes]);

  const handleApplyAttendance = useCallback(async () => {
    if (!run || !attendanceImportId) return;
    setApplyingAttendance(true);
    try {
      await attendanceApi.applyAttendance(run.id, {
        importId: attendanceImportId,
        lines: attendanceParsedLines ?? undefined,
      });
      toast.success(language === 'ar' ? 'تم تطبيق بيانات الحضور على الكشف' : 'Attendance applied to payroll sheet');
      setAttendancePreview(null);
      setAttendanceImportId(null);
      setAttendanceParsedLines(null);
      setLines(null);
      setRefreshKey((k) => k + 1);
      onChanged();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setApplyingAttendance(false);
    }
  }, [run, attendanceImportId, attendanceParsedLines, language, onChanged]);

  const handleAccrue = useCallback(async () => {
    if (!run) return;

    const missingCostCenters = editLines
      .filter((l) => l.employeeCode?.trim() || l.employeeName?.trim())
      .filter((l) => {
        if (String(l.costCenterId ?? '').trim()) return false;
        const serverLine = run.lines?.find((rl) => rl.id === l._key);
        return !(serverLine?.allocations ?? []).some((a) => String(a.costCenterId ?? '').trim());
      })
      .map((l) => l.employeeCode?.trim() || l.employeeName?.trim() || '?');
    if (missingCostCenters.length) {
      const list = missingCostCenters.slice(0, 12).join('، ');
      const more = missingCostCenters.length > 12 ? ` (+${missingCostCenters.length - 12})` : '';
      toast.error(
        language === 'ar'
          ? `لا يمكن إثبات الاستحقاق بدون اختيار مركز تكلفة لكل موظف. ناقص: ${list}${more}`
          : `Cannot accrue without a cost center on every line. Missing: ${list}${more}`,
      );
      return;
    }

    // Auto-save unsaved line edits BEFORE previewing the journal so the GL reflects
    // all entered values (deductions, overtime, KPI, etc.).
    if (hasDirtyLines) {
      const confirmSave = confirm(
        language === 'ar'
          ? 'يوجد تعديلات غير محفوظة. سيتم حفظها تلقائياً قبل معاينة القيد. متابعة؟'
          : 'There are unsaved edits. They will be saved automatically before previewing. Continue?',
      );
      if (!confirmSave) return;
      setBusy(true);
      try {
        const payload: PayrollLineInput[] = editLines
          .filter((l) => l.employeeCode?.trim() || l.employeeName?.trim())
          .map(({ _key, ...rest }) => rest);
        await payrollApi.replaceLines(run.id, payload);
        setLines(null);
        setRefreshKey((k) => k + 1);
        onChanged();
      } catch (err) {
        toast.error(language === 'ar' ? `فشل حفظ البنود: ${String(err)}` : `Failed to save lines: ${String(err)}`);
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    // Fetch the preview and let the user confirm before posting
    setBusy(true);
    try {
      const preview = await payrollApi.accruePreview(run.id);
      setAccruePreview(preview);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setBusy(false);
    }
  }, [run, hasDirtyLines, editLines, language, onChanged]);

  const handleConfirmAccrue = useCallback(async () => {
    if (!run) return;
    setBusy(true);
    try {
      await payrollApi.accrue(run.id);
      toast.success(language === 'ar' ? 'تم إثبات الاستحقاق وترحيل القيد' : 'Accrued & journal posted');
      setAccruePreview(null);
      setRefreshKey((k) => k + 1);
      onChanged();
    } catch (err) {
      if (err instanceof NetworkQueuedError) {
        setAccruePreview(null);
        return;
      }
      toast.error(String(err));
    } finally {
      setBusy(false);
    }
  }, [run, language, onChanged]);

  const handleNotifySalaries = useCallback(async () => {
    if (!run) return;
    setNotifying(true);
    try {
      const res = await payrollApi.notifySalaries(run.id, language);
      const base = language === 'ar'
        ? `تم جدولة ${res.queued} رسالة (تخطّي ${res.skipped})`
        : `Queued ${res.queued} message(s), skipped ${res.skipped}`;
      toast.success(res.dryRun ? `${base} — ${language === 'ar' ? 'وضع تجريبي' : 'dry-run'}` : base);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setNotifying(false);
    }
  }, [run, language]);

  const handleReopen = useCallback(async () => {
    if (!run) return;
    if (!confirm(language === 'ar' ? 'إعادة فتح الكشف وحذف القيود المرتبطة؟' : 'Reopen run and remove linked journals?')) return;
    setBusy(true);
    try {
      await payrollApi.reopen(run.id);
      toast.success(language === 'ar' ? 'تمت إعادة الفتح' : 'Run reopened');
      setLines(null);
      setRefreshKey((k) => k + 1);
      onChanged();
    } catch (err) {
      if (err instanceof NetworkQueuedError) return;
      toast.error(String(err));
    } finally {
      setBusy(false);
    }
  }, [run, language, onChanged]);

  const handleDeleteRun = useCallback(async () => {
    if (!run || run.status !== 'draft') return;
    if (!confirm(
      language === 'ar'
        ? `حذف كشف المسودة «${run.runNumber}» نهائيًا من القائمة؟`
        : `Delete draft sheet "${run.runNumber}" from the list?`,
    )) return;
    setBusy(true);
    try {
      await payrollApi.removeRun(run.id);
      toast.success(language === 'ar' ? 'تم حذف الكشف' : 'Payroll sheet deleted');
      onChanged();
      onBack();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setBusy(false);
    }
  }, [run, language, onChanged, onBack]);

  const handlePrint = useCallback(() => {
    if (!run) return;
    const isAr = language === 'ar';
    let gross = 0;
    let ded = 0;
    let net = 0;
    const rows = editLines.map((l) => {
      const g = lineGross(l);
      const d = lineDeductions(l);
      gross += g;
      ded += d;
      net += g - d;
      return {
        employee: `${l.employeeName}${l.employeeCode ? ` (${l.employeeCode})` : ''}`,
        costCenter: l.costCenterCode ?? '—',
        expenseAccount: l.expenseAccountCode ?? '—',
        basicSalary: Number(l.basicSalary) || 0,
        overtime: Number(l.overtime) || 0,
        bonus: Number(l.bonus) || 0,
        incentiveKpi: Number(l.incentiveKpi) || 0,
        socialInsurance: Number(l.socialInsurance) || 0,
        incomeTax: Number(l.incomeTax) || 0,
        advances: Number(l.advances) || 0,
        penalties: Number(l.penalties) || 0,
        gross: g,
        net: g - d,
      };
    });
    openDocPreview({
      reportId: 'payroll',
      title: isAr ? 'كشف رواتب' : 'Payroll Register',
      scopeLabel: run.periodLabel,
      columns: [
        { key: 'employee', header: isAr ? 'الموظف' : 'Employee', width: 16 },
        { key: 'costCenter', header: isAr ? 'مركز التكلفة' : 'Cost Center', width: 8 },
        { key: 'expenseAccount', header: isAr ? 'ح/ المصروف' : 'Expense', width: 8 },
        { key: 'basicSalary', header: isAr ? 'أساسي' : 'Basic', width: 8, money: true },
        { key: 'overtime', header: isAr ? 'إضافي' : 'OT', width: 7, money: true },
        { key: 'bonus', header: isAr ? 'مكافأة' : 'Bonus', width: 7, money: true },
        { key: 'incentiveKpi', header: isAr ? 'حافز' : 'KPI', width: 7, money: true },
        { key: 'socialInsurance', header: isAr ? 'تأمينات' : 'Ins.', width: 7, money: true },
        { key: 'incomeTax', header: isAr ? 'ضريبة' : 'Tax', width: 7, money: true },
        { key: 'advances', header: isAr ? 'سلف' : 'Adv.', width: 7, money: true },
        { key: 'penalties', header: isAr ? 'جزاءات' : 'Pen.', width: 7, money: true },
        { key: 'gross', header: isAr ? 'الإجمالي' : 'Gross', width: 8, money: true },
        { key: 'net', header: isAr ? 'الصافي' : 'Net', width: 8, money: true },
      ],
      rows,
      totals: {
        gross,
        net,
        basicSalary: rows.reduce((s, r) => s + r.basicSalary, 0),
        socialInsurance: rows.reduce((s, r) => s + r.socialInsurance, 0),
        incomeTax: rows.reduce((s, r) => s + r.incomeTax, 0),
        advances: rows.reduce((s, r) => s + r.advances, 0),
        penalties: rows.reduce((s, r) => s + r.penalties, 0),
      },
      totalsLabel: isAr ? 'الإجمالي' : 'Totals',
      footerNote: isAr
        ? `إجمالي الاستقطاعات: ${formatMoney(ded)}`
        : `Total deductions: ${formatMoney(ded)}`,
      filename: `payroll-${run.periodLabel}`,
    });
  }, [run, language, editLines, openDocPreview, formatMoney]);

  const handleExport = useCallback(() => {
    if (!run?.lines) return;
    exportPayrollRegister(run.periodLabel, run.lines, language as 'ar' | 'en');
  }, [run, language]);

  const totals = useMemo(() => {
    let gross = 0, ded = 0, net = 0;
    for (const l of editLines) { const g = lineGross(l); const d = lineDeductions(l); gross += g; ded += d; net += g - d; }
    return { gross, ded, net };
  }, [editLines]);

  if (loading || !run) {
    return <div className="flex justify-center py-16"><RefreshCw size={20} className="animate-spin text-sky-500" /></div>;
  }

  const numCell = 'w-20 border border-gray-200 dark:border-gray-700 rounded px-1.5 py-1 text-xs bg-white dark:bg-gray-800 text-end tabular-nums';

  return (
    <div className="space-y-3">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          {!embedded && (
            <button onClick={onBack} className="p-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800"><ChevronLeft size={16} /></button>
          )}
          <div>
            <div className="font-semibold text-sm flex items-center gap-2">
              {run.runNumber}
              <span className={cn('text-xs rounded-full px-2 py-0.5 font-medium', STATUS_COLORS[run.status])}>
                {run.status === 'draft' ? (language === 'ar' ? 'مسودة' : 'Draft') : run.status === 'accrued' ? (language === 'ar' ? 'مستحق' : 'Accrued') : (language === 'ar' ? 'مدفوع' : 'Paid')}
              </span>
            </div>
            <div className="text-xs text-gray-400">{run.periodLabel}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isDraft && (
            <>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const emps = await payrollApi.listEmployees({ status: 'active' });
                    downloadAttendanceTemplate(
                      language as 'ar' | 'en',
                      leaveTypes,
                      emps.map((e) => ({ employeeCode: e.employeeCode, employeeName: e.name })),
                    );
                  } catch (err) {
                    toast.error(String(err));
                  }
                }}
                className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-sky-400 text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-900/20"
                title={language === 'ar' ? 'يشمل أكواد وأسماء الموظفين النشطين · حضـور · إجازات · غياب · إضافي · جزاءات' : 'Pre-filled with active employees · present · leave · absence · OT · penalties'}
              >
                <Download size={13} />{language === 'ar' ? 'قالب الأيام' : 'Days template'}
              </button>
              <span className="inline-flex items-center gap-1">
                <label className={cn('flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border cursor-pointer', busy ? 'border-sky-300 bg-sky-50 text-sky-600' : 'border-sky-500 bg-sky-600 text-white hover:bg-sky-700')}>
                  <Upload size={13} />{language === 'ar' ? 'استيراد الأيام' : 'Import days'}
                  <input ref={attendanceFileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleAttendanceImport} />
                </label>
                <ManualHelpButton topicId="payroll.run.attendance" size={12} />
              </span>
              <button onClick={addRow} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"><Plus size={13} />{language === 'ar' ? 'صف' : 'Row'}</button>
              <button onClick={handleSaveLines} disabled={busy} className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg font-medium disabled:opacity-60 ${hasDirtyLines ? 'bg-blue-600 hover:bg-blue-700 text-white ring-2 ring-blue-400 ring-offset-1' : 'bg-gray-700 hover:bg-gray-800 text-white'}`}>
                <Check size={13} />
                {language === 'ar' ? 'حفظ البنود' : 'Save Lines'}
                {hasDirtyLines && <span className="w-2 h-2 rounded-full bg-yellow-300 inline-block ms-1" title={language === 'ar' ? 'يوجد تعديلات غير محفوظة' : 'Unsaved changes'} />}
              </button>
              <span className="inline-flex items-center gap-1">
                <button onClick={handleAccrue} disabled={busy || editLines.length === 0} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium disabled:opacity-60">
                  <ClipboardCheck size={13} />
                  {language === 'ar' ? 'إثبات الاستحقاق' : 'Accrue'}
                  {hasDirtyLines && <span className="text-yellow-200 text-xs ms-1">●</span>}
                </button>
                <ManualHelpButton topicId="payroll.run.accrue" size={12} />
              </span>
              <button
                type="button"
                onClick={handleDeleteRun}
                disabled={busy}
                className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-60"
                title={language === 'ar' ? 'حذف المسودة' : 'Delete draft'}
              >
                <Trash2 size={13} />
                {language === 'ar' ? 'حذف' : 'Delete'}
              </button>
            </>
          )}
          {run.status === 'accrued' && (
            <>
              <span className="inline-flex items-center gap-1">
                <button onClick={() => setShowPay(true)} disabled={busy} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-green-600 hover:bg-green-700 text-white font-medium disabled:opacity-60"><Wallet size={13} />{language === 'ar' ? 'سداد الأجور' : 'Pay'}</button>
                <ManualHelpButton topicId="payroll.run.pay_reopen" size={12} />
              </span>
              <button onClick={handleReopen} disabled={busy} className="px-3 py-1.5 text-xs rounded-lg border border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">{language === 'ar' ? 'إعادة فتح' : 'Reopen'}</button>
            </>
          )}
          {(run.status === 'accrued' || run.status === 'paid') && (
            <span className="inline-flex items-center gap-1">
              <button onClick={handleNotifySalaries} disabled={notifying} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-emerald-400 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-60">
                {notifying ? <RefreshCw size={13} className="animate-spin" /> : <Info size={13} />}
                {language === 'ar' ? 'إرسال إشعارات الرواتب' : 'Notify Salaries'}
              </button>
              <ManualHelpButton topicId="payroll.run.whatsapp" size={12} />
            </span>
          )}
          <button onClick={handleExport} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"><Download size={13} />{language === 'ar' ? 'تصدير' : 'Export'}</button>
          <button onClick={handlePrint} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"><Printer size={13} />{language === 'ar' ? 'طباعة' : 'Print'}</button>
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 rounded-lg bg-sky-50 dark:bg-sky-900/20 text-center"><div className="text-xs text-gray-500">{language === 'ar' ? 'إجمالي الأجور' : 'Gross'}</div><div className="font-bold text-sky-700 dark:text-sky-300 tabular-nums">{formatMoney(totals.gross)}</div></div>
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-center"><div className="text-xs text-gray-500">{language === 'ar' ? 'إجمالي الخصومات' : 'Deductions'}</div><div className="font-bold text-red-600 dark:text-red-300 tabular-nums">{formatMoney(totals.ded)}</div></div>
        <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 text-center"><div className="text-xs text-gray-500">{language === 'ar' ? 'صافي المستحق' : 'Net'}</div><div className="font-bold text-green-600 dark:text-green-300 tabular-nums">{formatMoney(totals.net)}</div></div>
      </div>

      {isDraft && (
        <div className="rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50/80 dark:bg-sky-950/30 px-3 py-2 text-xs text-sky-900 dark:text-sky-200 flex gap-2 items-start">
          <Info size={14} className="shrink-0 mt-0.5" />
          <div>
            {language === 'ar'
              ? 'استورد كشف الأيام (حضور/إجازات/غياب/إضافي/أيام جزاءات) ثم عدّل يدوياً: المكافأة · الحافز · السلف. أيام الجزاءات تُحوَّل لمبلغ = أيام × أجر اليوم. التأمينات والضريبة تلقائية. غياب بدون إذن وتأخير يُضافان أيضاً إلى عمود الجزاءات في الكشف.'
              : 'Import the days sheet (attendance / leave / absence / OT / penalty days), then edit bonus · KPI · advances. Penalty days convert to money = days × daily rate. SI/tax are automatic. Unauthorized absence and lateness also add into the sheet Penalties column.'}
          </div>
        </div>
      )}

      {/* Lines table */}
      <div className="report-print-area overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500">
            <tr>
              <th className="px-2 py-2 text-start">{language === 'ar' ? 'الموظف' : 'Employee'}</th>
              <th className="px-2 py-2 text-start">{language === 'ar' ? 'مركز التكلفة' : 'Cost Center'}</th>
              <th className="px-2 py-2 text-start">{language === 'ar' ? 'ح/ المصروف' : 'Expense'}</th>
              <th className="px-2 py-2 text-end" title={language === 'ar' ? 'من سجل الموظف' : 'From employee master'}>{language === 'ar' ? 'أساسي' : 'Basic'}</th>
              <th className="px-2 py-2 text-end" title={language === 'ar' ? 'من استيراد الأيام' : 'From days import'}>{language === 'ar' ? 'إضافي' : 'OT'}</th>
              <th className="px-2 py-2 text-end text-sky-700 dark:text-sky-300">{language === 'ar' ? 'مكافأة ✎' : 'Bonus ✎'}</th>
              <th className="px-2 py-2 text-end text-sky-700 dark:text-sky-300">{language === 'ar' ? 'حافز ✎' : 'KPI ✎'}</th>
              <th className="px-2 py-2 text-end" title={language === 'ar' ? 'تلقائي' : 'Auto'}>{language === 'ar' ? 'تأمينات' : 'Ins.'}</th>
              <th className="px-2 py-2 text-end" title={language === 'ar' ? 'تلقائي' : 'Auto'}>{language === 'ar' ? 'ضريبة' : 'Tax'}</th>
              <th className="px-2 py-2 text-end text-sky-700 dark:text-sky-300">{language === 'ar' ? 'سلف ✎' : 'Adv. ✎'}</th>
              <th className="px-2 py-2 text-end" title={language === 'ar' ? 'من استيراد الأيام' : 'From days import'}>{language === 'ar' ? 'جزاءات' : 'Pen.'}</th>
              <th className="px-2 py-2 text-end">{language === 'ar' ? 'الإجمالي' : 'Gross'}</th>
              <th className="px-2 py-2 text-end">{language === 'ar' ? 'الصافي' : 'Net'}</th>
              {isDraft && (
                <th className="px-2 py-2 print:hidden">
                  <span className="inline-flex items-center gap-1">
                    {language === 'ar' ? 'إجراءات' : 'Actions'}
                    <ManualHelpButton topicId="payroll.run.cost_split" size={12} />
                  </span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {editLines.map((l) => {
              const g = lineGross(l); const net = g - lineDeductions(l);
              // Column order: basic, OT, bonus, KPI, SI, tax, advances, penalties
              const orderedFields: (keyof PayrollLineInput)[] = [
                'basicSalary', 'overtime', 'bonus', 'incentiveKpi',
                'socialInsurance', 'incomeTax', 'advances', 'penalties',
              ];
              const isManualField = (f: string) => (MANUAL_MONEY_FIELDS as readonly string[]).includes(f);
              const isReadOnlyMoney = (f: string) =>
                (IMPORT_DRIVEN_FIELDS as readonly string[]).includes(f)
                || (AUTO_STATUTORY_FIELDS as readonly string[]).includes(f);
              return (
                <tr key={l._key} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                  <td className="px-2 py-1.5">
                    {isDraft ? (
                      <div className="flex flex-col gap-1">
                        <input className="w-28 border border-gray-200 dark:border-gray-700 rounded px-1.5 py-1 text-xs bg-white dark:bg-gray-800 font-mono" placeholder={language === 'ar' ? 'كود' : 'code'} value={l.employeeCode} onChange={(e) => updateCell(l._key, 'employeeCode', e.target.value)} />
                        <input className="w-32 border border-gray-200 dark:border-gray-700 rounded px-1.5 py-1 text-xs bg-white dark:bg-gray-800" placeholder={language === 'ar' ? 'الاسم' : 'name'} value={l.employeeName} onChange={(e) => updateCell(l._key, 'employeeName', e.target.value)} />
                      </div>
                    ) : (
                      <div><div className="font-medium text-gray-900 dark:text-gray-100">{l.employeeName}</div><div className="text-gray-400 font-mono">{l.employeeCode}</div></div>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {isDraft ? (
                      <select className="w-32 border border-gray-200 dark:border-gray-700 rounded px-1 py-1 text-xs bg-white dark:bg-gray-800" value={l.costCenterId ?? ''} onChange={(e) => onCostCenterChange(l._key, e.target.value)}>
                        <option value="">{language === 'ar' ? '— عام —' : '— None —'}</option>
                        {costCenters.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
                      </select>
                    ) : (<span className="text-gray-500">{l.costCenterCode ?? '—'}</span>)}
                  </td>
                  <td className="px-2 py-1.5">
                    {isDraft ? (
                      <input className="w-24 border border-gray-200 dark:border-gray-700 rounded px-1.5 py-1 text-xs bg-white dark:bg-gray-800 font-mono" value={l.expenseAccountCode ?? ''} onChange={(e) => updateCell(l._key, 'expenseAccountCode', e.target.value)} />
                    ) : (<span className="font-mono text-gray-500">{l.expenseAccountCode}</span>)}
                  </td>
                  {orderedFields.map((f) => (
                    <td key={f} className="px-1 py-1.5 text-end">
                      {isDraft ? (
                        isReadOnlyMoney(f) ? (
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            disabled
                            readOnly
                            className={cn(numCell, 'opacity-70 bg-gray-50 dark:bg-gray-900 cursor-not-allowed')}
                            value={(l[f] as number) ?? 0}
                            title={
                              (AUTO_STATUTORY_FIELDS as readonly string[]).includes(f)
                                ? (language === 'ar' ? 'محسوب تلقائياً' : 'Calculated automatically')
                                : (language === 'ar' ? 'من الاستيراد / سجل الموظف' : 'From import / employee master')
                            }
                          />
                        ) : (
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            className={cn(numCell, isManualField(f) && 'border-sky-300 dark:border-sky-700')}
                            value={(l[f] as number) ?? 0}
                            onChange={(e) => updateCell(l._key, f, e.target.value === '' ? 0 : Number(e.target.value))}
                          />
                        )
                      ) : (<span className="tabular-nums">{formatMoney(Number(l[f]) || 0)}</span>)}
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-end tabular-nums font-medium">{formatMoney(g)}</td>
                  <td className="px-2 py-1.5 text-end tabular-nums font-medium text-green-600 dark:text-green-300">{formatMoney(net)}</td>
                  {isDraft && (
                    <td className="px-2 py-1.5 print:hidden">
                      <div className="flex items-center gap-1">
                        {(() => {
                          const serverLine = run.lines?.find((rl) => rl.id === l._key);
                          if (!serverLine) return null;
                          const hasSplit = (serverLine.allocations?.length ?? 0) > 0;
                          return (
                            <button
                              onClick={() => setAllocLine(serverLine)}
                              title={language === 'ar' ? 'توزيع مراكز التكلفة' : 'Cost-center split'}
                              className={cn('p-1 rounded hover:bg-sky-50 dark:hover:bg-sky-900/20', hasSplit ? 'text-sky-600' : 'text-gray-400 hover:text-sky-600')}
                            >
                              <Briefcase size={13} />
                            </button>
                          );
                        })()}
                        <button onClick={() => removeRow(l._key)} className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
            {editLines.length === 0 && (
              <tr><td colSpan={isDraft ? 14 : 13} className="px-3 py-8 text-center text-gray-400">{language === 'ar' ? 'لا توجد بنود — املأ من الموظفين أو استورد كشف الأيام' : 'No lines — fill from employees or import the days sheet'}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showPay && <PayModal run={run} paymentAccounts={paymentAccounts} onClose={() => setShowPay(false)} onPaid={() => { setShowPay(false); setRefreshKey((k) => k + 1); onChanged(); }} />}
      {attendancePreview && (
        <AttendancePreviewModal
          preview={attendancePreview}
          onClose={() => { setAttendancePreview(null); setAttendanceImportId(null); setAttendanceParsedLines(null); }}
          onApply={handleApplyAttendance}
          applying={applyingAttendance}
        />
      )}
      <JournalPreviewModal
        open={accruePreview !== null}
        title={language === 'ar' ? 'معاينة قيد استحقاق الرواتب' : 'Payroll Accrual Preview'}
        reference={accruePreview?.reference}
        description={accruePreview?.description}
        entries={accruePreview?.entries ?? []}
        resolveCostCenter={costCenterLabel}
        busy={busy}
        onConfirm={handleConfirmAccrue}
        onClose={() => setAccruePreview(null)}
      />
      {allocLine && (
        <RunLineAllocationModal
          line={allocLine}
          costCenters={costCenters}
          onClose={() => setAllocLine(null)}
          onSaved={() => { setAllocLine(null); setRefreshKey((k) => k + 1); onChanged(); }}
        />
      )}
      {ReportPreviewHost}
    </div>
  );
}

// ─── Run-line cost-center split modal (monthly) ─────────────────────────────────

interface RunLineAllocationModalProps {
  line: PayrollRunLine;
  costCenters: CostCenterRow[];
  onClose: () => void;
  onSaved: () => void;
}

function RunLineAllocationModal({ line, costCenters, onClose, onSaved }: RunLineAllocationModalProps) {
  const { language, formatMoney } = useLanguage();
  const [rows, setRows] = useState<AllocRow[]>(() =>
    (line.allocations ?? []).map((a) => ({
      costCenterId: a.costCenterId,
      costCenterType: a.costCenterType,
      expenseAccountCode: a.expenseAccountCode ?? '',
      percentage: String(a.percentage),
    })),
  );
  const [saving, setSaving] = useState(false);

  const add = useCallback(() => setRows((r) => [...r, { costCenterId: '', costCenterType: null, expenseAccountCode: '', percentage: '' }]), []);
  const remove = useCallback((idx: number) => setRows((r) => r.filter((_, i) => i !== idx)), []);
  const update = useCallback((idx: number, patch: Partial<AllocRow>) => {
    setRows((r) => r.map((row, i) => {
      if (i !== idx) return row;
      const next = { ...row, ...patch };
      if (patch.costCenterId !== undefined) {
        const cc = costCenters.find((c) => c.id === patch.costCenterId);
        next.costCenterType = cc?.type ?? null;
        if (!next.expenseAccountCode) next.expenseAccountCode = cc?.type === 'indirect' ? ADMIN_SALARY_CODE : DIRECT_LABOUR_CODE;
      }
      return next;
    }));
  }, [costCenters]);

  const total = useMemo(() => rows.reduce((s, r) => s + (Number(r.percentage) || 0), 0), [rows]);
  const valid = rows.length === 0 || Math.abs(total - 100) < 0.01;
  const gross = Number(line.grossSalary) || 0;

  const handleSave = useCallback(async () => {
    const clean = rows.filter((r) => r.costCenterId && Number(r.percentage) > 0);
    if (clean.length && Math.abs(clean.reduce((s, r) => s + Number(r.percentage), 0) - 100) > 0.01) {
      toast.error(language === 'ar' ? 'مجموع النسب يجب أن يساوي 100%' : 'Percentages must total 100%');
      return;
    }
    setSaving(true);
    try {
      await payrollApi.setRunLineAllocations(line.id, clean.map((r) => ({
        costCenterId: r.costCenterId,
        costCenterType: r.costCenterType,
        expenseAccountCode: r.expenseAccountCode.trim() || (line.expenseAccountCode || ADMIN_SALARY_CODE),
        expenseAccountName: costCenters.find((c) => c.id === r.costCenterId)?.name ?? null,
        percentage: Number(r.percentage),
      })));
      toast.success(language === 'ar' ? 'تم حفظ التوزيع' : 'Allocation saved');
      onSaved();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSaving(false);
    }
  }, [rows, line, costCenters, language, onSaved]);

  const inputCls = 'border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-base font-semibold">{language === 'ar' ? 'توزيع مراكز التكلفة (الشهر)' : 'Cost-center split (month)'}</h2>
            <div className="text-xs text-gray-400 flex items-center gap-1">
              {line.employeeName} — {language === 'ar' ? 'الإجمالي' : 'Gross'}: {formatMoney(gross)}
              <ManualHelpButton topicId="payroll.run.cost_split" size={12} />
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={18} /></button>
        </div>
        <div className="p-4 space-y-2">
          <p className="text-[11px] text-gray-400">{language === 'ar' ? 'اتركه فارغاً لاستخدام مركز التكلفة الواحد للسطر. عند التعبئة يجب أن يساوي المجموع 100%.' : 'Leave empty to keep the single line cost center. When used, the total must equal 100%.'}</p>
          {rows.map((row, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <select className={cn(inputCls, 'flex-1')} value={row.costCenterId} onChange={(e) => update(idx, { costCenterId: e.target.value })}>
                <option value="">{language === 'ar' ? '— اختر —' : '— Select —'}</option>
                {costCenters.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
              <input className={cn(inputCls, 'w-24 font-mono')} placeholder={language === 'ar' ? 'حساب' : 'Acct'} value={row.expenseAccountCode} onChange={(e) => update(idx, { expenseAccountCode: e.target.value })} />
              <input type="number" step="0.01" min="0" max="100" className={cn(inputCls, 'w-20')} placeholder="%" value={row.percentage} onChange={(e) => update(idx, { percentage: e.target.value })} />
              <span className="w-24 text-end text-xs tabular-nums text-gray-500">{formatMoney(Math.round(gross * (Number(row.percentage) || 0) / 100))}</span>
              <button type="button" onClick={() => remove(idx)} className="text-red-500 hover:text-red-700 p-1"><Trash2 size={14} /></button>
            </div>
          ))}
          <button type="button" onClick={add} className="text-xs px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 inline-flex items-center gap-1"><Plus size={12} />{language === 'ar' ? 'إضافة مركز' : 'Add center'}</button>
          {rows.length > 0 && (
            <div className={cn('text-xs font-medium', valid ? 'text-green-600' : 'text-red-600')}>{language === 'ar' ? 'المجموع' : 'Total'}: {total.toFixed(2)}%</div>
          )}
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-700">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">{language === 'ar' ? 'إلغاء' : 'Cancel'}</button>
          <button onClick={handleSave} disabled={saving || !valid} className="px-4 py-2 text-sm rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-medium disabled:opacity-60 inline-flex items-center gap-1">
            {saving ? <RefreshCw size={14} className="animate-spin" /> : null}
            {language === 'ar' ? 'حفظ' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const isPayrollTab = (v: string): v is Tab => v === 'runs' || v === 'employees' || v === 'leave' || v === 'settings';

function EmployeeDetailPanel({
  employee,
  costCenters,
  language,
  theme,
  formatMoney,
  onEdit,
  onDelete,
}: {
  employee: PayrollEmployee;
  costCenters: CostCenterRow[];
  language: string;
  theme: Theme;
  formatMoney: (n: number) => string;
  onEdit: (emp: PayrollEmployee) => void;
  onDelete: (emp: PayrollEmployee) => void;
}) {
  const ar = language === 'ar';
  const cc = costCenters.find((c) => c.id === employee.defaultCostCenterId);
  const fields: { label: string; value: string }[] = [
    { label: ar ? 'الاسم (EN)' : 'Name (EN)', value: employee.nameEn || '—' },
    { label: ar ? 'الإدارة' : 'Department', value: employee.department || '—' },
    { label: ar ? 'المسمى الوظيفي' : 'Job title', value: employee.jobTitle || '—' },
    { label: ar ? 'مركز التكلفة' : 'Cost center', value: cc ? `${cc.code} — ${cc.name}` : '—' },
    { label: ar ? 'ح/ المصروف' : 'Expense account', value: employee.defaultExpenseAccountCode || '—' },
    { label: ar ? 'الراتب الأساسي' : 'Basic salary', value: formatMoney(employee.basicSalary) },
    { label: ar ? 'تاريخ التعيين' : 'Hire date', value: employee.hireDate || '—' },
    { label: ar ? 'تاريخ الميلاد' : 'Birth date', value: employee.birthDate || '—' },
    { label: ar ? 'تأمين سابق (شهر)' : 'Prior insurance (mo.)', value: employee.priorInsuranceMonths != null ? String(employee.priorInsuranceMonths) : '—' },
    { label: ar ? 'الهاتف' : 'Phone', value: employee.phoneE164 || '—' },
    { label: ar ? 'واتساب' : 'WhatsApp', value: employee.whatsappOptIn ? (ar ? 'نعم' : 'Yes') : (ar ? 'لا' : 'No') },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="font-mono text-xs font-bold text-blue-600">{employee.employeeCode}</p>
          <h2 className={cn('text-lg font-bold mt-0.5', theme === 'dark' ? 'text-gray-100' : 'text-gray-900')}>{employee.name}</h2>
          <span className={cn('inline-block mt-2 text-xs rounded-full px-2 py-0.5 font-medium', employee.status === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700')}>
            {employee.status === 'active' ? (ar ? 'نشط' : 'Active') : (ar ? 'غير نشط' : 'Inactive')}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => onEdit(employee)} className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20" title={ar ? 'تعديل' : 'Edit'}>
            <Edit2 size={16} />
          </button>
          <button type="button" onClick={() => onDelete(employee)} className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" title={ar ? 'حذف' : 'Delete'}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      <div className={cn('rounded-xl border p-4 grid sm:grid-cols-2 gap-x-6 gap-y-3', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
        {fields.map((f) => (
          <div key={f.label}>
            <p className={splitLabelCls(theme)}>{f.label}</p>
            <p className={cn('text-sm font-medium', theme === 'dark' ? 'text-gray-200' : 'text-gray-800')}>{f.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function RunsSplitView({
  runs,
  loading,
  selectedRunId,
  onSelectRun,
  onNewRun,
  costCenters,
  paymentAccounts,
  onChanged,
  language,
  theme,
  dir,
  t,
  formatMoney,
}: {
  runs: PayrollRun[];
  loading: boolean;
  selectedRunId: string | null;
  onSelectRun: (id: string | null) => void;
  onNewRun: () => void;
  costCenters: CostCenterRow[];
  paymentAccounts: { code: string; name: string }[];
  onChanged: () => void;
  language: string;
  theme: Theme;
  dir: string;
  t: (key: string) => string;
  formatMoney: (n: number) => string;
}) {
  const ar = language === 'ar';
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'accrued' | 'paid'>('all');
  const [search, setSearch] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filteredRuns = useMemo(() => {
    let rows = runs;
    if (statusFilter !== 'all') rows = rows.filter((r) => r.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.runNumber.toLowerCase().includes(q) || r.periodLabel.toLowerCase().includes(q));
  }, [runs, statusFilter, search]);

  const handleDeleteDraft = useCallback(async (r: PayrollRun, e: React.MouseEvent) => {
    e.stopPropagation();
    if (r.status !== 'draft') return;
    if (!confirm(
      ar
        ? `حذف كشف المسودة «${r.runNumber}» نهائيًا من القائمة؟`
        : `Delete draft sheet "${r.runNumber}" from the list?`,
    )) return;
    setDeletingId(r.id);
    try {
      await payrollApi.removeRun(r.id);
      toast.success(ar ? 'تم حذف الكشف' : 'Payroll sheet deleted');
      if (selectedRunId === r.id) onSelectRun(null);
      onChanged();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setDeletingId(null);
    }
  }, [ar, selectedRunId, onSelectRun, onChanged]);

  return (
    <div className={splitRowCls(dir)}>
      <div className={splitMainCls()}>
        {selectedRunId ? (
          <RunDetail
            embedded
            runId={selectedRunId}
            costCenters={costCenters}
            paymentAccounts={paymentAccounts}
            onBack={() => onSelectRun(null)}
            onChanged={onChanged}
          />
        ) : loading ? (
          <div className="flex justify-center py-16"><RefreshCw size={20} className="animate-spin text-blue-500" /></div>
        ) : filteredRuns.length === 0 ? (
          <div className={splitEmptyPaneCls(theme)}>
            <FileText className="w-14 h-14 mx-auto mb-3 opacity-25" />
            <p className="text-sm text-gray-500">{t('payroll_filter_empty')}</p>
          </div>
        ) : (
          <div className={splitEmptyPaneCls(theme)}>
            <p className="text-sm text-gray-500">{t('payroll_filter_select_record')}</p>
          </div>
        )}
      </div>

      <aside className={splitSidebarCls(theme)}>
        <div>
          <h3 className="font-bold text-sm">{t('payroll_filter_title')}</h3>
        </div>
        <div className="space-y-3">
          <div>
            <label className={splitLabelCls(theme)}>{t('payroll_filter_status')}</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className={splitSelectCls(theme)}>
              <option value="all">{ar ? `الكل (${runs.length})` : `All (${runs.length})`}</option>
              <option value="draft">{ar ? 'مسودة' : 'Draft'}</option>
              <option value="accrued">{ar ? 'مستحق' : 'Accrued'}</option>
              <option value="paid">{ar ? 'مدفوع' : 'Paid'}</option>
            </select>
          </div>
          <div>
            <label className={splitLabelCls(theme)}>{t('payroll_filter_search')}</label>
            <div className="relative">
              <Search className={cn('absolute top-2.5 w-4 h-4 opacity-50', ar ? 'right-3' : 'left-3')} />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('payroll_filter_search_placeholder')}
                className={cn(splitSelectCls(theme), ar ? 'pr-9' : 'pl-9', 'font-normal')}
              />
            </div>
          </div>
        </div>
        <div className={cn('pt-3 border-t space-y-2', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
          <p className={splitSectionTitleCls()}>{t('payroll_filter_list')}</p>
          {loading ? (
            <RefreshCw size={18} className="animate-spin mx-auto text-blue-500" />
          ) : filteredRuns.length === 0 ? (
            <p className="text-xs text-gray-500">{t('payroll_filter_empty')}</p>
          ) : (
            <ul className="space-y-1 max-h-64 overflow-auto">
              {filteredRuns.map((r) => (
                <li key={r.id} className="relative group">
                  <button type="button" onClick={() => onSelectRun(r.id)} className={cn(splitActiveListBtn(selectedRunId === r.id, theme), r.status === 'draft' && 'pe-8')}>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0 leading-tight">
                      <span className="font-bold shrink-0">{r.runNumber}</span>
                      <span className="text-xs opacity-80">{r.periodLabel}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-1 text-[10px] opacity-80">
                      <span>{runStatusLabel(r.status, ar)}</span>
                      <span className="tabular-nums font-semibold">{formatMoney(r.totalNet)}</span>
                    </div>
                  </button>
                  {r.status === 'draft' && (
                    <button
                      type="button"
                      onClick={(e) => handleDeleteDraft(r, e)}
                      disabled={deletingId === r.id}
                      className={cn(
                        'absolute top-1/2 -translate-y-1/2 p-1.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50',
                        ar ? 'left-1.5' : 'right-1.5',
                      )}
                      title={ar ? 'حذف المسودة' : 'Delete draft'}
                    >
                      {deletingId === r.id ? <RefreshCw size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={cn('pt-3 border-t space-y-2', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
          <button type="button" onClick={onNewRun} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
            <Plus size={16} />
            {ar ? 'كشف رواتب جديد' : 'New payroll sheet'}
          </button>
          <ManualHelpButton topicId="payroll.run.create_edit" size={16} />
        </div>
      </aside>
    </div>
  );
}

function EmployeesSplitView({
  employees,
  loading,
  selectedEmployeeId,
  onSelectEmployee,
  onNewEmployee,
  onEditEmployee,
  onDeleteEmployee,
  onImportClick,
  importingEmp,
  onTemplateDownload,
  costCenters,
  language,
  theme,
  dir,
  t,
  formatMoney,
}: {
  employees: PayrollEmployee[];
  loading: boolean;
  selectedEmployeeId: string | null;
  onSelectEmployee: (id: string | null) => void;
  onNewEmployee: () => void;
  onEditEmployee: (emp: PayrollEmployee) => void;
  onDeleteEmployee: (emp: PayrollEmployee) => void;
  onImportClick: () => void;
  importingEmp: boolean;
  onTemplateDownload: () => void;
  costCenters: CostCenterRow[];
  language: string;
  theme: Theme;
  dir: string;
  t: (key: string) => string;
  formatMoney: (n: number) => string;
}) {
  const ar = language === 'ar';
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [search, setSearch] = useState('');

  const filteredEmployees = useMemo(() => {
    let rows = employees;
    if (statusFilter !== 'all') rows = rows.filter((e) => e.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((e) =>
      e.employeeCode.toLowerCase().includes(q) ||
      e.name.toLowerCase().includes(q) ||
      (e.department ?? '').toLowerCase().includes(q),
    );
  }, [employees, statusFilter, search]);

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === selectedEmployeeId) ?? null,
    [employees, selectedEmployeeId],
  );

  return (
    <div className={splitRowCls(dir)}>
      <div className={splitMainCls()}>
        {loading ? (
          <div className="flex justify-center py-16"><RefreshCw size={20} className="animate-spin text-blue-500" /></div>
        ) : selectedEmployee ? (
          <EmployeeDetailPanel
            employee={selectedEmployee}
            costCenters={costCenters}
            language={language}
            theme={theme}
            formatMoney={formatMoney}
            onEdit={onEditEmployee}
            onDelete={onDeleteEmployee}
          />
        ) : filteredEmployees.length === 0 ? (
          <div className={splitEmptyPaneCls(theme)}>
            <Users className="w-14 h-14 mx-auto mb-3 opacity-25" />
            <p className="text-sm text-gray-500">{t('payroll_filter_empty')}</p>
          </div>
        ) : (
          <div className={splitEmptyPaneCls(theme)}>
            <p className="text-sm text-gray-500">{t('payroll_filter_select_record')}</p>
          </div>
        )}
      </div>

      <aside className={splitSidebarCls(theme)}>
        <div>
          <h3 className="font-bold text-sm">{t('payroll_filter_title')}</h3>
        </div>
        <div className="space-y-3">
          <div>
            <label className={splitLabelCls(theme)}>{t('payroll_filter_status')}</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className={splitSelectCls(theme)}>
              <option value="all">{ar ? `الكل (${employees.length})` : `All (${employees.length})`}</option>
              <option value="active">{ar ? 'نشط' : 'Active'}</option>
              <option value="inactive">{ar ? 'غير نشط' : 'Inactive'}</option>
            </select>
          </div>
          <div>
            <label className={splitLabelCls(theme)}>{t('payroll_filter_search')}</label>
            <div className="relative">
              <Search className={cn('absolute top-2.5 w-4 h-4 opacity-50', ar ? 'right-3' : 'left-3')} />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('payroll_filter_search_placeholder')}
                className={cn(splitSelectCls(theme), ar ? 'pr-9' : 'pl-9', 'font-normal')}
              />
            </div>
          </div>
        </div>
        <div className={cn('pt-3 border-t space-y-2', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
          <p className={splitSectionTitleCls()}>{t('payroll_filter_list')}</p>
          {loading ? (
            <RefreshCw size={18} className="animate-spin mx-auto text-blue-500" />
          ) : filteredEmployees.length === 0 ? (
            <p className="text-xs text-gray-500">{t('payroll_filter_empty')}</p>
          ) : (
            <ul className="space-y-1 max-h-64 overflow-auto">
              {filteredEmployees.map((emp) => (
                <li key={emp.id}>
                  <button type="button" onClick={() => onSelectEmployee(emp.id)} className={splitActiveListBtn(selectedEmployeeId === emp.id, theme)}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold truncate">{emp.name}</span>
                      <span className="text-[10px] font-mono opacity-80 shrink-0">{emp.employeeCode}</span>
                    </div>
                    <p className="text-[10px] opacity-75 mt-0.5 truncate">{emp.department || '—'} · {formatMoney(emp.basicSalary)}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={cn('pt-3 border-t space-y-2', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
          <button type="button" onClick={onTemplateDownload} className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            <Download size={14} />
            {ar ? 'تنزيل القالب' : 'Download template'}
          </button>
          <button type="button" onClick={onImportClick} disabled={importingEmp} className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors">
            {importingEmp ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
            {ar ? 'استيراد Excel' : 'Import Excel'}
          </button>
          <button type="button" onClick={onNewEmployee} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
            <Plus size={16} />
            {ar ? 'موظف جديد' : 'New employee'}
          </button>
          <div className="flex items-center gap-2">
            <ManualHelpButton topicId="payroll.employee.master" size={16} />
            <ManualHelpButton topicId="payroll.employee.import" size={16} />
          </div>
        </div>
      </aside>
    </div>
  );
}

type SettingsSection = 'attendance_rules' | 'holidays' | 'leave_types';

function SettingsSplitView({
  theme,
  dir,
  t,
}: {
  theme: Theme;
  dir: string;
  t: (key: string) => string;
}) {
  const [section, setSection] = useState<SettingsSection>('attendance_rules');

  const navItems: { id: SettingsSection; labelKey: string; icon: React.ReactNode; hintKey: string }[] = [
    { id: 'attendance_rules', labelKey: 'payroll_settings_nav_rules', icon: <Settings2 size={16} />, hintKey: 'payroll_rules_subtitle' },
    { id: 'holidays', labelKey: 'payroll_settings_nav_holidays', icon: <CalendarX size={16} />, hintKey: 'payroll_holidays_hint' },
    { id: 'leave_types', labelKey: 'payroll_settings_nav_leave_types', icon: <Briefcase size={16} />, hintKey: 'payroll_leave_types_hint' },
  ];

  const activeItem = navItems.find((item) => item.id === section)!;

  return (
    <div className={splitRowCls(dir)}>
      <div className={splitMainCls()}>
        <div className={cn('mb-4 pb-3 border-b', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
          <h2 className={cn('text-base font-bold', theme === 'dark' ? 'text-gray-100' : 'text-gray-900')}>{t(activeItem.labelKey)}</h2>
          <p className="text-xs text-gray-500 mt-0.5">{t(activeItem.hintKey)}</p>
        </div>
        {section === 'attendance_rules' && <AttendanceRulesPanel embedded />}
        {section === 'holidays' && <OfficialHolidaysPanel embedded />}
        {section === 'leave_types' && <LeaveTypesPanel embedded />}
      </div>

      <aside className={splitSidebarCls(theme)}>
        <div>
          <h3 className="font-bold text-sm">{t('payroll_settings_nav_title')}</h3>
        </div>
        <ul className="space-y-1">
          {navItems.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setSection(item.id)}
                className={splitActiveListBtn(section === item.id, theme)}
              >
                <span className="flex items-center gap-2">
                  <span className="shrink-0 opacity-90">{item.icon}</span>
                  <span className="font-semibold leading-snug">{t(item.labelKey)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className={cn('pt-3 border-t', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
          <ManualHelpButton topicId="payroll.settings.rules" size={16} />
        </div>
      </aside>
    </div>
  );
}

function resolvePayrollHeaderTopic(
  selectedRunId: string | null,
  activeTab: Tab,
  empView: 'list' | 'leave',
): ManualTopicId {
  if (selectedRunId) return 'payroll.run.create_edit';
  if (activeTab === 'settings') return 'payroll.settings.rules';
  if (activeTab === 'employees' && empView === 'leave') return 'payroll.leave.balances';
  if (activeTab === 'employees') return 'payroll.employee.master';
  return 'payroll.run.create_edit';
}

export function Payroll() {
  const { t, language, formatMoney, dir, theme } = useLanguage();
  const ar = language === 'ar';
  const { isErpShell, activeViewId } = useErpModuleView('payroll', 'runs');
  const [activeTab, setActiveTab] = useState<Tab>('runs');
  const [empView, setEmpView] = useState<'list' | 'leave'>('list');
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [showRunModal, setShowRunModal] = useState(false);
  const [empModal, setEmpModal] = useState<{ employee?: PayrollEmployee } | null>(null);
  const [importingEmp, setImportingEmp] = useState(false);
  const empFileRef = useRef<HTMLInputElement>(null);

  const TAB_META: Record<'runs' | 'employees' | 'settings', { titleKey: string; subtitleKey: string }> = {
    runs: { titleKey: 'payroll_menu_runs', subtitleKey: 'payroll_screen_runs_subtitle' },
    employees: { titleKey: 'payroll_menu_employees', subtitleKey: 'payroll_screen_employees_subtitle' },
    settings: { titleKey: 'payroll_menu_settings', subtitleKey: 'payroll_screen_settings_subtitle' },
  };

  const headerTitleKey = activeTab === 'employees' && empView === 'leave'
    ? 'payroll_menu_leave'
    : TAB_META[activeTab === 'settings' ? 'settings' : activeTab === 'employees' ? 'employees' : 'runs'].titleKey;
  const headerSubtitleKey = activeTab === 'employees' && empView === 'leave'
    ? 'payroll_screen_leave_subtitle'
    : TAB_META[activeTab === 'settings' ? 'settings' : activeTab === 'employees' ? 'employees' : 'runs'].subtitleKey;

  const { data: employees, loading: empLoading } = useApiQuery(() => payrollApi.listEmployees(), [refreshKey]);
  const { data: runs, loading: runsLoading } = useApiQuery(() => payrollApi.listRuns(), [refreshKey]);
  const { data: costCenters } = useApiQuery(() => costCentersApi.list(), []);
  const { data: bankAccounts } = useApiQuery(() => banksApi.accounts.list(), [refreshKey]);
  const { accounts } = useChartOfAccountsRef({ leafOnly: true });

  const paymentAccounts = useMemo(() => {
    const bankNameByCode = new Map<string, string>();
    for (const b of bankAccounts ?? []) {
      const code = String((b as { code?: string }).code ?? '').trim();
      const nameAr = String((b as { nameAr?: string }).nameAr ?? '').trim();
      const active = (b as { isActive?: boolean }).isActive !== false;
      if (code && nameAr && active) bankNameByCode.set(code, nameAr);
    }
    return accounts
      .filter(isPayrollPaymentAccount)
      .map((a) => {
        const code = String(a.accountCode).trim();
        return {
          code,
          name: bankNameByCode.get(code) || a.accountName || code,
        };
      });
  }, [accounts, bankAccounts]);

  const handleRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!isErpShell) return;
    if (activeViewId === 'leave') {
      setActiveTab('employees');
      setEmpView('leave');
      setSelectedRunId(null);
      setSelectedEmployeeId(null);
      return;
    }
    if (!isPayrollTab(activeViewId)) return;
    setActiveTab(activeViewId);
    setSelectedRunId(null);
    setSelectedEmployeeId(null);
  }, [activeViewId, isErpShell]);

  useEffect(() => {
    setSelectedEmployeeId(null);
  }, [activeTab, empView]);

  const handleEmpImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportingEmp(true);
    try {
      const rows = await parseEmployeesFile(file);
      if (!rows.length) { toast.error(language === 'ar' ? 'الملف فارغ' : 'File is empty'); return; }
      const result = await payrollApi.importEmployees(rows);
      toast.success(language === 'ar' ? `تم: ${result.created} إضافة · ${result.updated} تحديث` : `${result.created} added · ${result.updated} updated`);
      if (result.errors.length) toast.error(language === 'ar' ? `${result.errors.length} صف به أخطاء` : `${result.errors.length} rows had errors`);
      handleRefresh();
    } catch (err) {
      if (err instanceof NetworkQueuedError) return;
      toast.error(String(err));
    } finally {
      setImportingEmp(false);
      if (empFileRef.current) empFileRef.current.value = '';
    }
  }, [language, handleRefresh]);

  const handleDeleteEmp = useCallback(async (emp: PayrollEmployee) => {
    if (!confirm(language === 'ar' ? `حذف الموظف "${emp.name}"؟` : `Delete employee "${emp.name}"?`)) return;
    try {
      await payrollApi.removeEmployee(emp.id);
      toast.success(language === 'ar' ? 'تم الحذف' : 'Deleted');
      if (selectedEmployeeId === emp.id) setSelectedEmployeeId(null);
      handleRefresh();
    } catch (err) {
      toast.error(String(err));
    }
  }, [language, handleRefresh, selectedEmployeeId]);

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100" dir={dir}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Users size={18} className="text-blue-600" />
          <div>
            <h1 className="text-base font-semibold">{t(headerTitleKey)}</h1>
            <p className="text-xs text-gray-400">{t(headerSubtitleKey)}</p>
          </div>
          <ManualHelpButton
            topicId={resolvePayrollHeaderTopic(selectedRunId, activeTab, empView)}
            size={14}
          />
        </div>
        <button onClick={handleRefresh} className="p-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800" title={ar ? 'تحديث' : 'Refresh'}>
          <RefreshCw size={13} />
        </button>
      </div>

      {/* Tabs */}
      {!isErpShell && (
        <div className="px-4 pt-3 flex gap-1 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
          {(['runs', 'employees', 'settings'] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setSelectedRunId(null); }}
              className={cn('px-4 py-2 text-sm rounded-t-lg font-medium transition-colors', activeTab === tab ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800')}
            >
              {t(`payroll_menu_${tab}`)}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        <input ref={empFileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleEmpImport} />

        {activeTab === 'settings' ? (
          <SettingsSplitView theme={theme} dir={dir} t={t} />
        ) : activeTab === 'runs' ? (
          <RunsSplitView
            runs={runs}
            loading={runsLoading}
            selectedRunId={selectedRunId}
            onSelectRun={setSelectedRunId}
            onNewRun={() => setShowRunModal(true)}
            costCenters={costCenters}
            paymentAccounts={paymentAccounts}
            onChanged={handleRefresh}
            language={language}
            theme={theme}
            dir={dir}
            t={t}
            formatMoney={formatMoney}
          />
        ) : (
          <div className="space-y-3">
            <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800">
              {(['list', 'leave'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setEmpView(v)}
                  className={cn('px-4 py-2 text-sm rounded-t-lg font-medium transition-colors', empView === v ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800')}
                >
                  {v === 'list' ? t('payroll_menu_employees') : t('payroll_menu_leave')}
                </button>
              ))}
            </div>
            {empView === 'leave' ? (
              <LeaveBalancesPanel />
            ) : (
              <EmployeesSplitView
                employees={employees}
                loading={empLoading}
                selectedEmployeeId={selectedEmployeeId}
                onSelectEmployee={setSelectedEmployeeId}
                onNewEmployee={() => setEmpModal({})}
                onEditEmployee={(emp) => setEmpModal({ employee: emp })}
                onDeleteEmployee={handleDeleteEmp}
                onImportClick={() => empFileRef.current?.click()}
                importingEmp={importingEmp}
                onTemplateDownload={() => downloadEmployeesTemplate(language as 'ar' | 'en')}
                costCenters={costCenters}
                language={language}
                theme={theme}
                dir={dir}
                t={t}
                formatMoney={formatMoney}
              />
            )}
          </div>
        )}
      </div>

      {empModal && (
        <EmployeeModal employee={empModal.employee} costCenters={costCenters} onClose={() => setEmpModal(null)} onSaved={() => { setEmpModal(null); handleRefresh(); }} />
      )}
      {showRunModal && (
        <RunModal employees={employees} costCenters={costCenters} onClose={() => setShowRunModal(false)} onCreated={(run) => { setShowRunModal(false); handleRefresh(); setSelectedRunId(run.id); }} />
      )}
    </div>
  );
}

export default Payroll;
