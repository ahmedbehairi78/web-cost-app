import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ModuleCrudPermission, PermissionKey, UserPermissions, UserRole } from '../types';
import { ALL_PERMISSIONS } from '../types';
import { moduleAccess } from '../lib/permissions';

export type PermissionsContextValue = {
  permissions: UserPermissions;
  role: UserRole;
  isAdmin: boolean;
  /** Effective module capabilities (admin → all true). */
  can: (key: PermissionKey) => ModuleCrudPermission;
};

const PermissionsContext = createContext<PermissionsContextValue | null>(null);

/** Imperative sync from `App` so lazy-loaded windows share the same provider instance as the shell. */
const SetAppPermissionsContext = createContext<((p: UserPermissions, r: 'admin' | 'user') => void) | null>(null);

export function PermissionsProvider({
  children,
  permissions,
  role,
}: {
  children: React.ReactNode;
  permissions: UserPermissions;
  role: UserRole;
}) {
  const isAdmin = role === 'admin';
  const value = useMemo<PermissionsContextValue>(
    () => ({
      permissions,
      role,
      isAdmin,
      can: (key: PermissionKey) => {
        if (isAdmin) return { view: true, create: true, edit: true };
        return moduleAccess(permissions, key);
      },
    }),
    [permissions, role, isAdmin],
  );
  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

/** Wrap the app in `main.tsx` (inside `LanguageProvider`). `App` calls `useSetAppPermissions()` on login/session changes. */
export function AppPermissionsRoot({ children }: { children: React.ReactNode }) {
  const [permissions, setPermissions] = useState<UserPermissions>(ALL_PERMISSIONS);
  const [role, setRole] = useState<UserRole>('user');
  const setAppPermissions = useCallback((p: UserPermissions, r: UserRole) => {
    setPermissions(p);
    setRole(r);
  }, []);
  return (
    <SetAppPermissionsContext.Provider value={setAppPermissions}>
      <PermissionsProvider permissions={permissions} role={role}>
        {children}
      </PermissionsProvider>
    </SetAppPermissionsContext.Provider>
  );
}

export function useSetAppPermissions(): (p: UserPermissions, r: UserRole) => void {
  const fn = useContext(SetAppPermissionsContext);
  if (!fn) {
    throw new Error('useSetAppPermissions must be used within AppPermissionsRoot');
  }
  return fn;
}

export function usePermissions(): PermissionsContextValue {
  const ctx = useContext(PermissionsContext);
  if (!ctx) {
    throw new Error('usePermissions must be used within PermissionsProvider');
  }
  return ctx;
}

export function useOptionalPermissions(): PermissionsContextValue | null {
  return useContext(PermissionsContext);
}
