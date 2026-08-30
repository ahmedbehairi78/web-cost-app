import { describe, expect, it } from 'vitest';
import {
  formatServiceIpcNumber,
  needsServiceIpcNumber,
  nextServiceIpcNumberFromExisting,
  parseServiceIpcNumber,
} from './serviceIpcNumber.js';

describe('serviceIpcNumber', () => {
  it('flags empty, UUID, and bare numbers — not the per-supplier year form', () => {
    expect(needsServiceIpcNumber('service_ipc', '')).toBe(true);
    expect(needsServiceIpcNumber('service_ipc', '21546')).toBe(true);
    expect(needsServiceIpcNumber('service_ipc', '4cf84bb2-1ae8-435d-a886-20b20ed03fdc')).toBe(true);
    expect(needsServiceIpcNumber('service_ipc', 'SIPC-0001')).toBe(true);
    expect(needsServiceIpcNumber('service_ipc', 'مستخلص محمد الشيخ-001-2026')).toBe(false);
    expect(needsServiceIpcNumber('ipc', '21546')).toBe(true);
    expect(needsServiceIpcNumber('ipc', '4cf84bb2-1ae8-435d-a886-20b20ed03fdc')).toBe(true);
    expect(needsServiceIpcNumber('ipc', 'مستخلص محمد الشيخ-001-2026')).toBe(false);
    expect(needsServiceIpcNumber('invoice', '21546')).toBe(false);
  });

  it('parses compact and spaced labels', () => {
    expect(parseServiceIpcNumber('مستخلص محمد الشيخ-001-2026')).toEqual({
      supplierLabel: 'محمد الشيخ',
      seq: 1,
      year: 2026,
    });
    expect(parseServiceIpcNumber('مستخلص تامر يسري - 001 -2026')).toEqual({
      supplierLabel: 'تامر يسري',
      seq: 1,
      year: 2026,
    });
    expect(formatServiceIpcNumber('محمد الشيخ', 1, 2026)).toBe('مستخلص محمد الشيخ-001-2026');
  });

  it('sequences per supplier and year', () => {
    const peers = [
      { referenceNumber: 'مستخلص محمد الشيخ-001-2026', supplierName: 'محمد الشيخ', date: '2026-03-01' },
      { referenceNumber: 'مستخلص تامر يسري-001-2026', supplierName: 'تامر يسري', date: '2026-04-01' },
      { referenceNumber: 'مستخلص محمد الشيخ-002-2025', supplierName: 'محمد الشيخ', date: '2025-12-01' },
    ];
    expect(
      nextServiceIpcNumberFromExisting(peers, { supplierName: 'محمد الشيخ', date: '2026-08-30' }),
    ).toBe('مستخلص محمد الشيخ-002-2026');
    expect(
      nextServiceIpcNumberFromExisting(peers, { supplierName: 'تامر يسري', date: '2026-08-30' }),
    ).toBe('مستخلص تامر يسري-002-2026');
    expect(
      nextServiceIpcNumberFromExisting([], { supplierName: 'محمد الشيخ', date: '2026-01-15' }),
    ).toBe('مستخلص محمد الشيخ-001-2026');
  });
});
