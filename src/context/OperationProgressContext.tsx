import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { OperationProgressEntry } from '../lib/operationProgress';
import {
  beginLongRunningOperation,
  endLongRunningOperation,
  yieldToUi,
} from '../lib/operationProgress';
import { pingIdleActivity } from '../lib/idleActivityBridge';

type BeginOptions = {
  id?: string;
  label: string;
  total?: number | null;
  message?: string;
};

type UpdatePatch = Partial<Pick<OperationProgressEntry, 'message' | 'current' | 'total'>>;

type OperationProgressContextValue = {
  active: OperationProgressEntry | null;
  beginOperation: (opts: BeginOptions) => string;
  updateOperation: (id: string, patch: UpdatePatch) => void;
  endOperation: (id: string) => void;
};

const OperationProgressContext = createContext<OperationProgressContextValue | null>(null);

function newOperationId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function OperationProgressProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<OperationProgressEntry | null>(null);
  const activeIdRef = useRef<string | null>(null);

  const beginOperation = useCallback((opts: BeginOptions): string => {
    const id = opts.id ?? newOperationId();
    activeIdRef.current = id;
    setActive({
      id,
      label: opts.label,
      message: opts.message,
      current: 0,
      total: opts.total ?? null,
    });
    return id;
  }, []);

  const updateOperation = useCallback((id: string, patch: UpdatePatch) => {
    setActive((prev) => {
      if (!prev || prev.id !== id) return prev;
      return { ...prev, ...patch };
    });
  }, []);

  const endOperation = useCallback((id: string) => {
    if (activeIdRef.current !== id) return;
    activeIdRef.current = null;
    setActive(null);
  }, []);

  const value = useMemo(
    () => ({ active, beginOperation, updateOperation, endOperation }),
    [active, beginOperation, updateOperation, endOperation],
  );

  return (
    <OperationProgressContext.Provider value={value}>
      {children}
    </OperationProgressContext.Provider>
  );
}

export function useOperationProgress(): OperationProgressContextValue {
  const ctx = useContext(OperationProgressContext);
  if (!ctx) {
    throw new Error('useOperationProgress must be used within OperationProgressProvider');
  }
  return ctx;
}

export type OperationProgressUpdater = (current: number, message?: string) => void;

/** Run an async task with automatic begin/end and row-level updates. */
export function useOperationProgressRunner() {
  const { beginOperation, updateOperation, endOperation } = useOperationProgress();

  return useCallback(
    async <T,>(
      opts: BeginOptions,
      run: (update: OperationProgressUpdater) => Promise<T>,
    ): Promise<T> => {
      beginLongRunningOperation();
      try {
        const id = beginOperation(opts);
        await yieldToUi();
        try {
          return await run((current, message) => {
            pingIdleActivity();
            updateOperation(id, { current, ...(message !== undefined ? { message } : {}) });
          });
        } finally {
          endOperation(id);
        }
      } finally {
        endLongRunningOperation();
      }
    },
    [beginOperation, updateOperation, endOperation],
  );
}
