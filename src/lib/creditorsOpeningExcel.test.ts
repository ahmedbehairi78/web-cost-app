import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseCreditorPartyType, parseCreditorsOpeningWorkbook } from './creditorsOpeningExcel';

function toUint8(written: unknown): Uint8Array {
  if (written instanceof Uint8Array) return written;
  if (written instanceof ArrayBuffer) return new Uint8Array(written);
  if (Array.isArray(written)) return Uint8Array.from(written as number[]);
  if (written && typeof written === 'object' && 'buffer' in (written as object)) {
    return new Uint8Array(written as ArrayBufferLike);
  }
  throw new Error('Unexpected XLSX.write output');
}

function parseFromRows(rows: Record<string, unknown>[]) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Parties');
  const written = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return parseCreditorsOpeningWorkbook(toUint8(written));
}

describe('parseCreditorPartyType', () => {
  it('maps Arabic and English labels', () => {
    expect(parseCreditorPartyType('مورد')).toBe('supplier');
    expect(parseCreditorPartyType('supplier')).toBe('supplier');
    expect(parseCreditorPartyType('مقاول باطن')).toBe('subcontractor');
    expect(parseCreditorPartyType('Subcontractor')).toBe('subcontractor');
    expect(parseCreditorPartyType('unknown')).toBeNull();
  });
});

describe('parseCreditorsOpeningWorkbook', () => {
  it('parses Arabic headers and opening credit balances', () => {
    const rows = parseFromRows([
      {
        النوع: 'مورد',
        الاسم: 'شركة الحديد',
        'الاسم الإنجليزي': 'Steel Co',
        'الرصيد الافتتاحي': 150000.5,
      },
      {
        النوع: 'مقاول باطن',
        الاسم: 'تشطيب',
        'كود الحساب': '21102005',
        'الرصيد الافتتاحي': 0,
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      type: 'supplier',
      name: 'شركة الحديد',
      nameEn: 'Steel Co',
      openingBalance: 150000.5,
    });
    expect(rows[1]).toMatchObject({
      type: 'subcontractor',
      accountCode: '21102005',
      openingBalance: 0,
    });
  });

  it('skips rows without type or name', () => {
    const rows = parseFromRows([
      { Type: 'supplier', Name: '', 'Opening Balance': 10 },
      { Type: 'nope', Name: 'X', 'Opening Balance': 10 },
    ]);
    expect(rows).toHaveLength(0);
  });
});
