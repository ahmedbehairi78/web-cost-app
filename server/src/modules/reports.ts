import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AccountCodes } from '../accounting/accountCodes.js';
import {
  aggregateBoqCostBreakdown,
  sumBoqCostBreakdown,
  type BoqCostLevel,
} from '../lib/boqCostBreakdown.js';
import {
  computeBalanceSheetSummary,
  netsToCodeBalMap,
  queryBalanceSheetNets,
  queryTrialBalanceAggregates,
  splitNetToDebitCredit,
} from '../lib/glReportBalances.js';
import { getAssignedContractIds } from '../modules/inventoryHelpers.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';

export const reportsRouter = Router();

reportsRouter.use(requireAuth, requirePermission('reports'));

function normalizeScopeId(raw: unknown): string {
  const v = String(raw ?? '').trim();
  return v || 'all';
}

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

/**
 * Full-history analytical trial balance (opening / movements / closing).
 * Includes fiscal_pl_close so YE-PL zeros class 4/5; excludes fiscal_opening / OPEN-*.
 * Query: periodStart (required YYYY-MM-DD) · optional projectId · contractId
 */
reportsRouter.get(
  '/trial-balance',
  asyncHandler(async (req, res) => {
    const year = new Date().getFullYear();
    const periodStart =
      String(req.query.periodStart ?? '').trim().slice(0, 10) || `${year}-01-01`;
    const asOf = String(req.query.asOf ?? req.query.dateTo ?? '').trim().slice(0, 10) || '';
    const projectId = normalizeScopeId(req.query.projectId);
    const contractId = normalizeScopeId(req.query.contractId);
    const assignedIds = getAssignedContractIds(req.user);

    if (assignedIds !== null && assignedIds.length === 0) {
      res.json(
        serialize({
          periodStart,
          asOf: asOf || null,
          projectId,
          contractId,
          rows: [],
          source: 'server_full',
        }),
      );
      return;
    }
    if (contractId !== 'all' && assignedIds !== null && !assignedIds.includes(contractId)) {
      res.status(403).json({ error: 'Access denied to this contract' });
      return;
    }

    const aggs = await queryTrialBalanceAggregates({
      periodStart,
      asOf: asOf || null,
      projectId,
      contractId,
      allowedContractIds: assignedIds,
    });

    res.json(
      serialize({
        periodStart,
        asOf: asOf || null,
        projectId,
        contractId,
        source: 'server_full',
        rows: aggs.map((r) => {
          const opening = splitNetToDebitCredit(r.openingNet);
          const closing = splitNetToDebitCredit(r.closingNet);
          return {
            accountCode: r.accountCode,
            openingNet: r.openingNet,
            openingDebit: opening.debit,
            openingCredit: opening.credit,
            debitMovements: r.debitMovements,
            creditMovements: r.creditMovements,
            closingNet: r.closingNet,
            closingDebit: closing.debit,
            closingCredit: closing.credit,
          };
        }),
      }),
    );
  }),
);

/**
 * Full-history rolling balance sheet nets + summary (company-wide unless scoped).
 * Includes fiscal_pl_close; excludes fiscal_opening / OPEN-*.
 */
reportsRouter.get(
  '/balance-sheet',
  asyncHandler(async (req, res) => {
    const projectId = normalizeScopeId(req.query.projectId);
    const contractId = normalizeScopeId(req.query.contractId);
    const asOf = String(req.query.asOf ?? req.query.dateTo ?? '').trim().slice(0, 10) || '';
    const assignedIds = getAssignedContractIds(req.user);

    if (assignedIds !== null && assignedIds.length === 0) {
      res.json(
        serialize({
          projectId,
          contractId,
          asOf: asOf || null,
          source: 'server_full',
          byCode: {},
          summary: computeBalanceSheetSummary({}),
        }),
      );
      return;
    }
    if (contractId !== 'all' && assignedIds !== null && !assignedIds.includes(contractId)) {
      res.status(403).json({ error: 'Access denied to this contract' });
      return;
    }

    const nets = await queryBalanceSheetNets({
      projectId,
      contractId,
      asOf: asOf || null,
      allowedContractIds: assignedIds,
    });
    const byCode = netsToCodeBalMap(nets);
    const summary = computeBalanceSheetSummary(byCode);

    res.json(
      serialize({
        projectId,
        contractId,
        asOf: asOf || null,
        source: 'server_full',
        byCode,
        summary,
        rowCount: nets.length,
      }),
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
