import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { resolveFirebaseProjectId } from './firebaseProject.js';
import { assertProductionCorsOrigin } from './lib/corsOrigin.js';

const isProduction = (process.env.NODE_ENV || 'development') === 'production';

/** Dev: .env overrides stale shell DATABASE_URL (default dotenv does not). */
dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env'),
  override: !isProduction,
});

function normalizeDatabaseUrl(raw: string | undefined): string {
  const fallback = 'postgresql://postgres:postgres@localhost:5432/web_cost_app';
  if (!raw?.trim()) return fallback;
  let url = raw.trim().replace(/^['"]|['"]$/g, '');
  if (/\$\{\{/.test(url)) {
    console.warn('[env] DATABASE_URL looks like an unresolved Railway reference — using local fallback.');
    return fallback;
  }
  if (!/^postgres(ql)?:\/\//i.test(url)) {
    console.warn('[env] DATABASE_URL is not a postgres URL — using local fallback.');
    return fallback;
  }
  return url;
}

const resolvedFirebaseProjectId = resolveFirebaseProjectId() || '';

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.LOCAL_API_PORT || process.env.PORT || 3001),
  databaseUrl: normalizeDatabaseUrl(process.env.DATABASE_URL),
  sqliteCoreEnabled: (process.env.SQLITE_CORE_ENABLED || (isProduction ? 'false' : 'true')).toLowerCase() === 'true',
  sqliteCoreDbPath: process.env.SQLITE_CORE_DB_PATH || 'server/data/financial-core.sqlite',
  sessionSecret: process.env.SESSION_SECRET || 'change-me-before-production',
  corsOrigin:
    process.env.CORS_ORIGIN?.trim() ||
    (process.env.RAILWAY_PUBLIC_DOMAIN?.trim()
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN.trim()}`
      : ''),
  /** Cross-site only: set `none` when UI and API are on different origins. Same-origin Railway uses `lax`. */
  sessionCookieSameSite: (process.env.SESSION_COOKIE_SAME_SITE || 'lax').toLowerCase() as
    | 'lax'
    | 'strict'
    | 'none',
  firebaseProjectId: resolvedFirebaseProjectId,
  /** Comma-separated Google emails auto-promoted to admin on firebase-session (Railway first deploy). */
  bootstrapAdminEmails: (process.env.BOOTSTRAP_ADMIN_EMAIL || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  /** Local dev only: Railway Postgres URL for admin push-to-production (never set on Railway itself). */
  productionDatabaseUrl: (
    process.env.PRODUCTION_DATABASE_URL ||
    process.env.DATABASE_PUBLIC_URL ||
    ''
  ).trim(),
  /** Public app URL for WhatsApp deep links (Railway domain or localhost:3000). */
  appPublicBaseUrl: (
    process.env.APP_PUBLIC_BASE_URL?.trim() ||
    (process.env.RAILWAY_PUBLIC_DOMAIN?.trim()
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN.trim()}`
      : 'http://localhost:3000')
  ).replace(/\/$/, ''),
  whatsappEnabled: (process.env.WHATSAPP_ENABLED || 'true').toLowerCase() === 'true',
  whatsappDryRun: (process.env.WHATSAPP_DRY_RUN || 'true').toLowerCase() === 'true',
  whatsappAccessToken: (process.env.WHATSAPP_ACCESS_TOKEN || '').trim(),
  whatsappPhoneNumberId: (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim(),
  whatsappApiVersion: (process.env.WHATSAPP_API_VERSION || 'v21.0').trim(),
  /** Dev only: redirect all outbound WhatsApp to one number. Leave empty in production. */
  whatsappRedirectAllTo: (process.env.WHATSAPP_REDIRECT_ALL_TO || '').trim(),
  /** Approved Meta template name for monthly salary notifications. */
  whatsappSalaryTemplate: (process.env.WHATSAPP_SALARY_TEMPLATE || 'salary_notification').trim(),
  notificationLinkSecret: (
    process.env.NOTIFICATION_LINK_SECRET ||
    process.env.SESSION_SECRET ||
    'change-me-before-production'
  ).trim(),
  notificationLinkTtlHours: Number(process.env.NOTIFICATION_LINK_TTL_HOURS || 48),
  notificationWorkerEnabled: (process.env.NOTIFICATION_WORKER_ENABLED || 'true').toLowerCase() === 'true',
  notificationWorkerIntervalMs: Number(process.env.NOTIFICATION_WORKER_INTERVAL_MS || 60_000),
  notificationReminderHours: Number(process.env.NOTIFICATION_REMINDER_HOURS || 24),
  /** IANA TZ for journal posting “today” (default Egypt). */
  businessTimezone: (process.env.BUSINESS_TIMEZONE || 'Africa/Cairo').trim() || 'Africa/Cairo',
  /** Email kept (with ALL_PERMISSIONS) after Settings factory reset. */
  factoryKeepAdminEmail: (process.env.FACTORY_KEEP_ADMIN_EMAIL || 'myline78@gmail.com').trim().toLowerCase(),
};

export function assertProductionEnv() {
  if (!isProduction) return;

  if (env.sessionSecret === 'change-me-before-production') {
    throw new Error('SESSION_SECRET must be set in production.');
  }
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error('DATABASE_URL must be set in production.');
  }
  if (!env.firebaseProjectId) {
    throw new Error(
      'FIREBASE_PROJECT_ID must be set in production (or ship config/firebase-applet.defaults.json).',
    );
  }
  assertProductionCorsOrigin(env.corsOrigin);
}
