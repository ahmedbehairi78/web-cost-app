import type { VariationOrder, VariationOrderLine } from '../types';

export type VoPrintLine = {
  lineTypeLabel: string;
  description: string;
  detail: string;
  lineAmount: number;
};

export type VoPrintData = {
  voNumber: string;
  voDate: string;
  title: string;
  statusLabel: string;
  notes?: string;
  projectName?: string;
  contractName?: string;
  totalValue: number;
  lines: VoPrintLine[];
};

export function voPrintTitle(data: VoPrintData, language: 'ar' | 'en'): string {
  return language === 'ar' ? `أمر تغيير — ${data.voNumber}` : `Variation Order — ${data.voNumber}`;
}

function lineDescription(line: VariationOrderLine): string {
  if (line.lineType === 'new_item') {
    return [line.itemCode, line.description].filter(Boolean).join(' — ') || '—';
  }
  return [line.boqItemCode ?? line.boqItemId, line.boqItemDescription].filter(Boolean).join(' — ') || '—';
}

function lineDetail(line: VariationOrderLine, formatMoney: (n: number) => string): string {
  if (line.lineType === 'new_item') {
    const qty = Number(line.tenderQty ?? 0);
    const rate = Number(line.unitRateTotal ?? 0);
    return `${qty} × ${formatMoney(rate)}`;
  }
  if (line.lineType === 'delete_item') {
    const qty = line.boqTenderQty ?? 0;
    const rate = line.boqUnitRate ?? 0;
    return `${qty} × ${formatMoney(rate)}`;
  }
  const oldQty = line.boqTenderQty ?? 0;
  const oldRate = line.boqUnitRate ?? 0;
  const newQty = line.newTenderQty ?? oldQty;
  const newRate = line.newUnitRate ?? oldRate;
  return `${oldQty}×${formatMoney(oldRate)} → ${newQty}×${formatMoney(newRate)}`;
}

export function buildVoPrintData(input: {
  order: VariationOrder;
  projectName?: string;
  contractName?: string;
  statusLabel: string;
  lineTypeLabel: (type: VariationOrderLine['lineType']) => string;
  formatMoney: (n: number) => string;
}): VoPrintData {
  const { order, projectName, contractName, statusLabel, lineTypeLabel, formatMoney } = input;
  return {
    voNumber: order.voNumber,
    voDate: order.voDate ?? '—',
    title: order.title?.trim() || '—',
    statusLabel,
    notes: order.notes?.trim() || undefined,
    projectName,
    contractName,
    totalValue: Number(order.totalValue),
    lines: (order.lines ?? []).map((line) => ({
      lineTypeLabel: lineTypeLabel(line.lineType),
      description: lineDescription(line),
      detail: lineDetail(line, formatMoney),
      lineAmount: Number(line.lineAmount),
    })),
  };
}
