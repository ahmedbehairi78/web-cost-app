import { createRemoteJWKSet, jwtVerify } from 'jose';
import { resolveFirebaseProjectId } from '../firebaseProject.js';

const FIREBASE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

export type VerifiedFirebaseIdentity = {
  email: string;
  displayName: string | null;
  uid: string | null;
};

export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseIdentity> {
  const projectId = resolveFirebaseProjectId();
  if (!projectId) {
    throw new Error('firebase_project_unconfigured');
  }

  const JWKS = createRemoteJWKSet(new URL(FIREBASE_JWKS_URL));
  const issuer = `https://securetoken.google.com/${projectId}`;
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer,
    audience: projectId,
    algorithms: ['RS256'],
  });

  const emailRaw = typeof payload.email === 'string' ? payload.email.trim() : '';
  const verified =
    payload.email_verified === true ||
    payload.email_verified === 'true' ||
    payload.email_verified === undefined;

  if (!emailRaw || !verified) {
    throw new Error('invalid_firebase_email');
  }

  const displayName =
    typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : null;
  const uid = typeof payload.sub === 'string' ? payload.sub : null;

  return { email: emailRaw, displayName, uid };
}
