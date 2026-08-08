/**
 * Thin Electron shell — loads the hosted Web Cost App (Railway or local dev).
 * Set WEB_COST_APP_URL for production; defaults to http://localhost:3000.
 * Multiple app windows share partition `persist:webcost` (same session cookies).
 */
import { app, BrowserWindow, dialog, ipcMain, Notification, session, shell, type WebContents } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { initAutoUpdater } from './updater.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadBundledUrl(): string | undefined {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'production-url.json'), 'utf8');
    const url = (JSON.parse(raw) as { url?: string }).url?.trim();
    return url || undefined;
  } catch {
    return undefined;
  }
}

const START_URL =
  process.env.WEB_COST_APP_URL?.trim() ||
  process.env.ELECTRON_START_URL?.trim() ||
  loadBundledUrl() ||
  'http://localhost:3000';

/** CommonJS preload (see tsconfig.preload.json) — must not use ESM `import`. */
const PRELOAD_PATH = path.join(__dirname, 'preload.js');

/** Packaged: app.asar/public/… · dev: repo root public/… */
const APP_ICON = path.join(__dirname, '../../public/desktop-icon.png');

const AUTH_POPUP_HOST_SUFFIXES = ['google.com', 'googleapis.com', 'firebaseapp.com', 'web.app'];
const DESKTOP_SESSION_PARTITION = 'persist:webcost';

async function clearDesktopAuthCookies(): Promise<void> {
  try {
    const ses = session.fromPartition(DESKTOP_SESSION_PARTITION);
    await ses.clearStorageData({ storages: ['cookies'] });
  } catch (err) {
    console.warn('[electron] clear auth cookies failed', err);
  }
}

function isOAuthPopupUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return AUTH_POPUP_HOST_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    );
  } catch {
    return false;
  }
}

/** Show OAuth popup only when Google account picker is ready — not on blank/Firebase hops. */
function isGoogleAccountsUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'accounts.google.com' || host.endsWith('.accounts.google.com');
  } catch {
    return false;
  }
}

/** Application windows (not OAuth popups). Share DESKTOP_SESSION_PARTITION. */
const appWindows = new Set<BrowserWindow>();

/**
 * WebContents opened as SAP-style New GUI (`reuseSession: true`).
 * Preload queries this via sync IPC — more reliable than `additionalArguments`
 * alone in packaged / sandboxed builds.
 */
const reuseSessionWebContents = new WeakSet<WebContents>();

/**
 * True while `new BrowserWindow()` runs for an app window.
 * `browser-window-created` fires synchronously inside the constructor — before we
 * can `appWindows.add(win)` — so OAuth lifecycle must skip via this flag.
 */
let creatingAppWindow = false;

/** Append `?webCostReuseSession=1` so the SPA can detect New GUI even if preload argv is stripped. */
function withReuseSessionQuery(url: string, reuseSession: boolean): string {
  if (!reuseSession) return url;
  try {
    const u = new URL(url);
    u.searchParams.set('webCostReuseSession', '1');
    return u.toString();
  } catch {
    const join = url.includes('?') ? '&' : '?';
    return `${url}${join}webCostReuseSession=1`;
  }
}

/** First / primary app window — used for load-error fallback and updater focus. */
let mainWindow: BrowserWindow | null = null;

function isAppWindow(win: BrowserWindow): boolean {
  return appWindows.has(win);
}

function getFocusedAppWindow(): BrowserWindow | null {
  for (const win of appWindows) {
    if (!win.isDestroyed() && win.isFocused()) return win;
  }
  return getPrimaryAppWindow();
}

function getPrimaryAppWindow(): BrowserWindow | null {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  for (const win of appWindows) {
    if (!win.isDestroyed()) return win;
  }
  return null;
}

function refreshMainWindowRef() {
  if (mainWindow && !mainWindow.isDestroyed() && appWindows.has(mainWindow)) return;
  mainWindow = getPrimaryAppWindow();
}

/** Off-screen 1×1 until Google account picker is ready — blocks Windows flash of blank popup. */
const OAUTH_HIDDEN_BOUNDS = { x: -48000, y: -48000, width: 1, height: 1 } as const;

function prepareHiddenOAuthPopup(win: BrowserWindow) {
  win.setTitle('Web Cost App');
  win.setOpacity(0);
  win.setSkipTaskbar(true);
  win.setBounds(OAUTH_HIDDEN_BOUNDS);
  let allowShow = false;
  win.on('show', () => {
    if (!allowShow) win.hide();
  });
  return {
    reveal() {
      allowShow = true;
      showOAuthPopup(win);
    },
  };
}

function isAppOriginUrl(url: string): boolean {
  try {
    const start = new URL(START_URL);
    const target = new URL(url);
    return target.origin === start.origin;
  } catch {
    return false;
  }
}

function placeOAuthPopupOverMain(win: BrowserWindow) {
  const anchor = getFocusedAppWindow();
  if (!anchor || anchor.isDestroyed() || win.isDestroyed()) return;
  const b = anchor.getBounds();
  win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
}

function showOAuthPopup(win: BrowserWindow) {
  if (win.isDestroyed() || isAppWindow(win)) return;
  placeOAuthPopupOverMain(win);
  win.setOpacity(1);
  if (!win.isVisible()) win.show();
  win.focus();
}

function attachOAuthPopupLifecycle(win: BrowserWindow) {
  // Hard guard: app windows must NEVER be auto-closed by this logic.
  // Closing mid-load aborts the page (net::ERR_FAILED) and the window
  // "appears then disappears".
  if (isAppWindow(win) || creatingAppWindow) return;

  const wc = win.webContents;
  const popupUi = prepareHiddenOAuthPopup(win);
  getFocusedAppWindow()?.focus();

  const closeIfStray = () => {
    if (win.isDestroyed() || isAppWindow(win)) return;
    const url = wc.getURL();
    if (url === 'about:blank' || url === '') {
      win.close();
      return;
    }
    // Popup redirected back to our app — auth handoff done; hide stray window.
    if (isAppOriginUrl(url) && !isOAuthPopupUrl(url)) {
      win.close();
    }
  };

  wc.on('did-finish-load', closeIfStray);
  wc.on('did-navigate', (_event, url) => {
    if (win.isDestroyed() || isAppWindow(win)) return;
    if (url === 'about:blank' || url === '') {
      win.close();
      return;
    }
    if (isAppOriginUrl(url) && !isOAuthPopupUrl(url)) {
      win.close();
      return;
    }
    if (isGoogleAccountsUrl(url)) popupUi.reveal();
  });
  wc.on('did-navigate-in-page', closeIfStray);

  win.once('ready-to-show', () => {
    if (win.isDestroyed() || isAppWindow(win)) return;
    const url = wc.getURL();
    if (url === 'about:blank' || url === '' || (isAppOriginUrl(url) && !isOAuthPopupUrl(url))) {
      win.close();
      return;
    }
    if (isGoogleAccountsUrl(url)) popupUi.reveal();
  });
}

function showLoadError(target: BrowserWindow | null, message: string) {
  const win = target && !target.isDestroyed() ? target : getPrimaryAppWindow();
  if (!win || win.isDestroyed()) return;
  if (!win.isVisible()) win.show();
  const html = `<!doctype html><html><body style="font-family:Segoe UI,sans-serif;background:#0a0a0a;color:#fff;padding:2rem">
<h1>Web Cost App — load error</h1>
<p>${message.replace(/</g, '&lt;')}</p>
<p style="color:#888">URL: ${START_URL}</p>
<button onclick="location.reload()" style="margin-top:1rem;padding:.5rem 1rem">Retry</button>
</body></html>`;
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

/**
 * Packaged shell: clear Chromium HTTP cache at most once per calendar day so Railway
 * SPA deploys refresh without paying full cold-cache cost on every launch (was a
 * noticeable Electron startup lag). Ctrl+Shift+R still forces reloadIgnoringCache.
 */
async function prepareDesktopSession(): Promise<void> {
  if (!app.isPackaged) return;
  try {
    const markerPath = path.join(app.getPath('userData'), 'spa-http-cache-cleared-day.txt');
    const today = new Date().toISOString().slice(0, 10);
    let lastDay = '';
    try {
      lastDay = fs.readFileSync(markerPath, 'utf8').trim();
    } catch {
      /* first run */
    }
    if (lastDay === today) {
      console.log('[electron] HTTP cache already cleared today — skip');
      return;
    }
    const ses = session.fromPartition(DESKTOP_SESSION_PARTITION);
    await ses.clearCache();
    fs.writeFileSync(markerPath, today, 'utf8');
    console.log('[electron] HTTP cache cleared — loading latest hosted build');
  } catch (err) {
    console.warn('[electron] clearCache failed', err);
  }
}

/**
 * @param reuseSession — SAP-style "New GUI": secondary window keeps the same
 *   `persist:webcost` cookies and skips cold-start logout in the SPA.
 */
function createAppWindow(opts?: { reuseSession?: boolean }): BrowserWindow {
  const reuseSession = opts?.reuseSession === true;
  creatingAppWindow = true;
  let win: BrowserWindow;
  try {
    win = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 1024,
      minHeight: 640,
      title: 'Web Cost App',
      backgroundColor: '#EDF2F6',
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        preload: PRELOAD_PATH,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        backgroundThrottling: false,
        partition: DESKTOP_SESSION_PARTITION,
        // Preload reads this from process.argv — do not clear cookies on secondary windows.
        additionalArguments: reuseSession ? ['--web-cost-reuse-session'] : [],
      },
      icon: APP_ICON,
    });
  } finally {
    creatingAppWindow = false;
  }

  appWindows.add(win);
  if (reuseSession) {
    reuseSessionWebContents.add(win.webContents);
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = win;
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isOAuthPopupUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          show: false,
          title: 'Web Cost App',
          ...OAUTH_HIDDEN_BOUNDS,
          autoHideMenuBar: true,
          skipTaskbar: true,
          backgroundColor: '#EDF2F6',
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            partition: DESKTOP_SESSION_PARTITION,
          },
        },
      };
    }
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error('[electron] did-fail-load', { errorCode, errorDescription, validatedURL, isMainFrame });
    if (isMainFrame) {
      showLoadError(win, `${errorDescription} (${errorCode})`);
    }
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[electron] render-process-gone', details);
    showLoadError(win, `Renderer crashed: ${details.reason}`);
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12') {
      win.webContents.toggleDevTools();
      return;
    }
    // Force latest SPA from Railway (same as browser hard refresh).
    // `input.code` is layout-independent (Arabic keyboard sends different `key`).
    if (input.control && input.shift && (input.code === 'KeyR' || input.key.toLowerCase() === 'r')) {
      event.preventDefault();
      win.webContents.reloadIgnoringCache();
      return;
    }
    // New GUI — same session partition, reuse Express cookies (Ctrl+N / Cmd+N).
    if (
      (input.control || input.meta)
      && !input.alt
      && !input.shift
      && (input.code === 'KeyN' || input.key.toLowerCase() === 'n')
    ) {
      event.preventDefault();
      createAppWindow({ reuseSession: true });
    }
  });

  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    // New GUI: stay hidden until SPA restores session (no logo/login flash).
    if (reuseSession) return;
    win.show();
    win.focus();
  });

  // Safety: never leave a reuse window invisible forever.
  if (reuseSession) {
    const revealTimer = setTimeout(() => {
      if (!win.isDestroyed() && !win.isVisible()) {
        win.show();
        win.focus();
      }
    }, 12_000);
    win.once('closed', () => clearTimeout(revealTimer));
  }

  const loadUrl = withReuseSessionQuery(START_URL, reuseSession);
  console.log('[electron] Loading', loadUrl, reuseSession ? '(reuseSession)' : '');
  void win.loadURL(loadUrl).catch((err: unknown) => {
    console.error('[electron] loadURL rejected', err);
    showLoadError(win, err instanceof Error ? err.message : String(err));
  });

  win.on('closed', () => {
    appWindows.delete(win);
    if (mainWindow === win) {
      mainWindow = null;
      refreshMainWindowRef();
    }
  });

  return win;
}

ipcMain.handle('app-quit', () => {
  app.quit();
});

ipcMain.handle('clear-desktop-session', async () => {
  await clearDesktopAuthCookies();
});

ipcMain.handle('open-new-window', () => {
  createAppWindow({ reuseSession: true });
  return true;
});

/** Sync — preload reads this before exposing `webCostDesktop.reuseSession`. */
ipcMain.on('query-reuse-session', (event) => {
  event.returnValue = reuseSessionWebContents.has(event.sender);
});

/** Reveal a New GUI window after the SPA has restored the session (or failed). */
ipcMain.handle('window-reveal', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return false;
  if (!win.isVisible()) win.show();
  win.focus();
  return true;
});

ipcMain.handle('window-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return false;
  if (win.isMaximized()) {
    win.focus();
    return true;
  }
  win.maximize();
  win.focus();
  return true;
});

ipcMain.handle(
  'show-notification',
  (_event, payload: { title?: string; body?: string }) => {
    if (!Notification.isSupported()) return false;
    const title = typeof payload?.title === 'string' ? payload.title : 'Web Cost App';
    const body = typeof payload?.body === 'string' ? payload.body : '';
    const n = new Notification({ title, body, silent: false });
    n.show();
    return true;
  },
);

/** Prefer Windows system fonts with Arabic coverage (machine-local). */
function resolveLocalReportFontPath(): string | null {
  const candidates: string[] = [];
  if (process.platform === 'win32') {
    const windir = process.env.WINDIR || 'C:\\Windows';
    const fontsDir = path.join(windir, 'Fonts');
    for (const name of ['calibri.ttf', 'segoeui.ttf', 'tahoma.ttf', 'arial.ttf', 'arabtype.ttf']) {
      candidates.push(path.join(fontsDir, name));
    }
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
      '/Library/Fonts/Arial.ttf',
      '/System/Library/Fonts/Supplemental/Tahoma.ttf',
    );
  } else {
    candidates.push(
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    );
  }
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function injectLocalReportFont(html: string, fontFileUrl: string): string {
  const css = `
@font-face {
  font-family: 'ReportLocalArabic';
  src: url('${fontFileUrl}') format('truetype');
  font-weight: 400;
  font-style: normal;
}
body, table, th, td, .mono, .co, h1, .meta, .scope, .ftr {
  font-family: 'ReportLocalArabic', Calibri, 'Segoe UI', Tahoma, Arial, sans-serif !important;
}
`;
  if (html.includes('</head>')) {
    return html.replace('</head>', `<style id="report-local-font">${css}</style></head>`);
  }
  return `<style id="report-local-font">${css}</style>${html}`;
}

type PrintReportPdfPayload = {
  html?: string;
  filename?: string;
  landscape?: boolean;
  pageSize?: string;
};

/**
 * Render report HTML with a machine-local Arabic-capable font → Chromium printToPDF → Save dialog.
 */
ipcMain.handle('print-report-pdf', async (event, payload: PrintReportPdfPayload) => {
  const htmlRaw = typeof payload?.html === 'string' ? payload.html : '';
  if (!htmlRaw.trim()) {
    return { ok: false, error: 'empty_html' as const };
  }

  const defaultName =
    (typeof payload?.filename === 'string' && payload.filename.trim()) || 'report.pdf';
  const safeName = defaultName.toLowerCase().endsWith('.pdf') ? defaultName : `${defaultName}.pdf`;
  const landscape = payload?.landscape === true;
  const pageSizeRaw = String(payload?.pageSize || 'A4').toUpperCase();
  const pageSize = pageSizeRaw === 'A3' ? 'A3' : 'A4';

  const parent = BrowserWindow.fromWebContents(event.sender);
  const save = await dialog.showSaveDialog(parent ?? undefined, {
    title: 'Export PDF',
    defaultPath: path.join(app.getPath('documents'), safeName),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (save.canceled || !save.filePath) {
    return { ok: false, canceled: true as const };
  }

  const fontPath = resolveLocalReportFontPath();
  let html = htmlRaw;
  let tmpFontCopy: string | null = null;
  const tmpHtml = path.join(os.tmpdir(), `web-cost-report-${Date.now()}-${process.pid}.html`);

  try {
    if (fontPath) {
      // Copy beside HTML so Chromium loads it reliably (file:// relative).
      tmpFontCopy = path.join(os.tmpdir(), `web-cost-report-font-${Date.now()}-${process.pid}.ttf`);
      fs.copyFileSync(fontPath, tmpFontCopy);
      const fontUrl = pathToFileURL(tmpFontCopy).href;
      html = injectLocalReportFont(html, fontUrl);
    }

    fs.writeFileSync(tmpHtml, html, 'utf8');

    const printWin = new BrowserWindow({
      show: false,
      width: landscape ? 1400 : 900,
      height: landscape ? 900 : 1200,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    try {
      await printWin.loadFile(tmpHtml);
      await printWin.webContents.executeJavaScript(`
        Promise.all([
          document.fonts ? document.fonts.ready : Promise.resolve(),
          Promise.all(
            Array.from(document.images || []).map((img) =>
              img.complete
                ? Promise.resolve()
                : new Promise((resolve) => {
                    img.onload = img.onerror = () => resolve(undefined);
                  }),
            ),
          ),
        ]).then(() => true)
      `);
      // Brief settle for layout after fonts
      await new Promise((r) => setTimeout(r, 150));

      const pdfBuffer = await printWin.webContents.printToPDF({
        printBackground: true,
        landscape,
        pageSize,
        // Let CSS @page margins control the box (avoid double-shrink from printableArea).
        margins: { marginType: 'none' },
      });

      fs.writeFileSync(save.filePath, pdfBuffer);
      return { ok: true as const, path: save.filePath, font: fontPath || null };
    } finally {
      if (!printWin.isDestroyed()) printWin.destroy();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false as const, error: message };
  } finally {
    try {
      fs.unlinkSync(tmpHtml);
    } catch {
      /* ignore */
    }
    if (tmpFontCopy) {
      try {
        fs.unlinkSync(tmpFontCopy);
      } catch {
        /* ignore */
      }
    }
  }
});

app.whenReady().then(async () => {
  app.setName('Web Cost App');
  await prepareDesktopSession();
  createAppWindow();

  // Register AFTER the first app window exists. The 'browser-window-created' event
  // fires synchronously inside `new BrowserWindow()`, before `appWindows.add` —
  // so registering earlier would attach the OAuth-popup lifecycle to the first
  // app window. closeIfStray then treats app-origin navigation as a stray popup
  // and calls win.close(). For later windows, `creatingAppWindow` + `isAppWindow`
  // skip the OAuth lifecycle.
  app.on('browser-window-created', (_event, win) => {
    if (creatingAppWindow || isAppWindow(win)) return;
    attachOAuthPopupLifecycle(win);
  });

  initAutoUpdater();
  app.on('activate', () => {
    if (appWindows.size === 0) createAppWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  void clearDesktopAuthCookies();
});
