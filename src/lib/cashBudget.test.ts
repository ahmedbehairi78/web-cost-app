import { describe, expect, it } from 'vitest';
import {
  allocatePayableByCostCenter,
  allocationSharePct,
  computeCashBudgetSummary,
  custodyReplenishAmount,
  distributePoolByAccountWeight,
  distributableBankAndCashPool,
  isBankLeafCode,
  isClientReceivableLeafCode,
  isCustodyCashLeafCode,
  isCustodyFundAccount,
  isDateInRange,
  isSalariesPayableLeafCode,
  isSubcontractorLeafCode,
  isSupplierLeafCode,
  liabilityPayableAmount,
  mergeSuggestedLines,
  payrollMonthOverlapsPeriod,
  periodEndFor,
  subAccountLabel,
  summarizeAllocationByCostCenter,
  lineCostCenterId,
} from './cashBudget';

describe('periodEndFor', () => {
  it('weekly is start + 6 days', () => {
    expect(periodEndFor('weekly', '2026-08-17')).toBe('2026-08-23');
  });

  it('biweekly is start + 13 days', () => {
    expect(periodEndFor('biweekly', '2026-08-17')).toBe('2026-08-30');
  });

  it('monthly ends on last calendar day of the start month', () => {
    expect(periodEndFor('monthly', '2026-02-10')).toBe('2026-02-28');
    expect(periodEndFor('monthly', '2026-08-01')).toBe('2026-08-31');
  });
});

describe('isDateInRange', () => {
  it('includes bounds and strips ISO time', () => {
    expect(isDateInRange('2026-08-17', '2026-08-17', '2026-08-23')).toBe(true);
    expect(isDateInRange('2026-08-23T15:00:00.000Z', '2026-08-17', '2026-08-23')).toBe(true);
    expect(isDateInRange('2026-08-16', '2026-08-17', '2026-08-23')).toBe(false);
  });
});

describe('payrollMonthOverlapsPeriod', () => {
  it('includes a weekly slice inside August', () => {
    expect(payrollMonthOverlapsPeriod(2026, 8, '2026-08-17', '2026-08-23')).toBe(true);
  });

  it('excludes a non-overlapping month', () => {
    expect(payrollMonthOverlapsPeriod(2026, 7, '2026-08-17', '2026-08-23')).toBe(false);
  });
});

describe('custodyReplenishAmount', () => {
  it('is max(0, min − (gl − pending))', () => {
    expect(custodyReplenishAmount(50_000, 20_000, 0)).toBe(30_000);
    expect(custodyReplenishAmount(50_000, 50_000, 10_000)).toBe(10_000);
    expect(custodyReplenishAmount(50_000, 80_000, 0)).toBe(0);
  });

  it('skips when min is zero', () => {
    expect(custodyReplenishAmount(0, 1_000, 500)).toBe(0);
  });
});

describe('computeCashBudgetSummary', () => {
  it('gap = banks + cash + period sources − obligations', () => {
    const summary = computeCashBudgetSummary({
      openingBank: 100_000,
      openingCash: 20_000,
      lines: [
        { side: 'source', category: 'opening_bank', amount: 100_000 },
        { side: 'source', category: 'opening_cash', amount: 20_000 },
        { side: 'source', category: 'collection', amount: 40_000 },
        { side: 'obligation', category: 'supplier', amount: 70_000 },
        { side: 'obligation', category: 'custody_replenish', amount: 10_000 },
      ],
    });
    expect(summary.availableLiquidity).toBe(120_000);
    expect(summary.periodSources).toBe(40_000);
    expect(summary.obligations).toBe(80_000);
    expect(summary.gap).toBe(80_000);
  });

  it('ignores excluded lines', () => {
    const summary = computeCashBudgetSummary({
      openingBank: 10,
      openingCash: 0,
      lines: [{ side: 'obligation', category: 'supplier', amount: 10, excluded: true }],
    });
    expect(summary.obligations).toBe(0);
    expect(summary.gap).toBe(10);
  });

  it('uses bank/cash table lines for KPIs so exclude reduces available cash', () => {
    const summary = computeCashBudgetSummary({
      openingBank: 100_000,
      openingCash: 20_000,
      lines: [
        { side: 'source', category: 'opening_bank', amount: 100_000, excluded: true },
        { side: 'source', category: 'opening_cash', amount: 20_000 },
        { side: 'source', category: 'collection', amount: 5_000 },
      ],
    });
    expect(summary.openingBank).toBe(0);
    expect(summary.openingCash).toBe(20_000);
    expect(summary.periodSources).toBe(5_000);
    expect(summary.gap).toBe(25_000);
  });
});

describe('mergeSuggestedLines', () => {
  it('keeps manual rows and excluded flags on matching auto origins', () => {
    const merged = mergeSuggestedLines(
      [
        {
          side: 'obligation',
          category: 'supplier',
          description: 'old auto',
          amount: 1,
          origin: 'auto',
          originType: 'purchase_invoice',
          originId: 'inv-1',
          excluded: true,
        },
        {
          side: 'obligation',
          category: 'other',
          description: 'manual rent',
          amount: 500,
          origin: 'manual',
          originType: 'manual',
          originId: 'm1',
        },
      ],
      [
        {
          side: 'obligation',
          category: 'supplier',
          description: 'refreshed',
          amount: 9,
          originType: 'purchase_invoice',
          originId: 'inv-1',
        },
      ],
    );
    expect(merged).toHaveLength(2);
    expect(merged[0].amount).toBe(9);
    expect(merged[0].excluded).toBe(true);
    expect(merged[1].origin).toBe('manual');
    expect(merged[1].amount).toBe(500);
  });
});

describe('GL leaf classification', () => {
  it('classifies 8-digit cash, payable, and receivable leaves', () => {
    expect(isBankLeafCode('12101001')).toBe(true);
    expect(isCustodyCashLeafCode('12102001')).toBe(true);
    expect(isCustodyFundAccount({ accountCode: '12102001', accountName: 'صندوق الشركة' })).toBe(true);
    expect(isCustodyFundAccount({ accountCode: '12101001', accountName: 'بنك' })).toBe(false);
    expect(isSupplierLeafCode('21101002')).toBe(true);
    expect(isSubcontractorLeafCode('21102001')).toBe(true);
    expect(isClientReceivableLeafCode('12201001')).toBe(true);
    expect(isSalariesPayableLeafCode('21501003')).toBe(true);
    expect(isSupplierLeafCode('21102')).toBe(false);
  });

  it('takes supplier/subcontractor/payroll payable from the credit net', () => {
    expect(liabilityPayableAmount(-80_000)).toBe(80_000);
    expect(liabilityPayableAmount(12_000)).toBe(0);
    expect(liabilityPayableAmount(0)).toBe(0);
  });
});

describe('allocatePayableByCostCenter', () => {
  it('splits ماي فارم 120000 into Concord villa 50000 and Arkman villa 70000', () => {
    const rows = allocatePayableByCostCenter([
      { costCenterId: 'concord-villa', netDebit: -50_000 },
      { costCenterId: 'arkman-villa', netDebit: -70_000 },
    ]);
    expect(rows).toHaveLength(2);
    const byId = Object.fromEntries(rows.map((r) => [r.costCenterId, r.amount]));
    expect(byId['concord-villa']).toBe(50_000);
    expect(byId['arkman-villa']).toBe(70_000);
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(120_000);
  });

  it('keeps a single cost center as one row', () => {
    expect(allocatePayableByCostCenter([{ costCenterId: 'cc-1', netDebit: -12_000 }])).toEqual([
      { costCenterId: 'cc-1', amount: 12_000 },
    ]);
  });
});

describe('distributableBankAndCashPool', () => {
  it('uses banks only and skips all 12102 cash/custody and uncollected IPCs', () => {
    const pool = distributableBankAndCashPool(
      [
        { category: 'opening_bank', amount: 70_000 },
        { category: 'opening_cash', originId: '12102001::_', amount: 10_000 },
        { category: 'opening_cash', originId: '12102002::_', amount: 8_000 },
        { category: 'opening_custody', originId: '12102003::_', amount: 4_000 },
        { category: 'collection', originId: '12201001::_', amount: 40_000 },
      ],
      new Set(['12102002']),
    );
    expect(pool).toBe(70_000);
  });
});

describe('distributePoolByAccountWeight', () => {
  it('allocates by account weight then splits cost-center rows', () => {
    const map = distributePoolByAccountWeight(
      [
        { id: 'a', originType: 'gl_leaf', originId: '21101010::c1', description: 'ماي فارم', amount: 50_000, side: 'obligation', category: 'supplier' },
        { id: 'b', originType: 'gl_leaf', originId: '21101010::c2', description: 'ماي فارم', amount: 70_000, side: 'obligation', category: 'supplier' },
        { id: 'c', originType: 'gl_leaf', originId: '21101011::_', description: 'مورد آخر', amount: 80_000, side: 'obligation', category: 'supplier' },
      ],
      80_000,
    );
    expect(map.get('a')).toBe(20_000);
    expect(map.get('b')).toBe(28_000);
    expect(map.get('c')).toBe(32_000);
  });

  it('pays each obligation in full when cash exceeds what is owed', () => {
    const map = distributePoolByAccountWeight(
      [
        { id: 'a', originType: 'gl_leaf', originId: '21101010::c1', description: 'ماي فارم', amount: 50_000, side: 'obligation', category: 'supplier' },
        { id: 'b', originType: 'gl_leaf', originId: '21101010::c2', description: 'ماي فارم', amount: 70_000, side: 'obligation', category: 'supplier' },
        { id: 'c', originType: 'gl_leaf', originId: '21101011::_', description: 'مورد آخر', amount: 80_000, side: 'obligation', category: 'supplier' },
      ],
      344_379.96,
    );
    expect(map.get('a')).toBe(50_000);
    expect(map.get('b')).toBe(70_000);
    expect(map.get('c')).toBe(80_000);
  });

  it('skips custody replenish lines', () => {
    const map = distributePoolByAccountWeight(
      [
        { id: 'a', originType: 'gl_leaf', originId: '21101010::_', description: 'ماي فارم', amount: 100, side: 'obligation', category: 'supplier' },
        { id: 'r', originType: 'custody_min', originId: 'x', description: 'عهدة', amount: 100, side: 'obligation', category: 'custody_replenish' },
      ],
      50,
    );
    expect(map.get('a')).toBe(50);
    expect(map.get('r')).toBe(0);
  });
});

describe('subAccountLabel', () => {
  it('keeps only the leaf name from a prefixed GL label', () => {
    expect(subAccountLabel('مقاولو باطن — مقاولو الباطن - ماي فارم (21102002)', '21102002')).toBe('ماي فارم');
    expect(subAccountLabel('مقاولو الباطن - ماي فارم', '21102002')).toBe('ماي فارم');
    expect(subAccountLabel('كمبوست الزهرة', '21101002')).toBe('كمبوست الزهرة');
  });
});

describe('lineCostCenterId', () => {
  it('reads the id after :: when contractId is empty', () => {
    expect(lineCostCenterId({ originId: '21102002::cc-1', contractId: null })).toBe('cc-1');
    expect(lineCostCenterId({ originId: '21102002::_', contractId: '' })).toBe(null);
    expect(lineCostCenterId({ originId: '21102002::cc-1', contractId: 'stored' })).toBe('stored');
  });
});

describe('summarizeAllocationByCostCenter', () => {
  it('totals obligation and allocated cash per cost center', () => {
    const rows = summarizeAllocationByCostCenter([
      { side: 'obligation', amount: 50_000, allocatedCash: 20_000, costCenterName: 'كونكورد فيلا', contractId: 'a' },
      { side: 'obligation', amount: 70_000, allocatedCash: 28_000, costCenterName: 'أركمن فيلا', contractId: 'b' },
      { side: 'obligation', amount: 80_000, allocatedCash: 32_000, costCenterName: 'كونكورد فيلا', contractId: 'a' },
      { side: 'obligation', excluded: true, amount: 9_000, allocatedCash: 1, costCenterName: 'كونكورد فيلا', contractId: 'a' },
    ]);
    expect(rows).toHaveLength(2);
    const concord = rows.find((r) => r.name === 'كونكورد فيلا');
    const arkman = rows.find((r) => r.name === 'أركمن فيلا');
    expect(concord?.obligation).toBe(130_000);
    expect(concord?.allocated).toBe(52_000);
    expect(arkman?.obligation).toBe(70_000);
    expect(arkman?.allocated).toBe(28_000);
    expect(concord?.pct).toBe(65);
    expect(arkman?.pct).toBe(35);
  });

  it('merges unlabeled project rows into one total', () => {
    const rows = summarizeAllocationByCostCenter([
      { side: 'obligation', amount: 100, allocatedCash: 10, costCenterName: '—', contractId: 'x' },
      { side: 'obligation', amount: 50, allocatedCash: 5, costCenterName: '', contractId: 'y' },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.obligation).toBe(150);
    expect(rows[0]?.allocated).toBe(15);
  });
});

describe('allocationSharePct', () => {
  it('is allocated over the pool', () => {
    expect(allocationSharePct(20_000, 80_000)).toBe(25);
    expect(allocationSharePct(0, 80_000)).toBe(0);
    expect(allocationSharePct(10, 0)).toBe(0);
  });
});
