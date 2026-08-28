import { describe, expect, it } from 'vitest';
import {
  formatOperationProgressCount,
  operationProgressPct,
} from './operationProgress';

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
