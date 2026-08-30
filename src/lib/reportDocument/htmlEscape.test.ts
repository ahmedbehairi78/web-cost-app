import { describe, expect, it } from 'vitest';
import { absolutizePrintAssetUrl, escapeHtml, isSafeLogoUrl } from './htmlEscape';

describe('escapeHtml', () => {
  it('escapes markup and quotes', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;',
    );
    expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
  });
});

describe('isSafeLogoUrl', () => {
  it('allows app-relative, http(s), and data:image', () => {
    expect(isSafeLogoUrl('/branding/logo-print.svg')).toBe(true);
    expect(isSafeLogoUrl('https://cdn.example/logo.png')).toBe(true);
    expect(isSafeLogoUrl('data:image/png;base64,abc')).toBe(true);
  });

  it('rejects javascript and protocol-relative URLs', () => {
    expect(isSafeLogoUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeLogoUrl('//evil.example/x')).toBe(false);
  });

  it('absolutizes app-relative logos for blob print iframes', () => {
    expect(absolutizePrintAssetUrl('/branding/my-logo.png', 'https://app.example')).toBe(
      'https://app.example/branding/my-logo.png',
    );
    expect(absolutizePrintAssetUrl('/branding/emaar logo.png', 'https://app.example')).toBe(
      'https://app.example/branding/emaar%20logo.png',
    );
    expect(absolutizePrintAssetUrl('https://cdn.example/logo.png', 'https://app.example')).toBe(
      'https://cdn.example/logo.png',
    );
  });
});
