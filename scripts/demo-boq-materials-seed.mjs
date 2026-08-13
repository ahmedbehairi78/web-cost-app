/**
 * Seed a new contract + 3 BOQ items + material links on the demo project,
 * then capture UI screenshots of BOQ and material linking.
 *
 *   npm run docs:demo-boq -- --headed
 *   npm run docs:demo-boq -- --manual-login
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'docs', 'operations-guide', 'boq-materials-demo', 'screenshots');
const authPath = path.join(root, 'docs', 'operations-guide', '.auth', 'user.json');
const manifestPath = path.join(root, 'docs', 'operations-guide', 'boq-materials-demo', 'demo-manifest.json');

const args = process.argv.slice(2);
const manualLogin = args.includes('--manual-login');
const headed = args.includes('--headed') || manualLogin;
const seedOnly = args.includes('--seed-only');
const shotsOnly = args.includes('--shots-only');
const baseUrl = (process.env.SCREENSHOT_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const apiBase = process.env.SCREENSHOT_API_BASE || 'http://localhost:3001/api';

const PROJECT_CODE = process.env.DEMO_PROJECT_CODE || 'PRJ-DEMO-20260812';
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const CONTRACT_NUMBER = process.env.DEMO_BOQ_CONTRACT || `CRT-BOQ-${stamp}`;

const OH = 10;
const PROFIT = 12;

function unitRate(materials, labour, equipment) {
  const direct = materials + labour + equipment;
  return Number((direct * (1 + OH / 100) * (1 + PROFIT / 100)).toFixed(2));
}

const BOQ_ITEMS = [
  {
    itemCode: 'DEMO-01',
    description: 'حفر أساسات — بند تجريبي',
    unit: 'م3',
    tenderQty: 100,
    rateMaterials: 50,
    rateLabour: 80,
    rateEquipment: 40,
    materialCodes: ['DEMO-MAT-SAND'],
  },
  {
    itemCode: 'DEMO-02',
    description: 'خرسانة مسلحة — بند تجريبي',
    unit: 'م3',
    tenderQty: 50,
    rateMaterials: 1200,
    rateLabour: 200,
    rateEquipment: 150,
    materialCodes: ['DEMO-MAT-SAND', 'DEMO-MAT-CEMENT'],
  },
  {
    itemCode: 'DEMO-03',
    description: 'تشطيبات داخلية — بند تجريبي',
    unit: 'م2',
    tenderQty: 200,
    rateMaterials: 300,
    rateLabour: 400,
    rateEquipment: 50,
    materialCodes: ['DEMO-MAT-PAINT'],
  },
];

const MATERIALS = {
  group: { code: 'DEMO-GRP', name: 'مجموعة تجريبية للعرض' },
  categories: [
    { code: 'DEMO-MAT-SAND', name: 'رمل تجريبي', unit: 'م3' },
    { code: 'DEMO-MAT-CEMENT', name: 'أسمنت تجريبي', unit: 'طن' },
    { code: 'DEMO-MAT-PAINT', name: 'دهان تجريبي', unit: 'لتر' },
  ],
};

function cookieHeaderFromStorage() {
  if (!fs.existsSync(authPath)) return '';
  const state = JSON.parse(fs.readFileSync(authPath, 'utf8'));
  return (state.cookies || []).map((c) => `${c.name}=${c.value}`).join('; ');
}

async function api(method, pathName, body, cookie) {
  const res = await fetch(`${apiBase}${pathName}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`${method} ${pathName} → ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

async function wait(page, ms = 800) {
  await page.waitForTimeout(ms);
}

async function shot(page, id) {
  fs.mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: path.join(outDir, `${id}.png`), fullPage: false });
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
  if (!ok) throw new Error('__webCostNavigate missing — restart Vite / hard refresh');
  await wait(page, 1600);
}

async function ensureLoggedIn(page, context) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await wait(page, 1000);
  const inApp = await page.locator('[data-shell-module]').first().isVisible().catch(() => false);
  const login = await page.locator('input[type="email"]').isVisible().catch(() => false);
  if (inApp && !login) return;
  if (!manualLogin) {
    throw new Error('Session expired. Re-run with: npm run docs:demo-boq -- --manual-login');
  }
  console.log('  · sign in in Chromium…');
  await page.waitForSelector('[data-shell-module]', { timeout: 5 * 60_000 });
  await wait(page, 1200);
  fs.mkdirSync(path.dirname(authPath), { recursive: true });
  await context.storageState({ path: authPath });
}

async function seed(cookie) {
  console.log(`[demo-boq] seeding on ${PROJECT_CODE} / ${CONTRACT_NUMBER}`);

  const projects = await api('GET', '/projects', undefined, cookie);
  const project = (projects || []).find((p) => p.projectCode === PROJECT_CODE && !p.isDeleted);
  if (!project) throw new Error(`Project ${PROJECT_CODE} not found — run docs:demo-project first`);

  // Materials tree
  let groups = await api('GET', '/materials/groups', undefined, cookie);
  let group = (groups || []).find((g) => g.code === MATERIALS.group.code);
  if (!group) {
    group = await api('POST', '/materials/groups', MATERIALS.group, cookie);
    console.log(`  · group created ${group.code}`);
  } else {
    console.log(`  · group exists ${group.code}`);
  }

  let categories = await api('GET', '/materials/categories', undefined, cookie);
  const categoryByCode = {};
  for (const cat of MATERIALS.categories) {
    let row = (categories || []).find((c) => c.code === cat.code);
    if (!row) {
      row = await api(
        'POST',
        '/materials/categories',
        { groupId: group.id, code: cat.code, name: cat.name, unit: cat.unit },
        cookie,
      );
      console.log(`  · material ${cat.code}`);
    }
    categoryByCode[cat.code] = row;
  }

  // Contract (reuse if same number already exists)
  const contracts = await api('GET', '/contracts', undefined, cookie);
  let contract = (contracts || []).find(
    (c) => c.projectId === project.id && c.contractNumber === CONTRACT_NUMBER && !c.isDeleted,
  );

  // Pre-compute BOQ totals for contract value / estimated cost story
  const priced = BOQ_ITEMS.map((item) => {
    const rate = unitRate(item.rateMaterials, item.rateLabour, item.rateEquipment);
    const tenderAmount = Number((rate * item.tenderQty).toFixed(2));
    const direct = item.rateMaterials + item.rateLabour + item.rateEquipment;
    const estimatedUnit = Number((direct * (1 + OH / 100)).toFixed(2)); // cost excl. profit
    const estimatedAmount = Number((estimatedUnit * item.tenderQty).toFixed(2));
    return { ...item, unitRateTotal: rate, tenderAmount, estimatedAmount, rateDirect: direct };
  });
  const contractValue = priced.reduce((s, i) => s + i.tenderAmount, 0);
  const estimatedCost = priced.reduce((s, i) => s + i.estimatedAmount, 0);

  if (!contract) {
    contract = await api(
      'POST',
      '/contracts',
      {
        id: randomUUID(),
        projectId: project.id,
        contractNumber: CONTRACT_NUMBER,
        contractName: 'عقد قائمة كميات تجريبية',
        contractNameEn: 'Demo BOQ Contract',
        contractValue,
        startDate: new Date().toISOString().slice(0, 10),
        isDeleted: false,
      },
      cookie,
    );
    console.log(`  · contract ${CONTRACT_NUMBER} value=${contractValue}`);
  } else {
    await api(
      'PUT',
      `/contracts/${contract.id}`,
      { contractValue, contractName: 'عقد قائمة كميات تجريبية', contractNameEn: 'Demo BOQ Contract' },
      cookie,
    );
    console.log(`  · contract updated ${CONTRACT_NUMBER}`);
  }

  // BOQ items
  const existingBoq = await api('GET', `/boq-items?contractId=${encodeURIComponent(contract.id)}`, undefined, cookie);
  const createdItems = [];
  for (const item of priced) {
    let row = (existingBoq || []).find((b) => b.itemCode === item.itemCode && !b.isDeleted);
    const payload = {
      projectId: project.id,
      contractId: contract.id,
      chapterCode: 'CH-DEMO',
      chapterName: 'فصل تجريبي',
      workTypeCode: 'WT-DEMO',
      sectionCode: 'SEC-DEMO',
      sectionName: 'قسم تجريبي',
      itemCode: item.itemCode,
      description: item.description,
      unit: item.unit,
      tenderQty: item.tenderQty,
      rateMaterials: item.rateMaterials,
      rateLabour: item.rateLabour,
      rateEquipment: item.rateEquipment,
      rateDirect: item.rateDirect,
      rateOverheadPct: OH,
      rateProfitPct: PROFIT,
      unitRateTotal: item.unitRateTotal,
      tenderAmount: item.tenderAmount,
      startDate: new Date().toISOString().slice(0, 10),
      expectedDuration: 14,
      isDeleted: false,
    };
    if (!row) {
      row = await api('POST', '/boq-items', { id: randomUUID(), ...payload }, cookie);
      console.log(`  · BOQ ${item.itemCode} amount=${item.tenderAmount}`);
    } else {
      row = await api('PUT', `/boq-items/${row.id}`, payload, cookie);
      console.log(`  · BOQ updated ${item.itemCode}`);
    }

    const materialIds = item.materialCodes.map((code) => Number(categoryByCode[code].id));
    await api('PUT', `/boq-materials/${row.id}`, { materialCategoryIds: materialIds }, cookie);
    console.log(`  · linked ${item.materialCodes.join(', ')} → ${item.itemCode}`);
    createdItems.push({
      id: row.id,
      itemCode: item.itemCode,
      tenderAmount: item.tenderAmount,
      estimatedAmount: item.estimatedAmount,
      materialCodes: item.materialCodes,
    });
  }

  // Bump project boqValue to include this contract's tender total (informational)
  const allContracts = await api('GET', '/contracts', undefined, cookie);
  const projectContracts = (allContracts || []).filter((c) => c.projectId === project.id && !c.isDeleted);
  // Keep previous demo contract; set project boqValue to sum of contract values if available
  const sumValues = projectContracts.reduce((s, c) => s + Number(c.contractValue || 0), 0);
  await api(
    'PUT',
    `/projects/${project.id}`,
    {
      boqValue: sumValues,
      budget: sumValues,
    },
    cookie,
  );

  const manifest = {
    createdAt: new Date().toISOString(),
    project: { id: project.id, projectCode: PROJECT_CODE },
    contract: {
      id: contract.id,
      contractNumber: CONTRACT_NUMBER,
      contractValue,
      estimatedCost,
      overheadPct: OH,
      profitPct: PROFIT,
    },
    materials: MATERIALS,
    boqItems: createdItems,
  };
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`[demo-boq] manifest → ${path.relative(root, manifestPath)}`);
  return manifest;
}

async function captureShots(page, manifest) {
  await page.keyboard.press('Escape').catch(() => {});
  await wait(page, 300);

  await navigate(page, 'technical', 'projects');
  await wait(page, 1200);
  await page.keyboard.press('Escape').catch(() => {});
  await wait(page, 400);
  await shot(page, '01-projects-with-new-contract');

  // Focus BOQ on the seeded contract (DEV hook + remount)
  await page.evaluate(
    ({ projectId, contractId }) => {
      window.__webCostSetBoqFocus?.({ projectId, contractId });
      window.__webCostNavigate?.('technical', 'boq');
    },
    { projectId: manifest.project.id, contractId: manifest.contract.id },
  );
  await wait(page, 2200);
  await page.keyboard.press('Escape').catch(() => {});
  await wait(page, 500);

  // Wait for at least one demo item code
  await page.getByText('DEMO-01', { exact: false }).first().waitFor({ timeout: 15_000 }).catch(() => {});
  await shot(page, '02-boq-three-items');

  // Open materials modal via Package button on DEMO-01 row
  const row = page.locator('tr').filter({ hasText: 'DEMO-01' }).first();
  if (await row.count()) {
    const pkg = row.locator('button[title*="مواد"], button[title*="aterial"], button').filter({ has: page.locator('svg') }).first();
    // Prefer the materials icon button (usually near link badge)
    const buttons = row.locator('button');
    const count = await buttons.count();
    let opened = false;
    for (let i = 0; i < count; i++) {
      const title = (await buttons.nth(i).getAttribute('title')) || '';
      if (/مواد|aterial|Material|Link/i.test(title)) {
        await buttons.nth(i).click();
        opened = true;
        break;
      }
    }
    if (!opened && count > 0) {
      // Heuristic: materials button is often early in the row actions
      await buttons.nth(Math.min(1, count - 1)).click().catch(() => {});
    }
    await wait(page, 1200);
    await shot(page, '03-boq-materials-modal');
    await page.keyboard.press('Escape').catch(() => {});
    const closeBtn = page.getByRole('button', { name: /إغلاق|Close|Cancel|إلغاء/i }).first();
    if (await closeBtn.isVisible().catch(() => false)) await closeBtn.click().catch(() => {});
  } else {
    await shot(page, '03-boq-materials-modal');
  }

  await navigate(page, 'inventory', 'materials');
  await wait(page, 1600);
  await page.keyboard.press('Escape').catch(() => {});
  // Try search box
  const search = page.locator('input[type="search"], input[placeholder*="بحث"], input[placeholder*="Search"], input').first();
  if (await search.count()) {
    await search.fill('DEMO').catch(() => {});
    await wait(page, 600);
  }
  await shot(page, '04-materials-tree-demo');

  await navigate(page, 'inventory', 'balance');
  await wait(page, 1200);
  await page.keyboard.press('Escape').catch(() => {});
  await shot(page, '05-inventory-ready-for-links');
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  let cookie = cookieHeaderFromStorage();
  let manifest = null;

  if (!shotsOnly) {
    if (!cookie) {
      console.warn('  · no saved cookie — will login in browser then seed');
    } else {
      try {
        manifest = await seed(cookie);
      } catch (err) {
        if (err.status === 401 || /401/.test(String(err.message))) {
          console.warn('  · API 401 — need fresh login');
          cookie = '';
        } else {
          throw err;
        }
      }
    }
  }

  if (seedOnly && manifest) {
    console.log('[demo-boq] seed-only done');
    return;
  }

  const browser = await chromium.launch({ headless: !headed, args: ['--disable-dev-shm-usage'] });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'ar-EG',
    storageState: fs.existsSync(authPath) && !manualLogin ? authPath : undefined,
  });
  const page = await context.newPage();

  try {
    await ensureLoggedIn(page, context);
    // Refresh cookie after possible manual login
    cookie = cookieHeaderFromStorage();
    if (!manifest && !shotsOnly) {
      manifest = await seed(cookie);
    }
    if (!manifest && fs.existsSync(manifestPath)) {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    }
    if (!manifest) throw new Error('No manifest — seed failed');

    await captureShots(page, manifest);
    console.log('\n[demo-boq] open docs/operations-guide/boq-materials-demo/DEMO.md or slides.html');
  } catch (err) {
    console.error(err);
    await page.screenshot({ path: path.join(outDir, '_debug-failure.png'), fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

await main();
