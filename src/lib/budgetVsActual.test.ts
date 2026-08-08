import { describe, expect, it } from 'vitest';
import {
  buildBudgetVsActualRows,
  budgetVsActualRowsPerPage,
  chunkBudgetVsActualPages,
  sumBudgetVsActualRows,
} from './budgetVsActual';

describe('buildBudgetVsActualRows', () => {
  const projects = [
    { id: 'p1', projectName: 'Bel', projectCode: 'BEL', voValue: 1000 },
    { id: 'p2', projectName: 'Other', projectCode: 'OTH', voValue: 0 },
  ];
  const contracts = [
    { id: 'c1', projectId: 'p1', contractName: 'عقد أ', contractNumber: 'C-1' },
    { id: 'c2', projectId: 'p1', contractName: 'عقد ب', contractNumber: 'C-2' },
  ];
  const boqItems = [
    {
      id: 'b1',
      projectId: 'p1',
      contractId: 'c1',
      tenderAmount: 112,
      rateMaterials: 50,
      rateLabour: 30,
      rateEquipment: 20,
      rateOverheadPct: 0,
      rateProfitPct: 12,
      itemCode: '1.1',
      description: 'بند 1',
    },
    {
      id: 'b2',
      projectId: 'p1',
      contractId: 'c2',
      tenderAmount: 200,
      itemCode: '2.1',
      description: 'بند 2',
    },
  ];

  it('aggregates at project level with VO on cost budget', () => {
    const actualByKey = new Map([
      ['p1', 150],
      ['p2', 0],
    ]);
    const rows = buildBudgetVsActualRows({
      level: 'project',
      projects,
      contracts,
      boqItems,
      actualByKey,
    });
    const bel = rows.find((r) => r.id === 'p1');
    expect(bel).toBeTruthy();
    expect(bel!.voValue).toBe(1000);
    expect(bel!.actual).toBe(150);
    expect(bel!.costBudget).toBe(bel!.estCost + 1000);
    expect(bel!.variance).toBe(bel!.costBudget - 150);
  });

  it('aggregates at contract level', () => {
    const actualByKey = new Map([
      ['c1', 40],
      ['c2', 60],
    ]);
    const rows = buildBudgetVsActualRows({
      level: 'contract',
      projects,
      contracts,
      boqItems,
      actualByKey,
      projectFilter: 'p1',
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.level === 'contract')).toBe(true);
    expect(rows.find((r) => r.id === 'c1')!.actual).toBe(40);
  });

  it('lists BOQ items with selling and actual', () => {
    const actualByKey = new Map([['b1', 55]]);
    const rows = buildBudgetVsActualRows({
      level: 'boq_item',
      projects,
      contracts,
      boqItems,
      actualByKey,
      projectFilter: 'p1',
      contractFilter: 'c1',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('b1');
    expect(rows[0].label).toBe('1.1 — بند 1');
    expect(rows[0].boqSelling).toBe(112);
    expect(rows[0].actual).toBe(55);
    expect(rows[0].voValue).toBe(0);
  });

  it('sums footer totals', () => {
    const rows = buildBudgetVsActualRows({
      level: 'contract',
      projects,
      contracts,
      boqItems,
      actualByKey: new Map([
        ['c1', 10],
        ['c2', 20],
      ]),
      projectFilter: 'p1',
    });
    const totals = sumBudgetVsActualRows(rows);
    expect(totals.actual).toBe(30);
    expect(totals.boqSelling).toBe(312);
  });

  it('chunks pages for A4 landscape', () => {
    const items = Array.from({ length: 30 }, (_, i) => i);
    const pages = chunkBudgetVsActualPages(items, budgetVsActualRowsPerPage('boq_item'));
    expect(pages).toHaveLength(4);
    expect(pages[0]).toHaveLength(9);
    expect(pages[3]).toHaveLength(3);
  });
});
