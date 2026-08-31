import { prisma } from '../db.js';
import { roundMoney } from './money.js';

/**
 * المسدد on a contractor leaf (21102… / 21101…):
 * sum of **debit lines** on that account whose effective cost center
 * (line costCenterId, else journal header) is one of the requested centers,
 * and the same journal credits a cash-like source:
 *   - 121… bank / transfer / cash fund / custody
 *   - 21601… issued-cheque payable (ISS leg)
 *
 * Accrual journals (Cr expense / Dr contractor reverse / etc.) are excluded.
 */

export type ContractorCashJournal = {
  isDeleted?: boolean;
  costCenterId?: string | null;
  entries?: Array<{
    accountCode?: string | null;
    debit?: unknown;
    credit?: unknown;
    costCenterId?: string | null;
  }>;
};

export function isCashPaymentSourceAccount(code: string): boolean {
  const c = String(code || '').trim();
  if (c.startsWith('121')) return true;
  if (c.startsWith('21601')) return true;
  return false;
}

function glMoney(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (value && typeof value === 'object' && typeof (value as { toNumber?: () => number }).toNumber === 'function') {
    const n = Number((value as { toNumber: () => number }).toNumber());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Effective cost center for a journal line (line override, else header). */
export function resolveLineCostCenterId(
  entry: { costCenterId?: string | null },
  transactionCostCenterId?: string | null,
): string {
  const line = String(entry.costCenterId ?? '').trim();
  if (line) return line;
  return String(transactionCostCenterId ?? '').trim();
}

/**
 * Pure aggregation — same rules as the GL account statement reading of cash outflows
 * to a contractor, scoped per debit line's cost center (not “any line in the journal”).
 */
export function sumContractorCashPaymentsFromJournals(
  txs: ContractorCashJournal[],
  supplierAccountCode: string,
  costCenterIds: string[],
): { paid: number; byCostCenter: Record<string, number> } {
  const code = String(supplierAccountCode || '').trim();
  const centers = new Set(costCenterIds.map((id) => String(id).trim()).filter(Boolean));
  const byCostCenter: Record<string, number> = {};
  if (!code || centers.size === 0) return { paid: 0, byCostCenter };

  for (const tx of txs) {
    if (tx.isDeleted) continue;
    const entries = tx.entries ?? [];
    const hasCashSource = entries.some(
      (e) => glMoney(e.credit) > 0 && isCashPaymentSourceAccount(String(e.accountCode || '')),
    );
    if (!hasCashSource) continue;

    for (const e of entries) {
      if (String(e.accountCode || '').trim() !== code) continue;
      const debit = glMoney(e.debit);
      if (debit <= 0) continue;
      const cc = resolveLineCostCenterId(e, tx.costCenterId);
      if (!cc || !centers.has(cc)) continue;
      byCostCenter[cc] = roundMoney((byCostCenter[cc] ?? 0) + debit);
    }
  }

  const paid = roundMoney(Object.values(byCostCenter).reduce((s, n) => s + n, 0));
  return { paid, byCostCenter };
}

/** Load matching journals from Postgres and aggregate المسدد. */
export async function queryContractorCashPayments(
  accountCode: string,
  costCenterIds: string[],
): Promise<{ paid: number; byCostCenter: Record<string, number>; accountCode: string }> {
  const code = String(accountCode || '').trim();
  const centers = [...new Set(costCenterIds.map((id) => String(id).trim()).filter(Boolean))];
  if (!code || centers.length === 0) {
    return { paid: 0, byCostCenter: {}, accountCode: code };
  }

  const rows = await prisma.transaction.findMany({
    where: {
      isDeleted: false,
      AND: [
        {
          entries: {
            some: {
              accountCode: code,
              debit: { gt: 0 },
            },
          },
        },
        {
          OR: [
            {
              entries: {
                some: {
                  accountCode: { startsWith: '121' },
                  credit: { gt: 0 },
                },
              },
            },
            {
              entries: {
                some: {
                  accountCode: { startsWith: '21601' },
                  credit: { gt: 0 },
                },
              },
            },
          ],
        },
      ],
    },
    select: {
      costCenterId: true,
      isDeleted: true,
      entries: {
        select: {
          accountCode: true,
          debit: true,
          credit: true,
          costCenterId: true,
        },
      },
    },
  });

  const { paid, byCostCenter } = sumContractorCashPaymentsFromJournals(rows, code, centers);
  return { paid, byCostCenter, accountCode: code };
}
