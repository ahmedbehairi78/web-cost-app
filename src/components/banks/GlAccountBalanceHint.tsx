import React from 'react';
import { cn } from '../../lib/utils';
import { resolveGlBalanceSide } from '../../lib/glAccountBalance';
import { formatMoney } from '../../lib/money';

type Props = {
  accountCode: string;
  balanceByCode: Map<string, number>;
  language: 'ar' | 'en';
  variant: 'bank' | 'account';
  loading?: boolean;
  className?: string;
};

export function GlAccountBalanceHint({
  accountCode,
  balanceByCode,
  language,
  variant,
  loading = false,
  className,
}: Props) {
  const isAr = language === 'ar';
  const code = accountCode.trim();
  if (!code) return null;

  if (loading) {
    return (
      <p className={cn('text-xs text-gray-500 mt-1', className)}>
        {isAr ? 'جاري تحميل الرصيد…' : 'Loading balance…'}
      </p>
    );
  }

  const net = balanceByCode.get(code) ?? 0;
  const side = resolveGlBalanceSide(net);
  const amount = formatMoney(Math.abs(net));
  const sideLabel =
    side === 'debit'
      ? isAr
        ? ' (مدين)'
        : ' (Dr)'
      : side === 'credit'
        ? isAr
          ? ' (دائن)'
          : ' (Cr)'
        : '';

  const prefix =
    variant === 'bank'
      ? isAr
        ? 'الرصيد المتاح:'
        : 'Available balance:'
      : isAr
        ? 'رصيد الحساب:'
        : 'Account balance:';

  const showSide = variant === 'account' || side === 'credit';

  return (
    <p className={cn('text-xs mt-1 font-medium', className)}>
      <span className="text-gray-500">{prefix} </span>
      <span className="font-mono text-emerald-600 dark:text-emerald-400">{amount}</span>
      {showSide && side !== 'zero' ? (
        <span className="text-gray-500">{sideLabel}</span>
      ) : null}
      <span className="text-gray-400 font-mono ms-1">({code})</span>
    </p>
  );
}
