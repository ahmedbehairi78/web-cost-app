import { describe, expect, it } from 'vitest';
import {
  isCashPaymentSourceAccount,
  sumContractorCashPaymentsFromJournals,
} from './contractorCashPayments.js';

describe('contractorCashPayments', () => {
  it('recognizes bank, cash/custody, and issued-cheque sources', () => {
    expect(isCashPaymentSourceAccount('12101001')).toBe(true);
    expect(isCashPaymentSourceAccount('12102001')).toBe(true);
    expect(isCashPaymentSourceAccount('21601001')).toBe(true);
    expect(isCashPaymentSourceAccount('51103001')).toBe(false);
    expect(isCashPaymentSourceAccount('21102005')).toBe(false);
  });

  it('sums contractor debit lines for cost center and unallocated bank transfers', () => {
    const txs = [
      {
        costCenterId: 'c1',
        entries: [
          { accountCode: '21102005', debit: 400, credit: 0, costCenterId: 'c1' },
          { accountCode: '12101001', debit: 0, credit: 400 },
        ],
      },
      {
        costCenterId: 'c1',
        entries: [
          { accountCode: '21102005', debit: 150, credit: 0 },
          { accountCode: '12102001', debit: 0, credit: 150 },
        ],
      },
      {
        costCenterId: 'c1',
        entries: [
          { accountCode: '21102005', debit: 200, credit: 0 },
          { accountCode: '21601001', debit: 0, credit: 200 },
        ],
      },
      {
        // accrual — not cash
        costCenterId: 'c1',
        entries: [
          { accountCode: '21102005', debit: 999, credit: 0, costCenterId: 'c1' },
          { accountCode: '51103001', debit: 0, credit: 999 },
        ],
      },
      {
        // split payment — only c1 line
        costCenterId: null,
        entries: [
          { accountCode: '21102005', debit: 300, credit: 0, costCenterId: 'c1' },
          { accountCode: '21102005', debit: 100, credit: 0, costCenterId: 'c2' },
          { accountCode: '12101001', debit: 0, credit: 400 },
        ],
      },
      {
        // bank transfer with no cost center (common) — still المسدد
        costCenterId: null,
        projectId: null,
        entries: [
          { accountCode: '21102005', debit: 500, credit: 0 },
          { accountCode: '12101001', debit: 0, credit: 500 },
        ],
      },
      {
        // other project — excluded when projectIds scoped
        costCenterId: null,
        projectId: 'p-other',
        entries: [
          { accountCode: '21102005', debit: 77, credit: 0 },
          { accountCode: '12101001', debit: 0, credit: 77 },
        ],
      },
      {
        // same project, no CC — included when projectIds = [p1]
        costCenterId: null,
        projectId: 'p1',
        entries: [
          { accountCode: '21102005', debit: 25, credit: 0 },
          { accountCode: '12101001', debit: 0, credit: 25 },
        ],
      },
    ];

    const c1 = sumContractorCashPaymentsFromJournals(txs, '21102005', ['c1'], {
      projectIds: ['p1'],
    });
    // allocated: 400+150+200+300 = 1050; unallocated: 500+25 = 525; not 77
    expect(c1.paid).toBe(1575);
    expect(c1.byCostCenter.c1).toBe(1050);
    expect(c1.unallocated).toBe(525);

    const both = sumContractorCashPaymentsFromJournals(txs, '21102005', ['c1', 'c2'], {
      projectIds: ['p1'],
    });
    expect(both.byCostCenter.c2).toBe(100);
    expect(both.paid).toBe(1675);
  });
});
