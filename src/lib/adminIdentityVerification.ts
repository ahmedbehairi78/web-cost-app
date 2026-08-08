import { reauthenticateWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { isLocalBackend } from './dataBackend';
import { authApi } from '../services/local/authApi';

export type AdminVerifyOptions = {
  password?: string;
};

/**
 * Verifies the administrator before sensitive operations.
 * - Google session: `reauthenticateWithPopup`
 * - Password / Express session (local/Railway): `POST /auth/verify-admin-password`
 */
export async function verifyAdministratorIdentity(options?: AdminVerifyOptions): Promise<void> {
  const password = options?.password?.trim();
  if (password && isLocalBackend) {
    await authApi.verifyAdminPassword(password);
    return;
  }

  const u = auth.currentUser;
  if (u) {
    await reauthenticateWithPopup(u, googleProvider);
    return;
  }

  if (isLocalBackend) {
    throw new Error('PASSWORD_REQUIRED');
  }

  throw new Error('NOT_SIGNED_IN');
}

export function canVerifyAdminWithPassword(): boolean {
  return isLocalBackend;
}

export function canVerifyAdminWithGoogle(): boolean {
  return auth.currentUser != null;
}
