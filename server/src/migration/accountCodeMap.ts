/** Legacy account code renames applied during Firestore → Postgres import. */
export const ACCOUNT_CODE_MAP: Record<string, string> = {
  '11101001': '12101001',
  '11102001': '12102001',
  '11201001': '12201001',
  '11202001': '12202001',
  '11301001': '12301001',
  '11302001': '12302001',
  '11401001': '12401001',
  '11401002': '12401002',
  '11402001': '12402001',
  '11403001': '12403001',
  '21401002': '21402001',
};

export function normalizeAccountCode(code: unknown): string {
  const raw = String(code ?? '').trim();
  return ACCOUNT_CODE_MAP[raw] || raw;
}
