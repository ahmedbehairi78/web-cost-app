import { describe, expect, it } from 'vitest';
import {
  fieldHasFullSelection,
  isNumberInput,
  resolveSpatialNeighbor,
  resolveTableGridMove,
  shouldNavigateHorizontally,
} from './excelLikeInputs';

function fakeField(
  value: string,
  start: number,
  end: number,
  type = 'text',
): HTMLInputElement {
  return {
    type,
    value,
    selectionStart: start,
    selectionEnd: end,
    getAttribute: (n: string) => (n === 'type' ? type : null),
  } as unknown as HTMLInputElement;
}

function rect(left: number, top: number, w = 40, h = 20) {
  return { left, top, right: left + w, bottom: top + h, width: w, height: h };
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

  it('always navigates horizontally on number inputs', () => {
    const num = fakeField('12', 1, 1, 'number');
    expect(isNumberInput(num)).toBe(true);
    expect(shouldNavigateHorizontally(num, 'ArrowLeft')).toBe(true);
    expect(shouldNavigateHorizontally(num, 'ArrowRight')).toBe(true);
  });
});

describe('isNumberInput', () => {
  it('detects type=number', () => {
    expect(isNumberInput(fakeField('1', 0, 1, 'number'))).toBe(true);
    expect(isNumberInput(fakeField('1', 0, 1, 'text'))).toBe(false);
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

describe('resolveSpatialNeighbor', () => {
  const current = rect(100, 100);
  const candidates = [
    { id: 'above', rect: rect(100, 40) },
    { id: 'below', rect: rect(105, 160) },
    { id: 'left', rect: rect(20, 100) },
    { id: 'right', rect: rect(180, 98) },
    { id: 'belowFarSide', rect: rect(300, 170) },
  ];

  it('picks nearest field in each arrow direction', () => {
    expect(resolveSpatialNeighbor('ArrowUp', current, candidates)).toBe('above');
    expect(resolveSpatialNeighbor('ArrowDown', current, candidates)).toBe('below');
    expect(resolveSpatialNeighbor('ArrowLeft', current, candidates)).toBe('left');
    expect(resolveSpatialNeighbor('ArrowRight', current, candidates)).toBe('right');
  });

  it('prefers aligned column over nearer but sideways below', () => {
    const cur = rect(100, 100);
    const list = [
      { id: 'alignedFar', rect: rect(100, 220) },
      { id: 'sideNear', rect: rect(250, 130) },
    ];
    expect(resolveSpatialNeighbor('ArrowDown', cur, list)).toBe('alignedFar');
  });
});
