import * as XLSX from 'xlsx';
import { formatDocCell, type ReportDocColumn, type ReportDocRow, type ReportDocSection, type ReportDocument } from './types';

function tableCell(
  col: ReportDocColumn,
  row: ReportDocRow | undefined,
  formatMoney: (n: number) => string,
): string | number {
  if (!row) return '';
  const raw = row[col.key];
  if (col.money && typeof raw === 'number') return raw;
  return formatDocCell(raw, col, formatMoney);
}

function appendTable(
  aoa: unknown[][],
  columns: ReportDocColumn[],
  rows: ReportDocRow[],
  totals: ReportDocRow | undefined,
  totalsLabel: string | undefined,
  formatMoney: (n: number) => string,
): void {
  if (!columns.length) return;
  aoa.push(columns.map((c) => c.header));
  for (const row of rows) {
    aoa.push(columns.map((c) => tableCell(c, row, formatMoney)));
  }
  if (totals) {
    const tot = columns.map((c, i) => {
      if (i === 0 && totalsLabel) return totalsLabel;
      return tableCell(c, totals, formatMoney);
    });
    aoa.push(tot);
  }
}

function appendKeyValues(
  aoa: unknown[][],
  items: { label: string; value: string; amountFirst?: boolean }[],
): void {
  for (const item of items) {
    aoa.push(item.amountFirst ? [item.value, item.label] : [item.label, item.value]);
  }
}

function appendSection(
  aoa: unknown[][],
  section: ReportDocSection,
  formatMoney: (n: number) => string,
): void {
  if (section.kind === 'note') {
    aoa.push([section.text]);
    return;
  }
  if (section.kind === 'signatures') {
    if (section.title) aoa.push([section.title]);
    for (const sig of section.signatures) {
      aoa.push([sig.role, sig.name ?? '']);
    }
    return;
  }
  if (section.kind === 'keyValue' || section.kind === 'summary') {
    if (section.title) aoa.push([section.title]);
    appendKeyValues(aoa, section.items);
    return;
  }
  if (section.kind === 'twoColumn') {
    if (section.title) aoa.push([section.title]);
    appendKeyValues(aoa, section.left);
    aoa.push([]);
    appendKeyValues(aoa, section.right);
    return;
  }
  if (section.kind === 'table') {
    if (section.title) aoa.push([section.title]);
    appendTable(aoa, section.columns, section.rows, section.totals, section.totalsLabel, formatMoney);
    return;
  }
  if (section.kind === 'ipcCoverMain') {
    aoa.push([section.worksTitle]);
    appendKeyValues(aoa, section.worksItems);
    aoa.push([]);
    aoa.push([section.deductionsTitle]);
    appendTable(aoa, section.deductionColumns, section.deductionRows, undefined, undefined, formatMoney);
    return;
  }
  if (section.kind === 'ipcCoverClosing') {
    aoa.push([section.fundsLabel, section.amountInWords]);
    aoa.push([section.preparedByLabel, section.preparedBy]);
    aoa.push([section.approvedByLabel, section.approvedBy]);
  }
}

/** Flatten a print document into one worksheet (title + all tables stacked). */
export function buildReportDocumentExcelAoA(
  doc: ReportDocument,
  formatMoney: (n: number) => string,
): unknown[][] {
  const aoa: unknown[][] = [[doc.title]];
  if (doc.scopeLabel) aoa.push([doc.scopeLabel]);
  if (doc.dateLabel) aoa.push([doc.dateLabel]);
  aoa.push([]);

  if (doc.sections && doc.sections.length > 0) {
    for (const section of doc.sections) {
      appendSection(aoa, section, formatMoney);
      aoa.push([]);
    }
  } else {
    const rows = doc.pageChunks && doc.pageChunks.length > 0 ? doc.pageChunks.flat() : doc.rows;
    appendTable(aoa, doc.columns, rows, doc.totals, doc.totalsLabel, formatMoney);
  }

  if (doc.footerNote) {
    aoa.push([doc.footerNote]);
  }
  return aoa;
}

export function exportReportDocumentExcel(
  doc: ReportDocument,
  formatMoney: (n: number) => string,
): void {
  const aoa = buildReportDocumentExcelAoA(doc, formatMoney);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const colCount = Math.max(1, ...aoa.map((r) => r.length));
  ws['!cols'] = Array.from({ length: colCount }, () => ({ wch: 22 }));
  const wb = XLSX.utils.book_new();
  const sheetName = (doc.title || 'Report').slice(0, 31);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const safe = (doc.filename || 'report').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'report';
  XLSX.writeFile(wb, `${safe}.xlsx`);
}
