import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { roundMoney } from './money.js';
import { syncVariationOrderRegistry } from './documentRegistrySync.js';
import { syncBoqContractAndProjectTotals } from './boqTotalsSync.js';

function num(v: unknown): number {
  return Number(v ?? 0);
}

/** Stable error codes → Arabic messages for API 400 responses. */
export const VO_APPROVE_ERROR_MESSAGES: Record<string, string> = {
  invalid_new_item_line:
    'بند جديد غير مكتمل: الكمية يجب أن تكون أكبر من صفر والسعر ≥ 0. احذف البنود الفارغة أو أكملها ثم أعد الإرسال.',
  new_item_requires_code_description_unit: 'بند جديد يتطلب كود البند والوصف والوحدة.',
  boq_item_required: 'تعديل/حذف بند يتطلب اختيار بند BOQ.',
  boq_item_not_found: 'بند BOQ غير موجود أو محذوف.',
  boq_contract_mismatch: 'بند BOQ لا ينتمي لنفس العقد.',
  invalid_adjust_values: 'قيم التعديل غير صالحة (الكمية والسعر ≥ 0).',
  adjust_no_change: 'تعديل البند لا يغيّر الكمية ولا السعر.',
  vo_requires_lines: 'أمر التغيير لا يحتوي على بنود.',
  'Not found': 'أمر التغيير غير موجود.',
};

export function mapVoApproveError(err: unknown): { status: number; error: string } {
  const code = err instanceof Error ? err.message : 'approve_failed';
  if (code.startsWith('Cannot approve variation order in status:')) {
    return { status: 400, error: code };
  }
  if (code.startsWith('unknown_line_type:')) {
    return { status: 400, error: `نوع بند غير معروف: ${code.slice('unknown_line_type:'.length)}` };
  }
  const mapped = VO_APPROVE_ERROR_MESSAGES[code];
  if (mapped) return { status: 400, error: mapped };
  return { status: 500, error: code || 'approve_failed' };
}

type VoLine = Prisma.VariationOrderLineGetPayload<Record<string, never>>;

async function applyVoLine(client: Prisma.TransactionClient, order: { projectId: string; contractId: string }, line: VoLine): Promise<void> {
  if (line.lineType === 'new_item') {
    const qty = num(line.tenderQty);
    const rate = num(line.unitRateTotal);
    if (!Number.isFinite(qty) || !Number.isFinite(rate) || qty <= 0 || rate < 0) {
      throw new Error('invalid_new_item_line');
    }
    if (!line.itemCode?.trim() || !line.description?.trim() || !line.unit?.trim()) {
      throw new Error('new_item_requires_code_description_unit');
    }

    const amount = roundMoney(qty * rate);
    const boqId = randomUUID();
    await client.boqItem.create({
      data: {
        id: boqId,
        projectId: order.projectId,
        contractId: order.contractId,
        itemCode: line.itemCode.trim(),
        description: line.description.trim(),
        unit: line.unit.trim(),
        chapterCode: line.chapterCode?.trim() || null,
        chapterName: line.chapterName?.trim() || null,
        workTypeCode: line.workTypeCode?.trim() || null,
        sectionCode: line.sectionCode?.trim() || null,
        sectionName: line.sectionName?.trim() || null,
        tenderQty: qty,
        unitRateTotal: rate,
        tenderAmount: amount,
      },
    });
    await client.variationOrderLine.update({
      where: { id: line.id },
      data: { createdBoqItemId: boqId },
    });
    return;
  }

  if (!line.boqItemId) throw new Error('boq_item_required');

  const boq = await client.boqItem.findUnique({ where: { id: line.boqItemId } });
  if (!boq || boq.isDeleted) throw new Error('boq_item_not_found');
  if (boq.contractId !== order.contractId) throw new Error('boq_contract_mismatch');

  if (line.lineType === 'delete_item') {
    await client.boqItem.update({
      where: { id: line.boqItemId },
      data: { isDeleted: true },
    });
    return;
  }

  if (line.lineType === 'adjust') {
    const oldQty = num(boq.tenderQty);
    const oldRate = num(boq.unitRateTotal);
    const newQty = line.newTenderQty != null ? num(line.newTenderQty) : oldQty;
    const newRate = line.newUnitRate != null ? num(line.newUnitRate) : oldRate;
    if (newQty < 0 || newRate < 0) throw new Error('invalid_adjust_values');
    if (newQty === oldQty && newRate === oldRate) throw new Error('adjust_no_change');

    const newAmount = roundMoney(newQty * newRate);
    await client.boqItem.update({
      where: { id: line.boqItemId },
      data: {
        tenderQty: newQty,
        unitRateTotal: newRate,
        tenderAmount: newAmount,
      },
    });
    return;
  }

  throw new Error(`unknown_line_type:${line.lineType}`);
}

export async function approveVariationOrder(
  orderId: string,
  userId: string | undefined,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const run = async (client: Prisma.TransactionClient) => {
    const order = await client.variationOrder.findUnique({
      where: { id: orderId },
      include: { lines: true },
    });
    if (!order) throw new Error('Not found');
    if (order.status !== 'submitted') {
      throw new Error(`Cannot approve variation order in status: ${order.status}`);
    }
    if (order.lines.length === 0) throw new Error('vo_requires_lines');

    const totalValue = roundMoney(num(order.totalValue));

    for (const line of order.lines) {
      await applyVoLine(client, order, line);
    }

    await syncBoqContractAndProjectTotals(client, order.projectId, order.contractId);

    if (totalValue !== 0) {
      await client.project.update({
        where: { id: order.projectId },
        data: { voValue: { increment: totalValue } },
      });
    }

    await client.variationOrder.update({
      where: { id: orderId },
      data: { status: 'approved', approvedBy: userId ?? null },
    });
  };

  if (tx) {
    await run(tx);
    return;
  }
  await prisma.$transaction(run);
  await syncVariationOrderRegistry(orderId);
}
