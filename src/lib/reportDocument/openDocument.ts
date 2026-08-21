import { renderReportDocumentHtml } from './renderHtml';
import { exportReportDocumentPdf } from './exportPdf';
import type { ReportDocument, ReportDocumentAction, ReportDocumentLabels } from './types';

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
  applyPageStyle(doc);
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('sandbox', 'allow-same-origin');
  iframe.style.cssText =
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none';
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const idoc = iframe.contentDocument;
  if (!win || !idoc) {
    iframe.remove();
    removePageStyle();
    return;
  }

  idoc.open();
  idoc.write(html);
  idoc.close();

  const cleanup = () => {
    iframe.remove();
    removePageStyle();
    win.removeEventListener('afterprint', cleanup);
  };
  win.addEventListener('afterprint', cleanup);

  // Allow layout + images
  window.setTimeout(() => {
    try {
      win.focus();
      win.print();
    } catch {
      cleanup();
    }
    window.setTimeout(cleanup, 60_000);
  }, 250);
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
        <p class="rdp-title">${labels.title}</p>
        <p class="rdp-hint">${labels.hint}</p>
      </div>
      <div class="rdp-actions">
        <button type="button" class="rdp-btn rdp-muted" data-act="cancel">${labels.cancel}</button>
        <button type="button" class="rdp-btn rdp-secondary" data-act="pdf">${labels.pdf}</button>
        <button type="button" class="rdp-btn rdp-primary" data-act="print">${labels.print}</button>
      </div>
    </div>
    <div class="rdp-viewport">
      <iframe class="rdp-frame" sandbox="allow-same-origin" title="${doc.title}"></iframe>
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
 */
export async function openReportDocument(
  doc: ReportDocument,
  action: ReportDocumentAction,
  formatMoney: (n: number) => string,
  labels: Partial<ReportDocumentLabels> = {},
): Promise<void> {
  const merged = { ...DEFAULT_LABELS, ...labels };
  const html = renderReportDocumentHtml(doc, formatMoney);

  if (action === 'pdf') {
    try {
      await exportReportDocumentPdf(doc, formatMoney);
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
