#!/usr/bin/env node
/**
 * Railway / production entrypoint: apply Prisma migrations, then start the API.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Trim quotes / newlines; reject unresolved Railway references and invalid schemes. */
function normalizeDatabaseUrl(raw) {
  if (!raw) return null;
  let url = String(raw).trim().replace(/^['"]|['"]$/g, '');
  if (/\$\{\{/.test(url)) {
    console.error(
      '[start] DATABASE_URL looks like an unresolved Railway reference:',
      url,
      '\n  Use Variables → Reference (purple link icon), do NOT paste ${{…}} as plain text.',
    );
    return null;
  }
  if (!/^postgres(ql)?:\/\//i.test(url)) {
    console.error(
      '[start] DATABASE_URL must start with postgresql:// or postgres://',
      `\n  Got prefix: ${JSON.stringify(url.slice(0, 40))}…`,
    );
    return null;
  }
  return url;
}

/** Railway Postgres may expose DATABASE_PRIVATE_URL; normalize to DATABASE_URL for Prisma. */
function resolveDatabaseUrl() {
  const direct = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (direct) {
    process.env.DATABASE_URL = direct;
    return direct;
  }

  const fallbacks = [
    ['DATABASE_PRIVATE_URL', process.env.DATABASE_PRIVATE_URL],
    ['POSTGRES_URL', process.env.POSTGRES_URL],
    ['POSTGRESQL_URL', process.env.POSTGRESQL_URL],
  ];
  for (const [name, value] of fallbacks) {
    const url = normalizeDatabaseUrl(value);
    if (url) {
      process.env.DATABASE_URL = url;
      console.log(`[start] Using ${name} as DATABASE_URL`);
      return url;
    }
  }
  return null;
}

const dbUrl = resolveDatabaseUrl();
if (!dbUrl) {
  const postgresKeys = Object.keys(process.env)
    .filter((k) => /DATABASE|POSTGRES|PG/i.test(k))
    .sort();
  console.error('[start] FATAL: DATABASE_URL is missing or invalid (Prisma P1013).');
  console.error(
    postgresKeys.length > 0
      ? `  Postgres-related env keys present (values hidden): ${postgresKeys.join(', ')}`
      : '  No Postgres-related env keys found — variable is missing on web-cost-app, not only on Postgres.',
  );
  console.error(`
Fix — valid value MUST look like:
  postgresql://postgres:PASSWORD@HOST.railway.app:5432/railway

  A) Reference (recommended): web-cost-app → Variables → DATABASE_URL → **Reference**
     → Postgres → DATABASE_URL (UI shows \${{Postgres.DATABASE_URL}} — added via Reference, not typed)

  B) Paste URL: Postgres → Variables → copy DATABASE_URL → paste into web-cost-app DATABASE_URL
     (full postgresql://… string only — no quotes, no \${{…}})

  Wrong: typing \${{Postgres.DATABASE_URL}} manually · https://… · localhost · empty · JSON
`);
  process.exit(1);
}

const isProduction = (process.env.NODE_ENV || '').toLowerCase() === 'production';
if (isProduction && !(process.env.SESSION_SECRET?.trim())) {
  console.error(
    '[start] FATAL: SESSION_SECRET is not set.\n' +
      '  web-cost-app → Variables → SESSION_SECRET → long random string → Redeploy',
  );
  process.exit(1);
}

console.log('[start] env:', {
  NODE_ENV: process.env.NODE_ENV || '(unset)',
  PORT: process.env.PORT || '(unset)',
  DATABASE_URL: '(set)',
  SESSION_SECRET: process.env.SESSION_SECRET ? '(set)' : '(missing)',
});

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    cwd: root,
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log('[start] Running prisma migrate deploy…');
const prismaBin = path.join(root, 'node_modules', 'prisma', 'build', 'index.js');
if (existsSync(prismaBin)) {
  run('node', [prismaBin, 'migrate', 'deploy']);
} else {
  run('npx', ['prisma', 'migrate', 'deploy']);
}

console.log('[start] Starting API server…');
run('node', ['dist-server/index.js']);
