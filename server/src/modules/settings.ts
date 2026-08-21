import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { isAppTheme } from '../constants/appThemes.js';
import { prisma } from '../db.js';
import { buildPostgresBackup } from '../migration/buildPostgresBackup.js';
import { importPostgresBackup } from '../migration/importPostgresBackup.js';
import type { FirestoreBackupFile } from '../migration/parseFirestoreBackup.js';
import {
  isPushToProductionEnabled,
  previewPushToProduction,
  pushLocalToProduction,
} from '../migration/pushToProduction.js';
import {
  previewBoqRateBackfill,
  runBoqRateBackfill,
  isFirestoreServiceAccountConfigured,
} from '../migration/backfillBoqRates.js';
import { requireAuth, requirePermission, requireReferenceRead, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { serialize } from '../prisma/serialize.js';
import { findUserById, updateUserContact } from '../auth/users.js';
import { normalizePhoneE164, isValidPhoneE164 } from '../lib/phoneE164.js';
import {
  getWhatsAppNotificationsConfig,
  setWhatsAppNotificationsEnabled,
} from '../lib/whatsappSettings.js';

export const settingsRouter = Router();

const COMPANY_INFO_KEY = 'company_info';

/** UI-only nav whitelist — keep in sync with src/lib/shellModuleVisibility.ts */
const VISIBLE_SHELL_MODULE_IDS = new Set([
  'dashboard',
  'ledger',
  'technical',
  'costs',
  'inventory',
  'assets',
  'payroll',
  'banks',
  'reports',
  'settings',
  'purchase_requests',
]);

function userPrefsKey(userId: string): string {
  return `user_prefs:${userId}`;
}

function normalizeVisibleShellModules(raw: unknown): string[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) {
    throw new Error('Invalid visibleShellModules');
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string' || !VISIBLE_SHELL_MODULE_IDS.has(item) || seen.has(item)) {
      continue;
    }
    seen.add(item);
    out.push(item);
  }
  return out;
}

function prefsResponse(prefs: Record<string, unknown>) {
  const visible =
    prefs.visibleShellModules === undefined
      ? null
      : prefs.visibleShellModules === null
        ? null
        : Array.isArray(prefs.visibleShellModules)
          ? (prefs.visibleShellModules as string[])
          : null;
  return {
    defaultTheme: prefs.defaultTheme ?? null,
    defaultModule: prefs.defaultModule ?? null,
    defaultLanguage: prefs.defaultLanguage ?? null,
    visibleShellModules: visible,
  };
}

async function readUserPrefsRecord(userId: string): Promise<Record<string, unknown>> {
  const raw = await readSetting(userPrefsKey(userId));
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  return {};
}

async function readSetting(key: string): Promise<unknown | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

async function writeSetting(key: string, value: unknown): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: {
      id: randomUUID(),
      key,
      value: value as Prisma.InputJsonValue,
    },
    update: {
      value: value as Prisma.InputJsonValue,
    },
  });
}

settingsRouter.get(
  '/company_info',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const value = await readSetting(COMPANY_INFO_KEY);
    res.json(serialize({ value: value ?? null }));
  }),
);

settingsRouter.put(
  '/company_info',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({ error: 'Invalid company_info payload' });
      return;
    }
    await writeSetting(COMPANY_INFO_KEY, body);
    res.json(serialize({ ok: true }));
  }),
);

/**
 * Per-report print designs (format toolbar).
 * Merge into existing map so saving one report cannot wipe the others.
 * Admin (`settings`) or Reports users may persist — GET company_info is any auth.
 */
settingsRouter.patch(
  '/company_info/report-print-profiles',
  requireAuth,
  requireReferenceRead('reports', 'settings'),
  asyncHandler(async (req, res) => {
    const body = req.body as { reportPrintProfiles?: unknown };
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({ error: 'Invalid payload' });
      return;
    }
    if (body.reportPrintProfiles == null || typeof body.reportPrintProfiles !== 'object' || Array.isArray(body.reportPrintProfiles)) {
      res.status(400).json({ error: 'reportPrintProfiles required' });
      return;
    }
    const existing = (await readSetting(COMPANY_INFO_KEY)) as Record<string, unknown> | null;
    const existingObj =
      existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
    const prevProfiles =
      existingObj.reportPrintProfiles &&
      typeof existingObj.reportPrintProfiles === 'object' &&
      !Array.isArray(existingObj.reportPrintProfiles)
        ? (existingObj.reportPrintProfiles as Record<string, unknown>)
        : {};
    const next = {
      ...existingObj,
      reportPrintProfiles: {
        ...prevProfiles,
        ...(body.reportPrintProfiles as Record<string, unknown>),
      },
    };
    await writeSetting(COMPANY_INFO_KEY, next);
    res.json(serialize({ ok: true }));
  }),
);

settingsRouter.get(
  '/user-preferences',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const prefs = await readUserPrefsRecord(userId);
    res.json(serialize(prefsResponse(prefs)));
  }),
);

settingsRouter.patch(
  '/user-preferences',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { defaultTheme, defaultModule, defaultLanguage } = req.body as {
      defaultTheme?: unknown;
      defaultModule?: unknown;
      defaultLanguage?: unknown;
    };
    const existing = await readUserPrefsRecord(userId);

    if (defaultTheme !== undefined) {
      if (
        defaultTheme !== null &&
        (typeof defaultTheme !== 'string' || !isAppTheme(defaultTheme))
      ) {
        res.status(400).json({ error: 'Invalid defaultTheme' });
        return;
      }
      existing.defaultTheme = defaultTheme;
    }
    if (defaultModule !== undefined) {
      if (defaultModule !== null && typeof defaultModule !== 'string') {
        res.status(400).json({ error: 'Invalid defaultModule' });
        return;
      }
      existing.defaultModule = defaultModule;
    }
    if (defaultLanguage !== undefined) {
      if (defaultLanguage !== null && defaultLanguage !== 'ar' && defaultLanguage !== 'en') {
        res.status(400).json({ error: 'Invalid defaultLanguage' });
        return;
      }
      existing.defaultLanguage = defaultLanguage;
    }
    // visibleShellModules: admin-only via /user-preferences/:userId — ignored on self PATCH

    await writeSetting(userPrefsKey(userId), existing);
    res.json(serialize(prefsResponse(existing)));
  }),
);

settingsRouter.get(
  '/user-preferences/:userId',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const targetId = String(req.params.userId ?? '').trim();
    if (!targetId) {
      res.status(400).json({ error: 'userId required' });
      return;
    }
    const target = await findUserById(targetId);
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const prefs = await readUserPrefsRecord(targetId);
    res.json(serialize(prefsResponse(prefs)));
  }),
);

settingsRouter.patch(
  '/user-preferences/:userId',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const targetId = String(req.params.userId ?? '').trim();
    if (!targetId) {
      res.status(400).json({ error: 'userId required' });
      return;
    }
    const target = await findUserById(targetId);
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const { defaultTheme, defaultModule, defaultLanguage, visibleShellModules } = req.body as {
      defaultTheme?: unknown;
      defaultModule?: unknown;
      defaultLanguage?: unknown;
      visibleShellModules?: unknown;
    };
    const existing = await readUserPrefsRecord(targetId);

    if (defaultTheme !== undefined) {
      if (
        defaultTheme !== null &&
        (typeof defaultTheme !== 'string' || !isAppTheme(defaultTheme))
      ) {
        res.status(400).json({ error: 'Invalid defaultTheme' });
        return;
      }
      existing.defaultTheme = defaultTheme;
    }
    if (defaultModule !== undefined) {
      if (defaultModule !== null && typeof defaultModule !== 'string') {
        res.status(400).json({ error: 'Invalid defaultModule' });
        return;
      }
      existing.defaultModule = defaultModule;
    }
    if (defaultLanguage !== undefined) {
      if (defaultLanguage !== null && defaultLanguage !== 'ar' && defaultLanguage !== 'en') {
        res.status(400).json({ error: 'Invalid defaultLanguage' });
        return;
      }
      existing.defaultLanguage = defaultLanguage;
    }
    if (visibleShellModules !== undefined) {
      try {
        existing.visibleShellModules = normalizeVisibleShellModules(visibleShellModules);
      } catch {
        res.status(400).json({ error: 'Invalid visibleShellModules' });
        return;
      }
    }

    await writeSetting(userPrefsKey(targetId), existing);
    res.json(serialize(prefsResponse(existing)));
  }),
);

settingsRouter.get(
  '/backup-export',
  requireAuth,
  requirePermission('settings'),
  asyncHandler(async (_req, res) => {
    const payload = await buildPostgresBackup();
    res.json(serialize(payload));
  }),
);

settingsRouter.post(
  '/backup-import',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      exportedAt?: string;
      version?: number;
      collections?: Record<string, unknown[]>;
      mode?: 'merge' | 'replace';
    };
    if (!body.collections || typeof body.collections !== 'object') {
      res.status(400).json({ error: 'Invalid backup file: missing collections' });
      return;
    }
    const mode = body.mode === 'replace' ? 'replace' : 'merge';
    const report = await importPostgresBackup(
      {
        exportedAt: body.exportedAt,
        version: body.version,
        collections: body.collections as FirestoreBackupFile['collections'],
      },
      { mode },
    );
    let requiresReLogin = false;
    if (mode === 'replace') {
      requiresReLogin = true;
      await new Promise<void>((resolve) => {
        req.session.destroy(() => resolve());
      });
    }
    res.json(serialize({ ok: true, requiresReLogin, ...report }));
  }),
);

settingsRouter.get(
  '/push-to-production/preview',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const yearRaw = req.query.year;
    const year =
      yearRaw !== undefined && yearRaw !== '' ? Number(yearRaw) : new Date().getFullYear();
    const preview = await previewPushToProduction(Number.isFinite(year) ? year : new Date().getFullYear());
    res.json(serialize(preview));
  }),
);

settingsRouter.post(
  '/push-to-production',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    if (!isPushToProductionEnabled()) {
      res.status(503).json({
        error: 'Push to production is not configured. Set PRODUCTION_DATABASE_URL in local .env.',
      });
      return;
    }
    const result = await pushLocalToProduction();
    res.json(
      serialize({
        ok: true,
        preview: result.preview,
        counts: result.report.counts,
        skipped: result.report.skipped,
        gl: result.report.gl,
      }),
    );
  }),
);

settingsRouter.get(
  '/backfill-boq-rates/preview',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    const preview = await previewBoqRateBackfill();
    res.json(serialize(preview));
  }),
);

settingsRouter.post(
  '/backfill-boq-rates',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    if (!isFirestoreServiceAccountConfigured()) {
      res.status(503).json({
        error: 'firebase_service_account_not_configured',
        message:
          'Set FIREBASE_SERVICE_ACCOUNT_JSON on the API server (Railway variables) to read boq_items from Firestore.',
      });
      return;
    }
    const report = await runBoqRateBackfill({ live: true });
    res.json(serialize(report));
  }),
);

settingsRouter.get(
  '/whatsapp-notifications',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    const cfg = await getWhatsAppNotificationsConfig();
    res.json(serialize(cfg));
  }),
);

settingsRouter.patch(
  '/whatsapp-notifications',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { enabled } = req.body as { enabled?: unknown };
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean' });
      return;
    }
    await setWhatsAppNotificationsEnabled(enabled);
    res.json(serialize({ enabled }));
  }),
);

settingsRouter.patch(
  '/users/:id/contact',
  requireAuth,
  asyncHandler(async (req, res) => {
    const targetId = String(req.params.id ?? '').trim();
    const actor = req.user!;
    if (!targetId) {
      res.status(400).json({ error: 'User id is required' });
      return;
    }
    if (actor.id !== targetId && actor.role !== 'admin') {
      res.status(403).json({ error: 'admin_required' });
      return;
    }

    const body = req.body as {
      phoneE164?: unknown;
      whatsappOptIn?: unknown;
      preferredLanguage?: unknown;
    };

    const patch: {
      phoneE164?: string | null;
      whatsappOptIn?: boolean;
      preferredLanguage?: string;
    } = {};

    if (body.phoneE164 !== undefined) {
      if (body.phoneE164 === null || body.phoneE164 === '') {
        patch.phoneE164 = null;
      } else if (typeof body.phoneE164 === 'string') {
        const normalized = normalizePhoneE164(body.phoneE164);
        if (!normalized || !isValidPhoneE164(normalized)) {
          res.status(400).json({ error: 'invalid_phone', message: 'Use international format e.g. +2010…' });
          return;
        }
        patch.phoneE164 = normalized;
      } else {
        res.status(400).json({ error: 'invalid_phone' });
        return;
      }
    }

    if (body.whatsappOptIn !== undefined) {
      if (typeof body.whatsappOptIn !== 'boolean') {
        res.status(400).json({ error: 'whatsappOptIn must be boolean' });
        return;
      }
      patch.whatsappOptIn = body.whatsappOptIn;
    }

    if (body.preferredLanguage !== undefined) {
      const lang = String(body.preferredLanguage);
      if (lang !== 'ar' && lang !== 'en') {
        res.status(400).json({ error: 'preferredLanguage must be ar or en' });
        return;
      }
      patch.preferredLanguage = lang;
    }

    const existing = await findUserById(targetId);
    if (!existing) {
      res.status(404).json({ error: 'user_not_found' });
      return;
    }

    const nextOptIn = patch.whatsappOptIn ?? existing.whatsappOptIn;
    const nextPhone = patch.phoneE164 !== undefined ? patch.phoneE164 : existing.phoneE164;
    if (nextOptIn && !nextPhone) {
      res.status(400).json({
        error: 'phone_required_for_whatsapp',
        message: 'WhatsApp number is required when notifications are enabled',
      });
      return;
    }

    const updated = await updateUserContact(targetId, patch);
    if (!updated) {
      res.status(500).json({ error: 'update_failed' });
      return;
    }

    const { passwordHash: _ph, ...safe } = updated;
    res.json(serialize(safe));
  }),
);
