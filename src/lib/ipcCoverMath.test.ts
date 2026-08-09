import { describe, expect, it } from 'vitest';
import {
  buildIpcCoverWorkDoneBlock,
  coverWorkDoneSubTotal,
  coverWhtAmount,
  coverWhtBaseExVat,
} from './ipcCoverMath';

describe('ipcCoverMath', () => {
  it('Sub-Total is plain sum of VAT-inclusive lines (no extra VAT)', () => {
    // Excel: rates include VAT — Sub = Gross+Prov+VO+MOS+PriceAdj
    const block = buildIpcCoverWorkDoneBlock({
      grossBasic: 17_676_428.304528456,
      provisionalWorks: 31_492_970.975402668,
      approvedVoWorks: 0,
      materialsOnSite: 0,
      priceAdjustment: 495_780.351867624,
      vatPct: 14,
    });
    expect(block.subTotal).toBeCloseTo(49_665_179.63, 1);
    expect(
      block.grossBasic +
        block.provisionalWorks +
        block.approvedVoWorks +
        block.materialsOnSite +
        block.priceAdjustment,
    ).toBe(block.subTotal);
    // WHT strips VAT: (Sub − MOS) / 1.14
    expect(coverWhtBaseExVat(block.subTotal, 0, 14)).toBeCloseTo(43_565_947.05, 1);
    expect(coverWhtAmount(block.subTotal, 0, 14, 1)).toBeCloseTo(435_659.47, 1);
  });

  it('does not multiply works by 1.14 for Sub-Total', () => {
    const sub = coverWorkDoneSubTotal({
      grossBasic: 1000,
      approvedVoWorks: 200,
      materialsOnSite: 50,
      vatPct: 14,
    });
    expect(sub).toBe(1250);
  });

  it('excludes Materials On Site from WHT base', () => {
    const sub = coverWorkDoneSubTotal({
      grossBasic: 1140,
      materialsOnSite: 200,
      vatPct: 14,
    });
    expect(sub).toBe(1340);
    expect(coverWhtBaseExVat(sub, 200, 14)).toBe(1000);
    expect(coverWhtAmount(sub, 200, 14, 1)).toBe(10);
  });
});
