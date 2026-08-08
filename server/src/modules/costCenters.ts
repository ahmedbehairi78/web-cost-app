import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';
import { ensureDirectCostCenterForContract, generateNextIndirectCostCenterCode } from '../lib/costCenterHelpers.js';

export const costCentersRouter = Router();
costCentersRouter.use(requireAuth);

costCentersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const type = String(req.query.type ?? '').trim();
    const where: { isDeleted: boolean; type?: string } = { isDeleted: false };
    if (type === 'direct' || type === 'indirect') where.type = type;

    const rows = await prisma.costCenter.findMany({
      where,
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
    });
    res.json(rows.map((r) => serialize(r)));
  }),
);

costCentersRouter.get(
  '/next-indirect-code',
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    const code = await generateNextIndirectCostCenterCode();
    res.json({ code });
  }),
);

costCentersRouter.post(
  '/',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      code?: string;
      name?: string;
      nameEn?: string;
      isActive?: boolean;
    };
    let code = String(body.code ?? '').trim().toUpperCase();
    const name = String(body.name ?? '').trim();
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    if (!code) {
      code = await generateNextIndirectCostCenterCode();
    }
    const existing = await prisma.costCenter.findFirst({ where: { code, isDeleted: false } });
    if (existing) {
      res.status(409).json({ error: 'Cost center code already exists' });
      return;
    }
    const row = await prisma.costCenter.create({
      data: {
        id: randomUUID(),
        code,
        name,
        nameEn: body.nameEn?.trim() || null,
        type: 'indirect',
        isActive: body.isActive !== false,
      },
    });
    res.status(201).json(serialize(row));
  }),
);

costCentersRouter.patch(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const row = await prisma.costCenter.findFirst({ where: { id, isDeleted: false } });
    if (!row || row.type !== 'indirect') {
      res.status(404).json({ error: 'Indirect cost center not found' });
      return;
    }
    const body = req.body as { name?: string; nameEn?: string; isActive?: boolean };
    const updated = await prisma.costCenter.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: String(body.name).trim() } : {}),
        ...(body.nameEn !== undefined ? { nameEn: body.nameEn?.trim() || null } : {}),
        ...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}),
      },
    });
    res.json(serialize(updated));
  }),
);

costCentersRouter.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const row = await prisma.costCenter.findFirst({ where: { id, isDeleted: false } });
    if (!row || row.type !== 'indirect') {
      res.status(404).json({ error: 'Indirect cost center not found' });
      return;
    }
    await prisma.costCenter.update({
      where: { id },
      data: { isDeleted: true, isActive: false },
    });
    res.json({ ok: true });
  }),
);

/** Ensure direct mirror exists when contract is synced (internal / migration). */
export async function syncDirectCostCenterForContractId(contractId: string): Promise<void> {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: { id: true, contractName: true, contractNameEn: true, isDeleted: true },
  });
  if (!contract) return;
  await ensureDirectCostCenterForContract(prisma, contract);
}
