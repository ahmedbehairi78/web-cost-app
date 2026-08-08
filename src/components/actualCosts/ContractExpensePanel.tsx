import { useCallback, useMemo, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '../../lib/utils';
import { useLanguage } from '../../context/LanguageContext';
import { useChartOfAccountsRef } from '../../hooks/useChartOfAccountsRef';
import { contractExpenseOrdersApi } from '../../services/local/modulesApi';
import { SearchableSelect } from '../ui/SearchableSelect';
import { ContractBoqAmountModal, type ContractBoqRow } from './ContractBoqAmountModal';

import type { AppTheme } from '../../lib/shellTheme';
type Theme = AppTheme;

type Project = { id: string; projectName: string };
type Contract = { id: string; projectId: string; contractName: string; contractNumber?: string };
type BoqItem = {
  id: string;
  contractId?: string;
  itemCode?: string;
  description?: string;
  tenderQty?: number;
  tenderAmount?: number;
  unitRateTotal?: number;
};

export function ContractExpensePanel({
  theme,
  projects,
  contracts,
  boqItems,
}: {
  theme: Theme;
  projects: Project[];
  contracts: Contract[];
  boqItems: BoqItem[];
}) {
  const { t, language } = useLanguage();
  const { accounts } = useChartOfAccountsRef({ leafOnly: true });
  const [saving, setSaving] = useState(false);
  const [showAlloc, setShowAlloc] = useState(false);
  const [allocLines, setAllocLines] = useState<Array<{ boqItemId: string; amount: number }>>([]);
  const [form, setForm] = useState({
    projectId: '',
    contractId: '',
    date: new Date().toISOString().slice(0, 10),
    expenseAccountCode: '',
    creditorAccountCode: '',
    totalAmount: '',
    description: '',
    referenceNumber: '',
  });

  const contractOptions = useMemo(
    () =>
      contracts
        .filter((c) => !form.projectId || c.projectId === form.projectId)
        .map((c) => ({ value: c.id, label: `${c.contractNumber || ''} — ${c.contractName}` })),
    [contracts, form.projectId],
  );

  const boqRows: ContractBoqRow[] = useMemo(
    () =>
      boqItems
        .filter((b) => b.contractId === form.contractId)
        .map((b) => ({
          boqItemId: b.id,
          itemCode: b.itemCode || b.id,
          description: b.description || '',
          tenderQty: Number(b.tenderQty) || 0,
          tenderAmount: Number(b.tenderAmount) || 0,
          unitRateTotal: Number(b.unitRateTotal) || 0,
        })),
    [boqItems, form.contractId],
  );

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

  const inputCls = cn(
    'w-full border rounded-xl py-3 px-4 text-sm outline-none focus:border-blue-500',
    theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200',
  );

  const totalAmount = Number(String(form.totalAmount).replace(/,/g, '')) || 0;

  const handleSubmit = useCallback(async () => {
    if (!form.projectId || !form.contractId || totalAmount <= 0 || !allocLines.length) {
      toast.error(t('indirect_centers_required'));
      return;
    }
    const expenseAcc = accounts.find((a) => a.accountCode === form.expenseAccountCode);
    const creditorAcc = accounts.find((a) => a.accountCode === form.creditorAccountCode);
    setSaving(true);
    try {
      const draft = (await contractExpenseOrdersApi.create({
        projectId: form.projectId,
        contractId: form.contractId,
        orderDate: form.date,
        expenseAccountCode: form.expenseAccountCode,
        expenseAccountName: expenseAcc?.accountName,
        creditorAccountCode: form.creditorAccountCode,
        creditorAccountName: creditorAcc?.accountName,
        totalAmount,
        description: form.description,
        referenceNumber: form.referenceNumber || undefined,
        lines: allocLines,
      })) as { id: number };
      await contractExpenseOrdersApi.confirm(draft.id);
      toast.success(t('contract_expense_saved'));
      setAllocLines([]);
      setForm((f) => ({ ...f, totalAmount: '', description: '', referenceNumber: '' }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('contract_expense_failed'));
    } finally {
      setSaving(false);
    }
  }, [accounts, allocLines, form, totalAmount, t]);

  return (
    <>
      <div className={cn('max-w-2xl space-y-4 p-6 rounded-2xl border', theme === 'dark' ? 'border-gray-800 bg-gray-900/40' : 'border-gray-200 bg-white')}>
        <h3 className="text-lg font-bold">{t('contract_expense_title')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-500 block mb-1">{t('project_name')}</label>
            <SearchableSelect value={form.projectId} onChange={(v) => setForm((f) => ({ ...f, projectId: v, contractId: '' }))} theme={theme} options={projects.map((p) => ({ value: p.id, label: p.projectName }))} placeholder={t('project_name')} />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">{language === 'ar' ? 'العقد' : 'Contract'}</label>
            <SearchableSelect value={form.contractId} onChange={(v) => setForm((f) => ({ ...f, contractId: v }))} theme={theme} options={contractOptions} placeholder={language === 'ar' ? 'العقد' : 'Contract'} />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">{t('mos_field_date')}</label>
            <input type="date" className={inputCls} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">{t('total_amount')}</label>
            <input className={inputCls} value={form.totalAmount} onChange={(e) => setForm((f) => ({ ...f, totalAmount: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">{t('indirect_expense_account')}</label>
            <SearchableSelect value={form.expenseAccountCode} onChange={(v) => setForm((f) => ({ ...f, expenseAccountCode: v }))} theme={theme} options={expenseOptions} placeholder="" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">{t('indirect_expense_creditor')}</label>
            <SearchableSelect value={form.creditorAccountCode} onChange={(v) => setForm((f) => ({ ...f, creditorAccountCode: v }))} theme={theme} options={creditorOptions} placeholder="" />
          </div>
        </div>
        <button
          type="button"
          disabled={!form.contractId || totalAmount <= 0}
          className="px-4 py-2 rounded-xl border border-blue-500 text-blue-500 font-bold"
          onClick={() => setShowAlloc(true)}
        >
          {t('contract_expense_allocate')} ({allocLines.length})
        </button>
        {allocLines.length > 0 && (
          <ul className="text-xs text-gray-400 space-y-1">
            {allocLines.map((l) => {
              const row = boqRows.find((r) => r.boqItemId === l.boqItemId);
              return (
                <li key={l.boqItemId}>{row?.itemCode} — {l.amount}</li>
              );
            })}
          </ul>
        )}
        <button
          type="button"
          disabled={saving || !allocLines.length}
          onClick={() => void handleSubmit()}
          className="inline-flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white px-5 py-2 rounded-xl font-bold"
        >
          {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
          {t('save')}
        </button>
      </div>
      <ContractBoqAmountModal
        open={showAlloc}
        totalAmount={totalAmount}
        rows={boqRows}
        theme={theme}
        onClose={() => setShowAlloc(false)}
        onApply={setAllocLines}
      />
    </>
  );
}
