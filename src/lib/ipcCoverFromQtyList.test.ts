import { describe, expect, it } from 'vitest';
import {
  buildIpcCoverWorksSplit,
  classifyIpcQtyLineKind,
  collectVoCreatedBoqItemIds,
  ipcLineToDateAmount,
} from './ipcCoverFromQtyList';

describe('collectVoCreatedBoqItemIds', () => {
  it('collects createdBoqItemId only from approved orders', () => {
    const ids = collectVoCreatedBoqItemIds([
      {
        status: 'approved',
        lines: [{ createdBoqItemId: 'vo-new-1' }, { createdBoqItemId: null }],
      },
      {
        status: 'draft',
        lines: [{ createdBoqItemId: 'vo-draft-should-ignore' }],
      },
      {
        status: 'approved',
        lines: [{ createdBoqItemId: 'vo-new-2' }],
      },
    ]);
    expect([...ids].sort()).toEqual(['vo-new-1', 'vo-new-2']);
  });

  it('treats missing status as includable (pre-filtered list)', () => {
    const ids = collectVoCreatedBoqItemIds([
      { lines: [{ createdBoqItemId: 'x1' }] },
    ]);
    expect(ids.has('x1')).toBe(true);
  });
});

describe('classifyIpcQtyLineKind', () => {
  it('marks VO-created ids as additional', () => {
    const set = new Set(['vo-a']);
    expect(classifyIpcQtyLineKind('vo-a', set)).toBe('additional');
    expect(classifyIpcQtyLineKind('orig-1', set)).toBe('basic');
  });

  it('marks optional-scope BOQ lines as optional (not VO)', () => {
    const scope = new Map<string, 'basic' | 'optional'>([['opt-1', 'optional']]);
    expect(classifyIpcQtyLineKind('opt-1', new Set(), scope)).toBe('optional');
    expect(classifyIpcQtyLineKind('orig-1', new Set(), scope)).toBe('basic');
  });

  it('VO-created id wins over optional scope', () => {
    const scope = new Map<string, 'basic' | 'optional'>([['vo-a', 'optional']]);
    expect(classifyIpcQtyLineKind('vo-a', new Set(['vo-a']), scope)).toBe('additional');
  });
});

describe('buildIpcCoverWorksSplit', () => {
  it('splits previous/current/to-date by basic vs additional from one qty list', () => {
    const voIds = new Set(['vo-item']);
    const split = buildIpcCoverWorksSplit(
      [
        { boqItemId: 'orig', rate: 100, previousQty: 10, currentQty: 2, amount: 200 },
        { boqItemId: 'vo-item', rate: 50, previousQty: 4, currentQty: 1, amount: 50 },
      ],
      voIds,
    );

    expect(split.basic).toEqual({
      previousValue: 1000,
      currentValue: 200,
      toDateValue: 1200,
    });
    expect(split.optional).toEqual({
      previousValue: 0,
      currentValue: 0,
      toDateValue: 0,
    });
    expect(split.additional).toEqual({
      previousValue: 200,
      currentValue: 50,
      toDateValue: 250,
    });
    expect(split.periodWorksTotal).toBe(250);
    expect(split.toDateWorksTotal).toBe(1450);
  });

  it('splits optional-scope lines separately from basic', () => {
    const scope = new Map<string, 'basic' | 'optional'>([
      ['opt', 'optional'],
      ['base', 'basic'],
    ]);
    const split = buildIpcCoverWorksSplit(
      [
        { boqItemId: 'base', rate: 10, previousQty: 1, currentQty: 1, amount: 20 },
        { boqItemId: 'opt', rate: 5, previousQty: 2, currentQty: 1, amount: 15 },
      ],
      new Set(),
      scope,
    );
    expect(split.basic).toEqual({ previousValue: 10, currentValue: 10, toDateValue: 20 });
    expect(split.optional).toEqual({ previousValue: 10, currentValue: 5, toDateValue: 15 });
    expect(split.additional).toEqual({ previousValue: 0, currentValue: 0, toDateValue: 0 });
  });

  it('uses qty × rate × completion % for period and to-date', () => {
    const split = buildIpcCoverWorksSplit(
      [
        {
          boqItemId: 'plaster',
          rate: 50,
          previousQty: 120,
          currentQty: 0,
          completionPct: 90,
          previousCompletionPct: 70,
        },
      ],
      new Set(),
    );
    expect(split.basic.previousValue).toBe(4200);
    expect(split.basic.currentValue).toBe(1200);
    expect(split.basic.toDateValue).toBe(5400);
    expect(split.periodWorksTotal).toBe(1200);
  });
});

describe('ipcLineToDateAmount', () => {
  it('uses totalQty × rate (executed to date), not current period only', () => {
    // Murraya example: total 262 @ 82.5 → not current 104.8 × 82.5
    expect(
      ipcLineToDateAmount({
        rate: 82.5,
        previousQty: 157.2,
        currentQty: 104.8,
        totalQty: 262,
      }),
    ).toBe(21_615);
  });
});
