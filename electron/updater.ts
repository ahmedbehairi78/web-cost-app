/**
 * Auto-update packaged shell via electron-updater (GitHub Releases by default).
 * Skipped in dev / unpackaged runs.
 */
import { createRequire } from 'node:module';
import { app, dialog, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadGenericFeedUrl(): string | undefined {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'update-feed.json'), 'utf8');
    const url = (JSON.parse(raw) as { url?: string }).url?.trim();
    return url || undefined;
  } catch {
    return undefined;
  }
}

function getMainWindow(): BrowserWindow | null {
  const wins = BrowserWindow.getAllWindows();
  return wins.find((w) => !w.isDestroyed()) ?? null;
}

export function initAutoUpdater(): void {
  if (!app.isPackaged) {
    console.log('[updater] skipped (not packaged)');
    return;
  }

  let autoUpdater: import('electron-updater').AppUpdater;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (err) {
    console.error('[updater] failed to load electron-updater (app will run without shell updates)', err);
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;

  const genericUrl = loadGenericFeedUrl();
  if (genericUrl) {
    autoUpdater.setFeedURL({ provider: 'generic', url: genericUrl });
    console.log('[updater] generic feed', genericUrl);
  } else {
    console.log('[updater] using feed from app-update.yml (GitHub Releases)');
  }

  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] checking…');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[updater] update available', info.version);
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] up to date');
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater] error', err);
  });

  autoUpdater.on('download-progress', (p) => {
    const pct = p.percent?.toFixed(0) ?? '0';
    console.log(`[updater] download ${pct}%`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] downloaded', info.version);
    const win = getMainWindow();
    if (!win || win.isDestroyed()) {
      void autoUpdater.quitAndInstall(false, true);
      return;
    }
    void dialog
      .showMessageBox(win, {
        type: 'info',
        title: 'Web Cost App — تحديث',
        message: `إصدار جديد (${info.version}) جاهز.`,
        detail: 'إعادة التشغيل الآن لتثبيت تحديث سطح المكتب؟\n\nA new desktop shell version is ready. Restart now?',
        buttons: ['إعادة التشغيل / Restart', 'لاحقاً / Later'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall(false, true);
      });
  });

  // Let the hosted app load first, then check quietly (Windows toast if available).
  setTimeout(() => {
    void autoUpdater.checkForUpdatesAndNotify().catch((err: unknown) => {
      console.error('[updater] check failed', err);
    });
  }, 8000);
}
