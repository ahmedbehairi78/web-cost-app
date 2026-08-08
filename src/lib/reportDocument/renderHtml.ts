import { resolveHeaderLogo } from '../concordPlusBrand';
import {
  PRINT_FONT_CSS,
  PRINT_MARGIN_CSS,
  resolvePrintTextDir,
  type PrintDensity,
} from '../reportPrintProfiles';
import {
  chunkReportRows,
  defaultPrintRowsPerPage,
  fitPageRowsPerPage,
  flattenReportRows,
  formatDocCell,
  isNumericReportColumn,
  type ReportDocColumn,
  type ReportDocKeyValueItem,
  type ReportDocRow,
  type ReportDocSection,
  type ReportDocument,
} from './types';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function companyName(doc: ReportDocument): string {
  if (doc.language === 'en') {
    return doc.company.companyNameEn || doc.company.companyName || '';
  }
  return doc.company.companyName || '';
}

function companyAddress(doc: ReportDocument): string {
  if (doc.language === 'en') {
    return doc.company.addressEn || doc.company.address || 'Cairo, Egypt';
  }
  return doc.company.address || 'القاهرة، مصر';
}

function footerText(doc: ReportDocument): string {
  if (doc.language === 'en') {
    return doc.company.footerTextEn || doc.company.footerText || '';
  }
  return doc.company.footerText || '';
}

function textAlignClass(col: ReportDocColumn): string {
  if (isNumericReportColumn(col)) return 'num';
  if (col.align === 'left') return 'align-left';
  if (col.align === 'center') return 'align-center';
  return 'align-right';
}

function widthAttr(col: ReportDocColumn): string {
  return col.width ? ` style="width:${col.width}%"` : '';
}

function titleAlignCss(align: ReportDocument['titleAlign']): string {
  if (align === 'start') return 'start';
  if (align === 'end') return 'end';
  return 'center';
}

function logoJustifyCss(align: ReportDocument['logoAlign']): string {
  if (align === 'center') return 'center';
  if (align === 'end') return 'flex-start';
  return 'space-between';
}

function densitySizes(density: PrintDensity | undefined, scale = 1): {
  body: string;
  cell: string;
  th: string;
  title: string;
  co: string;
} {
  // Compact letterhead — leave vertical space for table rows.
  const base =
    density === 'compact'
      ? { body: 8, cell: 7, th: 6.5, title: 10, co: 9 }
      : density === 'comfortable'
        ? { body: 9.5, cell: 8.5, th: 8, title: 12, co: 10 }
        : { body: 8.5, cell: 7.5, th: 7, title: 11, co: 9.5 };
  const s = Math.max(0.55, Math.min(1, scale));
  const pt = (n: number) => `${Math.round(n * s * 10) / 10}pt`;
  return {
    body: pt(base.body),
    cell: pt(base.cell),
    th: pt(base.th),
    title: pt(base.title),
    co: pt(base.co),
  };
}

/** Shrink fonts when fit-to-N packs more rows than the compact sheet capacity. */
function fitPageFontScale(doc: ReportDocument, rowsPerPage: number): number {
  const natural = defaultPrintRowsPerPage({
    orientation: doc.orientation,
    density: 'compact',
  });
  if (rowsPerPage <= natural) return 1;
  return Math.max(0.55, natural / rowsPerPage);
}

/** Physical page box (mm). Margins are applied as sheet padding — not `@page`
 *  — so the preview iframe and Electron `printToPDF({ marginType: 'none' })`
 *  both honor the format-toolbar margin preset. */
function sheetPageBoxCss(
  pageSize: ReportDocument['pageSize'],
  orientation: ReportDocument['orientation'],
): { width: string; height: string } {
  const dims =
    pageSize === 'A3'
      ? orientation === 'landscape'
        ? { w: 420, h: 297 }
        : { w: 297, h: 420 }
      : orientation === 'landscape'
        ? { w: 297, h: 210 }
        : { w: 210, h: 297 };
  return { width: `${dims.w}mm`, height: `${dims.h}mm` };
}

/** Single-row footer parts. Order is logical (company → center → page);
 *  document `dir` places company at the inline-start edge (يمين في العربية /
 *  يسار في الإنجليزية) and the page number at the inline-end edge. */
function buildFooterParts(
  doc: ReportDocument,
  pageLabel: string,
  isLast: boolean,
  footerExtra: string,
): { company: string; center: string; page: string } {
  const company =
    doc.footerShowCompany !== false ? companyName(doc).trim() : '';
  const textParts: string[] = [];
  if (doc.footerShowText !== false) {
    const ft = footerText(doc);
    if (ft) textParts.push(ft);
  }
  if (footerExtra) textParts.push(footerExtra);
  if (doc.footerShowNote !== false && doc.footerNote && isLast) {
    textParts.push(doc.footerNote);
  }
  const center = textParts.join(' · ').trim();
  const page =
    doc.footerShowPageNum !== false ? pageLabel.trim() : '';
  return { company, center, page };
}

/** Wrap numeric cells so Western digits stay LTR and decimals line up. */
function renderCellInner(text: string, col: ReportDocColumn, emphasize = false): string {
  const body = emphasize ? `<strong>${esc(text)}</strong>` : esc(text);
  if (!isNumericReportColumn(col)) return body;
  if (text === '' || text === '—') {
    return `<span class="num-val num-empty">${body}</span>`;
  }
  return `<span class="num-val" dir="ltr">${body}</span>`;
}

function renderBodyRows(
  rows: ReportDocRow[],
  columns: ReportDocColumn[],
  formatMoney: (n: number) => string,
  language: 'ar' | 'en',
): string {
  if (rows.length === 0) {
    return `<tr><td colspan="${columns.length}" class="empty">${esc(
      language === 'ar' ? 'لا توجد بيانات' : 'No data',
    )}</td></tr>`;
  }
  return rows
    .map((row, i) => {
      const zebra = i % 2 === 1 ? ' class="zebra"' : '';
      const cells = columns
        .map((c) => {
          const text = formatDocCell(row[c.key], c, formatMoney);
          return `<td class="${textAlignClass(c)}">${renderCellInner(text, c)}</td>`;
        })
        .join('');
      return `<tr${zebra}>${cells}</tr>`;
    })
    .join('');
}

function renderTotalsRowGeneric(
  columns: ReportDocColumn[],
  totals: ReportDocRow | undefined,
  totalsLabel: string | undefined,
  language: 'ar' | 'en',
  formatMoney: (n: number) => string,
): string {
  if (!totals) return '';
  const cells = columns
    .map((c, idx) => {
      if (idx === 0) {
        return `<td class="${textAlignClass(c)}"><strong>${esc(
          totalsLabel || (language === 'ar' ? 'الإجمالي' : 'Total'),
        )}</strong></td>`;
      }
      const text = formatDocCell(totals[c.key], c, formatMoney);
      return `<td class="${textAlignClass(c)}">${renderCellInner(text, c, true)}</td>`;
    })
    .join('');
  return `<tr class="totals">${cells}</tr>`;
}

function renderTotalsRow(
  doc: ReportDocument,
  formatMoney: (n: number) => string,
): string {
  return renderTotalsRowGeneric(doc.columns, doc.totals, doc.totalsLabel, doc.language, formatMoney);
}

function resolveChunks(doc: ReportDocument): ReportDocRow[][] {
  const fitPerPage = fitPageRowsPerPage(flattenReportRows(doc).length, doc.fitPageCount);
  if (fitPerPage != null) {
    return chunkReportRows(flattenReportRows(doc), fitPerPage);
  }
  if (doc.pageChunks && doc.pageChunks.length > 0) return doc.pageChunks;
  return chunkReportRows(doc.rows, defaultPrintRowsPerPage(doc));
}

/* ── Section rendering (certificate-style documents) ─────────────────────── */

function renderHeadCellsFor(columns: ReportDocColumn[]): string {
  return columns
    .map((c) => `<th class="${textAlignClass(c)}"${widthAttr(c)}>${esc(c.header)}</th>`)
    .join('');
}

function renderKeyValueItems(items: ReportDocKeyValueItem[]): string {
  return items
    .map(
      (it) => `<div class="kv-item${it.emphasize ? ' kv-strong' : ''}">
        <span class="kv-label">${esc(it.label)}</span>
        <span class="kv-value">${esc(it.value)}</span>
      </div>`,
    )
    .join('');
}

function renderSectionTitle(title: string | undefined): string {
  return title ? `<p class="sec-title">${esc(title)}</p>` : '';
}

function renderTableSectionHtml(
  section: Extract<ReportDocSection, { kind: 'table' }>,
  rows: ReportDocRow[],
  includeTotals: boolean,
  language: 'ar' | 'en',
  formatMoney: (n: number) => string,
): string {
  const headCells = renderHeadCellsFor(section.columns);
  const bodyRows = renderBodyRows(rows, section.columns, formatMoney, language);
  const totalsHtml = includeTotals
    ? renderTotalsRowGeneric(section.columns, section.totals, section.totalsLabel, language, formatMoney)
    : '';
  return `${renderSectionTitle(section.title)}<table class="sec-table">
    <thead><tr>${headCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
    ${totalsHtml ? `<tfoot>${totalsHtml}</tfoot>` : ''}
  </table>`;
}

function renderStaticSectionHtml(
  section: ReportDocSection,
  language: 'ar' | 'en',
  formatMoney: (n: number) => string,
): string {
  switch (section.kind) {
    case 'keyValue': {
      const cols = Math.max(1, Math.min(section.columnsPerRow ?? 2, 4));
      return `${renderSectionTitle(section.title)}<div class="kv-grid" style="grid-template-columns: repeat(${cols}, 1fr)">${renderKeyValueItems(section.items)}</div>`;
    }
    case 'summary':
      return `${renderSectionTitle(section.title)}<div class="summary-box">${renderKeyValueItems(section.items)}</div>`;
    case 'signatures': {
      const boxes = section.signatures
        .map(
          (s) => `<div class="sign-box">
            <p class="sign-role">${esc(s.role)}</p>
            <p class="sign-line">${s.name ? esc(s.name) : '&nbsp;'}</p>
          </div>`,
        )
        .join('');
      return `${renderSectionTitle(section.title)}<div class="sign-row">${boxes}</div>`;
    }
    case 'note':
      return `<p class="note">${esc(section.text)}</p>`;
    case 'table':
      return renderTableSectionHtml(section, section.rows, true, language, formatMoney);
  }
}

/** Approximate section height in table-row units — used to budget page space. */
function sectionWeightRows(section: ReportDocSection): number {
  switch (section.kind) {
    case 'keyValue': {
      const cols = Math.max(1, Math.min(section.columnsPerRow ?? 2, 4));
      return 1.5 + Math.ceil(section.items.length / cols) * 1.2 + (section.title ? 1 : 0);
    }
    case 'summary':
      return 2 + section.items.length * 1.2 + (section.title ? 1 : 0);
    case 'table':
      return 3 + section.rows.length + (section.totals ? 1.5 : 0) + (section.title ? 1 : 0);
    case 'signatures':
      return 8;
    case 'note':
      return 2;
  }
}

/**
 * Build one body-HTML string per sheet from `doc.sections`.
 * Sections before the flowing table render on the first sheet, sections after it
 * on the last sheet; the flowing table is chunked across sheets in between.
 */
function buildSectionSheetBodies(
  doc: ReportDocument,
  formatMoney: (n: number) => string,
): string[] {
  const sections = doc.sections ?? [];
  const flowIdx = sections.findIndex((s) => s.kind === 'table' && s.flow === true);

  if (flowIdx === -1) {
    return [sections.map((s) => renderStaticSectionHtml(s, doc.language, formatMoney)).join('\n')];
  }

  const head = sections.slice(0, flowIdx);
  const flow = sections[flowIdx] as Extract<ReportDocSection, { kind: 'table' }>;
  const tail = sections.slice(flowIdx + 1);

  const rows = flow.rows;
  const fitPerPage = fitPageRowsPerPage(rows.length, doc.fitPageCount);
  let chunks: ReportDocRow[][];

  if (fitPerPage != null) {
    // User-chosen page count: distribute the flowing table evenly.
    chunks = chunkReportRows(rows, fitPerPage);
  } else {
    const perPage = defaultPrintRowsPerPage(doc);
    const headCost = head.reduce((a, s) => a + sectionWeightRows(s), 0);
    const tailCost = tail.reduce((a, s) => a + sectionWeightRows(s), 0) + (flow.totals ? 2 : 0);
    chunks = [];
    let i = 0;
    let first = true;
    do {
      const base = Math.max(5, Math.floor(first ? perPage - headCost : perPage));
      const remaining = rows.length - i;
      let take = Math.min(base, Math.max(remaining, 0));
      // Reserve room for tail sections + totals when this would be the final sheet.
      if (remaining <= base && remaining > base - Math.ceil(tailCost)) {
        take = Math.max(1, base - Math.ceil(tailCost));
        if (take > remaining) take = remaining;
      }
      chunks.push(rows.slice(i, i + take));
      i += take;
      first = false;
    } while (i < rows.length);
  }

  const headHtml = head.map((s) => renderStaticSectionHtml(s, doc.language, formatMoney)).join('\n');
  const tailHtml = tail.map((s) => renderStaticSectionHtml(s, doc.language, formatMoney)).join('\n');
  const lastIdx = chunks.length - 1;

  return chunks.map((chunkRows, idx) => {
    const parts: string[] = [];
    if (idx === 0 && headHtml) parts.push(headHtml);
    parts.push(renderTableSectionHtml(flow, chunkRows, idx === lastIdx, doc.language, formatMoney));
    if (idx === lastIdx && tailHtml) parts.push(tailHtml);
    return parts.join('\n');
  });
}

/**
 * Build a self-contained print HTML document from structured data
 * (not a clone of the interactive screen UI).
 */
export function renderReportDocumentHtml(
  doc: ReportDocument,
  formatMoney: (n: number) => string,
): string {
  const dir = resolvePrintTextDir(doc.textDirection ?? 'auto', doc.language);
  const fontStack = PRINT_FONT_CSS[doc.fontFamily ?? 'calibri'];
  const pageMargin = PRINT_MARGIN_CSS[doc.marginPreset ?? 'normal'];
  const titleAlign = titleAlignCss(doc.titleAlign ?? 'center');
  const logoJustify = logoJustifyCss(doc.logoAlign ?? 'start');
  const logoAlign = doc.logoAlign ?? 'start';
  const tableRowCount = doc.sections?.length
    ? (doc.sections.find((s) => s.kind === 'table' && s.flow)?.rows.length ?? 0)
    : flattenReportRows(doc).length;
  const fitPerPage = fitPageRowsPerPage(tableRowCount, doc.fitPageCount);
  const fontScale = fitPerPage != null ? fitPageFontScale(doc, fitPerPage) : 1;
  const sizes = densitySizes(doc.density, fontScale);
  const sheetBox = sheetPageBoxCss(doc.pageSize, doc.orientation);
  const isLandscape = doc.orientation === 'landscape';
  const pageCss =
    doc.pageSize === 'A3'
      ? isLandscape
        ? 'A3 landscape'
        : 'A3 portrait'
      : isLandscape
        ? 'A4 landscape'
        : 'A4 portrait';

  const logoUrl = resolveHeaderLogo(doc.company.headerLogo);
  const metaParts = [doc.scopeLabel, doc.dateLabel].filter(Boolean).join(' · ');
  const showCompany = doc.headerShowCompany !== false;
  const showAddress = doc.headerShowAddress !== false;
  const showTax = doc.headerShowTaxId !== false;
  const showTitle = doc.headerShowTitle !== false;
  const showMeta = doc.headerShowMeta !== false;
  const headerExtra = (doc.headerExtraText || '').trim();
  const footerExtra = (doc.footerExtraText || '').trim();

  const headCells = doc.columns
    .map((c) => {
      const cls = textAlignClass(c);
      return `<th class="${cls}"${widthAttr(c)}>${esc(c.header)}</th>`;
    })
    .join('');

  const brandTextParts: string[] = [];
  if (showCompany) brandTextParts.push(`<p class="co">${esc(companyName(doc))}</p>`);
  if (showAddress) brandTextParts.push(`<p class="meta">${esc(companyAddress(doc))}</p>`);
  if (showTax && doc.company.taxId) {
    brandTextParts.push(
      `<p class="meta">${esc(doc.language === 'ar' ? 'الرقم الضريبي: ' : 'Tax ID: ')}${esc(doc.company.taxId)}</p>`,
    );
  }
  const brandTextHtml = brandTextParts.length
    ? `<div class="brand-text">${brandTextParts.join('')}</div>`
    : '';
  const logoHtml =
    doc.showLogo !== false
      ? `<div class="logo"><img src="${esc(logoUrl)}" alt="" /></div>`
      : '';
  const brandParts =
    logoAlign === 'center'
      ? `${logoHtml}${brandTextHtml}`
      : logoAlign === 'end'
        ? `${logoHtml}${brandTextHtml}`
        : `${brandTextHtml}${logoHtml}`;
  const brandRow =
    brandTextHtml || logoHtml
      ? `<div class="brand" data-logo-align="${esc(logoAlign)}" style="justify-content:${logoJustify}${
          logoAlign === 'center' ? ';flex-direction:column;align-items:center' : ''
        }">${brandParts}</div>`
      : '';

  const useSections = !!doc.sections && doc.sections.length > 0;
  const pageBodies: string[] = useSections
    ? buildSectionSheetBodies(doc, formatMoney)
    : resolveChunks(doc).map((pageRows, pageIndex, arr) => {
        const isLastPage = pageIndex === arr.length - 1;
        const bodyRows = renderBodyRows(pageRows, doc.columns, formatMoney, doc.language);
        const totalsHtml = isLastPage ? renderTotalsRow(doc, formatMoney) : '';
        return `<table>
        <thead><tr>${headCells}</tr></thead>
        <tbody>${bodyRows}</tbody>
        ${totalsHtml ? `<tfoot>${totalsHtml}</tfoot>` : ''}
      </table>`;
      });
  const pageCount = pageBodies.length;

  const sheetsHtml = pageBodies
    .map((pageBodyHtml, pageIndex) => {
      const pageNo = pageIndex + 1;
      const isLast = pageIndex === pageCount - 1;
      const pageLabel =
        doc.language === 'ar' ? `صفحة ${pageNo} من ${pageCount}` : `Page ${pageNo} of ${pageCount}`;

      const titleHtml = showTitle
        ? `<h1 style="color:${esc(doc.accent)}">${esc(doc.title)}</h1>`
        : '';
      // Keep meta on one line with title area — avoid a second tall block.
      const metaLine = [metaParts, pageCount > 1 ? pageLabel : ''].filter(Boolean).join(' · ');
      const metaHtml = showMeta && metaLine ? `<p class="scope">${esc(metaLine)}</p>` : '';
      const headerExtraHtml = headerExtra ? `<p class="hdr-extra">${esc(headerExtra)}</p>` : '';

      const headerBlock = doc.showHeader
        ? `<header class="hdr">
        <div class="accent" style="background:${esc(doc.accent)}"></div>
        ${brandRow}
        <div class="hdr-title-block">
          ${titleHtml}
          ${metaHtml}
          ${headerExtraHtml}
        </div>
      </header>`
        : `<header class="hdr hdr-min">
        <div class="hdr-title-block">
          ${titleHtml}
          ${metaHtml}
          ${headerExtraHtml}
        </div>
      </header>`;

      const footerParts =
        doc.showFooter !== false
          ? buildFooterParts(doc, pageLabel, isLast, footerExtra)
          : { company: '', center: '', page: '' };
      const hasFooter =
        !!(footerParts.company || footerParts.center || footerParts.page);
      const footerBlock = hasFooter
        ? `<footer class="ftr" aria-label="footer">
        <span class="ftr-side ftr-company">${footerParts.company ? esc(footerParts.company) : ''}</span>
        <span class="ftr-center">${footerParts.center ? esc(footerParts.center) : ''}</span>
        <span class="ftr-side ftr-page">${footerParts.page ? esc(footerParts.page) : ''}</span>
      </footer>`
        : '';

      return `<section class="sheet${isLast ? ' sheet-last' : ''}">
    ${headerBlock}
    <div class="sheet-body">
      ${pageBodyHtml}
    </div>
    ${footerBlock}
  </section>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="${doc.language}" dir="${dir}">
<head>
<meta charset="utf-8" />
<title>${esc(doc.title)}</title>
<style>
  /* Margins live on .sheet padding (see sheetPageBoxCss). @page margin stays 0 so
     Electron printToPDF(marginType:none) and the screen preview stay in sync. */
  @page { size: ${pageCss}; margin: 0; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    font-family: ${fontStack};
    font-size: ${sizes.body};
    color: #0f172a;
    background: #fff;
    line-height: 1.3;
  }
  .sheet {
    display: flex;
    flex-direction: column;
    width: ${sheetBox.width};
    max-width: 100%;
    /* Auto height so the footer sits under the last data row — no flex gap.
       Cap at one physical page so packed sheets still fit the printable box. */
    height: auto;
    min-height: 0;
    max-height: ${sheetBox.height};
    padding: ${pageMargin};
    overflow: hidden;
    break-after: page;
    page-break-after: always;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .sheet-last {
    break-after: auto;
    page-break-after: auto;
  }
  .hdr {
    flex: 0 0 auto;
    margin: 0 0 3px;
    padding: 0;
    text-align: ${titleAlign};
  }
  .hdr .accent { height: 2px; margin: 0 0 4px; }
  .brand {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 2px;
    text-align: start;
  }
  .co { margin: 0; font-weight: 700; font-size: ${sizes.co}; line-height: 1.2; }
  .meta { margin: 1px 0 0; font-size: 7pt; color: #64748b; line-height: 1.2; }
  .logo img { height: 8mm; max-width: 36mm; object-fit: contain; }
  .hdr-title-block { margin: 0; }
  h1 {
    margin: 2px 0 0;
    font-size: ${sizes.title};
    font-weight: 800;
    line-height: 1.2;
    text-align: ${titleAlign};
  }
  .scope, .hdr-extra {
    margin: 1px 0 0;
    font-size: 7.5pt;
    color: #475569;
    line-height: 1.2;
    text-align: ${titleAlign};
  }
  .hdr-extra { font-style: italic; }
  .sheet-body {
    flex: 0 1 auto;
    min-height: 0;
    overflow: hidden;
  }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead { display: table-header-group; }
  th, td {
    padding: 2px 4px;
    border-bottom: 1px solid #e2e8f0;
    vertical-align: top;
    overflow-wrap: anywhere;
    word-break: break-word;
    font-size: ${sizes.cell};
    line-height: 1.25;
  }
  th {
    background: color-mix(in srgb, ${esc(doc.accent)} 12%, #fff);
    border-bottom: 1.5px solid ${esc(doc.accent)};
    font-weight: 700;
    font-size: ${sizes.th};
  }
  tr.zebra td { background: #f8fafc; }
  tr.totals td { background: #f1f5f9; border-top: 1.5px solid #0f172a; }
  .align-left { text-align: left; }
  .align-center { text-align: center; }
  .align-right { text-align: right; }
  [dir="rtl"] .align-left { text-align: right; }
  [dir="rtl"] .align-right { text-align: left; }
  th.num, td.num {
    text-align: right !important;
    white-space: nowrap;
    overflow-wrap: normal;
    word-break: normal;
    font-variant-numeric: tabular-nums;
  }
  .num .num-val {
    display: block;
    width: 100%;
    box-sizing: border-box;
    direction: ltr;
    unicode-bidi: isolate;
    text-align: right;
    font-variant-numeric: tabular-nums lining-nums;
    font-feature-settings: "tnum" 1, "lnum" 1;
    font-family: ${fontStack};
    white-space: nowrap;
  }
  .num .num-empty {
    opacity: 0.55;
    text-align: right;
  }
  .empty { text-align: center; padding: 16px; color: #64748b; }
  /* Certificate sections (keyValue / summary / signatures / note) */
  .sec-title {
    margin: 6px 0 3px;
    font-weight: 800;
    font-size: ${sizes.cell};
    color: ${esc(doc.accent)};
  }
  .sec-table { margin-bottom: 6px; }
  .kv-grid { display: grid; gap: 2px 14px; margin: 4px 0 6px; }
  .kv-item {
    display: flex;
    gap: 6px;
    align-items: baseline;
    border-bottom: 1px dotted #e2e8f0;
    padding: 1.5px 0;
    min-width: 0;
  }
  .kv-label { color: #64748b; font-size: ${sizes.cell}; white-space: nowrap; flex: 0 0 auto; }
  .kv-value {
    font-weight: 600;
    font-size: ${sizes.cell};
    overflow-wrap: anywhere;
    margin-inline-start: auto;
    text-align: end;
  }
  .kv-strong .kv-value, .kv-strong .kv-label { font-weight: 800; color: #0f172a; }
  .summary-box {
    margin: 6px 0;
    margin-inline-start: auto;
    padding: 4px 10px;
    border: 1px solid #e2e8f0;
    border-radius: 4px;
    background: #f8fafc;
    max-width: 95mm;
  }
  .summary-box .kv-item { border-bottom: 1px solid #e2e8f0; }
  .summary-box .kv-item:last-child { border-bottom: none; }
  .sign-row {
    display: flex;
    gap: 8mm;
    justify-content: space-between;
    margin-top: 8mm;
  }
  .sign-box { flex: 1 1 0; text-align: center; min-width: 0; }
  .sign-role { margin: 0 0 9mm; font-weight: 700; font-size: ${sizes.cell}; }
  .sign-line {
    margin: 0;
    border-top: 1px solid #0f172a;
    padding-top: 2px;
    font-size: ${sizes.cell};
    color: #475569;
    min-height: 1.3em;
  }
  .note { margin: 4px 0; font-size: ${sizes.cell}; color: #475569; }
  /* One-line footer: company (start) · text+note (center) · page (end).
     Inherits html[dir] so AR → company يمين / page يسار, EN → mirrored. */
  .ftr {
    flex: 0 0 auto;
    margin: 2px 0 0;
    padding: 1px 0 0;
    border-top: 1px solid #cbd5e1;
    font-size: 6.5pt;
    line-height: 1.2;
    color: #64748b;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    overflow: hidden;
    min-height: 0;
  }
  .ftr-side {
    flex: 1 1 0;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ftr-company { text-align: start; font-weight: 600; }
  .ftr-page { text-align: end; font-variant-numeric: tabular-nums; }
  .ftr-center {
    flex: 1.4 1 0;
    min-width: 0;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .sheet {
      break-after: page;
      page-break-after: always;
    }
    .sheet-last {
      break-after: auto;
      page-break-after: auto;
    }
  }
</style>
</head>
<body>
  ${sheetsHtml}
</body>
</html>`;
}
