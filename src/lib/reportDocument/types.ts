import type { CompanyPrintInfo } from '../ipcPrintData';
import type {
  PrintAlign,
  PrintDensity,
  PrintFontFamily,
  PrintMarginPreset,
  PrintOrientation,
  PrintPageSize,
  PrintTextDirection,
  ReportPrintProfile,
} from '../reportPrintProfiles';

export type ReportDocAlign = 'left' | 'center' | 'right';

export type ReportDocColumn = {
  key: string;
  header: string;
  /** Relative width hint (sums normalized). */
  width?: number;
  align?: ReportDocAlign;
  /** Format as money when rendering numbers. */
  money?: boolean;
  /**
   * Numeric column — decimal-aligned (tabular nums).
   * Implied when `money` is true. Placement follows report language.
   */
  numeric?: boolean;
};

export type ReportDocRow = Record<string, string | number | null | undefined>;

/** Money or explicit numeric columns (percentages, qty, etc.). */
export function isNumericReportColumn(col: ReportDocColumn): boolean {
  return col.money === true || col.numeric === true;
}

export type ReportDocKeyValueItem = {
  label: string;
  /** Pre-formatted display value (money already formatted by the builder). */
  value: string;
  /** Highlight row (net payable, grand total, …). */
  emphasize?: boolean;
};

export type ReportDocSignatureBox = {
  role: string;
  name?: string;
};

/**
 * Document section — for certificate-style documents (IPC, custody, VO, journal entry)
 * that mix info blocks, tables, totals and signature rows.
 * Plain tabular reports keep using top-level `columns` / `rows`.
 */
export type ReportDocSection =
  | {
      kind: 'keyValue';
      title?: string;
      items: ReportDocKeyValueItem[];
      /** Grid columns (default 2). */
      columnsPerRow?: number;
    }
  | {
      kind: 'table';
      title?: string;
      columns: ReportDocColumn[];
      rows: ReportDocRow[];
      totals?: ReportDocRow;
      totalsLabel?: string;
      /**
       * Main flowing table — chunked across sheets when long.
       * At most one section per document should set this.
       */
      flow?: boolean;
    }
  | {
      kind: 'summary';
      title?: string;
      items: ReportDocKeyValueItem[];
    }
  | { kind: 'signatures'; title?: string; signatures: ReportDocSignatureBox[] }
  | { kind: 'note'; text: string };

export type ReportDocument = {
  id: string;
  title: string;
  scopeLabel?: string;
  dateLabel?: string;
  language: 'ar' | 'en';
  orientation: PrintOrientation;
  pageSize: PrintPageSize;
  accent: string;
  showHeader: boolean;
  showFooter: boolean;
  showLogo: boolean;
  fontFamily: PrintFontFamily;
  textDirection: PrintTextDirection;
  titleAlign: PrintAlign;
  footerAlign: PrintAlign;
  logoAlign: PrintAlign;
  marginPreset: PrintMarginPreset;
  /** `0` = auto; otherwise distribute content across this many sheets. */
  fitPageCount: number;
  density: PrintDensity;
  headerShowCompany: boolean;
  headerShowAddress: boolean;
  headerShowTaxId: boolean;
  headerShowTitle: boolean;
  headerShowMeta: boolean;
  headerExtraText: string;
  footerShowCompany: boolean;
  footerShowText: boolean;
  footerShowNote: boolean;
  footerShowPageNum: boolean;
  footerExtraText: string;
  company: CompanyPrintInfo;
  columns: ReportDocColumn[];
  rows: ReportDocRow[];
  /**
   * Certificate-style section list. When present, sections render in order
   * (letterhead + fixed footer per sheet) and top-level `columns`/`rows` are ignored.
   */
  sections?: ReportDocSection[];
  /**
   * Pre-chunked pages (e.g. Budget vs Actual matching on-screen sheets).
   * When set, print/PDF emits one letterheaded sheet per chunk.
   */
  pageChunks?: ReportDocRow[][];
  /** Optional totals row (same keys as columns) — rendered on the last sheet only. */
  totals?: ReportDocRow;
  totalsLabel?: string;
  footerNote?: string;
  filename: string;
};

export type ReportDocumentAction = 'preview' | 'print' | 'pdf';

export type ReportDocumentLabels = {
  title: string;
  hint: string;
  print: string;
  pdf: string;
  cancel: string;
};

export function profileToDocLayout(profile: ReportPrintProfile): Pick<
  ReportDocument,
  | 'orientation'
  | 'pageSize'
  | 'accent'
  | 'showHeader'
  | 'showFooter'
  | 'showLogo'
  | 'fontFamily'
  | 'textDirection'
  | 'titleAlign'
  | 'footerAlign'
  | 'logoAlign'
  | 'marginPreset'
  | 'fitPageCount'
  | 'density'
  | 'headerShowCompany'
  | 'headerShowAddress'
  | 'headerShowTaxId'
  | 'headerShowTitle'
  | 'headerShowMeta'
  | 'headerExtraText'
  | 'footerShowCompany'
  | 'footerShowText'
  | 'footerShowNote'
  | 'footerShowPageNum'
  | 'footerExtraText'
> {
  return {
    orientation: profile.orientation,
    pageSize: profile.pageSize,
    accent: profile.accent,
    showHeader: profile.showHeader,
    showFooter: profile.showFooter,
    showLogo: profile.showLogo,
    fontFamily: profile.fontFamily,
    textDirection: profile.textDirection,
    titleAlign: profile.titleAlign,
    footerAlign: profile.footerAlign,
    logoAlign: profile.logoAlign,
    marginPreset: profile.marginPreset,
    fitPageCount: profile.fitPageCount,
    density: profile.density,
    headerShowCompany: profile.headerShowCompany,
    headerShowAddress: profile.headerShowAddress,
    headerShowTaxId: profile.headerShowTaxId,
    headerShowTitle: profile.headerShowTitle,
    headerShowMeta: profile.headerShowMeta,
    headerExtraText: profile.headerExtraText,
    footerShowCompany: profile.footerShowCompany,
    footerShowText: profile.footerShowText,
    footerShowNote: profile.footerShowNote,
    footerShowPageNum: profile.footerShowPageNum,
    footerExtraText: profile.footerExtraText,
  };
}

export function formatDocCell(
  value: string | number | null | undefined,
  col: ReportDocColumn,
  formatMoney: (n: number) => string,
): string {
  if (value == null) return '—';
  if (value === '') return '';
  if (typeof value === 'number') {
    if (col.money) return formatMoneyAccounting(value, formatMoney);
    return String(value);
  }
  if (col.money) {
    const n = Number(value);
    if (Number.isFinite(n)) return formatMoneyAccounting(n, formatMoney);
  }
  return String(value);
}

/** Match on-screen P&L: negatives as (amount), positives plain — aids decimal alignment. */
function formatMoneyAccounting(n: number, formatMoney: (n: number) => string): string {
  if (n < -0.005) return `(${formatMoney(Math.abs(n))})`;
  if (Math.abs(n) < 0.005) return formatMoney(0);
  return formatMoney(n);
}

/** Default rows per printed sheet when `pageChunks` is not provided. */
export function defaultPrintRowsPerPage(doc: Pick<ReportDocument, 'orientation' | 'density'>): number {
  const landscape = doc.orientation === 'landscape';
  const d = doc.density || 'normal';
  // Densities sized for compact letterhead + fixed 3-line footer.
  if (d === 'compact') return landscape ? 28 : 38;
  if (d === 'comfortable') return landscape ? 16 : 24;
  return landscape ? 22 : 32;
}

export function chunkReportRows<T>(rows: T[], pageSize: number): T[][] {
  const size = Math.max(1, pageSize);
  if (rows.length === 0) return [[]];
  const pages: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    pages.push(rows.slice(i, i + size));
  }
  return pages;
}

/** Flatten pre-chunked sheets (or use `rows`) for re-pagination. */
export function flattenReportRows(doc: Pick<ReportDocument, 'rows' | 'pageChunks'>): ReportDocRow[] {
  if (doc.pageChunks && doc.pageChunks.length > 0) return doc.pageChunks.flat();
  return doc.rows;
}

/**
 * Rows-per-page when the user picked a target page count.
 * Returns `null` when fit is auto (`0` / unset).
 */
export function fitPageRowsPerPage(
  rowCount: number,
  fitPageCount: number | undefined,
): number | null {
  const fit = Math.floor(Number(fitPageCount) || 0);
  if (fit <= 0) return null;
  return Math.max(1, Math.ceil(Math.max(rowCount, 1) / fit));
}
