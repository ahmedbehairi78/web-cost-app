import type { Prisma } from '@prisma/client';
import { num } from '../modules/inventoryHelpers.js';
import { roundMoney, MONEY_TOLERANCE } from './money.js';

export type BoqCostLevel = 'project' | 'contract' | 'boq_item';

export type BoqCostBreakdownInputRow = {
  boqItemId: string;
  contractId: string;
  costElement: string;
  totalCost: number | Prisma.Decimal;
};

export type BoqCostContractMeta = {
  id: string;
  contractName: string;
  contractNumber: string;
  projectId: string;
  projectName: string;
  projectCode: string;
};

export type BoqCostBoqMeta = {
  id: string;
  contractId: string;
  itemCode: string;
  description: string;
  chapterCode: string;
  sectionCode: string;
};

export type BoqCostBreakdownRow = {
  projectId: string;
  projectName: string;
  projectCode: string;
  contractId?: string;
  contractName?: string;
  contractNumber?: string;
  boqItemId?: string;
  itemCode?: string;
  boqDescription?: string;
  chapterCode?: string;
  sectionCode?: string;
  directCost: number;
  indirectCost: number;
  totalCost: number;
};

export function isIndirectCostElement(costElement: string): boolean {
  return String(costElement).trim() === 'overhead';
}

function bucketKey(level: BoqCostLevel, contractId: string, projectId: string, boqItemId: string): string {
  if (level === 'project') return projectId;
  if (level === 'contract') return contractId;
  return `${contractId}:${boqItemId}`;
}

export function aggregateBoqCostBreakdown(
  rows: BoqCostBreakdownInputRow[],
  contractMap: Map<string, BoqCostContractMeta>,
  boqMap: Map<string, BoqCostBoqMeta>,
  level: BoqCostLevel,
  filters?: { projectId?: string | null; contractId?: string | null },
): BoqCostBreakdownRow[] {
  const projectFilter = filters?.projectId && filters.projectId !== 'all' ? filters.projectId : null;
  const contractFilter = filters?.contractId && filters.contractId !== 'all' ? filters.contractId : null;

  const buckets = new Map<string, { direct: number; indirect: number; contractId: string; boqItemId?: string }>();

  for (const row of rows) {
    const contractId = String(row.contractId);
    if (contractFilter && contractId !== contractFilter) continue;

    const contract = contractMap.get(contractId);
    if (!contract) continue;
    if (projectFilter && contract.projectId !== projectFilter) continue;

    const amount = num(row.totalCost);
    if (Math.abs(amount) < 0.000001) continue;

    const boqItemId = String(row.boqItemId);
    const key = bucketKey(level, contractId, contract.projectId, boqItemId);
    const bucket = buckets.get(key) ?? { direct: 0, indirect: 0, contractId, boqItemId: level === 'boq_item' ? boqItemId : undefined };
    if (isIndirectCostElement(row.costElement)) {
      bucket.indirect += amount;
    } else {
      bucket.direct += amount;
    }
    buckets.set(key, bucket);
  }

  const result: BoqCostBreakdownRow[] = [];

  for (const [, bucket] of buckets) {
    const contract = contractMap.get(bucket.contractId);
    if (!contract) continue;

    const directCost = roundMoney(bucket.direct);
    const indirectCost = roundMoney(bucket.indirect);
    const totalCost = roundMoney(directCost + indirectCost);
    if (Math.abs(totalCost) < MONEY_TOLERANCE) continue;

    const boq = bucket.boqItemId ? boqMap.get(bucket.boqItemId) : undefined;

    if (level === 'project') {
      result.push({
        projectId: contract.projectId,
        projectName: contract.projectName,
        projectCode: contract.projectCode,
        directCost,
        indirectCost,
        totalCost,
      });
    } else if (level === 'contract') {
      result.push({
        projectId: contract.projectId,
        projectName: contract.projectName,
        projectCode: contract.projectCode,
        contractId: contract.id,
        contractName: contract.contractName,
        contractNumber: contract.contractNumber,
        directCost,
        indirectCost,
        totalCost,
      });
    } else {
      result.push({
        projectId: contract.projectId,
        projectName: contract.projectName,
        projectCode: contract.projectCode,
        contractId: contract.id,
        contractName: contract.contractName,
        contractNumber: contract.contractNumber,
        boqItemId: bucket.boqItemId,
        itemCode: boq?.itemCode ?? bucket.boqItemId,
        boqDescription: boq?.description ?? '',
        chapterCode: boq?.chapterCode,
        sectionCode: boq?.sectionCode,
        directCost,
        indirectCost,
        totalCost,
      });
    }
  }

  result.sort((a, b) => {
    const p = a.projectName.localeCompare(b.projectName);
    if (p !== 0) return p;
    const c = (a.contractName ?? '').localeCompare(b.contractName ?? '');
    if (c !== 0) return c;
    return (a.itemCode ?? '').localeCompare(b.itemCode ?? '');
  });

  if (level === 'project') {
    const byProject = new Map<string, BoqCostBreakdownRow>();
    for (const row of result) {
      const prev = byProject.get(row.projectId);
      if (!prev) {
        byProject.set(row.projectId, { ...row });
      } else {
        prev.directCost = roundMoney(prev.directCost + row.directCost);
        prev.indirectCost = roundMoney(prev.indirectCost + row.indirectCost);
        prev.totalCost = roundMoney(prev.totalCost + row.totalCost);
      }
    }
    return [...byProject.values()].sort((a, b) => a.projectName.localeCompare(b.projectName));
  }

  return result;
}

export function sumBoqCostBreakdown(rows: BoqCostBreakdownRow[]): {
  directCost: number;
  indirectCost: number;
  totalCost: number;
} {
  return rows.reduce(
    (acc, row) => ({
      directCost: roundMoney(acc.directCost + row.directCost),
      indirectCost: roundMoney(acc.indirectCost + row.indirectCost),
      totalCost: roundMoney(acc.totalCost + row.totalCost),
    }),
    { directCost: 0, indirectCost: 0, totalCost: 0 },
  );
}
