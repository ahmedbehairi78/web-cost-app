import { prisma } from '../db.js';
import {
  getAccessibleProjectIds,
  getAssignedContractIds,
} from '../modules/inventoryHelpers.js';
import {
  hasModuleWrite,
  hasReferenceRead,
  moduleAccess,
  type UserPermissions,
  type UserRole,
} from '../permissions.js';

export type NotificationPriority = 'urgent' | 'normal' | 'low';

export type NotificationItem = {
  key: string;
  type: string;
  priority: NotificationPriority;
  titleAr: string;
  titleEn: string;
  moduleId: string;
  entityId?: string;
  contractId?: string;
  projectId?: string;
  createdAt: string;
  dueAt?: string;
  read: boolean;
};

export type NotificationAuthUser = {
  id: string;
  role: UserRole;
  permissions: UserPermissions;
  assignedContractIds: string[];
};

type ReqUserShape = {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  permissions: UserPermissions;
  assignedContractIds: string[];
  isActive: boolean;
};

function asReqUser(user: NotificationAuthUser): ReqUserShape {
  return {
    id: user.id,
    email: '',
    displayName: null,
    role: user.role,
    permissions: user.permissions,
    assignedContractIds: user.assignedContractIds,
    isActive: true,
  };
}

function canSeeInventory(user: NotificationAuthUser): boolean {
  return user.role === 'admin'
    || user.role === 'projects_manager'
    || hasReferenceRead(user.permissions, 'inventory');
}

function canApproveTransfers(user: NotificationAuthUser): boolean {
  return user.role === 'admin' || user.role === 'projects_manager';
}

function canSeeBanks(user: NotificationAuthUser): boolean {
  return user.role === 'admin' || hasReferenceRead(user.permissions, 'banks');
}

function canSeeOverhead(user: NotificationAuthUser): boolean {
  return user.role === 'admin'
    || user.role === 'projects_manager'
    || hasReferenceRead(user.permissions, 'overhead');
}

function canSeeBoq(user: NotificationAuthUser): boolean {
  return user.role === 'admin'
    || user.role === 'projects_manager'
    || hasReferenceRead(user.permissions, 'boq');
}

function canSeeBilling(user: NotificationAuthUser): boolean {
  return user.role === 'admin'
    || user.role === 'projects_manager'
    || hasReferenceRead(user.permissions, 'billing');
}

function canSeeCosts(user: NotificationAuthUser): boolean {
  return user.role === 'admin'
    || user.role === 'projects_manager'
    || hasReferenceRead(user.permissions, 'costs');
}

function canApproveSubcontractorIpc(user: NotificationAuthUser): boolean {
  return user.role === 'admin' || user.role === 'projects_manager';
}

function canApproveCustodySettlement(user: NotificationAuthUser): boolean {
  if (user.role === 'admin') return true;
  return hasModuleWrite(user.permissions, 'ledger');
}

function canSeeSubcontractor(user: NotificationAuthUser): boolean {
  return user.role === 'admin'
    || user.role === 'projects_manager'
    || hasReferenceRead(user.permissions, 'subcontractor');
}

function canManagePurchaseRequests(user: NotificationAuthUser): boolean {
  if (user.role === 'admin' || user.role === 'projects_manager' || user.role === 'project_accountant') {
    return true;
  }
  return moduleAccess(user.permissions, 'purchase_requests').edit;
}

export function daysUntil(isoDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${isoDate}T00:00:00`);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

export function sortNotificationItems(items: NotificationItem[]): NotificationItem[] {
  const priorityRank: Record<NotificationPriority, number> = { urgent: 0, normal: 1, low: 2 };
  return [...items].sort((a, b) => {
    const pr = priorityRank[a.priority] - priorityRank[b.priority];
    if (pr !== 0) return pr;
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });
}

async function loadNotificationState(
  userId: string,
): Promise<{ readKeys: Set<string>; dismissedKeys: Set<string> }> {
  const rows = await prisma.userNotificationRead.findMany({
    where: { userId },
    select: { notificationKey: true, readAt: true, dismissedAt: true },
  });
  const readKeys = new Set<string>();
  const dismissedKeys = new Set<string>();
  for (const row of rows) {
    if (row.dismissedAt) dismissedKeys.add(row.notificationKey);
    else if (row.readAt) readKeys.add(row.notificationKey);
  }
  return { readKeys, dismissedKeys };
}

function contractFilter(user: NotificationAuthUser): { contractId?: { in: string[] } } {
  const assigned = getAssignedContractIds(asReqUser(user) as Express.Request['user']);
  if (assigned === null) return {};
  if (assigned.length === 0) return { contractId: { in: ['__no_access__'] } };
  return { contractId: { in: assigned } };
}

function pushItem(
  items: NotificationItem[],
  dismissedKeys: Set<string>,
  readKeys: Set<string>,
  item: Omit<NotificationItem, 'read'>,
): void {
  if (dismissedKeys.has(item.key)) return;
  items.push({ ...item, read: readKeys.has(item.key) });
}

export async function buildNotificationFeed(user: NotificationAuthUser): Promise<NotificationItem[]> {
  const items: NotificationItem[] = [];
  const { readKeys, dismissedKeys } = await loadNotificationState(user.id);
  const reqUser = asReqUser(user);
  const scopedContracts = contractFilter(user);
  const accessibleProjects = await getAccessibleProjectIds(prisma, reqUser as Express.Request['user']);

  if (canSeeInventory(user)) {
    const transferWhere = canApproveTransfers(user)
      ? { status: { in: ['pending_b', 'pending_projects'] } }
      : { status: 'pending_b' as const };

    const transfers = await prisma.projectInventoryTransfer.findMany({
      where: transferWhere,
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    for (const tr of transfers) {
      if (accessibleProjects !== null) {
        const relevant = accessibleProjects.includes(tr.fromProjectId)
          || accessibleProjects.includes(tr.toProjectId);
        if (!relevant) continue;
      }
      const pendingProjects = tr.status === 'pending_projects';
      pushItem(items, dismissedKeys, readKeys, {
        key: `transfer:${tr.id}`,
        type: pendingProjects ? 'transfer_pending_projects' : 'transfer_pending_b',
        priority: 'normal',
        titleAr: pendingProjects
          ? `تحويل مخزن ${tr.transferNumber} بانتظار اعتماد إدارة المشاريع`
          : `تحويل مخزن ${tr.transferNumber} بانتظار قبول الوجهة`,
        titleEn: pendingProjects
          ? `Transfer ${tr.transferNumber} awaiting projects approval`
          : `Transfer ${tr.transferNumber} awaiting destination acceptance`,
        moduleId: 'inventory',
        entityId: String(tr.id),
        createdAt: tr.transferDate,
      });
    }

    const consumptionWhere: {
      status: string;
      projectId?: { in: string[] };
    } = { status: 'draft' };
    if (accessibleProjects !== null) {
      consumptionWhere.projectId = {
        in: accessibleProjects.length > 0 ? accessibleProjects : ['__none__'],
      };
    }

    const consumptionDrafts = await prisma.consumptionOrder.findMany({
      where: consumptionWhere,
      orderBy: { orderDate: 'desc' },
      take: 20,
    });

    for (const order of consumptionDrafts) {
      pushItem(items, dismissedKeys, readKeys, {
        key: `consumption:${order.id}`,
        type: 'consumption_draft',
        priority: 'normal',
        titleAr: `أمر صرف ${order.orderNumber} — مسودة بانتظار التأكيد`,
        titleEn: `Consumption ${order.orderNumber} — draft awaiting confirm`,
        moduleId: 'inventory',
        entityId: String(order.id),
        createdAt: order.orderDate,
      });
    }

    const pendingCostWhere: {
      status: string;
      projectId?: { in: string[] };
    } = { status: 'pending_cost' };
    if (accessibleProjects !== null) {
      pendingCostWhere.projectId = {
        in: accessibleProjects.length > 0 ? accessibleProjects : ['__none__'],
      };
    }
    const consumptionPendingCost = await prisma.consumptionOrder.findMany({
      where: pendingCostWhere,
      orderBy: { orderDate: 'desc' },
      take: 20,
    });
    for (const order of consumptionPendingCost) {
      pushItem(items, dismissedKeys, readKeys, {
        key: `consumption_pending_cost:${order.id}`,
        type: 'consumption_pending_cost',
        priority: 'normal',
        titleAr: `أمر صرف ${order.orderNumber} — بانتظار اعتماد التكلفة`,
        titleEn: `Consumption ${order.orderNumber} — awaiting cost approval`,
        moduleId: 'inventory',
        entityId: String(order.id),
        projectId: order.projectId ?? undefined,
        createdAt: order.orderDate,
      });
    }

    const receiptWhere: {
      status: string;
      projectId?: { in: string[] };
    } = { status: 'pending_approval' };
    if (accessibleProjects !== null) {
      receiptWhere.projectId = {
        in: accessibleProjects.length > 0 ? accessibleProjects : ['__none__'],
      };
    }
    const pendingReceipts = await prisma.warehouseReceipt.findMany({
      where: receiptWhere,
      orderBy: { receiptDate: 'desc' },
      take: 20,
    });
    const showReceiptToApprover =
      user.role === 'admin'
      || user.role === 'projects_manager'
      || moduleAccess(user.permissions, 'costs').edit === true
      || canSeeInventory(user);
    if (showReceiptToApprover) {
      for (const receipt of pendingReceipts) {
        pushItem(items, dismissedKeys, readKeys, {
          key: `warehouse_receipt:${receipt.id}`,
          type: 'warehouse_receipt_pending',
          priority: 'normal',
          titleAr: `استلام ${receipt.receiptNumber} — بانتظار اعتماد المشتريات`,
          titleEn: `Receipt ${receipt.receiptNumber} — awaiting purchasing approval`,
          moduleId: 'inventory',
          entityId: receipt.id,
          projectId: receipt.projectId,
          createdAt: receipt.receiptDate,
        });
      }
    }
  }

  if (canSeeBanks(user)) {
    const cheques = await prisma.bankCheque.findMany({
      where: { status: { in: ['issued', 'received'] } },
      orderBy: [{ dueDate: 'asc' }, { issueDate: 'desc' }],
      take: 40,
    });

    const today = new Date().toISOString().slice(0, 10);
    for (const ch of cheques) {
      const due = ch.dueDate ?? ch.issueDate;
      const overdue = due < today;
      const urgent = overdue || daysUntil(due) <= 3;
      pushItem(items, dismissedKeys, readKeys, {
        key: `cheque:${ch.id}`,
        type: overdue ? 'cheque_overdue' : 'cheque_pending',
        priority: urgent ? 'urgent' : 'normal',
        titleAr: overdue
          ? `شيك ${ch.chequeNo} متأخر (${ch.status === 'issued' ? 'صادر' : 'وارد'})`
          : `شيك ${ch.chequeNo} بانتظار التحصيل/الصرف`,
        titleEn: overdue
          ? `Cheque ${ch.chequeNo} overdue (${ch.status})`
          : `Cheque ${ch.chequeNo} pending clearance`,
        moduleId: 'banks',
        entityId: ch.id,
        createdAt: ch.issueDate,
        dueAt: ch.dueDate ?? undefined,
      });
    }

    const movements = await prisma.bankMovement.findMany({
      where: { status: 'draft' },
      orderBy: { date: 'desc' },
      take: 15,
    });

    for (const mv of movements) {
      pushItem(items, dismissedKeys, readKeys, {
        key: `bank_movement:${mv.id}`,
        type: 'bank_movement_draft',
        priority: 'low',
        titleAr: `حركة بنكية مسودة ${mv.documentNo || mv.reference || mv.id.slice(0, 8)}`,
        titleEn: `Bank movement draft ${mv.documentNo || mv.reference || mv.id.slice(0, 8)}`,
        moduleId: 'banks',
        entityId: mv.id,
        createdAt: mv.date,
      });
    }
  }

  if (canSeeBilling(user)) {
    const billingPendingApprove =
      user.role === 'admin' || user.role === 'projects_manager'
        ? await prisma.billing.findMany({
            where: {
              status: { in: ['submitted', 'review'] },
              isDeleted: false,
              transactionId: null,
              ...scopedContracts,
            },
            orderBy: { date: 'desc' },
            take: 20,
          })
        : [];

    for (const bill of billingPendingApprove) {
      pushItem(items, dismissedKeys, readKeys, {
        key: `billing:${bill.id}`,
        type: bill.status === 'review' ? 'billing_review' : 'billing_submitted',
        priority: 'normal',
        titleAr:
          bill.status === 'review'
            ? `مستخلص ${bill.billingNumber} بانتظار المراجعة`
            : `مستخلص ${bill.billingNumber} بانتظار الاعتماد`,
        titleEn:
          bill.status === 'review'
            ? `IPC ${bill.billingNumber} awaiting review`
            : `IPC ${bill.billingNumber} awaiting approval`,
        moduleId: 'billing',
        entityId: bill.id,
        contractId: bill.contractId,
        projectId: bill.projectId,
        createdAt: bill.date,
      });
    }

    const billingReviewOnly =
      user.role !== 'admin' && user.role !== 'projects_manager'
        ? await prisma.billing.findMany({
            where: { status: 'review', isDeleted: false, ...scopedContracts },
            orderBy: { date: 'desc' },
            take: 20,
          })
        : [];

    for (const bill of billingReviewOnly) {
      pushItem(items, dismissedKeys, readKeys, {
        key: `billing:${bill.id}`,
        type: 'billing_review',
        priority: 'normal',
        titleAr: `مستخلص ${bill.billingNumber} بانتظار المراجعة`,
        titleEn: `IPC ${bill.billingNumber} awaiting review`,
        moduleId: 'billing',
        entityId: bill.id,
        contractId: bill.contractId,
        projectId: bill.projectId,
        createdAt: bill.date,
      });
    }

    const mosDrafts = await prisma.mosCertificate.findMany({
      where: { status: 'draft', ...scopedContracts },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { contract: { select: { projectId: true } } },
    });

    for (const mos of mosDrafts) {
      const label = mos.certificateNo || mos.id.slice(0, 8);
      pushItem(items, dismissedKeys, readKeys, {
        key: `mos:${mos.id}`,
        type: 'mos_draft',
        priority: 'normal',
        titleAr: `تشوين ${label} — مسودة بانتظار الاعتماد`,
        titleEn: `MOS ${label} — draft awaiting approval`,
        moduleId: 'billing',
        entityId: mos.id,
        contractId: mos.contractId,
        projectId: mos.contract.projectId,
        createdAt: mos.extractDate ?? mos.createdAt.toISOString().slice(0, 10),
      });
    }

    const legacyMosDrafts = await prisma.materialOnSiteExtract.findMany({
      where: { status: 'draft', ...scopedContracts },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const legacyContractIds = [...new Set(legacyMosDrafts.map((m) => m.contractId))];
    const legacyContracts =
      legacyContractIds.length > 0
        ? await prisma.contract.findMany({
            where: { id: { in: legacyContractIds } },
            select: { id: true, projectId: true },
          })
        : [];
    const legacyProjectByContract = new Map(legacyContracts.map((c) => [c.id, c.projectId]));

    for (const mos of legacyMosDrafts) {
      const label = mos.extractNumber || mos.id.slice(0, 8);
      pushItem(items, dismissedKeys, readKeys, {
        key: `mos:${mos.id}`,
        type: 'mos_draft',
        priority: 'normal',
        titleAr: `تشوين ${label} — مسودة بانتظار الاعتماد`,
        titleEn: `MOS ${label} — draft awaiting approval`,
        moduleId: 'billing',
        entityId: mos.id,
        contractId: mos.contractId,
        projectId: legacyProjectByContract.get(mos.contractId),
        createdAt: mos.extractDate ?? mos.createdAt.toISOString().slice(0, 10),
      });
    }
  }

  if (canSeeBoq(user)) {
    const voPending =
      user.role === 'admin' || user.role === 'projects_manager'
        ? await prisma.variationOrder.findMany({
            where: { status: 'submitted', ...scopedContracts },
            orderBy: { createdAt: 'desc' },
            take: 20,
          })
        : [];

    for (const vo of voPending) {
      pushItem(items, dismissedKeys, readKeys, {
        key: `vo:${vo.id}`,
        type: 'vo_submitted',
        priority: 'normal',
        titleAr: `أمر تغيير ${vo.voNumber} — بانتظار الاعتماد`,
        titleEn: `Variation order ${vo.voNumber} — awaiting approval`,
        moduleId: 'boq',
        entityId: vo.id,
        contractId: vo.contractId,
        projectId: vo.projectId,
        createdAt: vo.voDate ?? vo.createdAt.toISOString().slice(0, 10),
      });
    }
  }

  if (canSeeOverhead(user)) {
    const periods = await prisma.overheadAllocationPeriod.findMany({
      where: { status: 'draft' },
      orderBy: { periodEnd: 'desc' },
      take: 10,
    });
    for (const p of periods) {
      pushItem(items, dismissedKeys, readKeys, {
        key: `overhead:${p.id}`,
        type: 'overhead_draft',
        priority: 'low',
        titleAr: `فترة توزيع أعباء ${p.label} — مسودة بانتظار الإقفال`,
        titleEn: `Overhead period ${p.label} — draft awaiting close`,
        moduleId: 'ledger',
        entityId: p.id,
        createdAt: p.periodEnd,
      });
    }
  }

  if (canSeeCosts(user) && canApproveSubcontractorIpc(user)) {
    const pendingIpcs = await prisma.purchaseTransaction.findMany({
      where: {
        type: 'ipc',
        status: 'submitted',
        transactionId: null,
        isDeleted: false,
        ...scopedContracts,
      },
      orderBy: { date: 'desc' },
      take: 20,
    });

    for (const ipc of pendingIpcs) {
      const label = ipc.referenceNumber?.trim() || ipc.supplierName || ipc.id.slice(0, 8);
      pushItem(items, dismissedKeys, readKeys, {
        key: `subcontractor_ipc:${ipc.id}`,
        type: 'subcontractor_ipc_pending',
        priority: 'normal',
        titleAr: `مستخلص مقاول ${label} بانتظار الاعتماد`,
        titleEn: `Subcontractor IPC ${label} awaiting approval`,
        moduleId: 'costs',
        entityId: ipc.id,
        createdAt: ipc.date,
      });
    }
  }

  if (canSeeCosts(user) && canApproveCustodySettlement(user)) {
    const accessibleProjects = await getAccessibleProjectIds(prisma, reqUser as Express.Request['user']);
    const projectFilter =
      accessibleProjects === null ? {} : { projectId: { in: accessibleProjects } };
    const pendingSettlements = await prisma.custodySettlement.findMany({
      where: {
        status: 'submitted',
        isDeleted: false,
        ...projectFilter,
      },
      orderBy: { date: 'desc' },
      take: 20,
    });

    for (const cs of pendingSettlements) {
      const txIds = Array.isArray(cs.transactionIds) ? (cs.transactionIds as unknown[]) : [];
      if (txIds.length > 0) continue;
      pushItem(items, dismissedKeys, readKeys, {
        key: `custody_settlement:${cs.id}`,
        type: 'custody_settlement_pending',
        priority: 'normal',
        titleAr: `تسوية عهدة ${cs.settlementNumber} بانتظار اعتماد مدير الحسابات`,
        titleEn: `Custody settlement ${cs.settlementNumber} awaiting accounting approval`,
        moduleId: 'costs',
        entityId: cs.id,
        createdAt: cs.date,
      });
    }
  }

  if (canSeeSubcontractor(user) && canApproveTransfers(user)) {
    const extracts = await prisma.subcontractExtract.findMany({
      where: { status: 'submitted' },
      orderBy: { extractDate: 'desc' },
      take: 15,
      include: { assignment: { select: { contractId: true } } },
    });

    for (const ex of extracts) {
      const contractId = ex.assignment.contractId;
      const assigned = getAssignedContractIds(reqUser as Express.Request['user']);
      if (assigned !== null && !assigned.includes(contractId)) continue;

      pushItem(items, dismissedKeys, readKeys, {
        key: `subcontract:${ex.id}`,
        type: 'subcontract_extract_pending',
        priority: 'normal',
        titleAr: `مستخلص مقاول ${ex.extractNumber} بانتظار الاعتماد`,
        titleEn: `Subcontract extract ${ex.extractNumber} awaiting approval`,
        moduleId: 'costs',
        entityId: String(ex.id),
        createdAt: ex.extractDate,
      });
    }
  }

  if (canManagePurchaseRequests(user)) {
    const pendingPr = await prisma.purchaseRequest.findMany({
      where: {
        isDeleted: false,
        status: { in: ['open', 'contacted', 'postponed', 'unavailable'] },
      },
      orderBy: [{ neededByDate: 'asc' }, { requestedAt: 'desc' }],
      take: 40,
    });
    for (const pr of pendingPr) {
      const mat =
        pr.materialMode === 'coded'
          ? [pr.materialCode, pr.materialName].filter(Boolean).join(' — ') || pr.materialName || '—'
          : pr.description || pr.materialName || 'غير مكود';
      const overdue = daysUntil(pr.neededByDate) < 0;
      pushItem(items, dismissedKeys, readKeys, {
        key: `purchase_request:${pr.id}`,
        type: 'purchase_request_pending',
        priority:
          overdue || pr.priority === 'urgent' || pr.priority === 'high' ? 'urgent' : 'normal',
        titleAr: `طلب شراء ${pr.requestNumber} — ${mat} يحتاج إجراء · احتياج ${pr.neededByDate}`,
        titleEn: `Purchase request ${pr.requestNumber} — ${mat} needs action · needed ${pr.neededByDate}`,
        moduleId: 'purchase_requests',
        entityId: pr.id,
        projectId: pr.projectId,
        contractId: pr.contractId,
        createdAt: pr.requestedAt.toISOString(),
        dueAt: pr.neededByDate,
      });
    }
  }

  return sortNotificationItems(items);
}
