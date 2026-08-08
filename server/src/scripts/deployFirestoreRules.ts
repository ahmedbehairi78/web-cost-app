/**
 * Deploy firestore.rules via Firebase Rules REST API (when CLI deploy no-ops).
 *   npx tsx server/src/scripts/deployFirestoreRules.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveFirebaseProjectId, resolveFirestoreDatabaseId } from '../firebaseProject.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const rulesPath = process.env.FIRESTORE_RULES_FILE
  ? path.resolve(process.env.FIRESTORE_RULES_FILE)
  : fs.existsSync(path.join(repoRoot, 'firestore.deployed.rules'))
    ? path.join(repoRoot, 'firestore.deployed.rules')
    : path.join(repoRoot, 'firestore.rules');

type FirebaseToolsConfig = {
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
  };
};

function configPath(): string {
  return path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.config/configstore/firebase-tools.json');
}

function loadAccessToken(): string {
  // Refresh expired CLI token the same way `firebase deploy` does.
  try {
    execSync('npx firebase-tools login:list', { stdio: 'ignore' });
  } catch {
    // ignore — fall through to read token
  }
  const cfg = JSON.parse(fs.readFileSync(configPath(), 'utf8')) as FirebaseToolsConfig;
  const token = cfg.tokens?.access_token?.trim();
  if (!token) throw new Error('No Firebase CLI access token. Run: firebase login');
  return token;
}

async function createRuleset(projectId: string, token: string, content: string): Promise<string> {
  const res = await fetch(`https://firebaserules.googleapis.com/v1/projects/${projectId}/rulesets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: {
        files: [{ name: 'firestore.rules', content }],
      },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Create ruleset failed (${res.status}): ${text}`);
  const json = JSON.parse(text) as { name: string };
  return json.name;
}

async function releaseRuleset(projectId: string, token: string, databaseId: string, rulesetName: string): Promise<void> {
  const releaseName =
    databaseId === '(default)'
      ? `projects/${projectId}/releases/cloud.firestore`
      : `projects/${projectId}/releases/cloud.firestore/${databaseId}`;
  const res = await fetch(`https://firebaserules.googleapis.com/v1/${releaseName}?updateMask=rulesetName`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ release: { name: releaseName, rulesetName } }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Release rules failed for ${databaseId} (${res.status}): ${text}`);
}

const projectId = resolveFirebaseProjectId();
if (!projectId) throw new Error('FIREBASE_PROJECT_ID not configured');

const token = await loadAccessToken();
const content = fs.readFileSync(rulesPath, 'utf8');
console.log(`Uploading ${rulesPath} (${content.length} bytes)...`);

const rulesetName = await createRuleset(projectId, token, content);
console.log('Created ruleset:', rulesetName);

await releaseRuleset(projectId, token, '(default)', rulesetName);
console.log('Released to (default)');

const namedDb = resolveFirestoreDatabaseId();
if (namedDb !== '(default)') {
  await releaseRuleset(projectId, token, namedDb, rulesetName);
  console.log(`Released to ${namedDb}`);
}

console.log('Done.');
