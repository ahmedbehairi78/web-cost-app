import type { Account } from '../services/accountingService';
import type { SelectOption } from '../components/ui/SearchableSelect';

const LEAF_ACCOUNT_CODE = /^\d{8}$/;

/** Active level-5 chart leaf (8-digit code) suitable for journal / GL pickers. */
export function isChartLeafAccount(a: Pick<Account, 'accountCode' | 'isGroup' | 'status'>): boolean {
  const code = String(a.accountCode ?? '').trim();
  return !a.isGroup && a.status !== 'disabled' && LEAF_ACCOUNT_CODE.test(code);
}

/**
 * Bank (12101…) or cash/custody (12102…) leaf for payroll salary payment.
 * Prefer code prefix; also accept correct parent when code was mis-parented historically.
 */
export function isPayrollPaymentAccount(
  a: Pick<Account, 'accountCode' | 'parentCode' | 'isGroup' | 'status'>,
): boolean {
  if (!isChartLeafAccount(a)) return false;
  const code = String(a.accountCode ?? '').trim();
  const parent = String(a.parentCode ?? '').trim();
  if (code.startsWith('12101') || code.startsWith('12102')) return true;
  return parent === '12101' || parent === '12102';
}

export function chartLeafAccountOptions(
  accounts: Account[],
  language: 'ar' | 'en',
  emptyOption?: SelectOption,
): SelectOption[] {
  const rows = accounts
    .filter(isChartLeafAccount)
    .sort((a, b) => String(a.accountCode).trim().localeCompare(String(b.accountCode).trim()))
    .map((acc) => {
      const code = String(acc.accountCode).trim();
      return {
        value: code,
        secondary: code,
        label: language === 'ar' ? acc.accountName : (acc.accountNameEn?.trim() || acc.accountName),
      };
    });
  return emptyOption ? [emptyOption, ...rows] : rows;
}
