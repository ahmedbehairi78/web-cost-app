import { Router } from 'express';
import { requireAuth, requirePermission, requireReferenceRead, requireModuleWrite } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';

export const boqMaterialsRouter = Router();
boqMaterialsRouter.use(requireAuth);

function num(v: unknown): number {
  return Number(v ?? 0);
}

/** BOQ items in a contract that allow a given material category (consumption allocation). */
boqMaterialsRouter.get(
  '/by-material/:materialCategoryId',
  requireReferenceRead('costs', 'inventory', 'boq'),
  asyncHandler(async (req, res) => {
    const materialCategoryId = Number(req.params.materialCategoryId);
    const contractId = String(req.query.contractId ?? '').trim();
    if (!Number.isFinite(materialCategoryId) || materialCategoryId <= 0 || !contractId) {
      res.status(400).json({ error: 'materialCategoryId and contractId are required' });
      return;
    }

    const links = await prisma.boqItemMaterial.findMany({
      where: { materialCategoryId },
      select: { boqItemId: true },
    });
    const boqItemIds = [...new Set(links.map((link) => link.boqItemId))];
    if (boqItemIds.length === 0) {
      res.json([]);
      return;
    }

    const items = await prisma.boqItem.findMany({
      where: {
        id: { in: boqItemIds },
        contractId,
        isDeleted: false,
      },
      orderBy: { itemCode: 'asc' },
      select: {
        id: true,
        itemCode: true,
        description: true,
        sectionName: true,
        unit: true,
        tenderQty: true,
        tenderAmount: true,
        unitRateTotal: true,
      },
    });

    res.json(
      items.map((item) =>
        serialize({
          boqItemId: item.id,
          itemCode: item.itemCode,
          description: item.description,
          sectionName: item.sectionName,
          unit: item.unit,
          tenderQty: num(item.tenderQty),
          tenderAmount: num(item.tenderAmount),
          unitRateTotal: num(item.unitRateTotal),
        }),
      ),
    );
  }),
);

type LinkWithCategory = {
  id: number;
  boqItemId: string;
  materialCategoryId: number;
  createdAt: Date;
  materialCategory: {
    code: string;
    name: string;
    unit: string;
    group: { code: string; name: string };
  };
};

/** أصناف مسموحة لبند BOQ */
boqMaterialsRouter.get(
  '/:boqItemId',
  requirePermission('boq'),
  asyncHandler(async (req, res) => {
    const rows = (await prisma.boqItemMaterial.findMany({
      where: { boqItemId: req.params.boqItemId },
      include: {
        materialCategory: {
          select: { code: true, name: true, unit: true, group: { select: { code: true, name: true } } },
        },
      },
      orderBy: { materialCategory: { code: 'asc' } },
    })) as unknown as LinkWithCategory[];
    res.json(
      rows.map((r) =>
        serialize({
          id: r.id,
          boqItemId: r.boqItemId,
          materialCategoryId: r.materialCategoryId,
          code: r.materialCategory.code,
          name: r.materialCategory.name,
          unit: r.materialCategory.unit,
          groupCode: r.materialCategory.group.code,
          groupName: r.materialCategory.group.name,
        }),
      ),
    );
  }),
);

/** أصناف مسموحة لبند BOQ — لمحاسب التكاليف عند الصرف */
boqMaterialsRouter.get(
  '/:boqItemId/allowed',
  requireReferenceRead('costs', 'inventory', 'boq'),
  asyncHandler(async (req, res) => {
    const rows = (await prisma.boqItemMaterial.findMany({
      where: { boqItemId: req.params.boqItemId },
      include: {
        materialCategory: {
          select: { code: true, name: true, unit: true, group: { select: { code: true, name: true } } },
        },
      },
      orderBy: { materialCategory: { code: 'asc' } },
    })) as unknown as LinkWithCategory[];
    res.json(
      rows.map((r) =>
        serialize({
          materialCategoryId: r.materialCategoryId,
          code: r.materialCategory.code,
          name: r.materialCategory.name,
          unit: r.materialCategory.unit,
          groupCode: r.materialCategory.group.code,
          groupName: r.materialCategory.group.name,
        }),
      ),
    );
  }),
);

/** عدد الأصناف المربوطة لكل بند في العقد — للشارات */
boqMaterialsRouter.get(
  '/contract/:contractId/link-counts',
  requireReferenceRead('boq', 'inventory'),
  asyncHandler(async (req, res) => {
    const contractId = req.params.contractId;
    const boqItems = await prisma.boqItem.findMany({
      where: { contractId, isDeleted: false },
      select: { id: true },
    });
    const boqItemIds = boqItems.map((b) => b.id);
    if (boqItemIds.length === 0) {
      res.json({});
      return;
    }
    const links = await prisma.boqItemMaterial.findMany({
      where: { boqItemId: { in: boqItemIds } },
      select: { boqItemId: true },
    });
    const counts: Record<string, number> = {};
    for (const link of links) {
      counts[link.boqItemId] = (counts[link.boqItemId] || 0) + 1;
    }
    res.json(counts);
  }),
);

/** جلب الكمية المنصرفة سابقاً لبند BOQ محدد */
boqMaterialsRouter.get(
  '/:boqItemId/consumed-quantity',
  requireReferenceRead('boq', 'inventory'),
  asyncHandler(async (req, res) => {
    const boqItemId = req.params.boqItemId;
    const rows = await prisma.boqActualCost.findMany({
      where: { boqItemId, costElement: 'materials' },
      select: { quantity: true },
    });
    const total = rows.reduce((sum, r) => sum + Number(r.quantity || 0), 0);
    res.json({ consumedQuantity: total });
  }),
);

/** تقرير بنود غير مربوطة في عقد */
boqMaterialsRouter.get(
  '/contract/:contractId/unlinked-report',
  requirePermission('boq'),
  asyncHandler(async (req, res) => {
    const contractId = req.params.contractId;
    const boqItems = await prisma.boqItem.findMany({
      where: { contractId, isDeleted: false },
      select: { id: true, itemCode: true, description: true, unit: true },
      orderBy: { itemCode: 'asc' },
    });
    const boqItemIds = boqItems.map((b) => b.id);
    if (boqItemIds.length === 0) {
      res.json({ unlinkedItems: [], unusedMaterials: [] });
      return;
    }
    const links = await prisma.boqItemMaterial.findMany({
      where: { boqItemId: { in: boqItemIds } },
      select: { boqItemId: true, materialCategoryId: true },
    });
    const linkedIds = new Set(links.map((l) => l.boqItemId));
    const usedMaterialIds = new Set(links.map((l) => l.materialCategoryId));
    const unlinkedItems = boqItems.filter((item) => !linkedIds.has(item.id));
    const allMaterials = await prisma.materialCategory.findMany({
      select: { id: true, code: true, name: true, unit: true },
      orderBy: { code: 'asc' },
    });
    const unusedMaterials = allMaterials.filter((m) => !usedMaterialIds.has(m.id));
    res.json({
      unlinkedItems: unlinkedItems.map((item) =>
        serialize({
          id: item.id,
          itemCode: item.itemCode,
          description: item.description,
          unit: item.unit,
        }),
      ),
      unusedMaterials: unusedMaterials.map((m) =>
        serialize({
          id: m.id,
          code: m.code,
          name: m.name,
          unit: m.unit,
        }),
      ),
    });
  }),
);

/** فحص إمكانية حذف بند BOQ */
boqMaterialsRouter.get(
  '/:boqItemId/can-delete',
  requirePermission('boq'),
  asyncHandler(async (req, res) => {
    const boqItemId = req.params.boqItemId;
    const linkCount = await prisma.boqItemMaterial.count({
      where: { boqItemId },
    });
    const consumptionCount = await prisma.consumptionOrderLine.count({
      where: { boqItemId },
    });
    const actualCostCount = await prisma.boqActualCost.count({
      where: { boqItemId },
    });
    const canDelete = linkCount === 0 && consumptionCount === 0 && actualCostCount === 0;
    res.json({
      canDelete,
      linkCount,
      consumptionCount,
      actualCostCount,
      reason: !canDelete
        ? linkCount > 0
          ? 'has_material_links'
          : consumptionCount > 0
            ? 'has_consumption_orders'
            : 'has_actual_costs'
        : null,
    });
  }),
);

/** نسخ روابط من بند آخر (وراثة) */
boqMaterialsRouter.post(
  '/:boqItemId/inherit',
  requireModuleWrite('boq'),
  asyncHandler(async (req, res) => {
    const targetBoqItemId = req.params.boqItemId;
    const body = req.body as { sourceBoqItemId: string };
    const sourceBoqItemId = String(body.sourceBoqItemId || '').trim();
    if (!sourceBoqItemId) {
      res.status(400).json({ error: 'sourceBoqItemId is required' });
      return;
    }
    const targetBoq = await prisma.boqItem.findFirst({
      where: { id: targetBoqItemId, isDeleted: false },
    });
    if (!targetBoq) {
      res.status(404).json({ error: 'Target BOQ item not found' });
      return;
    }
    const sourceLinks = await prisma.boqItemMaterial.findMany({
      where: { boqItemId: sourceBoqItemId },
      select: { materialCategoryId: true },
    });
    if (sourceLinks.length === 0) {
      res.json({ inherited: 0 });
      return;
    }
    const materialIds = [...new Set(sourceLinks.map((l) => l.materialCategoryId))];
    await prisma.$transaction(async (tx) => {
      await tx.boqItemMaterial.deleteMany({ where: { boqItemId: targetBoqItemId } });
      await tx.boqItemMaterial.createMany({
        data: materialIds.map((materialCategoryId) => ({
          boqItemId: targetBoqItemId,
          materialCategoryId,
        })),
      });
    });
    res.json({ inherited: materialIds.length });
  }),
);

boqMaterialsRouter.put(
  '/:boqItemId',
  requireModuleWrite('boq'),
  asyncHandler(async (req, res) => {
    const boqItemId = req.params.boqItemId;
    const body = req.body as { materialCategoryIds: number[] };
    const ids = Array.isArray(body.materialCategoryIds)
      ? [...new Set(body.materialCategoryIds.map(Number).filter((n) => n > 0))]
      : [];

    const boq = await prisma.boqItem.findFirst({ where: { id: boqItemId, isDeleted: false } });
    if (!boq) {
      res.status(404).json({
        error:
          'بند BOQ غير مسجّل في SQLite — افتح البند من جدول الكميات ثم أعد المحاولة. / BOQ item not found in local DB.',
      });
      return;
    }

    if (ids.length > 0) {
      const found = await prisma.materialCategory.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      const foundIds = new Set(found.map((c) => c.id));
      const missing = ids.find((id) => !foundIds.has(id));
      if (missing !== undefined) {
        res.status(400).json({ error: `Material category ${missing} not found` });
        return;
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.boqItemMaterial.deleteMany({ where: { boqItemId } });
      if (ids.length > 0) {
        await tx.boqItemMaterial.createMany({
          data: ids.map((materialCategoryId) => ({ boqItemId, materialCategoryId })),
        });
      }
    });

    const rows = (await prisma.boqItemMaterial.findMany({
      where: { boqItemId },
      include: { materialCategory: { select: { code: true, name: true, unit: true } } },
    })) as unknown as Array<{
      id: number;
      boqItemId: string;
      materialCategoryId: number;
      createdAt: Date;
      materialCategory: { code: string; name: string; unit: string };
    }>;
    res.json(
      rows.map((r) =>
        serialize({
          id: r.id,
          boqItemId: r.boqItemId,
          materialCategoryId: r.materialCategoryId,
          createdAt: r.createdAt,
          code: r.materialCategory.code,
          name: r.materialCategory.name,
          unit: r.materialCategory.unit,
        }),
      ),
    );
  }),
);
