import { isElectronShell, requestDesktopReportPdf } from '../electronShell';
import { renderReportDocumentHtml } from './renderHtml';
import { printHtmlInHiddenFrameAsync } from './printFrame';
import type { ReportDocument } from './types';

/**
 * Export a structured report to PDF.
 * - **Electron:** Chromium `printToPDF` + machine-local Arabic font (Segoe UI / Tahoma).
 * - **Browser / old shell:** print dialog (Save as PDF).
 */
export async function exportReportDocumentPdf(
  doc: ReportDocument,
  formatMoney: (n: number) => string,
  htmlOverride?: string,
): Promise<void> {
  const html = htmlOverride ?? renderReportDocumentHtml(doc, formatMoney);
  const filename = doc.filename.endsWith('.pdf') ? doc.filename : `${doc.filename}.pdf`;

  if (isElectronShell()) {
    const result = await requestDesktopReportPdf({
      html,
      filename,
      landscape: doc.orientation === 'landscape',
      pageSize: doc.pageSize,
    });
    if (result.ok) return;
    const failure = result as { ok: false; canceled?: true; error?: string };
    if (failure.canceled) return;
    if (failure.error !== 'printReportPdf_unavailable') {
      throw new Error(failure.error || 'Electron PDF export failed');
    }
    // Packaged shell without PDF IPC — fall through to print dialog.
  }

  await printHtmlInHiddenFrameAsync(html);
}
