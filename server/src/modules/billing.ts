import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { requireAuth, requirePermission, requireRole } from '../middleware/auth.js';
import { withIdempotency } from '../middleware/idempotency.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';
import { approveBillingIpc, buildBillingIpcPreviewEntries } from '../lib/billingIpcApprove.js';
import { syncBillingRegistry } from '../lib/documentRegistrySync.js';
import { mapBillingItems, syncBillingJournal, type BillingWriteBody } from './billingHelpers.js';
import { validateIpcBoqQuantities, type IpcBoqExceedRow } from '../lib/ipcBoqValidation.js';
import { assertTransactionPeriodUnlocked } from '../accounting/periodLock.js';

export const billingRouter = Router();

billingRouter.use(requireAuth, requirePermission('billing'));
billingRouter.use(withIdempotency());

const STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ['submitted'],
  submitted: ['review'],
  review: ['submitted'],
  approved: ['paid'],
  paid: [],
};

function assertStatusTransition(from: string, to: string): void {
  if (to === 'approved') {
    throw new Error('Use POST /:id/approve to approve IPC');
  }
  if (to === 'draft') {
    throw new Error('Use POST /:id/revert-to-draft');
  }
  const allowed = STATUS_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(`Invalid status transition: ${from} → ${to}`);
  }
}

billingRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const where: Prisma.BillingWhereInput = { isDeleted: false };
    if (req.query.contractId) where.contractId = String(req.query.contractId);
    if (req.query.projectId) where.projectId = String(req.query.projectId);

    const rows = await prisma.billing.findMany({
      where,
      orderBy: { date: 'desc' },
      include: { items: true },
    });
    res.json(serialize(rows));
  }),
);

billingRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = req.body as BillingWriteBody;
    let boqQuantityWarnings: IpcBoqExceedRow[] = [];

    const result = await prisma.$transaction(async (tx) => {
      const contract = await tx.contract.findUnique({ where: { id: String(body.contractId) } });
      if (!contract) throw new Error('Contract not found');

      const items = (body.items as Record<string, unknown>[]) || [];
      const status = String(body.status || 'submitted');
      if (status !== 'draft' && items.length > 0) {
        boqQuantityWarnings = await validateIpcBoqQuantities(tx, String(body.contractId), items);
      }

      const transactionId = await syncBillingJournal(tx, body, contract.contractName, req.user?.id, null);

      return tx.billing.create({
        data: {
          projectId: String(body.projectId),
          contractId: String(body.contractId),
          billingNumber: String(body.billingNumber),
          date: String(body.date),
          worksValueExVat: Number(body.worksValueExVat || 0),
          vatAmount: Number(body.vatAmount || 0),
          execGuaranteeAmount: Number(body.execGuaranteeAmount || 0),
          whtAmount: Number(body.whtAmount || 0),
          labourInsuranceAmount: Number(body.labourInsuranceAmount || 0),
          manpowerLevyAmount: Number(body.manpowerLevyAmount || 0),
          advancePaymentRecovery: Number(body.advancePaymentRecovery || 0),
          netPayable: Number(body.netPayable || 0),
          status: String(body.status || 'submitted'),
          transactionId: transactionId ?? null,
          items: { create: mapBillingItems(items) },
        },
        include: { items: true },
      });
    });

    await syncBillingRegistry(result.id);

    res.status(201).json(serialize({ ...result, boqQuantityWarnings }));
  }),
);

billingRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const body = req.body as BillingWriteBody;
    const billingId = req.params.id;
    let boqQuantityWarnings: IpcBoqExceedRow[] = [];

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.billing.findUnique({ where: { id: billingId } });
      if (!existing || existing.isDeleted) throw new Error('Billing not found');

      const contract = await tx.contract.findUnique({
        where: { id: String(body.contractId ?? existing.contractId) },
      });
      if (!contract) throw new Error('Contract not found');

      const items = (body.items as Record<string, unknown>[]) || [];
      const status = String(body.status ?? existing.status);
      if (status !== 'draft' && items.length > 0) {
        boqQuantityWarnings = await validateIpcBoqQuantities(
          tx,
          String(body.contractId ?? existing.contractId),
          items,
        );
      }

      const transactionId = await syncBillingJournal(
        tx,
        {
          ...body,
          billingNumber: body.billingNumber ?? existing.billingNumber,
          contractId: body.contractId ?? existing.contractId,
        },
        contract.contractName,
        req.user?.id,
        existing.transactionId,
      );

      await tx.billingItem.deleteMany({ where: { billingId } });

      return tx.billing.update({
        where: { id: billingId },
        data: {
          projectId: String(body.projectId ?? existing.projectId),
          contractId: String(body.contractId ?? existing.contractId),
          billingNumber: String(body.billingNumber ?? existing.billingNumber),
          date: String(body.date ?? existing.date),
          worksValueExVat: Number(body.worksValueExVat ?? existing.worksValueExVat),
          vatAmount: Number(body.vatAmount ?? existing.vatAmount),
          execGuaranteeAmount: Number(body.execGuaranteeAmount ?? existing.execGuaranteeAmount),
          whtAmount: Number(body.whtAmount ?? existing.whtAmount),
          labourInsuranceAmount: Number(body.labourInsuranceAmount ?? existing.labourInsuranceAmount),
          manpowerLevyAmount: Number(body.manpowerLevyAmount ?? existing.manpowerLevyAmount),
          advancePaymentRecovery: Number(body.advancePaymentRecovery ?? existing.advancePaymentRecovery),
          netPayable: Number(body.netPayable ?? existing.netPayable),
          status: String(body.status ?? existing.status),
          transactionId,
          ...(items.length > 0 ? { items: { create: mapBillingItems(items) } } : {}),
        },
        include: { items: true },
      });
    });

    await syncBillingRegistry(billingId);

    res.json(serialize({ ...result, boqQuantityWarnings }));
  }),
);

billingRouter.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const status = String((req.body as { status?: string }).status ?? '').trim();
    if (!status) {
      res.status(400).json({ error: 'status is required' });
      return;
    }

    const existing = await prisma.billing.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.isDeleted) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    try {
      assertStatusTransition(String(existing.status), status);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }

    const result = await prisma.billing.update({
      where: { id: req.params.id },
      data: { status },
      include: { items: true },
    });
    await syncBillingRegistry(req.params.id);
    res.json(serialize(result));
  }),
);

billingRouter.get(
  '/:id/journal-preview',
  asyncHandler(async (req, res) => {
    const row = await prisma.billing.findUnique({ where: { id: req.params.id } });
    if (!row || row.isDeleted) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const contract = await prisma.contract.findUnique({
      where: { id: row.contractId },
      select: { contractName: true },
    });
    const entries = buildBillingIpcPreviewEntries(row, contract?.contractName ?? '');
    res.json({
      entries,
      reference: `IPC-${row.billingNumber}`,
      description: row.billingNumber ? `IPC No ${row.billingNumber}` : 'IPC',
      billingNumber: row.billingNumber,
      status: row.status,
    });
  }),
);

billingRouter.post(
  '/:id/approve',
  requireRole('admin', 'projects_manager'),
  asyncHandler(async (req, res) => {
    try {
      await approveBillingIpc(req.params.id, req.user?.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'Not found') {
        res.status(404).json({ error: msg });
        return;
      }
      if (msg === 'ipc_total_qty_exceeds_tender') {
        const e = err as Error & { exceedCount?: number; itemCode?: string };
        res.status(400).json({
          error: msg,
          exceedCount: e.exceedCount ?? 1,
          itemCode: e.itemCode,
        });
        return;
      }
      if (msg === 'ipc_previous_qty_below_mos_billing' || msg === 'ipc_line_qty_mismatch') {
        const e = err as Error & {
          issueCount?: number;
          itemCode?: string;
          expectedPrevious?: number;
          actualPrevious?: number;
        };
        res.status(400).json({
          error: msg,
          issueCount: e.issueCount ?? 1,
          itemCode: e.itemCode,
          expectedPrevious: e.expectedPrevious,
          actualPrevious: e.actualPrevious,
        });
        return;
      }
      res.status(400).json({ error: msg });
      return;
    }

    const result = await prisma.billing.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });
    if (result) await syncBillingRegistry(req.params.id);
    res.json(serialize(result));
  }),
);

billingRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = await prisma.$transaction(async (tx) => {
      const billing = await tx.billing.findUnique({ where: { id: req.params.id } });
      if (!billing) throw new Error('Billing not found');

      if (billing.transactionId) {
        await assertTransactionPeriodUnlocked(tx, billing.transactionId, req.user?.id);
        await tx.transaction.update({
          where: { id: billing.transactionId },
          data: { isDeleted: true },
        });
      }

      return tx.billing.update({
        where: { id: req.params.id },
        data: { isDeleted: true, transactionId: null },
        include: { items: true },
      });
    });

    await syncBillingRegistry(req.params.id);
    res.json(serialize(result));
  }),
);

billingRouter.post(
  '/:id/revert-to-draft',
  asyncHandler(async (req, res) => {
    const result = await prisma.$transaction(async (tx) => {
      const billing = await tx.billing.findUnique({ where: { id: req.params.id } });
      if (!billing) throw new Error('Billing not found');

      if (billing.transactionId) {
        await assertTransactionPeriodUnlocked(tx, billing.transactionId, req.user?.id);
        await tx.transaction.update({
          where: { id: billing.transactionId },
          data: { isDeleted: true },
        });
      }

      return tx.billing.update({
        where: { id: req.params.id },
        data: { status: 'draft', transactionId: null },
        include: { items: true },
      });
    });

    await syncBillingRegistry(req.params.id);
    res.json(serialize(result));
  }),
);

