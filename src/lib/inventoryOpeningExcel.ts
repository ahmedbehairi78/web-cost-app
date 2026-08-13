import * as XLSX from 'xlsx';
import { cleanExcelText } from './materialsTreeExcel';

export type OpeningInventoryImportRow = {
  materialCategoryCode: string;
  quantity: number;
  avgUnitCost: number;
  materialCategoryName?: string;
  unit?: string;
};

export type OpeningImportParseResult = {
  rows: OpeningInventoryImportRow[];
  /** True when the sheet is the materials-tree workbook (balances must not be imported from it). */
  isMaterialsTreeFile: boolean;
};

const COL = {
  /** Never include bare `Code` — warehouse-tree v2 uses that for group English name. */
  materialCategoryCode: [
    'كود الصنف',
    'Category Code',
    'material_category_code',
    'materialCategoryCode',
  ],
  materialCategoryName: [
    'اسم الصنف',
    'Category Name',
    'material_category_name',
    'materialCategoryName',
  ],
  unit: ['الوحدة', 'Unit', 'unit'],
  quantity: ['الكمية', 'Quantity', 'quantity', 'qty'],
  avgUnitCost: [
    'متوسط التكلفة',
    'Avg Unit Cost',
    'avg_unit_cost',
    'avgUnitCost',
    'unit_cost',
    'unitCost',
  ],
} as const;

function normalizeRowKeys(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const key = cleanExcelText(k);
    if (!key) continue;
    out[key] = v;
  }
  return out;
}

function headerSet(keys: string[]): Set<string> {
  return new Set(keys.map((k) => cleanExcelText(k).toLowerCase()).filter(Boolean));
}

export function sheetLooksLikeMaterialsTree(keys: string[]): boolean {
  const n = headerSet(keys);
  const hasGroup = n.has('كود المجموعة') || n.has('group code');
  const hasBalance = n.has('الرصيد') || n.has('balance');
  const hasQty = n.has('الكمية') || n.has('quantity');
  const hasCost = n.has('متوسط التكلفة') || n.has('avg unit cost');
  return hasGroup && hasBalance && !hasQty && !hasCost;
}

function cell(row: Record<string, unknown>, keys: readonly string[]): string {
  const aliases = new Map(keys.map((k) => [k.toLowerCase(), k]));
  for (const [rawKey, v] of Object.entries(row)) {
    if (!aliases.has(rawKey.toLowerCase())) continue;
    const text = cleanExcelText(v);
    if (text) return text;
  }
  return '';
}

function cellNumber(row: Record<string, unknown>, keys: readonly string[]): number | null {
  const aliases = new Set(keys.map((k) => k.toLowerCase()));
  for (const [rawKey, v] of Object.entries(row)) {
    if (!aliases.has(rawKey.toLowerCase())) continue;
    if (v == null || String(v).trim() === '') continue;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    const n = Number(String(v).replace(/,/g, '').trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function exportOpeningInventoryTemplate(language: 'ar' | 'en') {
  const ar = language === 'ar';
  const rows = ar
    ? [
        {
          'كود الصنف': 'MTL-01-001',
          'اسم الصنف': 'أسمنت (اختياري)',
          الوحدة: 'طن',
          الكمية: 10,
          'متوسط التكلفة': 2500,
        },
      ]
    : [
        {
          'Category Code': 'MTL-01-001',
          'Category Name': 'Cement (optional)',
          Unit: 'ton',
          Quantity: 10,
          'Avg Unit Cost': 2500,
        },
      ];
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Opening');
  XLSX.writeFile(wb, ar ? 'قالب_أرصدة_مخزون_افتتاحية.xlsx' : 'Opening_Inventory_Balances_Template.xlsx');
}

function readFirstSheet(input: ArrayBuffer | Uint8Array): XLSX.WorkSheet | null {
  const data =
    input instanceof Uint8Array
      ? input
      : input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : new Uint8Array(input as ArrayBuffer);
  const wb = XLSX.read(data, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return null;
  return wb.Sheets[sheetName] ?? null;
}

export function parseOpeningInventoryFile(input: ArrayBuffer | Uint8Array): OpeningInventoryImportRow[] {
  return parseOpeningInventoryWorkbook(input).rows;
}

export function parseOpeningInventoryWorkbook(input: ArrayBuffer | Uint8Array): OpeningImportParseResult {
  const ws = readFirstSheet(input);
  if (!ws) return { rows: [], isMaterialsTreeFile: false };
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  const firstKeys = raw[0] ? Object.keys(raw[0]) : [];
  if (sheetLooksLikeMaterialsTree(firstKeys)) {
    return { rows: [], isMaterialsTreeFile: true };
  }

  const out: OpeningInventoryImportRow[] = [];
  for (const rawRow of raw) {
    const row = normalizeRowKeys(rawRow);
    const materialCategoryCode = cell(row, COL.materialCategoryCode);
    if (!materialCategoryCode) continue;
    const quantity = cellNumber(row, COL.quantity);
    const avgUnitCost = cellNumber(row, COL.avgUnitCost);
    if (quantity == null || quantity <= 0) continue;
    if (avgUnitCost == null || !Number.isFinite(avgUnitCost) || avgUnitCost < 0) continue;
    const materialCategoryName = cell(row, COL.materialCategoryName) || undefined;
    const unit = cell(row, COL.unit) || undefined;
    out.push({
      materialCategoryCode,
      quantity,
      avgUnitCost,
      ...(materialCategoryName ? { materialCategoryName } : {}),
      ...(unit ? { unit } : {}),
    });
  }
  return { rows: out, isMaterialsTreeFile: false };
}
