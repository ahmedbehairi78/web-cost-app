import { useMemo } from 'react';

import { collection, query, where } from 'firebase/firestore';

import { db } from '../firebase';

import { useFirestoreQuery } from './useFirestoreQuery';

import { useApiQuery } from './useApiQuery';

import { isLocalBackend } from '../lib/dataBackend';

import { chartOfAccountsApi } from '../services/local/modulesApi';

import type { Account } from '../services/accountingService';

import { usePermissions } from '../context/PermissionsContext';

import type { PermissionKey } from '../types';

import { moduleAccess } from '../lib/permissions';

import type { UserPermissions } from '../types';

const COA_CONSUMER_MODULES: PermissionKey[] = [
  'dashboard',
  'ledger',
  'costs',
  'billing',
  'boq',
  'projects',
  'suppliers',
  'banks',
  'inventory',
  'subcontractor',
  'reports',
  'assets',
  'payroll',
];

function needsChartOfAccounts(permissions: UserPermissions): boolean {
  return COA_CONSUMER_MODULES.some((key) => {
    const a = moduleAccess(permissions, key);
    return a.view || a.create || a.edit;
  });
}

type Options = {
  leafOnly?: boolean;
  /** Increment to force API/Firestore reload after local creates */
  refreshKey?: number;
};

/**
 * Loads chart_of_accounts for pickers in modules that are not the GL module.
 * Local mode (Postgres): API only. Cloud mode: Firestore until Phase 5 completes.
 */
export function useChartOfAccountsRef(options?: Options) {
  const { permissions } = usePermissions();
  const enabled = needsChartOfAccounts(permissions);
  const leafOnly = options?.leafOnly ?? false;
  const refreshKey = options?.refreshKey ?? 0;

  const { data: firestoreAccounts, loading: fsLoading } = useFirestoreQuery<
    Account & Record<string, unknown>
  >(
    () =>
      enabled && !isLocalBackend
        ? leafOnly
          ? query(collection(db, 'chart_of_accounts'), where('isGroup', '==', false))
          : query(collection(db, 'chart_of_accounts'))
        : null,
    [enabled, leafOnly, isLocalBackend],
    { mode: 'once', collectionName: 'chart_of_accounts' },
  );

  const { data: apiAccounts, loading: apiLoading } = useApiQuery<Account>(
    async () => {
      const rows = (await chartOfAccountsApi.list()) as Account[];
      const normalized = rows.map((a) => ({
        ...a,
        accountCode: String(a.accountCode ?? '').trim(),
        parentCode: String(a.parentCode ?? '').trim(),
      }));
      const list = leafOnly ? normalized.filter((a) => !a.isGroup) : normalized;
      return list.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    },
    [leafOnly],
    { enabled: enabled && isLocalBackend, refreshKey },
  );

  const accounts: Array<Account & Record<string, unknown>> = useMemo(() => {
    const list = isLocalBackend ? apiAccounts : (firestoreAccounts ?? []);
    return list as Array<Account & Record<string, unknown>>;
  }, [isLocalBackend, apiAccounts, firestoreAccounts]);

  const loading =
    enabled && (isLocalBackend ? apiLoading : fsLoading) && accounts.length === 0;

  return {
    accounts,
    loading,
    error: null,
    enabled,
  };
}
