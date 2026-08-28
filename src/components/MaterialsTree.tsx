import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Loader2, Package, Download, Upload, FileSpreadsheet, Search } from 'lucide-react';
import type { AppTheme } from '../lib/shellTheme';
import { cn, listKey } from '../lib/utils';
import { useLanguage } from '../context/LanguageContext';
import { useOperationProgressRunner } from '../context/OperationProgressContext';
import { usePermissions } from '../context/PermissionsContext';
import { isLocalBackend } from '../lib/dataBackend';
import { materialsApi, type MaterialCategory, type MaterialGroup } from '../services/local/modulesApi';
import { ManualHelpButton } from './help/ManualHelpButton';
import {
  exportMaterialsTreeExcel,
  exportMaterialsTreeTemplate,
  parseMaterialsImportFile,
} from '../lib/materialsTreeExcel';
import toast from 'react-hot-toast';

const UNITS = [
  'طن', 'م3', 'م2', 'متر', 'كجم', 'شيكارة', 'كيس', 'قطعة', 'علبة', 'لفة', 'طقم',
  'بكرة', 'لوح', 'ماسورة', 'أنبوبة', 'ألف', 'لوحة', 'باكو', 'مجموعة', 'جالون',
  'زوج', 'كرتونة', 'برميل', 'ورقة', 'جركن', 'بستلة', 'رزمة', 'EA', 'لتر', 'عدد',
];

function cardBg(theme: AppTheme) {
  return theme === 'dark'
    ? 'bg-gray-900 border-gray-800'
    : theme === 'soft'
      ? 'bg-white/80 border-gray-200/80'
      : 'bg-white border-gray-200';
}

function splitSidebarCls(theme: AppTheme) {
  return cn(
    'rounded-xl border p-4 w-full md:flex-[2] md:min-w-[17rem] md:max-w-[24rem] shrink-0 space-y-4 md:sticky md:top-4 order-1 md:order-none',
    cardBg(theme),
  );
}

function splitMainCls() {
  return 'flex-1 min-w-0 md:flex-[3] space-y-4 order-2 md:order-none';
}

function splitRowCls(dir: string) {
  return cn('flex flex-col md:flex-row md:items-start gap-4', dir === 'rtl' ? 'md:flex-row-reverse' : '');
}

function splitSelectCls(theme: AppTheme) {
  return cn(
    'w-full rounded-lg border px-3 py-2 text-sm font-bold outline-none focus:border-blue-500 transition-colors',
    theme === 'dark' ? 'bg-gray-900 border-gray-800 text-white' : 'bg-white border-gray-200 text-gray-900',
  );
}

function splitLabelCls(theme: AppTheme) {
  return cn('block text-xs font-bold mb-1.5', theme === 'dark' ? 'text-gray-400' : 'text-gray-500');
}

function splitSectionTitleCls() {
  return 'text-xs font-bold uppercase tracking-wide text-gray-500';
}

function splitEmptyPaneCls(theme: AppTheme) {
  return cn('border rounded-xl p-12 text-center', theme === 'dark' ? 'border-gray-800 bg-[#151619]' : 'border-gray-200 bg-white');
}

function sidebarBtnCls(theme: AppTheme) {
  return cn(
    'w-full text-xs px-3 py-2 rounded-lg border flex items-center justify-center gap-1.5 transition-colors',
    theme === 'dark'
      ? 'border-gray-600 hover:bg-gray-800 text-gray-200'
      : 'border-gray-300 hover:bg-gray-100 text-gray-700',
  );
}

export function MaterialsTree() {
  const { language, theme, t, dir } = useLanguage();
  const runWithProgress = useOperationProgressRunner();
  const { can } = usePermissions();
  const canEdit = can('inventory').edit;
  const ar = language === 'ar';
  const importInputRef = useRef<HTMLInputElement>(null);

  const [groups, setGroups] = useState<MaterialGroup[]>([]);
  const [categories, setCategories] = useState<MaterialCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState('');
  const [groupFilterId, setGroupFilterId] = useState<number | ''>('');
  const [groupForm, setGroupForm] = useState({ code: '', name: '', nameEn: '' });
  const [catForm, setCatForm] = useState({ groupId: 0, code: '', name: '', unit: 'طن' });

  const load = useCallback(async () => {
    if (!isLocalBackend) return;
    setLoading(true);
    try {
      const [g, c] = await Promise.all([materialsApi.listGroups(), materialsApi.listCategories()]);
      setGroups(g);
      setCategories(c);
    } catch {
      toast.error(ar ? 'فشل تحميل شجرة الأصناف' : 'Failed to load materials');
    } finally {
      setLoading(false);
    }
  }, [ar]);

  useEffect(() => {
    load();
  }, [load]);

  const input = cn(
    'w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500',
    theme === 'dark' ? 'bg-gray-900 border-gray-700 text-gray-100' : 'bg-white border-gray-300 text-gray-900',
  );

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    let result = groups;
    if (groupFilterId !== '') {
      result = result.filter((g) => g.id === groupFilterId);
    }
    if (!q) return result;
    return result.filter((g) => {
      if (
        g.code.toLowerCase().includes(q) ||
        g.name.toLowerCase().includes(q) ||
        (g.nameEn || '').toLowerCase().includes(q)
      ) {
        return true;
      }
      return categories.some(
        (c) =>
          c.groupId === g.id &&
          (c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)),
      );
    });
  }, [groups, categories, search, groupFilterId]);

  const filteredCategories = useMemo(() => {
    const q = search.trim().toLowerCase();
    let result = categories;
    if (groupFilterId !== '') {
      result = result.filter((c) => c.groupId === groupFilterId);
    }
    if (!q) return result;
    return result.filter((c) => {
      if (c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)) return true;
      const g = groups.find((row) => row.id === c.groupId);
      return g
        ? g.code.toLowerCase().includes(q) ||
            g.name.toLowerCase().includes(q) ||
            (g.nameEn || '').toLowerCase().includes(q)
        : false;
    });
  }, [categories, groups, search, groupFilterId]);

  const handleExport = () => {
    exportMaterialsTreeExcel(groups, categories, ar ? 'شجرة_الأصناف' : 'Materials_Tree');
    toast.success(ar ? 'تم تصدير الملف' : 'File exported');
  };

  const handleExportTemplate = () => {
    exportMaterialsTreeTemplate(language === 'ar' ? 'ar' : 'en');
    toast.success(ar ? 'تم تنزيل القالب' : 'Template downloaded');
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      const rows = parseMaterialsImportFile(buffer);
      if (rows.length === 0) {
        toast.error(ar ? 'الملف فارغ أو الأعمدة غير معروفة' : 'File empty or unknown columns');
        return;
      }
      const result = await runWithProgress(
        {
          label: ar ? 'استيراد شجرة الأصناف…' : 'Importing materials tree…',
          message: `${rows.length} ${ar ? 'صف' : 'rows'}`,
        },
        async (update) => {
          update(0, ar ? 'جاري الرفع للخادم…' : 'Uploading to server…');
          return materialsApi.importTree(rows);
        },
      );
      await load();
      const msg = ar
        ? `مجموعات جديدة: ${result.groupsCreated} | محدّثة: ${result.groupsUpdated ?? 0} | أصناف جديدة: ${result.categoriesCreated} | محدّثة: ${result.categoriesUpdated ?? 0}`
        : `New groups: ${result.groupsCreated} | Updated: ${result.groupsUpdated ?? 0} | New categories: ${result.categoriesCreated} | Updated: ${result.categoriesUpdated ?? 0}`;
      if (result.errors.length > 0) {
        toast.error(`${msg}\n${result.errors.slice(0, 3).join('\n')}`, { duration: 6000 });
      } else {
        toast.success(msg);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : ar ? 'فشل الاستيراد' : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  if (!isLocalBackend) {
    return (
      <p className="text-sm text-gray-500 p-4">
        {ar ? 'شجرة الأصناف متاحة في الوضع المحلي فقط.' : 'Materials tree is available in local backend mode only.'}
      </p>
    );
  }

  const addGroup = async () => {
    if (!canEdit || !groupForm.code.trim() || (!groupForm.name.trim() && !groupForm.nameEn.trim())) return;
    try {
      await materialsApi.createGroup({
        code: groupForm.code.trim(),
        name: groupForm.name.trim() || groupForm.nameEn.trim(),
        nameEn: groupForm.nameEn.trim() || undefined,
      });
      setGroupForm({ code: '', name: '', nameEn: '' });
      await load();
      toast.success(ar ? 'تمت إضافة المجموعة' : 'Group added');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error');
    }
  };

  const addCategory = async () => {
    if (!canEdit || !catForm.groupId || !catForm.code.trim() || !catForm.name.trim()) return;
    try {
      await materialsApi.createCategory({
        groupId: catForm.groupId,
        code: catForm.code.trim(),
        name: catForm.name.trim(),
        unit: catForm.unit,
      });
      setCatForm((f) => ({ ...f, code: '', name: '' }));
      await load();
      toast.success(ar ? 'تمت إضافة الصنف' : 'Category added');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error');
    }
  };

  const treeEmpty = !loading && filteredGroups.length === 0;

  return (
    <div className={splitRowCls(dir)}>
      <div className={splitMainCls()}>
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="animate-spin text-blue-500 w-6 h-6" />
          </div>
        ) : treeEmpty ? (
          <div className={splitEmptyPaneCls(theme)}>
            <Package className="w-14 h-14 mx-auto mb-3 opacity-25" />
            <p className={cn('text-sm', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>
              {t('inventory_filter_empty')}
            </p>
          </div>
        ) : (
          <MaterialsTreeView
            language={language}
            theme={theme}
            groups={filteredGroups}
            categories={filteredCategories}
          />
        )}
      </div>

      <aside className={splitSidebarCls(theme)}>
        <div>
          <h3 className="font-bold text-sm">{t('inventory_filter_title')}</h3>
        </div>

        <div className="space-y-3">
          <div>
            <label className={splitLabelCls(theme)}>{t('inventory_materials_search')}</label>
            <div className="relative">
              <Search className={cn('absolute top-2.5 w-4 h-4 opacity-50', ar ? 'right-3' : 'left-3')} />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('inventory_materials_search_placeholder')}
                className={cn(splitSelectCls(theme), ar ? 'pr-9' : 'pl-9', 'font-normal')}
              />
            </div>
          </div>
          <div>
            <label className={splitLabelCls(theme)}>{t('inventory_materials_filter_group')}</label>
            <select
              value={groupFilterId}
              onChange={(e) => setGroupFilterId(e.target.value === '' ? '' : Number(e.target.value))}
              className={splitSelectCls(theme)}
            >
              <option value="">{t('inventory_materials_all_groups')}</option>
              {groups.map((g, gi) => (
                <option key={listKey(g.id, gi, `mat-filter-${g.code}`)} value={g.id}>
                  {g.code} — {ar ? g.name : g.nameEn || g.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={cn('pt-3 border-t space-y-2', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
          <p className={splitSectionTitleCls()}>{t('inventory_materials_settings_title')}</p>
          <button type="button" onClick={handleExport} className={sidebarBtnCls(theme)} title={ar ? 'تصدير Excel' : 'Export Excel'}>
            <Download size={14} />
            {ar ? 'تصدير Excel' : 'Export Excel'}
          </button>
          {canEdit && (
            <>
              <button type="button" onClick={handleExportTemplate} className={sidebarBtnCls(theme)} title={ar ? 'تنزيل قالب فارغ' : 'Download blank template'}>
                <FileSpreadsheet size={14} />
                {ar ? 'تنزيل القالب' : 'Download template'}
              </button>
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                disabled={importing}
                className={cn(
                  sidebarBtnCls(theme),
                  'bg-emerald-600/10 border-emerald-600/40 text-emerald-600 hover:bg-emerald-600/20 disabled:opacity-50',
                )}
                title={ar ? 'استيراد من Excel' : 'Import from Excel'}
              >
                {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {ar ? 'استيراد Excel' : 'Import Excel'}
              </button>
            </>
          )}
          <input
            ref={importInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            aria-hidden
            onChange={(e) => void handleImportFile(e)}
          />
        </div>

        {canEdit && (
          <div className={cn('pt-3 border-t space-y-4', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
            <div className="space-y-2">
              <p className={splitSectionTitleCls()}>{ar ? 'مجموعة رئيسية' : 'Main group'}</p>
              <input className={input} placeholder="BLK" value={groupForm.code} onChange={(e) => setGroupForm((f) => ({ ...f, code: e.target.value }))} />
              <input className={input} placeholder={t('inventory_materials_name_ar')} value={groupForm.name} onChange={(e) => setGroupForm((f) => ({ ...f, name: e.target.value }))} />
              <input className={input} placeholder={t('inventory_materials_name_en')} value={groupForm.nameEn} onChange={(e) => setGroupForm((f) => ({ ...f, nameEn: e.target.value }))} />
              <button type="button" onClick={addGroup} className="w-full text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg flex items-center justify-center gap-1 transition-colors">
                <Plus size={14} />
                {ar ? 'إضافة مجموعة' : 'Add group'}
              </button>
            </div>
            <MaterialsCategoryForm
              language={language}
              input={input}
              catForm={catForm}
              setCatForm={setCatForm}
              groups={groups}
              addCategory={addCategory}
            />
          </div>
        )}

        <div className={cn('pt-3 border-t', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
          <ManualHelpButton topicId="inventory.materials.tree" size={16} />
        </div>
      </aside>
    </div>
  );
}

function MaterialsCategoryForm({
  language,
  input,
  catForm,
  setCatForm,
  groups,
  addCategory,
}: {
  language: string;
  input: string;
  catForm: { groupId: number; code: string; name: string; unit: string };
  setCatForm: React.Dispatch<React.SetStateAction<{ groupId: number; code: string; name: string; unit: string }>>;
  groups: MaterialGroup[];
  addCategory: () => void;
}) {
  const ar = language === 'ar';
  return (
    <div className="space-y-2">
      <p className={splitSectionTitleCls()}>{ar ? 'صنف' : 'Category'}</p>
      <select className={input} value={catForm.groupId || ''} onChange={(e) => setCatForm((f) => ({ ...f, groupId: Number(e.target.value) }))}>
        <option value="">{ar ? 'اختر المجموعة' : 'Select group'}</option>
        {groups.map((g, gi) => (
          <option key={listKey(g.id, gi, `mat-grp-${g.code}`)} value={g.id}>
            {g.code} — {ar ? g.name : g.nameEn || g.name}
          </option>
        ))}
      </select>
      <input className={input} placeholder="MTL-01-003" value={catForm.code} onChange={(e) => setCatForm((f) => ({ ...f, code: e.target.value }))} />
      <input className={input} placeholder={ar ? 'اسم الصنف' : 'Category name'} value={catForm.name} onChange={(e) => setCatForm((f) => ({ ...f, name: e.target.value }))} />
      <select className={input} value={catForm.unit} onChange={(e) => setCatForm((f) => ({ ...f, unit: e.target.value }))}>
        {UNITS.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>
      <button type="button" onClick={addCategory} className="w-full text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg flex items-center justify-center gap-1 transition-colors">
        <Plus size={14} />
        {ar ? 'إضافة صنف' : 'Add category'}
      </button>
    </div>
  );
}

function MaterialsTreeView({
  language,
  theme,
  groups,
  categories,
}: {
  language: string;
  theme: AppTheme;
  groups: MaterialGroup[];
  categories: MaterialCategory[];
}) {
  const ar = language === 'ar';
  const totalCategories = useMemo(
    () => groups.reduce((sum, g) => sum + categories.filter((c) => c.groupId === g.id).length, 0),
    [groups, categories],
  );

  return (
    <div className="space-y-4">
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3 text-sm',
          theme === 'dark' ? 'border-gray-800 bg-gray-900/50 text-gray-300' : 'border-gray-200 bg-gray-50 text-gray-600',
        )}
      >
        <span>
          {ar
            ? `${groups.length} مجموعة · ${totalCategories} صنف`
            : `${groups.length} group${groups.length === 1 ? '' : 's'} · ${totalCategories} categor${totalCategories === 1 ? 'y' : 'ies'}`}
        </span>
      </div>

      <div className="space-y-4 max-h-[calc(100vh-16rem)] overflow-y-auto pe-1">
        {groups.map((g, gi) => {
          const groupCategories = categories.filter((c) => c.groupId === g.id);
          return (
            <section
              key={listKey(g.id, gi, `mat-grp-card-${g.code}`)}
              className={cn(
                'rounded-xl border overflow-hidden shadow-sm',
                theme === 'dark' ? 'border-gray-800 bg-[#151619]' : 'border-gray-200 bg-white',
              )}
            >
              <header
                className={cn(
                  'flex items-start justify-between gap-3 px-4 py-3 border-b',
                  theme === 'dark' ? 'border-gray-800 bg-blue-950/30' : 'border-gray-100 bg-blue-50/80',
                )}
              >
                <div className="min-w-0">
                  <p className="font-mono text-xs font-bold text-blue-600 tracking-wide">{g.code}</p>
                  <h4 className={cn('font-bold text-base mt-0.5 leading-snug', theme === 'dark' ? 'text-gray-100' : 'text-gray-900')}>
                    {ar ? g.name : g.nameEn || g.name}
                  </h4>
                  {g.nameEn && ar && (
                    <p className={cn('text-xs mt-0.5 truncate', theme === 'dark' ? 'text-gray-400' : 'text-gray-500')}>
                      {g.nameEn}
                    </p>
                  )}
                  {!ar && g.nameEn && g.name && g.name !== g.nameEn && (
                    <p className={cn('text-xs mt-0.5 truncate', theme === 'dark' ? 'text-gray-400' : 'text-gray-500')}>
                      {g.name}
                    </p>
                  )}
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold',
                    theme === 'dark' ? 'bg-gray-800 text-gray-300' : 'bg-white text-gray-600 border border-gray-200',
                  )}
                >
                  {groupCategories.length} {ar ? 'صنف' : groupCategories.length === 1 ? 'item' : 'items'}
                </span>
              </header>

              {groupCategories.length === 0 ? (
                <p className={cn('px-4 py-4 text-sm', theme === 'dark' ? 'text-gray-500' : 'text-gray-400')}>
                  {ar ? 'لا توجد أصناف في هذه المجموعة.' : 'No categories in this group.'}
                </p>
              ) : (
                <ul className={cn('divide-y', theme === 'dark' ? 'divide-gray-800' : 'divide-gray-100')}>
                  {groupCategories.map((c, ci) => (
                    <li
                      key={listKey(c.id, ci, `mat-cat-row-${c.code}`)}
                      className={cn(
                        'grid grid-cols-[minmax(7rem,9rem)_1fr_auto] items-center gap-3 px-4 py-3 transition-colors',
                        theme === 'dark' ? 'hover:bg-gray-800/60' : 'hover:bg-gray-50/90',
                        ci % 2 === 1 && (theme === 'dark' ? 'bg-gray-900/40' : 'bg-gray-50/50'),
                      )}
                    >
                      <span
                        className={cn(
                          'font-mono text-xs font-semibold truncate rounded-md px-2 py-1',
                          theme === 'dark' ? 'bg-gray-800 text-blue-300' : 'bg-gray-100 text-blue-700',
                        )}
                        title={c.code}
                      >
                        {c.code}
                      </span>
                      <span className={cn('text-sm leading-relaxed min-w-0', theme === 'dark' ? 'text-gray-200' : 'text-gray-800')}>
                        {c.name}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold text-center min-w-[3rem]',
                          theme === 'dark' ? 'bg-gray-800 text-gray-300 border border-gray-700' : 'bg-white text-gray-700 border border-gray-200',
                        )}
                      >
                        {c.unit}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
