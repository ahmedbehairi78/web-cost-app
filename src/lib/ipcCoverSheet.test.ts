import { describe, expect, it } from 'vitest';
import { buildIpcCoverSheetModel, defaultIpcCoverSheetRates } from './ipcCoverSheet';

describe('ipcCoverSheet', () => {
  it('matches Excel Sub-Total sum and WHT strip without double VAT', () => {
    const sheet = buildIpcCoverSheetModel({
      grossBasic: 17_676_428.3,
      provisionalWorks: 31_492_970.98,
      priceAdjustment: 495_780.35,
      rates: defaultIpcCoverSheetRates({ vatPct: 14, whtPct: 1, retentionPct: 5 }),
      advancePaymentTotal: 10_459_171.5,
      advanceRecovery: 10_459_171.5,
      previousPayments: 0,
    });
    expect(sheet.subTotal).toBeCloseTo(49_665_179.63, 1);
    expect(sheet.deductions.find((d) => d.id === 'retention')?.amount).toBeCloseTo(2_483_258.98, 1);
    expect(sheet.deductions.find((d) => d.id === 'wht')?.amount).toBeCloseTo(435_659.47, 1);
    expect(sheet.advanceNet).toBe(0);
    // NET = Sub − deductions − advance recovery − PP
    const ded = sheet.deductions.reduce((s, d) => s + d.amount, 0);
    expect(sheet.netPayable).toBeCloseTo(sheet.subTotal - ded - sheet.advanceRecovery, 1);
  });

  it('uses identical Sub-Total for panel and print inputs', () => {
    const input = {
      grossBasic: 1000,
      approvedVoWorks: 200,
      materialsOnSite: 50,
      rates: defaultIpcCoverSheetRates(),
    };
    const a = buildIpcCoverSheetModel(input);
    const b = buildIpcCoverSheetModel(input);
    expect(a).toEqual(b);
    expect(a.subTotal).toBe(1250);
  });

  it('subtracts Previous Payments from NET', () => {
    const sheet = buildIpcCoverSheetModel({
      grossBasic: 10_000,
      rates: defaultIpcCoverSheetRates({
        retentionPct: 10,
        performancePct: 0,
        insurancePct: 0,
        manpowerPct: 0,
        syndicatePct: 0,
        whtPct: 0,
        vatPct: 14,
      }),
      previousPayments: 3_000,
    });
    // Sub 10000 − retention 1000 − PP 3000 = 6000
    expect(sheet.netPayable).toBe(6_000);
  });
});
