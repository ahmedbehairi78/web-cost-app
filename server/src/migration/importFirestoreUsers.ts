import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { prisma } from '../db.js';
import { resolveFirebaseProjectId, resolveFirestoreDatabaseId } from '../firebaseProject.js';
import {
  makeCounter,
  nullIfEmpty,
  parseJsonArray,
  str,
  type ImportCounts,
} from './helpers.js';
import { collection, type FirestoreBackupFile, type FirestoreDoc } from './parseFirestoreBackup.js';
import { resolvePermissionsFromUserData, type UserRole } from '../permissions.js';

export type FirestoreUsersImportReport = {
  source: string;
  counts: ImportCounts;
  skipped: ImportCounts;
};

async function unusablePasswordHash(): Promise<string> {
  return bcrypt.hash(randomUUID(), 4);
}

function normalizeRole(role: unknown): UserRole {
  const r = str(role);
  if (r === 'admin' || r === 'projects_manager' || r === 'project_accountant' || r === 'user') {
    return r;
  }
  return 'user';
}

async function upsertFirestoreUserDoc(
  doc: FirestoreDoc,
  bump: (key: string, n?: number) => void,
  skip: (key: string, n?: number) => void,
): Promise<void> {
  const firebaseUid = str(doc._id);
  const email = str(doc.email).toLowerCase();
  if (!firebaseUid || !email) {
    skip('users_missing_email_or_uid');
    return;
  }

  const role = normalizeRole(doc.role);
  const permissions = resolvePermissionsFromUserData({ role, permissions: doc.permissions });
  const assignedContractIds = parseJsonArray(doc.assignedContractIds ?? doc.assigned_contract_ids);
  const displayName = nullIfEmpty(doc.displayName ?? doc.display_name);

  const existingByEmail = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
  });
  const existingById = await prisma.user.findUnique({ where: { id: firebaseUid } });

  let passwordHash = existingByEmail?.passwordHash ?? existingById?.passwordHash;
  if (!passwordHash) passwordHash = await unusablePasswordHash();

  if (existingByEmail && existingByEmail.id !== firebaseUid) {
    await prisma.user.delete({ where: { id: existingByEmail.id } });
  }
  if (existingById && existingById.email.toLowerCase() !== email) {
    await prisma.user.delete({ where: { id: firebaseUid } });
  }

  await prisma.user.upsert({
    where: { id: firebaseUid },
    create: {
      id: firebaseUid,
      email,
      displayName,
      passwordHash,
      role,
      permissions,
      assignedContractIds,
      isActive: doc.isActive !== false && doc.isDeleted !== true,
    },
    update: {
      email,
      displayName,
      role,
      permissions,
      assignedContractIds,
      isActive: doc.isActive !== false && doc.isDeleted !== true,
    },
  });
  bump('users');
}

export async function importFirestoreUsersFromBackup(
  backup: FirestoreBackupFile,
  sourceLabel: string,
): Promise<FirestoreUsersImportReport> {
  const { counts, skipped, bump, skip } = makeCounter();
  const docs = collection(backup, 'users');
  for (const doc of docs) {
    await upsertFirestoreUserDoc(doc, bump, skip);
  }
  return { source: sourceLabel, counts, skipped };
}

export async function importFirestoreUsersFromJsonFile(
  filePath: string,
): Promise<FirestoreUsersImportReport> {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  const { counts, skipped, bump, skip } = makeCounter();

  let docs: FirestoreDoc[] = [];
  if (Array.isArray(raw)) {
    docs = raw.map((d) => {
      const row = d as Record<string, unknown>;
      const id = str(row._id ?? row.id);
      return { _id: id, ...row };
    });
  } else if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (obj.collections && typeof obj.collections === 'object') {
      const users = (obj.collections as Record<string, FirestoreDoc[]>).users ?? [];
      docs = users;
    } else if (Array.isArray(obj.users)) {
      docs = obj.users as FirestoreDoc[];
    }
  }

  for (const doc of docs) {
    await upsertFirestoreUserDoc(doc, bump, skip);
  }
  return { source: filePath, counts, skipped };
}

function initAdminFirestore() {
  const projectId = resolveFirebaseProjectId();
  if (!projectId) return null;

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
      if (!saPath || !fs.existsSync(saPath)) return null;
      const serviceAccount = JSON.parse(fs.readFileSync(saPath, 'utf8')) as Record<string, unknown>;
      adminApp = initializeApp({
        credential: cert(serviceAccount as Parameters<typeof cert>[0]),
        projectId,
      });
    }
  }

  const databaseId = resolveFirestoreDatabaseId();
  return databaseId === '(default)' ? getFirestore(adminApp) : getFirestore(adminApp, databaseId);
}

export async function importFirestoreUsersLive(): Promise<FirestoreUsersImportReport | null> {
  const db = initAdminFirestore();
  if (!db) return null;

  const { counts, skipped, bump, skip } = makeCounter();
  const snap = await db.collection('users').get();
  for (const docSnap of snap.docs) {
    await upsertFirestoreUserDoc({ _id: docSnap.id, ...docSnap.data() }, bump, skip);
  }
  return { source: 'firestore:users (live Admin SDK)', counts, skipped };
}

export async function printFirestoreUsersReport(report: FirestoreUsersImportReport): Promise<void> {
  console.log('\n=== Firestore users → Postgres import report ===');
  console.log(`Source: ${report.source}`);
  console.log('\nImported row counts:');
  for (const [k, v] of Object.entries(report.counts).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${k}: ${v}`);
  }
  if (Object.keys(report.skipped).length > 0) {
    console.log('\nSkipped:');
    for (const [k, v] of Object.entries(report.skipped)) {
      console.log(`  ${k}: ${v}`);
    }
  }
}
