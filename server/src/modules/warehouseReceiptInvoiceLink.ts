import { roundMoney } from '../lib/money.js';

export const WR_INVOICE_QTY_EPS = 0.01;

export type ReceiptLineMatchInput = {
  id: number;
  materialCategoryId: number;
  quantity: number;
};

export type InvoiceLineMatchInput = {
  materialCategoryId?: number;
  quantity: number;
  unitCost: number;
};

export type MatchedReceiptInvoiceLine = {
  receiptLineId: number;
  materialCategoryId: number;
  quantity: number;
  unitCostExVat: number;
};

/**
 * Match each warehouse-receipt line to one unused invoice line (same material + qty).
 * Throws an Error with an Arabic message when lines do not match.
 */
export function matchReceiptLinesToInvoiceLines(
  receiptNumber: string,
  receiptLines: ReceiptLineMatchInput[],
  invoiceLines: InvoiceLineMatchInput[],
): MatchedReceiptInvoiceLine[] {
  const pool = invoiceLines.map((l, index) => ({
    index,
    materialCategoryId: Number(l.materialCategoryId),
    quantity: Number(l.quantity),
    unitCost: Number(l.unitCost),
    used: false,
  }));

  const matched: MatchedReceiptInvoiceLine[] = [];

  for (const line of receiptLines) {
    const matId = Number(line.materialCategoryId);
    const qty = Number(line.quantity);
    const match = pool.find(
      (p) =>
        !p.used
        && Number.isFinite(p.materialCategoryId)
        && p.materialCategoryId === matId
        && Math.abs(p.quantity - qty) <= WR_INVOICE_QTY_EPS,
    );
    if (!match) {
      throw new Error(
        `بنود الفاتورة يجب أن تطابق أصناف وكميات الاستلام ${receiptNumber} (صنف ${matId} كمية ${qty})`,
      );
    }
    match.used = true;
    if (!Number.isFinite(match.unitCost) || match.unitCost < 0) {
      throw new Error(`سعر وحدة غير صالح للصنف ${matId}`);
    }
    matched.push({
      receiptLineId: line.id,
      materialCategoryId: matId,
      quantity: qty,
      unitCostExVat: match.unitCost,
    });
  }

  const unused = pool.filter(
    (p) => !p.used && Number.isFinite(p.materialCategoryId) && p.materialCategoryId > 0,
  );
  if (unused.length > 0) {
    throw new Error(`بنود فاتورة إضافية غير موجودة في الاستلام ${receiptNumber}`);
  }

  return matched;
}

export function receiptLineTotalExVat(quantity: number, unitCostExVat: number): number {
  return roundMoney(quantity * unitCostExVat);
}
