#!/usr/bin/env node
/** Sync shared COA seed into server tree for production tsc + runtime. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src/data/chartOfAccountsSeedData.ts');
const destDir = path.join(root, 'server/src/data');
const dest = path.join(destDir, 'chartOfAccountsSeedData.ts');

if (!fs.existsSync(src)) {
  console.error('[copy-coa-seed] missing source:', src);
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log('[copy-coa-seed] synced → server/src/data/chartOfAccountsSeedData.ts');
