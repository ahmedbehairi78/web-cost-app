import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useLanguage } from '../../context/LanguageContext';
import { useConfirm } from '../../context/ConfirmDialogContext';
import { cn, listKey } from '../../lib/utils';
import type { AppTheme } from '../../lib/shellTheme';
import { isSoftLikeTheme } from '../../lib/shellTheme';
import { INDIRECT_COST_CENTER_PREFIX } from '../../lib/costCenterPicker';
import { costCentersApi } from '../../services/local/modulesApi';

type IndirectCenter = {
  id: string;
  code: string;
  name: string;
  nameEn?: string | null;
  isActive?: boolean;
};

type Props = {
  theme: AppTheme;
};

export function IndirectCostCentersPanel({ theme }: Props) {
  const { t, language } = useLanguage();
  const confirm = useConfirm();
  const [rows, setRows] = useState<IndirectCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', nameEn: '' });
  const [editId, setEditId] = useState<string | null>(null);
  const [nextCode, setNextCode] = useState('');

  const fetchNextCode = useCallback(async () => {
    try {
      const { code } = await costCentersApi.nextIndirectCode();
      setNextCode(code);
      if (!editId) {
        setForm((f) => ({ ...f, code: f.code.trim() ? f.code : code }));
      }
    } catch {
      /* admin-only; ignore for non-admin viewers */
    }
  }, [editId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = (await costCentersApi.list('indirect')) as IndirectCenter[];
      setRows(data);
    } catch {
      toast.error(t('indirect_centers_load_failed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
    void fetchNextCode();
  }, [load, fetchNextCode]);

  const inputCls = cn(
    'w-full border rounded-xl py-2 px-3 text-sm outline-none focus:border-blue-500',
    theme === 'dark'
      ? 'bg-gray-900 border-gray-800'
      : theme === 'erp'
        ? 'bg-white border-[#DEE2E6]'
        : isSoftLikeTheme(theme)
          ? 'bg-white border-[#cfd8dc]'
          : 'bg-white border-gray-200',
  );

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error(t('indirect_centers_required'));
      return;
    }
    setSaving(true);
    try {
      if (editId) {
        await costCentersApi.update(editId, {
          name: form.name.trim(),
          nameEn: form.nameEn.trim() || undefined,
        });
        toast.success(t('indirect_centers_updated'));
      } else {
        await costCentersApi.create({
          ...(form.code.trim() ? { code: form.code.trim() } : {}),
          name: form.name.trim(),
          nameEn: form.nameEn.trim() || undefined,
        });
        toast.success(t('indirect_centers_created'));
      }
      setForm({ code: '', name: '', nameEn: '' });
      setEditId(null);
      await load();
      await fetchNextCode();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('indirect_centers_save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (row: IndirectCenter) => {
    setEditId(row.id);
    setForm({ code: row.code, name: row.name, nameEn: row.nameEn ?? '' });
  };

  const handleDeactivate = async (row: IndirectCenter) => {
    const ok = await confirm({
      title: language === 'ar' ? 'تعطيل مركز التكلفة' : 'Deactivate cost center',
      message: t('indirect_centers_deactivate_confirm'),
      confirmLabel: language === 'ar' ? 'تعطيل' : 'Deactivate',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await costCentersApi.remove(row.id);
      toast.success(t('indirect_centers_deactivated'));
      if (editId === row.id) {
        setEditId(null);
        setForm({ code: nextCode, name: '', nameEn: '' });
      }
      await load();
      await fetchNextCode();
    } catch {
      toast.error(t('indirect_centers_save_failed'));
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-400">{t('indirect_centers_help')}</p>
      <p className="text-xs text-gray-500">
        {t('indirect_centers_code_hint')} ({INDIRECT_COST_CENTER_PREFIX}001…)
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-gray-500 uppercase">{t('indirect_centers_code')}</span>
            {!editId && nextCode && (
              <button
                type="button"
                onClick={() => void fetchNextCode()}
                className="text-[10px] text-blue-400 inline-flex items-center gap-1"
                title={t('indirect_centers_next_code')}
              >
                <RefreshCw size={10} /> {nextCode}
              </button>
            )}
          </div>
          <input
            className={inputCls}
            placeholder={nextCode || t('indirect_centers_code')}
            value={form.code}
            disabled={!!editId}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
          />
        </div>
        <input
          className={inputCls}
          placeholder={t('indirect_centers_name')}
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
        <input
          className={inputCls}
          placeholder={t('indirect_centers_name_en')}
          value={form.nameEn}
          onChange={(e) => setForm((f) => ({ ...f, nameEn: e.target.value }))}
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl text-sm font-bold"
        >
          {saving ? <Loader2 className="animate-spin" size={16} /> : editId ? <Save size={16} /> : <Plus size={16} />}
          {editId ? t('save') : t('indirect_centers_add')}
        </button>
        {editId && (
          <button
            type="button"
            onClick={() => {
              setEditId(null);
              setForm({ code: nextCode, name: '', nameEn: '' });
            }}
            className="px-4 py-2 rounded-xl text-sm border border-gray-600"
          >
            {t('cancel')}
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="animate-spin text-blue-500" /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400">
                <th className="py-2 text-start">{t('indirect_centers_code')}</th>
                <th className="py-2 text-start">{t('indirect_centers_name')}</th>
                <th className="py-2 text-start">{t('status')}</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={listKey(row.id, ri, 'indirect-cc')} className="border-b border-gray-800/50">
                  <td className="py-2 font-mono">{row.code}</td>
                  <td className="py-2">{language === 'ar' ? row.name : row.nameEn || row.name}</td>
                  <td className="py-2">{row.isActive === false ? t('inactive') : t('active')}</td>
                  <td className="py-2 text-end space-x-2 rtl:space-x-reverse">
                    <button type="button" className="text-blue-400 text-xs font-bold" onClick={() => handleEdit(row)}>
                      {t('edit')}
                    </button>
                    <button type="button" className="text-red-400 text-xs font-bold inline-flex items-center gap-1" onClick={() => void handleDeactivate(row)}>
                      <Trash2 size={12} /> {t('deactivate')}
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-gray-500">{t('indirect_centers_empty')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
