import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  readLocalDefaultModule,
  resolveStoredDefaultModule,
  writeLocalDefaultModule,
} from './userPreferences';

describe('userPreferences default module storage', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    });
  });

  it('prefers server value over localStorage', () => {
    writeLocalDefaultModule('dashboard');
    expect(resolveStoredDefaultModule('none')).toBe('none');
  });

  it('falls back to localStorage when server is null', () => {
    writeLocalDefaultModule('none');
    expect(resolveStoredDefaultModule(null)).toBe('none');
  });

  it('writeLocalDefaultModule round-trips', () => {
    writeLocalDefaultModule('technical');
    expect(readLocalDefaultModule()).toBe('technical');
  });
});
