import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { serialize } from '../prisma/serialize.js';
import {
  POSTGRES_WIPE_GROUP_IDS,
  wipeFinancialMovementsPostgres,
  wipePostgresDataGroups,
  type PostgresWipeGroupId,
} from '../lib/dataMaintenanceWipes.js';
import { FactoryResetError, factoryResetPostgres } from '../lib/factoryReset.js';

export { wipeFinancialMovementsPostgres };

export const financialMaintenanceRouter = Router();

financialMaintenanceRouter.use(requireAuth);
financialMaintenanceRouter.use(requireRole('admin'));

financialMaintenanceRouter.post(
  '/wipe-financial',
  asyncHandler(async (_req, res) => {
    const deleted = await wipeFinancialMovementsPostgres();
    const total = Object.values(deleted).reduce((s, n) => s + n, 0);
    res.json(serialize({ ok: true, deleted, total }));
  }),
);

financialMaintenanceRouter.post(
  '/factory-reset',
  asyncHandler(async (req, res) => {
    try {
      const result = await factoryResetPostgres({ actorEmail: req.user?.email ?? null });
      await new Promise<void>((resolve) => {
        req.session.destroy(() => resolve());
      });
      res.json(serialize({ ok: true, requiresReLogin: true, ...result }));
    } catch (error) {
      if (error instanceof FactoryResetError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      throw error;
    }
  }),
);

financialMaintenanceRouter.post(
  '/wipe',
  asyncHandler(async (req, res) => {
    const raw = req.body?.groups;
    if (!Array.isArray(raw) || raw.length === 0) {
      res.status(400).json({ error: 'groups array is required' });
      return;
    }
    const groups = raw.filter((g): g is PostgresWipeGroupId =>
      typeof g === 'string' && POSTGRES_WIPE_GROUP_IDS.includes(g as PostgresWipeGroupId),
    );
    if (groups.length === 0) {
      res.status(400).json({ error: 'No valid wipe groups' });
      return;
    }
    const result = await wipePostgresDataGroups(groups);
    res.json(serialize({ ok: true, ...result }));
  }),
);
