import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { prisma } from '../db.js';
import { serialize } from '../prisma/serialize.js';
import { buildNotificationFeed } from '../lib/notificationFeed.js';
import {
  executeNotificationAction,
  loadNotificationItemDetail,
  verifyApprovalLink,
} from '../lib/notificationActions.js';
import { sendWhatsAppTemplate } from '../integrations/whatsappClient.js';
import { normalizePhoneE164, isValidPhoneE164 } from '../lib/phoneE164.js';
import type { UserRole } from '../permissions.js';

export const notificationsRouter = Router();

notificationsRouter.get(
  '/link/verify',
  asyncHandler(async (req, res) => {
    const t = String(req.query.t ?? '').trim();
    if (!t) {
      res.status(400).json({ error: 'token required' });
      return;
    }
    const result = await verifyApprovalLink(t);
    res.json(serialize(result));
  }),
);

notificationsRouter.use(requireAuth);

notificationsRouter.get(
  '/feed',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const items = await buildNotificationFeed({
      id: user.id,
      role: user.role as UserRole,
      permissions: user.permissions,
      assignedContractIds: user.assignedContractIds ?? [],
    });
    const unreadCount = items.filter((i) => !i.read).length;
    res.json(serialize({ items, unreadCount }));
  }),
);

notificationsRouter.get(
  '/item',
  asyncHandler(async (req, res) => {
    const key = String(req.query.key ?? '').trim();
    if (!key) {
      res.status(400).json({ error: 'key required' });
      return;
    }
    try {
      const item = await loadNotificationItemDetail(req.user, key);
      if (!item) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.json(serialize(item));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'notification_not_visible') {
        res.status(403).json({ error: msg });
        return;
      }
      throw err;
    }
  }),
);

notificationsRouter.post(
  '/actions',
  asyncHandler(async (req, res) => {
    const { key, action } = req.body as { key?: string; action?: string };
    const cleanKey = typeof key === 'string' ? key.trim() : '';
    if (!cleanKey || (action !== 'approve' && action !== 'reject')) {
      res.status(400).json({ error: 'key and action (approve|reject) required' });
      return;
    }
    try {
      const result = await executeNotificationAction(req.user, cleanKey, action);
      res.json(serialize(result));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'notification_not_visible' || msg === 'access_denied') {
        res.status(403).json({ error: msg });
        return;
      }
      if (msg === 'action_not_allowed' || msg === 'invalid_status') {
        res.status(400).json({ error: msg });
        return;
      }
      throw err;
    }
  }),
);

notificationsRouter.post(
  '/mark-read',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const keys = Array.isArray((req.body as { keys?: unknown }).keys)
      ? (req.body as { keys: unknown[] }).keys.filter((k): k is string => typeof k === 'string' && k.length > 0)
      : [];
    if (keys.length === 0) {
      res.status(400).json({ error: 'keys required' });
      return;
    }
    await Promise.all(
      keys.map((notificationKey) =>
        prisma.userNotificationRead.upsert({
          where: { userId_notificationKey: { userId, notificationKey } },
          create: { id: randomUUID(), userId, notificationKey },
          update: { readAt: new Date(), dismissedAt: null },
        }),
      ),
    );
    res.status(204).end();
  }),
);

notificationsRouter.post(
  '/dismiss',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const keys = Array.isArray((req.body as { keys?: unknown }).keys)
      ? (req.body as { keys: unknown[] }).keys.filter((k): k is string => typeof k === 'string' && k.length > 0)
      : [];
    if (keys.length === 0) {
      res.status(400).json({ error: 'keys required' });
      return;
    }
    await Promise.all(
      keys.map((notificationKey) =>
        prisma.userNotificationRead.upsert({
          where: { userId_notificationKey: { userId, notificationKey } },
          create: {
            id: randomUUID(),
            userId,
            notificationKey,
            dismissedAt: new Date(),
          },
          update: { dismissedAt: new Date(), readAt: new Date() },
        }),
      ),
    );
    res.status(204).end();
  }),
);

notificationsRouter.get(
  '/outbox-stats',
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    const rows = await prisma.notificationOutbox.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const stats = Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
    res.json(serialize({ stats }));
  }),
);

notificationsRouter.post(
  '/test-whatsapp',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const raw = String((req.body as { phoneE164?: string }).phoneE164 ?? '').trim();
    const phone = normalizePhoneE164(raw);
    if (!phone || !isValidPhoneE164(phone)) {
      res.status(400).json({ error: 'invalid_phone' });
      return;
    }
    const result = await sendWhatsAppTemplate({
      toE164: phone,
      templateName: 'approval_required',
      languageCode: 'ar',
      bodyParams: ['اختبار Concord Plus', 'PTRF-TEST-001', 'عادية'],
      urlButtonPath: 'm/approve',
    });
    res.json(serialize(result));
  }),
);
