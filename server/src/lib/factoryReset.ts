import { Prisma } from '@prisma/client';
import { bootstrapCoaIfEmpty } from '../accounting/ensureCoaSeed.js';
import { bootstrapFixedAssetGroupsIfEmpty } from '../accounting/fixedAssetGlSync.js';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { POSTGRES_BACKUP_COLLECTIONS } from '../migration/backupCollections.js';
import { ALL_PERMISSIONS } from '../permissions.js';

/** Default admin kept after factory reset (override with FACTORY_KEEP_ADMIN_EMAIL). */
export const DEFAULT_FACTORY_KEEP_ADMIN_EMAIL = 'myline78@gmail.com';

/** Runtime tables that are not in the backup export list but must be emptied. */
export const FACTORY_RESET_EXTRA_TABLES = ['sessions', 'idempotency_keys'] as const;

export const FACTORY_RESET_TABLES: readonly string[] = [
  ...new Set<string>([...POSTGRES_BACKUP_COLLECTIONS, ...FACTORY_RESET_EXTRA_TABLES]),
];

const TABLE_NAME_RE = /^[a-z][a-z0-9_]*$/;

export class FactoryResetError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode = 409) {
    super(message);
    this.name = 'FactoryResetError';
    this.statusCode = statusCode;
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function factoryKeepAdminEmail(): string {
  return normalizeEmail(env.factoryKeepAdminEmail || DEFAULT_FACTORY_KEEP_ADMIN_EMAIL);
}

/** Keep the configured admin plus the actor so a settings user cannot lock themselves out. */
export function emailsToKeepForFactoryReset(actorEmail?: string | null): string[] {
  const set = new Set<string>();
  const keep = factoryKeepAdminEmail();
  if (keep) set.add(keep);
  const actor = actorEmail ? normalizeEmail(actorEmail) : '';
  if (actor) set.add(actor);
  return [...set];
}

export function buildFactoryTruncateSql(tables: readonly string[] = FACTORY_RESET_TABLES): string {
  const quoted = tables.map((name) => {
    if (!TABLE_NAME_RE.test(name)) {
      throw new FactoryResetError(`Invalid table name for factory reset: ${name}`, 500);
    }
    return `"${name}"`;
  });
  return `TRUNCATE TABLE ${quoted.join(', ')} RESTART IDENTITY CASCADE`;
}

type UserSnapshot = {
  id: string;
  email: string;
  displayName: string | null;
  passwordHash: string;
  role: string;
  permissions: Prisma.InputJsonValue;
  phoneE164: string | null;
  whatsappOptIn: boolean;
  preferredLanguage: string;
  whatsappNotifyTypes: Prisma.InputJsonValue;
  isActive: boolean;
  createdAt: Date;
};

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export async function factoryResetPostgres(options: {
  actorEmail?: string | null;
}): Promise<{
  keptEmails: string[];
  tablesTruncated: number;
  coaAdded: number;
}> {
  const keepEmails = emailsToKeepForFactoryReset(options.actorEmail);
  const keepAdmin = factoryKeepAdminEmail();

  const allUsers = await prisma.user.findMany();
  const toRestore = allUsers.filter((u) => keepEmails.includes(normalizeEmail(u.email)));
  if (toRestore.length === 0) {
    throw new FactoryResetError(
      'لا يوجد حساب للإبقاء عليه بعد الضبط الافتراضي. سجّل الدخول بحساب له صلاحية الإعدادات ثم أعد المحاولة.',
    );
  }

  const snapshots: UserSnapshot[] = toRestore.map((u) => {
    const isKeepAdmin = normalizeEmail(u.email) === keepAdmin;
    const onlyActorWithoutKeepAdmin =
      !allUsers.some((row) => normalizeEmail(row.email) === keepAdmin) &&
      normalizeEmail(u.email) === normalizeEmail(options.actorEmail ?? '');
    const grantFullAccess = isKeepAdmin || onlyActorWithoutKeepAdmin;
    return {
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      passwordHash: u.passwordHash,
      role: grantFullAccess ? 'admin' : u.role,
      permissions: grantFullAccess ? asJson(ALL_PERMISSIONS) : asJson(u.permissions),
      phoneE164: u.phoneE164,
      whatsappOptIn: u.whatsappOptIn,
      preferredLanguage: u.preferredLanguage,
      whatsappNotifyTypes: asJson(u.whatsappNotifyTypes),
      isActive: true,
      createdAt: u.createdAt,
    };
  });

  const sql = buildFactoryTruncateSql();
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(sql);
      for (const snap of snapshots) {
        await tx.user.create({
          data: {
            id: snap.id,
            email: snap.email,
            displayName: snap.displayName,
            passwordHash: snap.passwordHash,
            role: snap.role,
            permissions: snap.permissions,
            assignedContractIds: [],
            phoneE164: snap.phoneE164,
            whatsappOptIn: snap.whatsappOptIn,
            preferredLanguage: snap.preferredLanguage,
            whatsappNotifyTypes: snap.whatsappNotifyTypes,
            isActive: snap.isActive,
            createdAt: snap.createdAt,
          },
        });
      }
    },
    { maxWait: 15_000, timeout: 180_000 },
  );

  const coa = await bootstrapCoaIfEmpty();
  await bootstrapFixedAssetGroupsIfEmpty();

  return {
    keptEmails: snapshots.map((s) => normalizeEmail(s.email)).sort(),
    tablesTruncated: FACTORY_RESET_TABLES.length,
    coaAdded: coa.added,
  };
}
