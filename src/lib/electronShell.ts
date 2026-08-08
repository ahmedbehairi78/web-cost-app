export type DesktopPrintReportPdfResult =
  | { ok: true; path: string; font: string | null }
  | { ok: false; canceled?: true; error?: string };

type WebCostDesktopBridge = {
  platform?: string;
  /** Secondary Electron window opened via Ctrl+N / New GUI — reuse session cookies. */
  reuseSession?: boolean;
  quitApp?: () => Promise<void>;
  clearSession?: () => Promise<void>;
  maximizeWindow?: () => Promise<boolean>;
  openNewWindow?: () => Promise<boolean>;
  revealWindow?: () => Promise<boolean>;
  showNotification?: (title: string, body: string) => Promise<boolean>;
  printReportPdf?: (payload: {
    html: string;
    filename?: string;
    landscape?: boolean;
    pageSize?: string;
  }) => Promise<DesktopPrintReportPdfResult>;
};

function desktopBridge(): WebCostDesktopBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { webCostDesktop?: WebCostDesktopBridge }).webCostDesktop;
}

/** URL flag set by Electron main for New GUI windows (`?webCostReuseSession=1`). */
function consumeReuseSessionUrlFlag(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const u = new URL(window.location.href);
    if (u.searchParams.get('webCostReuseSession') !== '1') return false;
    u.searchParams.delete('webCostReuseSession');
    const next = `${u.pathname}${u.search}${u.hash}`;
    window.history.replaceState({}, document.title, next || '/');
    return true;
  } catch {
    return false;
  }
}

let reuseSessionCached: boolean | null = null;

/** Set by Electron preload (`electron/preload.ts`). */
export function isElectronShell(): boolean {
  return typeof desktopBridge() !== 'undefined';
}

/**
 * Secondary desktop window (SAP-style New GUI): same partition cookies,
 * must not run cold-start logout / must restore password session via probe.
 * Detects via preload bridge and/or `?webCostReuseSession=1` on the load URL.
 */
export function isDesktopSessionReuseWindow(): boolean {
  if (reuseSessionCached !== null) return reuseSessionCached;
  const fromBridge = desktopBridge()?.reuseSession === true;
  const fromUrl = consumeReuseSessionUrlFlag();
  reuseSessionCached = fromBridge || fromUrl;
  return reuseSessionCached;
}

/** Maximize the desktop shell window after login (no-op in browser). */
export function requestWindowMaximize(): void {
  const bridge = desktopBridge();
  if (bridge?.maximizeWindow) {
    void bridge.maximizeWindow().catch(() => undefined);
  }
}

/** Open another Electron app window with the same session partition (no-op in browser). */
export function requestOpenNewWindow(): void {
  const bridge = desktopBridge();
  if (bridge?.openNewWindow) {
    void bridge.openNewWindow().catch(() => undefined);
  }
}

/** Show a New GUI window that was kept hidden until session restore (no-op in browser). */
export function requestRevealDesktopWindow(): void {
  const bridge = desktopBridge();
  if (bridge?.revealWindow) {
    void bridge.revealWindow().catch(() => undefined);
  }
}

/** Clear persisted session cookies/storage in the desktop partition (cold start / logout). */
export function clearDesktopSessionStorage(): void {
  const bridge = desktopBridge();
  if (bridge?.clearSession) {
    void bridge.clearSession().catch(() => undefined);
  }
}
/** Close the desktop shell entirely (no-op in browser). */
export function requestAppQuit(): void {
  const bridge = desktopBridge();
  if (bridge?.quitApp) {
    void bridge.quitApp().catch(() => undefined);
  }
}

/**
 * Electron-only: render report HTML to PDF with a machine-local Arabic font
 * (Segoe UI / Tahoma / Arial from Windows Fonts) via Chromium printToPDF.
 */
export async function requestDesktopReportPdf(payload: {
  html: string;
  filename?: string;
  landscape?: boolean;
  pageSize?: string;
}): Promise<DesktopPrintReportPdfResult> {
  const bridge = desktopBridge();
  if (!bridge?.printReportPdf) {
    return { ok: false, error: 'printReportPdf_unavailable' };
  }
  return bridge.printReportPdf(payload);
}

const DESKTOP_NOTIFIED_KEY = 'web_cost_desktop_notified_keys';

/** Show OS notification in Electron for urgent unread items (once per key per session). */
export function notifyDesktopUrgent(title: string, body: string, itemKey: string): void {
  const bridge = desktopBridge();
  if (!bridge?.showNotification) return;
  try {
    const raw = sessionStorage.getItem(DESKTOP_NOTIFIED_KEY);
    const seen = new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
    if (seen.has(itemKey)) return;
    seen.add(itemKey);
    sessionStorage.setItem(DESKTOP_NOTIFIED_KEY, JSON.stringify([...seen].slice(-200)));
  } catch {
    /* ignore */
  }
  void bridge.showNotification(title, body).catch(() => undefined);
}
