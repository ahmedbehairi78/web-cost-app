import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '../../lib/utils';
import { useLanguage } from '../../context/LanguageContext';
import { useChartOfAccountsRef } from '../../hooks/useChartOfAccountsRef';
import { costCentersApi, type CostCenterRow } from '../../services/local/modulesApi';
import { accountingService } from '../../services/accountingService';
import { SearchableSelect } from '../ui/SearchableSelect';

import type { AppTheme } from '../../lib/shellTheme';
type Theme = AppTheme;

export function IndirectExpensePanel({ theme }: { theme: Theme }) {
  const { t, language } = useLanguage();
  const { accounts } = useChartOfAccountsRef({ leafOnly: true });
  const [centers, setCenters] = useState<CostCenterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    costCenterId: '',
    expenseAccountCode: '',
    creditorAccountCode: '',
    amount: '',
    description: '',
    reference: '',
  });

  useEffect(() => {
    void costCentersApi.list('indirect').then((rows) => {
      setCenters(rows as CostCenterRow[]);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const expenseOptions = useMemo(
    () =>
      accounts
        .filter((a) => String(a.accountCode).startsWith('5') && String(a.accountCode).length === 8)
        .map((a) => ({
          value: a.accountCode as string,
          label: `${a.accountCode} — ${language === 'ar' ? a.accountName : a.accountNameEn || a.accountName}`,
        })),
    [accounts, language],
  );

  const creditorOptions = useMemo(
    () =>
      accounts
        .filter((a) => {
          const c = String(a.accountCode);
          return (c.startsWith('21101') || c.startsWith('12101')) && c.length === 8;
        })
        .map((a) => ({
          value: a.accountCode as string,
          label: `${a.accountCode} — ${language === 'ar' ? a.accountName : a.accountNameEn || a.accountName}`,
        })),
    [accounts, language],
  );

  const centerOptions = useMemo(
    () =>
      centers.map((c) => ({
        value: c.id,
        label: `${c.code} — ${language === 'ar' ? c.name : c.nameEn || c.name}`,
      })),
    [centers, language],
  );

  const inputCls = cn(
    'w-full border rounded-xl py-3 px-4 text-sm outline-none focus:border-blue-500',
    theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200',
  );

  const handleSubmit = useCallback(async () => {
    const amount = Number(String(form.amount).replace(/,/g, '')) || 0;
    if (!form.costCenterId || !form.expenseAccountCode || !form.creditorAccountCode || amount <= 0) {
      toast.error(t('indirect_centers_required'));
      return;
    }
    const expenseAcc = accounts.find((a) => a.accountCode === form.expenseAccountCode);
    const creditorAcc = accounts.find((a) => a.accountCode === form.creditorAccountCode);
    setSaving(true);
    try {
      await accountingService.createTransaction({
        date: form.date,
        description: form.description.trim() || t('indirect_expense_title'),
        reference: form.reference.trim() || undefined,
        costCenterId: form.costCenterId,
        entries: [
          {
            accountCode: form.expenseAccountCode,
            accountName: expenseAcc?.accountName || '',
            debit: amount,
            credit: 0,
            costCenterId: form.costCenterId,
          },
          {
            accountCode: form.creditorAccountCode,
            accountName: creditorAcc?.accountName || '',
            debit: 0,
            credit: amount,
          },
        ],
      });
      toast.success(t('indirect_expense_saved'));
      setForm((f) => ({ ...f, amount: '', description: '', reference: '' }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('indirect_expense_failed'));
    } finally {
      setSaving(false);
    }
  }, [accounts, form, t]);

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-blue-500" /></div>;
  }

  return (
    <div className={cn('max-w-2xl space-y-4 p-6 rounded-2xl border', theme === 'dark' ? 'border-gray-800 bg-gray-900/40' : 'border-gray-200 bg-white')}>
      <h3 className="text-lg font-bold">{t('indirect_expense_title')}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-xs text-gray-500 block mb-1">{t('mos_field_date')}</label>
          <input type="date" className={inputCls} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">{t('indirect_expense_center')}</label>
          <SearchableSelect
            value={form.costCenterId}
            onChange={(v) => setForm((f) => ({ ...f, costCenterId: v }))}
            theme={theme}
            options={centerOptions}
            placeholder={t('indirect_expense_center')}
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">{t('indirect_expense_account')}</label>
          <SearchableSelect
            value={form.expenseAccountCode}
            onChange={(v) => setForm((f) => ({ ...f, expenseAccountCode: v }))}
            theme={theme}
            options={expenseOptions}
            placeholder={t('indirect_expense_account')}
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">{t('indirect_expense_creditor')}</label>
          <SearchableSelect
            value={form.creditorAccountCode}
            onChange={(v) => setForm((f) => ({ ...f, creditorAccountCode: v }))}
            theme={theme}
            options={creditorOptions}
            placeholder={t('indirect_expense_creditor')}
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">{t('total_amount')}</label>
          <input className={inputCls} value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">{t('description')}</label>
          <input className={inputCls} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </div>
      </div>
      <button
        type="button"
        disabled={saving}
        onClick={() => void handleSubmit()}
        className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-xl font-bold"
      >
        {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
        {t('save')}
      </button>
    </div>
  );
}
