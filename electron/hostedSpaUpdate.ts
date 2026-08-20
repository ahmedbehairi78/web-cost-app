/**
 * Poll the hosted spa-build.json from the Electron main process.
 * The running SPA is often a cached bundle, so Now/Later must not live only in React.
 * Later keeps the current session; Now reloads windows without quitting.
 */
import { dialog, net, type BrowserWindow } from 'electron';

function parseBuildId(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '';
  return String((raw as { id?: unknown }).id || '').trim();
}

function spaBuildUrl(startUrl: string): string {
  const base = startUrl.replace(/\/+$/, '');
  return `${base}/spa-build.json?t=${Date.now()}`;
}

export function startHostedSpaUpdateWatcher(opts: {
  startUrl: string;
  getMainWindow: () => BrowserWindow | null;
  applyReload: () => Promise<void>;
  intervalMs?: number;
}): () => void {
  const intervalMs = opts.intervalMs ?? 60_000;
  let baselineId: string | null = null;
  let snoozedId: string | null = null;
  let dialogOpen = false;
  let stopped = false;

  const check = async () => {
    if (stopped || dialogOpen) return;
    let id = '';
    try {
      const res = await net.fetch(spaBuildUrl(opts.startUrl));
      if (!res.ok) return;
      id = parseBuildId(await res.json());
    } catch (err) {
      console.warn('[electron] spa-build check failed', err);
      return;
    }
    if (!id) return;
    if (!baselineId) {
      baselineId = id;
      return;
    }
    if (id === baselineId || id === snoozedId) return;

    const win = opts.getMainWindow();
    if (!win || win.isDestroyed()) return;

    dialogOpen = true;
    try {
      const { response } = await dialog.showMessageBox(win, {
        type: 'info',
        title: 'Web Cost App — تحديث',
        message: 'يتوفر تحديث جديد للتطبيق.',
        detail:
          'يمكنك التحديث الآن أو الاستمرار في العمل لاحقاً.\nلن يُغلق التطبيق من تلقاء نفسه.\n\nA new app version is available. Update now, or later and keep working.',
        buttons: ['تحديث الآن / Update now', 'لاحقاً / Later'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (response === 0) {
        baselineId = id;
        snoozedId = null;
        await opts.applyReload();
      } else {
        snoozedId = id;
      }
    } catch (err) {
      console.warn('[electron] spa-update dialog failed', err);
    } finally {
      dialogOpen = false;
    }
  };

  const startTimer = setTimeout(() => {
    void check();
  }, 12_000);
  const timer = setInterval(() => {
    void check();
  }, intervalMs);

  return () => {
    stopped = true;
    clearTimeout(startTimer);
    clearInterval(timer);
  };
}
