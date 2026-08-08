/**
 * Export Firestore `users/{uid}` docs to JSON for Phase 4 migration.
 * Requires FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH.
 *
 *   npx tsx server/src/scripts/exportFirestoreUsers.ts [output.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { resolveFirebaseProjectId, resolveFirestoreDatabaseId } from '../firebaseProject.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const defaultOut = path.join(repoRoot, 'backups', 'users-export.json');

const outPath = path.resolve(process.argv[2] || defaultOut);

const projectId = resolveFirebaseProjectId();
if (!projectId) {
  console.error('Firebase projectId not configured.');
  process.exit(1);
}

let adminApp = getApps()[0];
if (!adminApp) {
  const rawSa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (rawSa) {
    const serviceAccount = JSON.parse(rawSa) as Record<string, unknown>;
    adminApp = initializeApp({
      credential: cert(serviceAccount as Parameters<typeof cert>[0]),
      projectId,
    });
  } else {
    const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
    if (!saPath || !fs.existsSync(saPath)) {
      console.error('Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH');
      process.exit(1);
    }
    const serviceAccount = JSON.parse(fs.readFileSync(saPath, 'utf8')) as Record<string, unknown>;
    adminApp = initializeApp({
      credential: cert(serviceAccount as Parameters<typeof cert>[0]),
      projectId,
    });
  }
}

const databaseId = resolveFirestoreDatabaseId();
const db =
  databaseId === '(default)' ? getFirestore(adminApp) : getFirestore(adminApp, databaseId);

const snap = await db.collection('users').get();
const users = snap.docs.map((d) => ({ _id: d.id, ...d.data() }));
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(
  outPath,
  JSON.stringify({ exportedAt: new Date().toISOString(), users }, null, 2),
  'utf8',
);
console.log(`Exported ${users.length} users → ${outPath}`);
console.log('Import with: npm run local:migrate -- --users', outPath);
