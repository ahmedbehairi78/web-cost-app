import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { roundMoney } from '../lib/money.js';

/** 8-digit cost accounts under 11… excluding accumulated depreciation 119… */
export function isFixedAssetCostAccount(code: string): boolean {
  const c = String(code ?? '').trim();
  return /^11(?!9)\d{6}$/.test(c);
}

export type FixedAssetGlSyncResult = {
  scanned: number;
  created: number;
  skipped: number;
  assets: Array<{ id: string; assetNumber: string; assetName: string; assetValue: number; assetAccountCode: string }>;
};

function suggestAssetName(description: string, accountName: string | null | undefined): string {
  const desc = String(description ?? '').trim();
  if (desc) {
    const parts = desc.split(/\s[-–—]\s/).map((p) => p.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && last.length >= 2 && !/^إثبات/.test(last)) return last;
  }
  const name = String(accountName ?? '').trim();
  return name || 'أصل ثابت';
}

/**
 * Create pending_setup register rows for GL debits on 11… cost accounts
 * that have no matching fixed_assets row yet.
 */
export async function syncFixedAssetsFromGl(): Promise<FixedAssetGlSyncResult> {
  const entries = await prisma.journalEntry.findMany({
    where: {
      debit: { gt: 0 },
      transaction: {
        isDeleted: false,
        OR: [{ journalKind: null }, { journalKind: { notIn: ['fiscal_opening'] } }],
      },
    },
    select: {
      accountCode: true,
      accountName: true,
      debit: true,
      transaction: {
        select: { id: true, date: true, description: true, reference: true },
      },
    },
  });

  const candidates = entries.filter((e) => isFixedAssetCostAccount(e.accountCode));
  const existing = await prisma.fixedAsset.findMany({
    where: { isDeleted: false },
    select: {
      assetAccountCode: true,
      acquisitionDate: true,
      assetValue: true,
      purchaseTransactionId: true,
      notes: true,
    },
  });

  const seenKeys = new Set(
    existing.map(
      (a) =>
        `${String(a.assetAccountCode).trim()}|${a.acquisitionDate}|${roundMoney(Number(a.assetValue))}`,
    ),
  );
  const seenNotes = existing.map((a) => a.notes ?? '');
  const seenPurchaseIds = new Set(
    existing.map((a) => a.purchaseTransactionId).filter((id): id is string => Boolean(id)),
  );

  const result: FixedAssetGlSyncResult = { scanned: candidates.length, created: 0, skipped: 0, assets: [] };

  for (const e of candidates) {
    const assetValue = roundMoney(Number(e.debit));
    const acquisitionDate = String(e.transaction.date ?? '').slice(0, 10);
    const accountCode = String(e.accountCode).trim();
    const reference = String(e.transaction.reference ?? '').trim();
    const assetName = suggestAssetName(e.transaction.description, e.accountName);
    const matchKey = `${accountCode}|${acquisitionDate}|${assetValue}`;

    const already =
      seenKeys.has(matchKey) ||
      (reference && seenNotes.some((n) => n.includes(reference))) ||
      seenPurchaseIds.has(e.transaction.id);
    if (already) {
      result.skipped += 1;
      continue;
    }

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `FA-${today}-`;
    const last = await prisma.fixedAsset.findFirst({
      where: { assetNumber: { startsWith: prefix } },
      orderBy: { assetNumber: 'desc' },
      select: { assetNumber: true },
    });
    const seq = last ? parseInt(last.assetNumber.slice(-4), 10) + 1 : 1;
    const assetNumber = `${prefix}${String(seq).padStart(4, '0')}`;

    const usefulLifeYears = 5;
    const annualRate = 1 / usefulLifeYears;
    const notes = [
      'مزامن من دفتر اليومية',
      reference ? `مرجع: ${reference}` : null,
      `GL:${e.transaction.id}`,
    ]
      .filter(Boolean)
      .join(' · ');

    const row = await prisma.fixedAsset.create({
      data: {
        id: randomUUID(),
        assetNumber,
        assetName,
        acquisitionDate,
        assetValue: new Prisma.Decimal(assetValue),
        salvageValue: new Prisma.Decimal(0),
        usefulLifeYears: new Prisma.Decimal(usefulLifeYears),
        depreciationModel: 'straight_line',
        annualDepreciationRate: new Prisma.Decimal(annualRate),
        assetAccountCode: accountCode,
        assetAccountName: e.accountName ?? null,
        accumulatedDepreciationAccountCode: '',
        expenseAccountCode: '',
        bookValue: new Prisma.Decimal(assetValue),
        openingAccumulatedDepr: new Prisma.Decimal(0),
        status: 'pending_setup',
        notes,
      },
    });

    seenKeys.add(matchKey);
    seenNotes.push(notes);

    result.created += 1;
    result.assets.push({
      id: row.id,
      assetNumber: row.assetNumber,
      assetName: row.assetName,
      assetValue,
      assetAccountCode: accountCode,
    });
  }

  return result;
}

const DEFAULT_GROUPS: Array<{
  groupName: string;
  defaultAssetAccountCode: string;
  defaultDepreciationAccountCode: string;
  defaultExpenseAccountCode: string;
  defaultUsefulLifeYears: number;
}> = [
  {
    groupName: 'وسائل النقل',
    defaultAssetAccountCode: '11101001',
    defaultDepreciationAccountCode: '11901001',
    defaultExpenseAccountCode: '52106001',
    defaultUsefulLifeYears: 5,
  },
];

/** Insert default fixed-asset groups when the table is empty. */
export async function bootstrapFixedAssetGroupsIfEmpty(): Promise<void> {
  const count = await prisma.fixedAssetGroup.count({ where: { isDeleted: false } });
  if (count > 0) return;
  for (const g of DEFAULT_GROUPS) {
    await prisma.fixedAssetGroup.create({
      data: {
        groupName: g.groupName,
        defaultAssetAccountCode: g.defaultAssetAccountCode,
        defaultDepreciationAccountCode: g.defaultDepreciationAccountCode,
        defaultExpenseAccountCode: g.defaultExpenseAccountCode,
        defaultDepreciationModel: 'straight_line',
        defaultUsefulLifeYears: new Prisma.Decimal(g.defaultUsefulLifeYears),
        defaultAnnualRate: new Prisma.Decimal(1 / g.defaultUsefulLifeYears),
      },
    });
  }
  console.log(`[fixed-assets] seeded ${DEFAULT_GROUPS.length} default group(s)`);
}
