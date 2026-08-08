import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  clearModuleDraft,
  listModuleDraftIds,
  readModuleDraft,
  writeModuleDraft,
} from '../lib/moduleDraftStore';
import { getModuleMenu, resolveModuleViewId } from '../constants/moduleMenus';
import { logActivity } from '../services/activityLogService';

export interface WorkspaceLocation {
  moduleId: string;
  viewId: string;
  /** Bumps on forced re-navigation (e.g. notification deep-link to the same view). */
  remountKey?: number;
}

export interface ErpNavigateOptions {
  /** Remount even when module+view are already active (notification / deep-link). */
  force?: boolean;
}

export interface ErpWorkspaceContextValue {
  enabled: boolean;
  location: WorkspaceLocation | null;
  navigateTo: (moduleId: string, viewId?: string, opts?: ErpNavigateOptions) => void;
  closeWorkspace: () => void;
  getModuleDraft: <T>(moduleId: string) => T | null;
  setModuleDraft: (moduleId: string, data: unknown) => void;
  clearModuleDraft: (moduleId: string) => void;
  modulesWithDrafts: ReadonlySet<string>;
  refreshDraftIndex: () => void;
}

const ErpWorkspaceContext = createContext<ErpWorkspaceContextValue | null>(null);

interface ErpWorkspaceProviderProps {
  enabled: boolean;
  userKey: string;
  children: ReactNode;
}

export function ErpWorkspaceProvider({ enabled, userKey, children }: ErpWorkspaceProviderProps) {
  const [location, setLocation] = useState<WorkspaceLocation | null>(null);
  const [draftIndex, setDraftIndex] = useState(0);

  const refreshDraftIndex = useCallback(() => {
    setDraftIndex((n) => n + 1);
  }, []);

  const modulesWithDrafts = useMemo(() => {
    void draftIndex;
    return new Set(listModuleDraftIds(userKey));
  }, [userKey, draftIndex, location?.moduleId]);

  const getModuleDraft = useCallback(
    <T,>(moduleId: string): T | null => readModuleDraft<T>(userKey, moduleId),
    [userKey],
  );

  const setModuleDraft = useCallback(
    (moduleId: string, data: unknown) => {
      const prev = readModuleDraft(userKey, moduleId);
      const nextJson = JSON.stringify(data);
      if (JSON.stringify(prev) === nextJson) return;
      writeModuleDraft(userKey, moduleId, data);
      refreshDraftIndex();
    },
    [userKey, refreshDraftIndex],
  );

  const clearModuleDraftForModule = useCallback(
    (moduleId: string) => {
      clearModuleDraft(userKey, moduleId);
      refreshDraftIndex();
    },
    [userKey, refreshDraftIndex],
  );

  const navigateTo = useCallback(
    (moduleId: string, viewId?: string, opts?: ErpNavigateOptions) => {
      if (!enabled) return;
      const resolvedView = resolveModuleViewId(moduleId, viewId);
      const isSameModule = location?.moduleId === moduleId;
      const isSameView = isSameModule && location?.viewId === resolvedView;

      if (isSameView && !opts?.force) return;

      queueMicrotask(() =>
        void logActivity({
          kind: isSameModule ? 'module_focus' : 'module_open',
          moduleId,
          detail: resolvedView,
        }),
      );

      setLocation({
        moduleId,
        viewId: resolvedView,
        remountKey: opts?.force ? Date.now() : location?.remountKey,
      });
    },
    [enabled, location],
  );

  const closeWorkspace = useCallback(() => {
    if (location) {
      queueMicrotask(() =>
        void logActivity({ kind: 'module_close', moduleId: location.moduleId }),
      );
    }
    setLocation(null);
  }, [location]);

  const value = useMemo<ErpWorkspaceContextValue>(
    () => ({
      enabled,
      location,
      navigateTo,
      closeWorkspace,
      getModuleDraft,
      setModuleDraft,
      clearModuleDraft: clearModuleDraftForModule,
      modulesWithDrafts,
      refreshDraftIndex,
    }),
    [
      enabled,
      location,
      navigateTo,
      closeWorkspace,
      getModuleDraft,
      setModuleDraft,
      clearModuleDraftForModule,
      modulesWithDrafts,
      refreshDraftIndex,
    ],
  );

  return <ErpWorkspaceContext.Provider value={value}>{children}</ErpWorkspaceContext.Provider>;
}

export function useErpWorkspace(): ErpWorkspaceContextValue {
  const ctx = useContext(ErpWorkspaceContext);
  if (!ctx) throw new Error('useErpWorkspace must be used within ErpWorkspaceProvider');
  return ctx;
}

export function useErpWorkspaceOptional(): ErpWorkspaceContextValue | null {
  return useContext(ErpWorkspaceContext);
}

export function getDefaultViewForModule(moduleId: string): string {
  return getModuleMenu(moduleId)?.defaultViewId ?? 'main';
}
