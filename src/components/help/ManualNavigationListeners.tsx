import { useEffect } from 'react';
import {
  MANUAL_OPEN_EVENT,
  SHELL_NAVIGATE_EVENT,
} from '../../lib/operationsManual';

interface ManualNavigationListenersProps {
  openManual: () => void;
  navigate: (moduleId: string, viewId?: string) => void;
}

/** Global listeners for manual deep-links (works in sidebar + ERP shells). */
export function ManualNavigationListeners({ openManual, navigate }: ManualNavigationListenersProps) {
  useEffect(() => {
    const onManualOpen = () => openManual();
    const onShellNavigate = (e: Event) => {
      const detail = (e as CustomEvent<{ moduleId?: string; viewId?: string }>).detail;
      if (detail?.moduleId) navigate(detail.moduleId, detail.viewId);
    };
    window.addEventListener(MANUAL_OPEN_EVENT, onManualOpen);
    window.addEventListener(SHELL_NAVIGATE_EVENT, onShellNavigate);
    return () => {
      window.removeEventListener(MANUAL_OPEN_EVENT, onManualOpen);
      window.removeEventListener(SHELL_NAVIGATE_EVENT, onShellNavigate);
    };
  }, [openManual, navigate]);

  return null;
}
