import type { BankMovement, TransferChannel, TransferDirection, TransferScope } from '../components/banks/types';

export function normalizeTransferMeta(m: Pick<BankMovement, 'movementType' | 'transferScope' | 'transferChannel' | 'transferDirection'>): {
  movementType: BankMovement['movementType'];
  transferScope: TransferScope;
  transferChannel: TransferChannel;
  transferDirection: TransferDirection;
} {
  const legacy = m.movementType as string;
  if (legacy === 'instapay_out') {
    return {
      movementType: 'transfer',
      transferScope: m.transferScope ?? 'external',
      transferChannel: m.transferChannel ?? 'instapay',
      transferDirection: m.transferDirection ?? 'out',
    };
  }
  if (legacy === 'instapay_in') {
    return {
      movementType: 'transfer',
      transferScope: m.transferScope ?? 'external',
      transferChannel: m.transferChannel ?? 'instapay',
      transferDirection: m.transferDirection ?? 'in',
    };
  }
  if (m.movementType === 'transfer') {
    return {
      movementType: 'transfer',
      transferScope: m.transferScope ?? 'internal',
      transferChannel: m.transferChannel ?? 'bank_app',
      transferDirection: m.transferDirection ?? 'out',
    };
  }
  return {
    movementType: m.movementType,
    transferScope: m.transferScope ?? 'internal',
    transferChannel: m.transferChannel ?? 'bank_app',
    transferDirection: m.transferDirection ?? 'out',
  };
}

export function transferDetailLabel(
  m: Pick<BankMovement, 'movementType' | 'transferScope' | 'transferChannel' | 'transferDirection'>,
  isAr: boolean,
): string {
  const meta = normalizeTransferMeta(m);
  if (meta.movementType !== 'transfer') return '';
  const scope =
    meta.transferScope === 'internal'
      ? (isAr ? 'بين حسابات الشركة' : 'Company banks')
      : (isAr ? 'جهة مستفيدة' : 'Beneficiary');
  const channel =
    meta.transferChannel === 'instapay'
      ? (isAr ? 'إنستاباي' : 'InstaPay')
      : (isAr ? 'تطبيق بنكي' : 'Bank app');
  const dir =
    meta.transferDirection === 'in'
      ? (isAr ? 'وارد' : 'In')
      : (isAr ? 'صادر' : 'Out');
  return isAr ? `${scope} · ${channel} · ${dir}` : `${scope} · ${channel} · ${dir}`;
}
