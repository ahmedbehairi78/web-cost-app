import { Router } from 'express';
import { requireAuth, requireAnyPermission } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ensureMissingCoaAccounts, type CoaExtraAccount } from '../accounting/ensureCoaSeed.js';
import { syncBatchCoaAccounts, type CoaSyncRow } from '../accounting/syncCoaBatch.js';

const coaConsumerPerm = requireAnyPermission(
  'ledger',
  'costs',
  'billing',
  'banks',
  'inventory',
  'projects',
  'boq',
  'suppliers',
  'reports',
  'subcontractor',
);

export const chartOfAccountsMaintenanceRouter = Router();

chartOfAccountsMaintenanceRouter.post(
  '/ensure-missing',
  requireAuth,
  coaConsumerPerm,
  asyncHandler(async (req, res) => {
    const body = req.body as { codes?: unknown; extras?: unknown };
    const codes = Array.isArray(body.codes) ? body.codes.map(String).filter(Boolean) : undefined;
    const extras = Array.isArray(body.extras)
      ? (body.extras as CoaExtraAccount[]).filter((e) => e && typeof e.accountCode === 'string')
      : undefined;
    const result = await ensureMissingCoaAccounts({ codes, extras });
    res.json(result);
  }),
);

chartOfAccountsMaintenanceRouter.post(
  '/sync-batch',
  requireAuth,
  coaConsumerPerm,
  asyncHandler(async (req, res) => {
    const body = req.body as { accounts?: unknown };
    const accounts = Array.isArray(body.accounts)
      ? (body.accounts as CoaSyncRow[]).filter((a) => a && typeof a.accountCode === 'string' && typeof a.id === 'string')
      : [];
    const result = await syncBatchCoaAccounts(accounts);
    res.json(result);
  }),
);
