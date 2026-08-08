import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

type DbClient = Prisma.TransactionClient | typeof prisma;

export async function ensureDirectCostCenterForContract(
  client: DbClient,
  contract: { id: string; contractName: string; contractNameEn?: string | null; isDeleted?: boolean },
): Promise<void> {
  const code = `CC-${contract.id.slice(0, 8).toUpperCase()}`;
  await client.costCenter.upsert({
    where: { id: contract.id },
    create: {
      id: contract.id,
      code,
      name: contract.contractName,
      nameEn: contract.contractNameEn ?? null,
      type: 'direct',
      contractId: contract.id,
      isActive: true,
      isDeleted: contract.isDeleted ?? false,
    },
    update: {
      name: contract.contractName,
      nameEn: contract.contractNameEn ?? null,
      isDeleted: contract.isDeleted ?? false,
      isActive: true,
    },
  });
}

export async function seedDirectCostCentersFromContracts(client: DbClient = prisma): Promise<number> {
  const contracts = await client.contract.findMany({
    where: { isDeleted: false },
    select: { id: true, contractName: true, contractNameEn: true, isDeleted: true },
  });
  for (const c of contracts) {
    await ensureDirectCostCenterForContract(client, c);
  }
  return contracts.length;
}

export const INDIRECT_COST_CENTER_PREFIX = 'HO-';

/** Next sequential indirect code: HO-001, HO-002, … */
export async function generateNextIndirectCostCenterCode(client: DbClient = prisma): Promise<string> {
  const prefix = INDIRECT_COST_CENTER_PREFIX;
  const rows = await client.costCenter.findMany({
    where: { type: 'indirect', isDeleted: false, code: { startsWith: prefix } },
    select: { code: true },
  });
  let max = 0;
  for (const row of rows) {
    const m = /^HO-(\d+)$/.exec(row.code);
    if (m) max = Math.max(max, Number.parseInt(m[1] ?? '0', 10));
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}
