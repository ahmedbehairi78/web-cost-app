/** Hidden print iframe: print dialog only — no scripts. */
export const REPORT_PRINT_IFRAME_SANDBOX = 'allow-same-origin allow-modals';

/**
 * Live preview: selection formatting uses execCommand/designMode, which Chromium
 * blocks without allow-scripts. Still no top-level navigation.
 */
export const REPORT_PREVIEW_IFRAME_SANDBOX = 'allow-same-origin allow-modals allow-scripts';

function isBlobFrame(iframe: HTMLIFrameElement): boolean {
  try {
    return (iframe.contentWindow?.location?.href ?? '').startsWith('blob:');
  } catch {
    return false;
  }
}

/**
 * Load HTML via Blob URL (not about:blank / srcDoc) then open the print dialog.
 * Sandbox without allow-modals silently blocks window.print() in Chromium.
 */
export function printHtmlInHiddenFrame(html: string, onPageStyle?: { apply: () => void; remove: () => void }): void {
  onPageStyle?.apply();
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('sandbox', REPORT_PRINT_IFRAME_SANDBOX);
  iframe.style.cssText =
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none';

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    iframe.removeAttribute('src');
    iframe.remove();
    URL.revokeObjectURL(url);
    onPageStyle?.remove();
  };

  iframe.addEventListener('load', () => {
    if (!isBlobFrame(iframe)) return;
    const win = iframe.contentWindow;
    if (!win) {
      cleanup();
      return;
    }
    win.addEventListener('afterprint', cleanup);
    window.setTimeout(() => {
      try {
        win.focus();
        win.print();
      } catch {
        cleanup();
      }
      window.setTimeout(cleanup, 60_000);
    }, 250);
  });

  iframe.src = url;
  document.body.appendChild(iframe);
}

export function printHtmlInHiddenFrameAsync(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('sandbox', REPORT_PRINT_IFRAME_SANDBOX);
    iframe.style.cssText =
      'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none';

    iframe.addEventListener('load', () => {
      if (!isBlobFrame(iframe)) return;
      const win = iframe.contentWindow;
      if (!win) {
        iframe.remove();
        URL.revokeObjectURL(url);
        reject(new Error('Cannot open print frame'));
        return;
      }
      window.setTimeout(() => {
        try {
          win.focus();
          win.print();
          resolve();
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }, 250);
    });

    iframe.src = url;
    document.body.appendChild(iframe);
    window.setTimeout(() => {
      iframe.removeAttribute('src');
      iframe.remove();
      URL.revokeObjectURL(url);
    }, 60_000);
  });
}
