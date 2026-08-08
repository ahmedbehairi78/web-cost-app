import { useEffect, useMemo, useState } from 'react';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { listenQuery } from '../lib/firestoreListen';
import { isLocalBackend } from '../lib/dataBackend';
import { LISTENER_GL_TX_SCREEN_CAP } from '../constants/dataLimits';
import { buildGlAccountBalanceMap, buildGlAccountTotalsMap, type GlBalanceTxSlice } from '../lib/glAccountBalance';
import { glApi } from '../services/local/modulesApi';
import { useApiQuery } from './useApiQuery';

export function useGlAccountBalances(enabled: boolean, refreshKey = 0) {
  const [fsTransactions, setFsTransactions] = useState<GlBalanceTxSlice[]>([]);

  const { data: apiTransactions, loading: apiLoading } = useApiQuery<GlBalanceTxSlice>(
    () => glApi.transactions(undefined, LISTENER_GL_TX_SCREEN_CAP) as Promise<GlBalanceTxSlice[]>,
    [refreshKey],
    { enabled: enabled && isLocalBackend, refreshKey },
  );

  useEffect(() => {
    if (!enabled || isLocalBackend) return;
    const q = query(
      collection(db, 'transactions'),
      where('isDeleted', '==', false),
      orderBy('date', 'desc'),
      limit(LISTENER_GL_TX_SCREEN_CAP),
    );
    return listenQuery(
      q,
      (snap) => {
        setFsTransactions(snap.docs.map((d) => ({ ...d.data(), id: d.id } as GlBalanceTxSlice)));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'transactions'),
    );
  }, [enabled, refreshKey]);

  const transactions = isLocalBackend ? (apiTransactions ?? []) : fsTransactions;
  const accountTotalsByCode = useMemo(() => buildGlAccountTotalsMap(transactions), [transactions]);
  const balanceByCode = useMemo(() => buildGlAccountBalanceMap(transactions), [transactions]);

  return {
    balanceByCode,
    accountTotalsByCode,
    loading: isLocalBackend ? apiLoading : false,
  };
}
