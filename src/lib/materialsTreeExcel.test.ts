import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  MATERIALS_TREE_HEADERS_AR,
  buildMaterialsExportRows,
  parseMaterialsImportFile,
} from './materialsTreeExcel';

function toUint8(written: unknown): Uint8Array {
  if (written instanceof Uint8Array) return written;
  if (written instanceof ArrayBuffer) return new Uint8Array(written);
  if (Array.isArray(written)) return Uint8Array.from(written as number[]);
  if (written && typeof written === 'object' && 'buffer' in (written as object)) {
    return new Uint8Array(written as ArrayBufferLike);
  }
  throw new Error('Unexpected XLSX.write output');
}

function bufferFromAoa(rows: unknown[][]): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Materials');
  const out = toUint8(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

describe('materialsTreeExcel', () => {
  it('parses contractor warehouse v2 headers without treating Code as group code', () => {
    const buffer = bufferFromAoa([
      [...MATERIALS_TREE_HEADERS_AR],
      ['BLK', 'Block\u00a0/ Building', 'بناء', 'BLK-001', 'اسمنت العرب', 'شيكارة', 522],
      ['ELW', 'Electrical Wire', 'أسلاك كهرباء', 'ELW-001', 'سلك 2.5', 'متر', 0],
    ]);
    const rows = parseMaterialsImportFile(buffer);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      groupCode: 'BLK',
      groupNameEn: 'Block / Building',
      groupName: 'بناء',
      categoryCode: 'BLK-001',
      categoryName: 'اسمنت العرب',
      unit: 'شيكارة',
    });
    expect(rows[1].groupCode).toBe('ELW');
    expect(rows[1].groupNameEn).toBe('Electrical Wire');
  });

  it('still parses the legacy 5-column template', () => {
    const buffer = bufferFromAoa([
      ['كود المجموعة', 'اسم المجموعة', 'كود الصنف', 'اسم الصنف', 'الوحدة'],
      ['MTL-01', 'مواد بناء', 'MTL-01-001', 'أسمنت', 'طن'],
    ]);
    const rows = parseMaterialsImportFile(buffer);
    expect(rows).toEqual([
      {
        groupCode: 'MTL-01',
        groupName: 'مواد بناء',
        groupNameEn: undefined,
        categoryCode: 'MTL-01-001',
        categoryName: 'أسمنت',
        unit: 'طن',
      },
    ]);
  });

  it('exports the v2 column set including English group name', () => {
    const rows = buildMaterialsExportRows(
      [{ id: 1, code: 'BLK', name: 'بناء', nameEn: 'Block / Building' }],
      [{ id: 10, groupId: 1, code: 'BLK-001', name: 'اسمنت العرب', unit: 'شيكارة' }],
    );
    expect(rows[0]).toMatchObject({
      'كود المجموعة': 'BLK',
      Code: 'Block / Building',
      'اسم المجموعة': 'بناء',
      'كود الصنف': 'BLK-001',
      'اسم الصنف': 'اسمنت العرب',
      الوحدة: 'شيكارة',
      الرصيد: '',
    });
  });

  it('parses English v2 headers including Group Name EN', () => {
    const buffer = bufferFromAoa([
      ['Group Code', 'Group Name EN', 'Group Name', 'Category Code', 'Category Name', 'Unit', 'Balance'],
      ['ELW', 'Electrical Wire', 'أسلاك كهرباء', 'ELW-001', 'Cable 2.5mm', 'متر', 0],
    ]);
    const rows = parseMaterialsImportFile(buffer);
    expect(rows[0]).toMatchObject({
      groupCode: 'ELW',
      groupNameEn: 'Electrical Wire',
      groupName: 'أسلاك كهرباء',
      categoryCode: 'ELW-001',
      unit: 'متر',
    });
    expect(rows[0]).not.toHaveProperty('balance');
  });
});
