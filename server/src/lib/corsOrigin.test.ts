import { describe, expect, it } from 'vitest';
import {
  assertProductionCorsOrigin,
  isAllowedCorsOrigin,
  isDevAllowedOrigin,
} from './corsOrigin.js';

describe('isDevAllowedOrigin', () => {
  it('allows localhost and 127.0.0.1 on any port', () => {
    expect(isDevAllowedOrigin('http://localhost:3000')).toBe(true);
    expect(isDevAllowedOrigin('http://127.0.0.1:3002')).toBe(true);
  });

  it('allows private LAN HTTP', () => {
    expect(isDevAllowedOrigin('http://192.168.1.10:3000')).toBe(true);
    expect(isDevAllowedOrigin('http://10.0.0.5')).toBe(true);
  });

  it('rejects public hosts', () => {
    expect(isDevAllowedOrigin('https://evil.example')).toBe(false);
  });
});

describe('isAllowedCorsOrigin', () => {
  const prod = { nodeEnv: 'production', corsOrigin: 'https://app.example.com' };

  it('allows missing Origin in production (same-origin / curl)', () => {
    expect(isAllowedCorsOrigin(undefined, prod)).toBe(true);
    expect(isAllowedCorsOrigin('', prod)).toBe(true);
  });

  it('allows the configured production origin only', () => {
    expect(isAllowedCorsOrigin('https://app.example.com', prod)).toBe(true);
    expect(isAllowedCorsOrigin('https://evil.example', prod)).toBe(false);
  });

  it('does not allow every origin when corsOrigin is empty in production', () => {
    expect(isAllowedCorsOrigin('https://evil.example', { nodeEnv: 'production', corsOrigin: '' })).toBe(
      false,
    );
  });

  it('allows localhost in development without matching CORS_ORIGIN', () => {
    expect(
      isAllowedCorsOrigin('http://localhost:3002', { nodeEnv: 'development', corsOrigin: 'http://localhost:3000' }),
    ).toBe(true);
  });
});

describe('assertProductionCorsOrigin', () => {
  it('throws when unset', () => {
    expect(() => assertProductionCorsOrigin('')).toThrow(/CORS_ORIGIN/);
  });

  it('passes when set', () => {
    expect(() => assertProductionCorsOrigin('https://app.example.com')).not.toThrow();
  });
});
