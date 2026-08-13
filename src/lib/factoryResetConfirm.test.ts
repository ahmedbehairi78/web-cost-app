import { describe, expect, it } from 'vitest';
import { isFactoryResetConfirmWord } from './factoryResetConfirm';

describe('isFactoryResetConfirmWord', () => {
  it('accepts FACTORY in any case and surrounding spaces', () => {
    expect(isFactoryResetConfirmWord('FACTORY')).toBe(true);
    expect(isFactoryResetConfirmWord('Factory')).toBe(true);
    expect(isFactoryResetConfirmWord(' factory ')).toBe(true);
  });

  it('accepts the Arabic confirm phrase', () => {
    expect(isFactoryResetConfirmWord('ضبط المصنع')).toBe(true);
    expect(isFactoryResetConfirmWord('  ضبط المصنع  ')).toBe(true);
  });

  it('rejects other text', () => {
    expect(isFactoryResetConfirmWord('DELETE')).toBe(false);
    expect(isFactoryResetConfirmWord('حذف')).toBe(false);
    expect(isFactoryResetConfirmWord('')).toBe(false);
  });
});
