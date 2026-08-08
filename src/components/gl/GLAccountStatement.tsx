import React, { useState, useMemo, useEffect } from 'react';
import { Calculator, Printer } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { cn } from '../../lib/utils';
import { formatMoney as formatMoneyLib, NUMBER_LOCALE } from '../../lib/money';
import { displayLocale } from '../../lib/numberLocale';
import { isLocalBackend } from '../../lib/dataBackend';
import { db } from '../../firebase';
import { Account } from '../../services/accountingService';
import { costCentersApi, settingsApi } from '../../services/local/modulesApi';
import { useLanguage } from '../../context/LanguageContext';
import { resolveEntryCostCenterLine, resolveTxDescription, resolveCounterpartEntries, resolveEntrySide, formatCounterpartLine } from '../../lib/glBilingual';
import { isJournalDateInRange, journalDateKey } from '../../lib/journalFilters';
import { chartLeafAccountOptions } from '../../lib/chartOfAccountsPicker';
import { useReportDocumentPreview } from '../../hooks/useReportDocumentPreview';
import type { CompanyPrintInfo } from '../../lib/ipcPrintData';

interface Transaction {
  id: string;
  date: string;
  description: string;
  descriptionEn?: string | null;
  reference?: string;
  costCenterId?: string;
  projectId?: string;
  entries?: { accountCode: string; accountName?: string; debit: number; credit: number; costCenterId?: string | null }[];
  createdBy?: string;
}

export interface GlStatementCompanyInfo {
  companyName?: string;
  companyNameEn?: string;
  headerLogo?: string;
}

interface ContractLite {
  id: string;
  contractName?: string;
  contractNameEn?: string | null;
  contractNumber?: string;
  projectId?: string;
}

interface ProjectLite {
  id: string;
  projectName?: string;
  projectNameEn?: string | null;
  projectCode?: string;
}

interface Props {
  transactions: Transaction[];
  accounts: Account[];
  theme: string;
  language: string;
  dir: string;
  dateFrom: string;
  dateTo: string;
  selectedAccountCode?: string;
  loading?: boolean;
  companyInfo?: GlStatementCompanyInfo;
  contractsMap: Map<string, ContractLite>;
  projectsMap: Map<string, ProjectLite>;
}

export function GLAccountStatement({
  transactions,
  accounts,
  theme,
  language,
  dir,
  dateFrom,
  dateTo,
  selectedAccountCode = '',
  loading = false,
  companyInfo: companyInfoProp,
  contractsMap,
  projectsMap,
}: Props) {
  const { t } = useLanguage();
  const isAr = language === 'ar';
  const moneyLocale = NUMBER_LOCALE;
  const formatMoney = (value: number) => formatMoneyLib(value, moneyLocale);
  const selectedAccount = String(selectedAccountCode ?? '').trim();
  const [indirectCenters, setIndirectCenters] = useState<Array<{ id: string; code: string; name: string; nameEn?: string | null }>>([]);
  const [companyInfo, setCompanyInfo] = useState<CompanyPrintInfo>({
    companyName: companyInfoProp?.companyName || '',
    companyNameEn: companyInfoProp?.companyNameEn || '',
    headerLogo: companyInfoProp?.headerLogo || '',
  });

  const statementAccountOptions = useMemo(
    () => chartLeafAccountOptions(accounts, isAr ? 'ar' : 'en'),
    [accounts, isAr],
  );

  const selectedAccountLabel = useMemo(() => {
    if (!selectedAccount) return '';
    const opt = statementAccountOptions.find((o) => o.value === selectedAccount);
    return opt?.label ?? selectedAccount;
  }, [selectedAccount, statementAccountOptions]);

  const { openDocPreview, ReportPreviewHost } = useReportDocumentPreview({
    language: language as 'ar' | 'en',
    t,
    formatMoney,
    companyInfo,
  });

  useEffect(() => {
    if (!isLocalBackend) return;
    void costCentersApi.list('indirect').then((rows) => {
      setIndirectCenters(rows as Array<{ id: string; code: string; name: string; nameEn?: string | null }>);
    }).catch(() => setIndirectCenters([]));
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        if (isLocalBackend) {
          const res = await settingsApi.getCompanyInfo();
          if (res.value) {
            setCompanyInfo((prev) => ({ ...prev, ...res.value }));
            return;
          }
        }
        const settingsDoc = await getDoc(doc(db, 'settings', 'company_info'));
        if (settingsDoc.exists()) {
          setCompanyInfo((prev) => ({ ...prev, ...(settingsDoc.data() as CompanyPrintInfo) }));
        }
      } catch {
        if (companyInfoProp) {
          setCompanyInfo((prev) => ({
            ...prev,
            companyName: companyInfoProp.companyName || prev.companyName,
            companyNameEn: companyInfoProp.companyNameEn || prev.companyNameEn,
            headerLogo: companyInfoProp.headerLogo || prev.headerLogo,
          }));
        }
      }
    };
    void load();
  }, [companyInfoProp]);

  const indirectCentersMap = useMemo(
    () => new Map(indirectCenters.map((c) => [c.id, c])),
    [indirectCenters],
  );

  type StatementRow = { tx: Transaction; entry: NonNullable<Transaction['entries']>[number] };

  const accountEntryRows = useMemo(() => {
    if (!selectedAccount) return [] as StatementRow[];
    const code = String(selectedAccount).trim();
    const rows: StatementRow[] = [];
    for (const tx of transactions) {
      for (const entry of tx.entries ?? []) {
        if (String(entry.accountCode ?? '').trim() === code) {
          rows.push({ tx, entry });
        }
      }
    }
    return rows.sort(
      (a, b) =>
        journalDateKey(a.tx.date).localeCompare(journalDateKey(b.tx.date))
        || String(a.tx.reference ?? a.tx.id).localeCompare(String(b.tx.reference ?? b.tx.id)),
    );
  }, [transactions, selectedAccount]);

  const accountTransactions = useMemo(() => {
    return accountEntryRows.filter((row) => isJournalDateInRange(row.tx.date, dateFrom, dateTo));
  }, [accountEntryRows, dateFrom, dateTo]);

  const periodLabel = useMemo(() => {
    const d0 = new Date(`${dateFrom}T12:00:00`);
    const d1 = new Date(`${dateTo}T12:00:00`);
    const fmt = (d: Date) => d.toLocaleDateString(displayLocale(language), { year: 'numeric', month: 'short', day: 'numeric' });
    if (isAr) return `من ${fmt(d0)} إلى ${fmt(d1)}`;
    return `${fmt(d0)} – ${fmt(d1)}`;
  }, [dateFrom, dateTo, isAr]);

  const handlePrintPreview = () => {
    if (!selectedAccount) return;
    const account = accounts.find((a) => a.accountCode === selectedAccount);
    const accountName = account
      ? isAr
        ? account.accountName
        : (account.accountNameEn?.trim() || account.accountName)
      : '';
    const code = String(selectedAccount).trim();
    let balance = 0;
    let totalDebit = 0;
    let totalCredit = 0;
    const rows = accountTransactions.map(({ tx, entry }) => {
      const counterparts = resolveCounterpartEntries(
        tx.entries ?? [],
        code,
        accounts,
        language,
        resolveEntrySide(entry),
      );
      balance += entry.debit - entry.credit;
      totalDebit += entry.debit;
      totalCredit += entry.credit;
      return {
        date: tx.date,
        reference: tx.reference ?? '',
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
    openDocPreview({
      reportId: 'gl_account_statement',
      title: isAr ? 'كشف حساب تفصيلي' : 'Account Statement',
      scopeLabel: `${code} — ${accountName}`,
      dateLabel: periodLabel,
      columns: [
        { key: 'date', header: isAr ? 'التاريخ' : 'Date', width: 9 },
        { key: 'reference', header: isAr ? 'رقم القيد' : 'Journal no.', width: 12 },
        { key: 'description', header: isAr ? 'البيان' : 'Description', width: 20 },
        { key: 'counterpart', header: isAr ? 'الحساب المقابل' : 'Counterpart', width: 18 },
        { key: 'costCenter', header: isAr ? 'مركز التكلفة' : 'Cost center', width: 14 },
        { key: 'debit', header: isAr ? 'مدين' : 'Debit', width: 9, money: true },
        { key: 'credit', header: isAr ? 'دائن' : 'Credit', width: 9, money: true },
        { key: 'balance', header: isAr ? 'الرصيد' : 'Balance', width: 9, money: true },
      ],
      rows,
      totals: { debit: totalDebit, credit: totalCredit, balance },
      totalsLabel: isAr ? 'الإجمالي / الرصيد الختامي' : 'Totals / Closing balance',
      filename: `account-statement-${code}-${dateFrom}-${dateTo}`,
    });
  };

  return (
    <div className="space-y-4">
      {!selectedAccount ? (
        <div className={cn('flex flex-col items-center justify-center p-16 rounded-xl border border-dashed', theme === 'dark' ? 'text-gray-400 border-gray-700' : theme === 'soft' ? 'text-[#78909c] border-[#cfd8dc] bg-[#fafcfd]' : 'text-gray-500 border-gray-300 bg-gray-50/50')}>
          <Calculator size={48} className="mb-4 opacity-20" />
          <h3 className="text-lg font-bold">{isAr ? 'كشف الحساب التفصيلي' : 'Detailed Account Statement'}</h3>
          <p className="mt-2 text-sm text-center max-w-md">{t('gl_statement_pick_account_sidebar')}</p>
        </div>
      ) : loading ? (
        <div className={cn('border rounded-xl p-12 text-center text-sm', theme === 'dark' ? 'border-gray-800 text-gray-400' : 'border-gray-200 text-gray-500')}>
          {isAr ? 'جاري التحميل…' : 'Loading…'}
        </div>
      ) : (
        <div className={cn('border rounded-xl overflow-hidden shadow-sm', theme === 'dark' ? 'bg-[#151619] border-gray-800' : theme === 'soft' ? 'bg-white border-[#cfd8dc]' : 'bg-white border-gray-200')}>
          <div className={cn('px-4 md:px-6 py-3 border-b flex flex-wrap items-center justify-between gap-3', theme === 'dark' ? 'border-gray-800 bg-gray-900/30 text-gray-300' : theme === 'soft' ? 'border-[#cfd8dc] bg-[#eceff1] text-[#546e7a]' : 'border-gray-200 bg-gray-50 text-gray-600')}>
            <div className="min-w-0">
              <p className="text-sm font-bold truncate">{selectedAccountLabel}</p>
              <p className="text-xs mt-0.5">
                <span className="font-bold">{isAr ? 'الفترة:' : 'Period:'}</span>{' '}
                <span className="font-mono">{periodLabel}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={handlePrintPreview}
              disabled={accountTransactions.length === 0}
              className={cn(
                'px-3 py-2 disabled:opacity-50 rounded-lg text-sm font-bold transition-colors flex items-center gap-2 shrink-0',
                theme === 'dark' ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white',
              )}
            >
              <Printer size={16} />
              {isAr ? 'معاينة وطباعة' : 'Preview & Print'}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className={cn('border-b', theme === 'dark' ? 'border-gray-800 bg-gray-900/30' : theme === 'soft' ? 'border-[#cfd8dc] bg-[#eceff1]' : 'border-gray-200 bg-gray-50')}>
                  <th className={cn('px-6 py-4 text-xs font-black uppercase', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>{isAr ? 'التاريخ' : 'Date'}</th>
                  <th className={cn('px-6 py-4 text-xs font-black uppercase', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>{isAr ? 'رقم القيد' : 'Journal No.'}</th>
                  <th className={cn('px-6 py-4 text-xs font-black uppercase', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>{isAr ? 'البيان' : 'Description'}</th>
                  <th className={cn('px-6 py-4 text-xs font-black uppercase', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>{isAr ? 'الحساب المقابل' : 'Counter Account'}</th>
                  <th className={cn('px-6 py-4 text-xs font-black uppercase', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>{isAr ? 'مركز التكلفة' : 'Cost Center'}</th>
                  <th className={cn('px-6 py-4 text-xs font-black uppercase', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>{isAr ? 'مدين' : 'Debit'}</th>
                  <th className={cn('px-6 py-4 text-xs font-black uppercase', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>{isAr ? 'دائن' : 'Credit'}</th>
                  <th className={cn('px-6 py-4 text-xs font-black uppercase', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>{isAr ? 'الرصيد' : 'Balance'}</th>
                </tr>
              </thead>
              <tbody className={cn('divide-y transition-colors', theme === 'dark' ? 'divide-gray-800/50' : theme === 'soft' ? 'divide-[#cfd8dc]' : 'divide-gray-100')}>
                {(() => {
                  let balance = 0;
                  return accountTransactions.map(({ tx, entry }) => {
                    const code = String(selectedAccount).trim();
                    const counterparts = resolveCounterpartEntries(
                      tx.entries ?? [],
                      code,
                      accounts,
                      language,
                      resolveEntrySide(entry),
                    );
                    balance += entry.debit - entry.credit;
                    const rowKey = `${tx.id}-${entry.accountCode}-${entry.debit}-${entry.credit}-${entry.costCenterId ?? ''}`;
                    return (
                      <tr key={rowKey} className={cn('transition-colors', theme === 'dark' ? 'hover:bg-gray-800/20' : theme === 'soft' ? 'hover:bg-[#eceff1]/50' : 'hover:bg-gray-50')}>
                        <td className="px-6 py-4 text-sm font-mono text-gray-500">{tx.date}</td>
                        <td className="px-6 py-4 text-xs font-mono text-gray-500">{tx.reference || '-'}</td>
                        <td className="px-6 py-4 text-sm font-bold">{resolveTxDescription(tx, language)}</td>
                        <td className="px-6 py-4 text-sm">
                          {counterparts.length === 0 ? (
                            <span className="text-gray-400">-</span>
                          ) : (
                            <div className="space-y-1">
                              {counterparts.map(c => (
                                <div key={c.code} className="flex items-center gap-2">
                                  <span className="font-mono text-[10px] text-gray-500">{c.code}</span>
                                  <span>{c.name}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className={cn('px-6 py-4 text-sm', theme === 'dark' ? 'text-blue-400/90' : 'text-blue-700')}>
                          {resolveEntryCostCenterLine(entry, tx, contractsMap, projectsMap, language, indirectCentersMap)}
                        </td>
                        <td className={cn('px-6 py-4 text-sm font-mono', theme === 'dark' ? 'text-blue-400' : 'text-blue-600')}>{entry.debit > 0 ? formatMoney(entry.debit) : '-'}</td>
                        <td className={cn('px-6 py-4 text-sm font-mono', theme === 'dark' ? 'text-red-400' : 'text-red-600')}>{entry.credit > 0 ? formatMoney(entry.credit) : '-'}</td>
                        <td className={cn('px-6 py-4 text-sm font-mono font-bold', balance >= 0 ? theme === 'dark' ? 'text-green-400' : 'text-green-700' : theme === 'dark' ? 'text-red-400' : 'text-red-600')}>{formatMoney(balance)}</td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {ReportPreviewHost}
    </div>
  );
}
