import bcrypt from 'bcrypt';

/** Marker hashed for accounts without admin-assigned password login. */
export const NO_PASSWORD_LOGIN_MARKER = '__PASSWORD_LOGIN_DISABLED__';

let cachedUnusableHash: string | null = null;

export async function unusablePasswordHash(): Promise<string> {
  if (!cachedUnusableHash) {
    cachedUnusableHash = await bcrypt.hash(NO_PASSWORD_LOGIN_MARKER, 4);
  }
  return cachedUnusableHash;
}

export async function hashLoginPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain.trim(), 12);
}

export async function isPasswordLoginConfigured(passwordHash: string): Promise<boolean> {
  if (!passwordHash) return false;
  return !(await bcrypt.compare(NO_PASSWORD_LOGIN_MARKER, passwordHash));
}

export async function verifyLoginPassword(plain: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(plain, passwordHash);
}
