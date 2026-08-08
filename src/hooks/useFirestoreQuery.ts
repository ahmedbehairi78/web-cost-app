import { useEffect, useRef, useState, type DependencyList } from 'react';
import {
  type DocumentData,
  type Query,
  getDocs,
} from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '../firebase';
import { listenQuery } from '../lib/firestoreListen';

/** Firestore query factory — returns a Query or null to skip. */
type QueryFactory = () => Query<DocumentData> | null;

// ─── Types ────────────────────────────────────────────────────────────────────

export type FirestoreQueryMode = 'snapshot' | 'once';

export interface UseFirestoreQueryOptions {
  /** 'snapshot' → realtime listener (default); 'once' → single getDocs call */
  mode?: FirestoreQueryMode;
  /**
   * Firestore collection name used in error reporting only.
   * Falls back to generic 'firestore_query' if omitted.
   */
  collectionName?: string;
}

export interface UseFirestoreQueryResult<T> {
  data: T[];
  loading: boolean;
  error: Error | null;
  /** Number of docs returned by the last snapshot (useful for capped queries). */
  size: number;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Unified Firestore query hook supporting both realtime and one-shot modes.
 *
 * @example — realtime listener
 * ```ts
 * const { data: projects } = useFirestoreQuery<Project>(
 *   () => query(collection(db, 'projects'), where('isDeleted', '==', false)),
 *   [],
 *   { mode: 'snapshot', collectionName: 'projects' },
 * );
 * ```
 *
 * @example — one-shot read (reference data)
 * ```ts
 * const { data: suppliers } = useFirestoreQuery<Supplier>(
 *   () => query(collection(db, 'suppliers'), where('isDeleted', '==', false)),
 *   [],
 *   { mode: 'once', collectionName: 'suppliers' },
 * );
 * ```
 *
 * @example — conditional (skip when id is empty)
 * ```ts
 * const { data: items } = useFirestoreQuery<BOQItem>(
 *   () => contractId
 *     ? query(collection(db, 'boq_items'), where('contractId', '==', contractId))
 *     : null,
 *   [contractId],
 * );
 * ```
 */
export function useFirestoreQuery<T = DocumentData>(
  factory: QueryFactory,
  deps: DependencyList,
  options: UseFirestoreQueryOptions = {},
): UseFirestoreQueryResult<T> {
  const { mode = 'once', collectionName = 'firestore_query' } = options;

  const [data, setData]       = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<Error | null>(null);
  const [size, setSize]       = useState(0);

  // Keep the latest options in a ref so the effect closure doesn't capture stale values.
  const optsRef = useRef(options);
  optsRef.current = options;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const q = factory();

    if (q === null) {
      setData([]);
      setSize(0);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const { mode: m = 'once', collectionName: col = 'firestore_query' } = optsRef.current;

    if (m === 'snapshot') {
      const unsub = listenQuery(
        q,
        (snap) => {
          setData(snap.docs.map((d) => ({ ...d.data(), id: d.id } as unknown as T)));
          setSize(snap.docs.length);
          setLoading(false);
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, col);
          } catch {
            /* logged + thrown by handleFirestoreError — keep hook stable */
          }
          setError(err as Error);
          setLoading(false);
        },
      );
      return () => unsub();
    }

    // mode === 'once'
    let cancelled = false;
    getDocs(q)
      .then((snap) => {
        if (cancelled) return;
        setData(snap.docs.map((d) => ({ ...d.data(), id: d.id } as unknown as T)));
        setSize(snap.docs.length);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        try {
          handleFirestoreError(err, OperationType.LIST, col);
        } catch {
          /* logged + thrown by handleFirestoreError — keep hook stable */
        }
        setError(err as Error);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `deps` intentionally spread — the factory should capture the needed values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, size };
}
