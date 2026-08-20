import { describe, expect, it } from 'vitest';
import { confirmSessionLostAfterUnauthorized } from './apiSession';

describe('confirmSessionLostAfterUnauthorized', () => {
  it('keeps the session when a later probe succeeds (Railway bounce)', async () => {
    const calls = { n: 0 };
    const lost = await confirmSessionLostAfterUnauthorized(
      async () => {
        calls.n += 1;
        if (calls.n < 2) throw new Error('502');
        return { authenticated: true };
      },
      { attempts: 3, delayMs: 0 },
    );
    expect(lost).toBe(false);
    expect(calls.n).toBe(2);
  });

  it('does not log out when every probe fails with a network error', async () => {
    const lost = await confirmSessionLostAfterUnauthorized(
      async () => {
        throw new Error('network');
      },
      { attempts: 3, delayMs: 0 },
    );
    expect(lost).toBe(false);
  });

  it('treats the session as lost only after explicit unauthenticated probes', async () => {
    const lost = await confirmSessionLostAfterUnauthorized(
      async () => ({ authenticated: false }),
      { attempts: 2, delayMs: 0 },
    );
    expect(lost).toBe(true);
  });
});
