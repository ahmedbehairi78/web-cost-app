import { contextBridge, ipcRenderer } from 'electron';

/**
 * True when this BrowserWindow was opened as a secondary "New GUI" (same session).
 * Prefer sync IPC (reliable in packaged + sandboxed builds); argv is a fallback.
 */
const reuseSession =
  ipcRenderer.sendSync('query-reuse-session') === true
  || process.argv.includes('--web-cost-reuse-session')
  || process.argv.some((a) => a.includes('web-cost-reuse-session'));

/** Same window after reload — keep cookies. False on a brand-new BrowserWindow. */
const keepSessionOnLoad = ipcRenderer.sendSync('query-keep-session') === true;

export type PrintReportPdfResult =
  | { ok: true; path: string; font: string | null }
  | { ok: false; canceled?: true; error?: string };

/** Desktop shell bridge (no Node exposure to the page). */
contextBridge.exposeInMainWorld('webCostDesktop', {
  platform: process.platform,
  /** Secondary OS window — keep Express cookies; skip cold-start logout. */
  reuseSession,
  /** Reload of this window (SPA update / Ctrl+Shift+R) — keep Express cookies. */
  keepSessionOnLoad,
  quitApp: () => ipcRenderer.invoke('app-quit') as Promise<void>,
  getSystemIdleSeconds: () => ipcRenderer.invoke('system-idle-seconds') as Promise<number | null>,
  relaunchApp: () => ipcRenderer.invoke('app-relaunch') as Promise<void>,
  clearSession: () => ipcRenderer.invoke('clear-desktop-session') as Promise<void>,
  maximizeWindow: () => ipcRenderer.invoke('window-maximize') as Promise<boolean>,
  openNewWindow: () => ipcRenderer.invoke('open-new-window') as Promise<boolean>,
  /** Show this window after session restore (New GUI stays hidden until then). */
  revealWindow: () => ipcRenderer.invoke('window-reveal') as Promise<boolean>,
  showNotification: (title: string, body: string) =>
    ipcRenderer.invoke('show-notification', { title, body }) as Promise<boolean>,
  /**
   * Export report HTML → PDF via Chromium printToPDF + machine-local Arabic font
   * (e.g. Segoe UI / Tahoma under Windows Fonts).
   */
  printReportPdf: (payload: {
    html: string;
    filename?: string;
    landscape?: boolean;
    pageSize?: string;
  }) => ipcRenderer.invoke('print-report-pdf', payload) as Promise<PrintReportPdfResult>,
  /** Clear hosted-SPA HTTP cache and reload every app window — does not quit. */
  applySpaUpdate: () => ipcRenderer.invoke('apply-spa-update') as Promise<boolean>,
});
