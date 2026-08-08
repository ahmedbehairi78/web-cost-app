import { describe, expect, it } from 'vitest';
import { normalizePhoneE164, isValidPhoneE164 } from './phoneE164.js';
import { hashApprovalToken, generateApprovalTokenPlain } from './approvalLinkToken.js';

describe('normalizePhoneE164', () => {
  it('normalizes Egyptian mobile 01…', () => {
    expect(normalizePhoneE164('01012345678')).toBe('+201012345678');
  });

  it('normalizes +020… typo prefix', () => {
    expect(normalizePhoneE164('+0201012345678')).toBe('+201012345678');
  });

  it('accepts already valid E.164', () => {
    expect(normalizePhoneE164('+201012345678')).toBe('+201012345678');
    expect(isValidPhoneE164('+201012345678')).toBe(true);
  });
});

describe('approvalLinkToken', () => {
  it('hashes consistently', () => {
    const h1 = hashApprovalToken('abc');
    const h2 = hashApprovalToken('abc');
    expect(h1).toBe(h2);
    expect(h1).not.toBe(hashApprovalToken('xyz'));
  });

  it('generates unique plain tokens', () => {
    const a = generateApprovalTokenPlain();
    const b = generateApprovalTokenPlain();
    expect(a.length).toBeGreaterThan(20);
    expect(a).not.toBe(b);
  });
});
