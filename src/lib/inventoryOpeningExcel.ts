import * as XLSX from 'xlsx';

export type OpeningInventoryImportRow = {
  materialCategoryCode: string;
  quantity: number;
  avgUnitCost: number;
  /** Optional display-only fields from template */
  materialCategoryName?: string;
  unit?: string;
};

const COL = {
  materialCategoryCode: [
    'Category Code',
    'كود الصنف',
    'material_category_code',
    'materialCategoryCode',
    'code',
  ],
  materialCategoryName: [
    'Category Name',
    'اسم الصنف',
    'material_category_name',
    'materialCategoryName',
    'name',
  ],
  unit: ['Unit', 'الوحدة', 'unit'],
  quantity: ['Quantity', 'الكمية', 'quantity', 'qty'],
  avgUnitCost: [
    'Avg Unit Cost',
    'متوسط التكلفة',
    'avg_unit_cost',
    'avgUnitCost',
    'unit_cost',
    'unitCost',
  ],
} as const;

function cell(row: Record<string, unknown>, keys: readonly string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function cellNumber(row: Record<string, unknown>, keys: readonly string[]): number {
  for (const k of keys) {
    const v = row[k];
    if (v == null || String(v).trim() === '') continue;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    const n = Number(String(v).replace(/,/g, '').trim());
    if (Number.isFinite(n)) return n;
  }
  return NaN;
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

export function parseOpeningInventoryFile(input: ArrayBuffer | Uint8Array): OpeningInventoryImportRow[] {
  const data =
    input instanceof Uint8Array
      ? input
      : input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : new Uint8Array(input as ArrayBuffer);
  const wb = XLSX.read(data, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  const out: OpeningInventoryImportRow[] = [];
  for (const row of raw) {
    const materialCategoryCode = cell(row, COL.materialCategoryCode);
    if (!materialCategoryCode) continue;
    const quantity = cellNumber(row, COL.quantity);
    const avgUnitCost = cellNumber(row, COL.avgUnitCost);
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
  return out;
}
