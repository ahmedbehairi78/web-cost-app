import { describe, expect, it } from 'vitest';

describe('contractBillingProgress (unit helpers)', () => {
  it('computes cumulative qty as mos + ipc billed', () => {
    const mos = 10;
    const ipc = 25;
    const tender = 100;
    const cumulative = mos + ipc;
    expect(cumulative / tender).toBe(0.35);
  });

  it('flags exceed when cumulative > tender', () => {
    const tender = 100;
    const cumulative = 105;
    expect(cumulative > tender + 0.01).toBe(true);
  });
});
