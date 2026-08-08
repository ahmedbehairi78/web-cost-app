import { useEffect, useMemo, useRef } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { isLocalBackend } from '../lib/dataBackend';
import { mergeBoqRowWithRateSource } from '../lib/boqRateOverlay';
import { boqApi } from '../services/local/modulesApi';
import { useApiQuery } from './useApiQuery';
import { useFirestoreQuery } from './useFirestoreQuery';

type Options = {
  contractId: string | null | undefined;
  refreshKey?: number;
  /** When true, persist Firestore rates into Postgres once per item id. */
  persistOverlay?: boolean;
  normalize: (row: Record<string, unknown>, index: number) => T;
};

/**
 * Postgres BOQ list + Firestore rate overlay (Electron/Railway).
 * Postgres holds totals; Firestore may still have materials/labour/equipment breakdown.
 */
export function useBoqItemsWithRateOverlay<T extends { id: string }>({
  contractId,
  refreshKey = 0,
  persistOverlay = false,
  normalize,
}: Options) {
  const { data: apiRows, loading, error } = useApiQuery<Record<string, unknown>>(
    async () => {
      if (!contractId) return [];
      const rows = (await boqApi.list(`?contractId=${encodeURIComponent(contractId)}`)) as Record<
        string,
        unknown
      >[];
      return rows.filter((r) => r.isDeleted !== true);
    },
    [contractId],
    { enabled: isLocalBackend && !!contractId, refreshKey },
  );

  const { data: fsRows } = useFirestoreQuery<Record<string, unknown>>(
    () =>
      // Overlay only when Firebase Auth is present (password login has no Firestore rights).
      isLocalBackend && contractId && auth.currentUser
        ? query(
            collection(db, 'boq_items'),
            where('contractId', '==', contractId),
            where('isDeleted', '!=', true),
          )
        : null,
    [contractId, isLocalBackend],
    { mode: 'once', collectionName: 'boq_items' },
  );

  const fsById = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    for (const row of fsRows ?? []) {
      const id = String(row.id ?? '').trim();
      if (id) map.set(id, row);
    }
    return map;
  }, [fsRows]);

  const items = useMemo(() => {
    const rows = apiRows ?? [];
    return rows.map((row, idx) => {
      const id = String(row.id ?? '').trim();
      const fs = id ? fsById.get(id) : undefined;
      const merged = fs ? mergeBoqRowWithRateSource(row, fs) : row;
      return normalize(merged, idx);
    });
  }, [apiRows, fsById, normalize]);

  const persistedIdsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!persistOverlay || !isLocalBackend || !contractId) return;
    const rows = apiRows ?? [];
    if (rows.length === 0) return;

    let cancelled = false;
    void (async () => {
      for (const row of rows) {
        if (cancelled) return;
        const id = String(row.id ?? '').trim();
        if (!id || persistedIdsRef.current.has(id)) continue;
        const fs = fsById.get(id);
        if (!fs) continue;
        const merged = mergeBoqRowWithRateSource(row, fs);
        if (merged === row) continue;

        persistedIdsRef.current.add(id);
        try {
          await boqApi.update(id, {
            rateMaterials: merged.rateMaterials,
            rateLabour: merged.rateLabour,
            rateEquipment: merged.rateEquipment,
            rateDirect: merged.rateDirect,
            rateOverheadPct: merged.rateOverheadPct,
            rateProfitPct: merged.rateProfitPct,
          });
        } catch (err) {
          persistedIdsRef.current.delete(id);
          console.warn('[BOQ] rate overlay persist failed', id, err);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [apiRows, fsById, persistOverlay, contractId]);

  return { items, loading, error };
}
