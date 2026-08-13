/**
 * Capture real UI screenshots for the external operations guide.
 *
 * Prerequisites:
 *   - App running: npm run dev:local  (http://localhost:3000 + API :3001)
 *   - Credentials via env (never commit):
 *       SCREENSHOT_EMAIL=you@example.com
 *       SCREENSHOT_PASSWORD=...
 *   - Or: npm run docs:screenshots:manual  (login once in Chromium)
 *
 * Usage:
 *   npm run docs:screenshots
 *   npm run docs:screenshots:manual
 *   npm run docs:screenshots -- --url http://localhost:3000 --headed
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'docs', 'operations-guide', 'screenshots');
const authDir = path.join(root, 'docs', 'operations-guide', '.auth');
const storageStatePath = path.join(authDir, 'user.json');

const args = process.argv.slice(2);
const manualLogin = args.includes('--manual-login');
const headed = args.includes('--headed') || manualLogin;
const urlIdx = args.indexOf('--url');
const baseUrl = (urlIdx >= 0 && args[urlIdx + 1] ? args[urlIdx + 1] : process.env.SCREENSHOT_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

const email = process.env.SCREENSHOT_EMAIL || '';
const password = process.env.SCREENSHOT_PASSWORD || '';

/** Preferred ERP submenu viewId when navigating via __webCostNavigate. */
const PREFERRED_VIEW_ID = {
  dashboard: 'main',
  technical: 'projects',
  costs: 'invoice',
  inventory: 'balance',
  ledger: 'journal',
  banks: 'accounts',
  payroll: 'runs',
  reports: 'income',
  assets: 'register',
  settings: 'database',
};

/** Preferred ERP submenu label (UI fallback). */
const PREFERRED_VIEW = {
  technical: /مشاريع|Projects/i,
  costs: /فاتورة|Invoice/i,
  inventory: /رصيد|Balance/i,
  ledger: /يومية|Journal/i,
  banks: /كشف حساب|Accounts/i,
  payroll: /كشوف|Runs|Payroll/i,
  reports: /دخل|Income/i,
  assets: /سجل|Register/i,
  settings: /قاعدة|Database/i,
};

/** @type {{ id: string; moduleId?: string; waitMs?: number }[]} */
const SHOTS = [
  { id: '01-login', waitMs: 800 },
  { id: '02-desktop-after-login', waitMs: 1200 },
  { id: '03-dashboard', moduleId: 'dashboard', waitMs: 1500 },
  { id: '04-technical-office', moduleId: 'technical', waitMs: 1800 },
  { id: '05-actual-costs', moduleId: 'costs', waitMs: 1800 },
  { id: '06-inventory', moduleId: 'inventory', waitMs: 1800 },
  { id: '07-general-ledger', moduleId: 'ledger', waitMs: 1800 },
  { id: '08-banks', moduleId: 'banks', waitMs: 1800 },
  { id: '09-payroll', moduleId: 'payroll', waitMs: 1800 },
  { id: '10-reports', moduleId: 'reports', waitMs: 1800 },
  { id: '11-fixed-assets', moduleId: 'assets', waitMs: 1800 },
  { id: '12-settings', moduleId: 'settings', waitMs: 1800 },
];

async function ensureOutDir() {
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(authDir, { recursive: true });
}

async function shot(page, id) {
  const file = path.join(outDir, `${id}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  ✓ ${id}.png`);
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

  if (manualLogin || !email || !password) {
    console.log('  · manual login: sign in in the opened Chromium window…');
    await waitForShell(page, 5 * 60_000);
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

async function openModule(page, moduleId) {
  const viewId = PREFERRED_VIEW_ID[moduleId];

  // Prefer the DEV navigate hook (reliable for ERP dropdown modules).
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
      const preferred = PREFERRED_VIEW[moduleId];
      let target = preferred ? menuItems.filter({ hasText: preferred }).first() : null;
      if (!target || !(await target.count())) target = menuItems.first();
      await target.click();
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

  await waitSettled(page, 1600);
  return true;
}

async function main() {
  console.log(`[docs:screenshots] base URL: ${baseUrl}`);
  console.log(`[docs:screenshots] output:   ${outDir}`);
  await ensureOutDir();

  const browser = await chromium.launch({
    headless: !headed,
    args: ['--disable-dev-shm-usage'],
  });

  const useSaved = fs.existsSync(storageStatePath) && !args.includes('--fresh-login');
  if (useSaved && !manualLogin) {
    console.log(`  · reusing saved session ${path.relative(root, storageStatePath)}`);
  } else if (useSaved && manualLogin) {
    console.log(`  · --manual-login ignores saved session (will refresh auth after login)`);
  }

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'ar-EG',
    storageState: useSaved && !manualLogin ? storageStatePath : undefined,
  });
  const page = await context.newPage();

  try {
    // 01 — login screen (only when form is visible; keep prior shot if already in-app)
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitSettled(page, 1200);
    await ensurePasswordMode(page);
    if (await page.locator('input[type="email"]').isVisible().catch(() => false)) {
      await shot(page, '01-login');
    } else if (!fs.existsSync(path.join(outDir, '01-login.png'))) {
      await shot(page, '01-login');
    } else {
      console.log('  · keeping existing 01-login.png');
    }

    await login(page, context);

    // Empty-ish shell / post-login frame
    await shot(page, '02-desktop-after-login');

    for (const step of SHOTS) {
      if (step.id === '01-login' || step.id === '02-desktop-after-login') continue;
      if (step.moduleId) {
        const ok = await openModule(page, step.moduleId);
        if (!ok) continue;
      }
      if (step.waitMs) await waitSettled(page, step.waitMs);
      await shot(page, step.id);
    }

    console.log('\n[docs:screenshots] done. Open docs/operations-guide/OPERATIONS_FLOWS.md or slides.html');
  } catch (err) {
    console.error(err);
    const debugPath = path.join(outDir, '_debug-failure.png');
    try {
      await page.screenshot({ path: debugPath, fullPage: true });
      console.error(`[docs:screenshots] debug shot: ${debugPath}`);
    } catch {
      /* ignore */
    }
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

await main();
