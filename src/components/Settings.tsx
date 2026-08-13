import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useErpModuleView } from '../hooks/useErpModuleView';
import {
  Database,
  Users,
  Save,
  FileText,
  CheckCircle2,
  Loader2,
  UserPlus,
  Pencil,
  Trash2,
  X,
  Shield,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Download,
  Upload,
  HardDrive,
  RefreshCw,
  FolderOpen,
  ScrollText,
  Building2,
  MessageCircle,
  FolderTree,
  LayoutDashboard,
  BookOpen,
  HardHat,
  Receipt,
  Package,
  ShoppingCart,
  Landmark,
  BarChart3,
  Settings as SettingsIcon,
  TrendingUp,
  ChevronRight,
  Eye,
  Plus,
  PenLine,
  FlaskConical,
  RotateCcw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { IndirectCostCentersPanel } from './settings/IndirectCostCentersPanel';
import { SampleDataGeneratorPanel } from './settings/SampleDataGeneratorPanel';
import { PushToProductionPanel } from './settings/PushToProductionPanel';
import { BackfillBoqRatesPanel } from './settings/BackfillBoqRatesPanel';
import { ChartOfAccountsSettingsPanel } from './settings/ChartOfAccountsSettingsPanel';
import { ManualHelpButton } from './help/ManualHelpButton';
import type { ManualTopicId } from '../lib/operationsManual';
import {
  collection,
  doc,
  getDoc,
  updateDoc,
  setDoc,
  deleteDoc,
  getDocs,
  writeBatch,
  query,
  limit,
  Timestamp,
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { listenQuery } from '../lib/firestoreListen';
import { cn, listKey, compositeListKey } from '../lib/utils';
import { businessTodayYmd } from '../lib/businessCalendar';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../context/LanguageContext';
import {
  type UserPermissions,
  ALL_PERMISSIONS,
  BOOLEAN_MODULES,
  CRUD_MODULES,
  type AppUser,
  DEFAULT_PERMISSIONS,
  type CrudModuleKey,
  type UserRole,
  type PermissionKey,
} from '../types';
import { DEFAULT_MODULE, MODULE_LABELS } from '../constants/modules';
import { ActivityLogPanel } from './ActivityLogPanel';
import { AdminSensitiveVerifyModal } from './AdminSensitiveVerifyModal';
import { financialMaintenanceApi, settingsApi, contractsApi } from '../services/local/modulesApi';
import { useApiQuery } from '../hooks/useApiQuery';
import { crudOff, crudOn, moduleAccess, normalizeUserPermissions } from '../lib/permissions';
import { PERMISSION_MENU_HINTS } from '../lib/moduleViewPermissions';
import { usePermissions } from '../context/PermissionsContext';
import { isLocalBackend } from '../lib/dataBackend';
import { FIRESTORE_BACKUP_COLLECTIONS, POSTGRES_BACKUP_COLLECTIONS } from '../constants/backupCollections';
import { isAppTheme, isSoftLikeTheme } from '../lib/shellTheme';
import { consumePendingShellView } from '../lib/shellNavigation';
import { authApi } from '../services/local/authApi';
import { performAppLogout } from '../lib/sessionLogout';
import { labelBackupImportSkip } from '../lib/backupImportSkipLabels';
import {
  isFullVisibleShellModulesWhitelist,
  normalizeVisibleShellModules,
  VISIBLE_SHELL_MODULE_IDS,
  type VisibleShellModuleId,
} from '../lib/shellModuleVisibility';
import { emitUserPrefsUpdated } from '../lib/userPreferences';
import {
  type BackupImportResultSummary,
  clearLastBackupImportReport,
  readLastBackupImportReport,
  saveLastBackupImportReport,
  sortedBackupImportCounts,
  sortedBackupImportSkipped,
  totalBackupImportSkipped,
} from '../lib/backupImportReport';
import {
  clearApiUnauthorizedLogoutSuppress,
  suppressApiUnauthorizedLogout,
} from '../lib/apiSession';
import { ApiError } from '../lib/apiClient';
import { SettingsFloatingDialog } from './settings/SettingsFloatingDialog';
import { clearAllOfflineClientData } from '../lib/offline';
import { isFactoryResetConfirmWord } from '../lib/factoryResetConfirm';

const firebaseConfig = {
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
  firestoreDatabaseId: import.meta.env.VITE_FIREBASE_DATABASE_ID as string,
};

// ─── Clear Data ────────────────────────────────────────────────────────────────

export type PostgresWipeKey =
  | 'financial'
  | 'warehouse'
  | 'custody'
  | 'payroll'
  | 'fixed_assets'
  | 'materials_tree'
  | 'subcontractors'
  | 'mos_vo'
  | 'billing'
  | 'purchases'
  | 'ledger'
  | 'projects'
  | 'contracts_boq'
  | 'coa'
  | 'suppliers'
  | 'cost_centers_indirect';

export type ClearDataGroup = {
  id: string;
  ar: string;
  en: string;
  backend: 'firestore' | 'postgres';
  collections: readonly string[];
  postgresWipe?: PostgresWipeKey;
  warning: { ar: string; en: string };
};

export const CLEAR_DATA_GROUPS: ClearDataGroup[] = [
  // ── Firestore (cloud legacy) ──
  {
    id: 'projects',
    backend: 'firestore',
    ar: 'المشاريع',
    en: 'Projects',
    collections: ['projects'],
    warning: { ar: 'يشمل جميع بيانات المشاريع الأساسية', en: 'Includes all core project records' },
  },
  {
    id: 'contracts',
    backend: 'firestore',
    ar: 'العقود وبنود الكميات',
    en: 'Contracts & BOQ',
    collections: ['contracts', 'boq_items'],
    warning: { ar: 'يشمل جميع العقود وبنود الكميات', en: 'Includes all contracts and BOQ items' },
  },
  {
    id: 'billing',
    backend: 'firestore',
    ar: 'المستخلصات',
    en: 'Billing / IPCs',
    collections: ['billing'],
    warning: { ar: 'يشمل جميع مستخلصات العملاء', en: 'Includes all client billing records' },
  },
  {
    id: 'actual_costs',
    backend: 'firestore',
    ar: 'التكاليف الفعلية',
    en: 'Actual Costs',
    collections: ['actual_costs'],
    warning: { ar: 'يشمل جميع سجلات التكاليف الفعلية', en: 'Includes all actual cost records' },
  },
  {
    id: 'purchases',
    backend: 'firestore',
    ar: 'المشتريات والموردين',
    en: 'Purchases & Suppliers',
    collections: ['purchase_transactions', 'suppliers'],
    warning: { ar: 'يشمل فواتير الموردين وبيانات الموردين', en: 'Includes supplier invoices and supplier records' },
  },
  {
    id: 'ledger_journals',
    backend: 'firestore',
    ar: 'القيود اليومية والبنك (عمليات مرحّلة)',
    en: 'GL journals & bank postings',
    collections: [
      'bank_statement_lines',
      'bank_statements',
      'bank_cheques',
      'bank_movements',
      'transactions',
    ],
    warning: {
      ar: 'يمسح جميع قيود الأستاذ العام وحركات البنوك والشيكات وأسطر الكشوف. لا يمسح دليل الحسابات ولا الحسابات البنكية المسجّلة.',
      en: 'Deletes all GL journals, bank movements, cheques, statement lines. Keeps chart of accounts and bank account master rows.',
    },
  },
  {
    id: 'coa',
    backend: 'firestore',
    ar: 'دليل الحسابات',
    en: 'Chart of Accounts',
    collections: ['chart_of_accounts'],
    warning: { ar: 'يمسح الشجرة المحاسبية بالكامل', en: 'Wipes the entire account tree' },
  },
  // ── PostgreSQL (local / Railway) ──
  {
    id: 'financial_postgres',
    backend: 'postgres',
    postgresWipe: 'financial',
    ar: 'الحركات المالية والتشغيلية',
    en: 'Financial & operational movements',
    collections: [
      'transactions', 'journal_entries', 'billing', 'purchase_transactions',
      'bank_movements', 'bank_cheques', 'custody_settlements', 'project_inventory',
      'consumption_orders', 'overhead_allocation_periods', 'boq_actual_costs',
    ],
    warning: {
      ar: 'PostgreSQL — يمسح GL · مستخلصات · مشتريات · بنوك · مخازن · OHA · تسوية عهدة · MOS · VO · إهلاك. يُبقي المشاريع · BOQ · COA · المستخدمين · شجرة الأصناف · الرواتب (ما لم تُحدَّد).',
      en: 'PostgreSQL — wipes GL, billing, purchases, banks, warehouse, OHA, custody, MOS/VO extracts, depreciation. Keeps projects, BOQ, COA, users, materials tree, payroll unless selected.',
    },
  },
  {
    id: 'warehouse_movements',
    backend: 'postgres',
    postgresWipe: 'warehouse',
    ar: 'حركات وأوامر المخازن',
    en: 'Warehouse movements & orders',
    collections: [
      'consumption_orders', 'return_orders', 'project_inventory', 'purchase_invoices',
    ],
    warning: {
      ar: 'يصفّر أرصدة المخزن وأوامر الصرف/الإرجاع/التحويل. لا يمس شجرة الأصناف ولا حسابات 127.',
      en: 'Clears warehouse balances and consumption/return/transfer orders. Keeps materials tree and 127 accounts.',
    },
  },
  {
    id: 'custody_postgres',
    backend: 'postgres',
    postgresWipe: 'custody',
    ar: 'تسويات العهدة',
    en: 'Custody settlements',
    collections: ['custody_settlements', 'custody_settlement_items'],
    warning: {
      ar: 'يمسح كل تسويات العهدة (draft/submitted/approved). لا يمسح قيود GL المرحّلة — استخدم «الحركات المالية».',
      en: 'Deletes all custody settlement records. Does not reverse posted GL — use Financial movements.',
    },
  },
  {
    id: 'payroll_postgres',
    backend: 'postgres',
    postgresWipe: 'payroll',
    ar: 'الرواتب والحضور والإجازات',
    en: 'Payroll, attendance & leave',
    collections: [
      'payroll_employees', 'payroll_runs', 'payroll_run_lines', 'attendance_imports', 'leave_types',
    ],
    warning: {
      ar: 'يمسح الموظفين · كشوف الرواتب · الحضور · أنواع الإجازات · الأعياد الرسمية.',
      en: 'Wipes employees, payroll runs, attendance imports, leave types, and official holidays.',
    },
  },
  {
    id: 'fixed_assets_postgres',
    backend: 'postgres',
    postgresWipe: 'fixed_assets',
    ar: 'الأصول الثابتة',
    en: 'Fixed assets',
    collections: ['fixed_assets', 'fixed_asset_groups', 'fixed_asset_depreciation_entries'],
    warning: {
      ar: 'يمسح سجل الأصول والمجموعات وقيود الإهلاك المرحّلة.',
      en: 'Deletes asset register, groups, and posted depreciation entries.',
    },
  },
  {
    id: 'materials_tree_postgres',
    backend: 'postgres',
    postgresWipe: 'materials_tree',
    ar: 'شجرة الأصناف',
    en: 'Materials tree',
    collections: ['material_groups', 'material_categories', 'boq_item_materials'],
    warning: {
      ar: 'يمسح مجموعات/أصناف المواد وربط BOQ. لا يمس أرصدة المخزن — استخدم «المخازن».',
      en: 'Wipes material groups/categories and BOQ links. Does not clear warehouse balances.',
    },
  },
  {
    id: 'subcontractors_postgres',
    backend: 'postgres',
    postgresWipe: 'subcontractors',
    ar: 'مقاولو الباطن',
    en: 'Subcontractors',
    collections: ['subcontractors', 'subcontract_assignments', 'subcontract_extracts'],
    warning: {
      ar: 'يمسح دليل مقاولي الباطن والتكليفات والمستخلصات.',
      en: 'Deletes subcontractor directory, assignments, and extracts.',
    },
  },
  {
    id: 'mos_vo_postgres',
    backend: 'postgres',
    postgresWipe: 'mos_vo',
    ar: 'تشوينات · أوامر VO · سجل المستندات',
    en: 'MOS · VO · document registry',
    collections: ['mos_certificates', 'variation_orders', 'document_registry', 'material_on_site_extracts'],
    warning: {
      ar: 'يمسح شهادات MOS · أوامر التغيير · سجل المستندات · مستخلصات التشوين.',
      en: 'Wipes MOS certificates, variation orders, document registry, and MOS extracts.',
    },
  },
  {
    id: 'billing_postgres',
    backend: 'postgres',
    postgresWipe: 'billing',
    ar: 'المستخلصات فقط',
    en: 'Billing / IPCs only',
    collections: ['billing', 'billing_items'],
    warning: {
      ar: 'يمسح مستخلصات العملاء فقط. قد تبقى قيود GL — استخدم «الحركات المالية» للمزامنة الكاملة.',
      en: 'Deletes client billing rows only. GL journals may remain — use Financial movements for full sync.',
    },
  },
  {
    id: 'purchases_postgres',
    backend: 'postgres',
    postgresWipe: 'purchases',
    ar: 'المشتريات والفواتير',
    en: 'Purchases & invoices',
    collections: ['purchase_transactions', 'purchase_invoices'],
    warning: {
      ar: 'يمسح فواتير المشتريات ومستخلصات الموردين (بدون دليل الموردين).',
      en: 'Deletes purchase invoices and supplier IPC headers (not supplier master).',
    },
  },
  {
    id: 'ledger_postgres',
    backend: 'postgres',
    postgresWipe: 'ledger',
    ar: 'قيود GL والبنك فقط',
    en: 'GL & bank postings only',
    collections: ['transactions', 'journal_entries', 'bank_movements', 'bank_cheques'],
    warning: {
      ar: 'يمسح القيود وحركات/شيكات البنك. يُبقي حسابات البنك في COA.',
      en: 'Deletes journals and bank movements/cheques. Keeps bank account master rows.',
    },
  },
  {
    id: 'contracts_boq_postgres',
    backend: 'postgres',
    postgresWipe: 'contracts_boq',
    ar: 'العقود وبنود BOQ',
    en: 'Contracts & BOQ',
    collections: ['contracts', 'boq_items', 'boq_item_materials'],
    warning: {
      ar: 'يمسح العقود وبنود الكميات. قد يفشل إن وُجدت حركات مرتبطة — نفّذ «الحركات المالية» أولاً.',
      en: 'Deletes contracts and BOQ items. May fail if operational rows exist — run Financial movements first.',
    },
  },
  {
    id: 'projects_postgres',
    backend: 'postgres',
    postgresWipe: 'projects',
    ar: 'المشاريع (مع العقود وBOQ)',
    en: 'Projects (incl. contracts & BOQ)',
    collections: ['projects', 'contracts', 'boq_items', 'variation_orders'],
    warning: {
      ar: 'يمسح المشاريع والعقود وBOQ وVO. نفّذ «الحركات المالية» أولاً إن وُجدت بيانات تشغيلية.',
      en: 'Deletes projects, contracts, BOQ, and VO. Run Financial movements first if operational data exists.',
    },
  },
  {
    id: 'suppliers_postgres',
    backend: 'postgres',
    postgresWipe: 'suppliers',
    ar: 'دليل الموردين',
    en: 'Suppliers directory',
    collections: ['suppliers'],
    warning: {
      ar: 'يمسح سجل الموردين. لا يمس فواتير المشتريات — استخدم «المشتريات» أو «الحركات المالية».',
      en: 'Deletes supplier master records. Does not remove purchase invoices.',
    },
  },
  {
    id: 'coa_postgres',
    backend: 'postgres',
    postgresWipe: 'coa',
    ar: 'دليل الحسابات',
    en: 'Chart of Accounts',
    collections: ['chart_of_accounts'],
    warning: { ar: 'يمسح الشجرة المحاسبية بالكامل في Postgres', en: 'Wipes the entire COA tree in Postgres' },
  },
  {
    id: 'cost_centers_indirect',
    backend: 'postgres',
    postgresWipe: 'cost_centers_indirect',
    ar: 'مراكز التكلفة غير المباشرة',
    en: 'Indirect cost centers',
    collections: ['cost_centers'],
    warning: {
      ar: 'يمسح مراكز HO والخدمات فقط — لا يمس مراكز العقود المباشرة.',
      en: 'Deletes indirect/service centers only — keeps contract-linked direct centers.',
    },
  },
];

export function clearDataGroupsForBackend(isLocalBackend: boolean) {
  return CLEAR_DATA_GROUPS.filter((g) =>
    g.backend === 'postgres' ? isLocalBackend : !isLocalBackend,
  );
}

async function batchDeleteCollection(collectionName: string): Promise<number> {
  let totalDeleted = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = await getDocs(query(collection(db, collectionName), limit(400)));
    if (snap.empty) break;
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    totalDeleted += snap.docs.length;
  }
  return totalDeleted;
}

// ─── Backup / Restore ──────────────────────────────────────────────────────────

function backupCollectionsForBackend() {
  return isLocalBackend ? POSTGRES_BACKUP_COLLECTIONS : FIRESTORE_BACKUP_COLLECTIONS;
}

// Recursively serialise Firestore Timestamps to a tagged object so they
// survive JSON round-trip.
function serialiseValue(v: unknown): unknown {
  if (v instanceof Timestamp) return { _fsTimestamp: true, s: v.seconds, ns: v.nanoseconds };
  if (Array.isArray(v)) return v.map(serialiseValue);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, serialiseValue(val)]));
  }
  return v;
}

function deserialiseValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(deserialiseValue);
  if (v !== null && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (obj._fsTimestamp === true) return new Timestamp(obj.s as number, obj.ns as number);
    return Object.fromEntries(Object.entries(obj).map(([k, val]) => [k, deserialiseValue(val)]));
  }
  return v;
}

async function exportBackup(onProgress: (msg: string) => void): Promise<void> {
  const data: Record<string, unknown[]> = {};
  for (const col of FIRESTORE_BACKUP_COLLECTIONS) {
    onProgress(col);
    const snap = await getDocs(collection(db, col));
    data[col] = snap.docs.map((d) => ({ _id: d.id, ...serialiseValue(d.data()) as object }));
  }
  const payload = JSON.stringify({ exportedAt: new Date().toISOString(), version: 1, collections: data }, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = businessTodayYmd();
  a.href = url;
  a.download = `backup_${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

type RestoreMode = 'merge' | 'replace';

async function importBackup(
  file: File,
  mode: RestoreMode,
  onProgress: (msg: string) => void
): Promise<{ collections: number; records: number }> {
  const text = await file.text();
  const payload = JSON.parse(text) as { version: number; collections: Record<string, Array<{ _id: string } & Record<string, unknown>>> };
  if (!payload.collections) throw new Error('Invalid backup file');

  let totalRecords = 0;
  let totalCollections = 0;

  for (const [colName, docs] of Object.entries(payload.collections)) {
    onProgress(colName);
    if (mode === 'replace') await batchDeleteCollection(colName);

    // write in chunks of 400
    for (let i = 0; i < docs.length; i += 400) {
      const chunk = docs.slice(i, i + 400);
      const batch = writeBatch(db);
      for (const raw of chunk) {
        const { _id, ...fields } = raw;
        const restored = deserialiseValue(fields) as Record<string, unknown>;
        batch.set(doc(db, colName, _id), restored, mode === 'merge' ? { merge: true } : {});
      }
      await batch.commit();
    }
    totalRecords += docs.length;
    totalCollections++;
  }
  return { collections: totalCollections, records: totalRecords };
}

function BackupImportReportPanel({
  summary,
  language,
  theme,
  onDismiss,
}: {
  summary: BackupImportResultSummary;
  language: 'ar' | 'en';
  theme: string;
  onDismiss?: () => void;
}) {
  const skippedRows = sortedBackupImportSkipped(summary.skipped);
  const skippedTotal = totalBackupImportSkipped(summary.skipped);
  const countRows = sortedBackupImportCounts(summary.counts);

  const panelCls = cn(
    'rounded-xl border p-3 space-y-3 text-sm',
    theme === 'dark' ? 'bg-amber-950/20 border-amber-900/40' : 'bg-amber-50 border-amber-200',
  );

  return (
    <div className={panelCls}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-bold text-amber-600 dark:text-amber-400">
            {language === 'ar' ? 'تقرير الاسترجاع' : 'Restore report'}
          </p>
          <p className={cn('text-xs mt-0.5', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>
            {language === 'ar'
              ? `${summary.recordsProcessed} سجل مسترجَع · ${summary.collectionsProcessed} مجموعة · تخطّي ${skippedTotal}${summary.mode === 'replace' ? ' · استبدال كامل' : ' · دمج'}`
              : `${summary.recordsProcessed} restored · ${summary.collectionsProcessed} collections · skipped ${skippedTotal}${summary.mode === 'replace' ? ' · replace' : ' · merge'}`}
          </p>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className={cn('text-xs px-2 py-1 rounded-lg shrink-0', theme === 'dark' ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-amber-100 text-gray-600')}
          >
            {language === 'ar' ? 'إخفاء' : 'Dismiss'}
          </button>
        )}
      </div>

      {countRows.length > 0 && (
        <div>
          <p className={cn('text-xs font-bold mb-1', theme === 'dark' ? 'text-gray-300' : 'text-gray-700')}>
            {language === 'ar' ? 'ما تم استرجاعه (حسب المجموعة)' : 'Restored by collection'}
          </p>
          <div className="max-h-36 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>
                  <th className={cn('py-1 font-bold', language === 'ar' ? 'text-right' : 'text-left')}>
                    {language === 'ar' ? 'المجموعة' : 'Collection'}
                  </th>
                  <th className="py-1 font-bold w-16 text-center">{language === 'ar' ? 'العدد' : 'Count'}</th>
                </tr>
              </thead>
              <tbody>
                {countRows.map((row, i) => (
                  <tr
                    key={listKey(row.key, i, 'backup-count')}
                    className={theme === 'dark' ? 'border-t border-gray-800' : 'border-t border-amber-100'}
                  >
                    <td className={cn('py-1 pe-2 font-mono', language === 'ar' ? 'text-right' : 'text-left')}>{row.key}</td>
                    <td className="py-1 text-center font-mono font-bold">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {skippedRows.length > 0 ? (
        <div>
          <p className="text-xs font-bold mb-1 text-amber-600 dark:text-amber-400">
            {language === 'ar' ? `تفاصيل التخطّي (${skippedTotal})` : `Skip details (${skippedTotal})`}
          </p>
          <div className="max-h-48 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>
                  <th className={cn('py-1 font-bold', language === 'ar' ? 'text-right' : 'text-left')}>
                    {language === 'ar' ? 'السبب' : 'Reason'}
                  </th>
                  <th className="py-1 font-bold w-16 text-center">{language === 'ar' ? 'العدد' : 'Count'}</th>
                </tr>
              </thead>
              <tbody>
                {skippedRows.map((row, i) => (
                  <tr
                    key={listKey(row.key, i, 'backup-skip')}
                    className={theme === 'dark' ? 'border-t border-gray-800' : 'border-t border-amber-100'}
                  >
                    <td className={cn('py-1.5 pe-2', language === 'ar' ? 'text-right' : 'text-left')}>
                      {labelBackupImportSkip(row.key, language)}
                      <span className={cn('block font-mono text-[10px] opacity-60', language === 'ar' ? 'text-left' : 'text-right')}>
                        {row.key}
                      </span>
                    </td>
                    <td className="py-1.5 text-center font-mono font-bold">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className={cn('text-xs', theme === 'dark' ? 'text-gray-500' : 'text-gray-600')}>
          {language === 'ar' ? 'لا توجد سجلات متخطّاة.' : 'No skipped records.'}
        </p>
      )}

      {summary.unbalancedIds.length > 0 && (
        <div className={cn('text-xs rounded-lg p-2', theme === 'dark' ? 'bg-gray-900/60' : 'bg-white/80')}>
          <p className="font-bold text-red-500 mb-1">
            {language === 'ar'
              ? `قيود GL غير متوازنة (${summary.unbalancedIds.length})`
              : `Unbalanced GL entries (${summary.unbalancedIds.length})`}
          </p>
          <p className="font-mono break-all opacity-80">
            {summary.unbalancedIds.slice(0, 8).join(' · ')}
            {summary.unbalancedIds.length > 8
              ? (language === 'ar' ? ` … +${summary.unbalancedIds.length - 8}` : ` … +${summary.unbalancedIds.length - 8}`)
              : ''}
          </p>
        </div>
      )}

      <p className={cn('text-xs', theme === 'dark' ? 'text-gray-500' : 'text-gray-600')}>
        {language === 'ar'
          ? 'التخطّي لا يعني فشل الاستيراد — غالباً مراجع ناقصة أو قيود غير متوازنة في ملف النسخة. يُحفظ هذا التقرير في الجلسة بعد تسجيل الدخول.'
          : 'Skipped rows do not fail the import — usually missing references or unbalanced entries. This report is kept in the browser session after sign-in.'}
      </p>
    </div>
  );
}

// ─── Backup / Restore Modal ────────────────────────────────────────────────────
interface BackupModalProps {
  language: 'ar' | 'en';
  theme: string;
  onClose: () => void;
  /** Full replace in backup UI — typically admins only. */
  allowFullReplace?: boolean;
}

function BackupModal({ language, theme, onClose, allowFullReplace = true }: BackupModalProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<'export' | 'import'>('export');
  const [restoreMode, setRestoreMode] = useState<RestoreMode>('merge');
  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [importSummary, setImportSummary] = useState<BackupImportResultSummary | null>(null);
  const [pendingReLogin, setPendingReLogin] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState('');
  const [verifyOpen, setVerifyOpen] = useState(false);
  const pendingImportRef = useRef<(() => Promise<void>) | null>(null);

  const CONFIRM_WORD = language === 'ar' ? 'استبدال' : 'REPLACE';
  const needsConfirm = allowFullReplace && restoreMode === 'replace';
  const replaceConfirmed = confirmReplace === CONFIRM_WORD;

  useEffect(() => {
    if (!allowFullReplace && restoreMode === 'replace') {
      setRestoreMode('merge');
      setConfirmReplace('');
    }
  }, [allowFullReplace, restoreMode]);

  const addProgress = (msg: string) => setProgress((p) => [...p, msg]);

  const handleExport = async () => {
    setRunning(true);
    setProgress([]);
    try {
      if (isLocalBackend) {
        addProgress(language === 'ar' ? 'تصدير PostgreSQL…' : 'Exporting PostgreSQL…');
        const payload = await settingsApi.exportBackup();
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const date = businessTodayYmd();
        a.href = url;
        a.download = `backup_${date}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        await exportBackup((col) => addProgress(language === 'ar' ? `تصدير: ${col}…` : `Exporting: ${col}…`));
      }
      addProgress(language === 'ar' ? '✓ اكتمل التصدير' : '✓ Export complete');
      toast.success(language === 'ar' ? 'تم تنزيل النسخة الاحتياطية' : 'Backup downloaded');
    } catch {
      toast.error(language === 'ar' ? 'خطأ في التصدير' : 'Export error');
    }
    setRunning(false);
  };

  const handleImport = async () => {
    if (!file || (needsConfirm && !replaceConfirmed)) return;

    const runImportInternal = async () => {
      setRunning(true);
      setProgress([]);
      setImportSummary(null);
      setPendingReLogin(false);
      try {
        if (isLocalBackend) {
          const text = await file.text();
          const payload = JSON.parse(text) as {
            exportedAt?: string;
            version?: number;
            collections?: Record<string, unknown[]>;
          };
          if (!payload.collections) throw new Error(language === 'ar' ? 'ملف نسخة غير صالح' : 'Invalid backup file');
          addProgress(language === 'ar' ? 'استيراد PostgreSQL…' : 'Importing PostgreSQL…');
          const result = await settingsApi.importBackup({
            exportedAt: payload.exportedAt,
            version: payload.version,
            collections: payload.collections,
            mode: restoreMode,
          });
          const skippedTotal = totalBackupImportSkipped(result.skipped);
          const summary = saveLastBackupImportReport({
            mode: restoreMode,
            recordsProcessed: result.recordsProcessed,
            collectionsProcessed: result.collectionsProcessed,
            counts: result.counts ?? {},
            skipped: result.skipped ?? {},
            unbalancedIds: result.gl?.unbalancedIds ?? [],
          });
          addProgress(
            language === 'ar'
              ? `✓ اكتمل — ${result.collectionsProcessed} مجموعة، ${result.recordsProcessed} سجل`
              : `✓ Done — ${result.collectionsProcessed} collections, ${result.recordsProcessed} records`,
          );
          if (skippedTotal > 0) {
            addProgress(
              language === 'ar'
                ? `⚠ تخطّي ${skippedTotal} سجل — التفاصيل في التقرير أدناه`
                : `⚠ Skipped ${skippedTotal} records — see report below`,
            );
          }
          setImportSummary(summary);
          toast.success(
            language === 'ar'
              ? `تم الاسترجاع: ${result.recordsProcessed} سجل${skippedTotal ? ` (تخطّي: ${skippedTotal})` : ''}`
              : `Restored: ${result.recordsProcessed} records${skippedTotal ? ` (skipped: ${skippedTotal})` : ''}`,
          );
          if (restoreMode === 'replace' && result.requiresReLogin) {
            // Prevent race: other API calls get 401 after session destroy and would close Settings before the report is visible.
            suppressApiUnauthorizedLogout();
            setPendingReLogin(true);
            toast(
              language === 'ar'
                ? 'تم مسح الجلسة — راجع تقرير الاسترجاع أدناه ثم سجّل الدخول'
                : 'Session cleared — review the restore report below, then sign in',
              { icon: '🔐', duration: 10_000 },
            );
          }
        } else {
          const { collections, records } = await importBackup(file, restoreMode, (col) =>
            addProgress(language === 'ar' ? `استيراد: ${col}…` : `Importing: ${col}…`),
          );
          addProgress(
            language === 'ar' ? `✓ اكتمل — ${collections} مجموعة، ${records} سجل` : `✓ Done — ${collections} collections, ${records} records`,
          );
          toast.success(language === 'ar' ? `تم الاسترجاع: ${records} سجل` : `Restored: ${records} records`);
        }
      } catch (e) {
        const msg =
          e instanceof ApiError
            ? e.message
            : e instanceof Error
              ? e.message
              : String(e);
        addProgress(`✗ ${msg}`);
        toast.error(language === 'ar' ? `فشل الاستيراد — ${msg}` : `Import failed — ${msg}`);
      }
      setRunning(false);
    };

    if (needsConfirm) {
      pendingImportRef.current = runImportInternal;
      setVerifyOpen(true);
      return;
    }
    await runImportInternal();
  };

  const panelCls = cn(
    'w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border shadow-2xl',
    theme === 'dark' ? 'bg-[#1a1d23] border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-900'
  );
  const tabCls = (active: boolean) => cn(
    'flex-1 py-2.5 text-sm font-bold rounded-xl transition-colors',
    active ? 'bg-blue-600 text-white' : theme === 'dark' ? 'text-gray-400 hover:bg-gray-800' : 'text-gray-500 hover:bg-gray-100'
  );
  const dir = language === 'ar' ? 'rtl' : 'ltr';

  return (
    <>
      <SettingsFloatingDialog
        open={!verifyOpen}
        theme={theme}
        dir={dir}
        layer="base"
        closeOnBackdrop={!running && !pendingReLogin}
        onClose={onClose}
        panelClassName="max-w-xl"
      >
      <div className={panelCls} dir={dir}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/50">
          <div className="flex items-center gap-2 text-blue-400">
            <HardDrive size={20} />
            <h3 className="text-lg font-bold">{language === 'ar' ? 'النسخ الاحتياطي والاسترجاع' : 'Backup & Restore'}</h3>
          </div>
          {!running && !pendingReLogin && (
            <button type="button" onClick={onClose} aria-label={language === 'ar' ? 'إغلاق' : 'Close'} className="text-gray-400 hover:text-gray-200">
              <X size={20} />
            </button>
          )}
        </div>

        <div className="p-6 space-y-5">
          {/* Tabs */}
          <div className={cn('flex gap-1 p-1 rounded-xl', theme === 'dark' ? 'bg-gray-900' : 'bg-gray-100')}>
            <button type="button" className={tabCls(tab === 'export')} onClick={() => { setTab('export'); setProgress([]); setImportSummary(null); setPendingReLogin(false); }}>
              <span className="flex items-center justify-center gap-2"><Download size={15} />{language === 'ar' ? 'تصدير نسخة احتياطية' : 'Export Backup'}</span>
            </button>
            <button type="button" className={tabCls(tab === 'import')} onClick={() => { setTab('import'); setProgress([]); setImportSummary(null); setPendingReLogin(false); }}>
              <span className="flex items-center justify-center gap-2"><Upload size={15} />{language === 'ar' ? 'استرجاع من نسخة' : 'Restore Backup'}</span>
            </button>
          </div>

          {/* Export tab */}
          {tab === 'export' && (
            <div className="space-y-4">
              <div className={cn('rounded-xl border p-4 text-sm space-y-2', theme === 'dark' ? 'bg-gray-900/50 border-gray-800' : 'bg-gray-50 border-gray-200')}>
                <p className="font-bold">{language === 'ar' ? 'المجموعات التي سيتم تصديرها:' : 'Collections to be exported:'}</p>
                <p className={cn('text-xs', theme === 'dark' ? 'text-gray-500' : 'text-gray-400')}>
                  {isLocalBackend
                    ? (language === 'ar'
                      ? `PostgreSQL — ${POSTGRES_BACKUP_COLLECTIONS.length} مجموعة (نسخة كاملة)`
                      : `PostgreSQL — ${POSTGRES_BACKUP_COLLECTIONS.length} collections (full snapshot)`)
                    : (language === 'ar'
                      ? `Firestore — ${FIRESTORE_BACKUP_COLLECTIONS.length} مجموعة`
                      : `Firestore — ${FIRESTORE_BACKUP_COLLECTIONS.length} collections`)}
                </p>
                <div className="flex flex-wrap gap-2 mt-1 max-h-40 overflow-y-auto">
                  {backupCollectionsForBackend().map((c) => (
                    <span key={c} className={cn('px-2 py-0.5 rounded-md text-xs font-mono', theme === 'dark' ? 'bg-blue-900/30 text-blue-300' : 'bg-blue-50 text-blue-700')}>{c}</span>
                  ))}
                </div>
                <p className={cn('text-xs mt-2', theme === 'dark' ? 'text-gray-500' : 'text-gray-400')}>
                  {isLocalBackend
                    ? (language === 'ar'
                      ? 'يُحفظ كملف JSON على جهازك. يشمل تجزئة كلمات المرور للاسترجاع — لا يشمل جلسات الدخول النشطة.'
                      : 'Saved as JSON on your device. Includes password hashes for restore — excludes active login sessions.')
                    : (language === 'ar' ? 'يُحفظ كملف JSON على جهازك.' : 'Saved as a JSON file on your device.')}
                </p>
              </div>
              <button
                type="button"
                onClick={handleExport}
                disabled={running}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 disabled:text-blue-700 text-white font-bold transition-colors"
              >
                {running ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                {language === 'ar' ? 'تنزيل النسخة الاحتياطية' : 'Download Backup'}
              </button>
            </div>
          )}

          {/* Import tab */}
          {tab === 'import' && (
            <div className="space-y-4">
              {/* Restore mode */}
              <div className={cn('grid gap-3', allowFullReplace ? 'grid-cols-2' : 'grid-cols-1')}>
                {(['merge', 'replace'] as RestoreMode[])
                  .filter((m) => m === 'merge' || allowFullReplace)
                  .map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => { setRestoreMode(m); setConfirmReplace(''); }}
                    className={cn(
                      'p-3 rounded-xl border-2 text-sm font-bold transition-all flex flex-col items-center gap-1',
                      restoreMode === m
                        ? m === 'replace' ? 'border-red-500 bg-red-900/20 text-red-400' : 'border-blue-500 bg-blue-900/20 text-blue-400'
                        : theme === 'dark' ? 'border-gray-700 text-gray-400 hover:border-gray-600' : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    )}
                  >
                    {m === 'merge' ? <RefreshCw size={18} /> : <AlertTriangle size={18} />}
                    {m === 'merge'
                      ? (language === 'ar' ? 'دمج' : 'Merge')
                      : (language === 'ar' ? 'استبدال كامل' : 'Full Replace')}
                    <span className={cn('text-xs font-normal', theme === 'dark' ? 'text-gray-500' : 'text-gray-400')}>
                      {m === 'merge'
                        ? (language === 'ar' ? 'يضيف ويحدّث فقط' : 'Add & update only')
                        : (language === 'ar' ? 'يمسح الكل أولاً' : 'Clears first')}
                    </span>
                  </button>
                ))}
              </div>
              {!allowFullReplace && (
                <p className={cn('text-xs', theme === 'dark' ? 'text-amber-400/90' : 'text-amber-700')}>
                  {language === 'ar'
                    ? 'وضع الاستبدال الكامل متاح لمشرف النظام (مسؤول) فقط.'
                    : 'Full replace is available to system admins only.'}
                </p>
              )}
              {isLocalBackend && (
                <p className={cn('text-xs', theme === 'dark' ? 'text-gray-500' : 'text-gray-400')}>
                  {language === 'ar'
                    ? 'PostgreSQL — يستورد كل المجموعات من ملف JSON (v3). الدمج يحدّث السجلات الموجودة؛ الاستبدال يفرّغ الجداول ثم يستورد. كلمات مرور المستخدمين الحالية لا تُستبدَل عند الدمج.'
                    : 'PostgreSQL — imports all collections from JSON (v3). Merge upserts rows; replace truncates backup tables first. Existing user passwords are preserved on merge.'}
                </p>
              )}

              {/* File picker */}
              <input ref={fileRef} type="file" accept=".json" aria-label={language === 'ar' ? 'ملف النسخة الاحتياطية' : 'Backup file'} className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-dashed transition-colors',
                  file
                    ? theme === 'dark' ? 'border-green-700 bg-green-900/20 text-green-400' : 'border-green-400 bg-green-50 text-green-700'
                    : theme === 'dark' ? 'border-gray-700 text-gray-400 hover:border-gray-600' : 'border-gray-300 text-gray-500 hover:border-gray-400'
                )}
              >
                <FolderOpen size={20} />
                <span className="text-sm font-medium">
                  {file ? file.name : (language === 'ar' ? 'اختر ملف النسخة الاحتياطية (.json)' : 'Choose backup file (.json)')}
                </span>
              </button>

              {/* Replace confirmation */}
              {needsConfirm && (
                <div className={cn('rounded-xl border p-3 space-y-2', theme === 'dark' ? 'bg-red-950/30 border-red-900/50' : 'bg-red-50 border-red-200')}>
                  <p className="text-xs text-red-400 font-bold">
                    {language === 'ar'
                      ? <>⚠ وضع الاستبدال سيمسح البيانات الحالية. اكتب <strong>{CONFIRM_WORD}</strong> للمتابعة:</>
                      : <>⚠ Replace mode will erase current data. Type <strong>{CONFIRM_WORD}</strong> to continue:</>}
                  </p>
                  <input
                    type="text"
                    value={confirmReplace}
                    onChange={(e) => setConfirmReplace(e.target.value)}
                    placeholder={CONFIRM_WORD}
                    className={cn(
                      'w-full border rounded-lg py-1.5 px-3 text-sm outline-none',
                      theme === 'dark' ? 'bg-gray-900 border-gray-700 text-white' : 'bg-white border-gray-300',
                      replaceConfirmed ? 'border-red-500' : ''
                    )}
                  />
                </div>
              )}

              <button
                type="button"
                onClick={handleImport}
                disabled={running || !file || (needsConfirm && !replaceConfirmed)}
                className={cn(
                  'w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-colors text-white',
                  needsConfirm
                    ? 'bg-red-600 hover:bg-red-500 disabled:bg-red-900 disabled:text-red-700'
                    : 'bg-green-700 hover:bg-green-600 disabled:bg-green-900 disabled:text-green-700'
                )}
              >
                {running ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
                {language === 'ar'
                  ? (needsConfirm ? 'استبدال البيانات' : 'استيراد ودمج')
                  : (needsConfirm ? 'Replace Data' : 'Import & Merge')}
              </button>
            </div>
          )}

          {/* Progress log */}
          {progress.length > 0 && (
            <div className={cn('rounded-xl border p-3 space-y-0.5 text-xs font-mono max-h-36 overflow-y-auto', theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-gray-50 border-gray-200')}>
              {progress.map((line, i) => (
                <div
                  key={listKey(line, i, 'backup-progress')}
                  className={
                    line.startsWith('✓')
                      ? 'text-green-400'
                      : line.startsWith('✗')
                        ? 'text-red-400'
                        : line.startsWith('⚠')
                          ? 'text-amber-500'
                          : 'text-gray-400'
                  }
                >
                  {line}
                </div>
              ))}
            </div>
          )}

          {importSummary && (
            <BackupImportReportPanel summary={importSummary} language={language} theme={theme} />
          )}

          {pendingReLogin && (
            <div className="space-y-2 sticky bottom-0 pt-2 pb-1" style={{ background: theme === 'dark' ? '#1a1d23' : '#fff' }}>
              <p className={cn('text-sm', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>
                {language === 'ar'
                  ? 'راجع تقرير الاسترجاع أعلاه أولاً. بعد الاستبدال الكامل يجب تسجيل الدخول من جديد.'
                  : 'Review the restore report above first. After a full replace you must sign in again.'}
              </p>
              <button
                type="button"
                onClick={() => {
                  clearApiUnauthorizedLogoutSuppress();
                  setPendingReLogin(false);
                  onClose();
                  void performAppLogout();
                }}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold transition-colors"
              >
                {language === 'ar' ? 'متابعة لتسجيل الدخول' : 'Continue to sign in'}
              </button>
            </div>
          )}

          {running && (
            <div className="flex items-center justify-center gap-3 py-2 text-blue-400">
              <Loader2 size={18} className="animate-spin" />
              <span className="text-sm font-bold">{language === 'ar' ? 'جارٍ المعالجة، لا تغلق الصفحة…' : 'Processing, do not close…'}</span>
            </div>
          )}
        </div>
      </div>
      </SettingsFloatingDialog>

      <AdminSensitiveVerifyModal
        open={verifyOpen}
        onOpenChange={(v) => {
          setVerifyOpen(v);
          if (!v) pendingImportRef.current = null;
        }}
        language={language}
        theme={theme}
        onVerified={async () => {
          const fn = pendingImportRef.current;
          pendingImportRef.current = null;
          if (fn) await fn();
        }}
      />
    </>
  );
}

// ─── Clear Data Modal ──────────────────────────────────────────────────────────
interface ClearDataModalProps {
  language: 'ar' | 'en';
  theme: string;
  selected: Set<string>;
  onClose: () => void;
}

function ClearDataModal({ language, theme, selected, onClose }: ClearDataModalProps) {
  const [confirmText, setConfirmText] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const deleteRunRef = useRef<(() => Promise<void>) | null>(null);

  const CONFIRM_WORD = language === 'ar' ? 'حذف' : 'DELETE';
  const confirmed = confirmText === CONFIRM_WORD;

  const selectedGroups = CLEAR_DATA_GROUPS.filter((g) => selected.has(g.id));
  const firestoreCollections = selectedGroups
    .filter((g) => g.backend === 'firestore')
    .flatMap((g) => [...g.collections]);
  const postgresWipeGroups = selectedGroups
    .filter((g) => g.backend === 'postgres' && g.postgresWipe)
    .map((g) => g.postgresWipe!);

  const handleDelete = async () => {
    if (!confirmed || running) return;
    deleteRunRef.current = async () => {
      setRunning(true);
      setProgress([]);
      let totalDeleted = 0;
      if (isLocalBackend && postgresWipeGroups.length > 0) {
        const label =
          language === 'ar' ? 'PostgreSQL — المجموعات المحددة' : 'PostgreSQL — selected groups';
        setProgress((p) => [...p, language === 'ar' ? `جارٍ ${label}…` : `Running ${label}…`]);
        try {
          const result = await financialMaintenanceApi.wipeGroups(postgresWipeGroups);
          totalDeleted += result.total;
          for (const groupId of result.groups) {
            setProgress((p) => [
              ...p,
              language === 'ar' ? `✓ ${groupId}` : `✓ ${groupId}`,
            ]);
          }
          setProgress((p) => [
            ...p,
            language === 'ar'
              ? `✓ ${label} — ${result.total} سجل`
              : `✓ ${label} — ${result.total} records`,
          ]);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setProgress((p) => [...p, language === 'ar' ? `✗ ${label}: ${msg}` : `✗ ${label}: ${msg}`]);
        }
      }
      for (const col of firestoreCollections) {
        setProgress((p) => [...p, language === 'ar' ? `جارٍ حذف: ${col}…` : `Deleting: ${col}…`]);
        try {
          const count = await batchDeleteCollection(col);
          totalDeleted += count;
          setProgress((p) => [...p, language === 'ar' ? `✓ ${col} — تم حذف ${count} سجل` : `✓ ${col} — deleted ${count} records`]);
        } catch {
          setProgress((p) => [...p, language === 'ar' ? `✗ خطأ في ${col}` : `✗ Error in ${col}`]);
        }
      }
      toast.success(language === 'ar' ? `تم الحذف — ${totalDeleted} سجل` : `Done — ${totalDeleted} records deleted`);
      setRunning(false);
      onClose();
    };
    setVerifyOpen(true);
  };

  const panelCls = cn(
    'w-full max-w-lg rounded-2xl border shadow-2xl p-6',
    theme === 'dark' ? 'bg-[#1a1d23] border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-900'
  );
  const dir = language === 'ar' ? 'rtl' : 'ltr';

  return (
    <>
      <SettingsFloatingDialog
        open={!verifyOpen}
        theme={theme}
        dir={dir}
        layer="base"
        closeOnBackdrop={!running}
        onClose={onClose}
        panelClassName="max-w-lg"
      >
        <div className={panelCls} dir={dir}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2 text-red-500">
            <AlertTriangle size={22} />
            <h3 className="text-lg font-bold">{language === 'ar' ? 'تأكيد الحذف النهائي' : 'Confirm Permanent Deletion'}</h3>
          </div>
          {!running && (
            <button type="button" onClick={onClose} aria-label={language === 'ar' ? 'إغلاق' : 'Close'} className="text-gray-400 hover:text-gray-200">
              <X size={20} />
            </button>
          )}
        </div>

        <div className={cn('rounded-xl border p-4 mb-5 space-y-1 text-sm', theme === 'dark' ? 'bg-red-950/30 border-red-900/50' : 'bg-red-50 border-red-200')}>
          <p className="font-bold text-red-500 mb-2">{language === 'ar' ? 'البيانات التي سيتم حذفها:' : 'Data to be deleted:'}</p>
          {selectedGroups.map((g) => (
            <div key={g.id} className="flex items-center gap-2 text-red-400">
              <span>•</span>
              <span>{language === 'ar' ? g.ar : g.en}</span>
              {g.collections.length > 0 && (
                <span className="text-red-600/70">({g.collections.join(', ')})</span>
              )}
            </div>
          ))}
        </div>

        {progress.length > 0 && (
          <div className={cn('rounded-xl border p-3 mb-4 space-y-1 text-xs font-mono max-h-40 overflow-y-auto', theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-gray-50 border-gray-200')}>
            {progress.map((line, i) => (
              <div key={i} className={line.startsWith('✓') ? 'text-green-400' : line.startsWith('✗') ? 'text-red-400' : 'text-gray-400'}>{line}</div>
            ))}
          </div>
        )}

        {!running && (
          <>
            <p className="text-sm text-gray-400 mb-2">
              {language === 'ar'
                ? <>اكتب <strong className="text-red-400">{CONFIRM_WORD}</strong> للمتابعة:</>
                : <>Type <strong className="text-red-400">{CONFIRM_WORD}</strong> to continue:</>}
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={CONFIRM_WORD}
              className={cn(
                'w-full border rounded-xl py-2 px-3 text-sm outline-none mb-4 transition-colors',
                theme === 'dark' ? 'bg-gray-900 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900',
                confirmed ? 'border-red-500' : ''
              )}
            />
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className={cn('flex-1 py-2 rounded-xl text-sm font-bold border transition-colors',
                  theme === 'dark' ? 'border-gray-700 text-gray-400 hover:bg-gray-800' : 'border-gray-300 text-gray-500 hover:bg-gray-100'
                )}
              >
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={!confirmed}
                className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:bg-red-900 disabled:text-red-700 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2"
              >
                <Trash2 size={16} />
                {language === 'ar' ? 'حذف نهائي' : 'Permanently Delete'}
              </button>
            </div>
          </>
        )}

        {running && (
          <div className="flex items-center justify-center gap-3 py-4 text-red-400">
            <Loader2 size={20} className="animate-spin" />
            <span className="font-bold text-sm">{language === 'ar' ? 'جارٍ الحذف، لا تغلق الصفحة…' : 'Deleting, do not close…'}</span>
          </div>
        )}
        </div>
      </SettingsFloatingDialog>

      <AdminSensitiveVerifyModal
        open={verifyOpen}
        onOpenChange={(v) => {
          setVerifyOpen(v);
          if (!v) deleteRunRef.current = null;
        }}
        language={language}
        theme={theme}
        onVerified={async () => {
          const fn = deleteRunRef.current;
          deleteRunRef.current = null;
          if (fn) await fn();
        }}
      />
    </>
  );
}

function FactoryResetModal({
  language,
  theme,
  onClose,
}: {
  language: 'ar' | 'en';
  theme: string;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [confirmText, setConfirmText] = useState('');
  const [running, setRunning] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [lastError, setLastError] = useState('');

  const confirmed = isFactoryResetConfirmWord(confirmText);

  const runFactoryReset = async () => {
    setVerifyOpen(false);
    setRunning(true);
    setLastError('');
    try {
      const result = await financialMaintenanceApi.factoryReset();
      await clearAllOfflineClientData();
      suppressApiUnauthorizedLogout();
      toast.success(
        t('settings_factory_reset_success').replace(
          '{emails}',
          (result.keptEmails ?? []).join(', '),
        ),
      );
      onClose();
      await performAppLogout();
    } catch (e) {
      const msg =
        e instanceof ApiError && e.status === 404
          ? t('settings_factory_reset_stale_api')
          : e instanceof ApiError
            ? e.message
            : e instanceof Error
              ? e.message
              : String(e);
      setLastError(msg);
      toast.error(msg);
      setRunning(false);
    }
  };

  const handleReset = () => {
    if (!confirmed || running) return;
    setLastError('');
    setVerifyOpen(true);
  };

  const panelCls = cn(
    'w-full max-w-lg rounded-2xl border shadow-2xl p-6',
    theme === 'dark' ? 'bg-[#1a1d23] border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-900',
  );
  const dir = language === 'ar' ? 'rtl' : 'ltr';

  return (
    <>
      <SettingsFloatingDialog
        open={!verifyOpen}
        theme={theme}
        dir={dir}
        layer="base"
        closeOnBackdrop={!running}
        onClose={onClose}
        panelClassName="max-w-lg"
      >
        <div className={panelCls} dir={dir}>
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2 text-red-500">
              <RotateCcw size={22} />
              <h3 className="text-lg font-bold">{t('settings_factory_reset_title')}</h3>
            </div>
            {!running && (
              <button
                type="button"
                onClick={onClose}
                aria-label={language === 'ar' ? 'إغلاق' : 'Close'}
                className="text-gray-400 hover:text-gray-200"
              >
                <X size={20} />
              </button>
            )}
          </div>

          <div
            className={cn(
              'rounded-xl border p-4 mb-5 space-y-2 text-sm',
              theme === 'dark' ? 'bg-red-950/30 border-red-900/50' : 'bg-red-50 border-red-200',
            )}
          >
            <p className="text-red-400">{t('settings_factory_reset_body')}</p>
            <p className="font-bold text-red-500">{t('settings_factory_reset_keep')}</p>
          </div>

          {lastError && !running && (
            <div className={cn('rounded-xl border p-3 mb-4 text-sm', theme === 'dark' ? 'bg-red-950/40 border-red-800 text-red-300' : 'bg-red-50 border-red-200 text-red-800')}>
              {lastError}
            </div>
          )}

          {running && (
            <div className="flex items-center justify-center gap-3 py-4 text-red-400">
              <Loader2 size={20} className="animate-spin" />
              <span className="font-bold text-sm">{t('settings_factory_reset_running')}</span>
            </div>
          )}

          {!running && (
            <>
              <p className="text-sm text-gray-400 mb-2">
                {t('settings_factory_reset_confirm_hint')}
              </p>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={language === 'ar' ? 'ضبط المصنع أو FACTORY' : 'FACTORY or ضبط المصنع'}
                className={cn(
                  'w-full border rounded-xl py-2 px-3 text-sm outline-none mb-4 transition-colors',
                  theme === 'dark' ? 'bg-gray-900 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900',
                  confirmed ? 'border-red-500' : '',
                )}
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className={cn(
                    'flex-1 py-2 rounded-xl text-sm font-bold border transition-colors',
                    theme === 'dark'
                      ? 'border-gray-700 text-gray-400 hover:bg-gray-800'
                      : 'border-gray-300 text-gray-500 hover:bg-gray-100',
                  )}
                >
                  {language === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={!confirmed}
                  className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:bg-red-900 disabled:text-red-700 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2"
                >
                  <RotateCcw size={16} />
                  {t('settings_factory_reset_btn')}
                </button>
              </div>
            </>
          )}
        </div>
      </SettingsFloatingDialog>

      <AdminSensitiveVerifyModal
        open={verifyOpen}
        onOpenChange={(v) => {
          if (running) return;
          setVerifyOpen(v);
        }}
        language={language}
        theme={theme}
        onVerified={runFactoryReset}
      />
    </>
  );
}

const ALL_PERMISSION_MODULES = [...BOOLEAN_MODULES, ...CRUD_MODULES];

// ─── Granular Permissions Data ─────────────────────────────────────────────────

/**
 * Each PermRow defines ONE permission key with the sub-views it controls.
 * Multiple rows per module = independent controls (e.g. Technical Office).
 * Multiple views in one row = they share the same permission key.
 */
interface PermRow {
  /** The underlying permission key toggled by this row */
  permKey: PermissionKey;
  /** Whether this key is a flat boolean (dashboard/reports/settings) */
  isBool: boolean;
  /** Sub-view labels that this permission key unlocks */
  views: { ar: string; en: string }[];
  /** Row display label (if different from first view) */
  labelAr?: string;
  labelEn?: string;
}

interface PermGroupDef {
  moduleId: string;
  ar: string;
  en: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  rows: PermRow[];
}

const PERMISSION_GROUPS: PermGroupDef[] = [
  {
    moduleId: 'dashboard',
    ar: 'لوحة التحكم',
    en: 'Dashboard',
    icon: LayoutDashboard,
    rows: [
      {
        permKey: 'dashboard',
        isBool: true,
        views: [{ ar: 'لوحة التحكم الرئيسية', en: 'Main dashboard' }],
      },
    ],
  },
  {
    moduleId: 'ledger',
    ar: 'الأستاذ العام',
    en: 'General Ledger',
    icon: BookOpen,
    rows: [
      {
        permKey: 'ledger',
        isBool: false,
        labelAr: 'دفتر اليومية · كشف الحساب',
        labelEn: 'Journal · Account Statement',
        views: [
          { ar: 'دفتر اليومية', en: 'Journal entries' },
          { ar: 'كشف حساب', en: 'Account statement' },
        ],
      },
      {
        permKey: 'overhead',
        isBool: false,
        labelAr: 'الفترات المحاسبية',
        labelEn: 'Accounting Periods',
        views: [
          { ar: 'توزيع الأعباء (OHA)', en: 'Overhead allocation (OHA)' },
          { ar: 'قفل الفترة المحاسبية', en: 'Accounting period lock' },
          { ar: 'إقفال قائمة الدخل / الافتتاحي', en: 'Income close / opening entry' },
        ],
      },
    ],
  },
  {
    moduleId: 'technical',
    ar: 'المكتب الفني',
    en: 'Technical Office',
    icon: HardHat,
    rows: [
      {
        permKey: 'projects',
        isBool: false,
        views: [{ ar: 'المشاريع', en: 'Projects' }],
      },
      {
        permKey: 'boq',
        isBool: false,
        views: [{ ar: 'جداول الكميات', en: 'BOQ' }],
      },
      {
        permKey: 'billing',
        isBool: false,
        labelAr: 'المستخلصات والمستندات',
        labelEn: 'Billing & documents',
        views: [
          { ar: 'المستخلصات (IPC / MOS)', en: 'Billing (IPC / MOS)' },
          { ar: 'مستندات المكتب الفني', en: 'Technical office documents' },
        ],
      },
    ],
  },
  {
    moduleId: 'costs',
    ar: 'التكاليف الفعلية',
    en: 'Actual Costs',
    icon: Receipt,
    rows: [
      {
        permKey: 'costs_invoice' as PermissionKey,
        isBool: false,
        labelAr: 'فاتورة مشتريات',
        labelEn: 'Purchase Invoice',
        views: [{ ar: 'فاتورة مشتريات', en: 'Purchase invoice' }],
      },
      {
        permKey: 'costs_ipc' as PermissionKey,
        isBool: false,
        labelAr: 'مستخلص مقاول',
        labelEn: 'Subcontractor IPC',
        views: [{ ar: 'مستخلص مقاول', en: 'Subcontractor IPC' }],
      },
      {
        permKey: 'costs_custody' as PermissionKey,
        isBool: false,
        labelAr: 'تسوية عهدة',
        labelEn: 'Custody Settlement',
        views: [{ ar: 'تسوية عهدة (مع الأستاذ)', en: 'Custody settlement (with GL)' }],
      },
      {
        permKey: 'suppliers' as PermissionKey,
        isBool: false,
        views: [{ ar: 'الموردون (مرجع قائمة الفواتير والمستخلصات)', en: 'Suppliers (reference for invoices & IPC)' }],
      },
      {
        permKey: 'subcontractor' as PermissionKey,
        isBool: false,
        views: [{ ar: 'مقاولو الباطن', en: 'Subcontractors' }],
      },
    ],
  },
  {
    moduleId: 'inventory',
    ar: 'المخزون',
    en: 'Inventory',
    icon: Package,
    rows: [
      {
        permKey: 'inventory',
        isBool: false,
        labelAr: 'الأصناف · الرصيد · التحويلات · الصرف والإرجاع',
        labelEn: 'Materials · Balance · Transfers · Issues & Returns',
        views: [
          { ar: 'الأصناف', en: 'Materials' },
          { ar: 'رصيد المخزن', en: 'Warehouse balance' },
          { ar: 'تحويلات المشاريع', en: 'Project transfers' },
          { ar: 'صرف وإرجاع', en: 'Issues & returns' },
        ],
      },
    ],
  },
  {
    moduleId: 'purchase_requests',
    ar: 'أوامر الشراء',
    en: 'Purchase Requests',
    icon: ShoppingCart,
    rows: [
      {
        permKey: 'purchase_requests',
        isBool: false,
        labelAr: 'إنشاء الطلبات · الحالة · واتساب للمشتريات',
        labelEn: 'Create requests · Status · Purchasing WhatsApp',
        views: [
          { ar: 'إنشاء طلب', en: 'Create request' },
          { ar: 'الطلبات النشطة', en: 'Open requests' },
          { ar: 'الطلبات المنتهية', en: 'Executed requests' },
        ],
      },
    ],
  },
  {
    moduleId: 'banks',
    ar: 'البنوك',
    en: 'Banks',
    icon: Landmark,
    rows: [
      {
        permKey: 'banks',
        isBool: false,
        labelAr: 'كشف حساب · المعاملات · كشوف البنك',
        labelEn: 'Account statement · Transactions · Bank statements',
        views: [
          { ar: 'كشف حساب بنكي', en: 'Bank account statement' },
          { ar: 'المعاملات (حركات وشيكات)', en: 'Transactions (movements & cheques)' },
          { ar: 'كشوف البنك', en: 'Bank statements' },
        ],
      },
    ],
  },
  {
    moduleId: 'overhead',
    ar: 'الفترات المحاسبية',
    en: 'Accounting Periods',
    icon: TrendingUp,
    rows: [
      {
        permKey: 'overhead',
        isBool: false,
        labelAr: 'توزيع الأعباء · قفل الفترة · إقفال الدخل',
        labelEn: 'OHA · Period lock · Income close',
        views: [
          { ar: 'توزيع الأعباء (OHA)', en: 'Overhead allocation (OHA)' },
          { ar: 'قفل الفترة المحاسبية', en: 'Accounting period lock' },
          { ar: 'إقفال قائمة الدخل / الافتتاحي', en: 'Income close / opening entry' },
        ],
      },
    ],
  },
  {
    moduleId: 'assets',
    ar: 'الأصول الثابتة',
    en: 'Fixed Assets',
    icon: Building2,
    rows: [
      {
        permKey: 'assets',
        isBool: false,
        labelAr: 'سجل الأصول · الإهلاك',
        labelEn: 'Asset Register · Depreciation',
        views: [
          { ar: 'سجل الأصول الثابتة', en: 'Fixed assets register' },
          { ar: 'إهلاك الفترة', en: 'Period depreciation' },
        ],
      },
    ],
  },
  {
    moduleId: 'payroll',
    ar: 'الموارد البشرية',
    en: 'HR & Payroll',
    icon: Users,
    rows: [
      {
        permKey: 'payroll',
        isBool: false,
        labelAr: 'الموظفون · كشوف الرواتب · الإعدادات',
        labelEn: 'Employees · Payroll sheets · Settings',
        views: [
          { ar: 'سجل الموظفين', en: 'Employee register' },
          { ar: 'كشوف الرواتب الشهرية', en: 'Monthly payroll sheets' },
          { ar: 'إعدادات الموارد البشرية', en: 'HR settings' },
        ],
      },
    ],
  },
  {
    moduleId: 'reports',
    ar: 'التقارير',
    en: 'Reports',
    icon: BarChart3,
    rows: [
      {
        permKey: 'reports',
        isBool: true,
        labelAr: 'جميع تبويبات التقارير',
        labelEn: 'All report tabs',
        views: [
          { ar: 'قائمة الدخل', en: 'Income statement' },
          { ar: 'الميزانية vs الفعلي', en: 'Budget vs actual' },
          { ar: 'الميزانية العمومية', en: 'Balance sheet' },
          { ar: 'ميزان المراجعة', en: 'Trial balance' },
          { ar: 'الجدول الزمني', en: 'Timeline' },
          { ar: 'تقرير السيولة', en: 'Liquidity' },
          { ar: 'تكاليف BOQ', en: 'BOQ costs' },
        ],
      },
    ],
  },
  {
    moduleId: 'settings',
    ar: 'الإعدادات',
    en: 'Settings',
    icon: SettingsIcon,
    rows: [
      {
        permKey: 'settings',
        isBool: true,
        labelAr: 'جميع أقسام الإعدادات',
        labelEn: 'All settings sections',
        views: [
          { ar: 'قاعدة البيانات', en: 'Database' },
          { ar: 'إدارة المستخدمين', en: 'User management' },
          { ar: 'شجرة الحسابات', en: 'Chart of accounts' },
          { ar: 'مراكز التكلفة غير المباشرة', en: 'Indirect cost centers' },
          { ar: 'سجل النشاط', en: 'Activity log' },
          { ar: 'بيانات تجريبية', en: 'Sample data' },
        ],
      },
    ],
  },
];

// ─── PermissionsEditor Component ───────────────────────────────────────────────

interface PermissionsEditorProps {
  permissions: UserPermissions;
  setPermissions: (p: UserPermissions) => void;
  language: 'ar' | 'en';
  theme: string;
}

function PermissionsEditor({ permissions, setPermissions, language, theme }: PermissionsEditorProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(PERMISSION_GROUPS.map((g) => g.moduleId)));

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = (value: boolean) => {
    setPermissions({
      dashboard: value,
      ledger: value ? crudOn() : crudOff(),
      projects: value ? crudOn() : crudOff(),
      boq: value ? crudOn() : crudOff(),
      billing: value ? crudOn() : crudOff(),
      costs: value ? crudOn() : crudOff(),
      costs_invoice: value ? crudOn() : crudOff(),
      costs_ipc: value ? crudOn() : crudOff(),
      costs_custody: value ? crudOn() : crudOff(),
      suppliers: value ? crudOn() : crudOff(),
      banks: value ? crudOn() : crudOff(),
      inventory: value ? crudOn() : crudOff(),
      subcontractor: value ? crudOn() : crudOff(),
      overhead: value ? crudOn() : crudOff(),
      assets: value ? crudOn() : crudOff(),
      payroll: value ? crudOn() : crudOff(),
      purchase_requests: value ? crudOn() : { view: true, create: true, edit: false },
      reports: value,
      settings: value,
    });
  };

  const setBool = (key: 'dashboard' | 'reports' | 'settings', v: boolean) => {
    setPermissions({ ...permissions, [key]: v });
  };

  const setCrud = (key: PermissionKey, next: Partial<{ view: boolean; create: boolean; edit: boolean }>) => {
    const cur = moduleAccess(permissions, key);
    setPermissions({
      ...permissions,
      [key]: {
        view: next.view ?? cur.view,
        create: next.create ?? cur.create,
        edit: next.edit ?? cur.edit,
      },
    });
  };

  const isDark = theme === 'dark';
  const isErp = theme === 'erp';

  const cardCls = cn(
    'rounded-xl border overflow-hidden',
    isDark ? 'border-gray-700 bg-gray-900/30' : isErp ? 'border-[var(--erp-border)] bg-white' : 'border-gray-200 bg-white',
  );

  const headerCls = cn(
    'flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none transition-colors',
    isDark ? 'hover:bg-gray-800' : isErp ? 'hover:bg-[var(--erp-accent-soft)]' : 'hover:bg-gray-50',
  );

  return (
    <div className="space-y-1.5">
      {/* All / None */}
      <div className="flex items-center justify-between mb-2">
        <span className={cn('text-xs font-bold uppercase tracking-wide', isDark ? 'text-gray-400' : 'text-gray-500')}>
          {language === 'ar' ? 'صلاحيات الوحدات' : 'Module Access'}
        </span>
        <div className="flex gap-3 text-xs">
          <button type="button" onClick={() => toggleAll(true)}
            className={cn('font-medium hover:underline', isDark ? 'text-blue-400' : isErp ? 'text-[var(--erp-primary)]' : 'text-blue-600')}>
            {language === 'ar' ? 'تمكين الكل' : 'Enable all'}
          </button>
          <span className={isDark ? 'text-gray-600' : 'text-gray-300'}>|</span>
          <button type="button" onClick={() => toggleAll(false)}
            className="text-red-400 font-medium hover:underline">
            {language === 'ar' ? 'تعطيل الكل' : 'Disable all'}
          </button>
        </div>
      </div>

      {PERMISSION_GROUPS.map((group) => {
        const isOpen = expanded.has(group.moduleId);
        const Icon = group.icon;

        // Check if any permission in this group is enabled (for header indicator)
        const anyEnabled = group.rows.some((row) => {
          if (row.isBool) return Boolean(permissions[row.permKey as 'dashboard' | 'reports' | 'settings']);
          const a = moduleAccess(permissions, row.permKey);
          return a.view || a.create || a.edit;
        });

        return (
          <div key={group.moduleId} className={cardCls}>
            {/* Card header */}
            <div className={headerCls} onClick={() => toggleExpanded(group.moduleId)}>
              <Icon size={15} className={cn(
                anyEnabled
                  ? isDark ? 'text-blue-400' : isErp ? 'text-[var(--erp-primary)]' : 'text-blue-600'
                  : isDark ? 'text-gray-600' : 'text-gray-400'
              )} />
              <span className={cn(
                'flex-1 text-xs font-semibold',
                anyEnabled
                  ? isDark ? 'text-white' : 'text-gray-800'
                  : isDark ? 'text-gray-500' : 'text-gray-400'
              )}>
                {language === 'ar' ? group.ar : group.en}
              </span>
              {/* Summary badge */}
              <span className={cn(
                'text-[10px] px-1.5 py-0.5 rounded-full font-medium me-1',
                anyEnabled
                  ? isDark ? 'bg-blue-900/40 text-blue-300' : isErp ? 'bg-[var(--erp-accent-soft)] text-[var(--erp-primary)]' : 'bg-blue-50 text-blue-600'
                  : isDark ? 'bg-gray-800 text-gray-600' : 'bg-gray-100 text-gray-400'
              )}>
                {anyEnabled ? (language === 'ar' ? 'مُفعَّل' : 'On') : (language === 'ar' ? 'معطّل' : 'Off')}
              </span>
              <ChevronRight size={13} className={cn(
                'transition-transform duration-200 shrink-0',
                isOpen ? 'rotate-90' : '',
                isDark ? 'text-gray-600' : 'text-gray-400'
              )} />
            </div>

            {/* Expandable rows */}
            {isOpen && (
              <div className={cn(
                'border-t divide-y',
                isDark ? 'border-gray-700/60 divide-gray-700/40' : isErp ? 'border-[var(--erp-border)] divide-[var(--erp-border)]' : 'border-gray-100 divide-gray-100'
              )}>
                {group.rows.map((row, ri) => {
                  const isBoolKey = row.isBool || row.permKey === 'dashboard' || row.permKey === 'reports' || row.permKey === 'settings';
                  const boolVal = isBoolKey ? Boolean(permissions[row.permKey as 'dashboard' | 'reports' | 'settings']) : false;
                  const access = !isBoolKey ? moduleAccess(permissions, row.permKey) : { view: false, create: false, edit: false };

                  const rowEnabled = isBoolKey ? boolVal : (access.view || access.create || access.edit);

                  return (
                    <div key={compositeListKey(row.permKey, row.views[0]?.ar, ri, 'perm-row')} className={cn(
                      'px-3 py-2 space-y-1.5',
                      !rowEnabled && (isDark ? 'opacity-60' : 'opacity-70')
                    )}>
                      {/* Row label + controls */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn(
                          'text-xs font-medium flex-1 min-w-0',
                          isDark ? 'text-gray-200' : 'text-gray-700'
                        )}>
                          {language === 'ar'
                            ? (row.labelAr ?? row.views[0].ar)
                            : (row.labelEn ?? row.views[0].en)}
                        </span>

                        {isBoolKey ? (
                          /* Boolean toggle */
                          <button
                            type="button"
                            onClick={() => setBool(row.permKey as 'dashboard' | 'reports' | 'settings', !boolVal)}
                            className={cn(
                              'relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0',
                              boolVal
                                ? isDark ? 'bg-blue-600' : isErp ? 'bg-[var(--erp-primary)]' : 'bg-blue-600'
                                : isDark ? 'bg-gray-700' : 'bg-gray-300'
                            )}
                          >
                            <span className={cn(
                              'inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform',
                              boolVal ? 'translate-x-4' : 'translate-x-0.5'
                            )} style={{ direction: 'ltr' }} />
                          </button>
                        ) : (
                          /* CRUD controls */
                          <div className="flex items-center gap-1 shrink-0">
                            {/* View */}
                            <button
                              type="button"
                              title={language === 'ar' ? 'عرض' : 'View'}
                              onClick={() => setCrud(row.permKey, { view: !access.view })}
                              className={cn(
                                'flex items-center gap-1 px-1.5 py-1 rounded text-[11px] font-medium transition-colors',
                                access.view
                                  ? 'bg-blue-600 text-white'
                                  : isDark ? 'bg-gray-800 text-gray-500 border border-gray-700' : 'bg-gray-100 text-gray-400 border border-gray-200'
                              )}
                            >
                              <Eye size={10} />
                              <span className="hidden sm:inline">{language === 'ar' ? 'عرض' : 'View'}</span>
                            </button>
                            {/* Create */}
                            <button
                              type="button"
                              title={language === 'ar' ? 'إضافة' : 'Create'}
                              onClick={() => setCrud(row.permKey, { create: !access.create })}
                              className={cn(
                                'flex items-center gap-1 px-1.5 py-1 rounded text-[11px] font-medium transition-colors',
                                access.create
                                  ? 'bg-emerald-600 text-white'
                                  : isDark ? 'bg-gray-800 text-gray-500 border border-gray-700' : 'bg-gray-100 text-gray-400 border border-gray-200'
                              )}
                            >
                              <Plus size={10} />
                              <span className="hidden sm:inline">{language === 'ar' ? 'إضافة' : 'Add'}</span>
                            </button>
                            {/* Edit */}
                            <button
                              type="button"
                              title={language === 'ar' ? 'تعديل' : 'Edit'}
                              onClick={() => setCrud(row.permKey, { edit: !access.edit })}
                              className={cn(
                                'flex items-center gap-1 px-1.5 py-1 rounded text-[11px] font-medium transition-colors',
                                access.edit
                                  ? 'bg-amber-600 text-white'
                                  : isDark ? 'bg-gray-800 text-gray-500 border border-gray-700' : 'bg-gray-100 text-gray-400 border border-gray-200'
                              )}
                            >
                              <PenLine size={10} />
                              <span className="hidden sm:inline">{language === 'ar' ? 'تعديل' : 'Edit'}</span>
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Sub-view chips */}
                      {row.views.length > 1 && (
                        <div className="flex flex-wrap gap-1 ps-0.5">
                          {row.views.map((v, vi) => (
                            <span
                              key={compositeListKey(v.ar, v.en, vi, 'perm-view')}
                              className={cn(
                                'text-[10px] px-1.5 py-0.5 rounded-full border',
                                isDark
                                  ? 'border-gray-700 text-gray-500'
                                  : isErp
                                    ? 'border-[var(--erp-border)] text-[var(--erp-text-muted)]'
                                    : 'border-gray-200 text-gray-400'
                              )}
                            >
                              {language === 'ar' ? v.ar : v.en}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function emptyPermissions(): UserPermissions {
  return {
    dashboard: false,
    ledger: crudOff(),
    projects: crudOff(),
    boq: crudOff(),
    billing: crudOff(),
    costs: crudOff(),
    costs_invoice: crudOff(),
    costs_ipc: crudOff(),
    costs_custody: crudOff(),
    suppliers: crudOff(),
    banks: crudOff(),
    inventory: crudOff(),
    subcontractor: crudOff(),
    overhead: crudOff(),
    assets: crudOff(),
    payroll: crudOff(),
    purchase_requests: { view: true, create: true, edit: false },
    reports: false,
    settings: false,
  };
}

// ─── User Modal ────────────────────────────────────────────────────────────────
interface UserModalProps {
  user: AppUser | null;
  contracts: Array<{ id: string; label: string }>;
  language: 'ar' | 'en';
  theme: string;
  onClose: () => void;
  onSave: (
    email: string,
    role: UserRole,
    permissions: UserPermissions,
    assignedContractIds: string[],
    password?: string,
    contact?: { phoneRaw: string; whatsappOptIn: boolean },
    visibleShellModules?: string[] | null,
  ) => Promise<void>;
}

function UserModal({ user, contracts, language, theme, onClose, onSave }: UserModalProps) {
  const { t } = useLanguage();
  const [email, setEmail] = useState(user?.email ?? '');
  const [password, setPassword] = useState('');
  const role: UserRole = user?.role ?? 'user';
  const [permissions, setPermissions] = useState<UserPermissions>(
    normalizeUserPermissions(user?.permissions ?? emptyPermissions())
  );
  const [assignedContractIds, setAssignedContractIds] = useState<string[]>(
    Array.isArray(user?.assignedContractIds) ? user!.assignedContractIds! : []
  );
  const [phoneRaw, setPhoneRaw] = useState(user?.phoneE164 ?? '');
  const [whatsappOptIn, setWhatsappOptIn] = useState(user?.whatsappOptIn === true);
  const [visibleShellModules, setVisibleShellModules] = useState<VisibleShellModuleId[] | null>(null);
  const [visibilityLoading, setVisibilityLoading] = useState(!!user);
  const [saving, setSaving] = useState(false);

  const isEdit = user !== null;
  const inputCls = cn(
    'w-full border rounded-xl py-2 px-4 text-sm outline-none focus:border-blue-500 transition-colors',
    theme === 'dark' ? 'bg-gray-900 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'
  );

  useEffect(() => {
    let cancelled = false;
    if (!user?.id) {
      setVisibleShellModules(null);
      setVisibilityLoading(false);
      return;
    }
    setVisibilityLoading(true);
    void (async () => {
      try {
        if (isLocalBackend) {
          const prefs = await settingsApi.getUserPreferencesForUser(user.id);
          if (!cancelled) {
            setVisibleShellModules(normalizeVisibleShellModules(prefs.visibleShellModules));
          }
        } else {
          const snap = await getDoc(doc(db, 'users', user.id));
          if (!cancelled) {
            setVisibleShellModules(
              normalizeVisibleShellModules(snap.exists() ? snap.data()?.visibleShellModules : null),
            );
          }
        }
      } catch (err) {
        console.warn('[settings] Failed to load visibleShellModules:', err);
        if (!cancelled) setVisibleShellModules(null);
      } finally {
        if (!cancelled) setVisibilityLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const selectedVisibleIds = visibleShellModules ?? [...VISIBLE_SHELL_MODULE_IDS];

  const toggleVisibleModule = (moduleId: VisibleShellModuleId) => {
    setVisibleShellModules((prev) => {
      const current = prev ?? [...VISIBLE_SHELL_MODULE_IDS];
      const next = current.includes(moduleId)
        ? current.filter((id) => id !== moduleId)
        : [...current, moduleId];
      return isFullVisibleShellModulesWhitelist(next) ? null : (next as VisibleShellModuleId[]);
    });
  };

  const handleSave = async () => {
    if (!email.trim()) return;
    if (!isEdit && isLocalBackend && password.trim().length < 8) {
      toast.error(t('user_password_required_new'));
      return;
    }
    if (isEdit && password.trim().length > 0 && password.trim().length < 8) {
      toast.error(t('user_password_min_hint'));
      return;
    }
    setSaving(true);
    try {
      if (whatsappOptIn && !phoneRaw.trim()) {
        toast.error(t('whatsapp_user_phone_invalid'));
        return;
      }
      const visibilityToSave = isFullVisibleShellModulesWhitelist(visibleShellModules)
        ? null
        : (visibleShellModules ?? null);
      await onSave(
        email.trim(),
        role,
        permissions,
        assignedContractIds,
        password.trim() || undefined,
        isLocalBackend ? { phoneRaw: phoneRaw.trim(), whatsappOptIn } : undefined,
        visibilityToSave,
      );
      setPassword('');
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const dir = language === 'ar' ? 'rtl' : 'ltr';

  return (
    <SettingsFloatingDialog
      open
      theme={theme}
      dir={dir}
      layer="base"
      closeOnBackdrop={!saving}
      onClose={onClose}
      panelClassName="max-w-3xl"
    >
      <div
        className={cn(
          'flex max-h-[calc(100vh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border shadow-2xl sm:max-h-[calc(100vh-3rem)]',
          theme === 'dark' ? 'bg-[#1a1d23] border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-900'
        )}
        dir={dir}
      >
        {/* Header */}
        <div className={cn(
          'flex shrink-0 items-center justify-between border-b p-5 sm:p-6',
          theme === 'dark' ? 'border-gray-700' : 'border-gray-200'
        )}>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-900/20 rounded-lg text-blue-500">
              <UserPlus size={18} />
            </div>
            <h3 className="font-bold text-lg">
              {isEdit
                ? (language === 'ar' ? 'تعديل مستخدم' : 'Edit User')
                : (language === 'ar' ? 'إضافة مستخدم جديد' : 'Add New User')}
            </h3>
          </div>
          <button type="button" onClick={onClose} aria-label={language === 'ar' ? 'إغلاق' : 'Close'} className="text-gray-400 hover:text-gray-200 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          {/* Email */}
          <div className="mb-4">
            <label className="block text-xs font-bold text-gray-400 uppercase mb-1">
              {language === 'ar' ? 'البريد الإلكتروني' : 'Email'}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isEdit && !user?.isPending}
              placeholder="user@company.com"
              className={cn(inputCls, isEdit && !user?.isPending && 'opacity-60 cursor-not-allowed')}
            />
            {isEdit && !user?.isPending && (
              <p className="text-xs text-gray-500 mt-1">
                {language === 'ar' ? 'لا يمكن تغيير البريد لمستخدم مسجّل' : 'Email cannot be changed for signed-in users'}
              </p>
            )}
          </div>

          {isLocalBackend && (
            <div className="mb-4">
              <label className="block text-xs font-bold text-gray-400 uppercase mb-1">
                {t('user_password_label')}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder={isEdit ? t('user_password_reset_hint') : t('user_password_min_hint')}
                className={inputCls}
              />
              <p className="text-xs text-gray-500 mt-1">
                {isEdit
                  ? t('user_password_reset_hint')
                  : t('user_password_required_new')}
              </p>
            </div>
          )}

          {isLocalBackend && (
            <div className={cn('mb-5 p-4 rounded-xl border space-y-3', theme === 'dark' ? 'border-gray-700 bg-gray-900/40' : 'border-gray-200 bg-gray-50')}>
              <div className="flex items-center gap-2 text-sm font-bold text-green-600">
                <MessageCircle size={16} />
                {t('whatsapp_module_title')}
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">
                  {t('whatsapp_user_phone')}
                </label>
                <input
                  type="tel"
                  value={phoneRaw}
                  onChange={(e) => setPhoneRaw(e.target.value)}
                  placeholder="+201012345678"
                  dir="ltr"
                  className={cn(inputCls, 'font-mono')}
                />
                <p className="text-xs text-gray-500 mt-1">{t('whatsapp_user_phone_hint')}</p>
              </div>
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={whatsappOptIn}
                  onChange={(e) => setWhatsappOptIn(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium block">{t('whatsapp_user_opt_in')}</span>
                  <span className="text-xs text-gray-500">{t('whatsapp_user_opt_in_hint')}</span>
                </span>
              </label>
            </div>
          )}

          <div className="mb-5">
            <label className="block text-xs font-bold text-gray-400 uppercase mb-1">
              {t('user_contracts_label')}
            </label>
            <p className="text-xs text-gray-500 mb-2">
              {t('user_contracts_hint')}
            </p>
            <div className={cn(
              'max-h-48 overflow-y-auto rounded-xl border p-3 space-y-2',
              theme === 'dark' ? 'border-gray-700 bg-gray-900/40' : 'border-gray-200 bg-gray-50'
            )}>
              {contracts.length === 0 && (
                <p className="text-xs text-gray-500">
                  {language === 'ar' ? 'لا توجد عقود متاحة حالياً.' : 'No contracts available yet.'}
                </p>
              )}
              {contracts.map((c, ci) => {
                const checked = assignedContractIds.includes(c.id);
                return (
                  <label key={listKey(c.id, ci, 'user-contract')} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        setAssignedContractIds((prev) => {
                          if (e.target.checked) return [...prev, c.id];
                          return prev.filter((id) => id !== c.id);
                        });
                      }}
                    />
                    <span>{c.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Permissions — granular sub-view editor */}
          <PermissionsEditor
            permissions={permissions}
            setPermissions={setPermissions}
            language={language}
            theme={theme}
          />

          {/* UI-only shell module visibility (does not change permissions / API) */}
          <div
            className={cn(
              'mt-4 rounded-xl border p-4',
              theme === 'dark' ? 'border-gray-700 bg-gray-900/40' : 'border-gray-200 bg-gray-50',
            )}
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div>
                <p className="text-sm font-bold">{t('user_visible_modules_title')}</p>
                <p className="text-xs text-gray-500 mt-0.5">{t('user_visible_modules_hint')}</p>
              </div>
              <button
                type="button"
                onClick={() => setVisibleShellModules(null)}
                className="shrink-0 text-xs font-bold text-blue-500 hover:underline"
              >
                {t('user_visible_modules_show_all')}
              </button>
            </div>
            {visibilityLoading ? (
              <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
                <Loader2 size={14} className="animate-spin" />
                {language === 'ar' ? 'جاري التحميل…' : 'Loading…'}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                {VISIBLE_SHELL_MODULE_IDS.map((moduleId) => {
                  const labels = MODULE_LABELS[moduleId];
                  const label = labels
                    ? language === 'ar'
                      ? labels.ar
                      : labels.en
                    : moduleId;
                  const checked = selectedVisibleIds.includes(moduleId);
                  return (
                    <label
                      key={moduleId}
                      className={cn(
                        'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors',
                        checked
                          ? theme === 'dark'
                            ? 'border-blue-600/50 bg-blue-900/20'
                            : 'border-blue-300 bg-blue-50'
                          : theme === 'dark'
                            ? 'border-gray-700 hover:bg-gray-800'
                            : 'border-gray-200 hover:bg-white',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="rounded border-gray-400"
                        checked={checked}
                        onChange={() => toggleVisibleModule(moduleId)}
                      />
                      <span className="truncate">{label}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className={cn(
          'flex shrink-0 gap-3 border-t p-4 sm:px-6',
          theme === 'dark' ? 'border-gray-700' : 'border-gray-200'
        )}>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              'flex-1 py-2 rounded-xl border text-sm font-bold transition-colors',
              theme === 'dark' ? 'border-gray-700 text-gray-400 hover:bg-gray-800' : 'border-gray-300 text-gray-500 hover:bg-gray-100'
            )}
          >
            {language === 'ar' ? 'إلغاء' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !email.trim()}
            className="flex-1 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 disabled:text-blue-700 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {language === 'ar' ? 'حفظ' : 'Save'}
          </button>
        </div>
      </div>
    </SettingsFloatingDialog>
  );
}

async function writeEmailProfile(
  email: string,
  role: UserRole,
  permissions: UserPermissions,
  assignedContractIds: string[],
  assignedProjectIds: string[] = [],
) {
  const emailKey = email.trim().toLowerCase();
  if (!emailKey) return;
  await setDoc(
    doc(db, 'email_profiles', emailKey),
    {
      email: emailKey,
      role,
      permissions,
      assignedContractIds,
      assignedProjectIds,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

// ─── WhatsApp module toggle (admin · local backend) ───────────────────────────
function WhatsAppModulePanel({ theme, t }: { theme: string; t: (key: string) => string }) {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void settingsApi
      .getWhatsAppNotifications()
      .then((cfg) => { if (!cancelled) setEnabled(cfg.enabled); })
      .catch(() => { if (!cancelled) setEnabled(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleToggle = async () => {
    setSaving(true);
    try {
      const next = !enabled;
      await settingsApi.patchWhatsAppNotifications(next);
      setEnabled(next);
      toast.success(t('whatsapp_module_saved'));
    } catch {
      toast.error(t('whatsapp_module_save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const boxCls = cn(
    'mb-6 p-4 border rounded-xl flex items-center justify-between gap-4',
    theme === 'dark' ? 'bg-gray-900/50 border-gray-800' : 'bg-green-50/80 border-green-200',
  );

  return (
    <div className={boxCls}>
      <div className="flex items-start gap-3 min-w-0">
        <div className="p-2 rounded-lg bg-green-600/15 text-green-600 shrink-0">
          <MessageCircle size={20} />
        </div>
        <div className="min-w-0">
          <p className="font-bold text-sm">{t('whatsapp_module_title')}</p>
          <p className="text-xs text-gray-500 mt-0.5">{t('whatsapp_module_desc')}</p>
        </div>
      </div>
      <button
        type="button"
        disabled={loading || saving}
        onClick={() => void handleToggle()}
        className={cn(
          'shrink-0 px-4 py-2 rounded-xl text-sm font-bold transition-colors flex items-center gap-2',
          enabled
            ? 'bg-green-600 hover:bg-green-500 text-white'
            : 'bg-gray-600 hover:bg-gray-500 text-white',
          (loading || saving) && 'opacity-60 cursor-not-allowed',
        )}
      >
        {saving && <Loader2 size={14} className="animate-spin" />}
        {enabled ? t('whatsapp_module_enabled') : t('whatsapp_module_disabled')}
      </button>
    </div>
  );
}

// ─── Users Section ─────────────────────────────────────────────────────────────
interface UsersSectionProps {
  language: 'ar' | 'en';
  theme: string;
  t: (key: string) => string;
  viewerIsAdmin: boolean;
}

function UsersSection({ language, theme, t, viewerIsAdmin }: UsersSectionProps) {
  const [existingUsers, setExistingUsers] = useState<AppUser[]>([]);
  const [contracts, setContracts] = useState<Array<{ id: string; projectId: string; label: string }>>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [adminUserVerifyOpen, setAdminUserVerifyOpen] = useState(false);
  const [usersRefreshKey, setUsersRefreshKey] = useState(0);
  const pendingUserOpRef = useRef<(() => Promise<void>) | null>(null);

  const loadLocalUsers = useCallback(async () => {
    const { users } = await authApi.userDirectory();
    setExistingUsers(
      users.map((u) => ({
        id: u.id,
        email: u.email,
        role: String(u.role ?? 'user') as UserRole,
        permissions: normalizeUserPermissions(u.permissions ?? DEFAULT_PERMISSIONS),
        assignedContractIds: Array.isArray(u.assignedContractIds) ? u.assignedContractIds : [],
        assignedProjectIds: [],
        phoneE164: u.phoneE164 ?? null,
        whatsappOptIn: u.whatsappOptIn === true,
        preferredLanguage: u.preferredLanguage === 'en' ? 'en' : 'ar',
      })),
    );
  }, []);

  const { data: apiContracts } = useApiQuery<{
    id: string;
    projectId: string;
    contractName?: string;
    contractNumber?: string;
    isDeleted?: boolean;
  }>(
    async () => (await contractsApi.list()) as Array<{
      id: string;
      projectId: string;
      contractName?: string;
      contractNumber?: string;
      isDeleted?: boolean;
    }>,
    [usersRefreshKey],
    { enabled: isLocalBackend, refreshKey: usersRefreshKey },
  );

  useEffect(() => {
    if (!isLocalBackend) return;
    setContracts(
      apiContracts
        .filter((c) => c.isDeleted !== true && c.projectId)
        .map((c) => ({
          id: c.id,
          projectId: String(c.projectId),
          label: String(c.contractName || c.contractNumber || c.id),
        })),
    );
  }, [apiContracts]);

  useEffect(() => {
    if (!viewerIsAdmin || !isLocalBackend) return;
    let cancelled = false;
    void authApi.syncEmailProfiles().catch((err) => {
      if (!cancelled) console.warn('email_profiles server sync:', err);
    });
    return () => {
      cancelled = true;
    };
  }, [viewerIsAdmin]);

  useEffect(() => {
    if (isLocalBackend) {
      let cancelled = false;
      void loadLocalUsers()
        .catch((err) => {
          console.error('Error loading users from API:', err);
          toast.error(language === 'ar' ? 'فشل تحميل المستخدمين' : 'Failed to load users');
        })
        .finally(() => {
          if (cancelled) return;
        });
      return () => {
        cancelled = true;
      };
    }

    const unsubUsers = listenQuery(collection(db, 'users'), (snap) => {
      setExistingUsers(
        snap.docs.map((d) => ({
          id: d.id,
          email: d.data().email ?? '',
          role: String(d.data().role ?? 'user') as UserRole,
          permissions: normalizeUserPermissions(d.data().permissions ?? ALL_PERMISSIONS),
          assignedContractIds: Array.isArray(d.data().assignedContractIds) ? d.data().assignedContractIds : [],
          assignedProjectIds: Array.isArray(d.data().assignedProjectIds) ? d.data().assignedProjectIds : [],
        }))
      );
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'users');
    });

    const unsubContracts = listenQuery(
      query(collection(db, 'contracts'), limit(1000)),
      (snap) => {
        setContracts(
          snap.docs
            .map((d) => ({
              id: d.id,
              projectId: String(d.data().projectId || ''),
              label: String(d.data().contractName || d.data().contractNumber || d.id),
              isDeleted: d.data().isDeleted === true,
            }))
            .filter((c) => !c.isDeleted)
            .map(({ id, projectId, label }) => ({ id, projectId, label }))
        );
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'contracts');
      }
    );

    return () => { unsubUsers(); unsubContracts(); };
  }, [isLocalBackend, loadLocalUsers, language, usersRefreshKey]);

  const executeSave = async (
    email: string,
    role: UserRole,
    permissions: UserPermissions,
    assignedContractIds: string[],
    password?: string,
    contact?: { phoneRaw: string; whatsappOptIn: boolean },
    visibleShellModules?: string[] | null,
  ) => {
    const assignedProjectIds = Array.from(
      new Set(
        contracts
          .filter((c) => assignedContractIds.includes(c.id))
          .map((c) => c.projectId)
          .filter(Boolean)
      )
    );
    const passwordChanged = !!password && password.length >= 8;
    try {
      let savedUserId = editingUser?.id ?? '';
      if (isLocalBackend) {
        const saved = await authApi.syncFirebaseUser(
          email,
          role,
          permissions,
          assignedContractIds,
          undefined,
          passwordChanged ? password : undefined,
        );
        savedUserId = saved.id;
        if (contact) {
          await settingsApi.patchUserContact(saved.id, {
            phoneE164: contact.phoneRaw || null,
            whatsappOptIn: contact.whatsappOptIn,
          });
        }
        if (visibleShellModules !== undefined && savedUserId) {
          await settingsApi.patchUserPreferencesForUser(savedUserId, {
            visibleShellModules: normalizeVisibleShellModules(visibleShellModules),
          });
        }
        setUsersRefreshKey((k) => k + 1);
      }
      if (!isLocalBackend) {
        await writeEmailProfile(email, role, permissions, assignedContractIds, assignedProjectIds);
      }
      if (!isLocalBackend && editingUser) {
        await updateDoc(doc(db, 'users', editingUser.id), {
          role,
          permissions,
          assignedContractIds,
          assignedProjectIds,
          ...(visibleShellModules !== undefined
            ? { visibleShellModules: normalizeVisibleShellModules(visibleShellModules) }
            : {}),
        });
        savedUserId = editingUser.id;
      }
      if (visibleShellModules !== undefined) {
        let meEmail = auth.currentUser?.email?.trim().toLowerCase() ?? '';
        if (!meEmail && isLocalBackend) {
          try {
            const me = await authApi.me();
            meEmail = String(me.email ?? '').trim().toLowerCase();
          } catch {
            /* ignore */
          }
        }
        if (meEmail && email.trim().toLowerCase() === meEmail) {
          emitUserPrefsUpdated({
            reloadVisibleShellModules: true,
            visibleShellModules: normalizeVisibleShellModules(visibleShellModules),
          });
        }
      }
      if (passwordChanged) {
        toast.success(t('user_password_saved'));
      } else {
        toast.success(language === 'ar' ? 'تم حفظ المستخدم بنجاح' : 'User saved successfully');
      }
    } catch (error) {
      console.error('Error saving user:', error);
      const code =
        error instanceof ApiError
          ? (error.payload as { error?: string } | undefined)?.error
          : undefined;
      if (code === 'password_too_short') {
        toast.error(t('user_password_min_hint'));
      } else if (code === 'invalid_phone' || code === 'phone_required_for_whatsapp') {
        toast.error(t('whatsapp_user_phone_invalid'));
      } else if (passwordChanged) {
        toast.error(t('user_password_save_failed'));
      } else {
        toast.error(language === 'ar' ? 'خطأ في حفظ المستخدم' : 'Error saving user');
      }
      throw error;
    }
  };

  const handleSave = async (
    email: string,
    role: UserRole,
    permissions: UserPermissions,
    assignedContractIds: string[],
    password?: string,
    contact?: { phoneRaw: string; whatsappOptIn: boolean },
    visibleShellModules?: string[] | null,
  ) => {
    const grantingSettings =
      permissions.settings === true
      && (!editingUser || editingUser.permissions.settings !== true);
    const sensitive = grantingSettings;

    if (sensitive && !viewerIsAdmin) {
      toast.error(language === 'ar' ? 'لا تملك صلاحية هذا الإجراء.' : 'You do not have permission for this action.');
      return;
    }
    if (sensitive && viewerIsAdmin) {
      pendingUserOpRef.current = () =>
        executeSave(email, role, permissions, assignedContractIds, password, contact, visibleShellModules);
      setAdminUserVerifyOpen(true);
      return;
    }
    await executeSave(email, role, permissions, assignedContractIds, password, contact, visibleShellModules);
  };

  const executeDeleteUser = async (user: AppUser) => {
    try {
      if (isLocalBackend) {
        await authApi.deactivateFirebaseUser(user.email);
        setUsersRefreshKey((k) => k + 1);
      } else {
        await deleteDoc(doc(db, 'users', user.id));
      }
      toast.success(language === 'ar' ? 'تم حذف المستخدم' : 'User deleted');
    } catch (error) {
      console.error('Error removing user:', error);
      toast.error(language === 'ar' ? 'خطأ في حذف المستخدم' : 'Error deleting user');
    }
  };

  const handleDeleteUser = async (user: AppUser) => {
    if (user.permissions.settings === true && viewerIsAdmin) {
      pendingUserOpRef.current = () => executeDeleteUser(user);
      setAdminUserVerifyOpen(true);
      return;
    }
    await executeDeleteUser(user);
  };

  const openEdit = (u: AppUser) => { setEditingUser(u); setShowModal(true); };
  const openAdd = () => { setEditingUser(null); setShowModal(true); };

  const cardCls = cn(
    'p-4 border rounded-xl flex items-center justify-between gap-4',
    theme === 'dark' ? 'bg-gray-900/50 border-gray-800' : 'bg-gray-50 border-gray-200'
  );

  const renderUser = (u: AppUser, index: number) => {
    const activeModules = ALL_PERMISSION_MODULES
      .filter((m) => moduleAccess(u.permissions, m.id).view)
      .map((m) => (language === 'ar' ? m.ar : m.en))
      .join('، ');

    const isMe = u.email === auth.currentUser?.email;

    return (
      <div key={listKey(u.id, index, 'settings-user')} className={cardCls}>
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn(
            'w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0',
            u.permissions.settings ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'
          )}>
            {u.email.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm truncate">{u.email}</span>
              {isMe && (
                <span className="text-xs bg-blue-600/20 text-blue-400 px-2 py-0.5 rounded-full">
                  {language === 'ar' ? 'أنت' : 'You'}
                </span>
              )}
              {u.isPending && (
                <span className="text-xs bg-yellow-600/20 text-yellow-400 px-2 py-0.5 rounded-full">
                  {language === 'ar' ? 'في الانتظار' : 'Pending'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              {u.permissions.settings && (
                <span className="text-xs font-bold text-blue-400">
                  {t('user_settings_badge')}
                </span>
              )}
              <span className="text-xs text-gray-500 truncate" title={activeModules}>
                {activeModules || (language === 'ar' ? 'بدون صلاحيات' : 'No access')}
              </span>
            </div>
            {isLocalBackend && u.phoneE164 && (
              <div className="flex items-center gap-1.5 mt-1">
                <MessageCircle size={12} className={u.whatsappOptIn ? 'text-green-500' : 'text-gray-500'} />
                <span className="text-xs font-mono text-gray-500" dir="ltr">{u.phoneE164}</span>
                {u.whatsappOptIn && (
                  <span className="text-[10px] text-green-600 font-bold uppercase">WA</span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => openEdit(u)}
            className="p-2 rounded-lg text-gray-400 hover:text-blue-400 hover:bg-blue-900/20 transition-colors"
            title={language === 'ar' ? 'تعديل' : 'Edit'}
          >
            <Pencil size={16} />
          </button>
          {!isMe && (
            <button
              type="button"
              onClick={() => void handleDeleteUser(u)}
              className="p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-900/20 transition-colors"
              title={language === 'ar' ? 'حذف' : 'Remove'}
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-900/20 rounded-lg text-purple-500">
            <Users size={24} />
          </div>
          <h3 className="text-xl font-bold">{t('user_settings')}</h3>
          <ManualHelpButton topicId="settings.users.manage" size={14} />
        </div>
        {isLocalBackend && (
          <button
            type="button"
            onClick={openAdd}
            className="flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 px-4 py-2 text-sm font-bold text-white transition-colors"
          >
            <UserPlus size={16} />
            {t('user_add_button')}
          </button>
        )}
      </div>

      {isLocalBackend && viewerIsAdmin && (
        <WhatsAppModulePanel theme={theme} t={t} />
      )}

      {/* Users list */}
      <div className="space-y-2">
        {existingUsers.length === 0 ? (
          <p className="text-sm text-gray-500">{language === 'ar' ? 'لا يوجد مستخدمون بعد' : 'No users yet'}</p>
        ) : (
          existingUsers.map((u, i) => renderUser(u, i))
        )}
      </div>

      {/* Legend */}
      <div className={cn('p-4 rounded-xl border flex items-start gap-3', theme === 'dark' ? 'border-gray-800 bg-gray-900/30' : 'border-gray-200 bg-gray-50')}>
        <Shield size={16} className="text-blue-400 shrink-0 mt-0.5" />
        <p className="text-xs text-gray-400">
          {language === 'ar'
            ? 'يظهر هنا كل مستخدم سجّل دخوله بحساب Google. المدير يُحدّد الصلاحيات من هذه الصفحة.'
            : 'Every user who signs in with Google appears here. Admin assigns permissions from this page.'}
        </p>
      </div>

      {showModal && !adminUserVerifyOpen && (
        <UserModal
          user={editingUser}
          contracts={contracts}
          language={language as 'ar' | 'en'}
          theme={theme}
          onClose={() => { setShowModal(false); setEditingUser(null); }}
          onSave={handleSave}
        />
      )}

      <AdminSensitiveVerifyModal
        open={adminUserVerifyOpen}
        onOpenChange={(v) => {
          setAdminUserVerifyOpen(v);
          if (!v) pendingUserOpRef.current = null;
        }}
        language={language}
        theme={theme}
        onVerified={async () => {
          const fn = pendingUserOpRef.current;
          pendingUserOpRef.current = null;
          if (fn) await fn();
        }}
      />
    </div>
  );
}

// ─── Main Settings Component ───────────────────────────────────────────────────

function resolveSettingsSectionTopic(section: string): ManualTopicId {
  switch (section) {
    case 'users':
      return 'settings.users.manage';
    case 'coa':
      return 'settings.coa.tree';
    case 'cost_centers':
      return 'settings.cost_centers.indirect';
    default:
      return 'settings.database.backup';
  }
}

export function Settings() {
  const { language, theme, setTheme, dir, t } = useLanguage();
  const { can, isAdmin } = usePermissions();
  const ledgerPerm = can('ledger');
  const [activeSection, setActiveSection] = useState('database');
  const { isErpShell, activeViewId: erpViewId, isActiveModule } = useErpModuleView('settings', 'database');

  const settingsSectionIds = useMemo(
    () => ['database', 'users', 'coa', 'cost_centers', 'activity', 'sample_data'] as const,
    [],
  );

  useEffect(() => {
    if (isErpShell && isActiveModule) {
      if ((settingsSectionIds as readonly string[]).includes(erpViewId)) {
        setActiveSection(erpViewId);
      }
      return;
    }
    const pending = consumePendingShellView('settings');
    if (pending && (settingsSectionIds as readonly string[]).includes(pending)) {
      setActiveSection(pending);
    }
  }, [erpViewId, isErpShell, isActiveModule, settingsSectionIds]);
  const [loading, setLoading] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Clear data state
  const [dangerOpen, setDangerOpen] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [showClearModal, setShowClearModal] = useState(false);
  const [showFactoryModal, setShowFactoryModal] = useState(false);
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [lastImportReport, setLastImportReport] = useState<BackupImportResultSummary | null>(() =>
    readLastBackupImportReport(),
  );

  useEffect(() => {
    if (!showBackupModal) {
      setLastImportReport(readLastBackupImportReport());
    }
  }, [showBackupModal]);

  const toggleGroup = (id: string) =>
    setSelectedGroups((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const visibleClearGroups = useMemo(
    () => clearDataGroupsForBackend(isLocalBackend),
    [isLocalBackend]
  );
  const selectAll = () => setSelectedGroups(new Set(visibleClearGroups.map((g) => g.id)));
  const selectNone = () => setSelectedGroups(new Set());

  useEffect(() => {
    const fetchUserTheme = async () => {
      if (!auth.currentUser || isLocalBackend) return;
      try {
        const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          if (data.defaultTheme && isAppTheme(data.defaultTheme as string)) {
            setTheme(data.defaultTheme as import('../lib/shellTheme').AppTheme);
          }
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, 'users');
      }
    };
    void fetchUserTheme();
  }, [setTheme]);

  const sections = [
    { id: 'database', label: t('database_settings'), icon: Database },
    { id: 'users',    label: t('user_settings'),    icon: Users },
    ...(ledgerPerm.view
      ? [{ id: 'coa', label: t('coa_setup_section'), icon: FolderTree }]
      : []),
    ...(isAdmin && isLocalBackend
      ? [{ id: 'cost_centers', label: t('indirect_centers_section'), icon: Building2 }]
      : []),
    ...(isAdmin
      ? [
          { id: 'activity', label: t('activity_log_section'), icon: ScrollText },
          { id: 'sample_data', label: language === 'ar' ? 'بيانات تجريبية' : 'Sample Data', icon: FlaskConical },
        ]
      : []),
  ];

  const shellSurface = cn(
    theme === 'dark' && 'bg-[#0a0a0a] text-gray-100',
    theme === 'erp' && 'bg-transparent text-[var(--erp-text)]',
    theme === 'soft' && 'bg-[#eceff1] text-[#37474f]',
    theme === 'light' && 'bg-gray-50 text-gray-900',
  );

  const contentPanelCls = cn(
    'flex-1 border rounded-2xl p-8 shadow-xl',
    theme === 'dark' && 'bg-[#151619] border-gray-800',
    theme === 'erp' && 'bg-white/95 border-[var(--erp-border)] shadow-sm',
    isSoftLikeTheme(theme) && theme !== 'erp' && 'bg-white/90 border-[#cfd8dc]',
    theme === 'light' && 'bg-white border-gray-200',
  );

  const navInactiveCls = cn(
    'text-gray-400',
    theme === 'dark' && 'hover:bg-gray-900 hover:text-gray-200',
    theme === 'erp' && 'hover:bg-[var(--erp-accent-soft)] hover:text-[var(--erp-primary)]',
    theme === 'soft' && 'hover:bg-[#cfd8dc] hover:text-[#37474f]',
    theme === 'light' && 'hover:bg-gray-200 hover:text-gray-900',
  );

  return (
    <div
      className={cn('p-8 min-h-screen transition-colors', shellSurface)}
      dir={dir}
    >
      <header className="flex justify-between items-center mb-8">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-3xl font-bold tracking-tight">{t('settings')}</h2>
            <ManualHelpButton topicId={resolveSettingsSectionTopic(activeSection)} size={16} />
          </div>
          <p className="text-gray-400 mt-1">
            {language === 'ar' ? 'تخصيص بيئة العمل، إدارة الصلاحيات، وضبط المخرجات' : 'Customize workspace, manage permissions, and adjust outputs'}
          </p>
        </div>
      </header>

      <div className="flex gap-8">
        {/* Section nav */}
        <div className="w-64 space-y-2">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => setActiveSection(section.id)}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all',
                language === 'ar' ? 'text-right' : 'text-left',
                activeSection === section.id
                  ? 'bg-blue-600/10 text-blue-500 border border-blue-600/20 shadow-inner'
                  : navInactiveCls,
              )}
            >
              <section.icon size={20} />
              <span className="font-bold text-sm">{section.label}</span>
            </button>
          ))}
        </div>

        {/* Content */}
        <div className={contentPanelCls}>
          <AnimatePresence mode="wait">

            {activeSection === 'database' && (
              <motion.div key="database" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-blue-900/20 rounded-lg text-blue-500"><Database size={24} /></div>
                  <h3 className="text-xl font-bold">{language === 'ar' ? 'اتصال قاعدة البيانات (Firebase)' : 'Database Connection (Firebase)'}</h3>
                </div>
                <div className="grid grid-cols-1 gap-4">
                  <div className={cn('p-4 border rounded-xl', theme === 'dark' ? 'bg-gray-900/50 border-gray-800' : 'bg-gray-50 border-gray-200')}>
                    <p className="text-xs text-gray-500 font-bold uppercase mb-2">Project ID</p>
                    <code className="text-blue-400 font-mono">{firebaseConfig.projectId}</code>
                  </div>
                  <div className={cn('p-4 border rounded-xl', theme === 'dark' ? 'bg-gray-900/50 border-gray-800' : 'bg-gray-50 border-gray-200')}>
                    <p className="text-xs text-gray-500 font-bold uppercase mb-2">Database ID</p>
                    <code className="text-green-400 font-mono">{firebaseConfig.firestoreDatabaseId || '(default)'}</code>
                  </div>
                </div>

                {/* ── Backup / Restore ── */}
                <div className={cn('border rounded-2xl p-5', theme === 'dark' ? 'border-gray-800 bg-gray-900/30' : 'border-gray-200 bg-gray-50')}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={cn('p-2 rounded-lg', theme === 'dark' ? 'bg-blue-900/20 text-blue-400' : 'bg-blue-50 text-blue-600')}>
                        <HardDrive size={20} />
                      </div>
                      <div>
                        <p className="font-bold text-sm">{language === 'ar' ? 'النسخ الاحتياطي والاسترجاع' : 'Backup & Restore'}</p>
                        <p className={cn('text-xs mt-0.5', theme === 'dark' ? 'text-gray-500' : 'text-gray-400')}>
                          {language === 'ar' ? 'تصدير جميع البيانات أو استيراد نسخة سابقة' : 'Export all data or import a previous backup'}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowBackupModal(true)}
                      className={cn(
                        'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-colors',
                        theme === 'dark' ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white'
                      )}
                    >
                      <HardDrive size={16} />
                      {language === 'ar' ? 'فتح' : 'Open'}
                    </button>
                    <ManualHelpButton topicId="settings.database.backup" size={14} />
                  </div>
                  {lastImportReport && (
                    <div className="mt-4">
                      <BackupImportReportPanel
                        summary={lastImportReport}
                        language={language as 'ar' | 'en'}
                        theme={theme}
                        onDismiss={() => {
                          clearLastBackupImportReport();
                          setLastImportReport(null);
                        }}
                      />
                    </div>
                  )}
                </div>

                {isLocalBackend && isAdmin && (
                  <PushToProductionPanel language={language as 'ar' | 'en'} theme={theme} />
                )}

                {isLocalBackend && isAdmin && (
                  <BackfillBoqRatesPanel language={language as 'ar' | 'en'} theme={theme} />
                )}

                {/* ── Data Maintenance (admins only) ── */}
                {isAdmin ? (
                <div className={cn('border rounded-2xl overflow-hidden', theme === 'dark' ? 'border-gray-700' : 'border-gray-200')}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setDangerOpen((o) => !o)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setDangerOpen((o) => !o);
                      }
                    }}
                    className={cn(
                      'w-full flex items-center justify-between px-5 py-4 transition-colors cursor-pointer',
                      language === 'ar' ? 'text-right' : 'text-left',
                      theme === 'dark' ? 'bg-gray-800/60 hover:bg-gray-800 text-gray-300' : 'bg-gray-50 hover:bg-gray-100 text-gray-700'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <HardDrive size={20} />
                      <span className="font-bold">{language === 'ar' ? 'صيانة البيانات' : 'Data Maintenance'}</span>
                      <span
                        className="inline-flex"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <ManualHelpButton topicId="settings.database.maintenance" size={12} />
                      </span>
                    </div>
                    {dangerOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </div>

                  {dangerOpen && (
                    <div className={cn('p-5 space-y-4', theme === 'dark' ? 'bg-[#1a1d23]' : 'bg-white')}>
                      {isLocalBackend && (
                        <div className={cn('border-2 rounded-2xl p-4 space-y-3', theme === 'dark' ? 'border-red-800 bg-red-950/20' : 'border-red-300 bg-red-50')}>
                          <p className="font-bold text-sm text-red-500">{t('settings_factory_reset_btn')}</p>
                          <p className={cn('text-xs', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>
                            {t('settings_factory_reset_hint')}
                          </p>
                          <button
                            type="button"
                            onClick={() => setShowFactoryModal(true)}
                            className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-bold transition-colors"
                          >
                            <RotateCcw size={16} />
                            {t('settings_factory_reset_btn')}
                          </button>
                        </div>
                      )}

                      <p className={cn('text-sm', theme === 'dark' ? 'text-gray-400' : 'text-gray-500')}>
                        {isLocalBackend
                          ? (language === 'ar'
                            ? 'PostgreSQL — اختر الوحدات المراد مسحها. نفّذ نسخة احتياطية أولاً. العملية لا يمكن التراجع عنها.'
                            : 'PostgreSQL — select modules to wipe. Back up first. This cannot be undone.')
                          : (language === 'ar'
                            ? 'Firestore — اختر المجموعات المراد مسحها. العملية لا يمكن التراجع عنها.'
                            : 'Firestore — select collections to erase. This cannot be undone.')}
                      </p>

                      {/* Select all / none */}
                      <div className="flex gap-3 text-sm">
                        <button type="button" onClick={selectAll} className="text-blue-400 hover:underline font-bold">
                          {language === 'ar' ? 'تحديد الكل' : 'Select All'}
                        </button>
                        <span className="text-gray-600">·</span>
                        <button type="button" onClick={selectNone} className="text-gray-400 hover:underline">
                          {language === 'ar' ? 'إلغاء الكل' : 'Deselect All'}
                        </button>
                      </div>

                      {/* Group checkboxes */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-96 overflow-y-auto pr-1">
                        {visibleClearGroups.map((g) => {
                          const checked = selectedGroups.has(g.id);
                          return (
                            <label
                              key={g.id}
                              className={cn(
                                'flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all select-none',
                                checked
                                  ? theme === 'dark' ? 'border-red-700 bg-red-950/30' : 'border-red-300 bg-red-50'
                                  : theme === 'dark' ? 'border-gray-800 hover:border-gray-700' : 'border-gray-200 hover:border-gray-300'
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleGroup(g.id)}
                                className="sr-only"
                              />
                              <div className={cn(
                                'w-4 h-4 rounded border flex items-center justify-center shrink-0 mt-0.5',
                                checked ? 'bg-red-600 border-red-500' : theme === 'dark' ? 'border-gray-600' : 'border-gray-300'
                              )}>
                                {checked && <CheckCircle2 size={12} className="text-white" />}
                              </div>
                              <div>
                                <p className={cn('text-sm font-bold', checked ? 'text-red-400' : '')}>{language === 'ar' ? g.ar : g.en}</p>
                                <p className="text-xs text-gray-500 mt-0.5">{language === 'ar' ? g.warning.ar : g.warning.en}</p>
                              </div>
                            </label>
                          );
                        })}
                      </div>

                      {isLocalBackend && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedGroups(new Set(['financial_postgres']));
                            setShowClearModal(true);
                          }}
                          className={cn(
                            'w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl border-2 border-dashed text-sm font-bold transition-colors',
                            theme === 'dark'
                              ? 'border-amber-700/60 text-amber-300 hover:bg-amber-950/30'
                              : 'border-amber-400 text-amber-800 hover:bg-amber-50',
                          )}
                        >
                          <Trash2 size={16} />
                          {language === 'ar'
                            ? 'تفريغ الحركات المالية والتشغيلية (Postgres)'
                            : 'Wipe financial & operational (Postgres)'}
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={selectedGroups.size === 0}
                        onClick={() => setShowClearModal(true)}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 disabled:bg-red-900 disabled:text-red-700 text-white text-sm font-bold transition-colors"
                      >
                        <Trash2 size={16} />
                        {language === 'ar'
                          ? `حذف ${selectedGroups.size > 0 ? `(${selectedGroups.size})` : ''} وحدة محددة`
                          : `Delete ${selectedGroups.size > 0 ? `(${selectedGroups.size})` : ''} selected`}
                      </button>
                    </div>
                  )}
                </div>
                ) : null}

              </motion.div>
            )}

            {activeSection === 'users' && (
              <motion.div key="users" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <UsersSection language={language as 'ar' | 'en'} theme={theme} t={t} viewerIsAdmin={isAdmin} />
              </motion.div>
            )}

            {activeSection === 'coa' && ledgerPerm.view && (
              <motion.div key="coa" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <ChartOfAccountsSettingsPanel theme={theme} />
              </motion.div>
            )}

            {activeSection === 'cost_centers' && isAdmin && isLocalBackend && (
              <motion.div key="cost_centers" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-violet-900/20 rounded-lg text-violet-500"><Building2 size={24} /></div>
                  <h3 className="text-xl font-bold">{t('indirect_centers_section')}</h3>
                  <ManualHelpButton topicId="settings.cost_centers.indirect" size={14} />
                </div>
                <IndirectCostCentersPanel theme={theme} />
              </motion.div>
            )}

            {activeSection === 'activity' && isAdmin && (
              <motion.div key="activity" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <ActivityLogPanel />
              </motion.div>
            )}

            {activeSection === 'sample_data' && isAdmin && (
              <motion.div key="sample_data" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <SampleDataGeneratorPanel theme={theme} />
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </div>

      {showClearModal && (
        <ClearDataModal
          language={language as 'ar' | 'en'}
          theme={theme}
          selected={selectedGroups}
          onClose={() => { setShowClearModal(false); selectNone(); }}
        />
      )}

      {showFactoryModal && (
        <FactoryResetModal
          language={language as 'ar' | 'en'}
          theme={theme}
          onClose={() => setShowFactoryModal(false)}
        />
      )}

      {showBackupModal && (
        <BackupModal
          language={language as 'ar' | 'en'}
          theme={theme}
          onClose={() => setShowBackupModal(false)}
          allowFullReplace={isAdmin}
        />
      )}
    </div>
  );
}
