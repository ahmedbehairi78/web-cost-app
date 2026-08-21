/**
 * Per-report print design profiles.
 * Built-in defaults tailored to each report; company-level overrides stored in
 * `company_info.reportPrintProfiles` (Settings → Print). Resolve at print time.
 */

export type ReportPrintId =
  | 'income'
  | 'budget'
  | 'balance'
  | 'trial'
  | 'time'
  | 'liquidity'
  | 'costs'
  | 'billing_ipc'
  | 'subcontractor_ipc'
  | 'mos'
  | 'variation_order'
  | 'custody_settlement'
  | 'inventory_warehouse'
  | 'consumption_order'
  | 'bank_statement'
  | 'gl_account_statement'
  | 'gl_journal_entry'
  | 'fixed_assets'
  | 'payroll'
  | 'cash_budget';

/** IPC / certificate print profiles (billing + subcontractor). */
export type IpcPrintProfileId = 'billing_ipc' | 'subcontractor_ipc';

export type PrintOrientation = 'portrait' | 'landscape';
export type PrintPageSize = 'A4' | 'A3';
export type PrintDensity = 'compact' | 'normal' | 'comfortable';
export type PrintAlign = 'start' | 'center' | 'end';
/** `auto` = keep per-column align (text start / numbers decimal-right). */
export type PrintTableCellAlign = 'auto' | PrintAlign;
export type PrintTitleSize = 'sm' | 'md' | 'lg' | 'xl';
export type PrintLogoSize = 'sm' | 'md' | 'lg' | 'xl';
/** Reserved vertical space for the repeating header / footer band. */
export type PrintBandSize = 'sm' | 'md' | 'lg' | 'xl';

export type PrintFontFamily = 'calibri' | 'segoe' | 'tahoma' | 'arial';
/** `auto` = follow report language (ar→rtl, en→ltr). */
export type PrintTextDirection = 'auto' | 'rtl' | 'ltr';
export type PrintMarginPreset = 'narrow' | 'normal' | 'wide';

/**
 * Target printed page count chosen by the user.
 * `0` = auto (paginate by density / natural row capacity).
 */
export type PrintFitPageCount = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 15 | 20;

/** Explicit body/table font size in points (`0` = follow density). */
export type PrintBodyFontSize = 0 | 8 | 9 | 10 | 11 | 12 | 14;
/** Empty string = transparent (no cell fill override). */
export type PrintTableShade = '' | string;
export type PrintTableBorder = 'none' | 'light' | 'solid' | 'strong';
export type PrintBodyUnderline = 'none' | 'single' | 'double';

export const PRINT_ALIGNS: PrintAlign[] = ['start', 'center', 'end'];
export const PRINT_TABLE_CELL_ALIGNS: PrintTableCellAlign[] = ['auto', 'start', 'center', 'end'];
export const PRINT_TITLE_SIZES: PrintTitleSize[] = ['sm', 'md', 'lg', 'xl'];
export const PRINT_LOGO_SIZES: PrintLogoSize[] = ['sm', 'md', 'lg', 'xl'];
export const PRINT_BAND_SIZES: PrintBandSize[] = ['sm', 'md', 'lg', 'xl'];
export const PRINT_FONT_FAMILIES: PrintFontFamily[] = ['calibri', 'segoe', 'tahoma', 'arial'];
export const PRINT_TEXT_DIRECTIONS: PrintTextDirection[] = ['auto', 'rtl', 'ltr'];
export const PRINT_MARGIN_PRESETS: PrintMarginPreset[] = ['narrow', 'normal', 'wide'];
export const PRINT_FIT_PAGE_COUNTS: PrintFitPageCount[] = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20];
export const PRINT_BODY_FONT_SIZES: PrintBodyFontSize[] = [0, 8, 9, 10, 11, 12, 14];
export const PRINT_TABLE_BORDERS: PrintTableBorder[] = ['none', 'light', 'solid', 'strong'];
export const PRINT_BODY_UNDERLINES: PrintBodyUnderline[] = ['none', 'single', 'double'];
/** Preset fills for the selection mini-toolbar shading picker. */
export const PRINT_TABLE_SHADE_PRESETS: string[] = [
  '',
  '#f8fafc',
  '#fef9c3',
  '#dbeafe',
  '#dcfce7',
  '#fce7f3',
  '#e2e8f0',
];

/** Max length for optional custom header/footer lines (Word-like free text). */
export const PRINT_EXTRA_TEXT_MAX = 200;

export interface ReportPrintProfile {
  orientation: PrintOrientation;
  pageSize: PrintPageSize;
  density: PrintDensity;
  /** Header accent + table heading + title color (hex). */
  accent: string;
  showHeader: boolean;
  showFooter: boolean;
  /** KPI / summary cards above report body (liquidity, etc.). */
  showSummaryCards: boolean;
  titleAlign: PrintAlign;
  titleFontSize: PrintTitleSize;
  footerAlign: PrintAlign;
  /**
   * Horizontal text alignment inside table cells (headers + body + totals).
   * `auto` keeps column-level align (labels vs numeric decimal-right).
   */
  tableCellAlign: PrintTableCellAlign;
  showLogo: boolean;
  logoAlign: PrintAlign;
  logoSize: PrintLogoSize;
  /** Reserved space for the (repeating) header band — tune to avoid blank gap / overlap. */
  headerSize: PrintBandSize;
  /** Reserved space for the (repeating) footer band — increase if bottom rows are clipped. */
  footerSize: PrintBandSize;
  /** Body / print font (machine-local families preferred in Electron). */
  fontFamily: PrintFontFamily;
  /**
   * Body/table font size in pt. `0` = derive from density (legacy behaviour).
   */
  bodyFontSize: PrintBodyFontSize;
  /** Body / table text color (hex). */
  bodyTextColor: string;
  /** Table cell background fill; empty = no override. */
  tableShade: PrintTableShade;
  /** Table cell border weight. */
  tableBorder: PrintTableBorder;
  bodyBold: boolean;
  bodyItalic: boolean;
  bodyUnderline: PrintBodyUnderline;
  /** Document text direction; `auto` follows UI language. */
  textDirection: PrintTextDirection;
  /** Page margin preset for print / PDF. */
  marginPreset: PrintMarginPreset;
  /**
   * Force the document into this many printed sheets (`0` = auto).
   * Rows / flowing table lines are distributed evenly across the chosen count.
   */
  fitPageCount: PrintFitPageCount;
  /** Header content toggles (Word-like). */
  headerShowCompany: boolean;
  headerShowAddress: boolean;
  headerShowTaxId: boolean;
  headerShowTitle: boolean;
  /** Date / scope line under the title. */
  headerShowMeta: boolean;
  /** Optional free-text line in the header. */
  headerExtraText: string;
  /** Footer content toggles. */
  footerShowCompany: boolean;
  /** Company footer text from company_info. */
  footerShowText: boolean;
  /** Auto-generated “this report was generated” note. */
  footerShowNote: boolean;
  footerShowPageNum: boolean;
  /** Optional free-text line in the footer. */
  footerExtraText: string;
}

export const REPORT_PRINT_IDS: ReportPrintId[] = [
  'income',
  'budget',
  'balance',
  'trial',
  'time',
  'liquidity',
  'costs',
  'billing_ipc',
  'subcontractor_ipc',
  'mos',
  'variation_order',
  'custody_settlement',
  'inventory_warehouse',
  'consumption_order',
  'bank_statement',
  'gl_account_statement',
  'gl_journal_entry',
  'fixed_assets',
  'payroll',
  'cash_budget',
];

export const REPORT_PRINT_LABELS: Record<ReportPrintId, { ar: string; en: string }> = {
  income: { ar: 'قائمة الدخل', en: 'Income Statement' },
  budget: { ar: 'الميزانية vs الفعلي', en: 'Budget vs Actual' },
  balance: { ar: 'الميزانية العمومية', en: 'Balance Sheet' },
  trial: { ar: 'ميزان المراجعة', en: 'Trial Balance' },
  time: { ar: 'الجدول الزمني', en: 'Schedule' },
  liquidity: { ar: 'تقرير السيولة', en: 'Liquidity' },
  costs: { ar: 'تكاليف BOQ', en: 'BOQ Costs' },
  billing_ipc: { ar: 'مستخلص العميل (جاري/نهائي)', en: 'Client IPC (Interim/Final)' },
  subcontractor_ipc: { ar: 'مستخلص مقاول باطن', en: 'Subcontractor IPC' },
  mos: { ar: 'مستخلص تشوينات (MOS)', en: 'Material On-Site (MOS)' },
  variation_order: { ar: 'أمر تغيير', en: 'Variation Order' },
  custody_settlement: { ar: 'تسوية عهدة', en: 'Custody Settlement' },
  inventory_warehouse: { ar: 'تقرير مخزن المشروع', en: 'Project Warehouse Report' },
  consumption_order: { ar: 'إذن صرف مخزني', en: 'Warehouse Issue Slip' },
  bank_statement: { ar: 'كشف حساب بنكي', en: 'Bank Account Statement' },
  gl_account_statement: { ar: 'كشف حساب (دفتر اليومية)', en: 'GL Account Statement' },
  gl_journal_entry: { ar: 'قيد يومية', en: 'Journal Entry' },
  fixed_assets: { ar: 'سجل الأصول الثابتة', en: 'Fixed Assets Register' },
  payroll: { ar: 'كشف الرواتب', en: 'Payroll Register' },
  cash_budget: { ar: 'موازنة نقدية', en: 'Cash budget' },
};

/** CSS font-family stacks for print documents. */
export const PRINT_FONT_CSS: Record<PrintFontFamily, string> = {
  calibri: 'Calibri, "Segoe UI", Tahoma, Arial, sans-serif',
  segoe: '"Segoe UI", Calibri, Tahoma, Arial, sans-serif',
  tahoma: 'Tahoma, "Segoe UI", Calibri, Arial, sans-serif',
  arial: 'Arial, "Segoe UI", Tahoma, Calibri, sans-serif',
};

/** Page margins as CSS `@page` / print string: top/right/bottom/left (mm). */
export const PRINT_MARGIN_CSS: Record<PrintMarginPreset, string> = {
  narrow: '6mm 5mm 6mm 5mm',
  normal: '10mm 8mm 10mm 8mm',
  wide: '14mm 12mm 14mm 12mm',
};

/**
 * Tailored defaults: wide tabular reports → landscape + compact; statements → portrait.
 * Accent colors echo each tab's on-screen identity.
 */
function sanitizeExtraText(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  return raw.replace(/\s+/g, ' ').trim().slice(0, PRINT_EXTRA_TEXT_MAX);
}

function sanitizeTableShade(raw: unknown, fallback: PrintTableShade): PrintTableShade {
  if (raw === '') return '';
  if (typeof raw !== 'string') return fallback;
  const v = raw.trim();
  if (v === '') return '';
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v;
  return fallback;
}

const BASE_PRINT_LAYOUT: Omit<ReportPrintProfile, 'orientation' | 'pageSize' | 'density' | 'accent'> = {
  showHeader: true,
  showFooter: true,
  showSummaryCards: false,
  titleAlign: 'center',
  titleFontSize: 'md',
  footerAlign: 'center',
  tableCellAlign: 'auto',
  showLogo: true,
  logoAlign: 'start',
  logoSize: 'md',
  headerSize: 'md',
  footerSize: 'md',
  fontFamily: 'calibri',
  bodyFontSize: 0,
  bodyTextColor: '#0f172a',
  tableShade: '',
  tableBorder: 'light',
  bodyBold: false,
  bodyItalic: false,
  bodyUnderline: 'none',
  textDirection: 'auto',
  marginPreset: 'normal',
  fitPageCount: 0,
  headerShowCompany: true,
  headerShowAddress: true,
  headerShowTaxId: true,
  headerShowTitle: true,
  headerShowMeta: true,
  headerExtraText: '',
  footerShowCompany: true,
  footerShowText: true,
  footerShowNote: true,
  footerShowPageNum: true,
  footerExtraText: '',
};

export const REPORT_PRINT_DEFAULTS: Record<ReportPrintId, ReportPrintProfile> = {
  income: { ...BASE_PRINT_LAYOUT, orientation: 'portrait', pageSize: 'A4', density: 'normal', accent: '#0f766e' },
  budget: { ...BASE_PRINT_LAYOUT, orientation: 'landscape', pageSize: 'A4', density: 'normal', accent: '#b45309' },
  balance: { ...BASE_PRINT_LAYOUT, orientation: 'portrait', pageSize: 'A4', density: 'normal', accent: '#4338ca' },
  trial: { ...BASE_PRINT_LAYOUT, orientation: 'landscape', pageSize: 'A4', density: 'compact', accent: '#1d4ed8' },
  time: { ...BASE_PRINT_LAYOUT, orientation: 'landscape', pageSize: 'A4', density: 'compact', accent: '#7c3aed' },
  liquidity: { ...BASE_PRINT_LAYOUT, orientation: 'portrait', pageSize: 'A4', density: 'normal', accent: '#0891b2' },
  costs: { ...BASE_PRINT_LAYOUT, orientation: 'landscape', pageSize: 'A4', density: 'compact', accent: '#be123c' },
  billing_ipc: { ...BASE_PRINT_LAYOUT, orientation: 'landscape', pageSize: 'A4', density: 'compact', accent: '#1e3a8a', titleAlign: 'end', headerSize: 'sm', footerSize: 'lg' },
  subcontractor_ipc: { ...BASE_PRINT_LAYOUT, orientation: 'landscape', pageSize: 'A4', density: 'compact', accent: '#0d9488', titleAlign: 'end', headerSize: 'sm', footerSize: 'lg' },
  mos: { ...BASE_PRINT_LAYOUT, orientation: 'landscape', pageSize: 'A4', density: 'compact', accent: '#1e3a8a', titleAlign: 'end' },
  variation_order: { ...BASE_PRINT_LAYOUT, orientation: 'landscape', pageSize: 'A4', density: 'compact', accent: '#7c3aed', titleAlign: 'end' },
  custody_settlement: { ...BASE_PRINT_LAYOUT, orientation: 'portrait', pageSize: 'A4', density: 'normal', accent: '#0f766e' },
  inventory_warehouse: { ...BASE_PRINT_LAYOUT, orientation: 'landscape', pageSize: 'A4', density: 'compact', accent: '#b45309', titleAlign: 'center' },
  consumption_order: { ...BASE_PRINT_LAYOUT, orientation: 'portrait', pageSize: 'A4', density: 'normal', accent: '#b45309', titleAlign: 'center', footerSize: 'lg' },
  bank_statement: { ...BASE_PRINT_LAYOUT, orientation: 'landscape', pageSize: 'A4', density: 'compact', accent: '#1d4ed8', titleAlign: 'end' },
  gl_account_statement: { ...BASE_PRINT_LAYOUT, orientation: 'landscape', pageSize: 'A4', density: 'compact', accent: '#1e3a8a', titleAlign: 'end' },
  gl_journal_entry: { ...BASE_PRINT_LAYOUT, orientation: 'portrait', pageSize: 'A4', density: 'normal', accent: '#1e3a8a' },
  fixed_assets: { ...BASE_PRINT_LAYOUT, orientation: 'landscape', pageSize: 'A4', density: 'compact', accent: '#7c3aed' },
  payroll: { ...BASE_PRINT_LAYOUT, orientation: 'landscape', pageSize: 'A4', density: 'compact', accent: '#0ea5e9' },
  cash_budget: { ...BASE_PRINT_LAYOUT, orientation: 'landscape', pageSize: 'A4', density: 'compact', accent: '#0369a1' },
};

const ORIENTATIONS: PrintOrientation[] = ['portrait', 'landscape'];
const PAGE_SIZES: PrintPageSize[] = ['A4', 'A3'];
const DENSITIES: PrintDensity[] = ['compact', 'normal', 'comfortable'];
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function sanitizeProfile(
  fallback: ReportPrintProfile,
  raw: Partial<ReportPrintProfile> | undefined,
): ReportPrintProfile {
  if (!raw || typeof raw !== 'object') return { ...fallback };
  return {
    orientation: ORIENTATIONS.includes(raw.orientation as PrintOrientation)
      ? (raw.orientation as PrintOrientation)
      : fallback.orientation,
    pageSize: PAGE_SIZES.includes(raw.pageSize as PrintPageSize)
      ? (raw.pageSize as PrintPageSize)
      : fallback.pageSize,
    density: DENSITIES.includes(raw.density as PrintDensity)
      ? (raw.density as PrintDensity)
      : fallback.density,
    accent: typeof raw.accent === 'string' && HEX_RE.test(raw.accent) ? raw.accent : fallback.accent,
    showHeader: typeof raw.showHeader === 'boolean' ? raw.showHeader : fallback.showHeader,
    showFooter: typeof raw.showFooter === 'boolean' ? raw.showFooter : fallback.showFooter,
    showSummaryCards:
      typeof raw.showSummaryCards === 'boolean' ? raw.showSummaryCards : fallback.showSummaryCards,
    titleAlign: PRINT_ALIGNS.includes(raw.titleAlign as PrintAlign)
      ? (raw.titleAlign as PrintAlign)
      : fallback.titleAlign,
    titleFontSize: PRINT_TITLE_SIZES.includes(raw.titleFontSize as PrintTitleSize)
      ? (raw.titleFontSize as PrintTitleSize)
      : fallback.titleFontSize,
    footerAlign: PRINT_ALIGNS.includes(raw.footerAlign as PrintAlign)
      ? (raw.footerAlign as PrintAlign)
      : fallback.footerAlign,
    tableCellAlign: PRINT_TABLE_CELL_ALIGNS.includes(raw.tableCellAlign as PrintTableCellAlign)
      ? (raw.tableCellAlign as PrintTableCellAlign)
      : fallback.tableCellAlign,
    showLogo: typeof raw.showLogo === 'boolean' ? raw.showLogo : fallback.showLogo,
    logoAlign: PRINT_ALIGNS.includes(raw.logoAlign as PrintAlign)
      ? (raw.logoAlign as PrintAlign)
      : fallback.logoAlign,
    logoSize: PRINT_LOGO_SIZES.includes(raw.logoSize as PrintLogoSize)
      ? (raw.logoSize as PrintLogoSize)
      : fallback.logoSize,
    headerSize: PRINT_BAND_SIZES.includes(raw.headerSize as PrintBandSize)
      ? (raw.headerSize as PrintBandSize)
      : fallback.headerSize,
    footerSize: PRINT_BAND_SIZES.includes(raw.footerSize as PrintBandSize)
      ? (raw.footerSize as PrintBandSize)
      : fallback.footerSize,
    fontFamily: PRINT_FONT_FAMILIES.includes(raw.fontFamily as PrintFontFamily)
      ? (raw.fontFamily as PrintFontFamily)
      : fallback.fontFamily,
    bodyFontSize: PRINT_BODY_FONT_SIZES.includes(raw.bodyFontSize as PrintBodyFontSize)
      ? (raw.bodyFontSize as PrintBodyFontSize)
      : fallback.bodyFontSize,
    bodyTextColor:
      typeof raw.bodyTextColor === 'string' && HEX_RE.test(raw.bodyTextColor)
        ? raw.bodyTextColor
        : fallback.bodyTextColor,
    tableShade: sanitizeTableShade(raw.tableShade, fallback.tableShade),
    tableBorder: PRINT_TABLE_BORDERS.includes(raw.tableBorder as PrintTableBorder)
      ? (raw.tableBorder as PrintTableBorder)
      : fallback.tableBorder,
    bodyBold: typeof raw.bodyBold === 'boolean' ? raw.bodyBold : fallback.bodyBold,
    bodyItalic: typeof raw.bodyItalic === 'boolean' ? raw.bodyItalic : fallback.bodyItalic,
    bodyUnderline: PRINT_BODY_UNDERLINES.includes(raw.bodyUnderline as PrintBodyUnderline)
      ? (raw.bodyUnderline as PrintBodyUnderline)
      : fallback.bodyUnderline,
    textDirection: PRINT_TEXT_DIRECTIONS.includes(raw.textDirection as PrintTextDirection)
      ? (raw.textDirection as PrintTextDirection)
      : fallback.textDirection,
    marginPreset: PRINT_MARGIN_PRESETS.includes(raw.marginPreset as PrintMarginPreset)
      ? (raw.marginPreset as PrintMarginPreset)
      : fallback.marginPreset,
    fitPageCount: PRINT_FIT_PAGE_COUNTS.includes(raw.fitPageCount as PrintFitPageCount)
      ? (raw.fitPageCount as PrintFitPageCount)
      : fallback.fitPageCount,
    headerShowCompany:
      typeof raw.headerShowCompany === 'boolean' ? raw.headerShowCompany : fallback.headerShowCompany,
    headerShowAddress:
      typeof raw.headerShowAddress === 'boolean' ? raw.headerShowAddress : fallback.headerShowAddress,
    headerShowTaxId:
      typeof raw.headerShowTaxId === 'boolean' ? raw.headerShowTaxId : fallback.headerShowTaxId,
    headerShowTitle:
      typeof raw.headerShowTitle === 'boolean' ? raw.headerShowTitle : fallback.headerShowTitle,
    headerShowMeta:
      typeof raw.headerShowMeta === 'boolean' ? raw.headerShowMeta : fallback.headerShowMeta,
    headerExtraText: sanitizeExtraText(raw.headerExtraText, fallback.headerExtraText),
    footerShowCompany:
      typeof raw.footerShowCompany === 'boolean' ? raw.footerShowCompany : fallback.footerShowCompany,
    footerShowText:
      typeof raw.footerShowText === 'boolean' ? raw.footerShowText : fallback.footerShowText,
    footerShowNote:
      typeof raw.footerShowNote === 'boolean' ? raw.footerShowNote : fallback.footerShowNote,
    footerShowPageNum:
      typeof raw.footerShowPageNum === 'boolean' ? raw.footerShowPageNum : fallback.footerShowPageNum,
    footerExtraText: sanitizeExtraText(raw.footerExtraText, fallback.footerExtraText),
  };
}

export type StoredReportPrintProfiles = Partial<Record<ReportPrintId, Partial<ReportPrintProfile>>>;

/** Overlay wins per report id — never drop other reports when saving one design. */
export function mergeStoredReportPrintProfiles(
  base: StoredReportPrintProfiles | undefined,
  overlay: StoredReportPrintProfiles | undefined,
): StoredReportPrintProfiles {
  return { ...(base || {}), ...(overlay || {}) };
}

export function printProfileEquals(
  a: ReportPrintProfile,
  b: ReportPrintProfile,
): boolean {
  return JSON.stringify(sanitizeProfile(a, a)) === JSON.stringify(sanitizeProfile(b, b));
}

/** Merge company-stored overrides with built-in defaults for one report. */
export function resolveReportPrintProfile(
  stored: StoredReportPrintProfiles | undefined,
  id: ReportPrintId,
): ReportPrintProfile {
  const fallback = REPORT_PRINT_DEFAULTS[id] ?? REPORT_PRINT_DEFAULTS.income;
  return sanitizeProfile(fallback, stored?.[id]);
}

/** Resolve every report (defaults applied) — for the Settings editor. */
export function resolveAllReportPrintProfiles(
  stored: StoredReportPrintProfiles | undefined,
): Record<ReportPrintId, ReportPrintProfile> {
  const out = {} as Record<ReportPrintId, ReportPrintProfile>;
  for (const id of REPORT_PRINT_IDS) out[id] = resolveReportPrintProfile(stored, id);
  return out;
}

/** Effective document dir for print HTML. */
export function resolvePrintTextDir(
  textDirection: PrintTextDirection,
  language: 'ar' | 'en',
): 'rtl' | 'ltr' {
  if (textDirection === 'rtl' || textDirection === 'ltr') return textDirection;
  return language === 'ar' ? 'rtl' : 'ltr';
}

/**
 * Physical left/center/right for table cells.
 * Numeric cells wrap values in `dir="ltr"` so CSS `start`/`end` on `.num-val`
 * is the opposite of Arabic headers — always use this physical mapping.
 */
export function physicalTableCellTextAlign(
  align: PrintTableCellAlign,
  dir: 'rtl' | 'ltr',
): 'left' | 'center' | 'right' | null {
  if (align === 'auto') return null;
  if (align === 'center') return 'center';
  if (align === 'start') return dir === 'rtl' ? 'right' : 'left';
  return dir === 'rtl' ? 'left' : 'right';
}
