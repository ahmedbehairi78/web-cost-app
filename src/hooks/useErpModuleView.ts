import { useEffect } from 'react';
import { useErpWorkspaceOptional } from '../context/ErpWorkspaceContext';

/** Sync ERP shell view id with module-local state; hide in-module tabs when `isErpShell`. */
export function useErpModuleView(moduleId: string, defaultViewId: string) {
  const erp = useErpWorkspaceOptional();
  const enabled = erp?.enabled === true;
  const isActiveModule = enabled && erp.location?.moduleId === moduleId;
  const activeViewId = isActiveModule ? erp.location!.viewId : defaultViewId;
  const isErpShell = enabled && isActiveModule;

  return {
    erp,
    enabled,
    isErpShell,
    isActiveModule,
    activeViewId,
  };
}

/** Persist module draft to session storage whenever `snapshot` changes (ERP shell only). */
export function useErpModuleDraft<T>(
  moduleId: string,
  snapshot: T,
  isErpShell: boolean,
  erp: ReturnType<typeof useErpWorkspaceOptional>,
) {
  const snapshotJson = JSON.stringify(snapshot);
  useEffect(() => {
    if (!isErpShell || !erp) return;
    erp.setModuleDraft(moduleId, JSON.parse(snapshotJson) as T);
  }, [moduleId, snapshotJson, isErpShell, erp]);
}
