import { describe, expect, it } from 'vitest';
import { resolveSpreadsheetMove } from './spreadsheetGridNav';

const dims = { rows: 3, cols: 2 };

describe('resolveSpreadsheetMove', () => {
  it('moves right within row then wraps to next row', () => {
    expect(resolveSpreadsheetMove('ArrowRight', { row: 0, col: 0 }, dims)).toEqual({ row: 0, col: 1 });
    expect(resolveSpreadsheetMove('ArrowRight', { row: 0, col: 1 }, dims)).toEqual({ row: 1, col: 0 });
  });

  it('Tab advances and returns null at last cell', () => {
    expect(resolveSpreadsheetMove('Tab', { row: 2, col: 1 }, dims)).toBeNull();
    expect(resolveSpreadsheetMove('Tab', { row: 0, col: 0 }, dims)).toEqual({ row: 0, col: 1 });
  });

  it('Shift+Tab moves backward', () => {
    expect(resolveSpreadsheetMove('Tab', { row: 1, col: 0 }, dims, true)).toEqual({ row: 0, col: 1 });
  });

  it('Enter moves down in same column', () => {
    expect(resolveSpreadsheetMove('Enter', { row: 0, col: 1 }, dims)).toEqual({ row: 1, col: 1 });
    expect(resolveSpreadsheetMove('Enter', { row: 2, col: 1 }, dims)).toEqual({ row: 2, col: 1 });
  });
});
