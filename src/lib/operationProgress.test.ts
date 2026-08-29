import { describe, expect, it, beforeEach } from 'vitest';
import {
  formatOperationProgressCount,
  formatPartialImportMessage,
  operationProgressPct,
  resolveImportFailureReason,
} from './operationProgress';
import {
  beginLongRunningOperation,
  endLongRunningOperation,
  isLongRunningOperationActive,
} from './longRunningOperation';

describe('operationProgressPct', () => {
  it('returns null for indeterminate', () => {
    expect(operationProgressPct(3, null)).toBeNull();
    expect(operationProgressPct(3, 0)).toBeNull();
  });

  it('computes rounded percent capped at 100', () => {
    expect(operationProgressPct(25, 100)).toBe(25);
    expect(operationProgressPct(1, 3)).toBe(33);
    expect(operationProgressPct(10, 10)).toBe(100);
  });
});

describe('formatOperationProgressCount', () => {
  it('formats ar/en counts with percent', () => {
    expect(formatOperationProgressCount(5, 20, 'ar')).toBe('5 / 20 (25٪)');
    expect(formatOperationProgressCount(5, 20, 'en')).toBe('5 / 20 (25%)');
  });
});

describe('longRunningOperation', () => {
  beforeEach(() => {
    while (isLongRunningOperationActive()) endLongRunningOperation();
  });

  it('tracks nested long-running operations', () => {
    expect(isLongRunningOperationActive()).toBe(false);
    beginLongRunningOperation();
    expect(isLongRunningOperationActive()).toBe(true);
    beginLongRunningOperation();
    endLongRunningOperation();
    expect(isLongRunningOperationActive()).toBe(true);
    endLongRunningOperation();
    expect(isLongRunningOperationActive()).toBe(false);
  });
});

describe('formatPartialImportMessage', () => {
  it('includes done/total, item code, and reason', () => {
    const msg = formatPartialImportMessage('ar', 12, 40, '01-002', 'انقطاع الشبكة');
    expect(msg).toContain('12');
    expect(msg).toContain('40');
    expect(msg).toContain('01-002');
    expect(msg).toContain('انقطاع الشبكة');
  });
});

describe('resolveImportFailureReason', () => {
  it('detects offline marker', () => {
    expect(resolveImportFailureReason(new Error('OFFLINE'), 'en')).toContain('network');
  });
});
