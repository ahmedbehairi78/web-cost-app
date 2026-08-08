import { describe, expect, it } from 'vitest';
import {
  fieldHasFullSelection,
  resolveTableGridMove,
  shouldNavigateHorizontally,
} from './excelLikeInputs';

function fakeField(value: string, start: number, end: number): HTMLInputElement {
  return {
    value,
    selectionStart: start,
    selectionEnd: end,
  } as HTMLInputElement;
}

describe('shouldNavigateHorizontally', () => {
  it('navigates when fully selected', () => {
    const el = fakeField('123', 0, 3);
    expect(shouldNavigateHorizontally(el, 'ArrowLeft')).toBe(true);
    expect(shouldNavigateHorizontally(el, 'ArrowRight')).toBe(true);
  });

  it('keeps caret when editing mid-value', () => {
    const el = fakeField('123', 1, 1);
    expect(shouldNavigateHorizontally(el, 'ArrowLeft')).toBe(false);
    expect(shouldNavigateHorizontally(el, 'ArrowRight')).toBe(false);
  });

  it('leaves cell at caret edges', () => {
    expect(shouldNavigateHorizontally(fakeField('123', 0, 0), 'ArrowLeft')).toBe(true);
    expect(shouldNavigateHorizontally(fakeField('123', 3, 3), 'ArrowRight')).toBe(true);
  });
});

describe('fieldHasFullSelection', () => {
  it('detects full selection', () => {
    expect(fieldHasFullSelection(fakeField('ab', 0, 2))).toBe(true);
    expect(fieldHasFullSelection(fakeField('ab', 0, 1))).toBe(false);
  });
});

describe('resolveTableGridMove', () => {
  const matrix = [
    [{}, {}] as unknown as HTMLInputElement[],
    [{}] as unknown as HTMLInputElement[],
    [{}, {}, {}] as unknown as HTMLInputElement[],
  ];

  it('moves right then wraps to next row', () => {
    expect(resolveTableGridMove('ArrowRight', { row: 0, col: 0 }, matrix)).toEqual({ row: 0, col: 1 });
    expect(resolveTableGridMove('ArrowRight', { row: 0, col: 1 }, matrix)).toEqual({ row: 1, col: 0 });
  });

  it('clamps column when moving vertically into a shorter row', () => {
    expect(resolveTableGridMove('ArrowDown', { row: 0, col: 1 }, matrix)).toEqual({ row: 1, col: 0 });
    expect(resolveTableGridMove('ArrowUp', { row: 2, col: 2 }, matrix)).toEqual({ row: 1, col: 0 });
  });

  it('Tab returns null at end of grid', () => {
    expect(resolveTableGridMove('Tab', { row: 2, col: 2 }, matrix)).toBeNull();
  });

  it('Enter moves down', () => {
    expect(resolveTableGridMove('Enter', { row: 0, col: 0 }, matrix)).toEqual({ row: 1, col: 0 });
  });
});
