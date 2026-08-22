/**
 * Local API module smoke (read paths only).
 *
 *   $env:CERTIFY_EMAIL="you@example.com"
 *   $env:CERTIFY_PASSWORD="..."
 *   node scripts/certify-local-api.mjs
 *
 * Pass = 2xx. Fail = 5xx or network. 4xx is listed as WARN (permission/filter).
 */
const BASE = process.env.CERTIFY_API_BASE || 'http://127.0.0.1:3001';
const email = (process.env.CERTIFY_EMAIL || '').trim();
const password = process.env.CERTIFY_PASSWORD || '';

if (!email || !password) {
  console.error('Set CERTIFY_EMAIL and CERTIFY_PASSWORD.');
  process.exit(2);
}

const paths = [
  ['GET', '/api/health'],
  ['GET', '/api/auth/me'],
  ['GET', '/api/projects'],
  ['GET', '/api/contracts'],
  ['GET', '/api/boq-items'],
  ['GET', '/api/chart-of-accounts'],
  ['GET', '/api/suppliers'],
  ['GET', '/api/purchase-transactions'],
  ['GET', '/api/custody-settlements'],
  ['GET', '/api/billing'],
  ['GET', '/api/gl/business-today'],
  ['GET', '/api/gl/transactions?limit=20'],
  ['GET', '/api/reports/boq-cost-breakdown?level=project'],
  ['GET', '/api/materials/groups'],
  ['GET', '/api/consumption-orders'],
  ['GET', '/api/return-orders'],
  ['GET', '/api/warehouse-receipts'],
  ['GET', '/api/inventory'],
  ['GET', '/api/project-inventory-transfers'],
  ['GET', '/api/cost-centers'],
  ['GET', '/api/overhead-allocation/periods'],
  ['GET', '/api/accounting-periods'],
  ['GET', '/api/fiscal-closings'],
  ['GET', '/api/notifications/feed'],
  ['GET', '/api/fixed-assets'],
  ['GET', '/api/payroll/employees'],
  ['GET', '/api/purchase-requests'],
  ['GET', '/api/cash-budget'],
  ['GET', '/api/cash-budget/custody-floors'],
  ['GET', '/api/bank-accounts'],
  ['GET', '/api/bank-movements'],
  ['GET', '/api/bank-cheques'],
  ['GET', '/api/bank-statements'],
  ['GET', '/api/settings/company_info'],
  ['GET', '/api/mos-extracts'],
  ['GET', '/api/variation-orders'],
];

function cookieHeader(setCookie) {
  return setCookie.map((c) => c.split(';')[0]).join('; ');
}

const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const loginBody = await loginRes.text();
if (!loginRes.ok) {
  console.error(`LOGIN ${loginRes.status} ${loginBody.slice(0, 400)}`);
  process.exit(1);
}
const cookie = cookieHeader(loginRes.headers.getSetCookie?.() ?? []);
if (!cookie) {
  console.error('LOGIN ok but no Set-Cookie');
  process.exit(1);
}
console.log(`LOGIN 200 ${email}`);

let fail = 0;
let warn = 0;
for (const [method, path] of paths) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Cookie: cookie },
  });
  const snippet = (await res.text()).replace(/\s+/g, ' ').slice(0, 160);
  const line = `${res.status} ${method} ${path}  ${snippet}`;
  if (res.status >= 500) {
    console.log(`FAIL  ${line}`);
    fail += 1;
  } else if (res.status >= 400) {
    console.log(`WARN  ${line}`);
    warn += 1;
  } else {
    console.log(`OK    ${line}`);
  }
}

console.log(`\nDone. fail=${fail} warn=${warn}`);
process.exit(fail > 0 ? 1 : 0);
