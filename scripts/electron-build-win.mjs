#!/usr/bin/env node
/**
 * Shared Windows electron-builder prep: stop running shell, clear win-unpacked, fallback output dir.
 */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

export function stopPackagingBlockers() {
  if (process.platform !== 'win32') return;
  const names = ['Web Cost App.exe', 'electron.exe'];
  for (const name of names) {
    spawnSync('taskkill', ['/F', '/IM', name, '/T'], { stdio: 'ignore', shell: true });
  }
}

function tryRemoveDir(dir) {
  if (!fs.existsSync(dir)) return true;
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
    return true;
  } catch {
    return false;
  }
}

/** @returns {'release' | 'release-build'} */
export function resolvePackagingOutputDir(root) {
  stopPackagingBlockers();
  const primary = path.join(root, 'release');
  const fallback = path.join(root, 'release-build');
  const winUnpacked = path.join(primary, 'win-unpacked');

  if (tryRemoveDir(winUnpacked)) {
    return 'release';
  }

  console.warn('[electron] release\\win-unpacked is locked — output → release-build\\');
  tryRemoveDir(fallback);
  return 'release-build';
}

export function runElectronBuilder(root, { publish = false, outputDir = 'release' } = {}) {
  process.env.CSC_IDENTITY_AUTO_DISCOVERY =
    process.env.WIN_CSC_LINK || process.env.CSC_LINK ? 'true' : 'false';

  const args = ['electron-builder', '--win', 'nsis'];
  if (publish) args.push('--publish', 'always');
  if (outputDir && outputDir !== 'release') {
    args.push(`-c.directories.output=${outputDir}`);
  }

  const r = spawnSync('npx', args, {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  return r.status ?? 1;
}
