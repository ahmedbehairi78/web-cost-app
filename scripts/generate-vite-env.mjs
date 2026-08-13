#!/usr/bin/env node
/**
 * Writes .env.production for `vite build` from process.env (Railway / CI injects VITE_*).
 * Locally: reads web-cost-app/.env when present (dotenv).
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.env.production');

/** Public Firebase web keys (client-side); fallback when Railway env is unset. */
function loadPublicFirebaseDefaults() {
  const candidates = [
    path.join(root, 'config', 'firebase-applet.defaults.json'),
    path.join(root, 'config', 'firebase-web.public.json'),
    path.join(root, 'firebase-applet-config.json'),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const map =
        raw.apiKey != null
          ? {
              VITE_FIREBASE_API_KEY: raw.apiKey,
              VITE_FIREBASE_AUTH_DOMAIN: raw.authDomain,
              VITE_FIREBASE_PROJECT_ID: raw.projectId,
              VITE_FIREBASE_APP_ID: raw.appId,
              VITE_FIREBASE_STORAGE_BUCKET: raw.storageBucket,
              VITE_FIREBASE_MESSAGING_SENDER_ID: raw.messagingSenderId,
              VITE_FIREBASE_DATABASE_ID: raw.firestoreDatabaseId,
            }
          : raw;
      const outMap = {};
      for (const [k, v] of Object.entries(map)) {
        if (v != null && String(v).trim() !== '') outMap[k] = String(v).trim();
      }
      return outMap;
    } catch {
      /* try next */
    }
  }
  return {};
}

const publicDefaults = loadPublicFirebaseDefaults();

const KEYS = [
  'VITE_DATA_BACKEND',
  'VITE_API_BASE_URL',
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_DATABASE_ID',
] ;

const defaults = {
  VITE_DATA_BACKEND: 'local',
  VITE_API_BASE_URL: '/api',
};

const lines = [];
const missing = [];

for (const key of KEYS) {
  let value = (process.env[key] ?? defaults[key] ?? publicDefaults[key] ?? '').trim();
  if (key === 'VITE_DATA_BACKEND' && !value) value = defaults.VITE_DATA_BACKEND;
  if (!value && key.startsWith('VITE_FIREBASE_') && key !== 'VITE_FIREBASE_DATABASE_ID') {
    missing.push(key);
  }
  lines.push(`${key}=${value}`);
}

if (missing.length > 0) {
  console.error('[generate-vite-env] Missing required build variables:');
  for (const key of missing) console.error(`  - ${key}`);
  console.error('Set them in Railway service variables (available at Docker build time).');
  process.exit(1);
}

const spaBuildId = (
  process.env.VITE_SPA_BUILD_ID
  || process.env.RAILWAY_GIT_COMMIT_SHA
  || `build-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`
).trim();
lines.push(`VITE_SPA_BUILD_ID=${spaBuildId}`);

fs.writeFileSync(out, `${lines.join('\n')}\n`, 'utf8');
console.log(`[generate-vite-env] wrote ${out} (${lines.length} keys, spa ${spaBuildId})`);
