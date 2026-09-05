import { describe, expect, it } from 'vitest';
import {
  parseSubcontractorIpcExcelRows,
  buildSubcontractorIpcTemplateAoa,
} from './subcontractorIpcExcel';

describe('parseSubcontractorIpcExcelRows', () => {
  it('parses Book1-like flat aliases', () => {
    const rows = parseSubcontractorIpcExcelRows([
      {
        'رقم البند': '1',
        'وصف البند': 'محارة داخلية',
        'العقد|الوحدة': 'م2',
        'العقد|الفئة': '110',
        'الكميات |الكمية': '809',
        'الكميات |السابق': '773',
        'الكميات |الحالي': '30',
        ' نسبة الانجاز ': '99%',
      },
      {
        'رقم البند': '2',
        'وصف البند': 'فليسبيكو',
        'العقد|الوحدة': 'م',
        'العقد|الفئة': 50,
        'الكميات |الكمية': 55,
        'الكميات |السابق': 50,
        'الكميات |الحالي': 5,
        ' نسبة الانجاز ': '100%',
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      itemCode: '1',
      description: 'محارة داخلية',
      unit: 'م2',
      rate: 110,
      tenderQty: 809,
      previousQty: 773,
      currentQty: 30,
      completionPct: 99,
    });
    expect(rows[1].completionPct).toBe(100);
  });

  it('parses app template headers', () => {
    const rows = parseSubcontractorIpcExcelRows([
      {
        'كود البند': 'S-1',
        البيان: 'بند',
        الوحدة: 'م',
        'كمية العقد': 10,
        الفئة: 20,
        'الكمية السابقة': 0,
        'الكمية الحالية': 4,
        'نسبة الإنجاز %': 70,
      },
    ]);
    expect(rows[0]).toMatchObject({
      itemCode: 'S-1',
      currentQty: 4,
      completionPct: 70,
      rate: 20,
    });
  });
});

describe('buildSubcontractorIpcTemplateAoa', () => {
  it('includes client BOQ code column', () => {
    const aoa = buildSubcontractorIpcTemplateAoa(true);
    expect(aoa[0]).toContain('كود بند العميل');
  });
});
