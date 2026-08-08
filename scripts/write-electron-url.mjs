/**
 * Bakes WEB_COST_APP_URL into electron/dist for the packaged installer.
 * Usage: WEB_COST_APP_URL=https://your-app.up.railway.app node scripts/write-electron-url.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'electron/dist/production-url.json');
const url =
  process.env.WEB_COST_APP_URL?.trim() ||
  process.env.ELECTRON_START_URL?.trim() ||
  'http://localhost:3000';

const updateUrl = process.env.ELECTRON_UPDATE_URL?.trim() || '';

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify({ url }, null, 2)}\n`, 'utf8');
console.log(`[write-electron-url] ${url}`);

if (updateUrl) {
  const feedOut = path.join(root, 'electron/dist/update-feed.json');
  fs.writeFileSync(feedOut, `${JSON.stringify({ url: updateUrl }, null, 2)}\n`, 'utf8');
  console.log(`[write-electron-url] update feed ${updateUrl}`);
}
