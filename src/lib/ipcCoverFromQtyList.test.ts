import { describe, expect, it } from 'vitest';
import {
  buildIpcCoverWorksSplit,
  classifyIpcQtyLineKind,
  collectVoCreatedBoqItemIds,
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
    expect(split.additional).toEqual({
      previousValue: 200,
      currentValue: 50,
      toDateValue: 250,
    });
    expect(split.periodWorksTotal).toBe(250);
    expect(split.toDateWorksTotal).toBe(1450);
  });

  it('uses currentQty × rate even when amount wrongly stores totalQty × rate', () => {
    const split = buildIpcCoverWorksSplit(
      [
        {
          boqItemId: 'a',
          rate: 10,
          previousQty: 5,
          currentQty: 3,
          /** Bug remnant: previous+current */
          amount: 80,
        },
      ],
      new Set(),
    );
    expect(split.basic.currentValue).toBe(30);
    expect(split.basic.previousValue).toBe(50);
    expect(split.periodWorksTotal).toBe(30);
    expect(split.toDateWorksTotal).toBe(80);
  });
});
