import type { CompanyPrintInfo } from '../ipcPrintData';
import type { ReportPrintId } from '../reportPrintProfiles';
import { resolveReportPrintProfile, type StoredReportPrintProfiles } from '../reportPrintProfiles';
import {
  profileToDocLayout,
  type ReportDocColumn,
  type ReportDocRow,
  type ReportDocSection,
  type ReportDocument,
} from './types';

export type BuildTableDocInput = {
  reportId: ReportPrintId;
  title: string;
  language: 'ar' | 'en';
  company: CompanyPrintInfo;
  storedProfiles?: StoredReportPrintProfiles;
  scopeLabel?: string;
  dateLabel?: string;
  columns: ReportDocColumn[];
  rows: ReportDocRow[];
  /** Certificate-style documents — renders sections instead of columns/rows. */
  sections?: ReportDocSection[];
  /** Pre-paginated sheets (Budget vs Actual, etc.). */
  pageChunks?: ReportDocRow[][];
  totals?: ReportDocRow;
  totalsLabel?: string;
  footerNote?: string;
  filename: string;
  /** Client IPC Cover-JLL first sheet. */
  coverPage?: ReportDocument['coverPage'];
  /** Applied after profile defaults (e.g. force A4 portrait for IPC cover). */
  layoutOverrides?: Partial<ReturnType<typeof profileToDocLayout>>;
};

/** Build a ReportDocument from tabular data + company print profile. */
export function buildTableReportDocument(input: BuildTableDocInput): ReportDocument {
  const profile = resolveReportPrintProfile(input.storedProfiles ?? input.company.reportPrintProfiles, input.reportId);
  return {
    id: input.reportId,
    title: input.title,
    language: input.language,
    company: input.company,
    scopeLabel: input.scopeLabel,
    dateLabel: input.dateLabel,
    columns: input.columns,
    rows: input.rows,
    sections: input.sections,
    pageChunks: input.pageChunks,
    totals: input.totals,
    totalsLabel: input.totalsLabel,
    footerNote: input.footerNote,
    filename: input.filename,
    coverPage: input.coverPage,
    ...profileToDocLayout(profile),
    ...input.layoutOverrides,
  };
}
