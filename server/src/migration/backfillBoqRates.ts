import fs from 'node:fs';
import { Prisma } from '@prisma/client';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { prisma } from '../db.js';
import { boqHasRateBreakdown, boqRateFieldsFromSource } from './boqRateFields.js';
import { loadFirestoreBackup, collection } from './parseFirestoreBackup.js';
import { resolveFirebaseProjectId, resolveFirestoreDatabaseId } from '../firebaseProject.js';

export type BoqRateBackfillReport = {
  source: 'firestore-live' | string;
  scanned: number;
  updated: number;
  skippedNoPostgresRow: number;
  skippedNoRateBreakdownInSource: number;
  skippedAlreadyHadRates: number;
};

export type BoqRateBackfillPreview = {
  postgresRowsNeedingRates: number;
  firestoreConfigured: boolean;
};

function dec(n: number): Prisma.Decimal {
  return new Prisma.Decimal(Number.isFinite(n) ? n : 0);
}

export function isFirestoreServiceAccountConfigured(): boolean {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()) return true;
  const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
  return Boolean(saPath && fs.existsSync(saPath));
}

async function loadFirestoreBoqDocs(live: boolean, backupPath?: string): Promise<Record<string, unknown>[]> {
  if (live) {
    if (!isFirestoreServiceAccountConfigured()) {
      throw new Error('firebase_service_account_not_configured');
    }
    const projectId = resolveFirebaseProjectId();
    if (!projectId) {
      throw new Error('Firebase projectId not configured.');
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
        const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH!.trim();
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
    const snap = await db.collection('boq_items').get();
    return snap.docs.map((d) => ({ _id: d.id, ...d.data() }));
  }

  if (!backupPath) {
    throw new Error('Provide backup JSON path or --live');
  }
  const backup = await loadFirestoreBackup(backupPath);
  return collection(backup, 'boq_items');
}

/** Rows with tender pricing but zero rate breakdown in Postgres. */
export async function previewBoqRateBackfill(): Promise<BoqRateBackfillPreview> {
  const postgresRowsNeedingRates = await prisma.boqItem.count({
    where: {
      isDeleted: false,
      rateMaterials: { equals: dec(0) },
      rateLabour: { equals: dec(0) },
      rateEquipment: { equals: dec(0) },
      OR: [{ unitRateTotal: { gt: dec(0) } }, { tenderAmount: { gt: dec(0) } }],
    },
  });
  return {
    postgresRowsNeedingRates,
    firestoreConfigured: isFirestoreServiceAccountConfigured(),
  };
}

export async function runBoqRateBackfill(options: {
  live?: boolean;
  backupPath?: string;
}): Promise<BoqRateBackfillReport> {
  const live = options.live ?? false;
  const docs = await loadFirestoreBoqDocs(live, options.backupPath);

  let scanned = 0;
  let updated = 0;
  let skippedNoPg = 0;
  let skippedNoRates = 0;
  let skippedAlready = 0;

  for (const doc of docs) {
    scanned += 1;
    const id = String(doc._id ?? doc.id ?? '').trim();
    if (!id) continue;

    const rates = boqRateFieldsFromSource(doc);
    if (!boqHasRateBreakdown(rates)) {
      skippedNoRates += 1;
      continue;
    }

    const existing = await prisma.boqItem.findUnique({
      where: { id },
      select: {
        id: true,
        rateMaterials: true,
        rateLabour: true,
        rateEquipment: true,
      },
    });
    if (!existing) {
      skippedNoPg += 1;
      continue;
    }

    const pgHasRates =
      Number(existing.rateMaterials) !== 0
      || Number(existing.rateLabour) !== 0
      || Number(existing.rateEquipment) !== 0;
    if (pgHasRates) {
      skippedAlready += 1;
      continue;
    }

    await prisma.boqItem.update({
      where: { id },
      data: {
        rateMaterials: dec(rates.rateMaterials),
        rateLabour: dec(rates.rateLabour),
        rateEquipment: dec(rates.rateEquipment),
        rateDirect: dec(rates.rateDirect),
        rateOverheadPct: dec(rates.rateOverheadPct),
        rateProfitPct: dec(rates.rateProfitPct),
      },
    });
    updated += 1;
  }

  return {
    source: live ? 'firestore-live' : (options.backupPath ?? 'backup'),
    scanned,
    updated,
    skippedNoPostgresRow: skippedNoPg,
    skippedNoRateBreakdownInSource: skippedNoRates,
    skippedAlreadyHadRates: skippedAlready,
  };
}
