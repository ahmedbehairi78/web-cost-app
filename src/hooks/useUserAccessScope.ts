import { useEffect, useMemo, useState } from 'react';
import { auth, db } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc } from 'firebase/firestore';
import { listenDoc } from '../lib/firestoreListen';
import { isLocalBackend } from '../lib/dataBackend';
import { authApi } from '../services/local/authApi';
import { usePermissions } from '../context/PermissionsContext';
import type { UserRole } from '../types';

type UserAccessScope = {
  role: UserRole;
  assignedContractIds: string[];
  assignedProjectIds: string[];
  isAdmin: boolean;
  /** Non-empty assigned contracts — filter lists to those contracts. Empty = all contracts. */
  isContractScoped: boolean;
  /** @deprecated alias of isContractScoped — do not use role names for access. */
  isProjectsManager: boolean;
  /** @deprecated alias of isContractScoped — do not use role names for access. */
  isProjectAccountant: boolean;
};

const DEFAULT_SCOPE: UserAccessScope = {
  role: 'user',
  assignedContractIds: [],
  assignedProjectIds: [],
  isAdmin: false,
  isContractScoped: false,
  isProjectsManager: false,
  isProjectAccountant: false,
};

export function useUserAccessScope(): UserAccessScope {
  const { role: permissionsRole, isAdmin: settingsAdmin } = usePermissions();
  const [firestoreRole, setFirestoreRole] = useState<UserRole>('user');
  const [assignedContractIds, setAssignedContractIds] = useState<string[]>([]);
  const [assignedProjectIds, setAssignedProjectIds] = useState<string[]>([]);

  // Local / Postgres: role comes from App session (password or Google); assigned contracts from API.
  // Do NOT gate on Firebase auth — Electron password login has no Firebase user.
  useEffect(() => {
    if (!isLocalBackend) return;

    let cancelled = false;
    authApi
      .me()
      .then((user) => {
        if (cancelled) return;
        const rawAssigned = Array.isArray(user?.assignedContractIds) ? user.assignedContractIds : [];
        setAssignedContractIds(rawAssigned.map((id: unknown) => String(id)).filter(Boolean));
        setAssignedProjectIds([]);
      })
      .catch(() => {
        if (cancelled) return;
        setAssignedContractIds([]);
        setAssignedProjectIds([]);
      });

    const unsub = onAuthStateChanged(auth, () => {
      if (cancelled) return;
      authApi
        .me()
        .then((user) => {
          if (cancelled) return;
          const rawAssigned = Array.isArray(user?.assignedContractIds) ? user.assignedContractIds : [];
          setAssignedContractIds(rawAssigned.map((id: unknown) => String(id)).filter(Boolean));
        })
        .catch(() => {
          if (!cancelled) setAssignedContractIds([]);
        });
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [permissionsRole]);

  // Cloud mode: read from Firestore users/{uid}
  useEffect(() => {
    if (isLocalBackend) return;

    const uid = auth.currentUser?.uid;
    if (!uid) {
      setFirestoreRole('user');
      setAssignedContractIds([]);
      setAssignedProjectIds([]);
      return;
    }
    const unsub = listenDoc(
      doc(db, 'users', uid),
      (snap) => {
        if (!snap.exists()) {
          setFirestoreRole('user');
          setAssignedContractIds([]);
          setAssignedProjectIds([]);
          return;
        }
        const data = snap.data() as Record<string, unknown>;
        const nextRole = String(data.role || 'user') as UserRole;
        const rawAssigned = Array.isArray(data.assignedContractIds) ? data.assignedContractIds : [];
        const rawAssignedProjects = Array.isArray(data.assignedProjectIds) ? data.assignedProjectIds : [];
        setFirestoreRole(nextRole);
        setAssignedContractIds(rawAssigned.map((id) => String(id)).filter(Boolean));
        setAssignedProjectIds(rawAssignedProjects.map((id) => String(id)).filter(Boolean));
      },
      () => {
        setFirestoreRole('user');
        setAssignedContractIds([]);
        setAssignedProjectIds([]);
      },
    );
    return () => unsub();
  }, []);

  const role = isLocalBackend ? permissionsRole : firestoreRole;
  const isContractScoped = assignedContractIds.length > 0;

  return useMemo(
    () => ({
      role,
      assignedContractIds,
      assignedProjectIds,
      isAdmin: settingsAdmin,
      isContractScoped,
      isProjectsManager: false,
      isProjectAccountant: isContractScoped,
    }),
    [role, assignedContractIds, assignedProjectIds, settingsAdmin, isContractScoped],
  );
}

export const DEFAULT_USER_ACCESS_SCOPE = DEFAULT_SCOPE;
