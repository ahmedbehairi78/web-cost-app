import { prisma } from '../db.js';
import { env } from '../env.js';
import { sendWhatsAppTemplate } from '../integrations/whatsappClient.js';
import { isWhatsAppNotificationsActive } from '../lib/whatsappSettings.js';

const MAX_ATTEMPTS = 5;

type OutboxPayload = {
  bodyParams?: string[];
  urlButtonPath?: string;
  languageCode?: string;
};

async function isNotificationStillPending(notificationKey: string): Promise<boolean> {
  if (notificationKey.startsWith('transfer:')) {
    const id = Number(notificationKey.slice('transfer:'.length));
    const tr = await prisma.projectInventoryTransfer.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!tr) return false;
    return tr.status === 'pending_b' || tr.status === 'pending_projects';
  }
  if (notificationKey.startsWith('mos:')) {
    const id = notificationKey.slice('mos:'.length);
    const mos = await prisma.materialOnSiteExtract.findUnique({
      where: { id },
      select: { status: true },
    });
    return mos?.status === 'draft';
  }
  if (notificationKey.startsWith('subcontractor_ipc:')) {
    const id = notificationKey.slice('subcontractor_ipc:'.length);
    const row = await prisma.purchaseTransaction.findUnique({
      where: { id },
      select: { status: true, transactionId: true, type: true, isDeleted: true },
    });
    if (!row || row.isDeleted || row.type !== 'ipc') return false;
    return row.status === 'submitted' && !row.transactionId;
  }
  return true;
}

export async function processNotificationOutboxBatch(limit = 20): Promise<number> {
  if (!(await isWhatsAppNotificationsActive())) return 0;

  const now = new Date();
  const rows = await prisma.notificationOutbox.findMany({
    where: {
      status: 'pending',
      scheduledAt: { lte: now },
      attemptCount: { lt: MAX_ATTEMPTS },
    },
    orderBy: { scheduledAt: 'asc' },
    take: limit,
  });

  let processed = 0;
  for (const row of rows) {
    if (row.templateName === 'approval_reminder') {
      const stillPending = await isNotificationStillPending(row.notificationKey);
      if (!stillPending) {
        await prisma.notificationOutbox.update({
          where: { id: row.id },
          data: { status: 'cancelled' },
        });
        continue;
      }
    }

    const user = await prisma.user.findUnique({
      where: { id: row.userId },
      select: { phoneE164: true, whatsappOptIn: true },
    });
    if (!user?.whatsappOptIn || !user.phoneE164) {
      await prisma.notificationOutbox.update({
        where: { id: row.id },
        data: { status: 'skipped', lastError: 'no_phone_or_opt_out' },
      });
      continue;
    }

    const payload = row.payload as OutboxPayload;
    const result = await sendWhatsAppTemplate({
      toE164: user.phoneE164,
      templateName: row.templateName,
      languageCode: payload.languageCode === 'en' ? 'en' : 'ar',
      bodyParams: Array.isArray(payload.bodyParams) ? payload.bodyParams.map(String) : ['تنبيه', '—', 'عادية'],
      urlButtonPath: typeof payload.urlButtonPath === 'string' ? payload.urlButtonPath : undefined,
    });

    if (result.ok) {
      await prisma.notificationOutbox.update({
        where: { id: row.id },
        data: {
          status: 'sent',
          sentAt: new Date(),
          providerMsgId: result.messageId ?? null,
          attemptCount: { increment: 1 },
        },
      });
      processed += 1;
    } else {
      const nextAttempt = row.attemptCount + 1;
      await prisma.notificationOutbox.update({
        where: { id: row.id },
        data: {
          status: nextAttempt >= MAX_ATTEMPTS ? 'failed' : 'pending',
          lastError: result.error ?? 'send_failed',
          attemptCount: nextAttempt,
          scheduledAt: new Date(Date.now() + 5 * 60_000),
        },
      });
    }
  }

  return processed;
}

type EmployeeOutboxPayload = {
  bodyParams?: string[];
  languageCode?: string;
};

/** Drain the employee (raw-phone) WhatsApp outbox — e.g. monthly salary notifications. */
export async function processEmployeeNotificationOutboxBatch(limit = 20): Promise<number> {
  if (!(await isWhatsAppNotificationsActive())) return 0;

  const now = new Date();
  const rows = await prisma.employeeNotificationOutbox.findMany({
    where: {
      status: 'pending',
      scheduledAt: { lte: now },
      attemptCount: { lt: MAX_ATTEMPTS },
    },
    orderBy: { scheduledAt: 'asc' },
    take: limit,
  });

  let processed = 0;
  for (const row of rows) {
    if (!row.phoneE164) {
      await prisma.employeeNotificationOutbox.update({
        where: { id: row.id },
        data: { status: 'skipped', lastError: 'no_phone' },
      });
      continue;
    }

    const payload = row.payload as EmployeeOutboxPayload;
    const result = await sendWhatsAppTemplate({
      toE164: row.phoneE164,
      templateName: row.templateName,
      languageCode: payload.languageCode === 'en' ? 'en' : 'ar',
      bodyParams: Array.isArray(payload.bodyParams) ? payload.bodyParams.map(String) : [],
    });

    if (result.ok) {
      await prisma.employeeNotificationOutbox.update({
        where: { id: row.id },
        data: {
          status: 'sent',
          sentAt: new Date(),
          providerMsgId: result.messageId ?? null,
          attemptCount: { increment: 1 },
        },
      });
      processed += 1;
    } else {
      const nextAttempt = row.attemptCount + 1;
      await prisma.employeeNotificationOutbox.update({
        where: { id: row.id },
        data: {
          status: nextAttempt >= MAX_ATTEMPTS ? 'failed' : 'pending',
          lastError: result.error ?? 'send_failed',
          attemptCount: nextAttempt,
          scheduledAt: new Date(Date.now() + 5 * 60_000),
        },
      });
    }
  }

  return processed;
}

let workerTimer: ReturnType<typeof setInterval> | null = null;

export function startNotificationWorker(): void {
  if (!env.notificationWorkerEnabled) {
    console.log('[notification-worker] disabled');
    return;
  }
  if (workerTimer) return;

  const tick = () => {
    void processNotificationOutboxBatch().catch((err) => {
      console.error('[notification-worker]', err);
    });
    void processEmployeeNotificationOutboxBatch().catch((err) => {
      console.error('[notification-worker:employee]', err);
    });
  };

  tick();
  workerTimer = setInterval(tick, env.notificationWorkerIntervalMs);
  console.log(`[notification-worker] started (every ${env.notificationWorkerIntervalMs}ms)`);
}

export function stopNotificationWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}
