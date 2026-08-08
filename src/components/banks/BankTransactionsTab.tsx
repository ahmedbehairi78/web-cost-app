import React, { useMemo, useState } from 'react';
import { ListChecks, Plus, Wallet } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Account } from '../../services/accountingService';
import type { BankAccount, BankCheque, BankMovement } from './types';
import { BankMovementsTab } from './BankMovementsTab';
import { BankChequesTab } from './BankChequesTab';

type TxKind = 'movement' | 'cheque';

type MainView =
  | { mode: 'empty' }
  | { mode: 'create'; kind: TxKind }
  | { mode: 'detail'; kind: TxKind; id: string };

type Props = {
  movements: BankMovement[];
  cheques: BankCheque[];
  accounts: BankAccount[];
  coaAccounts: Account[];
  balanceByCode: Map<string, number>;
  glBalancesLoading?: boolean;
  dir: 'rtl' | 'ltr';
  language: 'ar' | 'en';
  theme: string;
  allowCreate: boolean;
  allowEdit: boolean;
  banksEdit: boolean;
  ledgerCreate: boolean;
  onMutated?: () => void;
  t: (key: string) => string;
};

type FilterKind = 'all' | 'movement' | 'cheque';

function splitSidebarCls(theme: string) {
  return cn(
    'rounded-xl border p-4 w-full md:flex-[2] md:min-w-[17rem] md:max-w-[24rem] shrink-0 space-y-4 md:sticky md:top-4 order-1 md:order-none',
    theme === 'dark'
      ? 'border-gray-800 bg-[#151619]'
      : theme === 'soft'
        ? 'border-[#cfd8dc] bg-white'
        : 'border-gray-200 bg-white',
  );
}

function splitMainCls() {
  return 'flex-1 min-w-0 md:flex-[3] space-y-4 order-2 md:order-none';
}

function splitRowCls(dir: string) {
  return cn('flex flex-col md:flex-row md:items-start gap-4', dir === 'rtl' ? 'md:flex-row-reverse' : '');
}

function splitActiveListBtn(active: boolean, theme: string) {
  return cn(
    'w-full text-start px-2.5 py-2 rounded-lg text-sm border transition-colors',
    active
      ? 'bg-blue-600 text-white border-blue-600'
      : theme === 'dark'
        ? 'border-gray-800 hover:bg-gray-800/80 text-gray-200'
        : 'border-gray-200 hover:bg-gray-50 text-gray-800',
  );
}

function panelCls(theme: string) {
  return cn(
    'rounded-xl border p-4 md:p-5 shadow-sm',
    theme === 'dark'
      ? 'border-gray-800 bg-[#151619]'
      : theme === 'soft'
        ? 'border-[#cfd8dc] bg-white'
        : 'border-gray-200 bg-white',
  );
}

export function BankTransactionsTab({
  movements,
  cheques,
  accounts,
  coaAccounts,
  balanceByCode,
  glBalancesLoading = false,
  dir,
  language,
  theme,
  allowCreate,
  allowEdit,
  banksEdit,
  ledgerCreate,
  onMutated,
  t,
}: Props) {
  const isAr = language === 'ar';
  const [mainView, setMainView] = useState<MainView>({ mode: 'empty' });
  const [filterKind, setFilterKind] = useState<FilterKind>('all');
  const [filterBankId, setFilterBankId] = useState('');
  const [query, setQuery] = useState('');

  const inputCls = cn(
    'w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500 transition-colors',
    theme === 'dark'
      ? 'bg-gray-900 border-gray-700 text-white'
      : theme === 'soft'
        ? 'bg-white border-[#cfd8dc] text-[#37474f]'
        : 'bg-white border-gray-300 text-gray-900',
  );

  const listItems = useMemo(() => {
    const items: { kind: TxKind; id: string; label: string; date: string }[] = [];
    if (filterKind !== 'cheque') {
      for (const m of movements) {
        if (filterBankId && m.bankAccountId !== filterBankId) continue;
        const label = m.documentNo?.trim() || (isAr ? 'حركة بنكية' : 'Bank movement');
        const q = query.trim().toLowerCase();
        if (q && !label.toLowerCase().includes(q) && !m.reference?.toLowerCase().includes(q)) continue;
        items.push({ kind: 'movement', id: m.id, label, date: m.date });
      }
    }
    if (filterKind !== 'movement') {
      for (const c of cheques) {
        if (filterBankId && c.bankAccountId !== filterBankId) continue;
        const label = c.chequeNo?.trim() || (isAr ? 'شيك' : 'Cheque');
        const q = query.trim().toLowerCase();
        if (q && !label.toLowerCase().includes(q) && !(c.payeeName || '').toLowerCase().includes(q)) continue;
        items.push({ kind: 'cheque', id: c.id, label, date: c.issueDate });
      }
    }
    return items.sort((a, b) => b.date.localeCompare(a.date) || a.label.localeCompare(b.label));
  }, [movements, cheques, filterKind, filterBankId, query, isAr]);

  const selectItem = (kind: TxKind, id: string) => {
    setMainView({ mode: 'detail', kind, id });
  };

  const openCreate = (kind: TxKind) => {
    if (!allowCreate) return;
    setMainView({ mode: 'create', kind });
  };

  const clearMain = () => setMainView({ mode: 'empty' });

  const isSelected = (kind: TxKind, id: string) =>
    mainView.mode === 'detail' && mainView.kind === kind && mainView.id === id;

  const detailTitle = (() => {
    if (mainView.mode === 'create') {
      return mainView.kind === 'movement' ? t('banks_transactions_new_movement') : t('banks_transactions_new_cheque');
    }
    if (mainView.mode === 'detail') {
      const item = listItems.find((x) => x.kind === mainView.kind && x.id === mainView.id);
      return item?.label ?? '';
    }
    return '';
  })();

  const sharedTabProps = {
    accounts,
    coaAccounts,
    balanceByCode,
    glBalancesLoading,
    dir,
    language,
    theme,
    allowCreate,
    allowEdit,
    banksEdit,
    ledgerCreate,
    onMutated,
    embedded: true as const,
  };

  return (
    <div className={splitRowCls(dir)}>
      <div className={splitMainCls()}>
        {mainView.mode === 'empty' ? (
          <div className={cn(panelCls(theme), 'flex flex-col items-center justify-center min-h-[280px] text-center')}>
            <p className="text-sm text-gray-500">{t('banks_filter_select_transaction')}</p>
            {allowCreate ? (
              <div className="mt-4 flex flex-wrap gap-2 justify-center">
                <button
                  type="button"
                  onClick={() => openCreate('movement')}
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold bg-blue-600 text-white"
                >
                  <Wallet size={16} />
                  {t('banks_transactions_new_movement')}
                </button>
                <button
                  type="button"
                  onClick={() => openCreate('cheque')}
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold border border-blue-600 text-blue-600 hover:bg-blue-500/10"
                >
                  <ListChecks size={16} />
                  {t('banks_transactions_new_cheque')}
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className={panelCls(theme)}>
            {detailTitle ? (
              <div className={cn('mb-4 pb-3 border-b', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
                <h3 className="font-bold text-base">{detailTitle}</h3>
                <p className="text-xs text-gray-500 mt-1">{t('banks_screen_transactions_subtitle')}</p>
              </div>
            ) : null}
            {mainView.mode === 'create' && mainView.kind === 'movement' ? (
              <BankMovementsTab
                {...sharedTabProps}
                movements={movements}
                panelMode="create"
                onCancelCreate={clearMain}
                onMovementCreated={(id) => setMainView({ mode: 'detail', kind: 'movement', id })}
              />
            ) : null}
            {mainView.mode === 'create' && mainView.kind === 'cheque' ? (
              <BankChequesTab
                {...sharedTabProps}
                cheques={cheques}
                panelMode="create"
                onCancelCreate={clearMain}
                onChequeCreated={(id) => setMainView({ mode: 'detail', kind: 'cheque', id })}
              />
            ) : null}
            {mainView.mode === 'detail' && mainView.kind === 'movement' ? (
              <BankMovementsTab
                {...sharedTabProps}
                movements={movements}
                panelMode="detail"
                selectedMovementId={mainView.id}
                onDetailRemoved={clearMain}
              />
            ) : null}
            {mainView.mode === 'detail' && mainView.kind === 'cheque' ? (
              <BankChequesTab
                {...sharedTabProps}
                cheques={cheques}
                panelMode="detail"
                selectedChequeId={mainView.id}
                onDetailRemoved={clearMain}
              />
            ) : null}
          </div>
        )}
      </div>

      <aside className={splitSidebarCls(theme)}>
        <div>
          <h3 className="font-bold text-sm">{t('banks_screen_transactions_title')}</h3>
        </div>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={!allowCreate}
            onClick={() => openCreate('movement')}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
          >
            <Wallet size={16} />
            {t('banks_transactions_new_movement')}
          </button>
          <button
            type="button"
            disabled={!allowCreate}
            onClick={() => openCreate('cheque')}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-blue-600 text-blue-600 hover:bg-blue-500/10 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
          >
            <ListChecks size={16} />
            {t('banks_transactions_new_cheque')}
          </button>
        </div>
        <div className="flex flex-wrap gap-1">
          {(
            [
              { id: 'all' as const, label: isAr ? 'الكل' : 'All' },
              { id: 'movement' as const, label: isAr ? 'حركات' : 'Movements' },
              { id: 'cheque' as const, label: isAr ? 'شيكات' : 'Cheques' },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilterKind(f.id)}
              className={cn(
                'px-2.5 py-1 rounded-lg text-xs font-bold',
                filterKind === f.id ? 'bg-blue-600 text-white' : 'bg-gray-500/10 text-gray-600',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select
          aria-label="filter bank"
          className={inputCls}
          value={filterBankId}
          onChange={(e) => setFilterBankId(e.target.value)}
        >
          <option value="">{isAr ? 'كل الحسابات' : 'All accounts'}</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {isAr ? a.nameAr : a.nameEn || a.nameAr}
            </option>
          ))}
        </select>
        <input
          aria-label="search transactions"
          className={inputCls}
          placeholder={isAr ? 'بحث…' : 'Search…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul className="space-y-1 max-h-[min(60vh,28rem)] overflow-y-auto">
          {listItems.length === 0 ? (
            <li className="text-xs text-gray-500 py-4 text-center">
              {isAr ? 'لا توجد معاملات.' : 'No transactions.'}
            </li>
          ) : (
            listItems.map((item) => (
              <li key={`${item.kind}-${item.id}`}>
                <button
                  type="button"
                  onClick={() => selectItem(item.kind, item.id)}
                  className={splitActiveListBtn(isSelected(item.kind, item.id), theme)}
                >
                  <span className="font-semibold truncate block">{item.label}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </aside>
    </div>
  );
}
