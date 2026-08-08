import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AccountCodes } from '../accounting/accountCodes.js';
import {
  aggregateBoqCostBreakdown,
  sumBoqCostBreakdown,
  type BoqCostLevel,
} from '../lib/boqCostBreakdown.js';
import { getAssignedContractIds } from '../modules/inventoryHelpers.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';

export const reportsRouter = Router();

reportsRouter.use(requireAuth, requirePermission('reports'));

reportsRouter.get(
  '/dashboard',
  asyncHandler(async (_req, res) => {
    const [projects, boqTotals, entries] = await Promise.all([
      prisma.project.findMany({
        where: { isDeleted: false },
        select: { id: true, budget: true },
      }),
      prisma.boqItem.groupBy({
        by: ['projectId'],
        where: { isDeleted: false },
        _sum: { tenderAmount: true },
      }),
      prisma.journalEntry.findMany({
        where: { transaction: { isDeleted: false } },
        select: { transactionId: true, accountCode: true, debit: true, credit: true },
      }),
    ]);

    const boqMap: Record<string, number> = {};
    for (const row of boqTotals) {
      if (row.projectId) boqMap[row.projectId] = Number(row._sum.tenderAmount || 0);
    }

    const totalBudget = projects.reduce(
      (sum, p) => sum + (boqMap[p.id] || Number(p.budget || 0)),
      0,
    );

    let totalSpent = 0;
    let pendingBilling = 0;
    const txRecCredit = new Set<string>();

    for (const e of entries) {
      const code = e.accountCode;
      const debit = Number(e.debit || 0);
      const credit = Number(e.credit || 0);
      if (code.startsWith('5') || code === AccountCodes.VAT_INPUT) totalSpent += debit;
      if (code === AccountCodes.RECEIVABLES) pendingBilling += debit - credit;
      if (code === AccountCodes.RECEIVABLES && credit > 0) txRecCredit.add(e.transactionId);
    }

    const totalCollected = entries
      .filter(
        (e) =>
          txRecCredit.has(e.transactionId) &&
          e.accountCode.startsWith('121') &&
          Number(e.debit) > 0,
      )
      .reduce((s, e) => s + Number(e.debit), 0);

    res.json(serialize({ totalBudget, totalSpent, totalCollected, pendingBilling }));
  }),
);

reportsRouter.get(
  '/trial-balance',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.journalEntry.groupBy({
      by: ['accountCode'],
      where: { transaction: { isDeleted: false } },
      _sum: { debit: true, credit: true },
      orderBy: { accountCode: 'asc' },
    });

    res.json(
      serialize(
        rows.map((r) => {
          const debit = Number(r._sum.debit || 0);
          const credit = Number(r._sum.credit || 0);
          return {
            accountCode: r.accountCode,
            debit,
            credit,
            balance: debit - credit,
          };
        }),
      ),
    );
  }),
);

function normalizeBoqCostLevel(raw: unknown): BoqCostLevel {
  const v = String(raw ?? 'boq_item').trim();
  if (v === 'project' || v === 'contract' || v === 'boq_item') return v;
  return 'boq_item';
}

reportsRouter.get(
  '/boq-cost-breakdown',
  asyncHandler(async (req, res) => {
    const projectId = req.query.projectId ? String(req.query.projectId) : 'all';
    const contractId = req.query.contractId ? String(req.query.contractId) : 'all';
    const level = normalizeBoqCostLevel(req.query.level);
    const dateFrom = req.query.dateFrom ? String(req.query.dateFrom).trim() : '';
    const dateTo = req.query.dateTo ? String(req.query.dateTo).trim() : '';

    const assignedIds = getAssignedContractIds(req.user);
    if (assignedIds !== null && assignedIds.length === 0) {
      res.json(serialize({ level, rows: [], totals: sumBoqCostBreakdown([]) }));
      return;
    }

    if (contractId !== 'all' && assignedIds !== null && !assignedIds.includes(contractId)) {
      res.status(403).json({ error: 'Access denied to this contract' });
      return;
    }

    const recordedAt: { gte?: Date; lte?: Date } = {};
    if (dateFrom) recordedAt.gte = new Date(`${dateFrom}T00:00:00.000Z`);
    if (dateTo) recordedAt.lte = new Date(`${dateTo}T23:59:59.999Z`);

    const costWhere: Parameters<typeof prisma.boqActualCost.findMany>[0]['where'] = {
      ...(Object.keys(recordedAt).length ? { recordedAt } : {}),
      ...(contractId !== 'all'
        ? { contractId }
        : assignedIds !== null
          ? { contractId: { in: assignedIds } }
          : {}),
    };

    const costRows = await prisma.boqActualCost.findMany({
      where: costWhere,
      select: {
        boqItemId: true,
        contractId: true,
        costElement: true,
        totalCost: true,
      },
    });

    const contractIds = [...new Set(costRows.map((r) => r.contractId))];
    if (!contractIds.length) {
      res.json(serialize({ level, rows: [], totals: sumBoqCostBreakdown([]) }));
      return;
    }

    const contracts = await prisma.contract.findMany({
      where: {
        id: { in: contractIds },
        isDeleted: false,
        ...(projectId !== 'all' ? { projectId } : {}),
      },
      include: {
        project: { select: { id: true, projectName: true, projectCode: true } },
      },
    });

    const contractMap = new Map(
      contracts.map((c) => [
        c.id,
        {
          id: c.id,
          contractName: c.contractName,
          contractNumber: c.contractNumber,
          projectId: c.projectId,
          projectName: c.project?.projectName ?? '',
          projectCode: c.project?.projectCode ?? '',
        },
      ]),
    );

    const boqItemIds = level === 'boq_item'
      ? [...new Set(costRows.map((r) => r.boqItemId))]
      : [];

    const boqItems = boqItemIds.length
      ? await prisma.boqItem.findMany({
          where: { id: { in: boqItemIds }, isDeleted: false },
          select: {
            id: true,
            contractId: true,
            itemCode: true,
            description: true,
            chapterCode: true,
            sectionCode: true,
          },
        })
      : [];

    const boqMap = new Map(
      boqItems.map((b) => [
        b.id,
        {
          id: b.id,
          contractId: b.contractId,
          itemCode: b.itemCode,
          description: b.description,
          chapterCode: b.chapterCode,
          sectionCode: b.sectionCode,
        },
      ]),
    );

    const rows = aggregateBoqCostBreakdown(costRows, contractMap, boqMap, level, {
      projectId,
      contractId,
    });

    res.json(
      serialize({
        level,
        rows,
        totals: sumBoqCostBreakdown(rows),
      }),
    );
  }),
);
