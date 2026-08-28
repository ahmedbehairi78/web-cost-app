import React, { useEffect, useState } from 'react';
import { FolderTree } from 'lucide-react';
import { collection, query, orderBy } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { db } from '../../firebase';
import { useFirestoreQuery } from '../../hooks/useFirestoreQuery';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useLanguage } from '../../context/LanguageContext';
import { usePermissions } from '../../context/PermissionsContext';
import { isLocalBackend } from '../../lib/dataBackend';
import { chartOfAccountsApi } from '../../services/local/modulesApi';
import { Account } from '../../services/accountingService';
import { GLChartOfAccounts } from '../gl/GLChartOfAccounts';
import { OpeningCreditorsImportPanel } from './OpeningCreditorsImportPanel';
import { ManualHelpButton } from '../help/ManualHelpButton';
import { ApiError } from '../../lib/apiClient';
import { cn } from '../../lib/utils';

function normalizeCoaRows(rows: Account[]): Account[] {
  return rows
    .map((a) => {
      const accountCode = String(a.accountCode ?? '').trim();
      let parentCode = String(a.parentCode ?? '').trim();
      if (accountCode.length === 1) parentCode = '';
      else if (parentCode === accountCode) parentCode = '';
      return { ...a, accountCode, parentCode };
    })
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
}

interface Props {
  theme: string;
}

export function ChartOfAccountsSettingsPanel({ theme }: Props) {
  const { language, dir, t } = useLanguage();
  const { can } = usePermissions();
  const ledger = can('ledger');
  const [coaRefreshKey, setCoaRefreshKey] = useState(0);

  const { data: fsAccounts, loading: fsLoading } = useFirestoreQuery<Account>(
    () =>
      isLocalBackend
        ? null
        : query(collection(db, 'chart_of_accounts'), orderBy('accountCode')),
    [isLocalBackend, coaRefreshKey],
    { mode: 'snapshot', collectionName: 'chart_of_accounts' },
  );

  const {
    data: apiCoaRows,
    loading: apiCoaLoading,
    error: apiCoaError,
  } = useApiQuery<Account>(
    async () => normalizeCoaRows((await chartOfAccountsApi.list()) as Account[]),
    [coaRefreshKey],
    { enabled: isLocalBackend, refreshKey: coaRefreshKey },
  );

  useEffect(() => {
    if (!apiCoaError) return;
    const msg =
      apiCoaError instanceof ApiError
        ? apiCoaError.message
        : apiCoaError instanceof Error
          ? apiCoaError.message
          : String(apiCoaError);
    toast.error(
      language === 'ar' ? `فشل تحميل شجرة الحسابات: ${msg}` : `Failed to load chart of accounts: ${msg}`,
    );
  }, [apiCoaError, language]);

  const accounts = isLocalBackend ? (apiCoaRows ?? []) : (fsAccounts ?? []);
  const loading = isLocalBackend ? apiCoaLoading : fsLoading;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className={cn('p-2 rounded-lg', theme === 'dark' ? 'bg-amber-900/20 text-amber-400' : 'bg-amber-50 text-amber-700')}>
          <FolderTree size={24} />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-bold">{t('coa_setup_section')}</h3>
            <ManualHelpButton topicId="settings.coa.tree" size={14} />
          </div>
          <p className={cn('text-sm mt-0.5', theme === 'dark' ? 'text-gray-500' : 'text-gray-500')}>
            {t('coa_setup_intro')}
          </p>
        </div>
      </div>
      {isLocalBackend && (
        <OpeningCreditorsImportPanel onImported={() => setCoaRefreshKey((k) => k + 1)} />
      )}
      <GLChartOfAccounts
        accounts={accounts}
        loading={loading}
        theme={theme}
        language={language}
        dir={dir}
        allowCreate={ledger.create}
        allowEdit={ledger.edit}
        onAccountsChanged={() => setCoaRefreshKey((k) => k + 1)}
      />
    </div>
  );
}
