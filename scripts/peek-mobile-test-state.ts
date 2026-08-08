import 'dotenv/config';
import { prisma, closeDb } from '../server/src/db.js';

async function main() {
  const pendingTransfers = await prisma.projectInventoryTransfer.findMany({
    where: { status: { in: ['pending_b', 'pending_projects'] } },
    select: {
      id: true,
      transferNumber: true,
      status: true,
      fromProjectId: true,
      toProjectId: true,
    },
    orderBy: { id: 'desc' },
    take: 5,
  });

  const outbox = await prisma.notificationOutbox.groupBy({
    by: ['status'],
    _count: true,
  });

  const recentOutbox = await prisma.notificationOutbox.findMany({
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: {
      id: true,
      notificationKey: true,
      status: true,
      templateName: true,
      createdAt: true,
      payload: true,
    },
  });

  const tokens = await prisma.approvalLinkToken.findMany({
    where: { usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: {
      notificationKey: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  const waSetting = await prisma.setting.findUnique({
    where: { key: 'whatsapp_notifications' },
    select: { value: true },
  });

  const whatsappUsersCount = await prisma.user.count({
    where: { whatsappOptIn: true, phoneE164: { not: null } },
  });

  console.log(
    JSON.stringify(
      {
        whatsappSetting: waSetting?.value ?? { enabled: true },
        whatsappOptInUsers: whatsappUsersCount,
        pendingTransfers,
        outbox,
        recentOutbox: recentOutbox.map((r) => {
          const payload = r.payload as Record<string, unknown> | null;
          return {
            notificationKey: r.notificationKey,
            status: r.status,
            templateName: r.templateName,
            createdAt: r.createdAt,
            linkUrl: typeof payload?.linkUrl === 'string' ? payload.linkUrl : undefined,
          };
        }),
        activeTokens: tokens,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => closeDb());
