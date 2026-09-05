import { describe, expect, it } from 'vitest';
import {
  BOQ_COST_ELEMENT_CUSTODY,
  BOQ_COST_ELEMENT_SUBCONTRACTOR,
  buildCustodyBoqActualRows,
  buildIpcBoqActualRows,
  ipcLinePeriodCost,
} from './boqActualFromSources.js';

describe('ipcLinePeriodCost', () => {
  it('uses currentQty × rate (period), not cumulative amount', () => {
    expect(
      ipcLinePeriodCost({
        boqItemId: 'b1',
        currentQty: 5,
        rate: 100,
        amount: 1500,
      }),
    ).toBe(500);
  });

  it('uses qty × rate × % period when completionPct present', () => {
    // prior 120×50×70%=4200; to-date 120×50×90%=5400 → period 1200
    expect(
      ipcLinePeriodCost({
        clientBoqItemId: 'div4',
        previousQty: 120,
        currentQty: 0,
        rate: 50,
        completionPct: 90,
        previousCompletionPct: 70,
      }),
    ).toBe(1200);
  });

  it('falls back to amount when qty missing', () => {
    expect(ipcLinePeriodCost({ boqItemId: 'b1', amount: 250 })).toBe(250);
  });

  it('returns 0 for empty lines', () => {
    expect(ipcLinePeriodCost({ boqItemId: 'b1', currentQty: 0, rate: 10 })).toBe(0);
  });
});

describe('buildIpcBoqActualRows', () => {
  it('aggregates sub-lines onto clientBoqItemId', () => {
    const rows = buildIpcBoqActualRows({
      purchaseTransactionId: 'pt-1',
      contractId: 'c1',
      date: '2026-07-15',
      items: [
        {
          clientBoqItemId: 'div4',
          previousQty: 0,
          currentQty: 10,
          rate: 100,
          completionPct: 100,
        },
        {
          clientBoqItemId: 'div4',
          previousQty: 0,
          currentQty: 5,
          rate: 50,
          completionPct: 100,
        },
        { boqItemId: '', currentQty: 10, rate: 10 },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      boqItemId: 'div4',
      contractId: 'c1',
      purchaseTransactionId: 'pt-1',
      quantity: 1,
      totalCost: 1250,
      costElement: BOQ_COST_ELEMENT_SUBCONTRACTOR,
    });
  });

  it('builds subcontractor rows and skips zero/missing BOQ', () => {
    const rows = buildIpcBoqActualRows({
      purchaseTransactionId: 'pt-1',
      contractId: 'c1',
      date: '2026-07-15',
      items: [
        { boqItemId: 'b1', currentQty: 2, rate: 50 },
        { boqItemId: '', currentQty: 10, rate: 10 },
        { boqItemId: 'b2', currentQty: 0, rate: 99 },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      boqItemId: 'b1',
      totalCost: 100,
      costElement: BOQ_COST_ELEMENT_SUBCONTRACTOR,
    });
  });

  it('returns empty without contractId', () => {
    expect(
      buildIpcBoqActualRows({
        purchaseTransactionId: 'pt-1',
        contractId: '',
        date: '2026-07-15',
        items: [{ boqItemId: 'b1', currentQty: 1, rate: 10 }],
      }),
    ).toEqual([]);
  });
});

describe('buildCustodyBoqActualRows', () => {
  it('includes only lines with optional boqItemId + contract + amount', () => {
    const rows = buildCustodyBoqActualRows({
      custodySettlementId: 'cs-1',
      date: '2026-07-20',
      items: [
        { contractId: 'c1', accountCode: '52101001', amount: 300, boqItemId: 'b9' },
        { contractId: 'c1', accountCode: '52101001', amount: 100 },
        { contractId: '', accountCode: '52101001', amount: 50, boqItemId: 'b9' },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      boqItemId: 'b9',
      costElement: BOQ_COST_ELEMENT_CUSTODY,
      totalCost: 300,
    });
  });
});
