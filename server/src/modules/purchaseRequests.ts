import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';
import { roundQty } from '../lib/consumptionAllocation.js';
import {
  hasModuleWrite,
  moduleAccess,
  normalizeUserPermissions,
} from '../permissions.js';
import {
  notifyPurchaseRequestCreated,
  notifyPurchaseRequestResolved,
} from '../lib/notificationHooks.js';

const ACTIVE_STATUSES = ['open', 'contacted', 'postponed', 'unavailable'] as const;
const CLOSED_STATUSES = ['executed', 'cancelled'] as const;
const ALL_STATUSES = [...ACTIVE_STATUSES, ...CLOSED_STATUSES] as const;

function isClosedStatus(status: string): boolean {
  return (CLOSED_STATUSES as readonly string[]).includes(status);
}
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

function canManageStatus(user: NonNullable<Request['user']>): boolean {
  if (user.role === 'admin' || user.role === 'projects_manager' || user.role === 'project_accountant') {
    return true;
  }
  return moduleAccess(normalizeUserPermissions(user.permissions), 'purchase_requests').edit;
}

function requireStatusEditor(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (!canManageStatus(req.user)) {
    res.status(403).json({ error: 'لا صلاحية لتغيير حالة طلب الشراء' });
    return;
  }
  next();
}

function todayCairoYmd(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

async function nextRequestNumber(): Promise<string> {
  const day = todayCairoYmd().replace(/-/g, '');
  const prefix = `PR-${day}-`;
  const latest = await prisma.purchaseRequest.findFirst({
    where: { requestNumber: { startsWith: prefix } },
    orderBy: { requestNumber: 'desc' },
    select: { requestNumber: true },
  });
  let seq = 1;
  if (latest?.requestNumber) {
    const m = latest.requestNumber.match(/-(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

function materialLabel(row: {
  materialMode: string;
  materialCode: string | null;
  materialName: string | null;
  description: string | null;
}): string {
  if (row.materialMode === 'coded') {
    const code = row.materialCode?.trim() || '';
    const name = row.materialName?.trim() || '';
    return [code, name].filter(Boolean).join(' — ') || name || code || '—';
  }
  return row.description?.trim() || row.materialName?.trim() || 'غير مكود';
}

export const purchaseRequestsRouter = Router();
purchaseRequestsRouter.use(requireAuth);

purchaseRequestsRouter.get(
  '/meta',
  asyncHandler(async (_req, res) => {
    const [projects, contracts] = await Promise.all([
      prisma.project.findMany({
        where: { isDeleted: false },
        select: { id: true, projectCode: true, projectName: true, projectNameEn: true },
        orderBy: { projectCode: 'asc' },
      }),
      prisma.contract.findMany({
        where: { isDeleted: false },
        select: {
          id: true,
          projectId: true,
          contractName: true,
          contractNameEn: true,
          contractNumber: true,
        },
        orderBy: { contractNumber: 'asc' },
      }),
    ]);
    res.json({ projects: serialize(projects), contracts: serialize(contracts) });
  }),
);

purchaseRequestsRouter.get(
  '/materials-lookup',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.materialCategory.findMany({
      include: { group: { select: { code: true, name: true } } },
      orderBy: [{ group: { code: 'asc' } }, { code: 'asc' }],
    });
    res.json(
      serialize(
        rows.map((r) => ({
          id: r.id,
          groupId: r.groupId,
          code: r.code,
          name: r.name,
          unit: r.unit,
          groupCode: r.group.code,
          groupName: r.group.name,
        })),
      ),
    );
  }),
);

purchaseRequestsRouter.get(
  '/boq-picker',
  asyncHandler(async (req, res) => {
    const contractId = String(req.query.contractId ?? '').trim();
    if (!contractId) {
      res.status(400).json({ error: 'contractId is required' });
      return;
    }
    const items = await prisma.boqItem.findMany({
      where: { contractId, isDeleted: false },
      select: { id: true, itemCode: true, description: true },
      orderBy: [{ itemCode: 'asc' }],
    });
    res.json(
      serialize(
        items.map((i) => ({
          id: i.id,
          itemCode: i.itemCode,
          description: i.description?.trim() || '',
        })),
      ),
    );
  }),
);

purchaseRequestsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const scope = String(req.query.scope ?? 'open').trim();
    const where: Record<string, unknown> = { isDeleted: false };
    if (scope === 'open') {
      where.status = { in: [...ACTIVE_STATUSES] };
    } else if (scope === 'executed') {
      // Closed list: executed + cancelled
      where.status = { in: [...CLOSED_STATUSES] };
    } else if (scope !== 'all') {
      res.status(400).json({ error: 'scope must be open | executed | all' });
      return;
    }
    const rows = await prisma.purchaseRequest.findMany({
      where,
      // Prefer updatedAt for closed list (always set); statusUpdatedAt may be null on legacy rows.
      orderBy:
        scope === 'executed'
          ? [{ updatedAt: 'desc' }, { requestedAt: 'desc' }]
          : [{ neededByDate: 'asc' }, { requestedAt: 'desc' }],
      take: 2000,
    });
    res.json(serialize(rows));
  }),
);

purchaseRequestsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const createAccess = moduleAccess(
      normalizeUserPermissions(req.user?.permissions),
      'purchase_requests',
    );
    if (!createAccess.create && req.user?.role !== 'admin') {
      res.status(403).json({ error: 'لا صلاحية لإنشاء طلب شراء' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const materialMode = String(body.materialMode ?? '').trim();
    if (materialMode !== 'coded' && materialMode !== 'uncoded') {
      res.status(400).json({ error: 'materialMode must be coded or uncoded' });
      return;
    }
    const projectId = String(body.projectId ?? '').trim();
    const contractId = String(body.contractId ?? '').trim();
    if (!projectId || !contractId) {
      res.status(400).json({ error: 'projectId and contractId are required' });
      return;
    }
    const quantity = roundQty(Number(body.quantity) || 0);
    if (quantity <= 0) {
      res.status(400).json({ error: 'quantity must be > 0' });
      return;
    }
    let neededByDate = String(body.neededByDate ?? '').trim();
    const neededPreset = String(body.neededPreset ?? '').trim();
    if (neededPreset === 'today') neededByDate = todayCairoYmd();
    else if (neededPreset === 'tomorrow') neededByDate = addDaysYmd(todayCairoYmd(), 1);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(neededByDate)) {
      res.status(400).json({ error: 'neededByDate is required (YYYY-MM-DD)' });
      return;
    }
    const priority = String(body.priority ?? 'medium').trim();
    if (!PRIORITIES.includes(priority as (typeof PRIORITIES)[number])) {
      res.status(400).json({ error: 'invalid priority' });
      return;
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, isDeleted: false },
      select: { id: true },
    });
    if (!project) {
      res.status(400).json({ error: 'المشروع غير موجود' });
      return;
    }
    const contract = await prisma.contract.findFirst({
      where: { id: contractId, projectId, isDeleted: false },
      select: { id: true },
    });
    if (!contract) {
      res.status(400).json({ error: 'العقد غير موجود لهذا المشروع' });
      return;
    }

    let materialCategoryId: number | null = null;
    let materialCode: string | null = null;
    let materialName: string | null = null;
    let unit: string | null = body.unit != null ? String(body.unit).trim() || null : null;
    let description: string | null =
      body.description != null ? String(body.description).trim() || null : null;

    if (materialMode === 'coded') {
      const catId = Number(body.materialCategoryId);
      if (!Number.isFinite(catId) || catId <= 0) {
        res.status(400).json({ error: 'materialCategoryId is required for coded materials' });
        return;
      }
      const cat = await prisma.materialCategory.findUnique({ where: { id: catId } });
      if (!cat) {
        res.status(400).json({ error: 'الصنف غير موجود في شجرة الأصناف' });
        return;
      }
      materialCategoryId = cat.id;
      materialCode = cat.code;
      materialName = cat.name;
      unit = cat.unit;
      if (!description) description = cat.name;
    } else {
      if (!description) {
        res.status(400).json({ error: 'وصف الصنف مطلوب للصنف غير المكود' });
        return;
      }
      materialName = description;
    }

    let boqItemId: string | null = null;
    let boqItemCode: string | null = null;
    let boqDescription: string | null = null;
    const rawBoqId = body.boqItemId != null ? String(body.boqItemId).trim() : '';
    if (rawBoqId) {
      const boq = await prisma.boqItem.findFirst({
        where: { id: rawBoqId, contractId, isDeleted: false },
        select: { id: true, itemCode: true, description: true },
      });
      if (!boq) {
        res.status(400).json({ error: 'بند قائمة الكميات غير موجود لهذا العقد' });
        return;
      }
      boqItemId = boq.id;
      boqItemCode = boq.itemCode;
      boqDescription = boq.description?.trim() || null;
    }

    const id = randomUUID();
    const requestNumber = await nextRequestNumber();
    const row = await prisma.purchaseRequest.create({
      data: {
        id,
        requestNumber,
        materialMode,
        materialCategoryId,
        materialCode,
        materialName,
        unit,
        description,
        quantity,
        projectId,
        contractId,
        boqItemId,
        boqItemCode,
        boqDescription,
        neededByDate,
        priority,
        status: 'open',
        requestedByUserId: req.user?.id ?? null,
      },
    });

    notifyPurchaseRequestCreated(
      {
        id: row.id,
        requestNumber: row.requestNumber,
        projectId: row.projectId,
        materialLabel: materialLabel(row),
        quantity: Number(row.quantity),
        neededByDate: row.neededByDate,
        priority: row.priority,
      },
      req.user?.id,
    );

    res.status(201).json(serialize(row));
  }),
);

purchaseRequestsRouter.patch(
  '/:id/status',
  requireStatusEditor,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const status = String((req.body as { status?: string })?.status ?? '').trim();
    const note =
      (req.body as { note?: string })?.note != null
        ? String((req.body as { note?: string }).note).trim() || null
        : undefined;
    if (!ALL_STATUSES.includes(status as (typeof ALL_STATUSES)[number])) {
      res.status(400).json({
        error:
          'status must be open | contacted | postponed | unavailable | executed | cancelled',
      });
      return;
    }
    const existing = await prisma.purchaseRequest.findFirst({
      where: { id, isDeleted: false },
    });
    if (!existing) {
      res.status(404).json({ error: 'طلب الشراء غير موجود' });
      return;
    }
    const updated = await prisma.purchaseRequest.update({
      where: { id },
      data: {
        status,
        statusUpdatedAt: new Date(),
        statusUpdatedByUserId: req.user?.id ?? null,
        ...(note !== undefined ? { statusNote: note } : {}),
      },
    });
    if (isClosedStatus(status)) {
      notifyPurchaseRequestResolved(id);
    } else if (isClosedStatus(existing.status) && !isClosedStatus(status)) {
      notifyPurchaseRequestCreated(
        {
          id: updated.id,
          requestNumber: updated.requestNumber,
          projectId: updated.projectId,
          materialLabel: materialLabel(updated),
          quantity: Number(updated.quantity),
          neededByDate: updated.neededByDate,
          priority: updated.priority,
        },
        req.user?.id,
      );
    }
    res.json(serialize(updated));
  }),
);

purchaseRequestsRouter.post(
  '/:id/notify-whatsapp',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const perms = normalizeUserPermissions(req.user?.permissions);
    const access = moduleAccess(perms, 'purchase_requests');
    const mayNotify =
      req.user?.role === 'admin'
      || access.create
      || access.edit
      || hasModuleWrite(perms, 'purchase_requests');
    if (!mayNotify) {
      res.status(403).json({ error: 'لا صلاحية لإرسال إشعار واتساب' });
      return;
    }
    const row = await prisma.purchaseRequest.findFirst({
      where: { id, isDeleted: false },
    });
    if (!row) {
      res.status(404).json({ error: 'طلب الشراء غير موجود' });
      return;
    }
    if (isClosedStatus(row.status)) {
      res.status(400).json({ error: 'لا يمكن إرسال واتساب لطلب منتهٍ' });
      return;
    }
    notifyPurchaseRequestCreated(
      {
        id: row.id,
        requestNumber: row.requestNumber,
        projectId: row.projectId,
        materialLabel: materialLabel(row),
        quantity: Number(row.quantity),
        neededByDate: row.neededByDate,
        priority: row.priority,
      },
      req.user?.id,
    );
    res.json({ ok: true });
  }),
);

purchaseRequestsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const row = await prisma.purchaseRequest.findFirst({
      where: { id, isDeleted: false },
    });
    if (!row) {
      res.status(404).json({ error: 'طلب الشراء غير موجود' });
      return;
    }
    const isAdmin = req.user?.role === 'admin';
    const isCreator = row.requestedByUserId && row.requestedByUserId === req.user?.id;
    if (!isAdmin && !isCreator) {
      res.status(403).json({ error: 'يمكن حذف الطلب للمنشئ أو المدير فقط' });
      return;
    }
    if (isClosedStatus(row.status) && !isAdmin) {
      res.status(403).json({ error: 'لا يمكن حذف طلب منتهٍ' });
      return;
    }
    await prisma.purchaseRequest.update({
      where: { id },
      data: { isDeleted: true },
    });
    notifyPurchaseRequestResolved(id);
    res.json({ ok: true });
  }),
);
