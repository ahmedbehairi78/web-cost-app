import { describe, expect, it } from 'vitest';
import {
  isServiceContractor,
  previousQtyFromApproved,
  uniqueBoqChapters,
  serviceKindExpenseAccount,
  netQty,
  displayServiceIpcNumber,
  serviceIpcPrintTitle,
} from './serviceContractor';

describe('serviceContractor', () => {
  it('treats labour/equipment/vehicles/housing as service contractors', () => {
    expect(isServiceContractor({ type: 'subcontractor', serviceKind: 'labour' })).toBe(true);
    expect(isServiceContractor({ type: 'subcontractor', serviceKind: 'works' })).toBe(false);
    expect(isServiceContractor({ type: 'subcontractor' })).toBe(false);
    expect(isServiceContractor({ type: 'supplier', serviceKind: 'labour' })).toBe(false);
  });

  it('maps expense accounts by service kind', () => {
    expect(serviceKindExpenseAccount('labour')).toBe('51102001');
    expect(serviceKindExpenseAccount('equipment')).toBe('51104001');
    expect(serviceKindExpenseAccount('vehicles')).toBe('51104001');
    expect(serviceKindExpenseAccount('housing')).toBe('51103001');
  });

  it('sums previous qty from matching approved lines', () => {
    expect(
      previousQtyFromApproved(
        [
          { contractId: 'c1', chapterCode: 'A', description: 'عامل', currentQty: 4 },
          { contractId: 'c1', chapterCode: 'A', description: 'عامل', currentQty: 2 },
          { contractId: 'c2', chapterCode: 'A', description: 'عامل', currentQty: 9 },
        ],
        { contractId: 'c1', chapterCode: 'A', description: 'عامل' },
      ),
    ).toBe(6);
  });

  it('hides UUID certificate numbers', () => {
    expect(displayServiceIpcNumber('4cf84bb2-1ae8-435d-a886-20b20ed03fdc')).toBe('');
    expect(displayServiceIpcNumber('', '4cf84bb2-1ae8-435d-a886-20b20ed03fdc')).toBe('');
    expect(displayServiceIpcNumber('6')).toBe('6');
  });

  it('builds print title with supplier before number and without خدمة', () => {
    expect(
      serviceIpcPrintTitle({
        contractorName: 'شركة النور',
        documentNumber: '6',
        statusLabel: 'معتمد',
        language: 'ar',
      }),
    ).toBe('مستخلص — شركة النور 6 (معتمد)');
    expect(
      serviceIpcPrintTitle({
        contractorName: 'Al Noor',
        documentNumber: '6',
        statusLabel: 'Approved',
        language: 'en',
      }),
    ).toBe('IPC — Al Noor 6 (Approved)');
    expect(
      serviceIpcPrintTitle({
        contractorName: 'شركة النور',
        documentNumber: '4cf84bb2-1ae8-435d-a886-20b20ed03fdc',
        statusLabel: 'معتمد',
        language: 'ar',
      }),
    ).toBe('مستخلص — شركة النور (معتمد)');
  });

  it('lists unique BOQ chapters per contract', () => {
    const chapters = uniqueBoqChapters(
      [
        { contractId: 'c1', chapterCode: '02', chapterName: 'كهرباء' },
        { contractId: 'c1', chapterCode: '01', chapterName: 'مدني' },
        { contractId: 'c1', chapterCode: '02', chapterName: 'كهرباء' },
        { contractId: 'c2', chapterCode: '09', chapterName: 'أخرى' },
      ],
      'c1',
    );
    expect(chapters.map((c) => c.code)).toEqual(['01', '02']);
  });

  it('nets previous + current qty', () => {
    expect(netQty(3, 2)).toBe(5);
  });
});
