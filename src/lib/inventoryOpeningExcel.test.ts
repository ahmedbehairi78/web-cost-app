import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseOpeningInventoryFile, parseOpeningInventoryWorkbook } from './inventoryOpeningExcel';

function toUint8(written: unknown): Uint8Array {
  if (written instanceof Uint8Array) return written;
  if (written instanceof ArrayBuffer) return new Uint8Array(written);
  if (Array.isArray(written)) return Uint8Array.from(written as number[]);
  // Node Buffer
  if (written && typeof written === 'object' && 'buffer' in (written as object)) {
    return new Uint8Array(written as ArrayBufferLike);
  }
  throw new Error('Unexpected XLSX.write output');
}

function parseFromRows(rows: Record<string, unknown>[]) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Opening');
  const written = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return parseOpeningInventoryFile(toUint8(written));
}

describe('parseOpeningInventoryFile', () => {
  it('parses Arabic column headers', () => {
    const rows = parseFromRows([
      {
        'كود الصنف': 'MTL-01-001',
        'اسم الصنف': 'أسمنت',
        الوحدة: 'طن',
        الكمية: 12.5,
        'متوسط التكلفة': 1800.25,
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      materialCategoryCode: 'MTL-01-001',
      quantity: 12.5,
      avgUnitCost: 1800.25,
      materialCategoryName: 'أسمنت',
      unit: 'طن',
    });
  });

  it('parses English column headers and skips empty codes', () => {
    const rows = parseFromRows([
      {
        'Category Code': '',
        Quantity: 1,
        'Avg Unit Cost': 10,
      },
      {
        'Category Code': 'STL-01-001',
        Quantity: '3',
        'Avg Unit Cost': '500.5',
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      materialCategoryCode: 'STL-01-001',
      quantity: 3,
      avgUnitCost: 500.5,
    });
  });

  it('skips rows without quantity or unit cost instead of sending NaN', () => {
    const rows = parseFromRows([
      { 'كود الصنف': 'A-1', الكمية: '', 'متوسط التكلفة': 10 },
      { 'كود الصنف': 'A-2', الكمية: 5, 'متوسط التكلفة': '' },
      { 'كود الصنف': 'A-3', الكمية: 2, 'متوسط التكلفة': 12 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.materialCategoryCode).toBe('A-3');
  });

  it('rejects the materials-tree workbook instead of reading الرصيد', () => {
    const ws = XLSX.utils.json_to_sheet([
      {
        'كود المجموعة': 'BLK',
        Code: 'Block / Building',
        'اسم المجموعة': 'بناء',
        'كود الصنف': 'BLK-001',
        'اسم الصنف': 'اسمنت',
        الوحدة: 'شيكارة',
        الرصيد: 40,
      },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Materials');
    const written = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const parsed = parseOpeningInventoryWorkbook(toUint8(written));
    expect(parsed.isMaterialsTreeFile).toBe(true);
    expect(parsed.rows).toHaveLength(0);
  });
});
