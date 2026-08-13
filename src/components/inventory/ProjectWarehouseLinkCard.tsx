import React from 'react';
import { Loader2, Plus } from 'lucide-react';
import { cn, compositeListKey } from '../../lib/utils';
import { ManualHelpButton } from '../help/ManualHelpButton';
import { inputCls, type Theme } from './inventoryUiShared';

export type WarehouseLinkAccount = {
  id: string;
  accountCode: string;
  accountName: string;
  accountNameEn?: string;
  projectId?: string;
};

export function ProjectWarehouseLinkCard({
  theme,
  ar,
  selectedProject,
  linked,
  accounts,
  selectedAccountId,
  onSelectAccountId,
  loading,
  onCreate,
  onLink,
  onUnlink,
}: {
  theme: Theme;
  ar: boolean;
  selectedProject: string;
  linked?: WarehouseLinkAccount;
  accounts: WarehouseLinkAccount[];
  selectedAccountId: string;
  onSelectAccountId: (id: string) => void;
  loading: boolean;
  onCreate: () => void;
  onLink: () => void;
  onUnlink: () => void;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border p-4 flex flex-col gap-3',
        theme === 'dark' ? 'border-gray-700 bg-gray-900/40' : 'border-gray-200 bg-white',
      )}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <div>
            <p className={cn('text-sm font-bold', theme === 'dark' ? 'text-gray-100' : 'text-gray-800')}>
              {ar ? 'حساب مخزن المشروع' : 'Project Warehouse Account'}
            </p>
            <p className={cn('text-xs mt-1', theme === 'dark' ? 'text-gray-400' : 'text-gray-500')}>
              {linked
                ? `${linked.accountCode} — ${ar ? linked.accountName : linked.accountNameEn || linked.accountName}`
                : ar
                  ? 'اربط حساب مخزن 127… أولاً حتى يعمل استيراد الأرصدة الافتتاحية.'
                  : 'Link a 127… warehouse account first so opening-balance import can run.'}
            </p>
          </div>
          <ManualHelpButton topicId="inventory.receipt.purchase" size={14} />
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={selectedAccountId}
          onChange={(e) => onSelectAccountId(e.target.value)}
          title={ar ? 'اختيار حساب المخزن من شجرة الحسابات' : 'Select warehouse account from chart of accounts'}
          aria-label={ar ? 'اختيار حساب المخزن من شجرة الحسابات' : 'Select warehouse account from chart of accounts'}
          className={cn(inputCls(theme), 'min-w-72')}
        >
          <option value="">
            {ar ? '— اختر حساب مخزن من شجرة الحسابات —' : '— Select warehouse account from COA —'}
          </option>
          {accounts.map((a, ai) => (
            <option key={compositeListKey(a.accountCode, a.id, ai, 'wh-coa')} value={a.id || a.accountCode}>
              {a.accountCode} — {ar ? a.accountName : a.accountNameEn || a.accountName}
              {String(a.projectId || '').trim() === selectedProject ? (ar ? ' (مربوط حالياً)' : ' (linked)') : ''}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={onCreate}
          disabled={loading || !!linked}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {ar ? 'إضافة مخزن' : 'Add Warehouse'}
        </button>

        <button
          type="button"
          onClick={onLink}
          disabled={loading || !selectedAccountId}
          className={cn(
            'px-3 py-2 rounded-lg text-sm border transition-colors disabled:opacity-50',
            theme === 'dark'
              ? 'border-gray-600 text-gray-200 hover:bg-gray-800'
              : 'border-gray-300 text-gray-700 hover:bg-gray-50',
          )}
        >
          {ar ? 'ربط الحساب المختار' : 'Link Selected Account'}
        </button>

        <button
          type="button"
          onClick={onUnlink}
          disabled={loading || !linked}
          className="px-3 py-2 rounded-lg text-sm border border-red-400 text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
        >
          {ar ? 'حذف المخزن' : 'Delete Warehouse'}
        </button>
      </div>

      {accounts.length === 0 && (
        <p className="text-[11px] text-amber-500">
          {ar
            ? 'لا توجد حسابات مخزن متاحة تحت 127 بكود 8 أرقام. استخدم زر إضافة مخزن لإنشاء حساب جديد.'
            : 'No available 8-digit warehouse accounts under 127. Use Add Warehouse to create one.'}
        </p>
      )}
    </div>
  );
}
