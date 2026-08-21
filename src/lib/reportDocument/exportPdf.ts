import { isElectronShell, requestDesktopReportPdf } from '../electronShell';
import { renderReportDocumentHtml } from './renderHtml';
import type { ReportDocument } from './types';

/**
 * Export a structured report to PDF.
 * - **Electron:** Chromium `printToPDF` + machine-local Arabic font (Segoe UI / Tahoma).
 * - **Browser:** falls back to print dialog (Save as PDF) — not the primary path.
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
    throw new Error(failure.error || 'Electron PDF export failed');
  }

  // Browser: open print preview so user can "Save as PDF" (secondary path).
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText =
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none';
  document.body.appendChild(iframe);
  const idoc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!idoc || !win) {
    iframe.remove();
    throw new Error('Cannot open print frame');
  }
  idoc.open();
  idoc.write(html);
  idoc.close();
  await new Promise<void>((resolve) => setTimeout(resolve, 250));
  try {
    win.focus();
    win.print();
  } finally {
    window.setTimeout(() => iframe.remove(), 60_000);
  }
}
