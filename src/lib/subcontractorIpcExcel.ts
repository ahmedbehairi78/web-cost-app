/**
 * Parse subcontractor works IPC Excel (first-time structure or qty/% update).
 * Supports Book1-style Arabic headers and the app template headers.
 */
import * as XLSX from 'xlsx';
import { normalizeCompletionPct } from './ipcProgressValue';
import { roundMoney } from './money';

export type SubcontractorIpcExcelLine = {
  itemCode: string;
  description: string;
  unit: string;
  rate: number;
  tenderQty: number;
  previousQty: number;
  currentQty: number;
  completionPct: number;
  villaNo?: string;
  notes?: string;
};

function cellStr(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim() !== '') return String(row[k]).trim();
  }
  return '';
}

function cellNum(row: Record<string, unknown>, ...keys: string[]): number {
  for (const k of keys) {
    if (row[k] == null || String(row[k]).trim() === '') continue;
    const raw = String(row[k]).replace(/%/g, '').replace(/,/g, '').replace(/EGP/gi, '').trim();
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

/** Flatten multi-row header sheets (Book1) into objects keyed by normalized Arabic/English labels. */
export function sheetRowsToObjects(ws: XLSX.WorkSheet): Record<string, unknown>[] {
  const aoa = XLSX.utils.sheet_to_json<(string | number | null | undefined)[]>(ws, {
    header: 1,
    defval: '',
    raw: false,
  });
  if (!aoa.length) return [];

  // Find header row containing وصف or Description
  let headerIdx = -1;
  for (let i = 0; i < Math.min(aoa.length, 12); i++) {
    const row = aoa[i] ?? [];
    const joined = row.map((c) => String(c ?? '')).join('|');
    if (/وصف|Description|البيان/i.test(joined)) {
      headerIdx = i;
      break;
    }
  }

  // Book1 has a two-row header: titles then unit/rate/qty sub-headers
  if (headerIdx >= 0) {
    const top = (aoa[headerIdx] ?? []).map((c) => String(c ?? '').trim());
    const sub = (aoa[headerIdx + 1] ?? []).map((c) => String(c ?? '').trim());
    const keys: string[] = [];
    for (let c = 0; c < Math.max(top.length, sub.length); c++) {
      const a = top[c] || '';
      const b = sub[c] || '';
      if (a && b) keys[c] = `${a}|${b}`;
      else keys[c] = a || b || `col${c}`;
    }
    const dataStart = headerIdx + (sub.some(Boolean) ? 2 : 1);
    const out: Record<string, unknown>[] = [];
    for (let r = dataStart; r < aoa.length; r++) {
      const row = aoa[r] ?? [];
      const desc = String(row[1] ?? row[0] ?? '').trim();
      const code = String(row[0] ?? '').trim();
      if (!desc && !code) continue;
      if (/^الاجمالي|^إجمالي|^total/i.test(desc)) continue;
      const obj: Record<string, unknown> = {};
      keys.forEach((k, i) => {
        obj[k] = row[i] ?? '';
      });
      // Also expose common aliases
      obj['رقم البند'] = code || obj['رقم البند'];
      obj['وصف البند'] = desc || obj['وصف البند'];
      obj['Item Code'] = code;
      obj['Description'] = desc;
      out.push(obj);
    }
    return out;
  }

  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
}

function pickUnit(row: Record<string, unknown>): string {
  return cellStr(
    row,
    'الوحدة',
    'Unit',
    'العقد|الوحدة',
    'الكميات |الوحدة',
  );
}

function pickRate(row: Record<string, unknown>): number {
  const n = cellNum(
    row,
    'الفئة',
    'Rate',
    'العقد|الفئة',
    'العقد|الفئة ',
    'الكميات |الفئة',
  );
  return Number.isFinite(n) ? n : 0;
}

function pickTenderQty(row: Record<string, unknown>): number {
  const n = cellNum(
    row,
    'الكمية',
    'Tender Qty',
    'Qty',
    'العقد|الكمية',
    'الكميات |الكمية',
  );
  return Number.isFinite(n) ? n : 0;
}

function pickPrevQty(row: Record<string, unknown>): number {
  const n = cellNum(row, 'السابق', 'Prev Qty', 'الكمية السابقة', 'الكميات |السابق');
  return Number.isFinite(n) ? n : 0;
}

function pickCurrQty(row: Record<string, unknown>): number {
  const n = cellNum(row, 'الحالي', 'Curr Qty', 'الكمية الحالية', 'الكميات |الحالي');
  return Number.isFinite(n) ? n : 0;
}

function pickPct(row: Record<string, unknown>): number {
  // Prefer explicit completion column over amount columns
  for (const [k, v] of Object.entries(row)) {
    if (/نسبة|Comp|انجاز|إنجاز/i.test(k) && !/اجمالي|Amount|قيمة/i.test(k)) {
      const n = normalizeCompletionPct(String(v).replace(/%/g, ''), NaN);
      if (Number.isFinite(n)) return n;
    }
  }
  return NaN;
}

export function parseSubcontractorIpcExcelRows(
  rows: Record<string, unknown>[],
): SubcontractorIpcExcelLine[] {
  const out: SubcontractorIpcExcelLine[] = [];
  let auto = 1;
  for (const row of rows) {
    const description = cellStr(row, 'وصف البند', 'البيان', 'Description', 'Desc');
    if (!description) continue;
    const itemCode =
      cellStr(row, 'رقم البند', 'كود البند', 'Item Code', 'Code') || String(auto);
    const unit = pickUnit(row) || 'م';
    const rate = pickRate(row);
    const tenderQty = pickTenderQty(row);
    const previousQty = pickPrevQty(row);
    let currentQty = pickCurrQty(row);
    if (!Number.isFinite(currentQty)) currentQty = 0;
    let completionPct = pickPct(row);
    if (!Number.isFinite(completionPct)) {
      // If total amount column present, derive pct from amount / (qty×rate)
      const amount = cellNum(row, 'الاجمالي', 'الإجمالي', 'Amount', 'القيمة');
      const qtyForPct = (previousQty || 0) + (currentQty || 0) || tenderQty;
      if (Number.isFinite(amount) && qtyForPct > 0 && rate > 0) {
        completionPct = normalizeCompletionPct((amount / (qtyForPct * rate)) * 100, 100);
      } else {
        completionPct = 100;
      }
    }
    out.push({
      itemCode: String(itemCode),
      description,
      unit,
      rate: roundMoney(rate),
      tenderQty: Number.isFinite(tenderQty) ? tenderQty : 0,
      previousQty: Number.isFinite(previousQty) ? previousQty : 0,
      currentQty,
      completionPct: normalizeCompletionPct(completionPct, 100),
      villaNo: cellStr(row, 'رقم الفيلا', 'Villa') || undefined,
      notes: cellStr(row, 'الملاحظات', 'Notes') || undefined,
    });
    auto += 1;
  }
  return out;
}

export function parseSubcontractorIpcExcelBuffer(data: ArrayBuffer | string): SubcontractorIpcExcelLine[] {
  const wb =
    typeof data === 'string'
      ? XLSX.read(data, { type: 'binary' })
      : XLSX.read(data, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  return parseSubcontractorIpcExcelRows(sheetRowsToObjects(ws));
}

export function buildSubcontractorIpcTemplateAoa(isAr: boolean, lines: SubcontractorIpcExcelLine[] = []): (string | number)[][] {
  const headers = isAr
    ? ['كود البند', 'البيان', 'الوحدة', 'كمية العقد', 'الفئة', 'الكمية السابقة', 'الكمية الحالية', 'نسبة الإنجاز %', 'كود بند العميل']
    : ['Item Code', 'Description', 'Unit', 'Tender Qty', 'Rate', 'Prev Qty', 'Curr Qty', 'Comp %', 'Client BOQ Code'];
  const rows = lines.map((l) => [
    l.itemCode,
    l.description,
    l.unit,
    l.tenderQty,
    l.rate,
    l.previousQty,
    l.currentQty,
    l.completionPct,
    '',
  ]);
  return [headers, ...rows];
}
