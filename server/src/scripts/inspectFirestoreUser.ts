/**
 * Read Firestore user + email_profiles for diagnostics (requires Firebase Admin credentials).
 *   npx tsx server/src/scripts/inspectFirestoreUser.ts [uid] [email]
 */
import { initializeApp, getApps, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';
import { resolveFirebaseProjectId, resolveFirestoreDatabaseId } from '../firebaseProject.js';

const uid = (process.argv[2] ?? '13MZZFXtF7hceRl1ITvmZcrgC5m2').trim();
const email = (process.argv[3] ?? 'momamo242@gmail.com').trim().toLowerCase();

function initAdmin() {
  const projectId = resolveFirebaseProjectId();
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID not configured');

  if (getApps().length) return getApps()[0]!;

  const rawSa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (rawSa) {
    return initializeApp({
      credential: cert(JSON.parse(rawSa) as Parameters<typeof cert>[0]),
      projectId,
    });
  }
  const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
  if (saPath && fs.existsSync(saPath)) {
    return initializeApp({
      credential: cert(JSON.parse(fs.readFileSync(saPath, 'utf8')) as Parameters<typeof cert>[0]),
      projectId,
    });
  }
  return initializeApp({ credential: applicationDefault(), projectId });
}

const app = initAdmin();
const databaseId = resolveFirestoreDatabaseId();
const db = databaseId === '(default)' ? getFirestore(app) : getFirestore(app, databaseId);

const userSnap = await db.collection('users').doc(uid).get();
const profileSnap = await db.collection('email_profiles').doc(email).get();

console.log(JSON.stringify({
  databaseId,
  uid,
  email,
  users: userSnap.exists ? userSnap.data() : null,
  email_profiles: profileSnap.exists ? profileSnap.data() : null,
}, null, 2));
