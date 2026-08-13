import { describe, expect, it } from 'vitest';
import { systemIdleReached } from './systemIdle';

describe('systemIdleReached', () => {
  it('locks at the 3-minute OS idle threshold', () => {
    const idleMs = 3 * 60 * 1000;
    expect(systemIdleReached(179, idleMs)).toBe(false);
    expect(systemIdleReached(180, idleMs)).toBe(true);
    expect(systemIdleReached(181, idleMs)).toBe(true);
  });

  it('rejects invalid idle readings', () => {
    expect(systemIdleReached(Number.NaN, 1000)).toBe(false);
    expect(systemIdleReached(-1, 1000)).toBe(false);
  });
});
