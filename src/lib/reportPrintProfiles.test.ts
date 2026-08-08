import { describe, expect, it } from 'vitest';
import {
  REPORT_PRINT_DEFAULTS,
  resolvePrintTextDir,
  resolveReportPrintProfile,
  sanitizeProfile,
} from './reportPrintProfiles';

describe('reportPrintProfiles format fields', () => {
  it('defaults include fontFamily, textDirection, marginPreset, fitPageCount', () => {
    const income = REPORT_PRINT_DEFAULTS.income;
    expect(income.fontFamily).toBe('calibri');
    expect(income.textDirection).toBe('auto');
    expect(income.marginPreset).toBe('normal');
    expect(income.fitPageCount).toBe(0);
  });

  it('sanitizeProfile accepts new fields and ignores invalid', () => {
    const fallback = REPORT_PRINT_DEFAULTS.budget;
    const good = sanitizeProfile(fallback, {
      fontFamily: 'segoe',
      textDirection: 'rtl',
      marginPreset: 'narrow',
      fitPageCount: 4,
      headerShowCompany: false,
      footerShowPageNum: false,
      headerExtraText: '  hello  world  ',
    });
    expect(good.fontFamily).toBe('segoe');
    expect(good.textDirection).toBe('rtl');
    expect(good.marginPreset).toBe('narrow');
    expect(good.fitPageCount).toBe(4);
    expect(good.headerShowCompany).toBe(false);
    expect(good.footerShowPageNum).toBe(false);
    expect(good.headerExtraText).toBe('hello world');

    const bad = sanitizeProfile(fallback, {
      fontFamily: 'nope' as 'calibri',
      textDirection: 'xx' as 'auto',
      marginPreset: 'huge' as 'normal',
      fitPageCount: 99 as 0,
    });
    expect(bad.fontFamily).toBe(fallback.fontFamily);
    expect(bad.textDirection).toBe(fallback.textDirection);
    expect(bad.marginPreset).toBe(fallback.marginPreset);
    expect(bad.fitPageCount).toBe(fallback.fitPageCount);
  });

  it('defaults include header/footer content toggles', () => {
    const income = REPORT_PRINT_DEFAULTS.income;
    expect(income.headerShowCompany).toBe(true);
    expect(income.headerShowTitle).toBe(true);
    expect(income.footerShowPageNum).toBe(true);
    expect(income.headerExtraText).toBe('');
  });

  it('resolveReportPrintProfile merges stored overrides', () => {
    const resolved = resolveReportPrintProfile(
      { income: { fontFamily: 'arial', showHeader: false, marginPreset: 'wide' } },
      'income',
    );
    expect(resolved.fontFamily).toBe('arial');
    expect(resolved.showHeader).toBe(false);
    expect(resolved.marginPreset).toBe('wide');
    expect(resolved.orientation).toBe('portrait');
  });

  it('resolvePrintTextDir respects auto and overrides', () => {
    expect(resolvePrintTextDir('auto', 'ar')).toBe('rtl');
    expect(resolvePrintTextDir('auto', 'en')).toBe('ltr');
    expect(resolvePrintTextDir('ltr', 'ar')).toBe('ltr');
    expect(resolvePrintTextDir('rtl', 'en')).toBe('rtl');
  });
});
