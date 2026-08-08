import { describe, expect, it } from 'vitest';
import { isMoneyBalanced, roundMoney } from './money.js';

describe('money rounding', () => {
  it('rounds to 2 decimal places', () => {
    expect(roundMoney(9471.576)).toBe(9471.58);
    expect(roundMoney(9471.574)).toBe(9471.57);
    expect(roundMoney(1000.5)).toBe(1000.5);
    expect(roundMoney(394.5)).toBe(394.5);
  });

  it('balances within cent tolerance', () => {
    expect(isMoneyBalanced(1000, 1000)).toBe(true);
    expect(isMoneyBalanced(1000.01, 1000)).toBe(false);
    expect(isMoneyBalanced(44973, 44973)).toBe(true);
  });
});
