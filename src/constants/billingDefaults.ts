export const BILLING_DEFAULTS: Record<string, number> = {
  VAT_PCT: 14,
  EXEC_GUARANTEE_PCT: 10,
  WHT_PCT: 1,
  LABOUR_INSURANCE_PCT: 5,
  MANPOWER_LEVY_PCT: 0.03,
};

/** جاري = الصيغة الحالية؛ نهائي = إغلاق العقد في التقارير ومنع مستخلصات لاحقة حتى إلغاء هذا المستخلص */
export type IpcKind = 'interim' | 'final';
export const IPC_KIND: { readonly INTERIM: IpcKind; readonly FINAL: IpcKind } = {
  INTERIM: 'interim',
  FINAL: 'final',
};
