import { describe, expect, it } from 'vitest';
import { aggregateBoqCostBreakdown, isIndirectCostElement, sumBoqCostBreakdown } from './boqCostBreakdown.js';

const contractMap = new Map([
  [
    'c1',
    {
      id: 'c1',
      contractName: 'Contract A',
      contractNumber: '001',
      projectId: 'p1',
      projectName: 'Project One',
      projectCode: 'P1',
    },
  ],
]);

const boqMap = new Map([
  [
    'b1',
    {
      id: 'b1',
      contractId: 'c1',
      itemCode: '1.1.1.001',
      description: 'Concrete',
      chapterCode: '1',
      sectionCode: '1.1',
    },
  ],
  [
    'b2',
    {
      id: 'b2',
      contractId: 'c1',
      itemCode: '1.1.1.002',
      description: 'Steel',
      chapterCode: '1',
      sectionCode: '1.1',
    },
  ],
]);

describe('boqCostBreakdown', () => {
  it('classifies overhead as indirect', () => {
    expect(isIndirectCostElement('overhead')).toBe(true);
    expect(isIndirectCostElement('materials')).toBe(false);
  });

  it('aggregates at boq item level', () => {
    const rows = aggregateBoqCostBreakdown(
      [
        { boqItemId: 'b1', contractId: 'c1', costElement: 'materials', totalCost: 1000 },
        { boqItemId: 'b1', contractId: 'c1', costElement: 'overhead', totalCost: 200 },
        { boqItemId: 'b2', contractId: 'c1', costElement: 'other', totalCost: 500 },
      ],
      contractMap,
      boqMap,
      'boq_item',
    );
    expect(rows).toHaveLength(2);
    const b1 = rows.find((r) => r.boqItemId === 'b1');
    expect(b1?.directCost).toBe(1000);
    expect(b1?.indirectCost).toBe(200);
    expect(b1?.totalCost).toBe(1200);
  });

  it('aggregates at contract level', () => {
    const rows = aggregateBoqCostBreakdown(
      [
        { boqItemId: 'b1', contractId: 'c1', costElement: 'materials', totalCost: 1000 },
        { boqItemId: 'b2', contractId: 'c1', costElement: 'overhead', totalCost: 300 },
      ],
      contractMap,
      boqMap,
      'contract',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.directCost).toBe(1000);
    expect(rows[0]?.indirectCost).toBe(300);
  });

  it('sums totals', () => {
    const rows = aggregateBoqCostBreakdown(
      [{ boqItemId: 'b1', contractId: 'c1', costElement: 'materials', totalCost: 100 }],
      contractMap,
      boqMap,
      'boq_item',
    );
    expect(sumBoqCostBreakdown(rows).totalCost).toBe(100);
  });
});
