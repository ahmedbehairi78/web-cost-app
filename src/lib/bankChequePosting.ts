import type { Account, JournalEntry, Transaction } from '../services/accountingService';
import { AccountCodes } from '../services/accountingService';
import type { BankAccount, ReceivedIssueCreditRow } from '../components/banks/types';
import { MONEY_TOLERANCE } from '../lib/money';

const COA_CODE_8 = /^\d{8}$/;
const CREDIT_SUM_TOL = MONEY_TOLERANCE;

function assertLeaf8(row: Account, lang: 'ar' | 'en'): void {
  const c = String(row.accountCode ?? '').trim();
  if (!COA_CODE_8.test(c)) {
    throw new Error(
      lang === 'ar' ? `الحساب ${c} ليس ورقة 8 أرقام.` : `Account ${c} is not an 8-digit chart leaf.`,
    );
  }
  if (row.isGroup || row.status === 'disabled') {
    throw new Error(lang === 'ar' ? `الحساب ${c} غير نشط كورقة.` : `Account ${c} is not an active leaf.`);
  }
}

export function coaLeafById(coa: Account[], id: string | undefined | null, lang: 'ar' | 'en' = 'ar'): Account {
  const cid = String(id ?? '').trim();
  if (!cid) {
    throw new Error(
      lang === 'ar'
        ? 'اختر حساباً من الدليل (ورقة 8 أرقام).'
        : 'Select a chart account (8-digit leaf).',
    );
  }
  const row = coa.find((a) => a.id === cid);
  if (!row) {
    throw new Error(lang === 'ar' ? 'الحساب غير موجود في الدليل.' : 'Chart account not found.');
  }
  assertLeaf8(row, lang);
  return row;
}

function coaLeafByCode(coa: Account[], code: string, labelEn: string, lang: 'ar' | 'en'): Account {
  const row = coa.find((a) => String(a.accountCode).trim() === code);
  if (!row) {
    throw new Error(
      lang === 'ar'
        ? `لم يُعثر على الحساب ${code} في الدليل (مطلوب لشيكات البنك).`
        : `Chart account ${code} (${labelEn}) is missing — add it or run COA patch.`,
    );
  }
  assertLeaf8(row, lang);
  return row;
}

/** وسيط الشيك الوارد — 12203001 */
export function receivedChequesClearingLeaf(coa: Account[], lang: 'ar' | 'en'): Account {
  return coaLeafByCode(coa, AccountCodes.RECEIVED_CHEQUES_CLEARING, 'Received cheques clearing', lang);
}

export function issuedChequesPayableLeaf(coa: Account[], lang: 'ar' | 'en'): Account {
  return coaLeafByCode(coa, AccountCodes.ISSUED_CHEQUES_PAYABLE, 'Issued cheques payable', lang);
}

function bankGlLeaf(b: BankAccount, lang: 'ar' | 'en'): { code: string; name: string } {
  const code = String(b.code ?? '').trim();
  if (!COA_CODE_8.test(code)) {
    throw new Error(
      lang === 'ar'
        ? 'اربط الحساب البنكي بحساب فرعي 8 أرقام تحت مجموعة البنوك.'
        : 'Bank wallet must use an 8-digit GL bank leaf as its code.',
    );
  }
  const name = b.nameAr || b.nameEn || code;
  return { code, name };
}

export function chequeIssueRef(chequeId: string, direction: 'issued' | 'received'): string {
  return `CH-${direction.toUpperCase()}-${chequeId}-ISS`;
}

export function chequeClearRef(chequeId: string, direction: 'issued' | 'received'): string {
  return `CH-${direction.toUpperCase()}-${chequeId}-CLR`;
}

export function validateReceivedIssueCredits(
  rows: ReceivedIssueCreditRow[],
  chequeAmount: number,
  lang: 'ar' | 'en',
): void {
  if (rows.length < 2) {
    throw new Error(
      lang === 'ar'
        ? 'التقسيم المتعدد يحتاج سطرين دائن على الأقل.'
        : 'Multi-credit split needs at least two credit lines.',
    );
  }
  let sum = 0;
  for (const r of rows) {
    const id = String(r.offsetChartOfAccountId ?? '').trim();
    const amt = Number(r.amount);
    if (!id || !Number.isFinite(amt) || amt <= 0) {
      throw new Error(lang === 'ar' ? 'سطر دائن غير صالح.' : 'Invalid credit line.');
    }
    sum += amt;
  }
  if (Math.abs(sum - chequeAmount) > CREDIT_SUM_TOL) {
    throw new Error(
      lang === 'ar'
        ? `مجموع الدائن (${sum}) يجب أن يساوي مبلغ الشيك (${chequeAmount}).`
        : `Credit sum (${sum}) must equal cheque amount (${chequeAmount}).`,
    );
  }
}

export function buildReceivedIssueCreditEntries(
  coa: Account[],
  rows: ReceivedIssueCreditRow[],
  chequeAmount: number,
  lang: 'ar' | 'en',
): JournalEntry[] {
  validateReceivedIssueCredits(rows, chequeAmount, lang);
  return rows.map((r) => {
    const leaf = coaLeafById(coa, r.offsetChartOfAccountId, lang);
    return {
      accountCode: leaf.accountCode,
      accountName: leaf.accountName,
      debit: 0,
      credit: Number(r.amount),
    };
  });
}

export function buildChequeIssueEntries(params: {
  direction: 'issued' | 'received';
  amount: number;
  coa: Account[];
  offsetChartOfAccountId?: string | null;
  receivedIssueCredits?: ReceivedIssueCreditRow[] | null;
  lang: 'ar' | 'en';
}): JournalEntry[] {
  const amt = Math.abs(Number(params.amount));
  if (!(amt > 0)) {
    throw new Error(params.lang === 'ar' ? 'المبلغ يجب أن يكون موجباً.' : 'Amount must be positive.');
  }

  if (params.direction === 'issued') {
    const off = coaLeafById(params.coa, params.offsetChartOfAccountId, params.lang);
    const pay = issuedChequesPayableLeaf(params.coa, params.lang);
    return [
      { accountCode: off.accountCode, accountName: off.accountName, debit: amt, credit: 0 },
      { accountCode: pay.accountCode, accountName: pay.accountName, debit: 0, credit: amt },
    ];
  }

  const clr = receivedChequesClearingLeaf(params.coa, params.lang);
  const multi =
    Array.isArray(params.receivedIssueCredits) && params.receivedIssueCredits!.length >= 2;
  if (multi) {
    const creditLines = buildReceivedIssueCreditEntries(
      params.coa,
      params.receivedIssueCredits!,
      amt,
      params.lang,
    );
    return [
      { accountCode: clr.accountCode, accountName: clr.accountName, debit: amt, credit: 0 },
      ...creditLines,
    ];
  }
  const off = coaLeafById(params.coa, params.offsetChartOfAccountId, params.lang);
  return [
    { accountCode: clr.accountCode, accountName: clr.accountName, debit: amt, credit: 0 },
    { accountCode: off.accountCode, accountName: off.accountName, debit: 0, credit: amt },
  ];
}

function lineFromIssueCredit(issue: Transaction): { accountCode: string; accountName: string } {
  const cr = (issue.entries ?? []).find((e) => Number(e.credit) > 0);
  if (!cr) {
    throw new Error('Invalid issued-cheque issue GL (no credit line).');
  }
  return {
    accountCode: cr.accountCode,
    accountName: (cr.accountName ?? cr.accountCode).trim(),
  };
}

function lineFromIssueDebitReceived(issue: Transaction): { accountCode: string; accountName: string } {
  const dr = (issue.entries ?? []).find((e) => Number(e.debit) > 0);
  if (!dr) {
    throw new Error('Invalid received-cheque issue GL (no debit line).');
  }
  return {
    accountCode: dr.accountCode,
    accountName: (dr.accountName ?? dr.accountCode).trim(),
  };
}

export function buildChequeClearEntries(params: {
  direction: 'issued' | 'received';
  amount: number;
  bankAccount: BankAccount;
  issueTransaction: Transaction;
  lang: 'ar' | 'en';
}): JournalEntry[] {
  const amt = Math.abs(Number(params.amount));
  const bank = bankGlLeaf(params.bankAccount, params.lang);

  if (params.direction === 'issued') {
    const pay = lineFromIssueCredit(params.issueTransaction);
    return [
      { accountCode: pay.accountCode, accountName: pay.accountName, debit: amt, credit: 0 },
      { accountCode: bank.code, accountName: bank.name, debit: 0, credit: amt },
    ];
  }

  const clr = lineFromIssueDebitReceived(params.issueTransaction);
  return [
    { accountCode: bank.code, accountName: bank.name, debit: amt, credit: 0 },
    { accountCode: clr.accountCode, accountName: clr.accountName, debit: 0, credit: amt },
  ];
}
