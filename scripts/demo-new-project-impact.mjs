/**
 * Demo: create a new project (+ contract) and capture immediate impact
 * across related modules. Uses saved Playwright session when available.
 *
 *   npm run docs:demo-project
 *   npm run docs:demo-project -- --headed
 *   npm run docs:demo-project -- --manual-login
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'docs', 'operations-guide', 'project-create-demo', 'screenshots');
const authPath = path.join(root, 'docs', 'operations-guide', '.auth', 'user.json');
const manifestPath = path.join(root, 'docs', 'operations-guide', 'project-create-demo', 'demo-manifest.json');

const args = process.argv.slice(2);
const manualLogin = args.includes('--manual-login');
const headed = args.includes('--headed') || manualLogin;
const impactOnly = args.includes('--impact-only');
const baseUrl = (process.env.SCREENSHOT_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const DEMO = {
  projectCode: process.env.DEMO_PROJECT_CODE || `PRJ-DEMO-${stamp}`,
  projectName: 'مشروع تجريبي — عرض إنشاء مشروع',
  projectNameEn: 'Demo Project — Create Walkthrough',
  clientName: 'عميل تجريبي Concord',
  clientNameEn: 'Concord Demo Client',
  status: 'active',
  boqValue: '1500000',
  voValue: '0',
  contractNumber: process.env.DEMO_CONTRACT_NUMBER || `CRT-DEMO-${stamp}`,
  contractName: 'عقد تجريبي رئيسي',
  contractNameEn: 'Main Demo Contract',
};

async function wait(page, ms = 800) {
  await page.waitForTimeout(ms);
}

async function shot(page, id) {
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${id}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  ✓ ${id}.png`);
}

async function navigate(page, moduleId, viewId) {
  const ok = await page.evaluate(
    ({ moduleId: mid, viewId: vid }) => {
      const nav = window.__webCostNavigate;
      if (typeof nav !== 'function') return false;
      nav(mid, vid);
      return true;
    },
    { moduleId, viewId },
  );
  if (!ok) throw new Error('window.__webCostNavigate missing — hard-refresh the app (DEV) and re-login');
  await wait(page, 1600);
}

async function ensureLoggedIn(page, context) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await wait(page, 1200);
  const inApp = await page.locator('[data-shell-module]').first().isVisible().catch(() => false);
  const loginVisible = await page.locator('input[type="email"]').isVisible().catch(() => false);
  if (inApp && !loginVisible) return;

  if (!manualLogin) {
    throw new Error(
      'Not logged in. Run: npm run docs:demo-project -- --manual-login\n' +
        'or capture session first via npm run docs:screenshots:manual',
    );
  }
  console.log('  · sign in in the Chromium window…');
  await page.waitForSelector('[data-shell-module]', { timeout: 5 * 60_000 });
  await wait(page, 1500);
  fs.mkdirSync(path.dirname(authPath), { recursive: true });
  await context.storageState({ path: authPath });
}

async function fillByLabel(page, labelRe, value) {
  const label = page.locator('label').filter({ hasText: labelRe }).first();
  const field = label.locator('xpath=following-sibling::*[1]//input | following-sibling::input | following-sibling::select').first();
  if (await field.count()) {
    await field.fill(String(value));
    return;
  }
  // Fallback: nearest input in parent
  const parentInput = label.locator('xpath=..//input | ..//select').first();
  await parentInput.fill(String(value));
}

async function createProjectViaUi(page) {
  await navigate(page, 'technical', 'projects');
  await shot(page, '01-before-projects-list');

  const newBtn = page.getByRole('button', { name: /مشروع جديد|New Project/i }).first();
  await newBtn.click();
  await wait(page, 600);
  await shot(page, '02-new-project-modal-empty');

  await fillByLabel(page, /كود المشروع|Project Code/i, DEMO.projectCode);
  await fillByLabel(page, /اسم المشروع \(عربي\)|Project Name \(Arabic\)/i, DEMO.projectName);
  await fillByLabel(page, /اسم المشروع \(إنجليزي\)|Project Name \(English\)/i, DEMO.projectNameEn);
  await fillByLabel(page, /اسم العميل \(عربي\)|Client Name \(Arabic\)/i, DEMO.clientName);
  await fillByLabel(page, /اسم العميل \(إنجليزي\)|Client Name \(English\)/i, DEMO.clientNameEn);

  // Optional budget fields if present
  const boqLabel = page.locator('label').filter({ hasText: /قيمة|BOQ|ميزانية|Budget/i }).first();
  if (await boqLabel.count()) {
    const input = boqLabel.locator('xpath=..//input').first();
    if (await input.count()) await input.fill(DEMO.boqValue);
  }

  await shot(page, '03-new-project-modal-filled');

  await page.getByRole('button', { name: /حفظ المشروع|Save Project|حفظ|Save/i }).first().click();
  await wait(page, 2200);

  // Ensure list shows the new code
  await page.getByText(DEMO.projectCode, { exact: false }).first().waitFor({ timeout: 15_000 });
  await shot(page, '04-project-saved-in-list');
}

async function createContractViaUi(page) {
  const card = page.locator('div').filter({ hasText: DEMO.projectCode }).filter({ hasText: DEMO.clientName }).first();
  await card.scrollIntoViewIfNeeded().catch(() => {});

  const addContract = card.getByRole('button', { name: /إضافة عقد|Add Contract/i }).first();
  if (await addContract.count()) {
    await addContract.click();
  } else {
    const globalAdd = page.getByRole('button', { name: /إضافة عقد|Add Contract/i }).first();
    if (!(await globalAdd.count())) {
      throw new Error('Could not find Add Contract button');
    }
    await globalAdd.click();
  }

  await wait(page, 700);
  await page.getByText(/إضافة عقد جديد|Add New Contract/i).first().waitFor({ timeout: 8_000 });
  await shot(page, '05-add-contract-modal');

  await page.locator('input[placeholder*="اسم العقد"], input[placeholder*="Contract name"]').first().fill(DEMO.contractName);
  const enInput = page.locator('input[placeholder*="English"], input[placeholder*="Contract name in English"]').first();
  if (await enInput.count()) await enInput.fill(DEMO.contractNameEn);
  await fillByLabel(page, /رقم العقد|Contract Number/i, DEMO.contractNumber);

  await shot(page, '06-add-contract-filled');
  await page.getByRole('button', { name: /تأكيد الإضافة|Confirm/i }).click();
  await wait(page, 2000);
  await shot(page, '07-contract-on-project');
}

async function createViaApi(page, context) {
  // Fallback using cookies from the browser context
  const cookies = await context.cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const apiBase = process.env.SCREENSHOT_API_BASE || 'http://localhost:3001/api';

  const projectBody = {
    id: randomUUID(),
    projectCode: DEMO.projectCode,
    projectName: DEMO.projectName,
    projectNameEn: DEMO.projectNameEn,
    clientName: DEMO.clientName,
    clientNameEn: DEMO.clientNameEn,
    status: 'active',
    boqValue: Number(DEMO.boqValue),
    voValue: 0,
    budget: Number(DEMO.boqValue),
    isDeleted: false,
  };

  const pRes = await fetch(`${apiBase}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
    body: JSON.stringify(projectBody),
  });
  if (!pRes.ok) {
    const t = await pRes.text();
    throw new Error(`API project create failed: ${pRes.status} ${t}`);
  }
  const project = await pRes.json();
  const projectId = project.id || projectBody.id;

  const contractBody = {
    id: randomUUID(),
    projectId,
    contractNumber: DEMO.contractNumber,
    contractName: DEMO.contractName,
    contractNameEn: DEMO.contractNameEn,
    contractValue: Number(DEMO.boqValue),
    startDate: new Date().toISOString().slice(0, 10),
    isDeleted: false,
  };
  const cRes = await fetch(`${apiBase}/contracts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
    body: JSON.stringify(contractBody),
  });
  if (!cRes.ok) {
    const t = await cRes.text();
    throw new Error(`API contract create failed: ${cRes.status} ${t}`);
  }
  const contract = await cRes.json();
  return { projectId, contractId: contract.id || contractBody.id };
}

async function openFilterMentioning(page, labelRe, typeText) {
  try {
    // Prefer visible SearchableSelect-style buttons in filter sidebars
    const buttons = page.locator('button').filter({ hasText: /كل المشاريع|All projects|—|اختر|Select|Project|مشروع/i });
    const count = await buttons.count();
    for (let i = 0; i < Math.min(count, 6); i++) {
      const b = buttons.nth(i);
      if (!(await b.isVisible().catch(() => false))) continue;
      await b.click({ timeout: 3_000 }).catch(() => {});
      await wait(page, 250);
      if (typeText) {
        await page.keyboard.type(typeText, { delay: 20 });
        await wait(page, 400);
        const opt = page.getByText(typeText, { exact: false }).first();
        if (await opt.isVisible().catch(() => false)) {
          await opt.click({ timeout: 2_000 }).catch(() => {});
        }
      }
      await page.keyboard.press('Escape').catch(() => {});
      return;
    }
    // Fallback: label proximity (best-effort, never block the demo)
    const label = page.getByText(labelRe).first();
    if (await label.count()) {
      await label.click({ timeout: 2_000 }).catch(() => {});
    }
  } catch {
    /* impact screenshots are best-effort */
  }
}

async function captureImpact(page) {
  await navigate(page, 'dashboard', 'main');
  await wait(page, 1400);
  await openFilterMentioning(page, /المشروع|Project/i, DEMO.projectCode);
  await wait(page, 600);
  await shot(page, '08-impact-dashboard');

  await navigate(page, 'inventory', 'balance');
  await wait(page, 1400);
  await openFilterMentioning(page, /مشروع|Project/i, DEMO.projectCode);
  await wait(page, 600);
  await shot(page, '09-impact-inventory');

  await navigate(page, 'costs', 'invoice');
  await wait(page, 1400);
  await openFilterMentioning(page, /مشروع|Project/i, DEMO.projectCode);
  await wait(page, 600);
  await shot(page, '10-impact-costs');

  await navigate(page, 'technical', 'boq');
  await wait(page, 1600);
  await openFilterMentioning(page, /مشروع|Project/i, DEMO.projectCode);
  await wait(page, 600);
  await shot(page, '11-impact-boq');

  await navigate(page, 'technical', 'billing');
  await wait(page, 1600);
  await openFilterMentioning(page, /مشروع|Project/i, DEMO.projectCode);
  await wait(page, 600);
  await shot(page, '12-impact-billing');

  await navigate(page, 'reports', 'income');
  await wait(page, 1600);
  await openFilterMentioning(page, /مشروع|Project/i, DEMO.projectCode);
  await wait(page, 600);
  await shot(page, '13-impact-reports');

  await navigate(page, 'settings', 'cost_centers');
  await wait(page, 1600);
  await shot(page, '14-impact-cost-centers');
}

async function main() {
  console.log(`[demo-project] ${DEMO.projectCode}`);
  console.log(`[demo-project] shots → ${outDir}`);
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: !headed, args: ['--disable-dev-shm-usage'] });
  const useSaved = fs.existsSync(authPath) && !manualLogin;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'ar-EG',
    storageState: useSaved ? authPath : undefined,
  });
  const page = await context.newPage();

  let ids = { projectId: null, contractId: null, via: 'ui' };

  try {
    await ensureLoggedIn(page, context);

    if (impactOnly) {
      console.log('  · --impact-only: skipping create, capturing related modules');
      await navigate(page, 'technical', 'projects');
      await wait(page, 1200);
      await shot(page, '04-project-saved-in-list');
      await captureImpact(page);
    } else {
      try {
        await createProjectViaUi(page);
        try {
          await createContractViaUi(page);
        } catch (err) {
          console.warn(`  ! UI contract failed (${err.message}) — API fallback`);
          ids = { ...(await createViaApi(page, context)), via: 'ui-project+api-contract' };
          await navigate(page, 'technical', 'projects');
          await wait(page, 1200);
          await shot(page, '07-contract-on-project');
        }
      } catch (err) {
        console.warn(`  ! UI project failed (${err.message}) — full API fallback`);
        ids = { ...(await createViaApi(page, context)), via: 'api' };
        await navigate(page, 'technical', 'projects');
        await wait(page, 1500);
        await shot(page, '01-before-projects-list');
        await shot(page, '04-project-saved-in-list');
        await shot(page, '07-contract-on-project');
      }

      await captureImpact(page);
    }

    const manifest = {
      createdAt: new Date().toISOString(),
      demo: DEMO,
      ids,
      screenshotsDir: path.relative(root, outDir),
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    console.log(`\n[demo-project] done → ${path.relative(root, manifestPath)}`);
    console.log('[demo-project] open docs/operations-guide/project-create-demo/DEMO.md or slides.html');
  } catch (err) {
    console.error(err);
    await page.screenshot({ path: path.join(outDir, '_debug-failure.png'), fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

await main();
