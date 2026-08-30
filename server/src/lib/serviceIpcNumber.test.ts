import { describe, expect, it } from 'vitest';
import {
  formatServiceIpcNumber,
  needsServiceIpcNumber,
  nextServiceIpcNumberFromExisting,
  parseServiceIpcSeq,
} from './serviceIpcNumber.js';

describe('serviceIpcNumber', () => {
  it('flags empty or UUID refs on service IPC only', () => {
    expect(needsServiceIpcNumber('service_ipc', '')).toBe(true);
    expect(needsServiceIpcNumber('service_ipc', '   ')).toBe(true);
    expect(needsServiceIpcNumber('service_ipc', '4cf84bb2-1ae8-435d-a886-20b20ed03fdc')).toBe(true);
    expect(needsServiceIpcNumber('service_ipc', '6')).toBe(false);
    expect(needsServiceIpcNumber('service_ipc', 'SIPC-0001')).toBe(false);
    expect(needsServiceIpcNumber('ipc', '')).toBe(false);
  });

  it('parses plain and legacy SIPC sequences', () => {
    expect(parseServiceIpcSeq('6')).toBe(6);
    expect(parseServiceIpcSeq('06')).toBe(6);
    expect(parseServiceIpcSeq('SIPC-0007')).toBe(7);
    expect(parseServiceIpcSeq('INV-1')).toBe(0);
    expect(formatServiceIpcNumber(6)).toBe('6');
    expect(formatServiceIpcNumber(42)).toBe('42');
  });

  it('takes the next unused sequence', () => {
    expect(nextServiceIpcNumberFromExisting([])).toBe('1');
    expect(nextServiceIpcNumberFromExisting(['1', 'SIPC-0003', '6', null])).toBe('7');
  });
});
