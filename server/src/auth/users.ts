import { prisma } from '../db.js';
import {
  normalizeUserPermissions,
  resolvePermissionsFromUserData,
  type UserPermissions,
} from '../permissions.js';

export type DbUser = {
  id: string;
  email: string;
  displayName: string | null;
  passwordHash: string;
  role: string;
  permissions: UserPermissions;
  assignedContractIds: string[];
  phoneE164: string | null;
  whatsappOptIn: boolean;
  preferredLanguage: string;
  whatsappNotifyTypes: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function parseAssignedContractIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((id): id is string => typeof id === 'string');
  }
  return [];
}

function parseWhatsappNotifyTypes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

function mapUser(row: {
  id: string;
  email: string;
  displayName: string | null;
  passwordHash: string;
  role: string;
  permissions: unknown;
  assignedContractIds?: unknown;
  phoneE164?: string | null;
  whatsappOptIn?: boolean;
  preferredLanguage?: string;
  whatsappNotifyTypes?: unknown;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): DbUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    passwordHash: row.passwordHash,
    role: row.role,
    permissions: normalizeUserPermissions(row.permissions),
    assignedContractIds: parseAssignedContractIds(row.assignedContractIds),
    phoneE164: row.phoneE164 ?? null,
    whatsappOptIn: row.whatsappOptIn === true,
    preferredLanguage: row.preferredLanguage === 'en' ? 'en' : 'ar',
    whatsappNotifyTypes: parseWhatsappNotifyTypes(row.whatsappNotifyTypes),
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function findUserByEmailInsensitive(email: string): Promise<DbUser | null> {
  const clean = email.trim().toLowerCase();
  const row = await prisma.user.findFirst({
    where: { email: { equals: clean, mode: 'insensitive' } },
  });
  return row ? mapUser(row) : null;
}

export async function findUserByEmail(email: string): Promise<DbUser | null> {
  const row = await prisma.user.findUnique({ where: { email } });
  return row ? mapUser(row) : null;
}

export async function findUserById(id: string): Promise<DbUser | null> {
  const row = await prisma.user.findUnique({ where: { id } });
  return row ? mapUser(row) : null;
}

export async function listActiveUsers(): Promise<DbUser[]> {
  const rows = await prisma.user.findMany({
    where: { isActive: true },
    orderBy: { email: 'asc' },
  });
  return rows.map(mapUser);
}

export async function createUser(data: {
  id: string;
  email: string;
  displayName?: string | null;
  passwordHash: string;
  role: string;
  permissions: UserPermissions;
  assignedContractIds?: string[];
}): Promise<DbUser> {
  const row = await prisma.user.create({
    data: {
      id: data.id,
      email: data.email,
      displayName: data.displayName ?? null,
      passwordHash: data.passwordHash,
      role: data.role,
      permissions: data.permissions,
      assignedContractIds: data.assignedContractIds ?? [],
    },
  });
  return mapUser(row);
}

export async function updateUserById(
  id: string,
  data: {
    email?: string;
    displayName?: string | null;
    role?: string;
    permissions?: UserPermissions;
    assignedContractIds?: string[];
    phoneE164?: string | null;
    whatsappOptIn?: boolean;
    preferredLanguage?: string;
    whatsappNotifyTypes?: string[];
    isActive?: boolean;
    passwordHash?: string;
  },
): Promise<DbUser | null> {
  try {
    const row = await prisma.user.update({
      where: { id },
      data: {
        email: data.email,
        displayName: data.displayName,
        role: data.role,
        permissions: data.permissions,
        assignedContractIds: data.assignedContractIds,
        phoneE164: data.phoneE164,
        whatsappOptIn: data.whatsappOptIn,
        preferredLanguage: data.preferredLanguage,
        whatsappNotifyTypes: data.whatsappNotifyTypes,
        isActive: data.isActive,
        passwordHash: data.passwordHash,
      },
    });
    return mapUser(row);
  } catch {
    return null;
  }
}

export async function updateUserContact(
  id: string,
  data: {
    phoneE164?: string | null;
    whatsappOptIn?: boolean;
    preferredLanguage?: string;
  },
): Promise<DbUser | null> {
  const patch: Parameters<typeof updateUserById>[1] = {};
  if (data.phoneE164 !== undefined) patch.phoneE164 = data.phoneE164;
  if (data.whatsappOptIn !== undefined) patch.whatsappOptIn = data.whatsappOptIn;
  if (data.preferredLanguage !== undefined) {
    patch.preferredLanguage = data.preferredLanguage === 'en' ? 'en' : 'ar';
  }
  return updateUserById(id, patch);
}
