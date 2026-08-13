import { Router } from 'express';
import { requireAnyPermission, requireAuth, requireModuleWrite } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';

import { moduleAccess } from '../permissions.js';

export const materialsRouter = Router();
materialsRouter.use(requireAuth);

function canManageMaterials(user: Express.Request['user']): boolean {
  if (!user) return false;
  return moduleAccess(user.permissions, 'inventory').edit === true;
}

type CategoryWithGroup = {
  id: number;
  groupId: number;
  code: string;
  name: string;
  unit: string;
  createdAt: Date;
  group: { code: string; name: string; nameEn: string | null };
};

/** Flattens a category + its group into the legacy flat shape (groupCode/groupName). */
function flattenCategory(c: CategoryWithGroup) {
  return serialize({
    id: c.id,
    groupId: c.groupId,
    code: c.code,
    name: c.name,
    unit: c.unit,
    createdAt: c.createdAt,
    groupCode: c.group.code,
    groupName: c.group.name,
    groupNameEn: c.group.nameEn ?? '',
  });
}

// ─── Material groups ───────────────────────────────────────────────────────────

materialsRouter.get(
  '/groups',
  requireAnyPermission('projects', 'costs', 'inventory'),
  asyncHandler(async (_req, res) => {
    const rows = await prisma.materialGroup.findMany({ orderBy: { code: 'asc' } });
    res.json(serialize(rows));
  }),
);

materialsRouter.post(
  '/groups',
  requireModuleWrite('inventory'),
  asyncHandler(async (req, res) => {
    if (!canManageMaterials(req.user)) {
      res.status(403).json({ error: 'Only admin or projects manager can manage materials' });
      return;
    }
    const body = req.body as { code: string; name: string; nameEn?: string };
    const name = body.name?.trim() || '';
    const nameEn = body.nameEn?.trim() || '';
    if (!body.code?.trim() || (!name && !nameEn)) {
      res.status(400).json({ error: 'code and name are required' });
      return;
    }
    const dup = await prisma.materialGroup.findUnique({ where: { code: body.code.trim() } });
    if (dup) {
      res.status(409).json({ error: 'Group code already exists' });
      return;
    }
    const created = await prisma.materialGroup.create({
      data: {
        code: body.code.trim(),
        name: name || nameEn,
        nameEn: nameEn || null,
      },
    });
    res.status(201).json(serialize(created));
  }),
);

materialsRouter.put(
  '/groups/:id',
  requireModuleWrite('inventory'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = req.body as { code?: string; name?: string; nameEn?: string };
    const exists = await prisma.materialGroup.findUnique({ where: { id } });
    if (!exists) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    if (body.code) {
      const dup = await prisma.materialGroup.findFirst({
        where: { code: body.code.trim(), id: { not: id } },
      });
      if (dup) {
        res.status(409).json({ error: 'Group code already exists' });
        return;
      }
    }
    const data: { code?: string; name?: string; nameEn?: string | null } = {};
    if (body.code) data.code = body.code.trim();
    if (body.name) data.name = body.name.trim();
    if (body.nameEn !== undefined) data.nameEn = body.nameEn.trim() || null;
    const updated = await prisma.materialGroup.update({ where: { id }, data });
    res.json(serialize(updated));
  }),
);

// ─── Material categories ───────────────────────────────────────────────────────

materialsRouter.get(
  '/categories',
  requireAnyPermission('projects', 'costs', 'inventory'),
  asyncHandler(async (req, res) => {
    const groupId = req.query.groupId ? Number(req.query.groupId) : null;
    const rows = (await prisma.materialCategory.findMany({
      where: groupId ? { groupId } : undefined,
      include: { group: { select: { code: true, name: true, nameEn: true } } },
      orderBy: groupId ? { code: 'asc' } : [{ group: { code: 'asc' } }, { code: 'asc' }],
    })) as unknown as CategoryWithGroup[];
    res.json(rows.map(flattenCategory));
  }),
);

/** قراءة الأصناف كمراجع للتكاليف والمخزون (بدون صلاحية تعديل) */
materialsRouter.get(
  '/categories/lookup',
  requireAnyPermission('costs', 'inventory'),
  asyncHandler(async (_req, res) => {
    const rows = (await prisma.materialCategory.findMany({
      include: { group: { select: { code: true, name: true, nameEn: true } } },
      orderBy: [{ group: { code: 'asc' } }, { code: 'asc' }],
    })) as unknown as CategoryWithGroup[];
    res.json(rows.map(flattenCategory));
  }),
);

materialsRouter.post(
  '/categories',
  requireModuleWrite('inventory'),
  asyncHandler(async (req, res) => {
    const body = req.body as { groupId: number; code: string; name: string; unit: string };
    if (!body.groupId || !body.code?.trim() || !body.name?.trim() || !body.unit?.trim()) {
      res.status(400).json({ error: 'groupId, code, name, unit are required' });
      return;
    }
    const group = await prisma.materialGroup.findUnique({ where: { id: Number(body.groupId) } });
    if (!group) {
      res.status(400).json({ error: 'Material group not found' });
      return;
    }
    const dup = await prisma.materialCategory.findUnique({ where: { code: body.code.trim() } });
    if (dup) {
      res.status(409).json({ error: 'Category code already exists' });
      return;
    }
    const created = (await prisma.materialCategory.create({
      data: {
        groupId: Number(body.groupId),
        code: body.code.trim(),
        name: body.name.trim(),
        unit: body.unit.trim(),
      },
      include: { group: { select: { code: true, name: true, nameEn: true } } },
    })) as unknown as CategoryWithGroup;
    res.status(201).json(flattenCategory(created));
  }),
);

materialsRouter.put(
  '/categories/:id',
  requireModuleWrite('inventory'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = req.body as { groupId?: number; code?: string; name?: string; unit?: string };
    const exists = await prisma.materialCategory.findUnique({ where: { id } });
    if (!exists) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    if (body.code) {
      const dup = await prisma.materialCategory.findFirst({
        where: { code: body.code.trim(), id: { not: id } },
      });
      if (dup) {
        res.status(409).json({ error: 'Category code already exists' });
        return;
      }
    }
    const data: { groupId?: number; code?: string; name?: string; unit?: string } = {};
    if (body.groupId) data.groupId = Number(body.groupId);
    if (body.code) data.code = body.code.trim();
    if (body.name) data.name = body.name.trim();
    if (body.unit) data.unit = body.unit.trim();
    const updated = (await prisma.materialCategory.update({
      where: { id },
      data,
      include: { group: { select: { code: true, name: true, nameEn: true } } },
    })) as unknown as CategoryWithGroup;
    res.json(flattenCategory(updated));
  }),
);

// ─── Bulk import (Excel) ─────────────────────────────────────────────────────

type ImportRow = {
  groupCode: string;
  groupName: string;
  groupNameEn?: string;
  categoryCode?: string;
  categoryName?: string;
  unit?: string;
};

materialsRouter.post(
  '/import',
  requireModuleWrite('inventory'),
  asyncHandler(async (req, res) => {
    if (!canManageMaterials(req.user)) {
      res.status(403).json({ error: 'Only admin or projects manager can manage materials' });
      return;
    }
    const rows = (req.body as { rows?: ImportRow[] })?.rows;
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: 'rows array is required' });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const groupIdByCode = new Map<string, number>();
      for (const g of await tx.materialGroup.findMany({ select: { id: true, code: true } })) {
        groupIdByCode.set(g.code, g.id);
      }
      const existingCategories = new Map(
        (await tx.materialCategory.findMany({ select: { id: true, code: true } })).map((r) => [r.code, r.id]),
      );

      let groupsCreated = 0;
      let groupsSkipped = 0;
      let groupsUpdated = 0;
      let categoriesCreated = 0;
      let categoriesUpdated = 0;
      const groupsPatched = new Set<string>();
      const errorList: string[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const groupCode = String(row.groupCode ?? '').trim();
        const groupName = String(row.groupName ?? '').trim();
        const groupNameEn = String(row.groupNameEn ?? '').trim();
        const categoryCode = String(row.categoryCode ?? '').trim();
        const categoryName = String(row.categoryName ?? '').trim();
        const unit = String(row.unit ?? '').trim() || 'عدد';

        if (!groupCode || (!groupName && !groupNameEn)) {
          errorList.push(`Row ${i + 1}: group code and name are required`);
          continue;
        }

        const resolvedName = groupName || groupNameEn;
        let groupId = groupIdByCode.get(groupCode);
        const groupExisted = !!groupId;
        if (!groupId) {
          const g = await tx.materialGroup.create({
            data: { code: groupCode, name: resolvedName, nameEn: groupNameEn || null },
          });
          groupId = g.id;
          groupIdByCode.set(groupCode, groupId);
          groupsCreated++;
          groupsPatched.add(groupCode);
        } else if (!groupsPatched.has(groupCode) && (groupName || groupNameEn)) {
          await tx.materialGroup.update({
            where: { id: groupId },
            data: {
              ...(groupName ? { name: groupName } : {}),
              ...(groupNameEn ? { nameEn: groupNameEn } : {}),
            },
          });
          groupsPatched.add(groupCode);
          groupsUpdated++;
        }

        if (!categoryCode) {
          if (groupExisted) groupsSkipped++;
          continue;
        }

        if (!categoryName) {
          errorList.push(`Row ${i + 1}: category name required for ${categoryCode}`);
          continue;
        }

        const existingCatId = existingCategories.get(categoryCode);
        if (existingCatId) {
          await tx.materialCategory.update({
            where: { id: existingCatId },
            data: { groupId, name: categoryName, unit },
          });
          categoriesUpdated++;
          continue;
        }

        const created = await tx.materialCategory.create({
          data: { groupId, code: categoryCode, name: categoryName, unit },
        });
        existingCategories.set(categoryCode, created.id);
        categoriesCreated++;
      }

      return {
        groupsCreated,
        groupsSkipped,
        groupsUpdated,
        categoriesCreated,
        categoriesUpdated,
        categoriesSkipped: 0,
        errors: errorList,
      };
    });

    res.json(result);
  }),
);
