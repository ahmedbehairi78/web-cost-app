import { renderReportDocumentHtml } from './renderHtml';
import { exportReportDocumentPdf } from './exportPdf';
import { printHtmlInHiddenFrame } from './printFrame';
import type { ReportDocument, ReportDocumentAction, ReportDocumentLabels } from './types';
import { escapeHtml } from './htmlEscape';

const PREVIEW_ROOT = 'report-doc-preview-root';
const PREVIEW_OPEN = 'report-doc-preview-open';

const DEFAULT_LABELS: ReportDocumentLabels = {
  title: 'Print preview',
  hint: 'Review the document, then print or export PDF.',
  print: 'Print',
  pdf: 'PDF',
  cancel: 'Cancel',
};

function applyPageStyle(doc: ReportDocument): void {
  const id = 'report-doc-page-style';
  let style = document.getElementById(id) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = id;
    document.head.appendChild(style);
  }
  // Sheet padding in the HTML owns the printable margins; keep @page at 0 so
  // browser print does not double-apply margins on top of .sheet padding.
  style.textContent = `@page { size: ${doc.pageSize} ${doc.orientation}; margin: 0; }`;
}

function removePageStyle(): void {
  document.getElementById('report-doc-page-style')?.remove();
}

function printHtmlDocument(html: string, doc: ReportDocument): void {
  printHtmlInHiddenFrame(html, {
    apply: () => applyPageStyle(doc),
    remove: removePageStyle,
  });
}

function openPreview(
  doc: ReportDocument,
  html: string,
  labels: ReportDocumentLabels,
  formatMoney: (n: number) => string,
): void {
  if (document.getElementById(PREVIEW_ROOT)) return;

  const overlay = document.createElement('div');
  overlay.id = PREVIEW_ROOT;
  overlay.className = PREVIEW_ROOT;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('dir', doc.language === 'ar' ? 'rtl' : 'ltr');

  overlay.innerHTML = `
    <div class="rdp-toolbar">
      <div class="rdp-titles">
        <p class="rdp-title">${escapeHtml(labels.title)}</p>
        <p class="rdp-hint">${escapeHtml(labels.hint)}</p>
      </div>
      <div class="rdp-actions">
        <button type="button" class="rdp-btn rdp-muted" data-act="cancel">${escapeHtml(labels.cancel)}</button>
        <button type="button" class="rdp-btn rdp-secondary" data-act="pdf">${escapeHtml(labels.pdf)}</button>
        <button type="button" class="rdp-btn rdp-primary" data-act="print">${escapeHtml(labels.print)}</button>
      </div>
    </div>
    <div class="rdp-viewport">
      <iframe class="rdp-frame" sandbox="allow-same-origin" title="${escapeHtml(doc.title)}"></iframe>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    body.${PREVIEW_OPEN} { overflow: hidden !important; }
    .${PREVIEW_ROOT} {
      position: fixed; inset: 0; z-index: 2147483646;
      display: flex; flex-direction: column; background: #64748b;
    }
    .${PREVIEW_ROOT} .rdp-toolbar {
      flex-shrink: 0; display: flex; flex-wrap: wrap; align-items: center;
      justify-content: space-between; gap: 12px; padding: 12px 20px;
      background: #1e293b; color: #f8fafc;
    }
    .${PREVIEW_ROOT} .rdp-title { margin: 0; font-weight: 700; font-size: 1rem; }
    .${PREVIEW_ROOT} .rdp-hint { margin: 2px 0 0; font-size: 0.75rem; color: #94a3b8; }
    .${PREVIEW_ROOT} .rdp-actions { display: flex; gap: 8px; margin-inline-start: auto; }
    .${PREVIEW_ROOT} .rdp-btn {
      border: none; border-radius: 8px; padding: 8px 16px; font-weight: 600;
      font-size: 0.875rem; cursor: pointer;
    }
    .${PREVIEW_ROOT} .rdp-muted { background: #334155; color: #e2e8f0; }
    .${PREVIEW_ROOT} .rdp-secondary { background: #0f766e; color: #fff; }
    .${PREVIEW_ROOT} .rdp-primary { background: #2563eb; color: #fff; }
    .${PREVIEW_ROOT} .rdp-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .${PREVIEW_ROOT} .rdp-viewport { flex: 1; min-height: 0; padding: 20px; overflow: auto; }
    .${PREVIEW_ROOT} .rdp-frame {
      display: block; width: min(100%, ${doc.orientation === 'landscape' ? '297mm' : '210mm'});
      min-height: ${doc.orientation === 'landscape' ? '210mm' : '297mm'};
      height: auto;
      margin: 0 auto; background: #fff; border: 0;
      box-shadow: 0 8px 32px rgb(0 0 0 / 0.25);
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(overlay);
  document.body.classList.add(PREVIEW_OPEN);

  const iframe = overlay.querySelector('iframe') as HTMLIFrameElement;
  const idoc = iframe.contentDocument;
  if (idoc) {
    idoc.open();
    idoc.write(html);
    idoc.close();
    // Expand iframe to full document height so multi-page tables are visible in preview
    window.setTimeout(() => {
      try {
        const h = idoc.documentElement?.scrollHeight || idoc.body?.scrollHeight || 800;
        iframe.style.height = `${Math.max(h + 24, 400)}px`;
      } catch {
        /* ignore */
      }
    }, 50);
  }

  const close = () => {
    iframe.removeAttribute('src');
    iframe.removeAttribute('srcdoc');
    overlay.remove();
    style.remove();
    document.body.classList.remove(PREVIEW_OPEN);
    document.removeEventListener('keydown', onKey);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };
  document.addEventListener('keydown', onKey);

  overlay.querySelector('[data-act="cancel"]')?.addEventListener('click', close);
  overlay.querySelector('[data-act="print"]')?.addEventListener('click', () => {
    close();
    printHtmlDocument(html, doc);
  });
  overlay.querySelector('[data-act="pdf"]')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = doc.language === 'ar' ? 'جاري…' : '…';
    try {
      await exportReportDocumentPdf(doc, formatMoney);
    } catch (err) {
      console.error(err);
      window.alert(
        doc.language === 'ar'
          ? 'فشل تصدير PDF. تأكد أنك تستخدم تطبيق سطح المكتب (Electron) بعد إعادة بنائه.'
          : 'PDF export failed. Use the Electron desktop app after rebuilding the shell.',
      );
    } finally {
      btn.disabled = false;
      btn.textContent = prev;
    }
  });
}

/**
 * Unified entry: preview / print / pdf from a structured ReportDocument
 * (never clones the interactive screen).
 * Optional `htmlOverride` prints a live-edited preview (selection formatting).
 */
export async function openReportDocument(
  doc: ReportDocument,
  action: ReportDocumentAction,
  formatMoney: (n: number) => string,
  labels: Partial<ReportDocumentLabels> = {},
  htmlOverride?: string,
): Promise<void> {
  const merged = { ...DEFAULT_LABELS, ...labels };
  const html = htmlOverride ?? renderReportDocumentHtml(doc, formatMoney);

  if (action === 'pdf') {
    try {
      await exportReportDocumentPdf(doc, formatMoney, htmlOverride);
    } catch (err) {
      console.error(err);
      throw err;
    }
    return;
  }
  if (action === 'print') {
    printHtmlDocument(html, doc);
    return;
  }
  openPreview(doc, html, merged, formatMoney);
}
