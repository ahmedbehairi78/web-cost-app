import { describe, expect, it } from 'vitest';
import {
  buildBoqScopeByItemId,
  normalizeBoqScopeType,
  parseBoqScopeTypeFromImport,
  sumBoqContractScopeTotals,
} from './boqScopeType';

describe('normalizeBoqScopeType', () => {
  it('defaults empty to basic', () => {
    expect(normalizeBoqScopeType(undefined)).toBe('basic');
    expect(normalizeBoqScopeType('')).toBe('basic');
  });

  it('recognizes optional aliases in ar/en', () => {
    expect(normalizeBoqScopeType('اختياري')).toBe('optional');
    expect(normalizeBoqScopeType('Optional')).toBe('optional');
    expect(normalizeBoqScopeType('نطاق اختياري')).toBe('optional');
  });

  it('recognizes basic aliases', () => {
    expect(normalizeBoqScopeType('أساسي')).toBe('basic');
    expect(normalizeBoqScopeType('basic')).toBe('basic');
  });
});

describe('parseBoqScopeTypeFromImport', () => {
  it('parses Excel column values', () => {
    expect(parseBoqScopeTypeFromImport('اساسي')).toBe('basic');
    expect(parseBoqScopeTypeFromImport('اختيارى')).toBe('optional');
  });
});

describe('sumBoqContractScopeTotals', () => {
  it('splits tender amounts by scope and excludes VO ids', () => {
    const exclude = new Set(['vo-1']);
    const totals = sumBoqContractScopeTotals(
      [
        { id: 'a', tenderAmount: 1000, scopeType: 'basic' },
        { id: 'b', tenderAmount: 200, scopeType: 'optional' },
        { id: 'vo-1', tenderAmount: 500, scopeType: 'basic' },
      ],
      exclude,
    );
    expect(totals).toEqual({ basicSum: 1000, optionalSum: 200, totalSum: 1200 });
  });
});

describe('buildBoqScopeByItemId', () => {
  it('maps item ids to normalized scope', () => {
    const map = buildBoqScopeByItemId([
      { id: 'x', scopeType: 'optional' },
      { id: 'y', scopeType: 'basic' },
    ]);
    expect(map.get('x')).toBe('optional');
    expect(map.get('y')).toBe('basic');
  });
});
