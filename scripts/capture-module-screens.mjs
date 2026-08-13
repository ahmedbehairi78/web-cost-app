/**
 * Capture per-module / per-view screenshots from catalog.json.
 *
 * Prerequisites:
 *   - App running: npm run dev:local  (http://localhost:3000 + API :3001)
 *   - Credentials via env (never commit):
 *       SCREENSHOT_EMAIL=you@example.com
 *       SCREENSHOT_PASSWORD=...
 *   - Or: npm run docs:screenshots:modules:manual
 *
 * Usage:
 *   npm run docs:screenshots:modules
 *   npm run docs:screenshots:modules -- --module costs
 *   npm run docs:screenshots:modules -- --module inventory --view balance
 *   npm run docs:screenshots:modules -- --tier 1
 *   npm run docs:screenshots:modules -- --headed --fresh-login
 */

import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const catalogPath = path.join(root, 'docs', 'operations-guide', 'module-screens', 'catalog.json');
const authDir = path.join(root, 'docs', 'operations-guide', '.auth');
const storageStatePath = path.join(authDir, 'user.json');

const args = process.argv.slice(2);

function argValue(flag) {
  const idx = args.indexOf(flag);
  if (idx < 0 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

const manualLogin = args.includes('--manual-login');
const dryRun = args.includes('--dry-run');
const headed = args.includes('--headed') || manualLogin;
const freshLogin = args.includes('--fresh-login');
const filterModule = argValue('--module');
const filterView = argValue('--view');
const filterTierRaw = argValue('--tier');
const filterTier = filterTierRaw != null ? Number(filterTierRaw) : null;
const baseUrl = (argValue('--url') || process.env.SCREENSHOT_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

const email = process.env.SCREENSHOT_EMAIL || '';
const password = process.env.SCREENSHOT_PASSWORD || '';

/** Fallback UI clicks when __webCostNavigate is missing. */
const VIEW_LABEL = {
  dashboard: { main: /لوحة|Dashboard/i },
  ledger: {
    journal: /يومية|Journal/i,
    statement: /كشف|Statement/i,
    periods: /فترات|Periods|OHA|overhead/i,
  },
  technical: {
    projects: /مشاريع|Projects/i,
    boq: /كميات|BOQ/i,
    billing: /مستخلص|Billing|IPC/i,
    documents: /مستندات|Documents/i,
  },
  costs: {
    invoice: /فاتورة|Invoice/i,
    ipc: /مستخلص|IPC/i,
    custody: /عهدة|Custody/i,
  },
  inventory: {
    materials: /أصناف|Materials/i,
    balance: /رصيد|Balance/i,
    receipts: /استلام|Receipts/i,
    transfers: /تحويل|Transfers/i,
    history: /سجل|History|Issues/i,
  },
  banks: {
    accounts: /كشف حساب|Accounts/i,
    transactions: /معاملات|Transactions/i,
    statements: /كشوف|Statements/i,
  },
  reports: {
    income: /دخل|Income/i,
    budget: /ميزانية|Budget/i,
    balance: /ميزانية عمومية|Balance/i,
    trial: /مراجعة|Trial/i,
    time: /زمني|Time/i,
    liquidity: /سيولة|Liquidity/i,
    costs: /تكاليف|Costs/i,
  },
  settings: {
    database: /قاعدة|Database/i,
    users: /مستخدم|Users/i,
    coa: /حسابات|COA|Chart/i,
    cost_centers: /مراكز|Cost centers/i,
    activity: /نشاط|Activity/i,
  },
  assets: {
    register: /سجل|Register/i,
    depreciation: /إهلاك|Depreciation/i,
  },
  payroll: {
    runs: /كشوف|Runs|Payroll/i,
    employees: /موظفين|Employees/i,
    settings: /إعدادات|Settings/i,
  },
  purchase_requests: {
    create: /إنشاء|Create/i,
    open: /نشطة|Open|Active/i,
    executed: /منتهية|Executed/i,
  },
};

function loadCatalog() {
  const raw = fs.readFileSync(catalogPath, 'utf8');
  return JSON.parse(raw);
}

function filterScreens(screens) {
  return screens.filter((s) => {
    if (filterModule) {
      const mid = String(filterModule);
      if (mid === '_shared') {
        if (s.moduleId !== '_shared' && s.special !== 'login' && s.special !== 'desktop-after-login' && s.moduleId !== 'general') {
          return false;
        }
      } else if (s.moduleId !== mid) {
        return false;
      }
    }
    if (filterView && s.viewId !== filterView) return false;
    if (filterTier != null && !Number.isNaN(filterTier) && s.tier !== filterTier) return false;
    return true;
  });
}

function parseButtonRegex(spec) {
  if (!spec || typeof spec !== 'string') return null;
  const m = spec.match(/^\/(.+)\/([a-z]*)$/i);
  if (!m) return new RegExp(spec, 'i');
  return new RegExp(m[1], m[2] || 'i');
}

async function waitSettled(page, ms = 900) {
  await page.waitForTimeout(ms);
}

async function ensurePasswordMode(page) {
  const emailInput = page.locator('input[type="email"]');
  if (await emailInput.isVisible().catch(() => false)) return;

  const passwordTab = page.getByRole('button', { name: /كلمة المرور|Password/i });
  if (await passwordTab.isVisible().catch(() => false)) {
    await passwordTab.click();
    await waitSettled(page, 400);
  }
}

async function waitForShell(page, timeoutMs) {
  await page.waitForSelector('[data-shell-module]', { timeout: timeoutMs });
  await waitSettled(page, 2000);
}

async function isInsideApp(page) {
  const shell = page.locator('[data-shell-module]').first();
  const loginForm = page.locator('input[type="email"]');
  return (await shell.isVisible().catch(() => false)) && !(await loginForm.isVisible().catch(() => false));
}

async function login(page, context) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitSettled(page, 1500);

  if (await isInsideApp(page)) {
    console.log('  · session already active — skipping login form');
    return false;
  }

  if (fs.existsSync(storageStatePath) && !manualLogin && !freshLogin) {
    console.warn('  · saved session present but not authenticated — need fresh login');
  }

  if (manualLogin) {
    if (!headed) {
      throw new Error('--manual-login requires --headed (or run docs:screenshots:modules:manual)');
    }
    console.log('  · manual login: sign in in the opened Chromium window…');
    await waitForShell(page, 5 * 60_000);
  } else if (!email || !password) {
    throw new Error(
      'Not signed in. Set SCREENSHOT_EMAIL + SCREENSHOT_PASSWORD in .env, or run: npm run docs:screenshots:modules:manual',
    );
  } else {
    await ensurePasswordMode(page);
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('form button[type="submit"]').click();
    await waitForShell(page, 90_000);
  }

  await context.storageState({ path: storageStatePath });
  console.log(`  · saved session → ${path.relative(root, storageStatePath)}`);
  return true;
}

async function openModule(page, moduleId, viewId) {
  if (!moduleId || moduleId === '_shared') return true;

  const usedHook = await page.evaluate(
    ({ moduleId: mid, viewId: vid }) => {
      const nav = window.__webCostNavigate;
      if (typeof nav !== 'function') return false;
      nav(mid, vid);
      return true;
    },
    { moduleId, viewId },
  );

  if (!usedHook) {
    console.log(`  · ${moduleId}: no __webCostNavigate — falling back to UI clicks`);
    const btn = page.locator(`[data-shell-module="${moduleId}"]`).first();
    if (!(await btn.count())) {
      console.warn(`  ! module button not found: ${moduleId} — skipping`);
      return false;
    }
    await page.keyboard.press('Escape');
    await waitSettled(page, 200);
    await btn.hover();
    await waitSettled(page, 450);
    let menuItems = page.locator('[role="menuitem"]:visible');
    if ((await menuItems.count()) === 0) {
      await btn.click();
      await waitSettled(page, 450);
      menuItems = page.locator('[role="menuitem"]:visible');
    }
    if ((await menuItems.count()) > 0) {
      const preferred = VIEW_LABEL[moduleId]?.[viewId];
      let target = preferred ? menuItems.filter({ hasText: preferred }).first() : null;
      if (!target || !(await target.count())) target = menuItems.first();
      await target.click();
    } else {
      await btn.click();
    }
  }

  try {
    await page.waitForFunction(
      (id) => {
        const el = document.querySelector(`[data-shell-module="${id}"]`);
        if (!el) return false;
        const cls = el.className || '';
        return cls.includes('erp-nav-entry--active') || cls.includes('bg-blue-600');
      },
      moduleId,
      { timeout: 10_000 },
    );
  } catch {
    console.warn(`  ! ${moduleId}: active state not confirmed — capturing anyway`);
  }

  await waitSettled(page, 1200);
  return true;
}

async function runPreActions(page, pre) {
  if (!Array.isArray(pre) || pre.length === 0) return true;
  for (const step of pre) {
    if (step.type === 'select-first') {
      const selects = page.locator('aside select, select');
      const idx = Number(step.index ?? 0);
      const count = await selects.count();
      if (idx >= count) {
        console.warn(`  ! select-first: no select at index ${idx}`);
        return false;
      }
      const sel = selects.nth(idx);
      const options = sel.locator('option');
      const n = await options.count();
      let picked = false;
      for (let i = 0; i < n; i++) {
        const val = await options.nth(i).getAttribute('value');
        if (val) {
          await sel.selectOption(val);
          await waitSettled(page, 700);
          picked = true;
          break;
        }
      }
      if (!picked) {
        console.warn(`  ! select-first: no non-empty option at index ${idx}`);
        return false;
      }
    } else if (step.type === 'click') {
      const re = parseButtonRegex(step.button);
      const btn = page.getByRole('button', { name: re }).first();
      if (!(await btn.count()) || !(await btn.isVisible().catch(() => false))) {
        console.warn(`  ! pre-click not found for ${re}`);
        return false;
      }
      await btn.click();
      await waitSettled(page, 700);
    }
  }
  return true;
}

async function runOpenNewModal(page, action) {
  const preOk = await runPreActions(page, action?.pre);
  if (!preOk) return false;

  const re = parseButtonRegex(action?.button);
  if (!re) {
    console.warn('  ! open-new-modal missing button regex');
    return false;
  }
  const btn = page.getByRole('button', { name: re }).first();
  if (!(await btn.count()) || !(await btn.isVisible().catch(() => false))) {
    console.warn(`  ! button not found for ${re} — skipping modal shot`);
    return false;
  }
  await btn.click();
  await waitSettled(page, 900);
  return true;
}

async function dismissModal(page) {
  await page.keyboard.press('Escape');
  await waitSettled(page, 400);
  await page.keyboard.press('Escape');
  await waitSettled(page, 300);
}

async function shotFile(page, outRoot, relativeFile) {
  const file = path.join(outRoot, relativeFile);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  ✓ ${relativeFile}`);
  return file;
}

function markCaptured(catalog, screenId) {
  const screen = catalog.screens.find((s) => s.id === screenId);
  if (!screen) return;
  screen.capturedAt = new Date().toISOString();
}

async function main() {
  const catalog = loadCatalog();
  const outRoot = path.join(root, catalog.outputDir || 'docs/operations-guide/module-screens');
  const screens = filterScreens(catalog.screens || []);

  console.log(`[docs:screenshots:modules] base URL: ${baseUrl}`);
  console.log(`[docs:screenshots:modules] output:   ${path.relative(root, outRoot)}`);
  console.log(`[docs:screenshots:modules] screens:  ${screens.length}/${catalog.screens.length}`);
  if (filterModule) console.log(`  · filter --module ${filterModule}`);
  if (filterView) console.log(`  · filter --view ${filterView}`);
  if (filterTier != null && !Number.isNaN(filterTier)) console.log(`  · filter --tier ${filterTier}`);
  if (dryRun) console.log('  · --dry-run (no browser)');

  if (screens.length === 0) {
    console.warn('  ! no screens matched filters — nothing to do');
    return;
  }

  if (dryRun) {
    for (const s of screens) {
      console.log(`  · would capture [${s.tier}] ${s.id} → ${s.file}${s.action ? ` (action=${s.action.type})` : ''}`);
    }
    console.log(`\n[docs:screenshots:modules] dry-run ok — ${screens.length} screen(s)`);
    return;
  }

  fs.mkdirSync(outRoot, { recursive: true });
  fs.mkdirSync(authDir, { recursive: true });

  const browser = await chromium.launch({
    headless: !headed,
    args: ['--disable-dev-shm-usage'],
  });

  const useSaved = fs.existsSync(storageStatePath) && !freshLogin && !manualLogin;
  if (useSaved) {
    console.log(`  · reusing saved session ${path.relative(root, storageStatePath)}`);
  } else if (manualLogin) {
    console.log('  · --manual-login ignores saved session (will refresh auth after login)');
  }

  const vw = catalog.viewport?.width || 1440;
  const vh = catalog.viewport?.height || 900;
  const context = await browser.newContext({
    viewport: { width: vw, height: vh },
    locale: catalog.locale || 'ar-EG',
    storageState: useSaved ? storageStatePath : undefined,
  });
  const page = await context.newPage();

  let failures = 0;
  let currentId = null;

  try {
    const needsLoginShot = screens.some((s) => s.special === 'login');
    const needsDesktopShot = screens.some((s) => s.special === 'desktop-after-login');
    const needsAppScreens = screens.some((s) => !s.special || (s.special !== 'login' && s.special !== 'desktop-after-login'));

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitSettled(page, 1200);
    await ensurePasswordMode(page);

    if (needsLoginShot) {
      currentId = 'shared-login';
      const loginScreen = screens.find((s) => s.special === 'login');
      if (await page.locator('input[type="email"]').isVisible().catch(() => false)) {
        await shotFile(page, outRoot, loginScreen.file);
        markCaptured(catalog, loginScreen.id);
      } else {
        const existing = path.join(outRoot, loginScreen.file);
        if (!fs.existsSync(existing)) {
          await shotFile(page, outRoot, loginScreen.file);
          markCaptured(catalog, loginScreen.id);
        } else {
          console.log(`  · keeping existing ${loginScreen.file}`);
        }
      }
    }

    if (needsAppScreens || needsDesktopShot) {
      await login(page, context);
    }

    if (needsDesktopShot) {
      currentId = 'shared-desktop-after-login';
      const desk = screens.find((s) => s.special === 'desktop-after-login');
      await waitSettled(page, desk.waitMs || 1200);
      await shotFile(page, outRoot, desk.file);
      markCaptured(catalog, desk.id);
    }

    for (const screen of screens) {
      if (screen.special === 'login' || screen.special === 'desktop-after-login') continue;
      currentId = screen.id;

      try {
        await page.keyboard.press('Escape').catch(() => {});
        const ok = await openModule(page, screen.moduleId, screen.viewId);
        if (!ok) {
          failures += 1;
          continue;
        }
        if (screen.waitMs) await waitSettled(page, screen.waitMs);

        if (screen.action?.type === 'open-new-modal') {
          const opened = await runOpenNewModal(page, screen.action);
          if (!opened) {
            failures += 1;
            continue;
          }
          await waitSettled(page, 600);
        }

        await shotFile(page, outRoot, screen.file);
        markCaptured(catalog, screen.id);

        if (screen.action?.type === 'open-new-modal') {
          await dismissModal(page);
        }
      } catch (err) {
        failures += 1;
        console.error(`  ✗ ${screen.id}:`, err?.message || err);
        const debugPath = path.join(outRoot, `_debug-failure-${screen.id}.png`);
        try {
          await page.screenshot({ path: debugPath, fullPage: true });
          console.error(`  · debug: ${path.relative(root, debugPath)}`);
        } catch {
          /* ignore */
        }
        await dismissModal(page).catch(() => {});
      }
    }

    catalog.lastRunAt = new Date().toISOString();
    fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
    console.log(`\n[docs:screenshots:modules] done. failures=${failures}`);
    console.log(`  catalog updated → ${path.relative(root, catalogPath)}`);
    if (failures > 0) process.exitCode = 1;
  } catch (err) {
    console.error(err);
    const debugPath = path.join(outRoot, `_debug-failure${currentId ? `-${currentId}` : ''}.png`);
    try {
      await page.screenshot({ path: debugPath, fullPage: true });
      console.error(`[docs:screenshots:modules] debug shot: ${debugPath}`);
    } catch {
      /* ignore */
    }
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

await main();
