import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { env } from '../env.js';
import {
  approvalLinkExpiresAt,
  approvalLinkUrl,
  generateApprovalTokenPlain,
  hashApprovalToken,
} from './approvalLinkToken.js';
import { resolveWhatsAppRecipients, type NotifyEventType } from './notificationRecipients.js';
import { isWhatsAppNotificationsActive } from './whatsappSettings.js';

export type EnqueuePayload = {
  notificationKey: string;
  notifyType: NotifyEventType;
  titleAr: string;
  titleEn: string;
  entityLabel: string;
  priority: 'urgent' | 'normal' | 'low';
  excludeUserId?: string;
  fromProjectId?: string;
  toProjectId?: string;
  contractId?: string;
  projectId?: string;
};

function priorityLabelAr(priority: EnqueuePayload['priority']): string {
  if (priority === 'urgent') return 'عاجلة';
  if (priority === 'low') return 'منخفضة';
  return 'عادية';
}

function priorityLabelEn(priority: EnqueuePayload['priority']): string {
  if (priority === 'urgent') return 'Urgent';
  if (priority === 'low') return 'Low';
  return 'Normal';
}

function dedupeHash(userId: string, notificationKey: string, templateName: string): string {
  return createHash('sha256').update(`${userId}:${notificationKey}:${templateName}`).digest('hex');
}

async function createLinkToken(userId: string, notificationKey: string): Promise<string> {
  const plain = generateApprovalTokenPlain();
  await prisma.approvalLinkToken.create({
    data: {
      id: randomUUID(),
      userId,
      notificationKey,
      tokenHash: hashApprovalToken(plain),
      expiresAt: approvalLinkExpiresAt(),
    },
  });
  return plain;
}

export async function enqueueWhatsAppForNotification(payload: EnqueuePayload): Promise<number> {
  if (!(await isWhatsAppNotificationsActive())) return 0;

  const recipients = await resolveWhatsAppRecipients({
    notifyType: payload.notifyType,
    excludeUserId: payload.excludeUserId,
    fromProjectId: payload.fromProjectId,
    toProjectId: payload.toProjectId,
    contractId: payload.contractId,
    projectId: payload.projectId,
  });

  if (recipients.length === 0) return 0;

  let enqueued = 0;
  for (const recipient of recipients) {
    const plainToken = await createLinkToken(recipient.id, payload.notificationKey);
    const linkPath = approvalLinkUrl(plainToken).replace(env.appPublicBaseUrl, '');
    const lang = recipient.preferredLanguage === 'en' ? 'en' : 'ar';
    const title = lang === 'ar' ? payload.titleAr : payload.titleEn;

    const outboxPayload = {
      titleAr: payload.titleAr,
      titleEn: payload.titleEn,
      entityLabel: payload.entityLabel,
      priority: payload.priority,
      intendedPhone: recipient.phoneE164,
      linkUrl: approvalLinkUrl(plainToken),
    };

    const templateName = 'approval_required';
    const hash = dedupeHash(recipient.id, payload.notificationKey, templateName);

    try {
      await prisma.notificationOutbox.create({
        data: {
          id: randomUUID(),
          userId: recipient.id,
          notificationKey: payload.notificationKey,
          channel: 'whatsapp',
          templateName,
          payload: {
            ...outboxPayload,
            bodyParams: [
              title,
              payload.entityLabel,
              lang === 'ar' ? priorityLabelAr(payload.priority) : priorityLabelEn(payload.priority),
            ],
            urlButtonPath: linkPath.startsWith('/') ? linkPath.slice(1) : linkPath,
            languageCode: lang,
          },
          status: 'pending',
          dedupeHash: hash,
        },
      });
      enqueued += 1;
    } catch {
      // duplicate dedupe — already queued
    }
  }

  return enqueued;
}

export async function cancelOutboxForNotificationKey(notificationKey: string): Promise<void> {
  await prisma.notificationOutbox.updateMany({
    where: { notificationKey, status: 'pending' },
    data: { status: 'cancelled' },
  });
}

export async function scheduleReminderForKey(
  notificationKey: string,
  payload: Omit<EnqueuePayload, 'notificationKey'>,
): Promise<void> {
  if (!(await isWhatsAppNotificationsActive())) return;

  const recipients = await resolveWhatsAppRecipients({
    notifyType: payload.notifyType,
    fromProjectId: payload.fromProjectId,
    toProjectId: payload.toProjectId,
    contractId: payload.contractId,
    projectId: payload.projectId,
  });

  const reminderAt = new Date(Date.now() + env.notificationReminderHours * 3_600_000);

  for (const recipient of recipients) {
    const templateName = 'approval_reminder';
    const hash = dedupeHash(recipient.id, notificationKey, templateName);
    const lang = recipient.preferredLanguage === 'en' ? 'en' : 'ar';

    try {
      await prisma.notificationOutbox.create({
        data: {
          id: randomUUID(),
          userId: recipient.id,
          notificationKey,
          channel: 'whatsapp',
          templateName,
          payload: {
            titleAr: payload.titleAr,
            titleEn: payload.titleEn,
            entityLabel: payload.entityLabel,
            bodyParams: [
              lang === 'ar' ? payload.titleAr : payload.titleEn,
              payload.entityLabel,
            ],
            languageCode: lang,
          },
          status: 'pending',
          dedupeHash: hash,
          scheduledAt: reminderAt,
        },
      });
    } catch {
      // already scheduled
    }
  }
}

/** Fire-and-forget — never throws to HTTP handler. */
export function fireEnqueue(payload: EnqueuePayload): void {
  void enqueueWhatsAppForNotification(payload).catch((err) => {
    console.error('[enqueue-notification]', payload.notificationKey, err);
  });
}

export function fireCancelOutbox(notificationKey: string): void {
  void cancelOutboxForNotificationKey(notificationKey).catch((err) => {
    console.error('[cancel-outbox]', notificationKey, err);
  });
}
