import { randomUUID } from 'node:crypto';
import { ensureDirectCostCenterForContract } from '../lib/costCenterHelpers.js';
import type { Request, Response } from 'express';
import { Router } from 'express';
import { requireAuth, requireReferenceRead, requireModuleWrite } from '../middleware/auth.js';
import { withIdempotency } from '../middleware/idempotency.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';
import { modelScalarFields } from '../prisma/dmmf.js';
import { hasModuleWrite, type PermissionKey } from '../permissions.js';

type ModelConfig = {
  /** Soft-delete via `isDeleted` flag instead of a hard delete. */
  softDelete: boolean;
  /** Whether the model exposes a `projectId` scalar (for `?projectId=` filter). */
  hasProjectId: boolean;
  /** Whether the model exposes a `contractId` scalar (for `?contractId=` filter). */
  hasContractId: boolean;
  /** Whether the model exposes a `statementId` scalar (for `?statementId=` filter). */
  hasStatementId?: boolean;
};

type CrudRouterOptions = {
  writePermission?: PermissionKey | PermissionKey[];
  /** Optional async transform after list query (e.g. BOQ Firestore rate enrichment). */
  listEnricher?: (rows: unknown[]) => Promise<unknown[]>;
};

const MODELS: Record<string, ModelConfig> = {
  project:             { softDelete: true,  hasProjectId: false, hasContractId: false },
  contract:            { softDelete: true,  hasProjectId: true,  hasContractId: false },
  boqItem:             { softDelete: true,  hasProjectId: true,  hasContractId: true  },
  chartOfAccount:      { softDelete: false, hasProjectId: true,  hasContractId: false },
  supplier:            { softDelete: true,  hasProjectId: false, hasContractId: false },
  purchaseTransaction: { softDelete: true,  hasProjectId: true,  hasContractId: true  },
  bankAccount:         { softDelete: false, hasProjectId: false, hasContractId: false },
  bankMovement:          { softDelete: false, hasProjectId: true,  hasContractId: true  },
  bankCheque:            { softDelete: false, hasProjectId: true,  hasContractId: true  },
  bankStatement:         { softDelete: false, hasProjectId: false, hasContractId: false },
  bankStatementLine:     { softDelete: false, hasProjectId: false, hasContractId: false, hasStatementId: true },
};

// Minimal shape of a Prisma model delegate (only the methods this router uses).
type Delegate = {
  findMany(args: unknown): Promise<unknown[]>;
  findUnique(args: unknown): Promise<unknown>;
  create(args: unknown): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
  delete(args: unknown): Promise<unknown>;
};

/** Keeps only writable scalar fields from a request body for create/update. */
function pickFields(modelName: string, body: Record<string, unknown>, exclude: string[]): Record<string, unknown> {
  const allowed = modelScalarFields(modelName);
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (exclude.includes(k)) continue;
    if (allowed && !allowed.has(k)) continue;
    data[k] = v;
  }
  return data;
}

export function createCrudRouter(
  _prisma: unknown,
  modelName: string,
  permission: PermissionKey | PermissionKey[],
  options?: CrudRouterOptions,
) {
  const config = MODELS[modelName];
  if (!config) throw new Error(`Unknown model: ${modelName}`);
  const delegate = (prisma as unknown as Record<string, Delegate>)[modelName];
  if (!delegate) throw new Error(`Prisma delegate not found for model: ${modelName}`);
  const router = Router();
  const listEnricher = options?.listEnricher;

  const readPerms = Array.isArray(permission) ? permission : [permission];
  const writePerms = options?.writePermission
    ? Array.isArray(options.writePermission)
      ? options.writePermission
      : [options.writePermission]
    : readPerms;

  const readMw = requireReferenceRead(...readPerms);
  const writeMw = requireModuleWrite(...writePerms);

  router.use(requireAuth);
  router.use(withIdempotency());

  router.use((req, res, next) => {
    if (req.method === 'GET') return readMw(req, res, next);
    const path = req.path || '/';
    const isWrite =
      (req.method === 'POST' && (path === '/' || path === '')) ||
      (req.method === 'PUT' && path !== '/' && path !== '') ||
      (req.method === 'DELETE' && path !== '/' && path !== '');
    if (!isWrite) return next();
    return writeMw(req, res, next);
  });

  function assertWrite(req: Request, res: Response): boolean {
    const ok = writePerms.some((k) => hasModuleWrite(req.user?.permissions, k));
    if (!ok) {
      res.status(403).json({ error: 'Write access denied for this resource' });
      return false;
    }
    return true;
  }

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const where: Record<string, unknown> = {};
      if (config.softDelete && req.query.includeDeleted !== 'true') where.isDeleted = false;
      if (config.hasProjectId && req.query.projectId) where.projectId = String(req.query.projectId);
      if (config.hasContractId && req.query.contractId) where.contractId = String(req.query.contractId);
      if (config.hasStatementId && req.query.statementId) where.statementId = String(req.query.statementId);
      const rows = await delegate.findMany({ where, orderBy: { createdAt: 'desc' } });
      const enriched = listEnricher ? await listEnricher(rows) : rows;
      res.json(serialize(enriched));
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const row = await delegate.findUnique({ where: { id: req.params.id } });
      if (!row) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      res.json(serialize(row));
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      if (!assertWrite(req, res)) return;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const data = pickFields(modelName, body, ['createdAt', 'updatedAt']);
      data.id = String(body.id || randomUUID());
      const created = await delegate.create({ data });
      if (modelName === 'contract') {
        const row = created as { id: string; contractName: string; contractNameEn?: string | null; isDeleted?: boolean };
        await ensureDirectCostCenterForContract(prisma, row);
      }
      res.status(201).json(serialize(created));
    }),
  );

  router.put(
    '/:id',
    asyncHandler(async (req, res) => {
      if (!assertWrite(req, res)) return;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const data = pickFields(modelName, body, ['id', 'createdAt', 'updatedAt']);
      const updated = await delegate.update({ where: { id: req.params.id }, data });
      res.json(serialize(updated));
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      if (!assertWrite(req, res)) return;
      if (config.softDelete) {
        await delegate.update({ where: { id: req.params.id }, data: { isDeleted: true } });
      } else {
        await delegate.delete({ where: { id: req.params.id } });
      }
      res.json({ id: req.params.id });
    }),
  );

  return router;
}
