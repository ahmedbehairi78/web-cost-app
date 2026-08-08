import { prisma } from '../db.js';

function inferParentFromCode(code: string): string {
  if (code.length === 1) return '';
  if (code.length === 2) return code.slice(0, 1);
  if (code.length === 3) return code.slice(0, 2);
  if (code.length === 5) return code.slice(0, 3);
  if (code.length === 8) return code.slice(0, 5);
  return '';
}

export type CoaSyncRow = {
  id: string;
  accountCode: string;
  accountName: string;
  accountNameEn?: string | null;
  parentCode: string;
  type: string;
  isGroup?: boolean;
  status?: string;
  statementType?: string | null;
  supplierId?: string | null;
};

export async function syncBatchCoaAccounts(
  rows: CoaSyncRow[],
): Promise<{ synced: number; updated: number }> {
  let synced = 0;
  let updated = 0;

  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      const code = String(row.accountCode || '').trim();
      if (!code) continue;

      const existing = await tx.chartOfAccount.findUnique({ where: { accountCode: code } });

      // Default desired status, but never silently disable a project-linked 127… warehouse
      // account that is still referenced by its project (split-brain protection).
      let status = row.status === 'disabled' ? 'disabled' : 'active';
      if (
        status === 'disabled' &&
        existing &&
        /^127\d{5}$/.test(code) &&
        existing.projectId &&
        existing.projectId.trim() !== ''
      ) {
        const linkedProject = await tx.project.findFirst({
          where: { id: existing.projectId, isDeleted: false, inventoryAccountCode: code },
          select: { id: true },
        });
        if (linkedProject) status = 'active';
      }

      const parentRaw = row.parentCode != null ? String(row.parentCode).trim() : '';
      let parentCode = parentRaw;
      if (!parentCode) {
        if (code.length === 8) parentCode = code.slice(0, 5);
        else if (code.length === 5) parentCode = code.slice(0, 3);
        else if (code.length === 3) parentCode = code.slice(0, 2);
        else if (code.length === 2) parentCode = code.slice(0, 1);
        else parentCode = '';
      }
      if (parentCode === code) parentCode = code.length === 1 ? '' : inferParentFromCode(code);

      const data = {
        accountName: String(row.accountName || code),
        accountNameEn: row.accountNameEn ? String(row.accountNameEn) : null,
        parentCode,
        type: String(row.type || 'asset'),
        isGroup: Boolean(row.isGroup),
        statementType: row.statementType ? String(row.statementType) : null,
        status,
        supplierId: row.supplierId ? String(row.supplierId) : null,
      };

      if (existing) {
        await tx.chartOfAccount.update({ where: { accountCode: code }, data });
        updated += 1;
      } else {
        await tx.chartOfAccount.create({ data: { id: String(row.id || code), accountCode: code, ...data } });
        synced += 1;
      }
    }
  });

  return { synced, updated };
}
