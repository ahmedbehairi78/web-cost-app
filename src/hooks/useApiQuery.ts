import { useEffect, useState, type DependencyList } from 'react';

type UseApiQueryOptions = {
  enabled?: boolean;
  refreshKey?: number;
};

export type UseApiQueryResult<T> = {
  data: T[];
  loading: boolean;
  error: Error | null;
  refresh: () => void;
};

/**
 * Fetches list data from the Express API (Phase 5 — replaces Firestore reads in local mode).
 */
export function useApiQuery<T>(
  fetcher: () => Promise<T[]>,
  deps: DependencyList,
  options?: UseApiQueryOptions,
): UseApiQueryResult<T> {
  const enabled = options?.enabled ?? true;
  const externalRefreshKey = options?.refreshKey ?? 0;
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<Error | null>(null);
  const [internalRefreshKey, setInternalRefreshKey] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setData([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetcher()
      .then((rows) => {
        if (!cancelled) setData(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setData([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, externalRefreshKey, internalRefreshKey]);

  return {
    data,
    loading,
    error,
    refresh: () => setInternalRefreshKey((k) => k + 1),
  };
}
