import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth, requireAnyPermission, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';
import { getAssignedContractIds } from '../modules/inventoryHelpers.js';
import { backfillDocumentRegistry } from '../lib/documentRegistrySync.js';
import { buildContractDocumentCycle } from '../lib/contractDocumentCycle.js';
import { buildContractBillingProgress } from '../lib/contractBillingProgress.js';

export const documentRegistryRouter = Router();

documentRegistryRouter.use(requireAuth, requireAnyPermission('billing', 'projects', 'boq'));

function contractScopeFilter(user: Express.Request['user']): Prisma.DocumentRegistryWhereInput {
  const assigned = getAssignedContractIds(user);
  if (assigned === null) return {};
  if (assigned.length === 0) return { contractId: { in: ['__no_access__'] } };
  return { contractId: { in: assigned } };
}

documentRegistryRouter.get(
  '/timeline',
  asyncHandler(async (req, res) => {
    const contractId = String(req.query.contractId ?? '').trim();
    if (!contractId) {
      res.status(400).json({ error: 'contractId is required' });
      return;
    }

    const assigned = getAssignedContractIds(req.user);
    if (assigned !== null && !assigned.includes(contractId)) {
      res.status(403).json({ error: 'access_denied' });
      return;
    }

    const rows = await prisma.documentRegistry.findMany({
      where: { contractId, isDeleted: false },
      orderBy: [{ documentDate: 'asc' }, { documentNo: 'asc' }],
      select: {
        id: true,
        docType: true,
        sourceEntityId: true,
        documentNo: true,
        documentDate: true,
        status: true,
        phase: true,
        amount: true,
        needsAction: true,
        actionKind: true,
      },
    });

    res.json(serialize({ contractId, events: rows }));
  }),
);

documentRegistryRouter.get(
  '/contract-cycle',
  asyncHandler(async (req, res) => {
    const contractId = String(req.query.contractId ?? '').trim();
    if (!contractId) {
      res.status(400).json({ error: 'contractId is required' });
      return;
    }

    const assigned = getAssignedContractIds(req.user);
    if (assigned !== null && !assigned.includes(contractId)) {
      res.status(403).json({ error: 'access_denied' });
      return;
    }

    const summary = await buildContractDocumentCycle(contractId);
    res.json(serialize(summary));
  }),
);

documentRegistryRouter.get(
  '/contract-progress',
  asyncHandler(async (req, res) => {
    const contractId = String(req.query.contractId ?? '').trim();
    if (!contractId) {
      res.status(400).json({ error: 'contractId is required' });
      return;
    }

    const assigned = getAssignedContractIds(req.user);
    if (assigned !== null && !assigned.includes(contractId)) {
      res.status(403).json({ error: 'access_denied' });
      return;
    }

    const progress = await buildContractBillingProgress(contractId);
    res.json(serialize(progress));
  }),
);

documentRegistryRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const where: Prisma.DocumentRegistryWhereInput = {
      isDeleted: false,
      ...contractScopeFilter(req.user),
    };

    const projectId = String(req.query.projectId ?? '').trim();
    if (projectId) where.projectId = projectId;

    const contractId = String(req.query.contractId ?? '').trim();
    if (contractId) where.contractId = contractId;

    const docType = String(req.query.docType ?? '').trim();
    if (docType) where.docType = docType;

    const status = String(req.query.status ?? '').trim();
    if (status) where.status = status;

    if (req.query.inbox === 'true' || req.query.inbox === '1') {
      where.needsAction = true;
    }

    const limitRaw = Number(req.query.limit ?? 100);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;

    const rows = await prisma.documentRegistry.findMany({
      where,
      orderBy: [{ needsAction: 'desc' }, { documentDate: 'desc' }, { updatedAt: 'desc' }],
      take: limit,
      include: {
        project: { select: { projectName: true, projectCode: true } },
        contract: { select: { contractName: true, contractNumber: true } },
      },
    });

    res.json(serialize(rows));
  }),
);

documentRegistryRouter.post(
  '/backfill',
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    const counts = await backfillDocumentRegistry();
    res.json(serialize({ ok: true, ...counts }));
  }),
);
