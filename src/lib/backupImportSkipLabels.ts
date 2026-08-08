export type BackupImportSkipLabels = Record<string, { ar: string; en: string }>;

/** Human-readable labels for Postgres backup import `skipped` counters. */
export const BACKUP_IMPORT_SKIP_LABELS: BackupImportSkipLabels = {
  projects_unique: { ar: 'مشروع — تعارض في الكود أو المعرّف', en: 'Project — duplicate code or id' },
  contracts_no_project: { ar: 'عقد — بدون مشروع مرتبط', en: 'Contract — missing project' },
  contracts_unique: { ar: 'عقد — معرّف موجود مسبقاً', en: 'Contract — duplicate id' },
  cost_centers_no_code: { ar: 'مركز تكلفة — بدون كود', en: 'Cost center — missing code' },
  cost_centers_unique: { ar: 'مركز تكلفة — موجود مسبقاً', en: 'Cost center — duplicate' },
  chart_of_accounts_unique: { ar: 'حساب — كود موجود في شجرة الحسابات', en: 'Chart of accounts — duplicate code' },
  boq_items_no_project: { ar: 'بند BOQ — بدون مشروع', en: 'BOQ item — missing project' },
  transactions_unbalanced: { ar: 'قيد GL — غير متوازن (مدين ≠ دائن)', en: 'GL entry — unbalanced (Dr ≠ Cr)' },
  billing_missing_refs: { ar: 'مستخلص — مشروع/عقد ناقص', en: 'Billing — missing project/contract' },
  billing_missing_transaction: { ar: 'مستخلص — قيد GL مرتبط غير موجود', en: 'Billing — linked GL entry missing' },
  purchase_missing_supplier: { ar: 'فاتورة/IPC — مورد غير موجود', en: 'Purchase/IPC — supplier missing' },
  purchase_missing_transaction: { ar: 'فاتورة/IPC — قيد GL غير موجود', en: 'Purchase/IPC — GL entry missing' },
  bank_accounts_no_code: { ar: 'حساب بنكي — بدون كود', en: 'Bank account — missing code' },
  bank_movements_missing_refs: { ar: 'حركة بنك — مراجع ناقصة', en: 'Bank movement — missing refs' },
  bank_movements_missing_account: { ar: 'حركة بنك — حساب بنك غير موجود', en: 'Bank movement — bank account missing' },
  bank_cheques_missing_refs: { ar: 'شيك — مراجع ناقصة', en: 'Cheque — missing refs' },
  bank_cheques_missing_account: { ar: 'شيك — حساب بنك غير موجود', en: 'Cheque — bank account missing' },
  bank_statements_missing_refs: { ar: 'كشف بنك — مراجع ناقصة', en: 'Bank statement — missing refs' },
  bank_statements_missing_account: { ar: 'كشف بنك — حساب غير موجود', en: 'Bank statement — account missing' },
  bank_statement_lines_missing_refs: { ar: 'سطر كشف بنك — مراجع ناقصة', en: 'Statement line — missing refs' },
  bank_statement_lines_missing_statement: { ar: 'سطر كشف بنك — كشف غير موجود', en: 'Statement line — statement missing' },
  settings_no_key: { ar: 'إعداد — بدون مفتاح', en: 'Setting — missing key' },
  users_missing_id_or_email: { ar: 'مستخدم — بدون id أو بريد', en: 'User — missing id or email' },
  users_unique: { ar: 'مستخدم — بريد أو معرّف موجود مسبقاً', en: 'User — duplicate email or id' },
  custody_settlements_missing_refs: { ar: 'تسوية عهدة — مراجع ناقصة', en: 'Custody settlement — missing refs' },
  custody_settlements_unique: { ar: 'تسوية عهدة — رقم موجود مسبقاً', en: 'Custody settlement — duplicate number' },
  users_missing_email_or_uid: { ar: 'مستخدم Firestore — بدون بريد/uid', en: 'Firestore user — missing email/uid' },
  journal_entries_missing_transaction: {
    ar: 'سطر قيد — القيد الرئيسي غير موجود',
    en: 'Journal line — parent GL transaction missing',
  },
  journal_entries_upsert_error: {
    ar: 'سطر قيد — فشل الحفظ',
    en: 'Journal line — upsert failed',
  },
};

const GENERIC_SUFFIX_LABELS: Record<string, { ar: string; en: string }> = {
  _no_id: { ar: ' — بدون معرّف', en: ' — missing id' },
  _unique: { ar: ' — موجود مسبقاً', en: ' — duplicate row' },
  _upsert_error: { ar: ' — خطأ في الحفظ', en: ' — upsert error' },
};

export function labelBackupImportSkip(key: string, language: 'ar' | 'en'): string {
  const known = BACKUP_IMPORT_SKIP_LABELS[key];
  if (known) return language === 'ar' ? known.ar : known.en;

  for (const [suffix, labels] of Object.entries(GENERIC_SUFFIX_LABELS)) {
    if (key.endsWith(suffix)) {
      const collection = key.slice(0, -suffix.length).replace(/_/g, ' ');
      const tail = language === 'ar' ? labels.ar : labels.en;
      return `${collection}${tail}`;
    }
  }

  return key.replace(/_/g, ' ');
}

export function sortedBackupImportSkipped(skipped: Record<string, number>): Array<{ key: string; count: number }> {
  return Object.entries(skipped)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function totalBackupImportSkipped(skipped: Record<string, number> | undefined): number {
  if (!skipped) return 0;
  return Object.values(skipped).reduce((a, b) => a + b, 0);
}
