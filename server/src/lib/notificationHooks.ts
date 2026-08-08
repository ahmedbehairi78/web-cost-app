import { prisma } from '../db.js';
import {
  enqueueWhatsAppForNotification,
  fireCancelOutbox,
  scheduleReminderForKey,
  type EnqueuePayload,
} from './enqueueNotification.js';

async function enqueueWithReminder(payload: EnqueuePayload): Promise<void> {
  const n = await enqueueWhatsAppForNotification(payload);
  if (n > 0) {
    const { notificationKey, ...rest } = payload;
    await scheduleReminderForKey(notificationKey, rest);
  }
}

export function notifyTransferCreated(
  transfer: {
    id: number;
    transferNumber: string;
    fromProjectId: string;
    toProjectId: string;
  },
  excludeUserId?: string,
): void {
  const payload: EnqueuePayload = {
    notificationKey: `transfer:${transfer.id}`,
    notifyType: 'transfer_pending_b',
    titleAr: `تحويل مخزن ${transfer.transferNumber} بانتظار قبول الوجهة`,
    titleEn: `Transfer ${transfer.transferNumber} awaiting destination acceptance`,
    entityLabel: transfer.transferNumber,
    priority: 'normal',
    fromProjectId: transfer.fromProjectId,
    toProjectId: transfer.toProjectId,
    excludeUserId,
  };
  void enqueueWithReminder(payload).catch((err) => {
    console.error('[notify-transfer-created]', transfer.id, err);
  });
}

export function notifyTransferPendingProjects(transferId: number): void {
  void (async () => {
    fireCancelOutbox(`transfer:${transferId}`);
    const tr = await prisma.projectInventoryTransfer.findUnique({
      where: { id: transferId },
      select: { id: true, transferNumber: true, fromProjectId: true, toProjectId: true },
    });
    if (!tr) return;

    const payload: EnqueuePayload = {
      notificationKey: `transfer:${tr.id}`,
      notifyType: 'transfer_pending_projects',
      titleAr: `تحويل مخزن ${tr.transferNumber} بانتظار اعتماد إدارة المشاريع`,
      titleEn: `Transfer ${tr.transferNumber} awaiting projects approval`,
      entityLabel: tr.transferNumber,
      priority: 'normal',
      fromProjectId: tr.fromProjectId,
      toProjectId: tr.toProjectId,
    };
    await enqueueWithReminder(payload);
  })().catch((err) => {
    console.error('[notify-transfer-pending-projects]', transferId, err);
  });
}

export function notifyMosDraft(
  mos: { id: string; extractNumber: string | null; contractId: string },
  excludeUserId?: string,
): void {
  const label = mos.extractNumber || mos.id.slice(0, 8);
  const payload: EnqueuePayload = {
    notificationKey: `mos:${mos.id}`,
    notifyType: 'mos_draft',
    titleAr: `تشوين ${label} — مسودة بانتظار الاعتماد`,
    titleEn: `MOS ${label} — draft awaiting approval`,
    entityLabel: label,
    priority: 'normal',
    contractId: mos.contractId,
    excludeUserId,
  };
  void enqueueWithReminder(payload).catch((err) => {
    console.error('[notify-mos-draft]', mos.id, err);
  });
}

export function notifyTransferResolved(transferId: number): void {
  fireCancelOutbox(`transfer:${transferId}`);
}

export function notifyMosResolved(mosId: string): void {
  fireCancelOutbox(`mos:${mosId}`);
}

export function notifyVoSubmitted(
  vo: { id: string; voNumber: string; contractId: string; projectId: string },
  excludeUserId?: string,
): void {
  const label = vo.voNumber || vo.id.slice(0, 8);
  const payload: EnqueuePayload = {
    notificationKey: `vo:${vo.id}`,
    notifyType: 'vo_submitted',
    titleAr: `أمر تغيير ${label} — بانتظار الاعتماد`,
    titleEn: `Variation order ${label} — awaiting approval`,
    entityLabel: label,
    priority: 'normal',
    contractId: vo.contractId,
    projectId: vo.projectId,
    excludeUserId,
  };
  void enqueueWithReminder(payload).catch((err) => {
    console.error('[notify-vo-submitted]', vo.id, err);
  });
}

export function notifyVoResolved(voId: string): void {
  fireCancelOutbox(`vo:${voId}`);
}

export function notifySubcontractorIpcSubmitted(
  ipc: {
    id: string;
    referenceNumber: string | null;
    contractId: string | null;
    supplierName: string;
  },
  excludeUserId?: string,
): void {
  const label = ipc.referenceNumber?.trim() || ipc.supplierName || ipc.id.slice(0, 8);
  const payload: EnqueuePayload = {
    notificationKey: `subcontractor_ipc:${ipc.id}`,
    notifyType: 'subcontractor_ipc_pending',
    titleAr: `مستخلص مقاول ${label} بانتظار الاعتماد`,
    titleEn: `Subcontractor IPC ${label} awaiting approval`,
    entityLabel: label,
    priority: 'normal',
    contractId: ipc.contractId ?? undefined,
    excludeUserId,
  };
  void enqueueWithReminder(payload).catch((err) => {
    console.error('[notify-subcontractor-ipc-submitted]', ipc.id, err);
  });
}

export function notifySubcontractorIpcResolved(ipcId: string): void {
  fireCancelOutbox(`subcontractor_ipc:${ipcId}`);
}

export function notifyCustodySettlementSubmitted(
  settlement: {
    id: string;
    settlementNumber: string;
    projectId: string;
  },
  excludeUserId?: string,
): void {
  const label = settlement.settlementNumber;
  const payload: EnqueuePayload = {
    notificationKey: `custody_settlement:${settlement.id}`,
    notifyType: 'custody_settlement_pending',
    titleAr: `تسوية عهدة ${label} بانتظار اعتماد مدير الحسابات`,
    titleEn: `Custody settlement ${label} awaiting accounting approval`,
    entityLabel: label,
    priority: 'normal',
    projectId: settlement.projectId,
    excludeUserId,
  };
  void enqueueWithReminder(payload).catch((err) => {
    console.error('[notify-custody-settlement-submitted]', settlement.id, err);
  });
}

export function notifyCustodySettlementResolved(settlementId: string): void {
  fireCancelOutbox(`custody_settlement:${settlementId}`);
}

export function notifyPurchaseRequestCreated(
  req: {
    id: string;
    requestNumber: string;
    projectId: string;
    materialLabel: string;
    quantity: number;
    neededByDate: string;
    priority: string;
  },
  excludeUserId?: string,
): void {
  const qty = Number.isFinite(req.quantity) ? String(req.quantity) : '';
  const label = req.requestNumber;
  const payload: EnqueuePayload = {
    notificationKey: `purchase_request:${req.id}`,
    notifyType: 'purchase_request_pending',
    titleAr: `طلب شراء ${label} — ${req.materialLabel} (${qty}) يحتاج إجراء · احتياج ${req.neededByDate}`,
    titleEn: `Purchase request ${label} — ${req.materialLabel} (${qty}) needs action · needed ${req.neededByDate}`,
    entityLabel: label,
    priority: req.priority === 'urgent' || req.priority === 'high' ? 'urgent' : 'normal',
    projectId: req.projectId,
    excludeUserId,
  };
  void enqueueWithReminder(payload).catch((err) => {
    console.error('[notify-purchase-request-created]', req.id, err);
  });
}

export function notifyPurchaseRequestResolved(requestId: string): void {
  fireCancelOutbox(`purchase_request:${requestId}`);
}
