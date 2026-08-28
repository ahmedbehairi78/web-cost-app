import type { Prisma } from '@prisma/client';
import { AccountCodes } from './accountCodes.js';
import { createTransaction } from './journal.js';
import type { JournalEntryInput } from './journalShared.js';
import { roundMoney } from '../lib/money.js';

export const SUPPLIER_PARENT = '21101';
export const SUBCONTRACTOR_PARENT = '21102';

export function nextPayableLeafCode(existingCodes: string[], parent: '21101' | '21102'): string {
  const leaves = existingCodes
    .map((c) => String(c).trim())
    .filter((c) => c.length === 8 && c.startsWith(parent) && /^\d+$/.test(c))
    .map((c) => Number.parseInt(c, 10));
  const fallback = Number.parseInt(`${parent}001`, 10);
  const max = leaves.length > 0 ? Math.max(...leaves) : fallback;
  return String(max + 1);
}

export function isReservedControlPayableCode(code: string): boolean {
  return code === AccountCodes.SUPPLIERS || code === AccountCodes.SUBCONTRACTORS;
}

export function parentForPartyType(type: 'supplier' | 'subcontractor'): '21101' | '21102' {
  return type === 'supplier' ? SUPPLIER_PARENT : SUBCONTRACTOR_PARENT;
}

export type OpeningCreditorLine = {
  accountCode: string;
  accountName: string;
  /** Credit (amount owed). Negative = debit (advance). */
  amount: number;
};

export function buildOpeningCreditorsEntries(
  lines: OpeningCreditorLine[],
  partnersAccountName = 'جاري الشركاء',
): JournalEntryInput[] {
  const entries: JournalEntryInput[] = [];
  let netCredit = 0;

  for (const line of lines) {
    const amount = roundMoney(line.amount);
    if (amount === 0) continue;
    if (amount > 0) {
      entries.push({
        accountCode: line.accountCode,
        accountName: line.accountName,
        debit: 0,
        credit: amount,
      });
      netCredit = roundMoney(netCredit + amount);
    } else {
      const debit = roundMoney(-amount);
      entries.push({
        accountCode: line.accountCode,
        accountName: line.accountName,
        debit,
        credit: 0,
      });
      netCredit = roundMoney(netCredit - debit);
    }
  }

  if (entries.length === 0) {
    throw new Error('Opening creditors total must not be zero');
  }

  if (netCredit > 0) {
    entries.unshift({
      accountCode: AccountCodes.PARTNERS_CURRENT,
      accountName: partnersAccountName,
      debit: netCredit,
      credit: 0,
    });
  } else if (netCredit < 0) {
    entries.unshift({
      accountCode: AccountCodes.PARTNERS_CURRENT,
      accountName: partnersAccountName,
      debit: 0,
      credit: roundMoney(-netCredit),
    });
  }

  return entries;
}

export async function postOpeningCreditorsJournal(
  tx: Prisma.TransactionClient,
  params: {
    date: string;
    reference: string;
    lines: OpeningCreditorLine[];
    userId?: string;
  },
): Promise<string> {
  const entries = buildOpeningCreditorsEntries(params.lines);
  const journal = await createTransaction(
    {
      date: params.date,
      description: 'أرصدة افتتاحية — موردون ومقاولو باطن',
      reference: params.reference,
      entries,
    },
    params.userId,
    tx,
  );
  return String(journal.id);
}

export function buildOpeningCreditorsReference(when = new Date()): string {
  const y = when.getFullYear();
  const m = String(when.getMonth() + 1).padStart(2, '0');
  const d = String(when.getDate()).padStart(2, '0');
  const hh = String(when.getHours()).padStart(2, '0');
  const mm = String(when.getMinutes()).padStart(2, '0');
  const ss = String(when.getSeconds()).padStart(2, '0');
  return `AP-OPEN-${y}${m}${d}-${hh}${mm}${ss}`;
}
