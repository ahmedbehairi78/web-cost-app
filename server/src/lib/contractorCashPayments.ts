import { prisma } from '../db.js';
import { roundMoney } from './money.js';

/**
 * المسدد on a contractor leaf (21102… / 21101…):
 * sum of **debit lines** on that account when the same journal credits a cash-like source:
 *   - 121… bank / transfer / cash fund / custody
 *   - 21601… issued-cheque payable (ISS leg)
 *
 * Cost-center scope (per debit line: line costCenterId, else journal header):
 *   1. Line/header CC ∈ requested cost centers → count
 *   2. No CC on line/header (common for bank transfers posted without contract):
 *      - if journal has projectId and projectIds were passed → count only when project matches
 *      - if journal has no projectId → count as unallocated payment on this contractor
 * Accrual journals (Cr expense) are excluded.
 */

export type ContractorCashJournal = {
  isDeleted?: boolean;
  costCenterId?: string | null;
  projectId?: string | null;
  entries?: Array<{
    accountCode?: string | null;
    debit?: unknown;
    credit?: unknown;
    costCenterId?: string | null;
  }>;
};

export type ContractorCashPaymentOptions = {
  /** When set, unallocated (no CC) payments that carry a projectId must match one of these. */
  projectIds?: string[];
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

function shouldCountUnallocatedDebit(
  txProjectId: string | null | undefined,
  projectIds: Set<string>,
): boolean {
  const txProject = String(txProjectId ?? '').trim();
  if (!txProject) return true; // fully unallocated bank/cash payment
  if (projectIds.size === 0) return true; // caller did not scope by project
  return projectIds.has(txProject);
}

/**
 * Pure aggregation — cash outflows to a contractor for IPC «المسدد».
 */
export function sumContractorCashPaymentsFromJournals(
  txs: ContractorCashJournal[],
  supplierAccountCode: string,
  costCenterIds: string[],
  options?: ContractorCashPaymentOptions,
): { paid: number; byCostCenter: Record<string, number>; unallocated: number } {
  const code = String(supplierAccountCode || '').trim();
  const centers = new Set(costCenterIds.map((id) => String(id).trim()).filter(Boolean));
  const projects = new Set((options?.projectIds ?? []).map((id) => String(id).trim()).filter(Boolean));
  const byCostCenter: Record<string, number> = {};
  let unallocated = 0;
  if (!code || centers.size === 0) return { paid: 0, byCostCenter, unallocated };

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
      if (cc) {
        if (!centers.has(cc)) continue;
        byCostCenter[cc] = roundMoney((byCostCenter[cc] ?? 0) + debit);
        continue;
      }
      // Bank transfers often omit contract (cost center) — still cash paid to this contractor.
      if (!shouldCountUnallocatedDebit(tx.projectId, projects)) continue;
      unallocated = roundMoney(unallocated + debit);
    }
  }

  const allocated = Object.values(byCostCenter).reduce((s, n) => s + n, 0);
  const paid = roundMoney(allocated + unallocated);
  return { paid, byCostCenter, unallocated };
}

/** Load matching journals from Postgres and aggregate المسدد. */
export async function queryContractorCashPayments(
  accountCode: string,
  costCenterIds: string[],
  options?: ContractorCashPaymentOptions,
): Promise<{
  paid: number;
  byCostCenter: Record<string, number>;
  unallocated: number;
  accountCode: string;
}> {
  const code = String(accountCode || '').trim();
  const centers = [...new Set(costCenterIds.map((id) => String(id).trim()).filter(Boolean))];
  if (!code || centers.length === 0) {
    return { paid: 0, byCostCenter: {}, unallocated: 0, accountCode: code };
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
      projectId: true,
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

  const { paid, byCostCenter, unallocated } = sumContractorCashPaymentsFromJournals(
    rows,
    code,
    centers,
    options,
  );
  return { paid, byCostCenter, unallocated, accountCode: code };
}
