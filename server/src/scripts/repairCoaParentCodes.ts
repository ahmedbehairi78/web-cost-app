/**
 * Repair COA parentCode hierarchy in Postgres (fixes empty tree after syncCoaBatch).
 *   npx tsx server/src/scripts/repairCoaParentCodes.ts
 */
import { CHART_OF_ACCOUNTS_SEED } from '../../../src/data/chartOfAccountsSeedData.js';
import { prisma } from '../db.js';

function inferParentFromCode(code: string): string {
  if (code.length === 1) return '';
  if (code.length === 2) return code.slice(0, 1);
  if (code.length === 3) return code.slice(0, 2);
  if (code.length === 5) return code.slice(0, 3);
  if (code.length === 8) return code.slice(0, 5);
  return '';
}

function resolveParentCode(accountCode: string, currentParent: string, seedParent?: string): string {
  const code = accountCode.trim();
  const current = currentParent.trim();
  if (seedParent !== undefined && seedParent.trim() !== '') return seedParent.trim();
  if (code.length === 1) return '';
  if (current && current !== code) return current;
  return inferParentFromCode(code);
}

const seedByCode = new Map(CHART_OF_ACCOUNTS_SEED.map((a) => [a.accountCode, a.parentCode ?? '']));

const rows = await prisma.chartOfAccount.findMany({
  select: { id: true, accountCode: true, parentCode: true },
});

let fixed = 0;
for (const row of rows) {
  const next = resolveParentCode(row.accountCode, row.parentCode, seedByCode.get(row.accountCode));
  if (next !== row.parentCode) {
    await prisma.chartOfAccount.update({
      where: { id: row.id },
      data: { parentCode: next },
    });
    fixed += 1;
  }
}

console.log(`Repaired parentCode on ${fixed} / ${rows.length} chart_of_accounts rows`);
const root = await prisma.chartOfAccount.findUnique({
  where: { accountCode: '1' },
  select: { accountCode: true, parentCode: true },
});
console.log('Root account after repair:', root);

await prisma.$disconnect();
