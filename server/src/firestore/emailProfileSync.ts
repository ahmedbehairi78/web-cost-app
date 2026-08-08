import fs from 'node:fs';
import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { resolveFirebaseProjectId, resolveFirestoreDatabaseId } from '../firebaseProject.js';

export type EmailProfilePayload = {
  email: string;
  role: string;
  permissions?: unknown;
  assignedContractIds?: string[];
  assignedProjectIds?: string[];
};

let adminApp: App | null = null;
let adminDb: Firestore | null = null;

function initAdminFirestore(): Firestore | null {
  if (adminDb) return adminDb;
  const projectId = resolveFirebaseProjectId();
  if (!projectId) return null;

  if (!adminApp) {
    const rawSa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
    if (rawSa) {
      const serviceAccount = JSON.parse(rawSa) as Record<string, unknown>;
      adminApp = getApps().length
        ? getApps()[0]!
        : initializeApp({ credential: cert(serviceAccount as Parameters<typeof cert>[0]), projectId });
    } else {
      const repoRoot = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
      if (!repoRoot) return null;
      const serviceAccount = JSON.parse(fs.readFileSync(repoRoot, 'utf8')) as Record<string, unknown>;
      adminApp = getApps().length
        ? getApps()[0]!
        : initializeApp({ credential: cert(serviceAccount as Parameters<typeof cert>[0]), projectId });
    }
  }

  const databaseId = resolveFirestoreDatabaseId();
  adminDb = databaseId === '(default)' ? getFirestore(adminApp) : getFirestore(adminApp, databaseId);
  return adminDb;
}

export function isEmailProfileSyncConfigured(): boolean {
  return initAdminFirestore() != null;
}

export type FirestoreUserProfile = {
  role: string;
  permissions: unknown;
  assignedContractIds: unknown;
  assignedProjectIds: unknown;
};

/** Read users/{uid} from Firestore (Admin SDK) for Postgres sync on Google login. */
export async function loadFirestoreUserProfile(uid: string): Promise<FirestoreUserProfile | null> {
  const db = initAdminFirestore();
  const cleanUid = uid.trim();
  if (!db || !cleanUid) return null;
  const snap = await db.collection('users').doc(cleanUid).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data) return null;
  return {
    role: typeof data.role === 'string' ? data.role : 'user',
    permissions: data.permissions,
    assignedContractIds: data.assignedContractIds,
    assignedProjectIds: data.assignedProjectIds,
  };
}

/** Best-effort sync of Postgres/local user profile into Firestore email_profiles (rules fallback). */
export async function syncEmailProfileToFirestore(payload: EmailProfilePayload): Promise<boolean> {
  const db = initAdminFirestore();
  const emailKey = payload.email.trim().toLowerCase();
  if (!db || !emailKey) return false;

  await db.collection('email_profiles').doc(emailKey).set(
    {
      email: emailKey,
      role: payload.role,
      permissions: payload.permissions ?? null,
      assignedContractIds: Array.isArray(payload.assignedContractIds) ? payload.assignedContractIds : [],
      assignedProjectIds: Array.isArray(payload.assignedProjectIds) ? payload.assignedProjectIds : [],
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
  return true;
}

export type EmailProfileBulkSyncResult = {
  configured: boolean;
  synced: number;
  skipped: number;
};

/** Sync all active Postgres users → Firestore email_profiles (Admin SDK; bypasses client rules). */
export async function syncAllEmailProfilesToFirestore(
  users: EmailProfilePayload[],
): Promise<EmailProfileBulkSyncResult> {
  if (!isEmailProfileSyncConfigured()) {
    return { configured: false, synced: 0, skipped: users.length };
  }
  let synced = 0;
  let skipped = 0;
  for (const user of users) {
    const ok = await syncEmailProfileToFirestore(user);
    if (ok) synced += 1;
    else skipped += 1;
  }
  return { configured: true, synced, skipped };
}
