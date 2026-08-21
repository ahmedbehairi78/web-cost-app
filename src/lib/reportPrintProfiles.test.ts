import { describe, expect, it } from 'vitest';
import {
  REPORT_PRINT_DEFAULTS,
  physicalTableCellTextAlign,
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
    expect(income.tableCellAlign).toBe('auto');
    expect(income.bodyFontSize).toBe(0);
    expect(income.bodyTextColor).toBe('#0f172a');
    expect(income.tableShade).toBe('');
    expect(income.tableBorder).toBe('light');
    expect(income.bodyBold).toBe(false);
    expect(income.bodyItalic).toBe(false);
    expect(income.bodyUnderline).toBe('none');
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
      tableCellAlign: 'center',
      bodyFontSize: 11,
      bodyTextColor: '#112233',
      tableShade: '#fef9c3',
      tableBorder: 'strong',
      bodyBold: true,
      bodyItalic: true,
      bodyUnderline: 'double',
    });
    expect(good.fontFamily).toBe('segoe');
    expect(good.textDirection).toBe('rtl');
    expect(good.marginPreset).toBe('narrow');
    expect(good.fitPageCount).toBe(4);
    expect(good.headerShowCompany).toBe(false);
    expect(good.footerShowPageNum).toBe(false);
    expect(good.headerExtraText).toBe('hello world');
    expect(good.tableCellAlign).toBe('center');
    expect(good.bodyFontSize).toBe(11);
    expect(good.bodyTextColor).toBe('#112233');
    expect(good.tableShade).toBe('#fef9c3');
    expect(good.tableBorder).toBe('strong');
    expect(good.bodyBold).toBe(true);
    expect(good.bodyItalic).toBe(true);
    expect(good.bodyUnderline).toBe('double');

    const bad = sanitizeProfile(fallback, {
      fontFamily: 'nope' as 'calibri',
      textDirection: 'xx' as 'auto',
      marginPreset: 'huge' as 'normal',
      fitPageCount: 99 as 0,
      tableCellAlign: 'justify' as 'auto',
      bodyFontSize: 99 as 0,
      bodyTextColor: 'red',
      tableShade: 'yellow',
      tableBorder: 'thick' as 'light',
      bodyUnderline: 'triple' as 'none',
    });
    expect(bad.fontFamily).toBe(fallback.fontFamily);
    expect(bad.textDirection).toBe(fallback.textDirection);
    expect(bad.marginPreset).toBe(fallback.marginPreset);
    expect(bad.fitPageCount).toBe(fallback.fitPageCount);
    expect(bad.tableCellAlign).toBe(fallback.tableCellAlign);
    expect(bad.bodyFontSize).toBe(fallback.bodyFontSize);
    expect(bad.bodyTextColor).toBe(fallback.bodyTextColor);
    expect(bad.tableShade).toBe(fallback.tableShade);
    expect(bad.tableBorder).toBe(fallback.tableBorder);
    expect(bad.bodyUnderline).toBe(fallback.bodyUnderline);
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

  it('physicalTableCellTextAlign keeps amounts on the same side as RTL headers', () => {
    expect(physicalTableCellTextAlign('auto', 'rtl')).toBeNull();
    expect(physicalTableCellTextAlign('center', 'rtl')).toBe('center');
    expect(physicalTableCellTextAlign('start', 'rtl')).toBe('right');
    expect(physicalTableCellTextAlign('end', 'rtl')).toBe('left');
    expect(physicalTableCellTextAlign('start', 'ltr')).toBe('left');
    expect(physicalTableCellTextAlign('end', 'ltr')).toBe('right');
  });
});
