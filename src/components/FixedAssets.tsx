import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { Building2, Plus, Upload, Download, Printer, RefreshCw, ChevronDown, X, Check, AlertTriangle, Edit2, Trash2, Eye } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useApiQuery } from '../hooks/useApiQuery';
import { useChartOfAccountsRef } from '../hooks/useChartOfAccountsRef';
import {
  fixedAssetsApi,
  projectsApi,
  contractsApi,
  costCentersApi,
  settingsApi,
  type FixedAsset,
  type FixedAssetGroup,
  type FixedAssetDepreciationLine,
} from '../services/local/modulesApi';
import { useReportDocumentPreview } from '../hooks/useReportDocumentPreview';
import type { CompanyPrintInfo } from '../lib/ipcPrintData';
import { downloadFixedAssetsTemplate, parseFixedAssetsImportFile, exportFixedAssetsRegister } from '../lib/fixedAssetsExcel';
import { chartLeafAccountOptions } from '../lib/chartOfAccountsPicker';
import {
  buildCostCenterSelectOptions,
  isDirectCostCenterId,
  isIndirectCostCenterId,
} from '../lib/costCenterPicker';
import { SearchableSelect } from './ui/SearchableSelect';
import { cn } from '../lib/utils';
import toast from 'react-hot-toast';
import { ManualHelpButton } from './help/ManualHelpButton';

// ─── Types ───────────────────────────────────────────────────────────────────

type Tab = 'register' | 'depreciation';

interface AssetFormData {
  assetName: string;
  groupId: number | '';
  acquisitionDate: string;
  assetValue: number | '';
  salvageValue: number | '';
  usefulLifeYears: number | '';
  depreciationModel: 'straight_line' | 'declining_balance';
  annualDepreciationRate: number | '';
  assetAccountCode: string;
  assetAccountName: string;
  accumulatedDepreciationAccountCode: string;
  accumulatedDepreciationAccountName: string;
  expenseAccountCode: string;
  expenseAccountName: string;
  costCenterId: string;
  costCenterType: 'direct' | 'indirect' | '';
  notes: string;
}

const EMPTY_FORM: AssetFormData = {
  assetName: '',
  groupId: '',
  acquisitionDate: '',
  assetValue: '',
  salvageValue: '',
  usefulLifeYears: '',
  depreciationModel: 'straight_line',
  annualDepreciationRate: '',
  assetAccountCode: '',
  assetAccountName: '',
  accumulatedDepreciationAccountCode: '',
  accumulatedDepreciationAccountName: '',
  expenseAccountCode: '',
  expenseAccountName: '',
  costCenterId: '',
  costCenterType: '',
  notes: '',
};

const STATUS_COLORS: Record<string, string> = {
  pending_setup: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  fully_depreciated: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  disposed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

// ─── Quarter helpers ──────────────────────────────────────────────────────────

function currentQuarterLabel(): string {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3) + 1;
  return `Q${q}-${now.getFullYear()}`;
}

function quarterOptions(): string[] {
  const now = new Date();
  const options: string[] = [];
  for (let y = now.getFullYear(); y >= now.getFullYear() - 2; y--) {
    for (let q = 4; q >= 1; q--) {
      if (y === now.getFullYear() && q > Math.floor(now.getMonth() / 3) + 1) continue;
      options.push(`Q${q}-${y}`);
    }
  }
  return options;
}

// ─── Asset Form Modal ─────────────────────────────────────────────────────────

interface AssetModalProps {
  mode: 'create' | 'edit' | 'setup';
  asset?: FixedAsset;
  groups: FixedAssetGroup[];
  onClose: () => void;
  onSaved: () => void;
}

function AssetModal({ mode, asset, groups, onClose, onSaved }: AssetModalProps) {
  const { language, formatMoney, theme, dir } = useLanguage();
  const { accounts } = useChartOfAccountsRef({ leafOnly: true });
  const { data: projects } = useApiQuery(() => projectsApi.list(), []);
  const { data: contracts } = useApiQuery(() => contractsApi.list(), []);
  const [indirectCenters, setIndirectCenters] = useState<
    Array<{ id: string; code: string; name: string; nameEn?: string | null; isActive?: boolean }>
  >([]);

  useEffect(() => {
    void costCentersApi.list('indirect').then((rows) => {
      setIndirectCenters(rows as typeof indirectCenters);
    }).catch(() => setIndirectCenters([]));
  }, []);

  const lang = language === 'en' ? 'en' : 'ar';

  const resolveAccountName = useCallback(
    (code: string) => {
      const acc = accounts.find((a) => String(a.accountCode ?? '').trim() === String(code ?? '').trim());
      if (!acc) return '';
      return lang === 'ar' ? acc.accountName : (acc.accountNameEn?.trim() || acc.accountName || '');
    },
    [accounts, lang],
  );

  const accumDepreciationAccountOptions = useMemo(
    () =>
      chartLeafAccountOptions(
        accounts.filter((a) => String(a.accountCode ?? '').trim().startsWith('119')),
        lang,
      ),
    [accounts, lang],
  );

  const depreciationExpenseAccountOptions = useMemo(
    () =>
      chartLeafAccountOptions(
        accounts.filter((a) => String(a.accountCode ?? '').trim().startsWith('52')),
        lang,
      ),
    [accounts, lang],
  );

  const costCenterPickerRows = useMemo(
    () =>
      buildCostCenterSelectOptions(
        contracts ?? [],
        projects ?? [],
        indirectCenters.filter((c) => c.isActive !== false),
        lang,
      ),
    [contracts, projects, indirectCenters, lang],
  );

  const costCenterSelectOptions = useMemo(
    () => costCenterPickerRows.map(({ value, label, secondary }) => ({ value, label, secondary })),
    [costCenterPickerRows],
  );

  const handleAccumDepreciationAccountChange = useCallback(
    (accountCode: string) => {
      const code = accountCode.trim();
      setForm((f) => ({
        ...f,
        accumulatedDepreciationAccountCode: code,
        accumulatedDepreciationAccountName: resolveAccountName(code),
      }));
    },
    [resolveAccountName],
  );

  const handleDepreciationExpenseAccountChange = useCallback(
    (accountCode: string) => {
      const code = accountCode.trim();
      setForm((f) => ({
        ...f,
        expenseAccountCode: code,
        expenseAccountName: resolveAccountName(code),
      }));
    },
    [resolveAccountName],
  );

  const handleCostCenterChange = useCallback(
    (costCenterId: string) => {
      const id = costCenterId.trim();
      let costCenterType: AssetFormData['costCenterType'] = '';
      if (id && isDirectCostCenterId(id, contracts ?? [])) costCenterType = 'direct';
      else if (id && isIndirectCostCenterId(id, indirectCenters)) costCenterType = 'indirect';
      setForm((f) => ({ ...f, costCenterId: id, costCenterType }));
    },
    [contracts, indirectCenters],
  );

  const [form, setForm] = useState<AssetFormData>(() => {
    if (asset) {
      return {
        assetName: asset.assetName,
        groupId: asset.groupId ?? '',
        acquisitionDate: asset.acquisitionDate,
        assetValue: asset.assetValue,
        salvageValue: asset.salvageValue,
        usefulLifeYears: asset.usefulLifeYears,
        depreciationModel: asset.depreciationModel as 'straight_line' | 'declining_balance',
        annualDepreciationRate: asset.annualDepreciationRate,
        assetAccountCode: asset.assetAccountCode,
        assetAccountName: asset.assetAccountName ?? '',
        accumulatedDepreciationAccountCode: asset.accumulatedDepreciationAccountCode,
        accumulatedDepreciationAccountName: asset.accumulatedDepreciationAccountName ?? '',
        expenseAccountCode: asset.expenseAccountCode,
        expenseAccountName: asset.expenseAccountName ?? '',
        costCenterId: asset.costCenterId ?? '',
        costCenterType: (asset.costCenterType as 'direct' | 'indirect' | '') ?? '',
        notes: asset.notes ?? '',
      };
    }
    return { ...EMPTY_FORM };
  });
  const [saving, setSaving] = useState(false);

  const set = useCallback(<K extends keyof AssetFormData>(k: K, v: AssetFormData[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
  }, []);

  const onGroupChange = useCallback((groupId: number | '') => {
    set('groupId', groupId);
    if (groupId === '') return;
    const g = groups.find((x) => x.id === groupId);
    if (!g) return;
    const accumCode = g.defaultDepreciationAccountCode ?? '';
    const expenseCode = g.defaultExpenseAccountCode ?? '';
    setForm((f) => ({
      ...f,
      groupId,
      assetAccountCode: f.assetAccountCode || g.defaultAssetAccountCode,
      accumulatedDepreciationAccountCode: f.accumulatedDepreciationAccountCode || accumCode,
      accumulatedDepreciationAccountName:
        f.accumulatedDepreciationAccountName || resolveAccountName(accumCode),
      expenseAccountCode: f.expenseAccountCode || expenseCode,
      expenseAccountName: f.expenseAccountName || resolveAccountName(expenseCode),
      depreciationModel: (f.depreciationModel || g.defaultDepreciationModel) as 'straight_line' | 'declining_balance',
      usefulLifeYears: f.usefulLifeYears || g.defaultUsefulLifeYears,
      annualDepreciationRate: f.annualDepreciationRate || (g.defaultAnnualRate ?? ''),
    }));
  }, [groups, set, resolveAccountName]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.assetName.trim() || !form.acquisitionDate || !form.assetValue) {
      toast.error(language === 'ar' ? 'اسم الأصل وتاريخ الاقتناء والقيمة مطلوبة' : 'Asset name, date and value required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        assetName: form.assetName.trim(),
        groupId: form.groupId !== '' ? form.groupId : undefined,
        acquisitionDate: form.acquisitionDate,
        assetValue: Number(form.assetValue),
        salvageValue: form.salvageValue !== '' ? Number(form.salvageValue) : 0,
        usefulLifeYears: form.usefulLifeYears !== '' ? Number(form.usefulLifeYears) : undefined,
        depreciationModel: form.depreciationModel,
        annualDepreciationRate: form.annualDepreciationRate !== '' ? Number(form.annualDepreciationRate) : undefined,
        assetAccountCode: form.assetAccountCode.trim(),
        assetAccountName: form.assetAccountName.trim() || undefined,
        accumulatedDepreciationAccountCode: form.accumulatedDepreciationAccountCode.trim(),
        accumulatedDepreciationAccountName: form.accumulatedDepreciationAccountName.trim() || undefined,
        expenseAccountCode: form.expenseAccountCode.trim(),
        expenseAccountName: form.expenseAccountName.trim() || undefined,
        costCenterId: form.costCenterId.trim() || undefined,
        costCenterType: form.costCenterType || undefined,
        notes: form.notes.trim() || undefined,
      };

      if (mode === 'create') {
        await fixedAssetsApi.create(payload as Parameters<typeof fixedAssetsApi.create>[0]);
        toast.success(language === 'ar' ? 'تم إنشاء الأصل بنجاح' : 'Asset created');
      } else {
        await fixedAssetsApi.update(asset!.id, payload);
        toast.success(language === 'ar' ? 'تم حفظ التعديلات' : 'Asset updated');
      }
      onSaved();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSaving(false);
    }
  }, [form, mode, asset, language, onSaved]);

  const isSetupMode = mode === 'setup';
  const title = mode === 'create'
    ? (language === 'ar' ? 'أصل ثابت جديد' : 'New Fixed Asset')
    : mode === 'setup'
    ? (language === 'ar' ? 'إكمال بيانات الأصل' : 'Complete Asset Setup')
    : (language === 'ar' ? 'تعديل الأصل' : 'Edit Asset');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Basic info */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">{language === 'ar' ? 'اسم الأصل *' : 'Asset Name *'}</label>
              <input
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                value={form.assetName}
                onChange={(e) => set('assetName', e.target.value)}
                disabled={isSetupMode}
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">{language === 'ar' ? 'مجموعة الأصول' : 'Asset Group'}</label>
              <select
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                value={form.groupId}
                onChange={(e) => onGroupChange(e.target.value ? parseInt(e.target.value, 10) : '')}
              >
                <option value="">{language === 'ar' ? '— اختر —' : '— Select —'}</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.groupName}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">{language === 'ar' ? 'تاريخ الاقتناء *' : 'Acquisition Date *'}</label>
              <input
                type="date"
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                value={form.acquisitionDate}
                onChange={(e) => set('acquisitionDate', e.target.value)}
                disabled={isSetupMode}
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">{language === 'ar' ? 'قيمة الأصل *' : 'Asset Value *'}</label>
              <input
                type="number" step="1" min="0"
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                value={form.assetValue}
                onChange={(e) => set('assetValue', e.target.value === '' ? '' : Number(e.target.value))}
                disabled={isSetupMode}
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">{language === 'ar' ? 'قيمة الخردة' : 'Salvage Value'}</label>
              <input
                type="number" step="1" min="0"
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                value={form.salvageValue}
                onChange={(e) => set('salvageValue', e.target.value === '' ? '' : Number(e.target.value))}
              />
            </div>
          </div>

          {/* Depreciation params */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
            <h3 className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-3">{language === 'ar' ? 'معاملات الإهلاك' : 'Depreciation Parameters'}</h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">{language === 'ar' ? 'نموذج الإهلاك' : 'Model'}</label>
                <select
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  value={form.depreciationModel}
                  onChange={(e) => set('depreciationModel', e.target.value as 'straight_line' | 'declining_balance')}
                >
                  <option value="straight_line">{language === 'ar' ? 'قسط ثابت' : 'Straight-Line'}</option>
                  <option value="declining_balance">{language === 'ar' ? 'قسط متناقص' : 'Declining Balance'}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{language === 'ar' ? 'العمر المفيد (سنوات)' : 'Useful Life (yrs)'}</label>
                <input
                  type="number" step="0.5" min="1"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  value={form.usefulLifeYears}
                  onChange={(e) => set('usefulLifeYears', e.target.value === '' ? '' : Number(e.target.value))}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{language === 'ar' ? 'معدل الإهلاك السنوي' : 'Annual Rate'}</label>
                <input
                  type="number" step="0.01" min="0" max="1"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  placeholder="0.20"
                  value={form.annualDepreciationRate}
                  onChange={(e) => set('annualDepreciationRate', e.target.value === '' ? '' : Number(e.target.value))}
                />
              </div>
            </div>
          </div>

          {/* Accounts */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
            <h3 className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-3">{language === 'ar' ? 'الحسابات' : 'Accounts'}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">{language === 'ar' ? 'كود حساب الأصل (11xxx)' : 'Asset Account (11xxx)'}</label>
                <input
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono"
                  placeholder="11101001"
                  value={form.assetAccountCode}
                  onChange={(e) => set('assetAccountCode', e.target.value)}
                  disabled={isSetupMode}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{language === 'ar' ? 'اسم حساب الأصل' : 'Asset Account Name'}</label>
                <input
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  value={form.assetAccountName}
                  onChange={(e) => set('assetAccountName', e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{language === 'ar' ? 'كود مجمع الإهلاك (119xxx)' : 'Accum. Depr. Account (119xxx)'}</label>
                <SearchableSelect
                  value={form.accumulatedDepreciationAccountCode}
                  onChange={handleAccumDepreciationAccountChange}
                  theme={theme}
                  dir={dir}
                  placeholder={language === 'ar' ? 'اختر حساب مجمع الإهلاك' : 'Select accumulated depreciation account'}
                  options={accumDepreciationAccountOptions}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{language === 'ar' ? 'اسم مجمع الإهلاك' : 'Accum. Depr. Name'}</label>
                <input
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 read-only:opacity-90"
                  placeholder={language === 'ar' ? 'يُعبّأ تلقائياً من الشجرة' : 'Filled from chart of accounts'}
                  value={form.accumulatedDepreciationAccountName}
                  readOnly
                  aria-readonly
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{language === 'ar' ? 'كود مصروف الإهلاك (52xxx)' : 'Depr. Expense Account (52xxx)'}</label>
                <SearchableSelect
                  value={form.expenseAccountCode}
                  onChange={handleDepreciationExpenseAccountChange}
                  theme={theme}
                  dir={dir}
                  placeholder={language === 'ar' ? 'اختر حساب مصروف الإهلاك' : 'Select depreciation expense account'}
                  options={depreciationExpenseAccountOptions}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{language === 'ar' ? 'اسم مصروف الإهلاك' : 'Depr. Expense Name'}</label>
                <input
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 read-only:opacity-90"
                  placeholder={language === 'ar' ? 'يُعبّأ تلقائياً من الشجرة' : 'Filled from chart of accounts'}
                  value={form.expenseAccountName}
                  readOnly
                  aria-readonly
                />
              </div>
            </div>
          </div>

          {/* Cost center */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">{language === 'ar' ? 'مركز التكلفة' : 'Cost Center'}</label>
              <SearchableSelect
                value={form.costCenterId}
                onChange={handleCostCenterChange}
                theme={theme}
                dir={dir}
                placeholder={language === 'ar' ? 'اختر مركز التكلفة' : 'Select cost center'}
                options={costCenterSelectOptions}
              />
              {costCenterSelectOptions.length === 0 && (
                <p className="text-[11px] text-amber-500 mt-1">
                  {language === 'ar'
                    ? 'لا توجد مراكز تكلفة — أضف عقوداً أو مراكز غير مباشرة من الإعدادات.'
                    : 'No cost centers — add contracts or indirect centers in Settings.'}
                </p>
              )}
              {form.costCenterType && (
                <p className="text-[11px] text-gray-500 mt-1">
                  {form.costCenterType === 'direct'
                    ? (language === 'ar' ? 'نوع المركز: مباشر (عقد)' : 'Type: Direct (contract)')
                    : (language === 'ar' ? 'نوع المركز: غير مباشر' : 'Type: Indirect')}
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{language === 'ar' ? 'ملاحظات' : 'Notes'}</label>
              <textarea
                rows={2}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 resize-none"
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
              {language === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-medium disabled:opacity-60"
            >
              {saving ? <RefreshCw size={14} className="animate-spin inline mr-1" /> : null}
              {language === 'ar' ? 'حفظ' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Depreciation Tab ─────────────────────────────────────────────────────────

interface DepreciationTabProps {
  language: 'ar' | 'en';
  formatMoney: (v: number) => string;
}

function DepreciationTab({ language, formatMoney }: DepreciationTabProps) {
  const [selectedQuarter, setSelectedQuarter] = useState(currentQuarterLabel);
  const [preview, setPreview] = useState<{
    periodLabel: string;
    periodStart: string;
    periodEnd: string;
    lines: FixedAssetDepreciationLine[];
    total: number;
  } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [posting, setPosting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const { data: entries, loading: entriesLoading } = useApiQuery(
    () => fixedAssetsApi.listDepreciation(),
    [refreshKey],
  );

  const handlePreview = useCallback(async () => {
    setLoadingPreview(true);
    try {
      const result = await fixedAssetsApi.computeDepreciation(selectedQuarter);
      setPreview(result);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setLoadingPreview(false);
    }
  }, [selectedQuarter]);

  const handlePost = useCallback(async () => {
    if (!preview?.lines.length) return;
    setPosting(true);
    try {
      await fixedAssetsApi.postDepreciation(preview.periodLabel, preview.lines);
      toast.success(language === 'ar' ? `تم ترحيل إهلاك ${preview.periodLabel}` : `Depreciation posted for ${preview.periodLabel}`);
      setPreview(null);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setPosting(false);
    }
  }, [preview, language]);

  return (
    <div className="space-y-4">
      {/* Quarter selector + preview button */}
      <div className="flex items-center gap-3 p-4 bg-violet-50 dark:bg-violet-900/20 rounded-xl border border-violet-200 dark:border-violet-800">
        <div className="flex-1">
          <label className="flex items-center gap-1 text-xs text-violet-700 dark:text-violet-400 mb-1">
            {language === 'ar' ? 'الربع المراد احتساب إهلاكه' : 'Depreciation Quarter'}
            <ManualHelpButton topicId="assets.depreciation.quarterly" size={12} />
          </label>
          <select
            className="w-full border border-violet-300 dark:border-violet-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            value={selectedQuarter}
            onChange={(e) => { setSelectedQuarter(e.target.value); setPreview(null); }}
          >
            {quarterOptions().map((q) => <option key={q} value={q}>{q}</option>)}
          </select>
        </div>
        <button
          onClick={handlePreview}
          disabled={loadingPreview}
          className="mt-4 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium flex items-center gap-2 disabled:opacity-60"
        >
          {loadingPreview ? <RefreshCw size={14} className="animate-spin" /> : <Eye size={14} />}
          {language === 'ar' ? 'معاينة' : 'Preview'}
        </button>
      </div>

      {/* Preview table */}
      {preview && (
        <div className="rounded-xl border border-violet-200 dark:border-violet-800 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-violet-50 dark:bg-violet-900/20">
            <h3 className="text-sm font-semibold text-violet-800 dark:text-violet-300">
              {language === 'ar' ? `إهلاك ${preview.periodLabel}` : `Depreciation ${preview.periodLabel}`}
              <span className="mr-2 text-xs text-violet-600 dark:text-violet-400">
                ({preview.periodStart} — {preview.periodEnd})
              </span>
            </h3>
            <span className="text-sm font-bold text-violet-800 dark:text-violet-200">
              {language === 'ar' ? 'الإجمالي: ' : 'Total: '}{formatMoney(preview.total)}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-start">{language === 'ar' ? 'الأصل' : 'Asset'}</th>
                  <th className="px-3 py-2 text-end">{language === 'ar' ? 'القيمة الدفترية' : 'Book Value'}</th>
                  <th className="px-3 py-2 text-end">{language === 'ar' ? 'قسط الإهلاك' : 'Depreciation'}</th>
                  <th className="px-3 py-2 text-end">{language === 'ar' ? 'بعد الإهلاك' : 'After Depr.'}</th>
                  <th className="px-3 py-2 text-start">{language === 'ar' ? 'ح/ المصروف' : 'Expense Acc.'}</th>
                  <th className="px-3 py-2 text-start">{language === 'ar' ? 'مركز التكلفة' : 'Cost Center'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {preview.lines.map((l) => (
                  <tr key={l.assetId} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">
                      <div>{l.assetName}</div>
                      <div className="text-xs text-gray-400 font-mono">{l.assetNumber}</div>
                    </td>
                    <td className="px-3 py-2 text-end tabular-nums">{formatMoney(l.bookValueBefore)}</td>
                    <td className="px-3 py-2 text-end tabular-nums font-medium text-violet-700 dark:text-violet-300">{formatMoney(l.depreciationAmount)}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{formatMoney(l.bookValueAfter)}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-500">{l.expenseAccountCode}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{l.costCenterId ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.lines.length > 0 && (
            <div className="flex justify-end gap-2 p-3 border-t border-violet-200 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-900/10">
              <button onClick={() => setPreview(null)} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                onClick={handlePost}
                disabled={posting}
                className="px-4 py-1.5 text-sm rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-medium flex items-center gap-2 disabled:opacity-60"
              >
                {posting ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                {language === 'ar' ? 'ترحيل الإهلاك' : 'Post Depreciation'}
              </button>
            </div>
          )}
          {preview.lines.length === 0 && (
            <div className="p-4 text-center text-sm text-gray-500">
              {language === 'ar' ? 'لا توجد أصول نشطة قابلة للإهلاك في هذا الربع' : 'No active assets to depreciate this quarter'}
            </div>
          )}
        </div>
      )}

      {/* History */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          {language === 'ar' ? 'سجل الإهلاك المرحّل' : 'Posted Depreciation History'}
        </h3>
        {entriesLoading ? (
          <div className="flex justify-center py-8"><RefreshCw size={18} className="animate-spin text-violet-500" /></div>
        ) : entries.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-400">{language === 'ar' ? 'لا توجد قيود إهلاك بعد' : 'No depreciation entries yet'}</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-start">{language === 'ar' ? 'الفترة' : 'Period'}</th>
                  <th className="px-3 py-2 text-start">{language === 'ar' ? 'الأصل' : 'Asset'}</th>
                  <th className="px-3 py-2 text-end">{language === 'ar' ? 'مبلغ الإهلاك' : 'Amount'}</th>
                  <th className="px-3 py-2 text-end">{language === 'ar' ? 'القيمة الدفترية' : 'Book Value After'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {entries.slice(0, 50).map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                    <td className="px-3 py-2 font-mono text-xs">{e.periodLabel}</td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{e.asset?.assetName ?? e.assetId}</td>
                    <td className="px-3 py-2 text-end tabular-nums font-medium">{formatMoney(e.depreciationAmount)}</td>
                    <td className="px-3 py-2 text-end tabular-nums text-gray-500">{formatMoney(e.bookValueAfter)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function FixedAssets() {
  const { t, language, locale, formatMoney } = useLanguage();
  const [activeTab, setActiveTab] = useState<Tab>('register');
  const [refreshKey, setRefreshKey] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [modalMode, setModalMode] = useState<'create' | 'edit' | 'setup' | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<FixedAsset | undefined>();
  const [importing, setImporting] = useState(false);
  const [syncingGl, setSyncingGl] = useState(false);
  const [companyInfo, setCompanyInfo] = useState<CompanyPrintInfo>({
    companyName: '',
    companyNameEn: '',
    headerLogo: '',
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const { data: groups } = useApiQuery(() => fixedAssetsApi.listGroups(), []);
  const { data: assets, loading: assetsLoading, refresh: refreshAssets } = useApiQuery(
    () => fixedAssetsApi.list(statusFilter ? { status: statusFilter } : undefined),
    [statusFilter, refreshKey],
  );

  const pendingSetupCount = useMemo(() => assets.filter((a) => a.status === 'pending_setup').length, [assets]);

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const rows = await parseFixedAssetsImportFile(file);
      if (!rows.length) {
        toast.error(language === 'ar' ? 'الملف فارغ' : 'File is empty');
        return;
      }
      const result = await fixedAssetsApi.importAssets(rows);
      if (result.created > 0) {
        toast.success(language === 'ar' ? `تم استيراد ${result.created} أصل` : `${result.created} assets imported`);
        handleRefresh();
      }
      if (result.errors.length > 0) {
        toast.error(language === 'ar' ? `${result.errors.length} صف بها أخطاء` : `${result.errors.length} rows had errors`);
      }
    } catch (err) {
      toast.error(String(err));
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [language, handleRefresh]);

  const handleExport = useCallback(async () => {
    try {
      const result = await fixedAssetsApi.registerReport();
      exportFixedAssetsRegister(result.rows, language as 'ar' | 'en');
    } catch (err) {
      toast.error(String(err));
    }
  }, [language]);

  const handlePrint = useCallback(() => {
    const isAr = language === 'ar';
    const statusLabels: Record<string, string> = {
      pending_setup: isAr ? 'بانتظار الإعداد' : 'Pending setup',
      active: isAr ? 'نشط' : 'Active',
      fully_depreciated: isAr ? 'مُهلك بالكامل' : 'Fully depreciated',
      disposed: isAr ? 'مستبعد' : 'Disposed',
    };
    const modelLabels: Record<string, string> = {
      straight_line: isAr ? 'قسط ثابت' : 'Straight-Line',
      declining_balance: isAr ? 'قسط متناقص' : 'Declining Balance',
    };
    openDocPreview({
      reportId: 'fixed_assets',
      title: isAr ? 'سجل الأصول الثابتة' : 'Fixed Assets Register',
      dateLabel: new Date().toLocaleDateString(locale),
      columns: [
        { key: 'assetName', header: isAr ? 'اسم الأصل' : 'Asset Name', width: 18 },
        { key: 'acquisitionDate', header: isAr ? 'التاريخ' : 'Date', width: 9 },
        { key: 'assetValue', header: isAr ? 'قيمة الأصل' : 'Asset Value', width: 11, money: true },
        { key: 'bookValue', header: isAr ? 'القيمة الدفترية' : 'Book Value', width: 11, money: true },
        { key: 'assetAccount', header: isAr ? 'حساب الأصل' : 'Asset Acc.', width: 9 },
        { key: 'deprAccount', header: isAr ? 'حساب الإهلاك' : 'Depr. Acc.', width: 9 },
        { key: 'expenseAccount', header: isAr ? 'حساب المصروف' : 'Expense Acc.', width: 9 },
        { key: 'model', header: isAr ? 'طريقة الإهلاك' : 'Model', width: 9 },
        { key: 'group', header: isAr ? 'المجموعة' : 'Group', width: 8 },
        { key: 'status', header: isAr ? 'الحالة' : 'Status', width: 7 },
      ],
      rows: assets.map((asset) => ({
        assetName: `${asset.assetName}${asset.assetNumber ? ` (${asset.assetNumber})` : ''}`,
        acquisitionDate: asset.acquisitionDate,
        assetValue: asset.assetValue,
        bookValue: asset.bookValue,
        assetAccount: asset.assetAccountCode || '—',
        deprAccount: asset.accumulatedDepreciationAccountCode || '—',
        expenseAccount: asset.expenseAccountCode || '—',
        model: modelLabels[asset.depreciationModel] ?? asset.depreciationModel,
        group: asset.group?.groupName ?? '—',
        status: statusLabels[asset.status] ?? asset.status,
      })),
      totals: {
        assetValue: assets.reduce((s, a) => s + (a.assetValue || 0), 0),
        bookValue: assets.reduce((s, a) => s + (a.bookValue || 0), 0),
      },
      filename: 'fixed-assets-register',
    });
  }, [assets, language, locale, openDocPreview]);

  const handleSyncFromGl = useCallback(async () => {
    setSyncingGl(true);
    try {
      const result = await fixedAssetsApi.syncFromGl();
      if (result.created > 0) {
        toast.success(
          language === 'ar'
            ? `تم استيراد ${result.created} أصل من دفتر اليومية (في انتظار الإعداد)`
            : `Imported ${result.created} asset(s) from GL (pending setup)`,
        );
        handleRefresh();
      } else {
        toast(
          language === 'ar'
            ? `لا أصول جديدة — فُحص ${result.scanned} قيد مدين على حسابات 11…`
            : `No new assets — scanned ${result.scanned} debit(s) on 11… accounts`,
        );
      }
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSyncingGl(false);
    }
  }, [language, handleRefresh]);

  const handleDelete = useCallback(async (asset: FixedAsset) => {
    if (!confirm(language === 'ar' ? `حذف الأصل "${asset.assetName}"؟` : `Delete asset "${asset.assetName}"?`)) return;
    try {
      await fixedAssetsApi.remove(asset.id);
      toast.success(language === 'ar' ? 'تم الحذف' : 'Deleted');
      handleRefresh();
    } catch (err) {
      toast.error(String(err));
    }
  }, [language, handleRefresh]);

  const STATUS_LABELS: Record<string, string> = {
    pending_setup: language === 'ar' ? 'في انتظار الإعداد' : 'Pending Setup',
    active: language === 'ar' ? 'نشط' : 'Active',
    fully_depreciated: language === 'ar' ? 'مستهلك بالكامل' : 'Fully Depreciated',
    disposed: language === 'ar' ? 'مستبعد' : 'Disposed',
  };

  const MODEL_LABELS: Record<string, string> = {
    straight_line: language === 'ar' ? 'قسط ثابت' : 'Straight-Line',
    declining_balance: language === 'ar' ? 'قسط متناقص' : 'Declining Balance',
  };

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Building2 size={18} className="text-violet-600" />
          <h1 className="text-base font-semibold">{language === 'ar' ? 'الأصول الثابتة' : 'Fixed Assets'}</h1>
          <ManualHelpButton
            topicId={activeTab === 'depreciation' ? 'assets.depreciation.quarterly' : 'assets.register.create'}
            size={14}
          />
          {pendingSetupCount > 0 && (
            <span className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300 text-xs rounded-full px-2 py-0.5 font-medium">
              {pendingSetupCount} {language === 'ar' ? 'في انتظار الإعداد' : 'pending setup'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {activeTab === 'register' && (
            <>
              <select
                className="border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">{language === 'ar' ? 'كل الحالات' : 'All Statuses'}</option>
                {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <button
                onClick={() => downloadFixedAssetsTemplate(language as 'ar' | 'en')}
                className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <Download size={13} />
                {language === 'ar' ? 'قالب' : 'Template'}
              </button>
              <span className="inline-flex items-center gap-1">
                <label className={cn(
                  'flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border cursor-pointer',
                  importing
                    ? 'border-violet-300 bg-violet-50 text-violet-600'
                    : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800',
                )}>
                  <Upload size={13} />
                  {importing ? <RefreshCw size={12} className="animate-spin" /> : (language === 'ar' ? 'استيراد' : 'Import')}
                  <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} />
                </label>
                <ManualHelpButton topicId="assets.register.import" size={12} />
              </span>
              <button
                onClick={() => void handleSyncFromGl()}
                disabled={syncingGl}
                className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-50"
                title={language === 'ar' ? 'إنشاء سجلات من قيود مدين على حسابات الأصول 11…' : 'Create register rows from GL debits on 11… asset accounts'}
              >
                {syncingGl ? <RefreshCw size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                {language === 'ar' ? 'مزامنة من الدفتر' : 'Sync from GL'}
              </button>
              <button
                onClick={handleExport}
                className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <Download size={13} />
                {language === 'ar' ? 'تصدير' : 'Export'}
              </button>
              <button
                onClick={handlePrint}
                className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <Printer size={13} />
                {language === 'ar' ? 'طباعة' : 'Print'}
              </button>
              <span className="inline-flex items-center gap-1">
                <button
                  onClick={() => { setSelectedAsset(undefined); setModalMode('create'); }}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-medium"
                >
                  <Plus size={13} />
                  {language === 'ar' ? 'أصل جديد' : 'New Asset'}
                </button>
                <ManualHelpButton topicId="assets.register.create" size={12} />
              </span>
            </>
          )}
          <button onClick={handleRefresh} className="p-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800">
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-4 pt-3 flex gap-1 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        {(['register', 'depreciation'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'px-4 py-2 text-sm rounded-t-lg font-medium transition-colors',
              activeTab === tab
                ? 'bg-violet-600 text-white'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800',
            )}
          >
            {tab === 'register'
              ? (language === 'ar' ? 'سجل الأصول' : 'Asset Register')
              : (language === 'ar' ? 'الإهلاك' : 'Depreciation')}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'register' && (
          <>
            {/* Pending setup alert */}
            {pendingSetupCount > 0 && (
              <div className="mb-3 flex items-center gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg text-sm text-yellow-800 dark:text-yellow-300">
                <AlertTriangle size={15} />
                {language === 'ar'
                  ? `${pendingSetupCount} أصل في انتظار إكمال بيانات الإهلاك — يرجى فتحه وتحديد مركز التكلفة والحسابات`
                  : `${pendingSetupCount} asset(s) pending depreciation setup — open each to complete accounts & cost center`}
              </div>
            )}

            {assetsLoading ? (
              <div className="flex justify-center py-16"><RefreshCw size={20} className="animate-spin text-violet-500" /></div>
            ) : assets.length === 0 ? (
              <div className="flex flex-col items-center py-16 text-gray-400 gap-3">
                <Building2 size={40} className="opacity-30" />
                <p className="text-sm">{language === 'ar' ? 'لا توجد أصول ثابتة في السجل' : 'No fixed assets in the register'}</p>
                <p className="text-xs text-center max-w-md text-gray-500">
                  {language === 'ar'
                    ? 'الميزانية تعرض أرصدة حسابات 11… من دفتر اليومية. إن وُجدت قيود شراء أصول بدون صف هنا، استخدم «مزامنة من الدفتر».'
                    : 'The balance sheet shows 11… account balances from the journal. If asset purchases exist in GL without register rows, use Sync from GL.'}
                </p>
                <button
                  type="button"
                  onClick={() => void handleSyncFromGl()}
                  disabled={syncingGl}
                  className="mt-1 flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50"
                >
                  {syncingGl ? <RefreshCw size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                  {language === 'ar' ? 'مزامنة من الدفتر' : 'Sync from GL'}
                </button>
              </div>
            ) : (
              <div className="report-print-area">
                <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-800 text-xs text-gray-500 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-start">{language === 'ar' ? 'اسم الأصل' : 'Asset Name'}</th>
                        <th className="px-3 py-2 text-start">{language === 'ar' ? 'التاريخ' : 'Date'}</th>
                        <th className="px-3 py-2 text-end">Asset Value</th>
                        <th className="px-3 py-2 text-end">{language === 'ar' ? 'القيمة الدفترية' : 'Book Value'}</th>
                        <th className="px-3 py-2 text-start">{language === 'ar' ? 'حساب الأصل الثابت' : 'Asset Account'}</th>
                        <th className="px-3 py-2 text-start">{language === 'ar' ? 'حساب الإهلاك' : 'Depr. Account'}</th>
                        <th className="px-3 py-2 text-start">{language === 'ar' ? 'حساب النفقات' : 'Expense Account'}</th>
                        <th className="px-3 py-2 text-start">Depreciation Model</th>
                        <th className="px-3 py-2 text-start">{language === 'ar' ? 'مجموعة الأصول' : 'Asset Group'}</th>
                        <th className="px-3 py-2 text-start">{language === 'ar' ? 'الحالة' : 'Status'}</th>
                        <th className="px-3 py-2 print:hidden" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {assets.map((asset) => (
                        <tr key={asset.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                          <td className="px-3 py-2">
                            <div className="font-medium text-gray-900 dark:text-gray-100">{asset.assetName}</div>
                            <div className="text-xs text-gray-400 font-mono">{asset.assetNumber}</div>
                          </td>
                          <td className="px-3 py-2 text-gray-500 text-xs">{asset.acquisitionDate}</td>
                          <td className="px-3 py-2 text-end tabular-nums">{formatMoney(asset.assetValue)}</td>
                          <td className="px-3 py-2 text-end tabular-nums font-medium">
                            <span className={asset.bookValue <= asset.salvageValue ? 'text-gray-400' : 'text-violet-700 dark:text-violet-300'}>
                              {formatMoney(asset.bookValue)}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-gray-500">{asset.assetAccountCode || '—'}</td>
                          <td className="px-3 py-2 font-mono text-xs text-gray-500">{asset.accumulatedDepreciationAccountCode || '—'}</td>
                          <td className="px-3 py-2 font-mono text-xs text-gray-500">{asset.expenseAccountCode || '—'}</td>
                          <td className="px-3 py-2 text-xs text-gray-500">{MODEL_LABELS[asset.depreciationModel] ?? asset.depreciationModel}</td>
                          <td className="px-3 py-2 text-xs text-gray-500">{asset.group?.groupName ?? '—'}</td>
                          <td className="px-3 py-2">
                            <span className={cn('text-xs rounded-full px-2 py-0.5 font-medium', STATUS_COLORS[asset.status] ?? 'bg-gray-100 text-gray-600')}>
                              {STATUS_LABELS[asset.status] ?? asset.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 print:hidden">
                            <div className="flex items-center gap-1">
                              {asset.status === 'pending_setup' && (
                                <button
                                  onClick={() => { setSelectedAsset(asset); setModalMode('setup'); }}
                                  title={language === 'ar' ? 'إكمال الإعداد' : 'Complete Setup'}
                                  className="p-1 rounded text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-900/30"
                                >
                                  <AlertTriangle size={14} />
                                </button>
                              )}
                              <button
                                onClick={() => { setSelectedAsset(asset); setModalMode('edit'); }}
                                title={language === 'ar' ? 'تعديل' : 'Edit'}
                                className="p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                              >
                                <Edit2 size={14} />
                              </button>
                              <button
                                onClick={() => handleDelete(asset)}
                                title={language === 'ar' ? 'حذف' : 'Delete'}
                                className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
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
            )}
          </>
        )}

        {activeTab === 'depreciation' && (
          <DepreciationTab language={language as 'ar' | 'en'} formatMoney={formatMoney} />
        )}
      </div>

      {/* Asset modal */}
      {modalMode && (
        <AssetModal
          mode={modalMode}
          asset={selectedAsset}
          groups={groups}
          onClose={() => { setModalMode(null); setSelectedAsset(undefined); }}
          onSaved={() => { setModalMode(null); setSelectedAsset(undefined); handleRefresh(); }}
        />
      )}

      {ReportPreviewHost}
    </div>
  );
}

export default FixedAssets;
