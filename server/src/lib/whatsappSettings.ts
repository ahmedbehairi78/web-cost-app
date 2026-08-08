import { prisma } from '../db.js';
import { env } from '../env.js';

const SETTING_KEY = 'whatsapp_notifications';

export type WhatsAppNotificationsConfig = {
  enabled: boolean;
};

const DEFAULT_CONFIG: WhatsAppNotificationsConfig = { enabled: true };

export async function getWhatsAppNotificationsConfig(): Promise<WhatsAppNotificationsConfig> {
  const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
  if (!row?.value || typeof row.value !== 'object' || Array.isArray(row.value)) {
    return DEFAULT_CONFIG;
  }
  const raw = row.value as Record<string, unknown>;
  return { enabled: raw.enabled !== false };
}

export async function setWhatsAppNotificationsEnabled(enabled: boolean): Promise<void> {
  const { randomUUID } = await import('node:crypto');
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    create: { id: randomUUID(), key: SETTING_KEY, value: { enabled } },
    update: { value: { enabled } },
  });
}

/** Env flag + in-app admin toggle. */
export async function isWhatsAppNotificationsActive(): Promise<boolean> {
  if (!env.whatsappEnabled) return false;
  const cfg = await getWhatsAppNotificationsConfig();
  return cfg.enabled;
}
