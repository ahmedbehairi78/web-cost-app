import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { boqHasRateBreakdown, boqRateFieldsFromSource } from '../migration/boqRateFields.js';
import { isFirestoreServiceAccountConfigured } from '../migration/backfillBoqRates.js';

type BoqRow = {
  id: string;
  rateMaterials: Prisma.Decimal | number;
  rateLabour: Prisma.Decimal | number;
  rateEquipment: Prisma.Decimal | number;
  rateDirect?: Prisma.Decimal | number;
  rateOverheadPct?: Prisma.Decimal | number;
  rateProfitPct?: Prisma.Decimal | number;
  unitRateTotal: Prisma.Decimal | number;
  tenderAmount: Prisma.Decimal | number;
  [key: string]: unknown;
};

function dec(n: number): Prisma.Decimal {
  return new Prisma.Decimal(Number.isFinite(n) ? n : 0);
}

function rowNeedsOverlay(row: BoqRow): boolean {
  if (Number(row.rateMaterials) !== 0 || Number(row.rateLabour) !== 0 || Number(row.rateEquipment) !== 0) {
    return false;
  }
  return Number(row.unitRateTotal) > 0 || Number(row.tenderAmount) > 0;
}

/** Load Firestore BOQ docs by id (admin SDK). Returns empty map when SA is not configured. */
export async function fetchFirestoreBoqDocsByIds(ids: string[]): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  if (!ids.length || !isFirestoreServiceAccountConfigured()) return map;

  const fs = await import('node:fs');
  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const { resolveFirebaseProjectId, resolveFirestoreDatabaseId } = await import('../firebaseProject.js');

  const projectId = resolveFirebaseProjectId();
  if (!projectId) return map;

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
      if (!saPath || !fs.existsSync(saPath)) return map;
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

  for (const id of ids) {
    const snap = await db.collection('boq_items').doc(id).get();
    if (snap.exists) map.set(id, { _id: snap.id, ...snap.data() });
  }
  return map;
}

/** Write-through: fill missing Postgres rate columns from Firestore when available. */
export async function enrichBoqItemsFromFirestore<T extends BoqRow>(rows: T[]): Promise<T[]> {
  const needing = rows.filter(rowNeedsOverlay);
  if (needing.length === 0) return rows;

  const fsMap = await fetchFirestoreBoqDocsByIds(needing.map((r) => r.id));
  if (fsMap.size === 0) return rows;

  const patched = new Map<string, BoqRow>();
  for (const row of needing) {
    const fs = fsMap.get(row.id);
    if (!fs) continue;
    const rates = boqRateFieldsFromSource(fs);
    if (!boqHasRateBreakdown(rates)) continue;

    await prisma.boqItem.update({
      where: { id: row.id },
      data: {
        rateMaterials: dec(rates.rateMaterials),
        rateLabour: dec(rates.rateLabour),
        rateEquipment: dec(rates.rateEquipment),
        rateDirect: dec(rates.rateDirect),
        rateOverheadPct: dec(rates.rateOverheadPct),
        rateProfitPct: dec(rates.rateProfitPct),
      },
    });

    patched.set(row.id, {
      ...row,
      rateMaterials: dec(rates.rateMaterials),
      rateLabour: dec(rates.rateLabour),
      rateEquipment: dec(rates.rateEquipment),
      rateDirect: dec(rates.rateDirect),
      rateOverheadPct: dec(rates.rateOverheadPct),
      rateProfitPct: dec(rates.rateProfitPct),
    });
  }

  if (patched.size === 0) return rows;
  return rows.map((row) => (patched.has(row.id) ? ({ ...row, ...patched.get(row.id)! } as T) : row));
}
