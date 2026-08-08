import fs from 'node:fs';
import path from 'node:path';

function readAppletJson(): { projectId?: string; firestoreDatabaseId?: string } | null {  // process.cwd() = /app in Docker; web-cost-app root when started via npm scripts.
  const repoRoot = process.cwd();
  const candidates = [
    path.join(repoRoot, 'firebase-applet-config.json'),
    path.join(repoRoot, 'config', 'firebase-applet.defaults.json'),
  ];
  for (const file of candidates) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as {
        projectId?: string;
        firestoreDatabaseId?: string;
      };
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Prefer env; fallback to committed applet defaults (Docker/Railway) or local override JSON. */
export function resolveFirestoreDatabaseId(): string {
  const fromEnv =
    process.env.FIREBASE_DATABASE_ID?.trim() ||
    process.env.VITE_FIREBASE_DATABASE_ID?.trim();
  if (fromEnv) return fromEnv;
  return readAppletJson()?.firestoreDatabaseId?.trim() || '(default)';
}

export function resolveFirebaseProjectId(): string | null {
  const fromEnv =
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    process.env.VITE_FIREBASE_PROJECT_ID?.trim();
  if (fromEnv) return fromEnv;
  return readAppletJson()?.projectId?.trim() || null;
}
