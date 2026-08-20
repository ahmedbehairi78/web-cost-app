import { prisma } from '../db.js';
import { roundMoney } from './money.js';
import { journalDateQueryUpperBound } from './journalDate.js';
import {
  computeCashBudgetSummary,
  custodyReplenishAmount,
  isBankLeafCode,
  isClientReceivableLeafCode,
  isCustodyCashLeafCode,
  isEightDigitLeafCode,
  isSalariesPayableLeafCode,
  isSubcontractorLeafCode,
  isSupplierLeafCode,
  liabilityPayableAmount,
  type CashBudgetPeriodType,
} from './cashBudget.js';

export type SuggestedLine = {
  side: 'obligation' | 'source';
  category: string;
  description: string;
  amount: number;
  dueDate: string | null;
  origin: 'auto';
  originType: string;
  originId: string;
  projectId: string | null;
  contractId: string | null;
  excluded: boolean;
  sortOrder: number;
};

const GL_PREFIXES = ['12101', '12102', '12201', '21101', '21102', '21501'] as const;

function num(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && 'toNumber' in v && typeof (v as { toNumber: () => number }).toNumber === 'function') {
    return (v as { toNumber: () => number }).toNumber();
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function accountLabel(name: string | null | undefined, code: string): string {
  const n = String(name ?? '').trim();
  return n ? `${n} (${code})` : code;
}

/** Net debit per 8-digit leaf as of `asOf` inclusive. */
async function glLeafNetsThrough(asOf: string): Promise<Map<string, number>> {
  const upper = journalDateQueryUpperBound(asOf);
  const rows = await prisma.journalEntry.findMany({
    where: {
      OR: GL_PREFIXES.map((prefix) => ({ accountCode: { startsWith: prefix } })),
      transaction: {
        isDeleted: false,
        ...(upper ? { date: { lte: upper } } : {}),
      },
    },
    select: { accountCode: true, debit: true, credit: true },
  });
  const byCode = new Map<string, number>();
  for (const row of rows) {
    const code = String(row.accountCode ?? '').trim();
    if (!isEightDigitLeafCode(code)) continue;
    const net = roundMoney(num(row.debit) - num(row.credit));
    byCode.set(code, roundMoney((byCode.get(code) ?? 0) + net));
  }
  return byCode;
}

function sumPositiveNets(byCode: Map<string, number>, match: (code: string) => boolean): number {
  let total = 0;
  for (const [code, net] of byCode) {
    if (!match(code)) continue;
    total = roundMoney(total + Math.max(0, net));
  }
  return total;
}

/**
 * Snapshot as of period end (no GL posting):
 * sources = banks 12101 + cash/treasury 12102 + uncollected IPCs 12201
 * obligations = supplier 21101 credit + subcontractor 21102 credit
 *   + salaries payable 21501 credit + custody replenish when 12102 < min
 */
export async function buildCashBudgetSuggestion(input: {
  periodType: CashBudgetPeriodType;
  periodStart: string;
  periodEnd: string;
}): Promise<{ openingBank: number; openingCash: number; lines: SuggestedLine[] }> {
  const asOf = input.periodEnd;
  void input.periodType;
  void input.periodStart;
  const [nets, settlements, accounts] = await Promise.all([
    glLeafNetsThrough(asOf),
    prisma.custodySettlement.findMany({
      where: { isDeleted: false, status: 'submitted' },
      select: { custodyAccountCode: true, totalAmount: true },
    }),
    prisma.chartOfAccount.findMany({
      where: { isGroup: false, status: { not: 'disabled' } },
      select: {
        id: true,
        accountCode: true,
        accountName: true,
        minBalance: true,
        projectId: true,
      },
    }),
  ]);

  const pendingByCustody = new Map<string, number>();
  for (const row of settlements) {
    const code = String(row.custodyAccountCode ?? '').trim();
    pendingByCustody.set(code, roundMoney((pendingByCustody.get(code) ?? 0) + num(row.totalAmount)));
  }

  const coaByCode = new Map(accounts.map((a) => [String(a.accountCode ?? '').trim(), a]));

  const lines: SuggestedLine[] = [];
  let sort = 0;
  const push = (line: Omit<SuggestedLine, 'origin' | 'excluded' | 'sortOrder'>) => {
    if (roundMoney(line.amount) <= 0) return;
    lines.push({ ...line, origin: 'auto', excluded: false, sortOrder: sort++ });
  };

  const pushLeaf = (
    code: string,
    spec: { side: 'obligation' | 'source'; category: string; label: string; amount: number },
  ) => {
    const acc = coaByCode.get(code);
    push({
      side: spec.side,
      category: spec.category,
      description: `${spec.label} — ${accountLabel(acc?.accountName, code)}`,
      amount: spec.amount,
      dueDate: asOf,
      originType: 'gl_leaf',
      originId: acc?.id || code,
      projectId: acc?.projectId ?? null,
      contractId: null,
    });
  };

  for (const [code, net] of [...nets.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (isBankLeafCode(code)) {
      pushLeaf(code, {
        side: 'source',
        category: 'opening_bank',
        label: 'بنك',
        amount: Math.max(0, net),
      });
    } else if (isCustodyCashLeafCode(code)) {
      pushLeaf(code, {
        side: 'source',
        category: 'opening_cash',
        label: 'خزينة / عهدة',
        amount: Math.max(0, net),
      });
    } else if (isClientReceivableLeafCode(code)) {
      pushLeaf(code, {
        side: 'source',
        category: 'collection',
        label: 'مستخلصات تحت التحصيل',
        amount: Math.max(0, net),
      });
    } else if (isSupplierLeafCode(code)) {
      pushLeaf(code, {
        side: 'obligation',
        category: 'supplier',
        label: 'موردون',
        amount: liabilityPayableAmount(net),
      });
    } else if (isSubcontractorLeafCode(code)) {
      pushLeaf(code, {
        side: 'obligation',
        category: 'subcontractor',
        label: 'مقاولو باطن',
        amount: liabilityPayableAmount(net),
      });
    } else if (isSalariesPayableLeafCode(code)) {
      pushLeaf(code, {
        side: 'obligation',
        category: 'payroll',
        label: 'رواتب مستحقة',
        amount: liabilityPayableAmount(net),
      });
    }
  }

  for (const acc of accounts) {
    const code = String(acc.accountCode ?? '').trim();
    if (!isCustodyCashLeafCode(code)) continue;
    const gl = nets.get(code) ?? 0;
    const pending = pendingByCustody.get(code) ?? 0;
    const replenish = custodyReplenishAmount(num(acc.minBalance), gl, pending);
    if (replenish <= 0) continue;
    push({
      side: 'obligation',
      category: 'custody_replenish',
      description: `تعويض حد أدنى عهدة — ${accountLabel(acc.accountName, code)}`,
      amount: replenish,
      dueDate: asOf,
      originType: 'custody_min',
      originId: acc.id || code,
      projectId: acc.projectId,
      contractId: null,
    });
  }

  return {
    openingBank: sumPositiveNets(nets, isBankLeafCode),
    openingCash: sumPositiveNets(nets, isCustodyCashLeafCode),
    lines,
  };
}

export { computeCashBudgetSummary };
