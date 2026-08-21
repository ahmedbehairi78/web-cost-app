import { describe, expect, it } from 'vitest';
import { REPORT_PRINT_IFRAME_SANDBOX } from './printFrame';

describe('print iframe sandbox', () => {
  it('allows print dialogs without top-level navigation', () => {
    expect(REPORT_PRINT_IFRAME_SANDBOX).toContain('allow-same-origin');
    expect(REPORT_PRINT_IFRAME_SANDBOX).toContain('allow-modals');
    expect(REPORT_PRINT_IFRAME_SANDBOX).not.toContain('allow-top-navigation');
    expect(REPORT_PRINT_IFRAME_SANDBOX).not.toContain('allow-scripts');
  });
});
