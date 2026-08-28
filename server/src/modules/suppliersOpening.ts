import { Router } from 'express';
import { requireAuth, requireModuleWrite } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../db.js';
import { AccountCodes } from '../accounting/accountCodes.js';
import { ensureMissingCoaAccounts } from '../accounting/ensureCoaSeed.js';
import {
  buildOpeningCreditorsReference,
  isReservedControlPayableCode,
  nextPayableLeafCode,
  parentForPartyType,
  postOpeningCreditorsJournal,
  type OpeningCreditorLine,
} from '../accounting/openingCreditorsJournal.js';
import { MONEY_TOLERANCE, roundMoney } from '../lib/money.js';

type PartyType = 'supplier' | 'subcontractor';

type ImportRow = {
  type?: string;
  name?: string;
  nameEn?: string;
  taxNumber?: string;
  phone?: string;
  address?: string;
  accountCode?: string;
  openingBalance?: number;
};

export const suppliersOpeningRouter = Router();
suppliersOpeningRouter.use(requireAuth);

function isPartyType(value: string): value is PartyType {
  return value === 'supplier' || value === 'subcontractor';
}

function rowLabel(index: number, name: string): string {
  return `صف ${index + 1}${name ? ` (${name})` : ''}`;
}

suppliersOpeningRouter.post(
  '/opening-import',
  requireModuleWrite('suppliers', 'costs', 'ledger'),
  asyncHandler(async (req, res) => {
    const body = req.body as { date?: string; rows?: ImportRow[] };
    const date = String(body.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      return;
    }
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0) {
      res.status(400).json({ error: 'rows array is required' });
      return;
    }

    await ensureMissingCoaAccounts({
      codes: [
        '211',
        '21101',
        '21102',
        AccountCodes.SUPPLIERS,
        AccountCodes.SUBCONTRACTORS,
        '314',
        '31401',
        AccountCodes.PARTNERS_CURRENT,
      ],
    });

    const result = await prisma.$transaction(
      async (tx) => {
        let created = 0;
        let skipped = 0;
        let openingPosted = 0;
        let openingSkipped = 0;
        const errors: string[] = [];
        const openingLines: OpeningCreditorLine[] = [];
        const allocatedCodes: string[] = [];
        const seenKeys = new Set<string>();

        const allLeaves = await tx.chartOfAccount.findMany({
          select: { accountCode: true },
        });
        const codesByParent: Record<'21101' | '21102', string[]> = {
          '21101': allLeaves.map((a) => a.accountCode).filter((c) => c.length === 8 && c.startsWith('21101')),
          '21102': allLeaves.map((a) => a.accountCode).filter((c) => c.length === 8 && c.startsWith('21102')),
        };

        for (let i = 0; i < rows.length; i++) {
          const raw = rows[i];
          const typeRaw = String(raw.type || '').trim();
          const name = String(raw.name || '').trim();
          const nameEn = String(raw.nameEn || '').trim() || null;
          const taxNumber = String(raw.taxNumber || '').trim() || null;
          const phone = String(raw.phone || '').trim() || null;
          const address = String(raw.address || '').trim() || null;
          const requestedCode = String(raw.accountCode || '').replace(/\s+/g, '');
          const openingBalance = roundMoney(Number(raw.openingBalance) || 0);
          const label = rowLabel(i, name);

          if (!isPartyType(typeRaw)) {
            errors.push(`${label}: النوع يجب أن يكون supplier أو subcontractor`);
            continue;
          }
          if (!name) {
            errors.push(`${label}: الاسم مطلوب`);
            continue;
          }

          const parent = parentForPartyType(typeRaw);
          const dupKey = `${typeRaw}:${name.toLowerCase()}`;
          if (seenKeys.has(dupKey)) {
            skipped += 1;
            continue;
          }
          seenKeys.add(dupKey);

          let supplier = await tx.supplier.findFirst({
            where: { isDeleted: false, type: typeRaw, name: { equals: name, mode: 'insensitive' } },
          });

          if (!supplier) {
            supplier = await tx.supplier.create({
              data: { name, nameEn, type: typeRaw, taxNumber, phone, address },
            });
            created += 1;
          } else {
            skipped += 1;
          }

          const linked = await tx.chartOfAccount.findMany({
            where: { supplierId: supplier.id, isGroup: false },
            select: { id: true, accountCode: true },
          });
          const linkedLeaf = linked.find((a) => a.accountCode.length === 8 && a.accountCode.startsWith(parent));

          let accountCode = '';
          if (requestedCode) {
            if (!/^\d{8}$/.test(requestedCode) || !requestedCode.startsWith(parent)) {
              errors.push(`${label}: كود الحساب يجب أن يكون 8 أرقام تحت ${parent}`);
              continue;
            }
            if (isReservedControlPayableCode(requestedCode)) {
              errors.push(`${label}: لا تستخدم الحساب العام ${requestedCode}`);
              continue;
            }
            const existingAcc = await tx.chartOfAccount.findUnique({
              where: { accountCode: requestedCode },
            });
            if (existingAcc) {
              if (existingAcc.supplierId && existingAcc.supplierId !== supplier.id) {
                errors.push(`${label}: كود ${requestedCode} مربوط بجهة أخرى`);
                continue;
              }
              if (existingAcc.isGroup) {
                errors.push(`${label}: ${requestedCode} حساب مجموعة وليس ورقة`);
                continue;
              }
              if (!existingAcc.supplierId) {
                await tx.chartOfAccount.update({
                  where: { id: existingAcc.id },
                  data: { supplierId: supplier.id, accountName: name, accountNameEn: nameEn },
                });
              }
              accountCode = requestedCode;
            } else {
              await tx.chartOfAccount.create({
                data: {
                  accountCode: requestedCode,
                  accountName: name,
                  accountNameEn: nameEn,
                  parentCode: parent,
                  type: 'liability',
                  isGroup: false,
                  status: 'active',
                  supplierId: supplier.id,
                },
              });
              accountCode = requestedCode;
              codesByParent[parent].push(requestedCode);
              allocatedCodes.push(requestedCode);
            }
          } else if (linkedLeaf) {
            accountCode = linkedLeaf.accountCode;
          } else {
            const next = nextPayableLeafCode([...codesByParent[parent], ...allocatedCodes], parent);
            if (isReservedControlPayableCode(next)) {
              errors.push(`${label}: تعذر توليد كود حساب`);
              continue;
            }
            await tx.chartOfAccount.create({
              data: {
                accountCode: next,
                accountName: name,
                accountNameEn: nameEn,
                parentCode: parent,
                type: 'liability',
                isGroup: false,
                status: 'active',
                supplierId: supplier.id,
              },
            });
            accountCode = next;
            codesByParent[parent].push(next);
            allocatedCodes.push(next);
          }

          if (Math.abs(openingBalance) < MONEY_TOLERANCE) {
            openingSkipped += 1;
            continue;
          }

          const glHit = await tx.journalEntry.findFirst({
            where: { accountCode, transaction: { isDeleted: false } },
            select: { id: true },
          });
          if (glHit) {
            openingSkipped += 1;
            continue;
          }

          openingLines.push({ accountCode, accountName: name, amount: openingBalance });
          openingPosted += 1;
        }

        const out: {
          created: number;
          skipped: number;
          openingPosted: number;
          openingSkipped: number;
          errors: string[];
          transactionId?: string;
          reference?: string;
          totalAmount?: number;
        } = { created, skipped, openingPosted, openingSkipped, errors };

        if (openingLines.length > 0) {
          const reference = buildOpeningCreditorsReference();
          const transactionId = await postOpeningCreditorsJournal(tx, {
            date,
            reference,
            lines: openingLines,
            userId: req.user?.id,
          });
          out.transactionId = transactionId;
          out.reference = reference;
          out.totalAmount = roundMoney(openingLines.reduce((s, line) => s + Math.abs(line.amount), 0));
        }

        return out;
      },
      { timeout: 120_000, maxWait: 15_000 },
    );

    res.json(result);
  }),
);
