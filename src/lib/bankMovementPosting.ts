import type { Account, JournalEntry } from '../services/accountingService';
import { AccountCodes } from '../services/accountingService';
import type { BankMovement, BankAccount, TransferChannel, TransferDirection, TransferScope } from '../components/banks/types';
import { normalizeTransferMeta } from './bankTransferMeta';

const COA_CODE_8 = /^\d{8}$/;

function assertLeaf8(kind: 'ar' | 'en', row: Account): void {
  const c = String(row.accountCode ?? '').trim();
  if (!COA_CODE_8.test(c)) {
    throw new Error(
      kind === 'ar'
        ? `الحساب ${c} ليس ورقة برمز 8 أرقام في الدليل.`
        : `Account ${c} is not an 8-digit chart leaf.`,
    );
  }
  if (row.isGroup || row.status === 'disabled') {
    throw new Error(
      kind === 'ar'
        ? `الحساب ${c} ليس حساباً نشطاً نهائياً في الدليل.`
        : `Account ${c} is not an active leaf account.`,
    );
  }
}

function leafById(coa: Account[], id: string | undefined | null): Account {
  const cid = String(id ?? '').trim();
  if (!cid) {
    throw new Error(
      'اختر حساب الطرف المقابل من الدليل (ورقة 8 أرقام). / Select offset GL account (8-digit leaf).',
    );
  }
  const row = coa.find((a) => a.id === cid);
  if (!row) {
    throw new Error(
      'حساب الطرف المقابل غير موجود في الدليل. / Offset chart account not found.',
    );
  }
  assertLeaf8('ar', row);
  return row;
}

function bankLeaf(b: BankAccount): { code: string; name: string } {
  const code = String(b.code ?? '').trim();
  if (!COA_CODE_8.test(code)) {
    throw new Error(
      `الحساب البنكي يجب أن يكون مرتبطاً بحساب فرعي 8 أرقام في مجموعة البنوك. / Bank account must link to an 8-digit GL bank leaf (code ${code}).`,
    );
  }
  const name = b.nameAr || b.nameEn || code;
  return { code, name };
}

function lookupSystemLeaf(coa: Account[], code: AccountCodes, labelEn: string): Account {
  const row = coa.find((a) => String(a.accountCode).trim() === code);
  if (!row) {
    throw new Error(
      `لم يُعثر على الحساب المحاسبي ${code} (${labelEn}) في شجرة الحسابات. / Chart account ${code} (${labelEn}) is missing.`,
    );
  }
  assertLeaf8('en', row);
  return row;
}

export function genBankDocNo(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

/** Egypt InstaPay / IPN fee: 0.1% with min EGP 0.5 and max EGP 20 (whole units). */
export function suggestInstapayFee(amount: number): number {
  const base = Math.abs(Number(amount));
  if (!(base > 0)) return 0;
  const raw = base * 0.001;
  return Math.min(20, Math.max(0.5, Math.round(raw)));
}

export function buildBankMovementJournalEntries(params: {
  movementType: BankMovement['movementType'];
  amount: number;
  bankAccount: BankAccount;
  toBankAccount?: BankAccount | null;
  offsetChartOfAccountId?: string | null;
  adjustmentDirection?: 'in' | 'out';
  transferScope?: TransferScope | null;
  transferChannel?: TransferChannel | null;
  transferDirection?: TransferDirection | null;
  instapayFee?: number | null;
  chartOfAccounts: Account[];
}): JournalEntry[] {
  const normalized = normalizeTransferMeta({
    movementType: params.movementType,
    transferScope: params.transferScope,
    transferChannel: params.transferChannel,
    transferDirection: params.transferDirection,
  });
  const amt = Math.abs(Number(params.amount));
  if (!(amt > 0)) {
    throw new Error('Amount must be positive to post / المبلغ يجب أن يكون موجباً للترحيل.');
  }

  const bank = bankLeaf(params.bankAccount);
  const coa = params.chartOfAccounts;

  switch (normalized.movementType) {
    case 'deposit': {
      const off = leafById(coa, params.offsetChartOfAccountId);
      return [
        { accountCode: bank.code, accountName: bank.name, debit: amt, credit: 0 },
        { accountCode: off.accountCode, accountName: off.accountName, debit: 0, credit: amt },
      ];
    }
    case 'withdrawal': {
      const off = leafById(coa, params.offsetChartOfAccountId);
      return [
        { accountCode: off.accountCode, accountName: off.accountName, debit: amt, credit: 0 },
        { accountCode: bank.code, accountName: bank.name, debit: 0, credit: amt },
      ];
    }
    case 'transfer': {
      const { transferScope, transferChannel, transferDirection } = normalized;
      const feeAmt =
        transferChannel === 'instapay' && transferDirection === 'out'
          ? Math.max(0, Math.round(Number(params.instapayFee ?? 0)))
          : 0;

      if (transferScope === 'internal') {
        const other = params.toBankAccount;
        if (!other?.id || other.id === params.bankAccount.id) {
          throw new Error(
            'Transfer requires a distinct counterparty bank account. / التحويل يحتاج حساباً بنكياً مختلفاً.',
          );
        }
        const fromBank = transferDirection === 'out' ? params.bankAccount : other;
        const toBank = transferDirection === 'out' ? other : params.bankAccount;
        const fromLeaf = bankLeaf(fromBank);
        const toLeaf = bankLeaf(toBank);
        return [
          {
            accountCode: toLeaf.code,
            accountName: toBank.nameAr || toBank.nameEn || toLeaf.code,
            debit: amt,
            credit: 0,
          },
          {
            accountCode: fromLeaf.code,
            accountName: fromBank.nameAr || fromBank.nameEn || fromLeaf.code,
            debit: 0,
            credit: amt,
          },
        ];
      }

      const off = leafById(coa, params.offsetChartOfAccountId);
      if (transferDirection === 'out') {
        const lines: JournalEntry[] = [
          { accountCode: off.accountCode, accountName: off.accountName, debit: amt, credit: 0 },
          { accountCode: bank.code, accountName: bank.name, debit: 0, credit: amt + feeAmt },
        ];
        if (feeAmt > 0) {
          const fee = lookupSystemLeaf(coa, AccountCodes.BANK_CHARGES, 'Bank charges');
          lines.splice(1, 0, {
            accountCode: fee.accountCode,
            accountName: fee.accountName,
            debit: feeAmt,
            credit: 0,
          });
        }
        return lines;
      }
      return [
        { accountCode: bank.code, accountName: bank.name, debit: amt, credit: 0 },
        { accountCode: off.accountCode, accountName: off.accountName, debit: 0, credit: amt },
      ];
    }
    case 'fee': {
      const fee = lookupSystemLeaf(coa, AccountCodes.BANK_CHARGES, 'Bank charges');
      return [
        { accountCode: fee.accountCode, accountName: fee.accountName, debit: amt, credit: 0 },
        { accountCode: bank.code, accountName: bank.name, debit: 0, credit: amt },
      ];
    }
    case 'interest': {
      let off: Account;
      if (params.offsetChartOfAccountId) {
        off = leafById(coa, params.offsetChartOfAccountId);
      } else {
        off = lookupSystemLeaf(coa, AccountCodes.REVENUE, 'Revenue');
      }
      return [
        { accountCode: bank.code, accountName: bank.name, debit: amt, credit: 0 },
        { accountCode: off.accountCode, accountName: off.accountName, debit: 0, credit: amt },
      ];
    }
    case 'adjustment': {
      const off = leafById(coa, params.offsetChartOfAccountId);
      const dir = params.adjustmentDirection === 'out' ? 'out' : 'in';
      if (dir === 'in') {
        return [
          { accountCode: bank.code, accountName: bank.name, debit: amt, credit: 0 },
          { accountCode: off.accountCode, accountName: off.accountName, debit: 0, credit: amt },
        ];
      }
      return [
        { accountCode: off.accountCode, accountName: off.accountName, debit: amt, credit: 0 },
        { accountCode: bank.code, accountName: bank.name, debit: 0, credit: amt },
      ];
    }
    default:
      throw new Error(`Unsupported movement type: ${normalized.movementType}`);
  }
}
