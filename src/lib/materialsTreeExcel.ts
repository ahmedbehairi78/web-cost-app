import * as XLSX from 'xlsx';
import type { MaterialCategory, MaterialGroup } from '../services/local/modulesApi';

export type MaterialsImportRow = {
  groupCode: string;
  groupName: string;
  categoryCode?: string;
  categoryName?: string;
  unit?: string;
};

const COL = {
  groupCode: ['Group Code', 'كود المجموعة', 'group_code', 'groupCode'],
  groupName: ['Group Name', 'اسم المجموعة', 'group_name', 'groupName'],
  categoryCode: ['Category Code', 'كود الصنف', 'category_code', 'categoryCode'],
  categoryName: ['Category Name', 'اسم الصنف', 'category_name', 'categoryName'],
  unit: ['Unit', 'الوحدة', 'unit'],
} as const;

function cell(row: Record<string, unknown>, keys: readonly string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

export function buildMaterialsExportRows(
  groups: MaterialGroup[],
  categories: MaterialCategory[],
): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  const catsByGroup = new Map<number, MaterialCategory[]>();
  for (const c of categories) {
    const list = catsByGroup.get(c.groupId) ?? [];
    list.push(c);
    catsByGroup.set(c.groupId, list);
  }

  for (const g of groups) {
    const cats = catsByGroup.get(g.id) ?? [];
    if (cats.length === 0) {
      rows.push({
        'Group Code': g.code,
        'Group Name': g.name,
        'Category Code': '',
        'Category Name': '',
        Unit: '',
      });
      continue;
    }
    for (const c of cats) {
      rows.push({
        'Group Code': g.code,
        'Group Name': g.name,
        'Category Code': c.code,
        'Category Name': c.name,
        Unit: c.unit,
      });
    }
  }
  return rows;
}

export function exportMaterialsTreeExcel(
  groups: MaterialGroup[],
  categories: MaterialCategory[],
  filenamePrefix = 'Materials_Tree',
) {
  const rows = buildMaterialsExportRows(groups, categories);
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Materials');
  XLSX.writeFile(wb, `${filenamePrefix}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function exportMaterialsTreeTemplate(language: 'ar' | 'en') {
  const ar = language === 'ar';
  const rows = ar
    ? [
        {
          'كود المجموعة': 'MTL-01',
          'اسم المجموعة': 'مواد بناء',
          'كود الصنف': '',
          'اسم الصنف': '',
          الوحدة: '',
        },
        {
          'كود المجموعة': 'MTL-01',
          'اسم المجموعة': 'مواد بناء',
          'كود الصنف': 'MTL-01-001',
          'اسم الصنف': 'أسمنت',
          الوحدة: 'طن',
        },
      ]
    : [
        {
          'Group Code': 'MTL-01',
          'Group Name': 'Building materials',
          'Category Code': '',
          'Category Name': '',
          Unit: '',
        },
        {
          'Group Code': 'MTL-01',
          'Group Name': 'Building materials',
          'Category Code': 'MTL-01-001',
          'Category Name': 'Cement',
          Unit: 'طن',
        },
      ];
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Materials');
  XLSX.writeFile(wb, ar ? 'قالب_شجرة_الأصناف.xlsx' : 'Materials_Tree_Template.xlsx');
}

export function parseMaterialsImportFile(buffer: ArrayBuffer): MaterialsImportRow[] {
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws) as Record<string, unknown>[];

  return data
    .map((row) => ({
      groupCode: cell(row, COL.groupCode),
      groupName: cell(row, COL.groupName),
      categoryCode: cell(row, COL.categoryCode) || undefined,
      categoryName: cell(row, COL.categoryName) || undefined,
      unit: cell(row, COL.unit) || undefined,
    }))
    .filter((r) => r.groupCode || r.groupName || r.categoryCode);
}
