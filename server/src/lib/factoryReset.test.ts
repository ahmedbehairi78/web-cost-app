import { describe, expect, it } from 'vitest';
import { POSTGRES_BACKUP_COLLECTIONS } from '../migration/backupCollections.js';
import {
  DEFAULT_FACTORY_KEEP_ADMIN_EMAIL,
  FACTORY_RESET_EXTRA_TABLES,
  FACTORY_RESET_TABLES,
  buildFactoryTruncateSql,
  emailsToKeepForFactoryReset,
  normalizeEmail,
} from './factoryReset.js';

describe('factory reset helpers', () => {
  it('normalizes emails', () => {
    expect(normalizeEmail('  MyLine78@Gmail.com ')).toBe('myline78@gmail.com');
  });

  it('keeps configured admin and the actor', () => {
    expect(emailsToKeepForFactoryReset('myline78@gmail.com').sort()).toEqual([
      DEFAULT_FACTORY_KEEP_ADMIN_EMAIL,
    ]);
    expect(emailsToKeepForFactoryReset('other@example.com').sort()).toEqual([
      DEFAULT_FACTORY_KEEP_ADMIN_EMAIL,
      'other@example.com',
    ]);
  });

  it('truncates leftover master tables the group wipe skipped', () => {
    for (const table of [
      'projects',
      'contracts',
      'boq_items',
      'material_groups',
      'material_categories',
      'bank_accounts',
      'purchase_requests',
      'warehouse_receipts',
      'warehouse_receipt_lines',
      'notification_outbox',
      'user_notification_reads',
      'settings',
      'users',
    ]) {
      expect(FACTORY_RESET_TABLES).toContain(table);
    }
    for (const extra of FACTORY_RESET_EXTRA_TABLES) {
      expect(FACTORY_RESET_TABLES).toContain(extra);
    }
    for (const key of POSTGRES_BACKUP_COLLECTIONS) {
      expect(FACTORY_RESET_TABLES).toContain(key);
    }
    expect(FACTORY_RESET_TABLES).not.toContain('_prisma_migrations');
  });

  it('builds a quoted TRUNCATE for all factory tables', () => {
    const sql = buildFactoryTruncateSql();
    expect(sql.startsWith('TRUNCATE TABLE ')).toBe(true);
    expect(sql).toContain('"purchase_requests"');
    expect(sql).toContain('"bank_accounts"');
    expect(sql).toContain('"sessions"');
    expect(sql.endsWith('RESTART IDENTITY CASCADE')).toBe(true);
  });
});
