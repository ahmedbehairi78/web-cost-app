/** Cached Firebase ID token for API Bearer auth (Phase 3 — server verifies on each request). */
let cachedIdToken: string | null = null;

export function setApiAuthIdToken(token: string | null): void {
  cachedIdToken = token?.trim() || null;
}

export function getApiAuthIdToken(): string | null {
  return cachedIdToken;
}

/** Ensure Bearer token is set when Firebase user exists (avoids early /auth/me 401). */
export async function ensureApiAuthToken(): Promise<string | null> {
  if (cachedIdToken) return cachedIdToken;
  try {
    const { auth } = await import('../firebase');
    const user = auth.currentUser;
    if (!user) return null;
    const token = await user.getIdToken();
    cachedIdToken = token;
    return token;
  } catch {
    return null;
  }
}
