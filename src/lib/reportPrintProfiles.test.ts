import { describe, expect, it } from 'vitest';
import {
  mergeStoredReportPrintProfiles,
  printProfileEquals,
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
    expect(income.selectionPatches).toEqual([]);
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

  it('mergeStoredReportPrintProfiles keeps other reports when overlaying one', () => {
    const merged = mergeStoredReportPrintProfiles(
      { income: { fontFamily: 'arial' }, cash_budget: { orientation: 'portrait' } },
      { cash_budget: { orientation: 'landscape' } },
    );
    expect(merged.income?.fontFamily).toBe('arial');
    expect(merged.cash_budget?.orientation).toBe('landscape');
  });

  it('mergeStoredReportPrintProfiles keeps other fields on the same report', () => {
    const merged = mergeStoredReportPrintProfiles(
      { cash_budget: { fontFamily: 'arial', orientation: 'portrait' } },
      { cash_budget: { orientation: 'landscape' } },
    );
    expect(merged.cash_budget?.fontFamily).toBe('arial');
    expect(merged.cash_budget?.orientation).toBe('landscape');
  });

  it('printProfileEquals is true for equivalent sanitized profiles', () => {
    const a = resolveReportPrintProfile({ cash_budget: { fontFamily: 'tahoma' } }, 'cash_budget');
    const b = resolveReportPrintProfile({ cash_budget: { fontFamily: 'tahoma' } }, 'cash_budget');
    expect(printProfileEquals(a, b)).toBe(true);
    expect(printProfileEquals(a, REPORT_PRINT_DEFAULTS.cash_budget)).toBe(false);
  });

  it('sanitizeProfile keeps selection patches from the floating format bar', () => {
    const fallback = REPORT_PRINT_DEFAULTS.cash_budget;
    const patched = sanitizeProfile(fallback, {
      selectionPatches: [{ k: 'c', i: 0, r: 1, c: 2, s: 'font-size: 12pt; background: #fef08a' }],
    });
    expect(patched.selectionPatches).toEqual([
      { k: 'c', i: 0, r: 1, c: 2, s: 'font-size: 12pt; background: #fef08a' },
    ]);
    expect(sanitizeProfile(fallback, { selectionPatches: [{ k: 'x', i: 0, s: 'color:red' }] }).selectionPatches).toEqual(
      [],
    );
    const headerSlot = sanitizeProfile(fallback, {
      selectionPatches: [{ k: 'e', i: 0, slot: 'co', s: 'font-size: 14pt' }],
    });
    expect(headerSlot.selectionPatches).toEqual([{ k: 'e', i: 0, slot: 'co', s: 'font-size: 14pt' }]);
    const kvSlot = sanitizeProfile(fallback, {
      selectionPatches: [{ k: 'e', i: 0, slot: 'kv', r: 2, s: 'text-align: right' }],
    });
    expect(kvSlot.selectionPatches).toEqual([{ k: 'e', i: 0, slot: 'kv', r: 2, s: 'text-align: right' }]);
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
