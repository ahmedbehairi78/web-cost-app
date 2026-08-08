/**
 * Atomic bank GL posting — journal + operational row status in one transaction.
 * Prevents orphan journals when offline sync queues glApi.createTransaction alone.
 */
import { Router } from 'express';
import { requireAuth, requireModuleWrite } from '../middleware/auth.js';
import { withIdempotency } from '../middleware/idempotency.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';
import { createTransaction } from '../accounting/journal.js';
import { roundMoney } from '../lib/money.js';
import type { Prisma } from '@prisma/client';

type JournalEntryBody = {
  accountCode: string;
  accountName?: string;
  debit?: number;
  credit?: number;
  costCenterId?: string;
};

type JournalBody = {
  date?: string;
  description?: string;
  descriptionEn?: string | null;
  reference?: string;
  projectId?: string | null;
  costCenterId?: string | null;
  entries?: JournalEntryBody[];
};

const writeMw = requireModuleWrite('banks', 'ledger');

function mapEntries(entries: JournalEntryBody[]) {
  return entries.map((e) => ({
    accountCode: String(e.accountCode),
    accountName: e.accountName != null ? String(e.accountName) : undefined,
    debit: Number(e.debit ?? 0),
    credit: Number(e.credit ?? 0),
    ...(e.costCenterId ? { costCenterId: String(e.costCenterId) } : {}),
  }));
}

async function reverseTransactionInClient(
  client: Prisma.TransactionClient,
  originalId: string,
  userId: string,
): Promise<string> {
  const orig = await client.transaction.findFirst({
    where: { id: originalId, isDeleted: false },
    include: { entries: { orderBy: { lineNo: 'asc' } } },
  });
  if (!orig) throw new Error('Original journal not found');
  const ref = String(orig.reference || '').trim();
  if (!ref) throw new Error('Original journal missing reference');

  const existingRev = await client.transaction.findFirst({
    where: { reversesReference: ref, isDeleted: false },
    select: { id: true },
  });
  if (existingRev) return existingRev.id;

  const rev = await createTransaction(
    {
      date: orig.date,
      stampBusinessToday: true,
      description: `عكس قيد — ${ref}`,
      reference: `REV-${ref}`,
      reversesReference: ref,
      ...(orig.projectId ? { projectId: orig.projectId } : {}),
      ...(orig.costCenterId ? { costCenterId: orig.costCenterId } : {}),
      entries: orig.entries.map((e) => ({
        accountCode: e.accountCode,
        accountName: e.accountName ?? undefined,
        debit: roundMoney(Number(e.credit)),
        credit: roundMoney(Number(e.debit)),
        ...(e.costCenterId ? { costCenterId: e.costCenterId } : {}),
      })),
    },
    userId,
    client,
  );
  return rev.id;
}

export const bankMovementsGlRouter = Router();
bankMovementsGlRouter.use(requireAuth);
bankMovementsGlRouter.use(withIdempotency());

bankMovementsGlRouter.post(
  '/:id/post',
  writeMw,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const id = String(req.params.id);
    const journal = (req.body?.journal ?? req.body ?? {}) as JournalBody;
    const entries = Array.isArray(journal.entries) ? journal.entries : [];
    if (entries.length === 0) {
      res.status(400).json({ error: 'journal.entries required' });
      return;
    }
    const documentNo = req.body?.documentNo != null ? String(req.body.documentNo) : undefined;

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.bankMovement.findUnique({ where: { id } });
      if (!row) throw new Error('Bank movement not found');
      if (row.status === 'posted' && row.glTransactionId) {
        return row;
      }
      if (row.status !== 'draft') throw new Error(`Cannot post from status: ${row.status}`);

      const glRef = String(journal.reference || row.reference || documentNo || row.documentNo || '').trim();
      const glTx = await createTransaction(
        {
          date: String(journal.date || row.date),
          description: String(journal.description || row.descriptionAr || row.note || `حركة بنكية ${glRef}`),
          ...(glRef ? { reference: glRef } : {}),
          ...(journal.projectId ?? row.projectId
            ? { projectId: String(journal.projectId ?? row.projectId) }
            : {}),
          ...(journal.costCenterId ?? row.contractId
            ? { costCenterId: String(journal.costCenterId ?? row.contractId) }
            : {}),
          entries: mapEntries(entries),
        },
        user.id,
        tx,
      );

      return tx.bankMovement.update({
        where: { id },
        data: {
          status: 'posted',
          ...(documentNo ? { documentNo } : {}),
          postedGlReference: glRef || glTx.reference,
          glTransactionId: glTx.id,
        },
      });
    });

    res.json(serialize(updated));
  }),
);

bankMovementsGlRouter.post(
  '/:id/cancel',
  writeMw,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const id = String(req.params.id);

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.bankMovement.findUnique({ where: { id } });
      if (!row) throw new Error('Bank movement not found');
      if (row.status === 'cancelled' && row.reversalTransactionId) return row;
      if (row.status !== 'posted' || !row.glTransactionId) {
        throw new Error('Only posted movements can be cancelled');
      }

      const revId = await reverseTransactionInClient(tx, row.glTransactionId, user.id);
      return tx.bankMovement.update({
        where: { id },
        data: {
          status: 'cancelled',
          reversalTransactionId: revId,
        },
      });
    });

    res.json(serialize(updated));
  }),
);

export const bankChequesGlRouter = Router();
bankChequesGlRouter.use(requireAuth);
bankChequesGlRouter.use(withIdempotency());

bankChequesGlRouter.post(
  '/:id/issue',
  writeMw,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const id = String(req.params.id);
    const journal = (req.body?.journal ?? req.body ?? {}) as JournalBody;
    const entries = Array.isArray(journal.entries) ? journal.entries : [];
    if (entries.length === 0) {
      res.status(400).json({ error: 'journal.entries required' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.bankCheque.findUnique({ where: { id } });
      if (!row) throw new Error('Bank cheque not found');
      if (row.glIssueTransactionId) return row;
      if (row.status !== 'draft') throw new Error(`Cannot issue from status: ${row.status}`);

      const issueRef = String(journal.reference || '').trim();
      const glTx = await createTransaction(
        {
          date: String(journal.date || row.issueDate),
          description: String(journal.description || `شيك ${row.chequeNo}`),
          ...(issueRef ? { reference: issueRef } : {}),
          ...(journal.projectId ? { projectId: String(journal.projectId) } : {}),
          ...(journal.costCenterId ? { costCenterId: String(journal.costCenterId) } : {}),
          entries: mapEntries(entries),
        },
        user.id,
        tx,
      );

      const nextStatus = row.direction === 'issued' ? 'issued' : 'received';
      return tx.bankCheque.update({
        where: { id },
        data: {
          status: nextStatus,
          glIssueTransactionId: glTx.id,
          postedIssueReference: issueRef || glTx.reference,
          projectId: journal.projectId != null ? String(journal.projectId) || null : row.projectId,
          contractId: journal.costCenterId != null ? String(journal.costCenterId) || null : row.contractId,
        },
      });
    });

    res.json(serialize(updated));
  }),
);

bankChequesGlRouter.post(
  '/:id/clear',
  writeMw,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const id = String(req.params.id);
    const journal = (req.body?.journal ?? req.body ?? {}) as JournalBody;
    const entries = Array.isArray(journal.entries) ? journal.entries : [];
    if (entries.length === 0) {
      res.status(400).json({ error: 'journal.entries required' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.bankCheque.findUnique({ where: { id } });
      if (!row) throw new Error('Bank cheque not found');
      if (row.glClearTransactionId) return row;
      if (!row.glIssueTransactionId) throw new Error('Issue journal required before clear');

      const clrRef = String(journal.reference || '').trim();
      const glTx = await createTransaction(
        {
          date: String(journal.date || row.issueDate),
          description: String(journal.description || `تحصيل/صرف شيك ${row.chequeNo}`),
          ...(clrRef ? { reference: clrRef } : {}),
          ...(journal.projectId ? { projectId: String(journal.projectId) } : {}),
          ...(journal.costCenterId ? { costCenterId: String(journal.costCenterId) } : {}),
          entries: mapEntries(entries),
        },
        user.id,
        tx,
      );

      return tx.bankCheque.update({
        where: { id },
        data: {
          status: 'cleared',
          glClearTransactionId: glTx.id,
          postedClearReference: clrRef || glTx.reference,
          projectId: journal.projectId != null ? String(journal.projectId) || null : row.projectId,
          contractId: journal.costCenterId != null ? String(journal.costCenterId) || null : row.contractId,
        },
      });
    });

    res.json(serialize(updated));
  }),
);

bankChequesGlRouter.post(
  '/:id/reject',
  writeMw,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const id = String(req.params.id);

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.bankCheque.findUnique({ where: { id } });
      if (!row) throw new Error('Bank cheque not found');
      if (row.glRejectTransactionId) return row;
      if (row.glClearTransactionId) throw new Error('Cannot reject after clear');
      if (!row.glIssueTransactionId) throw new Error('Issue journal required');

      const revId = await reverseTransactionInClient(tx, row.glIssueTransactionId, user.id);
      return tx.bankCheque.update({
        where: { id },
        data: {
          status: 'rejected',
          glRejectTransactionId: revId,
        },
      });
    });

    res.json(serialize(updated));
  }),
);

bankChequesGlRouter.post(
  '/:id/cancel-issue',
  writeMw,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const id = String(req.params.id);

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.bankCheque.findUnique({ where: { id } });
      if (!row) throw new Error('Bank cheque not found');
      if (row.status === 'cancelled') return row;
      if (row.glClearTransactionId || row.glRejectTransactionId) {
        throw new Error('Not allowed after clear or reject');
      }
      if (!row.glIssueTransactionId) throw new Error('Issue journal required');

      await reverseTransactionInClient(tx, row.glIssueTransactionId, user.id);
      return tx.bankCheque.update({
        where: { id },
        data: {
          status: 'cancelled',
          glIssueTransactionId: null,
          postedIssueReference: null,
        },
      });
    });

    res.json(serialize(updated));
  }),
);
