import { useMemo } from 'react';
import { collection, query, orderBy, where, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { useFirestoreQuery } from './useFirestoreQuery';
import { useApiQuery } from './useApiQuery';
import { isLocalBackend } from '../lib/dataBackend';
import { glApi } from '../services/local/modulesApi';
import { filterJournalTransactions, normalizeGlTransactionDates, journalDateQueryUpperBound, type JournalQueryFilters } from '../lib/journalFilters';

interface GlTransaction {
  id: string;
  date: string;
  description: string;
  descriptionEn?: string;
  reference: string;
  costCenterId?: string;
  projectId?: string;
  entries: { accountCode: string; accountName: string; debit: number; credit: number }[];
  createdBy: string;
  createdAt?: string | Date | { seconds?: number; toMillis?: () => number };
}

export function useFilteredGlTransactions(
  applied: JournalQueryFilters | null,
  transactionLimit: number,
  refreshKey: number,
  projectIdByContractId: Map<string, string>,
) {
  const { data: fsTransactions, loading: fsLoading } = useFirestoreQuery<GlTransaction>(
    () => {
      if (isLocalBackend || !applied) return null;
      return query(
        collection(db, 'transactions'),
        where('isDeleted', '==', false),
        where('date', '>=', applied.dateFrom.slice(0, 10)),
        where('date', '<=', journalDateQueryUpperBound(applied.dateTo)),
        orderBy('date', 'desc'),
        limit(transactionLimit),
      );
    },
    [applied, transactionLimit, refreshKey, isLocalBackend],
    { mode: 'snapshot', collectionName: 'transactions' },
  );

  const {
    data: apiTransactions,
    loading: apiTxLoading,
    error: apiTxError,
  } = useApiQuery<GlTransaction>(
    () =>
      glApi.transactionsQuery({
        dateFrom: applied!.dateFrom,
        dateTo: applied!.dateTo,
        projectIds: applied!.projectIds.length ? applied!.projectIds : undefined,
        accountFrom: applied!.accountFrom || undefined,
        accountTo:
          (applied!.accountScope ?? 'single') === 'range' && applied!.accountTo
            ? applied!.accountTo
            : undefined,
        limit: transactionLimit,
      }) as Promise<GlTransaction[]>,
    [applied, transactionLimit, refreshKey],
    { enabled: isLocalBackend && applied !== null, refreshKey },
  );

  const rawTransactions = isLocalBackend ? (apiTransactions ?? []) : (fsTransactions ?? []);
  const normalizedTransactions = useMemo(
    () => normalizeGlTransactionDates(rawTransactions),
    [rawTransactions],
  );
  const transactions = useMemo(() => {
    if (!applied) return [];
    return filterJournalTransactions(normalizedTransactions, applied, projectIdByContractId);
  }, [normalizedTransactions, applied, projectIdByContractId]);

  const loading = applied !== null && (isLocalBackend ? apiTxLoading : fsLoading);

  return { transactions, loading, error: apiTxError };
}
