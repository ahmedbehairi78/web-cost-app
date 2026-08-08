import { describe, expect, it } from 'vitest';
import { AccountCodes } from '../services/accountingService';
import {
  cashAndBankBalanceFromGlTxs,
  computeLiquidityContractRow,
  computePortfolioPendingBilling,
  contractCountByProject,
  dashboardCollectionAmount,
  dashboardCollectionAmountForTx,
  dashboardIpcCollectionAmountForTx,
  glTxsForContractAnalysis,
  sumDashboardIpcCollectionsFromGlTxs,
} from './liquidityMetrics';

describe('dashboardCollectionAmountForTx', () => {
  it('counts direct bank collection with receivable credit', () => {
    const amt = dashboardCollectionAmountForTx({
      entries: [
        { accountCode: AccountCodes.BANK, debit: 60000, credit: 0 },
        { accountCode: AccountCodes.RECEIVABLES, debit: 0, credit: 60000 },
      ],
    });
    expect(amt).toBe(60000);
  });

  it('counts direct bank collection with advance payment credit', () => {
    const amt = dashboardCollectionAmountForTx({
      entries: [
        { accountCode: AccountCodes.BANK, debit: 60000, credit: 0 },
        { accountCode: AccountCodes.ADVANCE_PAYMENT, debit: 0, credit: 60000 },
      ],
    });
    expect(amt).toBe(60000);
  });

  it('does not count received cheque ISS leg (cash not in bank yet)', () => {
    const amt = dashboardCollectionAmountForTx({
      reference: 'CH-RECEIVED-cheque1-ISS',
      entries: [
        { accountCode: AccountCodes.RECEIVED_CHEQUES_CLEARING, debit: 60000, credit: 0 },
        { accountCode: AccountCodes.RECEIVABLES, debit: 0, credit: 60000 },
      ],
    });
    expect(amt).toBe(0);
  });

  it('counts CLR when paired ISS is pure receivable collection', () => {
    const glTxs = [
      {
        reference: 'CH-RECEIVED-cheque1-ISS',
        entries: [
          { accountCode: AccountCodes.RECEIVED_CHEQUES_CLEARING, debit: 60000, credit: 0 },
          { accountCode: AccountCodes.RECEIVABLES, debit: 0, credit: 60000 },
        ],
      },
      {
        reference: 'CH-RECEIVED-cheque1-CLR',
        entries: [
          { accountCode: AccountCodes.BANK, debit: 60000, credit: 0 },
          { accountCode: AccountCodes.RECEIVED_CHEQUES_CLEARING, debit: 0, credit: 60000 },
        ],
      },
    ];
    expect(dashboardCollectionAmountForTx(glTxs[1], glTxs)).toBe(60000);
    expect(sumDashboardIpcCollectionsFromGlTxs(glTxs)).toBe(60000);
  });

  it('does not count CLR when paired ISS mixes receivable and VAT output', () => {
    const glTxs = [
      {
        reference: 'CH-RECEIVED-cheque2-ISS',
        entries: [
          { accountCode: AccountCodes.RECEIVED_CHEQUES_CLEARING, debit: 308655.47, credit: 0 },
          { accountCode: AccountCodes.RECEIVABLES, debit: 0, credit: 264154.47 },
          { accountCode: AccountCodes.VAT_OUTPUT, debit: 0, credit: 44501 },
        ],
      },
      {
        reference: 'CH-RECEIVED-cheque2-CLR',
        entries: [
          { accountCode: AccountCodes.BANK, debit: 308655.47, credit: 0 },
          { accountCode: AccountCodes.RECEIVED_CHEQUES_CLEARING, debit: 0, credit: 308655.47 },
        ],
      },
    ];
    expect(dashboardCollectionAmountForTx(glTxs[1], glTxs)).toBe(0);
  });

  it('does not count CLR leg alone without paired ISS', () => {
    const amt = dashboardCollectionAmountForTx({
      reference: 'CH-RECEIVED-cheque3-CLR',
      entries: [
        { accountCode: AccountCodes.BANK, debit: 60000, credit: 0 },
        { accountCode: AccountCodes.RECEIVED_CHEQUES_CLEARING, debit: 0, credit: 60000 },
      ],
    });
    expect(amt).toBe(0);
  });

  it('does not count partner current account bank injection (314)', () => {
    const amt = dashboardCollectionAmountForTx({
      entries: [
        { accountCode: AccountCodes.BANK, debit: 500000, credit: 0 },
        { accountCode: '31401001', debit: 0, credit: 500000 },
      ],
    });
    expect(amt).toBe(0);
  });

  it('dashboardIpcCollectionAmountForTx excludes advance-only direct bank receipt', () => {
    const tx = {
      entries: [
        { accountCode: AccountCodes.BANK, debit: 60000, credit: 0 },
        { accountCode: AccountCodes.ADVANCE_PAYMENT, debit: 0, credit: 60000 },
      ],
    };
    expect(dashboardCollectionAmountForTx(tx)).toBe(60000);
    expect(dashboardIpcCollectionAmountForTx(tx)).toBe(0);
  });

  it('legacy dashboardCollectionAmount counts direct bank + advance', () => {
    const amt = dashboardCollectionAmount([
      { accountCode: AccountCodes.BANK, debit: 60000, credit: 0 },
      { accountCode: AccountCodes.ADVANCE_PAYMENT, debit: 0, credit: 60000 },
    ]);
    expect(amt).toBe(60000);
  });
});

describe('computeLiquidityContractRow — cheque pairing', () => {
  const contract = { id: 'contract-arkmen', projectId: 'proj-1' };
  const countMap = contractCountByProject([contract]);

  it('attributes CLR advance to contract when ISS+CLR paired', () => {
    const glTxs = [
      {
        reference: 'CH-RECEIVED-cheque1-ISS',
        entries: [
          { accountCode: AccountCodes.RECEIVED_CHEQUES_CLEARING, debit: 60000, credit: 0 },
          { accountCode: AccountCodes.ADVANCE_PAYMENT, debit: 0, credit: 60000 },
        ],
      },
      {
        reference: 'CH-RECEIVED-cheque1-CLR',
        costCenterId: 'contract-arkmen',
        projectId: 'proj-1',
        entries: [
          { accountCode: AccountCodes.BANK, debit: 60000, credit: 0 },
          { accountCode: AccountCodes.RECEIVED_CHEQUES_CLEARING, debit: 0, credit: 60000 },
        ],
      },
    ];

    const paired = glTxsForContractAnalysis(glTxs, contract, countMap);
    expect(paired).toHaveLength(2);

    const row = computeLiquidityContractRow(contract, [], glTxs, countMap);
    expect(row.totalAdvances).toBe(60000);
    expect(row.totalCollected).toBe(60000);
    expect(row.ipcCollected).toBe(0);
  });

  it('classifies numeric advance accountCode on CLR leg', () => {
    const glTxs = [
      {
        reference: 'CH-RECEIVED-cheque2-ISS',
        entries: [
          { accountCode: AccountCodes.RECEIVED_CHEQUES_CLEARING, debit: 60000, credit: 0 },
          { accountCode: 21301001, debit: 0, credit: 60000 },
        ],
      },
      {
        reference: 'CH-RECEIVED-cheque2-CLR',
        costCenterId: 'contract-arkmen',
        projectId: 'proj-1',
        entries: [
          { accountCode: AccountCodes.BANK, debit: 60000, credit: 0 },
          { accountCode: AccountCodes.RECEIVED_CHEQUES_CLEARING, debit: 0, credit: 60000 },
        ],
      },
    ];
    const row = computeLiquidityContractRow(contract, [], glTxs, countMap);
    expect(row.totalAdvances).toBe(60000);
  });

  it('does not zero uncollected when client advances exceed billed but IPC netPayable is due', () => {
    const billing = [
      {
        contractId: 'contract-arkmen',
        status: 'approved',
        worksValueExVat: 500000,
        vatAmount: 70000,
        netPayable: 450000,
        retentionAmount: 25000,
      },
    ];
    const glTxs = [
      {
        reference: 'CH-RECEIVED-adv-ISS',
        costCenterId: 'contract-arkmen',
        projectId: 'proj-1',
        entries: [
          { accountCode: AccountCodes.RECEIVED_CHEQUES_CLEARING, debit: 600000, credit: 0 },
          { accountCode: AccountCodes.ADVANCE_PAYMENT, debit: 0, credit: 600000 },
        ],
      },
    ];
    const row = computeLiquidityContractRow(contract, billing, glTxs, countMap);
    expect(row.totalAdvances).toBe(0);
    expect(row.ipcCollected).toBe(0);
    expect(row.uncollected).toBe(450000);
  });

  it('includes review-status IPCs in uncollected', () => {
    const billing = [
      {
        contractId: 'contract-arkmen',
        status: 'review',
        worksValueExVat: 100000,
        vatAmount: 14000,
        netPayable: 90000,
      },
    ];
    const row = computeLiquidityContractRow(contract, billing, [], countMap);
    expect(row.uncollected).toBe(90000);
  });

  it('uncollected follows 12201 GL balance when cheque ISS credits receivables', () => {
    const billing = [
      {
        contractId: 'contract-arkmen',
        status: 'approved',
        worksValueExVat: 500000,
        vatAmount: 70000,
        netPayable: 450000,
      },
    ];
    const glTxs = [
      {
        costCenterId: 'contract-arkmen',
        projectId: 'proj-1',
        entries: [
          { accountCode: AccountCodes.RECEIVABLES, debit: 450000, credit: 0 },
          { accountCode: AccountCodes.REVENUE, debit: 0, credit: 500000 },
        ],
      },
      {
        reference: 'CH-RECEIVED-col1-ISS',
        costCenterId: 'contract-arkmen',
        projectId: 'proj-1',
        entries: [
          { accountCode: AccountCodes.RECEIVED_CHEQUES_CLEARING, debit: 200000, credit: 0 },
          { accountCode: AccountCodes.RECEIVABLES, debit: 0, credit: 200000 },
        ],
      },
      {
        reference: 'CH-RECEIVED-col1-CLR',
        costCenterId: 'contract-arkmen',
        projectId: 'proj-1',
        entries: [
          { accountCode: AccountCodes.BANK, debit: 200000, credit: 0 },
          { accountCode: AccountCodes.RECEIVED_CHEQUES_CLEARING, debit: 0, credit: 200000 },
        ],
      },
    ];
    const row = computeLiquidityContractRow(contract, billing, glTxs, countMap);
    expect(row.ipcCollected).toBe(200000);
    expect(row.uncollected).toBe(250000);
  });
});

describe('computePortfolioPendingBilling', () => {
  it('uses global 12201 balance when receivable GL activity exists', () => {
    const glTxs = [
      {
        costCenterId: 'c1',
        entries: [
          { accountCode: AccountCodes.RECEIVABLES, debit: 100000, credit: 0 },
          { accountCode: AccountCodes.REVENUE, debit: 0, credit: 100000 },
        ],
      },
      {
        costCenterId: 'c2',
        entries: [
          { accountCode: AccountCodes.RECEIVABLES, debit: 50000, credit: 0 },
          { accountCode: AccountCodes.REVENUE, debit: 0, credit: 50000 },
        ],
      },
    ];
    expect(computePortfolioPendingBilling(glTxs, 999)).toBe(150000);
  });

  it('falls back to contract uncollected sum when no 12201 activity', () => {
    expect(computePortfolioPendingBilling([], 42000)).toBe(42000);
  });
});

describe('cashAndBankBalanceFromGlTxs', () => {
  it('sums net debit on 121… accounts', () => {
    const balance = cashAndBankBalanceFromGlTxs([
      {
        entries: [
          { accountCode: AccountCodes.BANK, debit: 1000, credit: 0 },
          { accountCode: AccountCodes.RECEIVABLES, debit: 0, credit: 1000 },
        ],
      },
      {
        entries: [
          { accountCode: AccountCodes.BANK, debit: 0, credit: 200 },
          { accountCode: AccountCodes.EXPENSE_MATERIALS, debit: 200, credit: 0 },
        ],
      },
    ]);
    expect(balance).toBe(800);
  });
});
