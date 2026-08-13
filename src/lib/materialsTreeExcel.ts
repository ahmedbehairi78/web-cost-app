import * as XLSX from 'xlsx';
import type { MaterialCategory, MaterialGroup } from '../services/local/modulesApi';

export type MaterialsImportRow = {
  groupCode: string;
  groupName: string;
  groupNameEn?: string;
  categoryCode?: string;
  categoryName?: string;
  unit?: string;
};

/** Warehouse-tree headers (matches شجرة أصناف مخزن مقاولات v2). */
export const MATERIALS_TREE_HEADERS_AR = [
  'كود المجموعة',
  'Code',
  'اسم المجموعة',
  'كود الصنف',
  'اسم الصنف',
  'الوحدة',
  'الرصيد',
] as const;

export const MATERIALS_TREE_HEADERS_EN = [
  'Group Code',
  'Group Name EN',
  'Group Name',
  'Category Code',
  'Category Name',
  'Unit',
  'Balance',
] as const;

const COL = {
  groupCode: ['كود المجموعة', 'Group Code', 'group_code', 'groupCode'],
  /** English group title in v2 files is the column literally named `Code` — never treat it as group code. */
  groupNameEn: ['Code', 'Group Name EN', 'Group Name (EN)', 'اسم المجموعة إنجليزي', 'groupNameEn', 'group_name_en'],
  groupName: ['اسم المجموعة', 'Group Name', 'group_name', 'groupName'],
  categoryCode: ['كود الصنف', 'Category Code', 'category_code', 'categoryCode'],
  categoryName: ['اسم الصنف', 'Category Name', 'category_name', 'categoryName'],
  unit: ['الوحدة', 'Unit', 'unit'],
} as const;

export function cleanExcelText(value: unknown): string {
  if (value == null) return '';
  return String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cell(row: Record<string, unknown>, keys: readonly string[]): string {
  for (const k of keys) {
    const v = cleanExcelText(row[k]);
    if (v) return v;
  }
  return '';
}

function exportRow(
  g: Pick<MaterialGroup, 'code' | 'name' | 'nameEn'>,
  c?: Pick<MaterialCategory, 'code' | 'name' | 'unit'>,
): Record<string, string | number> {
  return {
    'كود المجموعة': g.code,
    Code: g.nameEn?.trim() || '',
    'اسم المجموعة': g.name,
    'كود الصنف': c?.code ?? '',
    'اسم الصنف': c?.name ?? '',
    الوحدة: c?.unit ?? '',
    الرصيد: '',
  };
}

export function buildMaterialsExportRows(
  groups: MaterialGroup[],
  categories: MaterialCategory[],
): Record<string, string | number>[] {
  const rows: Record<string, string | number>[] = [];
  const catsByGroup = new Map<number, MaterialCategory[]>();
  for (const c of categories) {
    const list = catsByGroup.get(c.groupId) ?? [];
    list.push(c);
    catsByGroup.set(c.groupId, list);
  }

  for (const g of groups) {
    const cats = catsByGroup.get(g.id) ?? [];
    if (cats.length === 0) {
      rows.push(exportRow(g));
      continue;
    }
    for (const c of cats) {
      rows.push(exportRow(g, c));
    }
  }
  return rows;
}

function sheetWithHeaders(
  headers: readonly string[],
  rows: Record<string, string | number>[],
): XLSX.WorkSheet {
  const aoa: (string | number)[][] = [ [...headers] ];
  for (const row of rows) {
    aoa.push(headers.map((h) => row[h] ?? ''));
  }
  return XLSX.utils.aoa_to_sheet(aoa);
}

export function exportMaterialsTreeExcel(
  groups: MaterialGroup[],
  categories: MaterialCategory[],
  filenamePrefix = 'Materials_Tree',
) {
  const rows = buildMaterialsExportRows(groups, categories);
  const ws = sheetWithHeaders(MATERIALS_TREE_HEADERS_AR, rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Materials');
  XLSX.writeFile(wb, `${filenamePrefix}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function exportMaterialsTreeTemplate(language: 'ar' | 'en') {
  const ar = language === 'ar';
  const rows = [
    exportRow(
      { code: 'BLK', name: 'بناء', nameEn: 'Block / Building' },
      { code: 'BLK-001', name: ar ? 'اسمنت العرب' : 'Al Arab cement', unit: 'شيكارة' },
    ),
    exportRow(
      { code: 'BLK', name: 'بناء', nameEn: 'Block / Building' },
      { code: 'BLK-002', name: ar ? 'خرسانه العرب' : 'Al Arab concrete', unit: 'م3' },
    ),
    exportRow(
      { code: 'ELW', name: 'أسلاك كهرباء', nameEn: 'Electrical Wire' },
      { code: 'ELW-001', name: ar ? 'سلك كهرباء 2.5 مم' : 'Electric cable 2.5mm', unit: 'متر' },
    ),
  ];
  const headers = ar ? MATERIALS_TREE_HEADERS_AR : MATERIALS_TREE_HEADERS_EN;
  const mapped = rows.map((row) => {
    if (ar) return row;
    return {
      'Group Code': row['كود المجموعة'],
      'Group Name EN': row.Code,
      'Group Name': row['اسم المجموعة'],
      'Category Code': row['كود الصنف'],
      'Category Name': row['اسم الصنف'],
      Unit: row['الوحدة'],
      Balance: row['الرصيد'],
    };
  });
  const ws = sheetWithHeaders(headers, mapped);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Materials');
  XLSX.writeFile(wb, ar ? 'قالب_شجرة_الأصناف.xlsx' : 'Materials_Tree_Template.xlsx');
}

function normalizeRowKeys(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const key = cleanExcelText(k);
    if (!key) continue;
    out[key] = v;
  }
  return out;
}

export function parseMaterialsImportFile(input: ArrayBuffer | Uint8Array): MaterialsImportRow[] {
  const data =
    input instanceof Uint8Array
      ? input
      : input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : new Uint8Array(input as ArrayBuffer);
  const wb = XLSX.read(data, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const jsonRows = XLSX.utils.sheet_to_json(ws) as Record<string, unknown>[];

  return jsonRows
    .map((raw) => {
      const row = normalizeRowKeys(raw);
      const groupCode = cell(row, COL.groupCode);
      const groupName = cell(row, COL.groupName);
      const groupNameEn = cell(row, COL.groupNameEn);
      const categoryCode = cell(row, COL.categoryCode);
      const categoryName = cell(row, COL.categoryName);
      const unit = cell(row, COL.unit);
      return {
        groupCode,
        groupName,
        groupNameEn: groupNameEn || undefined,
        categoryCode: categoryCode || undefined,
        categoryName: categoryName || undefined,
        unit: unit || undefined,
      };
    })
    .filter((r) => r.groupCode || r.groupName || r.groupNameEn || r.categoryCode);
}
