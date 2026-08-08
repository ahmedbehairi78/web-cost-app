import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';
import { useLanguage } from './LanguageContext';
import { ShellConfirmDialog } from '../components/ShellConfirmDialog';

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'neutral' | 'danger';
};

type Pending = ConfirmOptions & { resolve: (value: boolean) => void };

const ConfirmCtx = createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(null);

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const { t, theme, dir } = useLanguage();
  const [pending, setPending] = useState<Pending | null>(null);
  const closedByConfirm = useRef(false);

  const resolveAndClear = useCallback((value: boolean) => {
    setPending((p) => {
      if (p) p.resolve(value);
      return null;
    });
  }, []);

  const confirm = useCallback((opts: ConfirmOptions) => {
    closedByConfirm.current = false;
    return new Promise<boolean>((resolve) => {
      setPending({ ...opts, resolve });
    });
  }, []);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        if (closedByConfirm.current) {
          closedByConfirm.current = false;
          return;
        }
        resolveAndClear(false);
      }
    },
    [resolveAndClear],
  );

  const handleConfirm = useCallback(() => {
    closedByConfirm.current = true;
    resolveAndClear(true);
  }, [resolveAndClear]);

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <ShellConfirmDialog
        open={pending !== null}
        onOpenChange={handleOpenChange}
        title={pending?.title ?? ''}
        message={pending?.message ?? ''}
        confirmLabel={pending?.confirmLabel ?? t('confirm')}
        cancelLabel={pending?.cancelLabel ?? t('cancel')}
        onConfirm={handleConfirm}
        variant={pending?.variant ?? 'neutral'}
        theme={theme}
        dir={dir}
      />
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  const fn = useContext(ConfirmCtx);
  if (!fn) {
    throw new Error('useConfirm must be used within ConfirmDialogProvider');
  }
  return fn;
}
