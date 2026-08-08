import React, { useEffect, useMemo, useState } from 'react';
import { Pencil, Printer } from 'lucide-react';
import { collection, doc, getDoc, query, where, orderBy, limit } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { listenQuery } from '../../lib/firestoreListen';
import { cn } from '../../lib/utils';
import { isLocalBackend } from '../../lib/dataBackend';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useReportDocumentPreview } from '../../hooks/useReportDocumentPreview';
import { useLanguage } from '../../context/LanguageContext';
import type { CompanyPrintInfo } from '../../lib/ipcPrintData';
import type { Account } from '../../services/accountingService';
import type { BankAccount } from './types';
import { SearchableSelect } from '../ui/SearchableSelect';
import {
  contractsApi,
  costCentersApi,
  glApi,
  projectsApi,
  settingsApi,
} from '../../services/local/modulesApi';
import { LISTENER_GL_TX_SCREEN_CAP } from '../../constants/dataLimits';
import {
  formatCounterpartLine,
  resolveCounterpartEntries,
  resolveEntryCostCenterLine,
  resolveEntrySide,
  resolveTxDescription,
} from '../../lib/glBilingual';
import { formatMoney as formatMoneyLib } from '../../lib/money';
import { displayLocale } from '../../lib/numberLocale';

interface GlTransaction {
  id: string;
  date: string;
  description: string;
  descriptionEn?: string | null;
  reference?: string;
  costCenterId?: string;
  projectId?: string;
  entries?: {
    accountCode: string;
    accountName?: string;
    debit: number;
    credit: number;
    costCenterId?: string | null;
  }[];
}

type Props = {
  bankAccounts: BankAccount[];
  coaAccounts: Account[];
  language: 'ar' | 'en';
  dir: 'rtl' | 'ltr';
  theme: string;
  /** Pre-select account — hides bank picker (embedded in accounts split-view). */
  bankAccountId?: string;
  embedded?: boolean;
  allowEdit?: boolean;
  onEditAccount?: () => void;
};

export function BankAccountStatementPanel({
  bankAccounts,
  coaAccounts,
  language,
  dir,
  theme,
  bankAccountId: fixedBankAccountId,
  embedded = false,
  allowEdit = false,
  onEditAccount,
}: Props) {
  const isAr = language === 'ar';
  const fiscalYear = new Date().getFullYear();
  const formatMoney = (value: number) => formatMoneyLib(value);
  const { t } = useLanguage();

  const [companyInfo, setCompanyInfo] = useState<CompanyPrintInfo>({
    companyName: '',
    companyNameEn: '',
    headerLogo: '',
  });
  const [selectedBankId, setSelectedBankId] = useState(fixedBankAccountId ?? '');
  const [dateFrom, setDateFrom] = useState(`${fiscalYear}-01-01`);
  const [dateTo, setDateTo] = useState(`${fiscalYear}-12-31`);
  const [fsTransactions, setFsTransactions] = useState<GlTransaction[]>([]);
  const [contractsMap, setContractsMap] = useState(new Map<string, { contractName?: string; contractNumber?: string; projectId?: string }>());
  const [projectsMap, setProjectsMap] = useState(new Map<string, { projectName?: string; projectCode?: string }>());
  const [indirectCentersMap, setIndirectCentersMap] = useState(new Map<string, { name: string; nameEn?: string | null }>());

  useEffect(() => {
    if (fixedBankAccountId) setSelectedBankId(fixedBankAccountId);
  }, [fixedBankAccountId]);

  const activeBanks = useMemo(
    () => (embedded && fixedBankAccountId ? bankAccounts : bankAccounts.filter((b) => b.isActive)),
    [bankAccounts, embedded, fixedBankAccountId],
  );

  const selectedBank = useMemo(
    () => activeBanks.find((b) => b.id === selectedBankId) ?? bankAccounts.find((b) => b.id === selectedBankId),
    [activeBanks, bankAccounts, selectedBankId],
  );

  const accountCode = useMemo(() => {
    if (!selectedBank) return '';
    const linked = selectedBank.coaAccountId
      ? coaAccounts.find((c) => c.id === selectedBank.coaAccountId)
      : coaAccounts.find((c) => c.accountCode === selectedBank.code);
    return String(linked?.accountCode || selectedBank.code || '').trim();
  }, [selectedBank, coaAccounts]);

  const accountName = useMemo(() => {
    if (!accountCode) return '';
    const acc = coaAccounts.find((c) => c.accountCode === accountCode);
    if (!acc) return selectedBank ? (isAr ? selectedBank.nameAr : selectedBank.nameEn || selectedBank.nameAr) : '';
    return isAr ? acc.accountName : (acc.accountNameEn || acc.accountName);
  }, [accountCode, coaAccounts, selectedBank, isAr]);

  const { data: apiTransactions } = useApiQuery<GlTransaction[]>(
    () => glApi.transactions(fiscalYear, LISTENER_GL_TX_SCREEN_CAP) as Promise<GlTransaction[]>,
    [fiscalYear],
    { enabled: isLocalBackend && Boolean(selectedBankId) },
  );

  const transactions = isLocalBackend ? (apiTransactions ?? []) : fsTransactions;

  useEffect(() => {
    if (isLocalBackend || !selectedBankId) return;
    const y = fiscalYear;
    const q = query(
      collection(db, 'transactions'),
      where('isDeleted', '==', false),
      where('date', '>=', `${y}-01-01`),
      where('date', '<=', `${y}-12-31`),
      orderBy('date', 'asc'),
      limit(LISTENER_GL_TX_SCREEN_CAP),
    );
    return listenQuery(
      q,
      (snap) => {
        setFsTransactions(
          snap.docs.map((d) => ({ ...d.data(), id: d.id } as GlTransaction)),
        );
      },
      (err) => handleFirestoreError(err, OperationType.READ, 'transactions'),
    );
  }, [fiscalYear, selectedBankId]);

  useEffect(() => {
    const load = async () => {
      try {
        if (isLocalBackend) {
          const res = await settingsApi.getCompanyInfo();
          if (res.value) setCompanyInfo((prev) => ({ ...prev, ...res.value }));
          const [contracts, projects, centers] = await Promise.all([
            contractsApi.list() as Promise<Array<{ id: string; contractName?: string; contractNumber?: string; projectId?: string }>>,
            projectsApi.list() as Promise<Array<{ id: string; projectName?: string; projectCode?: string }>>,
            costCentersApi.list('indirect'),
          ]);
          setContractsMap(new Map(contracts.map((c) => [c.id, c])));
          setProjectsMap(new Map(projects.map((p) => [p.id, p])));
          setIndirectCentersMap(
            new Map(
              (centers as Array<{ id: string; name: string; nameEn?: string | null }>).map((c) => [
                c.id,
                { name: c.name, nameEn: c.nameEn },
              ]),
            ),
          );
          return;
        }
        const settingsDoc = await getDoc(doc(db, 'settings', 'company_info'));
        if (settingsDoc.exists()) {
          setCompanyInfo((prev) => ({ ...prev, ...(settingsDoc.data() as CompanyPrintInfo) }));
        }
      } catch {
        /* defaults */
      }
    };
    void load();
  }, [language]);

  useEffect(() => {
    if (isLocalBackend) return;
    const unsubContracts = listenQuery(
      query(collection(db, 'contracts')),
      (snap) => {
        setContractsMap(
          new Map(
            snap.docs
              .filter((d) => d.data().isDeleted !== true)
              .map((d) => {
                const data = d.data() as { contractName?: string; contractNumber?: string; projectId?: string };
                return [d.id, { ...data, id: d.id }] as const;
              }),
          ),
        );
      },
      (err) => handleFirestoreError(err, OperationType.READ, 'contracts'),
    );
    const unsubProjects = listenQuery(
      query(collection(db, 'projects')),
      (snap) => {
        setProjectsMap(
          new Map(
            snap.docs
              .filter((d) => d.data().isDeleted !== true)
              .map((d) => {
                const data = d.data() as { projectName?: string; projectCode?: string };
                return [d.id, { ...data, id: d.id }] as const;
              }),
          ),
        );
      },
      (err) => handleFirestoreError(err, OperationType.READ, 'projects'),
    );
    return () => {
      unsubContracts();
      unsubProjects();
    };
  }, []);

  const statementRows = useMemo(() => {
    if (!accountCode) return [];
    const code = accountCode;
    const rows: { tx: GlTransaction; entry: NonNullable<GlTransaction['entries']>[number] }[] = [];
    for (const tx of transactions) {
      for (const entry of tx.entries ?? []) {
        if (String(entry.accountCode ?? '').trim() === code) {
          rows.push({ tx, entry });
        }
      }
    }
    return rows
      .filter((r) => r.tx.date >= dateFrom && r.tx.date <= dateTo)
      .sort(
        (a, b) =>
          new Date(a.tx.date).getTime() - new Date(b.tx.date).getTime()
          || String(a.tx.reference ?? a.tx.id).localeCompare(String(b.tx.reference ?? b.tx.id)),
      );
  }, [transactions, accountCode, dateFrom, dateTo]);

  const periodLabel = useMemo(() => {
    const d0 = new Date(`${dateFrom}T12:00:00`);
    const d1 = new Date(`${dateTo}T12:00:00`);
    const fmt = (d: Date) =>
      d.toLocaleDateString(displayLocale(language), { year: 'numeric', month: 'short', day: 'numeric' });
    return isAr ? `من ${fmt(d0)} إلى ${fmt(d1)}` : `${fmt(d0)} – ${fmt(d1)}`;
  }, [dateFrom, dateTo, isAr, language]);

  const inputCls = cn(
    'w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500 transition-colors',
    theme === 'dark'
      ? 'bg-gray-900 border-gray-700 text-white'
      : theme === 'soft'
        ? 'bg-white border-[#cfd8dc] text-[#37474f]'
        : 'bg-white border-gray-300 text-gray-900',
  );

  const panelCls = cn(
    embedded ? 'space-y-4' : 'rounded-xl border p-4 space-y-4',
    !embedded && (
      theme === 'dark'
        ? 'border-gray-800 bg-[#151619]'
        : theme === 'soft'
          ? 'border-[#cfd8dc] bg-white'
          : 'border-gray-200 bg-white'
    ),
  );

  const tablePanelCls = cn(
    embedded ? 'overflow-hidden' : 'border rounded-xl overflow-hidden',
    !embedded && panelCls,
  );

  const { openDocPreview, ReportPreviewHost } = useReportDocumentPreview({
    language,
    t,
    formatMoney,
    companyInfo,
  });

  const handlePrint = () => {
    if (!accountCode || !selectedBank) return;
    let balance = 0;
    let totalDebit = 0;
    let totalCredit = 0;
    const rows = statementRows.map(({ tx, entry }) => {
      const counterparts = resolveCounterpartEntries(
        tx.entries ?? [],
        accountCode,
        coaAccounts,
        language,
        resolveEntrySide(entry),
      );
      balance += entry.debit - entry.credit;
      totalDebit += entry.debit;
      totalCredit += entry.credit;
      return {
        date: tx.date,
        description: resolveTxDescription(tx, language),
        counterpart: formatCounterpartLine(counterparts),
        costCenter: resolveEntryCostCenterLine(
          entry,
          tx,
          contractsMap,
          projectsMap,
          language,
          indirectCentersMap,
        ),
        debit: entry.debit > 0 ? entry.debit : '',
        credit: entry.credit > 0 ? entry.credit : '',
        balance,
      };
    });
    const scopeLabel = isAr
      ? `بنك: ${selectedBank.nameAr} · حساب ${accountCode} — ${accountName}`
      : `Bank: ${selectedBank.nameEn || selectedBank.nameAr} · Account ${accountCode} — ${accountName}`;
    openDocPreview({
      reportId: 'bank_statement',
      title: isAr ? 'كشف حساب بنكي' : 'Bank Account Statement',
      scopeLabel,
      dateLabel: periodLabel,
      columns: [
        { key: 'date', header: isAr ? 'التاريخ' : 'Date', width: 10 },
        { key: 'description', header: isAr ? 'البيان' : 'Description', width: 25 },
        { key: 'counterpart', header: isAr ? 'الحساب المقابل' : 'Counterpart', width: 19 },
        { key: 'costCenter', header: isAr ? 'مركز التكلفة' : 'Cost center', width: 16 },
        { key: 'debit', header: isAr ? 'مدين' : 'Debit', width: 10, money: true },
        { key: 'credit', header: isAr ? 'دائن' : 'Credit', width: 10, money: true },
        { key: 'balance', header: isAr ? 'الرصيد' : 'Balance', width: 10, money: true },
      ],
      rows,
      totals: { debit: totalDebit, credit: totalCredit, balance },
      totalsLabel: isAr ? 'الإجمالي / الرصيد الختامي' : 'Totals / Closing balance',
      filename: `bank-statement-${accountCode}-${dateFrom}-${dateTo}`,
    });
  };

  const toolbar = (
    <div className="flex flex-col lg:flex-row lg:items-end gap-4 flex-wrap">
      {!fixedBankAccountId ? (
        <div className="flex-1 min-w-[220px]">
          <label className="block text-xs font-bold text-gray-500 uppercase mb-2">
            {isAr ? 'الحساب البنكي' : 'Bank account'}
          </label>
          <SearchableSelect
            value={selectedBankId}
            onChange={setSelectedBankId}
            theme={theme}
            dir={dir}
            placeholder={isAr ? '— اختر حساباً بنكياً —' : '— Select bank account —'}
            options={activeBanks.map((b) => ({
              value: b.id,
              secondary: b.code,
              label: isAr ? b.nameAr : (b.nameEn || b.nameAr),
            }))}
          />
        </div>
      ) : null}
      {selectedBankId ? (
        <>
          <div className="w-full sm:w-40">
            <label className="block text-xs font-bold text-gray-500 uppercase mb-2">{isAr ? 'من' : 'From'}</label>
            <input
              type="date"
              className={inputCls}
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              dir="ltr"
            />
          </div>
          <div className="w-full sm:w-40">
            <label className="block text-xs font-bold text-gray-500 uppercase mb-2">{isAr ? 'إلى' : 'To'}</label>
            <input
              type="date"
              className={inputCls}
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              dir="ltr"
            />
          </div>
        </>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {embedded && allowEdit && onEditAccount ? (
          <button
            type="button"
            onClick={onEditAccount}
            className={cn(
              'px-3 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2',
              theme === 'dark' ? 'bg-gray-800 hover:bg-gray-700 text-gray-100' : 'bg-gray-100 hover:bg-gray-200 text-gray-800',
            )}
          >
            <Pencil size={16} />
            {isAr ? 'بيانات الحساب' : 'Account details'}
          </button>
        ) : null}
        <button
          type="button"
          onClick={handlePrint}
          disabled={!selectedBankId || statementRows.length === 0}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2 disabled:opacity-50',
            'bg-blue-600 hover:bg-blue-700 text-white',
          )}
        >
          <Printer size={16} />
          {isAr ? 'معاينة وطباعة' : 'Preview & Print'}
        </button>
      </div>
    </div>
  );

  const metaLine =
    selectedBankId && accountCode ? (
      <p className="text-xs text-gray-500">
        {isAr ? 'حساب GL:' : 'GL account:'} <span className="font-mono">{accountCode}</span>
        {' · '}
        {periodLabel}
        {' · '}
        {statementRows.length} {isAr ? 'حركة' : 'entries'}
      </p>
    ) : null;

  const statementTable = (
    <div className={tablePanelCls}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className={cn('border-b text-xs uppercase', theme === 'dark' ? 'border-gray-800 text-gray-400' : 'text-gray-500')}>
              <th className="px-4 py-3 text-start">{isAr ? 'التاريخ' : 'Date'}</th>
              <th className="px-4 py-3 text-start">{isAr ? 'البيان' : 'Description'}</th>
              <th className="px-4 py-3 text-end">{isAr ? 'مدين' : 'Debit'}</th>
              <th className="px-4 py-3 text-end">{isAr ? 'دائن' : 'Credit'}</th>
              <th className="px-4 py-3 text-end">{isAr ? 'الرصيد' : 'Balance'}</th>
            </tr>
          </thead>
          <tbody>
            {statementRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-gray-500">
                  {isAr ? 'لا توجد حركات في هذه الفترة' : 'No entries in this period'}
                </td>
              </tr>
            ) : (
              (() => {
                let balance = 0;
                return statementRows.map(({ tx, entry }) => {
                  balance += entry.debit - entry.credit;
                  return (
                    <tr
                      key={`${tx.id}-${entry.accountCode}-${entry.debit}-${entry.credit}`}
                      className={cn('border-b', theme === 'dark' ? 'border-gray-800/50' : 'border-gray-100')}
                    >
                      <td className="px-4 py-2 font-mono text-gray-500">{tx.date}</td>
                      <td className="px-4 py-2">{resolveTxDescription(tx, language)}</td>
                      <td className="px-4 py-2 text-end font-mono text-blue-500">{entry.debit > 0 ? formatMoney(entry.debit) : '—'}</td>
                      <td className="px-4 py-2 text-end font-mono text-red-500">{entry.credit > 0 ? formatMoney(entry.credit) : '—'}</td>
                      <td className="px-4 py-2 text-end font-mono font-bold">{formatMoney(balance)}</td>
                    </tr>
                  );
                });
              })()
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  if (embedded) {
    if (!selectedBankId) {
      return (
        <div className="text-center py-16 text-gray-500 text-sm">
          {isAr ? 'اختر حساباً بنكياً لعرض كشف الحساب' : 'Select a bank account to view its statement'}
        </div>
      );
    }
    return (
      <div className="space-y-4">
        {toolbar}
        {metaLine}
        {statementTable}
        {ReportPreviewHost}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className={panelCls}>
        {toolbar}
        {metaLine}
      </div>

      {!selectedBankId ? (
        <div className={cn('text-center py-16 text-gray-500 border border-dashed rounded-xl', panelCls)}>
          {isAr ? 'اختر حساباً بنكياً لعرض كشف الحساب من دفتر اليومية' : 'Select a bank account to view its GL statement'}
        </div>
      ) : (
        statementTable
      )}

      {ReportPreviewHost}
    </div>
  );
}
