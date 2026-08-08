import { prisma } from '../db.js';
import {
  getAccessibleProjectIds,
  getAssignedContractIds,
} from '../modules/inventoryHelpers.js';
import {
  hasModuleWrite,
  hasReferenceRead,
  moduleAccess,
  normalizeUserPermissions,
  type UserPermissions,
  type UserRole,
} from '../permissions.js';

export type NotifyEventType =
  | 'transfer_pending_b'
  | 'transfer_pending_projects'
  | 'mos_draft'
  | 'vo_submitted'
  | 'subcontractor_ipc_pending'
  | 'custody_settlement_pending'
  | 'purchase_request_pending';

export type RecipientContext = {
  notifyType: NotifyEventType;
  excludeUserId?: string;
  fromProjectId?: string;
  toProjectId?: string;
  contractId?: string;
  projectId?: string;
};

export type WhatsAppRecipient = {
  id: string;
  phoneE164: string;
  preferredLanguage: string;
};

function parseNotifyTypes(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const list = value.filter((v): v is string => typeof v === 'string' && v.length > 0);
  return list.length > 0 ? list : null;
}

function userMatchesNotifyType(
  role: string,
  permissions: UserPermissions,
  notifyTypes: string[] | null,
  notifyType: NotifyEventType,
): boolean {
  if (notifyTypes && !notifyTypes.includes(notifyType)) return false;

  if (notifyType === 'transfer_pending_projects') {
    return role === 'admin' || role === 'projects_manager';
  }
  if (notifyType === 'transfer_pending_b') {
    return (
      role === 'admin'
      || role === 'projects_manager'
      || hasReferenceRead(permissions, 'inventory')
    );
  }
  if (notifyType === 'mos_draft') {
    return (
      role === 'admin'
      || role === 'projects_manager'
      || hasReferenceRead(permissions, 'billing')
    );
  }
  if (notifyType === 'subcontractor_ipc_pending') {
    return role === 'admin' || role === 'projects_manager';
  }
  if (notifyType === 'custody_settlement_pending') {
    if (role === 'admin') return true;
    return hasReferenceRead(permissions, 'ledger') && hasModuleWrite(permissions, 'ledger');
  }
  if (notifyType === 'purchase_request_pending') {
    if (role === 'admin' || role === 'projects_manager' || role === 'project_accountant') {
      return true;
    }
    return moduleAccess(permissions, 'purchase_requests').edit;
  }
  return false;
}

function asReqUser(row: {
  id: string;
  email: string;
  role: string;
  permissions: unknown;
  assignedContractIds: unknown;
}): Express.Request['user'] {
  return {
    id: row.id,
    email: row.email,
    displayName: null,
    role: row.role,
    permissions: normalizeUserPermissions(row.permissions),
    assignedContractIds: Array.isArray(row.assignedContractIds)
      ? row.assignedContractIds.filter((id): id is string => typeof id === 'string')
      : [],
    isActive: true,
  };
}

async function userCanReceiveForContext(
  user: Express.Request['user'],
  ctx: RecipientContext,
): Promise<boolean> {
  const accessibleProjects = await getAccessibleProjectIds(prisma, user);
  const assigned = getAssignedContractIds(user);

  if (ctx.notifyType === 'transfer_pending_b' && ctx.toProjectId) {
    if (user.role === 'admin' || user.role === 'projects_manager') return true;
    if (accessibleProjects === null) return true;
    return accessibleProjects.includes(ctx.toProjectId);
  }

  if (ctx.notifyType === 'transfer_pending_projects') {
    if (user.role !== 'admin' && user.role !== 'projects_manager') return false;
    if (accessibleProjects === null) return true;
    const relevant =
      (ctx.fromProjectId && accessibleProjects.includes(ctx.fromProjectId))
      || (ctx.toProjectId && accessibleProjects.includes(ctx.toProjectId));
    return relevant;
  }

  if (ctx.notifyType === 'mos_draft' && ctx.contractId) {
    if (user.role === 'admin' || user.role === 'projects_manager') return true;
    if (assigned === null) return true;
    return assigned.includes(ctx.contractId);
  }

  if (ctx.notifyType === 'subcontractor_ipc_pending' && ctx.contractId) {
    if (user.role !== 'admin' && user.role !== 'projects_manager') return false;
    if (assigned === null) return true;
    return assigned.includes(ctx.contractId);
  }

  if (ctx.notifyType === 'custody_settlement_pending' && ctx.projectId) {
    if (!canApproveCustodySettlementUser(user)) return false;
    if (accessibleProjects === null) return true;
    return accessibleProjects.includes(ctx.projectId);
  }

  if (ctx.notifyType === 'purchase_request_pending') {
    // Purchasing managers receive all open requests (company-wide).
    return true;
  }

  return true;
}

function canApproveCustodySettlementUser(user: Express.Request['user']): boolean {
  if (user.role === 'admin') return true;
  return hasModuleWrite(user.permissions, 'ledger');
}

export async function resolveWhatsAppRecipients(ctx: RecipientContext): Promise<WhatsAppRecipient[]> {
  const rows = await prisma.user.findMany({
    where: {
      isActive: true,
      whatsappOptIn: true,
      phoneE164: { not: null },
    },
    select: {
      id: true,
      email: true,
      role: true,
      permissions: true,
      assignedContractIds: true,
      phoneE164: true,
      preferredLanguage: true,
      whatsappNotifyTypes: true,
    },
  });

  const out: WhatsAppRecipient[] = [];

  for (const row of rows) {
    if (ctx.excludeUserId && row.id === ctx.excludeUserId) continue;
    const phone = String(row.phoneE164 || '').trim();
    if (!phone) continue;

    const permissions = normalizeUserPermissions(row.permissions);
    const role = row.role as UserRole;
    const notifyTypes = parseNotifyTypes(row.whatsappNotifyTypes);

    if (!userMatchesNotifyType(role, permissions, notifyTypes, ctx.notifyType)) continue;

    const reqUser = asReqUser(row);
    if (!(await userCanReceiveForContext(reqUser, ctx))) continue;

    out.push({
      id: row.id,
      phoneE164: phone,
      preferredLanguage: row.preferredLanguage === 'en' ? 'en' : 'ar',
    });
  }

  return out;
}
