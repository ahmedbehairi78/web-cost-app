import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';
import { createTransaction } from '../accounting/journal.js';
import { roundMoney, MONEY_TOLERANCE } from '../lib/money.js';
import { assertProjectAccess, getAccessibleProjectIds } from './inventoryHelpers.js';

export const contractExpenseOrdersRouter = Router();
contractExpenseOrdersRouter.use(requireAuth);

async function generateOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
  const cnt = await tx.contractExpenseOrder.count({
    where: { orderNumber: { startsWith: 'CEX-' } },
  });
  const seq = String(cnt + 1).padStart(4, '0');
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `CEX-${date}-${seq}`;
}

function num(v: unknown): number {
  return Number(v) || 0;
}

function validateLines(
  totalAmount: number,
  lines: Array<{ boqItemId: string; amount: number }>,
): string | null {
  if (!lines.length) return 'At least one BOQ line is required';
  const seen = new Set<string>();
  let sum = 0;
  for (const line of lines) {
    const id = String(line.boqItemId ?? '').trim();
    const amount = num(line.amount);
    if (!id) return 'Each line must have a BOQ item';
    if (amount <= 0) return 'Each line amount must be positive';
    if (seen.has(id)) return 'Duplicate BOQ item in allocation';
    seen.add(id);
    sum = roundMoney(sum + amount);
  }
  if (Math.abs(sum - roundMoney(totalAmount)) > MONEY_TOLERANCE) {
    return 'Line amounts must sum to total amount';
  }
  return null;
}

contractExpenseOrdersRouter.get(
  '/',
  requirePermission('costs'),
  asyncHandler(async (req, res) => {
    const accessibleProjectIds = await getAccessibleProjectIds(prisma, req.user);
    const where: Prisma.ContractExpenseOrderWhereInput = {};
    if (req.query.contractId) where.contractId = String(req.query.contractId);
    if (req.query.projectId) where.projectId = String(req.query.projectId);
    if (accessibleProjectIds !== null) {
      where.projectId = { in: accessibleProjectIds };
    }
    const rows = await prisma.contractExpenseOrder.findMany({
      where,
      include: { lines: true },
      orderBy: { id: 'desc' },
    });
    res.json(rows.map((r) => serialize(r)));
  }),
);

contractExpenseOrdersRouter.post(
  '/',
  requirePermission('costs'),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      contractId?: string;
      projectId?: string;
      orderDate?: string;
      expenseAccountCode?: string;
      expenseAccountName?: string;
      creditorAccountCode?: string;
      creditorAccountName?: string;
      totalAmount?: number;
      description?: string;
      referenceNumber?: string;
      lines?: Array<{ boqItemId: string; amount: number }>;
    };

    const contractId = String(body.contractId ?? '').trim();
    const projectId = String(body.projectId ?? '').trim();
    const totalAmount = roundMoney(num(body.totalAmount));
    const lines = Array.isArray(body.lines) ? body.lines : [];

    if (!contractId || !projectId || totalAmount <= 0) {
      res.status(400).json({ error: 'contractId, projectId, and totalAmount are required' });
      return;
    }

    const lineErr = validateLines(totalAmount, lines);
    if (lineErr) {
      res.status(400).json({ error: lineErr });
      return;
    }

    await assertProjectAccess(prisma, req.user, projectId);

    const contract = await prisma.contract.findFirst({
      where: { id: contractId, projectId, isDeleted: false },
    });
    if (!contract) {
      res.status(404).json({ error: 'Contract not found' });
      return;
    }

    for (const line of lines) {
      const boq = await prisma.boqItem.findFirst({
        where: { id: line.boqItemId, contractId, isDeleted: false },
      });
      if (!boq) {
        res.status(400).json({ error: `BOQ item ${line.boqItemId} not found on contract` });
        return;
      }
    }

    const order = await prisma.$transaction(async (tx) => {
      const orderNumber = await generateOrderNumber(tx);
      return tx.contractExpenseOrder.create({
        data: {
          orderNumber,
          contractId,
          projectId,
          orderDate: body.orderDate?.trim() || new Date().toISOString().slice(0, 10),
          expenseAccountCode: String(body.expenseAccountCode ?? '').trim(),
          expenseAccountName: body.expenseAccountName?.trim() || null,
          creditorAccountCode: String(body.creditorAccountCode ?? '').trim(),
          creditorAccountName: body.creditorAccountName?.trim() || null,
          totalAmount,
          description: body.description?.trim() || '',
          referenceNumber: body.referenceNumber?.trim() || null,
          status: 'draft',
          recordedBy: req.user?.email ?? req.user?.id ?? 'unknown',
          lines: {
            create: lines.map((l) => ({
              boqItemId: l.boqItemId,
              amount: roundMoney(num(l.amount)),
            })),
          },
        },
        include: { lines: true },
      });
    });

    res.status(201).json(serialize(order));
  }),
);

contractExpenseOrdersRouter.post(
  '/:id/confirm',
  requirePermission('costs'),
  asyncHandler(async (req, res) => {
    const orderId = Number(req.params.id);
    if (!Number.isFinite(orderId)) {
      res.status(400).json({ error: 'Invalid order id' });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.contractExpenseOrder.findUnique({
        where: { id: orderId },
        include: { lines: true },
      });
      if (!order) throw new Error('Order not found');
      if (order.status !== 'draft') throw new Error('Order is not draft');

      await assertProjectAccess(tx, req.user, order.projectId);

      const expenseCode = order.expenseAccountCode.trim();
      const creditorCode = order.creditorAccountCode.trim();
      if (!expenseCode || !creditorCode) throw new Error('Expense and creditor accounts are required');

      const drLines = order.lines.map((line) => ({
        accountCode: expenseCode,
        accountName: order.expenseAccountName ?? undefined,
        debit: roundMoney(num(line.amount)),
        credit: 0,
        costCenterId: order.contractId,
      }));

      const journal = await createTransaction(
        {
          date: order.orderDate,
          description: order.description || `Contract expense ${order.orderNumber}`,
          reference: order.referenceNumber?.trim() || order.orderNumber,
          projectId: order.projectId,
          costCenterId: order.contractId,
          entries: [
            ...drLines,
            {
              accountCode: creditorCode,
              accountName: order.creditorAccountName ?? undefined,
              debit: 0,
              credit: roundMoney(num(order.totalAmount)),
            },
          ],
        },
        req.user?.id,
        tx,
      );

      for (const line of order.lines) {
        const amount = roundMoney(num(line.amount));
        await tx.boqActualCost.create({
          data: {
            boqItemId: line.boqItemId,
            contractId: order.contractId,
            contractExpenseOrderId: order.id,
            quantity: 1,
            unitCost: amount,
            totalCost: amount,
            costElement: 'other',
          },
        });
      }

      const updated = await tx.contractExpenseOrder.update({
        where: { id: orderId },
        data: { status: 'confirmed', transactionId: journal.id },
        include: { lines: true },
      });

      return { order: updated, transactionId: journal.id };
    });

    res.json({
      ...(serialize(result.order) as Record<string, unknown>),
      transactionId: result.transactionId,
    });
  }),
);
