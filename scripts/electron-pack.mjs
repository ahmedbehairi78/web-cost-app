#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePackagingOutputDir, runElectronBuilder } from './electron-build-win.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const PRODUCTION_URL = 'https://web-cost-app-production.up.railway.app';
if (!process.env.WEB_COST_APP_URL?.trim()) {
  process.env.WEB_COST_APP_URL = PRODUCTION_URL;
  console.log(`[electron:pack] WEB_COST_APP_URL defaulted to ${PRODUCTION_URL}`);
}

run('npm', ['run', 'electron:build:shell']);
run('node', ['scripts/write-electron-url.mjs']);

const outputDir = resolvePackagingOutputDir(root);
process.exit(runElectronBuilder(root, { outputDir }));
