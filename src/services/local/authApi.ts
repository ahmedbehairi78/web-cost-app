import { apiClient } from '../../lib/apiClient';
import type { AppUser } from '../../types';

export type PreLoginCheckResult = { allowed: boolean; status: 'registered' | 'not_found' };

export const authApi = {
  /** Login screen: verify email was added by admin before Google sign-in. */
  preLoginCheck: (email: string) =>
    apiClient.post<PreLoginCheckResult>('/auth/pre-login-check', { email }),
  login: (email: string, password: string) =>
    apiClient.post<AppUser>('/auth/login', { email, password }),
  /** After Firebase sign-in, open Express session for `VITE_DATA_BACKEND=local`. */
  firebaseSession: (idToken: string) =>
    apiClient.post<AppUser>('/auth/firebase-session', { idToken }),
  syncFirebaseUser: (
    email: string,
    role: AppUser['role'],
    permissions: AppUser['permissions'],
    assignedContractIds: string[],
    displayName?: string | null,
    password?: string,
  ) =>
    apiClient.post<AppUser>('/auth/users/firebase-sync', {
      email,
      role,
      permissions,
      assignedContractIds,
      displayName,
      ...(password ? { password } : {}),
    }),
  deactivateFirebaseUser: (email: string) =>
    apiClient.post<void>('/auth/users/firebase-deactivate', { email }),
  logout: () => apiClient.post<void>('/auth/logout'),
  me: () => apiClient.get<AppUser>('/auth/me'),
  sessionProbe: () =>
    apiClient.get<{ authenticated: boolean; user?: AppUser }>('/auth/session-probe'),
  userDirectory: () => apiClient.get<{ users: AppUser[] }>('/auth/user-directory'),
  /** Postgres → Firestore email_profiles via Admin SDK (local/Railway backend only). */
  syncEmailProfiles: () =>
    apiClient.post<{ configured: boolean; synced: number; skipped: number }>(
      '/auth/sync-email-profiles',
    ),
  verifyAdminPassword: (password: string) =>
    apiClient.post<{ ok: boolean }>('/auth/verify-admin-password', { password }),
  setUserPassword: (userId: string, password: string) =>
    apiClient.patch<void>(`/auth/users/${encodeURIComponent(userId)}/password`, { password }),
};
