import { CHART_OF_ACCOUNTS_SEED } from '../data/chartOfAccountsSeedData.js';
import { prisma } from '../db.js';

export type CoaExtraAccount = {
  accountCode: string;
  accountName?: string;
  accountNameEn?: string;
  parentCode?: string;
  type?: string;
  isGroup?: boolean;
  status?: string;
  projectId?: string;
  supplierId?: string;
};

function isAllowedExtraLeaf(code: string): boolean {
  // Any standard 8-digit leaf account code used in this COA (1–5 statement classes)
  if (/^[1-5]\d{7}$/.test(code)) return true;
  // 5-digit group headers from seed repair paths
  return /^[1-5]\d{4}$/.test(code) && code.length === 5;
}

function inferParentCode(code: string): string {
  if (code.length === 8) return code.slice(0, 5);
  if (code.length === 5) return code.slice(0, 3);
  return code.slice(0, -2) || '';
}

function inferType(code: string, explicit?: string): string {
  if (explicit) return explicit;
  if (code.startsWith('1')) return 'asset';
  if (code.startsWith('2')) return 'liability';
  if (code.startsWith('3')) return 'equity';
  if (code.startsWith('4')) return 'revenue';
  if (code.startsWith('5')) return 'expense';
  return 'asset';
}

export async function ensureMissingCoaAccounts(options?: {
  codes?: string[];
  extras?: CoaExtraAccount[];
}): Promise<{ checked: number; added: number }> {
  const existingRows = await prisma.chartOfAccount.findMany({ select: { accountCode: true } });
  const existing = new Set(existingRows.map((r) => r.accountCode));

  const filter = options?.codes?.length ? new Set(options.codes.map(String)) : null;
  let seed = CHART_OF_ACCOUNTS_SEED;
  if (filter) {
    seed = seed.filter((a) => filter.has(a.accountCode));
  }

  const toInsert: Array<(typeof CHART_OF_ACCOUNTS_SEED)[number] | CoaExtraAccount> = [
    ...seed.filter((a) => !existing.has(a.accountCode)),
  ];

  for (const extra of options?.extras ?? []) {
    const code = String(extra.accountCode || '').trim();
    if (!code || existing.has(code) || toInsert.some((a) => a.accountCode === code)) continue;
    if (extra.isGroup) continue;
    if (!isAllowedExtraLeaf(code)) continue;
    toInsert.push({
      accountCode: code,
      accountName: extra.accountName?.trim() || code,
      accountNameEn: extra.accountNameEn?.trim() || code,
      parentCode: extra.parentCode?.trim() || inferParentCode(code),
      type: inferType(code, extra.type),
      isGroup: false,
      status: extra.status === 'disabled' ? 'disabled' : 'active',
      projectId: extra.projectId,
      supplierId: extra.supplierId,
    });
  }

  if (toInsert.length === 0) {
    return { checked: seed.length, added: 0 };
  }

  await prisma.chartOfAccount.createMany({
    data: toInsert.map((account) => ({
      accountCode: account.accountCode,
      accountName: account.accountName || account.accountCode,
      accountNameEn: (account as CoaExtraAccount).accountNameEn ?? null,
      parentCode: account.parentCode ?? '',
      type: account.type ?? 'asset',
      isGroup: account.isGroup ?? false,
      status: account.status ?? 'active',
      supplierId: (account as CoaExtraAccount).supplierId ?? null,
      projectId: (account as CoaExtraAccount).projectId ?? null,
    })),
    skipDuplicates: true,
  });

  return { checked: seed.length, added: toInsert.length };
}

/** Bootstrap COA when empty (local dev / fresh DB). */
export async function bootstrapCoaIfEmpty(): Promise<{ added: number }> {
  const count = await prisma.chartOfAccount.count();
  if (count > 0) return { added: 0 };
  const result = await ensureMissingCoaAccounts();
  return { added: result.added };
}
