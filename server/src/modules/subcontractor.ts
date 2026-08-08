import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';
import { toMoney, roundMoney, MONEY_TOLERANCE } from '../lib/money.js';

export const subcontractorRouter = Router();
subcontractorRouter.use(requireAuth);

function dec(n: number): Prisma.Decimal {
  return new Prisma.Decimal(n);
}

function computeExtract(body: {
  executedQuantity: number;
  unitPrice: number;
  performanceGuaranteeRate?: number;
  advancePaymentDeduction?: number;
  delayPenalty?: number;
}): { grossAmount: number; performanceGuaranteeAmount: number; netPayable: number } {
  const grossAmount = toMoney(body.executedQuantity * body.unitPrice);
  const rate = body.performanceGuaranteeRate ?? 10;
  const performanceGuaranteeAmount = toMoney(grossAmount * (rate / 100));
  const advanceDed = toMoney(body.advancePaymentDeduction ?? 0);
  const penalty = toMoney(body.delayPenalty ?? 0);
  const netPayable = toMoney(grossAmount - performanceGuaranteeAmount - advanceDed - penalty);
  return { grossAmount, performanceGuaranteeAmount, netPayable };
}

async function enrichAssignments(
  rows: Array<{
    id: number;
    contractId: string;
    subcontractorId: number;
    boqItemId: string;
    subcontractUnitPrice: Prisma.Decimal;
    ownerUnitPrice: Prisma.Decimal;
    assignedQuantity: Prisma.Decimal;
    assignedDate: string;
    createdAt: Date;
    subcontractor: { name: string; trade: string };
  }>,
) {
  const contractIds = [...new Set(rows.map((r) => r.contractId))];
  const boqIds = [...new Set(rows.map((r) => r.boqItemId))];
  const [contracts, boqItems] = await Promise.all([
    prisma.contract.findMany({
      where: { id: { in: contractIds } },
      select: { id: true, contractName: true, contractNumber: true },
    }),
    prisma.boqItem.findMany({
      where: { id: { in: boqIds } },
      select: { id: true, description: true, unit: true },
    }),
  ]);
  const contractMap = new Map(contracts.map((c) => [c.id, c]));
  const boqMap = new Map(boqItems.map((b) => [b.id, b]));

  return rows.map((row) => {
    const contract = contractMap.get(row.contractId);
    const boq = boqMap.get(row.boqItemId);
    return {
      ...row,
      subcontractorName: row.subcontractor.name,
      trade: row.subcontractor.trade,
      boqDescription: boq?.description ?? null,
      boqUnit: boq?.unit ?? null,
      contractName: contract?.contractName ?? null,
      contractNumber: contract?.contractNumber ?? null,
    };
  });
}

async function enrichExtracts(
  rows: Array<{
    id: number;
    assignmentId: number;
    extractNumber: string;
    extractDate: string;
    periodFrom: string;
    periodTo: string;
    executedQuantity: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    grossAmount: Prisma.Decimal;
    performanceGuaranteeRate: Prisma.Decimal;
    performanceGuaranteeAmount: Prisma.Decimal;
    advancePaymentDeduction: Prisma.Decimal;
    delayPenalty: Prisma.Decimal;
    netPayable: Prisma.Decimal;
    status: string;
    approvedBy: string | null;
    notes: string | null;
    createdAt: Date;
    assignment: {
      contractId: string;
      boqItemId: string;
      subcontractUnitPrice: Prisma.Decimal;
      ownerUnitPrice: Prisma.Decimal;
      subcontractor: { name: string };
    };
  }>,
) {
  const contractIds = [...new Set(rows.map((r) => r.assignment.contractId))];
  const boqIds = [...new Set(rows.map((r) => r.assignment.boqItemId))];
  const [contracts, boqItems] = await Promise.all([
    prisma.contract.findMany({
      where: { id: { in: contractIds } },
      select: { id: true, contractName: true, contractNumber: true, projectId: true },
    }),
    prisma.boqItem.findMany({
      where: { id: { in: boqIds } },
      select: { id: true, description: true },
    }),
  ]);
  const contractMap = new Map(contracts.map((c) => [c.id, c]));
  const boqMap = new Map(boqItems.map((b) => [b.id, b]));
  const projectIds = [...new Set(contracts.map((c) => c.projectId))];
  const projectRows =
    projectIds.length > 0
      ? await prisma.project.findMany({
          where: { id: { in: projectIds } },
          select: { id: true, projectName: true },
        })
      : [];
  const projectMap = new Map(projectRows.map((p) => [p.id, p]));

  return rows.map((row) => {
    const contract = contractMap.get(row.assignment.contractId);
    const boq = boqMap.get(row.assignment.boqItemId);
    const project = contract ? projectMap.get(contract.projectId) : undefined;
    return {
      ...row,
      contractId: row.assignment.contractId,
      boqItemId: row.assignment.boqItemId,
      subcontractUnitPrice: row.assignment.subcontractUnitPrice,
      ownerUnitPrice: row.assignment.ownerUnitPrice,
      subcontractorName: row.assignment.subcontractor.name,
      boqDescription: boq?.description ?? null,
      contractName: contract?.contractName ?? null,
      contractNumber: contract?.contractNumber ?? null,
      projectName: project?.projectName ?? null,
    };
  });
}

subcontractorRouter.get(
  '/subcontractors',
  requirePermission('suppliers'),
  asyncHandler(async (_req, res) => {
    const rows = await prisma.subcontractor.findMany({ orderBy: { name: 'asc' } });
    res.json(serialize(rows));
  }),
);

subcontractorRouter.get(
  '/subcontractors/:id',
  requirePermission('suppliers'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid id' });
      return;
    }
    const row = await prisma.subcontractor.findUnique({ where: { id } });
    if (!row) {
      res.status(404).json({ error: 'Subcontractor not found' });
      return;
    }
    res.json(serialize(row));
  }),
);

subcontractorRouter.post(
  '/subcontractors',
  requirePermission('suppliers'),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      name: string;
      trade: string;
      contactInfo?: string;
      taxNumber?: string;
      commercialRegister?: string;
    };
    if (!body.name || !body.trade) {
      res.status(400).json({ error: 'name and trade are required' });
      return;
    }
    const row = await prisma.subcontractor.create({
      data: {
        name: body.name,
        trade: body.trade,
        contactInfo: body.contactInfo ?? null,
        taxNumber: body.taxNumber ?? null,
        commercialRegister: body.commercialRegister ?? null,
      },
    });
    res.status(201).json(serialize(row));
  }),
);

subcontractorRouter.put(
  '/subcontractors/:id',
  requirePermission('suppliers'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid id' });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const exists = await prisma.subcontractor.findUnique({ where: { id }, select: { id: true } });
    if (!exists) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const row = await prisma.subcontractor.update({
      where: { id },
      data: {
        name: body.name != null ? String(body.name) : undefined,
        trade: body.trade != null ? String(body.trade) : undefined,
        contactInfo: body.contactInfo != null ? String(body.contactInfo) : undefined,
        taxNumber: body.taxNumber != null ? String(body.taxNumber) : undefined,
        commercialRegister:
          body.commercialRegister != null ? String(body.commercialRegister) : undefined,
      },
    });
    res.json(serialize(row));
  }),
);

subcontractorRouter.get(
  '/subcontract-assignments',
  requirePermission('costs'),
  asyncHandler(async (req, res) => {
    const where: Prisma.SubcontractAssignmentWhereInput = {};
    if (req.query.contractId) where.contractId = String(req.query.contractId);
    if (req.query.subcontractorId) where.subcontractorId = Number(req.query.subcontractorId);

    const rows = await prisma.subcontractAssignment.findMany({
      where,
      orderBy: { assignedDate: 'desc' },
      include: { subcontractor: { select: { name: true, trade: true } } },
    });
    res.json(serialize(await enrichAssignments(rows)));
  }),
);

subcontractorRouter.get(
  '/subcontract-assignments/:id',
  requirePermission('costs'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid id' });
      return;
    }
    const row = await prisma.subcontractAssignment.findUnique({
      where: { id },
      include: { subcontractor: { select: { name: true, trade: true } } },
    });
    if (!row) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const [enriched] = await enrichAssignments([row]);
    res.json(serialize(enriched));
  }),
);

subcontractorRouter.post(
  '/subcontract-assignments',
  requirePermission('costs'),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      contractId: string;
      subcontractorId: number;
      boqItemId: string;
      subcontractUnitPrice: number;
      ownerUnitPrice: number;
      assignedQuantity: number;
      assignedDate: string;
    };
    if (!body.contractId || !body.subcontractorId || !body.boqItemId) {
      res.status(400).json({ error: 'contractId, subcontractorId, boqItemId are required' });
      return;
    }
    if (typeof body.subcontractUnitPrice !== 'number' || body.subcontractUnitPrice < 0) {
      res.status(400).json({ error: 'subcontractUnitPrice must be non-negative' });
      return;
    }
    if (body.subcontractUnitPrice > body.ownerUnitPrice) {
      res.status(400).json({ error: 'Subcontract price cannot exceed owner price' });
      return;
    }

    const row = await prisma.subcontractAssignment.create({
      data: {
        contractId: body.contractId,
        subcontractorId: body.subcontractorId,
        boqItemId: body.boqItemId,
        subcontractUnitPrice: dec(body.subcontractUnitPrice),
        ownerUnitPrice: dec(body.ownerUnitPrice),
        assignedQuantity: dec(body.assignedQuantity),
        assignedDate: body.assignedDate,
      },
    });
    res.status(201).json(serialize(row));
  }),
);

subcontractorRouter.get(
  '/subcontract-extracts',
  requirePermission('billing'),
  asyncHandler(async (req, res) => {
    const where: Prisma.SubcontractExtractWhereInput = {};
    if (req.query.assignmentId) where.assignmentId = Number(req.query.assignmentId);
    if (req.query.status) where.status = String(req.query.status);

    const rows = await prisma.subcontractExtract.findMany({
      where,
      orderBy: [{ extractDate: 'desc' }, { id: 'desc' }],
      include: {
        assignment: {
          include: { subcontractor: { select: { name: true } } },
        },
      },
    });
    res.json(serialize(await enrichExtracts(rows)));
  }),
);

subcontractorRouter.get(
  '/subcontract-extracts/:id',
  requirePermission('billing'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid id' });
      return;
    }
    const row = await prisma.subcontractExtract.findUnique({
      where: { id },
      include: {
        assignment: {
          include: { subcontractor: { select: { name: true } } },
        },
      },
    });
    if (!row) {
      res.status(404).json({ error: 'Not found' });
 return;
    }
    const [enriched] = await enrichExtracts([row]);
    res.json(serialize(enriched));
  }),
);

subcontractorRouter.post(
  '/subcontract-extracts',
  requirePermission('billing'),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      assignmentId: number;
      extractNumber: string;
      extractDate: string;
      periodFrom: string;
      periodTo: string;
      executedQuantity: number;
      unitPrice: number;
      performanceGuaranteeRate?: number;
      advancePaymentDeduction?: number;
      delayPenalty?: number;
      notes?: string;
    };

    if (!body.assignmentId || !body.extractNumber || !body.extractDate) {
      res.status(400).json({ error: 'assignmentId, extractNumber, extractDate are required' });
      return;
    }
    if (typeof body.executedQuantity !== 'number' || body.executedQuantity < 0) {
      res.status(400).json({ error: 'executedQuantity must be non-negative' });
      return;
    }

    const { grossAmount, performanceGuaranteeAmount, netPayable } = computeExtract(body);
    if (netPayable < 0) {
      res.status(400).json({ error: 'Net payable cannot be negative' });
      return;
    }

    const row = await prisma.subcontractExtract.create({
      data: {
        assignmentId: body.assignmentId,
        extractNumber: body.extractNumber,
        extractDate: body.extractDate,
        periodFrom: body.periodFrom,
        periodTo: body.periodTo,
        executedQuantity: dec(body.executedQuantity),
        unitPrice: dec(body.unitPrice),
        grossAmount: dec(grossAmount),
        performanceGuaranteeRate: dec(body.performanceGuaranteeRate ?? 10),
        performanceGuaranteeAmount: dec(performanceGuaranteeAmount),
        advancePaymentDeduction: dec(body.advancePaymentDeduction ?? 0),
        delayPenalty: dec(body.delayPenalty ?? 0),
        netPayable: dec(netPayable),
        status: 'draft',
        notes: body.notes ?? null,
      },
    });
    res.status(201).json(serialize(row));
  }),
);

subcontractorRouter.put(
  '/subcontract-extracts/:id/status',
  requirePermission('billing'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid id' });
      return;
    }
    const { status, notes } = req.body as { status: string; notes?: string };
    const user = req.user!;

    const validTransitions: Record<string, string[]> = {
      draft: ['submitted'],
      submitted: ['approved', 'draft'],
      approved: [],
    };

    const row = await prisma.subcontractExtract.findUnique({ where: { id } });
    if (!row) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const allowed = validTransitions[row.status] ?? [];
    if (!allowed.includes(status)) {
      res.status(400).json({ error: `Invalid transition: ${row.status} → ${status}` });
      return;
    }

    if (status === 'approved' && user.role !== 'admin' && user.role !== 'projects_manager') {
      res.status(403).json({ error: 'Only projects manager or admin can approve extracts' });
      return;
    }

    const updated = await prisma.subcontractExtract.update({
      where: { id },
      data: {
        status,
        approvedBy: status === 'approved' ? user.id : undefined,
        notes: notes ?? undefined,
      },
    });
    res.json(serialize(updated));
  }),
);

subcontractorRouter.get(
  '/subcontract-extracts/:id/margin',
  requirePermission('billing'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid id' });
      return;
    }
    const row = await prisma.subcontractExtract.findUnique({
      where: { id },
      include: { assignment: { select: { ownerUnitPrice: true } } },
    });
    if (!row) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const executedQty = Number(row.executedQuantity);
    const subPrice = Number(row.unitPrice);
    const ownerPrice = Number(row.assignment.ownerUnitPrice);
    res.json(
      serialize({
        executedQuantity: executedQty,
        subPrice,
        subGross: Number(row.grossAmount),
        ownerUnitPrice: ownerPrice,
        ownerGross: toMoney(executedQty * ownerPrice),
        margin: toMoney(executedQty * (ownerPrice - subPrice)),
      }),
    );
  }),
);
