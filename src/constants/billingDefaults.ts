export const BILLING_DEFAULTS: Record<string, number> = {
  VAT_PCT: 14,
  /** Retention withheld — Cover-JLL */
  EXEC_GUARANTEE_PCT: 5,
  WHT_PCT: 1,
  LABOUR_INSURANCE_PCT: 5,
  /** Labour force / القوى العاملة — Cover-JLL */
  MANPOWER_LEVY_PCT: 1,
  /** Performance security — Cover-JLL */
  PERFORMANCE_SECURITY_PCT: 5,
  /** Egyptian Syndicate of Engineering stamp — Cover-JLL */
  SYNDICATE_STAMP_PCT: 0.3,
};

/** جاري = الصيغة الحالية؛ نهائي = إغلاق العقد في التقارير ومنع مستخلصات لاحقة حتى إلغاء هذا المستخلص */
export type IpcKind = 'interim' | 'final';
export const IPC_KIND: { readonly INTERIM: IpcKind; readonly FINAL: IpcKind } = {
  INTERIM: 'interim',
  FINAL: 'final',
};
