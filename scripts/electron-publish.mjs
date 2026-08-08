#!/usr/bin/env node
/**
 * Build Windows installer + publish to GitHub Releases (electron-updater feed).
 * Requires GH_TOKEN with repo scope (private repo) or public release.
 *
 *   $env:WEB_COST_APP_URL="https://web-cost-app-production.up.railway.app"
 *   $env:GH_TOKEN="ghp_..."
 *   npm run electron:publish
 *
 * Close "Web Cost App" before running if release\ is locked.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePackagingOutputDir, runElectronBuilder } from './electron-build-win.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args, extraEnv = {}) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...extraEnv },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!process.env.GH_TOKEN?.trim()) {
  console.error('[electron:publish] GH_TOKEN is required (GitHub → Settings → Developer settings → PAT, scope: repo).');
  process.exit(1);
}

const PRODUCTION_URL = 'https://web-cost-app-production.up.railway.app';
if (!process.env.WEB_COST_APP_URL?.trim()) {
  process.env.WEB_COST_APP_URL = PRODUCTION_URL;
  console.log(`[electron:publish] WEB_COST_APP_URL defaulted to ${PRODUCTION_URL}`);
}

run('npm', ['run', 'electron:build:shell']);
run('node', ['scripts/write-electron-url.mjs']);

const outputDir = resolvePackagingOutputDir(root);
process.exit(runElectronBuilder(root, { publish: true, outputDir }));
