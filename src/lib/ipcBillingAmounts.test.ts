import { describe, expect, it } from 'vitest';
import { computeIpcBillingAmounts } from './ipcBillingAmounts';
import { defaultIpcCoverSheetRates } from './ipcCoverSheet';

describe('computeIpcBillingAmounts', () => {
  it('Cover NET = Sub-Total − % deductions − WHT(ex-VAT) − recovery − Previous Payments', () => {
    const amounts = computeIpcBillingAmounts({
      items: [
        { boqItemId: 'a', rate: 1140, previousQty: 0, currentQty: 10 }, // 11_400 to-date
      ],
      rates: defaultIpcCoverSheetRates({
        vatPct: 14,
        whtPct: 1,
        retentionPct: 5,
        performancePct: 5,
        insurancePct: 5,
        manpowerPct: 1,
        syndicatePct: 0.3,
      }),
      materialsOnSite: 0,
      advancePaymentRecovery: 100,
      backChargeAmount: 50,
      previousPayments: 0,
    });

    // Sub-Total = 11_400
    expect(amounts.subTotal).toBe(11_400);
    // WHT base = 11400/1.14 = 10_000 → WHT = 100
    expect(amounts.cover.deductions.find((d) => d.id === 'wht')?.amount).toBe(100);
    // Retention 5% of 11400 = 570
    expect(amounts.cover.deductions.find((d) => d.id === 'retention')?.amount).toBe(570);

    const dedSum = amounts.cover.deductions.reduce((s, d) => s + d.amount, 0);
    // 570+570+100+570+114+34.2+50 = 2008.2
    expect(amounts.net).toBeCloseTo(11_400 - dedSum - 100, 2);
  });

  it('second certificate: Previous Payments reduces NET; period GL uses current works only', () => {
    const amounts = computeIpcBillingAmounts({
      items: [
        // previous 10 + current 5 = 15 → to-date 17_100; period 5_700
        { boqItemId: 'a', rate: 1140, previousQty: 10, currentQty: 5 },
      ],
      rates: defaultIpcCoverSheetRates({
        vatPct: 14,
        whtPct: 1,
        retentionPct: 5,
        performancePct: 0,
        insurancePct: 0,
        manpowerPct: 0,
        syndicatePct: 0,
      }),
      previousPayments: 9_391.8, // prior cover net (example)
      advancePaymentRecovery: 0,
      backChargeAmount: 0,
    });

    expect(amounts.toDateWorksInclVat).toBe(17_100);
    expect(amounts.periodWorksInclVat).toBe(5_700);
    // Cover retention on Sub 17100 = 855; WHT on 15000 = 150
    expect(amounts.cover.deductions.find((d) => d.id === 'retention')?.amount).toBe(855);
    expect(amounts.cover.deductions.find((d) => d.id === 'wht')?.amount).toBe(150);
    // NET = 17100 - 855 - 150 - 9391.8 = 6703.2
    expect(amounts.net).toBeCloseTo(17_100 - 855 - 150 - 9_391.8, 2);
    // Period retention for GL = 5% × 5700
    expect(amounts.exec).toBe(285);
  });

  it('advance recovery to-date posts only the increment to GL', () => {
    const amounts = computeIpcBillingAmounts({
      items: [{ boqItemId: 'a', rate: 100, previousQty: 0, currentQty: 1 }],
      rates: defaultIpcCoverSheetRates({
        retentionPct: 0,
        performancePct: 0,
        insurancePct: 0,
        manpowerPct: 0,
        syndicatePct: 0,
        whtPct: 0,
      }),
      advancePaymentRecovery: 250,
      priorAdvanceRecoveryToDate: 100,
      previousPayments: 0,
    });
    expect(amounts.advance).toBe(150);
    expect(amounts.cover.advanceRecovery).toBe(250);
  });
});
