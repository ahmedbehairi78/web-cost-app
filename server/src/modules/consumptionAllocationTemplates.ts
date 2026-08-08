import { Router } from 'express';
import { requireAuth, requireAnyPermission } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';

export const consumptionAllocationTemplatesRouter = Router();
consumptionAllocationTemplatesRouter.use(requireAuth);
const inventoryUsePerm = requireAnyPermission('inventory', 'costs', 'transfers');

type TemplateWeights = Record<string, number>;

function parseWeights(raw: unknown): TemplateWeights {
  if (!raw || typeof raw !== 'object') return {};
  const out: TemplateWeights = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const pct = Number(value);
    if (key && Number.isFinite(pct) && pct > 0) out[key] = pct;
  }
  return out;
}

function normalizeBasis(raw: unknown): 'boq_qty' | 'boq_value' | 'manual' {
  const basis = String(raw || '').trim();
  if (basis === 'boq_value' || basis === 'manual') return basis;
  return 'boq_qty';
}

consumptionAllocationTemplatesRouter.get(
  '/',
  inventoryUsePerm,
  asyncHandler(async (req, res) => {
    const contractId = String(req.query.contractId ?? '').trim();
    const materialCategoryId = Number(req.query.materialCategoryId);
    if (!contractId || !Number.isFinite(materialCategoryId) || materialCategoryId <= 0) {
      res.status(400).json({ error: 'contractId and materialCategoryId are required' });
      return;
    }

    const rows = await prisma.consumptionAllocationTemplate.findMany({
      where: { contractId, materialCategoryId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });

    res.json(
      rows.map((row) => {
        const flat = serialize(row) as Record<string, unknown>;
        let weights: TemplateWeights = {};
        try {
          weights = parseWeights(JSON.parse(String(row.weightsJson || '{}')));
        } catch {
          weights = {};
        }
        return {
          ...flat,
          weights,
        };
      }),
    );
  }),
);

consumptionAllocationTemplatesRouter.post(
  '/',
  inventoryUsePerm,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const body = req.body as {
      contractId?: string;
      materialCategoryId?: number;
      name?: string;
      basis?: string;
      weights?: TemplateWeights;
    };

    const contractId = String(body.contractId ?? '').trim();
    const materialCategoryId = Number(body.materialCategoryId);
    const name = String(body.name ?? 'Default').trim() || 'Default';
    const basis = normalizeBasis(body.basis);
    const weights = parseWeights(body.weights);

    if (!contractId || !Number.isFinite(materialCategoryId) || materialCategoryId <= 0) {
      res.status(400).json({ error: 'contractId and materialCategoryId are required' });
      return;
    }
    if (Object.keys(weights).length === 0) {
      res.status(400).json({ error: 'weights must include at least one BOQ item percentage' });
      return;
    }

    const weightsJson = JSON.stringify(weights);
    const row = await prisma.consumptionAllocationTemplate.upsert({
      where: {
        contractId_materialCategoryId_name: {
          contractId,
          materialCategoryId,
          name,
        },
      },
      create: {
        contractId,
        materialCategoryId,
        name,
        basis,
        weightsJson,
        createdBy: user.id,
      },
      update: {
        basis,
        weightsJson,
      },
    });

    res.status(201).json({
      ok: true,
      template: {
        ...(serialize(row) as Record<string, unknown>),
        weights,
      },
    });
  }),
);

consumptionAllocationTemplatesRouter.delete(
  '/:id',
  inventoryUsePerm,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid template id' });
      return;
    }
    await prisma.consumptionAllocationTemplate.delete({ where: { id } });
    res.json({ ok: true });
  }),
);
