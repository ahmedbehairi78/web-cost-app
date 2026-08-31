import { describe, expect, it } from 'vitest';
import { roundMoney } from './money';
import {
  isServiceContractor,
  previousQtyFromApproved,
  uniqueBoqChapters,
  serviceKindExpenseAccount,
  netQty,
  displayServiceIpcNumber,
  serviceIpcPrintTitle,
  computeServiceIpcCertificateSummary,
  sumContractorCashPaymentsFromGl,
  resolveContractorAccountCode,
} from './serviceContractor';

describe('serviceContractor', () => {
  it('treats labour/equipment/vehicles/housing as service contractors', () => {
    expect(isServiceContractor({ type: 'subcontractor', serviceKind: 'labour' })).toBe(true);
    expect(isServiceContractor({ type: 'subcontractor', serviceKind: 'works' })).toBe(false);
    expect(isServiceContractor({ type: 'subcontractor' })).toBe(false);
    expect(isServiceContractor({ type: 'supplier', serviceKind: 'labour' })).toBe(false);
  });

  it('maps expense accounts by service kind', () => {
    expect(serviceKindExpenseAccount('labour')).toBe('51102001');
    expect(serviceKindExpenseAccount('equipment')).toBe('51104001');
    expect(serviceKindExpenseAccount('vehicles')).toBe('51104001');
    expect(serviceKindExpenseAccount('housing')).toBe('51103001');
  });

  it('sums previous qty from matching approved lines', () => {
    expect(
      previousQtyFromApproved(
        [
          { contractId: 'c1', chapterCode: 'A', description: 'عامل', currentQty: 4 },
          { contractId: 'c1', chapterCode: 'A', description: 'عامل', currentQty: 2 },
          { contractId: 'c2', chapterCode: 'A', description: 'عامل', currentQty: 9 },
        ],
        { contractId: 'c1', chapterCode: 'A', description: 'عامل' },
      ),
    ).toBe(6);
  });

  it('hides UUID certificate numbers', () => {
    expect(displayServiceIpcNumber('4cf84bb2-1ae8-435d-a886-20b20ed03fdc')).toBe('');
    expect(displayServiceIpcNumber('', '4cf84bb2-1ae8-435d-a886-20b20ed03fdc')).toBe('');
    expect(displayServiceIpcNumber('مستخلص محمد الشيخ-001-2026')).toBe('مستخلص محمد الشيخ-001-2026');
  });

  it('uses the per-supplier year number as the title', () => {
    expect(
      serviceIpcPrintTitle({
        contractorName: 'محمد الشيخ',
        documentNumber: 'مستخلص محمد الشيخ-001-2026',
        statusLabel: 'معتمد',
        language: 'ar',
      }),
    ).toBe('مستخلص محمد الشيخ-001-2026 (معتمد)');
    expect(
      serviceIpcPrintTitle({
        contractorName: 'تامر يسري',
        documentNumber: 'مستخلص تامر يسري-001-2026',
        statusLabel: 'معتمد',
        language: 'ar',
      }),
    ).toBe('مستخلص تامر يسري-001-2026 (معتمد)');
  });

  it('lists unique BOQ chapters per contract', () => {
    const chapters = uniqueBoqChapters(
      [
        { contractId: 'c1', chapterCode: '02', chapterName: 'كهرباء' },
        { contractId: 'c1', chapterCode: '01', chapterName: 'مدني' },
        { contractId: 'c1', chapterCode: '02', chapterName: 'كهرباء' },
        { contractId: 'c2', chapterCode: '09', chapterName: 'أخرى' },
      ],
      'c1',
    );
    expect(chapters.map((c) => c.code)).toEqual(['01', '02']);
  });

  it('nets previous + current qty', () => {
    expect(netQty(3, 2)).toBe(5);
  });

  it('builds certificate summary on total works then subtracts previous payments', () => {
    const summary = computeServiceIpcCertificateSummary(
      [
        { previousQty: 10, currentQty: 5, rate: 100 },
        { previousQty: 0, currentQty: 2, rate: 50 },
      ],
      {
        vatPct: 14,
        execGuaranteePct: 5,
        labourInsurancePct: 5,
        whtPct: 1,
        manpowerLevyPct: 0,
      },
      200,
    );
    expect(summary.previousWorks).toBe(1000);
    expect(summary.currentWorks).toBe(600);
    expect(summary.totalWorks).toBe(1600);
    expect(summary.vatToDate).toBe(224);
    expect(summary.execGuaranteeToDate).toBe(80);
    expect(summary.labourInsuranceToDate).toBe(80);
    expect(summary.whtToDate).toBe(16);
    expect(summary.previousPayments).toBe(0);
    expect(summary.amountDue).toBe(roundMoney(summary.netAfterDeductions - 200));
  });

  it('uses explicit GL cash payments as المسدد including zero', () => {
    const pcts = {
      vatPct: 14,
      execGuaranteePct: 5,
      labourInsurancePct: 5,
      whtPct: 1,
      manpowerLevyPct: 0,
    };
    const lines = [{ previousQty: 10, currentQty: 5, rate: 100 }];
    expect(computeServiceIpcCertificateSummary(lines, pcts, 0, 0).previousPayments).toBe(0);
    expect(computeServiceIpcCertificateSummary(lines, pcts, 0, 250).previousPayments).toBe(250);
  });

  it('sums contractor cash Dr per debit line cost center and unallocated bank transfers', () => {
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
          { accountCode: '21102005', debit: 150, credit: 0, costCenterId: 'c1' },
          { accountCode: '12102001', debit: 0, credit: 150 },
        ],
      },
      {
        // issued cheque ISS: Dr contractor / Cr 21601 — cost center on header only
        costCenterId: 'c1',
        entries: [
          { accountCode: '21102005', debit: 200, credit: 0 },
          { accountCode: '21601001', debit: 0, credit: 200 },
        ],
      },
      {
        // IPC reverse / expense — not cash
        costCenterId: 'c1',
        entries: [
          { accountCode: '21102005', debit: 999, credit: 0, costCenterId: 'c1' },
          { accountCode: '51103001', debit: 0, credit: 999 },
        ],
      },
      {
        // split journal — only c1 line counts for c1
        entries: [
          { accountCode: '21102005', debit: 50, credit: 0, costCenterId: 'c1' },
          { accountCode: '21102005', debit: 80, credit: 0, costCenterId: 'c2' },
          { accountCode: '12101001', debit: 0, credit: 130 },
        ],
      },
      {
        // bank transfer without cost center — still counts
        costCenterId: null,
        projectId: null,
        entries: [
          { accountCode: '21102005', debit: 500, credit: 0 },
          { accountCode: '12101001', debit: 0, credit: 500 },
        ],
      },
    ];
    expect(sumContractorCashPaymentsFromGl(txs, '21102005', ['c1'])).toBe(1300);
    expect(sumContractorCashPaymentsFromGl(txs, '21102005', ['c1', 'c2'])).toBe(1380);
    expect(sumContractorCashPaymentsFromGl({ data: txs }, '21102005', ['c1'])).toBe(1300);
  });

  it('resolves contractor leaf code from COA id or supplierId', () => {
    const accounts = [
      { id: 'coa-1', accountCode: '21102005', supplierId: 'sup-9' },
    ];
    expect(resolveContractorAccountCode(accounts, 'coa-1')).toBe('21102005');
    expect(resolveContractorAccountCode(accounts, 'sup-9')).toBe('21102005');
    expect(resolveContractorAccountCode(accounts, '21102005')).toBe('21102005');
  });
});
