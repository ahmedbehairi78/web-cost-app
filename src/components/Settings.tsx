import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Database,
  Users,
  Monitor,
  Printer,
  Save,
  Palette,
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
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  collection,
  onSnapshot,
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
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../context/LanguageContext';
import { type UserPermissions, ALL_PERMISSIONS, MODULES, type AppUser } from '../types';

const firebaseConfig = {
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
  firestoreDatabaseId: import.meta.env.VITE_FIREBASE_DATABASE_ID as string,
};

// ─── Clear Data ────────────────────────────────────────────────────────────────

export const CLEAR_DATA_GROUPS = [
  {
    id: 'projects',
    ar: 'المشاريع',
    en: 'Projects',
    collections: ['projects'],
    warning: { ar: 'يشمل جميع بيانات المشاريع الأساسية', en: 'Includes all core project records' },
  },
  {
    id: 'contracts',
    ar: 'العقود وبنود الكميات',
    en: 'Contracts & BOQ',
    collections: ['contracts', 'boq_items'],
    warning: { ar: 'يشمل جميع العقود وبنود الكميات', en: 'Includes all contracts and BOQ items' },
  },
  {
    id: 'billing',
    ar: 'المستخلصات',
    en: 'Billing / IPCs',
    collections: ['billing'],
    warning: { ar: 'يشمل جميع مستخلصات العملاء', en: 'Includes all client billing records' },
  },
  {
    id: 'actual_costs',
    ar: 'التكاليف الفعلية',
    en: 'Actual Costs',
    collections: ['actual_costs'],
    warning: { ar: 'يشمل جميع سجلات التكاليف الفعلية', en: 'Includes all actual cost records' },
  },
  {
    id: 'purchases',
    ar: 'المشتريات والموردين',
    en: 'Purchases & Suppliers',
    collections: ['purchase_transactions', 'suppliers'],
    warning: { ar: 'يشمل فواتير الموردين وبيانات الموردين', en: 'Includes supplier invoices and supplier records' },
  },
  {
    id: 'gl',
    ar: 'قيود دفتر اليومية',
    en: 'GL Journal Entries',
    collections: ['transactions'],
    warning: { ar: 'يشمل جميع قيود المحاسبة', en: 'Includes all accounting journal entries' },
  },
  {
    id: 'coa',
    ar: 'دليل الحسابات',
    en: 'Chart of Accounts',
    collections: ['chart_of_accounts'],
    warning: { ar: 'يمسح الشجرة المحاسبية بالكامل', en: 'Wipes the entire account tree' },
  },
] as const;

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

const BACKUP_COLLECTIONS = [
  'projects', 'contracts', 'boq_items', 'billing',
  'actual_costs', 'purchase_transactions', 'suppliers',
  'transactions', 'chart_of_accounts',
];

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
  for (const col of BACKUP_COLLECTIONS) {
    onProgress(col);
    const snap = await getDocs(collection(db, col));
    data[col] = snap.docs.map((d) => ({ _id: d.id, ...serialiseValue(d.data()) as object }));
  }
  const payload = JSON.stringify({ exportedAt: new Date().toISOString(), version: 1, collections: data }, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
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

// ─── Backup / Restore Modal ────────────────────────────────────────────────────
interface BackupModalProps {
  language: 'ar' | 'en';
  theme: string;
  onClose: () => void;
}

function BackupModal({ language, theme, onClose }: BackupModalProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<'export' | 'import'>('export');
  const [restoreMode, setRestoreMode] = useState<RestoreMode>('merge');
  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [confirmReplace, setConfirmReplace] = useState('');

  const CONFIRM_WORD = language === 'ar' ? 'استبدال' : 'REPLACE';
  const needsConfirm = restoreMode === 'replace';
  const replaceConfirmed = confirmReplace === CONFIRM_WORD;

  const addProgress = (msg: string) => setProgress((p) => [...p, msg]);

  const handleExport = async () => {
    setRunning(true);
    setProgress([]);
    try {
      await exportBackup((col) => addProgress(language === 'ar' ? `تصدير: ${col}…` : `Exporting: ${col}…`));
      addProgress(language === 'ar' ? '✓ اكتمل التصدير' : '✓ Export complete');
      toast.success(language === 'ar' ? 'تم تنزيل النسخة الاحتياطية' : 'Backup downloaded');
    } catch {
      toast.error(language === 'ar' ? 'خطأ في التصدير' : 'Export error');
    }
    setRunning(false);
  };

  const handleImport = async () => {
    if (!file || (needsConfirm && !replaceConfirmed)) return;
    setRunning(true);
    setProgress([]);
    try {
      const { collections, records } = await importBackup(file, restoreMode, (col) =>
        addProgress(language === 'ar' ? `استيراد: ${col}…` : `Importing: ${col}…`)
      );
      addProgress(language === 'ar' ? `✓ اكتمل — ${collections} مجموعة، ${records} سجل` : `✓ Done — ${collections} collections, ${records} records`);
      toast.success(language === 'ar' ? `تم الاسترجاع: ${records} سجل` : `Restored: ${records} records`);
    } catch (e) {
      addProgress(`✗ ${(e as Error).message}`);
      toast.error(language === 'ar' ? 'خطأ في الاستيراد' : 'Import error');
    }
    setRunning(false);
  };

  const panelCls = cn(
    'w-full max-w-xl rounded-2xl border shadow-2xl',
    theme === 'dark' ? 'bg-[#1a1d23] border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-900'
  );
  const tabCls = (active: boolean) => cn(
    'flex-1 py-2.5 text-sm font-bold rounded-xl transition-colors',
    active ? 'bg-blue-600 text-white' : theme === 'dark' ? 'text-gray-400 hover:bg-gray-800' : 'text-gray-500 hover:bg-gray-100'
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <div className={panelCls}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/50">
          <div className="flex items-center gap-2 text-blue-400">
            <HardDrive size={20} />
            <h3 className="text-lg font-bold">{language === 'ar' ? 'النسخ الاحتياطي والاسترجاع' : 'Backup & Restore'}</h3>
          </div>
          {!running && (
            <button type="button" onClick={onClose} aria-label={language === 'ar' ? 'إغلاق' : 'Close'} className="text-gray-400 hover:text-gray-200">
              <X size={20} />
            </button>
          )}
        </div>

        <div className="p-6 space-y-5">
          {/* Tabs */}
          <div className={cn('flex gap-1 p-1 rounded-xl', theme === 'dark' ? 'bg-gray-900' : 'bg-gray-100')}>
            <button type="button" className={tabCls(tab === 'export')} onClick={() => { setTab('export'); setProgress([]); }}>
              <span className="flex items-center justify-center gap-2"><Download size={15} />{language === 'ar' ? 'تصدير نسخة احتياطية' : 'Export Backup'}</span>
            </button>
            <button type="button" className={tabCls(tab === 'import')} onClick={() => { setTab('import'); setProgress([]); }}>
              <span className="flex items-center justify-center gap-2"><Upload size={15} />{language === 'ar' ? 'استرجاع من نسخة' : 'Restore Backup'}</span>
            </button>
          </div>

          {/* Export tab */}
          {tab === 'export' && (
            <div className="space-y-4">
              <div className={cn('rounded-xl border p-4 text-sm space-y-2', theme === 'dark' ? 'bg-gray-900/50 border-gray-800' : 'bg-gray-50 border-gray-200')}>
                <p className="font-bold">{language === 'ar' ? 'المجموعات التي سيتم تصديرها:' : 'Collections to be exported:'}</p>
                <div className="flex flex-wrap gap-2 mt-1">
                  {BACKUP_COLLECTIONS.map((c) => (
                    <span key={c} className={cn('px-2 py-0.5 rounded-md text-xs font-mono', theme === 'dark' ? 'bg-blue-900/30 text-blue-300' : 'bg-blue-50 text-blue-700')}>{c}</span>
                  ))}
                </div>
                <p className={cn('text-xs mt-2', theme === 'dark' ? 'text-gray-500' : 'text-gray-400')}>
                  {language === 'ar' ? 'يُحفظ كملف JSON على جهازك.' : 'Saved as a JSON file on your device.'}
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
              <div className="grid grid-cols-2 gap-3">
                {(['merge', 'replace'] as RestoreMode[]).map((m) => (
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
                <div key={i} className={line.startsWith('✓') ? 'text-green-400' : line.startsWith('✗') ? 'text-red-400' : 'text-gray-400'}>{line}</div>
              ))}
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
    </div>
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

  const CONFIRM_WORD = language === 'ar' ? 'حذف' : 'DELETE';
  const confirmed = confirmText === CONFIRM_WORD;

  const selectedGroups = CLEAR_DATA_GROUPS.filter((g) => selected.has(g.id));
  const allCollections = selectedGroups.flatMap((g) => [...g.collections]);

  const handleDelete = async () => {
    if (!confirmed || running) return;
    setRunning(true);
    setProgress([]);
    let totalDeleted = 0;
    for (const col of allCollections) {
      setProgress((p) => [...p, language === 'ar' ? `جارٍ حذف: ${col}…` : `Deleting: ${col}…`]);
      try {
        const count = await batchDeleteCollection(col);
        totalDeleted += count;
        setProgress((p) => [...p, language === 'ar' ? `✓ ${col} — تم حذف ${count} سجل` : `✓ ${col} — deleted ${count} records`]);
      } catch (e) {
        setProgress((p) => [...p, language === 'ar' ? `✗ خطأ في ${col}` : `✗ Error in ${col}`]);
      }
    }
    toast.success(language === 'ar' ? `تم الحذف — ${totalDeleted} سجل` : `Done — ${totalDeleted} records deleted`);
    setRunning(false);
    onClose();
  };

  const panelCls = cn(
    'w-full max-w-lg rounded-2xl border shadow-2xl p-6',
    theme === 'dark' ? 'bg-[#1a1d23] border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-900'
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <div className={panelCls}>
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
              <span className="text-red-600/70">({g.collections.join(', ')})</span>
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
    </div>
  );
}

const EMPTY_PERMISSIONS: UserPermissions = {
  dashboard: true, ledger: true, projects: true, boq: true,
  billing: true, costs: true, suppliers: true, reports: true, settings: false,
};

// ─── User Modal ────────────────────────────────────────────────────────────────
interface UserModalProps {
  user: AppUser | null;
  language: 'ar' | 'en';
  theme: string;
  onClose: () => void;
  onSave: (email: string, role: 'admin' | 'user', permissions: UserPermissions) => Promise<void>;
}

function UserModal({ user, language, theme, onClose, onSave }: UserModalProps) {
  const [email, setEmail] = useState(user?.email ?? '');
  const [role, setRole] = useState<'admin' | 'user'>(user?.role ?? 'user');
  const [permissions, setPermissions] = useState<UserPermissions>(
    user?.permissions ?? EMPTY_PERMISSIONS
  );
  const [saving, setSaving] = useState(false);

  const isEdit = user !== null;
  const inputCls = cn(
    'w-full border rounded-xl py-2 px-4 text-sm outline-none focus:border-blue-500 transition-colors',
    theme === 'dark' ? 'bg-gray-900 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'
  );

  const handleSave = async () => {
    if (!email.trim()) return;
    setSaving(true);
    try {
      await onSave(email.trim(), role, permissions);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const toggleAll = (value: boolean) => {
    setPermissions(Object.fromEntries(MODULES.map((m) => [m.id, value])) as UserPermissions);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className={cn(
          'w-full max-w-md rounded-2xl shadow-2xl p-6 border',
          theme === 'dark' ? 'bg-[#1a1d23] border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-900'
        )}
        dir={language === 'ar' ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
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

        {/* Role */}
        <div className="mb-5">
          <label className="block text-xs font-bold text-gray-400 uppercase mb-2">
            {language === 'ar' ? 'الصلاحية' : 'Role'}
          </label>
          <div className="flex gap-3">
            {(['user', 'admin'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={cn(
                  'flex-1 py-2 rounded-xl border text-sm font-bold transition-all',
                  role === r
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : theme === 'dark'
                      ? 'border-gray-700 text-gray-400 hover:border-gray-500'
                      : 'border-gray-300 text-gray-500 hover:border-gray-400'
                )}
              >
                {r === 'admin'
                  ? (language === 'ar' ? 'مدير نظام' : 'Admin')
                  : (language === 'ar' ? 'مستخدم' : 'User')}
              </button>
            ))}
          </div>
        </div>

        {/* Permissions grid */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-bold text-gray-400 uppercase">
              {language === 'ar' ? 'صلاحيات الوحدات' : 'Module Access'}
            </label>
            <div className="flex gap-2 text-xs">
              <button type="button" onClick={() => toggleAll(true)} className="text-blue-400 hover:underline">
                {language === 'ar' ? 'الكل' : 'All'}
              </button>
              <span className="text-gray-600">|</span>
              <button type="button" onClick={() => toggleAll(false)} className="text-red-400 hover:underline">
                {language === 'ar' ? 'لا شيء' : 'None'}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {MODULES.map((mod) => (
              <label
                key={mod.id}
                className={cn(
                  'flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-all select-none',
                  permissions[mod.id]
                    ? 'border-blue-500/50 bg-blue-600/10 text-blue-400'
                    : theme === 'dark'
                      ? 'border-gray-700 text-gray-500 hover:border-gray-600'
                      : 'border-gray-200 text-gray-400 hover:border-gray-300'
                )}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={permissions[mod.id]}
                  onChange={(e) => setPermissions({ ...permissions, [mod.id]: e.target.checked })}
                />
                <div className={cn(
                  'w-4 h-4 rounded border flex items-center justify-center shrink-0',
                  permissions[mod.id] ? 'bg-blue-600 border-blue-500' : theme === 'dark' ? 'border-gray-600' : 'border-gray-300'
                )}>
                  {permissions[mod.id] && <CheckCircle2 size={10} className="text-white" />}
                </div>
                <span className="text-xs font-medium">
                  {language === 'ar' ? mod.ar : mod.en}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
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
      </motion.div>
    </div>
  );
}

// ─── Users Section ─────────────────────────────────────────────────────────────
interface UsersSectionProps {
  language: 'ar' | 'en';
  theme: string;
  t: (key: string) => string;
}

function UsersSection({ language, theme, t }: UsersSectionProps) {
  const [existingUsers, setExistingUsers] = useState<AppUser[]>([]);
  const [pendingUsers, setPendingUsers] = useState<AppUser[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);

  useEffect(() => {
    const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
      setExistingUsers(
        snap.docs.map((d) => ({
          id: d.id,
          email: d.data().email ?? '',
          role: d.data().role ?? 'user',
          permissions: d.data().permissions ?? ALL_PERMISSIONS,
        }))
      );
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'users');
    });

    const unsubPending = onSnapshot(collection(db, 'user_permissions'), (snap) => {
      setPendingUsers(
        snap.docs.map((d) => ({
          id: d.id,
          email: d.data().email ?? d.id,
          role: d.data().role ?? 'user',
          permissions: d.data().permissions ?? ALL_PERMISSIONS,
          isPending: true,
        }))
      );
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'user_permissions');
    });

    return () => { unsubUsers(); unsubPending(); };
  }, []);

  const handleSave = async (
    email: string,
    role: 'admin' | 'user',
    permissions: UserPermissions
  ) => {
    try {
      if (editingUser) {
        if (editingUser.isPending) {
          await setDoc(doc(db, 'user_permissions', editingUser.id), { email, role, permissions });
        } else {
          await updateDoc(doc(db, 'users', editingUser.id), { role, permissions });
        }
      } else {
        await setDoc(doc(db, 'user_permissions', email), {
          email,
          role,
          permissions,
          createdAt: new Date().toISOString(),
          createdBy: auth.currentUser?.email ?? '',
        });
      }
      toast.success(language === 'ar' ? 'تم حفظ المستخدم بنجاح' : 'User saved successfully');
    } catch (error) {
      console.error('Error saving user:', error);
      toast.error(language === 'ar' ? 'خطأ في حفظ المستخدم' : 'Error saving user');
      throw error;
    }
  };

  const handleDelete = async (user: AppUser) => {
    try {
      if (user.isPending) {
        await deleteDoc(doc(db, 'user_permissions', user.id));
      } else {
        await updateDoc(doc(db, 'users', user.id), { role: 'user', permissions: EMPTY_PERMISSIONS });
      }
      toast.success(language === 'ar' ? 'تم إزالة الصلاحيات' : 'Permissions removed');
    } catch (error) {
      console.error('Error removing user:', error);
      toast.error(language === 'ar' ? 'خطأ في إزالة المستخدم' : 'Error removing user');
    }
  };

  const openAdd = () => { setEditingUser(null); setShowModal(true); };
  const openEdit = (u: AppUser) => { setEditingUser(u); setShowModal(true); };

  const cardCls = cn(
    'p-4 border rounded-xl flex items-center justify-between gap-4',
    theme === 'dark' ? 'bg-gray-900/50 border-gray-800' : 'bg-gray-50 border-gray-200'
  );

  const renderUser = (u: AppUser) => {
    const activeModules = MODULES
      .filter((m) => u.permissions[m.id])
      .map((m) => (language === 'ar' ? m.ar : m.en))
      .join('، ');

    const isMe = u.email === auth.currentUser?.email;

    return (
      <div key={u.id} className={cardCls}>
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn(
            'w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0',
            u.role === 'admin' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'
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
              <span className={cn(
                'text-xs font-bold',
                u.role === 'admin' ? 'text-blue-400' : 'text-gray-400'
              )}>
                {u.role === 'admin'
                  ? (language === 'ar' ? 'مدير نظام' : 'Admin')
                  : (language === 'ar' ? 'مستخدم' : 'User')}
              </span>
              {u.role !== 'admin' && (
                <span className="text-xs text-gray-500 truncate" title={activeModules}>
                  · {activeModules || (language === 'ar' ? 'بدون صلاحيات' : 'No access')}
                </span>
              )}
            </div>
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
              onClick={() => handleDelete(u)}
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-900/20 rounded-lg text-purple-500">
            <Users size={24} />
          </div>
          <h3 className="text-xl font-bold">{t('user_settings')}</h3>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl text-sm font-bold transition-colors shadow-lg shadow-blue-900/20"
        >
          <UserPlus size={16} />
          {language === 'ar' ? 'إضافة مستخدم' : 'Add User'}
        </button>
      </div>

      {/* Active users */}
      <div className="space-y-2">
        <p className="text-xs font-bold text-gray-400 uppercase">
          {language === 'ar' ? 'المستخدمون النشطون' : 'Active Users'}
        </p>
        {existingUsers.length === 0 ? (
          <p className="text-sm text-gray-500">{language === 'ar' ? 'لا يوجد مستخدمون' : 'No users yet'}</p>
        ) : (
          existingUsers.map(renderUser)
        )}
      </div>

      {/* Pending pre-registrations */}
      {pendingUsers.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-gray-400 uppercase">
            {language === 'ar' ? 'مسجّلون مسبقاً (لم يسجّلوا دخولاً بعد)' : 'Pre-registered (not logged in yet)'}
          </p>
          {pendingUsers.map(renderUser)}
        </div>
      )}

      {/* Legend */}
      <div className={cn('p-4 rounded-xl border flex items-start gap-3', theme === 'dark' ? 'border-gray-800 bg-gray-900/30' : 'border-gray-200 bg-gray-50')}>
        <Shield size={16} className="text-blue-400 shrink-0 mt-0.5" />
        <p className="text-xs text-gray-400">
          {language === 'ar'
            ? 'المستخدمون المضافون مسبقاً سيحصلون على صلاحياتهم تلقائياً عند أول تسجيل دخول بحساب Google.'
            : 'Pre-registered users will automatically receive their permissions on first Google sign-in.'}
        </p>
      </div>

      {showModal && (
        <UserModal
          user={editingUser}
          language={language as 'ar' | 'en'}
          theme={theme}
          onClose={() => setShowModal(false)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

// ─── Main Settings Component ───────────────────────────────────────────────────
export function Settings() {
  const { language, theme, setTheme, dir, t } = useLanguage();
  const [activeSection, setActiveSection] = useState('database');
  const [loading, setLoading] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [currentUserRole, setCurrentUserRole] = useState<string>('user');

  // Clear data state
  const [dangerOpen, setDangerOpen] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [showClearModal, setShowClearModal] = useState(false);
  const [showBackupModal, setShowBackupModal] = useState(false);

  const toggleGroup = (id: string) =>
    setSelectedGroups((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const selectAll = () => setSelectedGroups(new Set(CLEAR_DATA_GROUPS.map((g) => g.id)));
  const selectNone = () => setSelectedGroups(new Set());

  const [printSettings, setPrintSettings] = useState({
    companyName: '',
    taxId: '',
    headerLogo: 'https://picsum.photos/seed/construction/200/200',
    footerText: '',
  });

  useEffect(() => {
    const fetchSettings = async () => {
      const settingsDoc = await getDoc(doc(db, 'settings', 'company_info'));
      if (settingsDoc.exists()) {
        setPrintSettings(settingsDoc.data() as typeof printSettings);
      } else {
        setPrintSettings({
          companyName: language === 'ar' ? 'شركة النيل للمقاولات والاستثمار العقاري' : 'Nile Construction & Real Estate',
          taxId: '123-456-789',
          headerLogo: 'https://picsum.photos/seed/construction/200/200',
          footerText: language === 'ar' ? 'نظام إدارة التكاليف - جميع الحقوق محفوظة © 2024' : 'Cost Management System - All Rights Reserved © 2024',
        });
      }
    };
    fetchSettings();
  }, [language]);

  useEffect(() => {
    const fetchUserRole = async () => {
      if (auth.currentUser) {
        const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
        if (userDoc.exists()) setCurrentUserRole(userDoc.data().role || 'user');
      }
    };
    fetchUserRole();
  }, []);

  const handleSave = async () => {
    setLoading(true);
    try {
      const ref = doc(db, 'settings', 'company_info');
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await updateDoc(ref, printSettings);
      } else {
        await setDoc(ref, printSettings);
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      toast.success(language === 'ar' ? 'تم الحفظ بنجاح' : 'Saved successfully');
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error(language === 'ar' ? 'خطأ في الحفظ، يرجى المحاولة مرة أخرى' : 'Error saving, please try again');
    } finally {
      setLoading(false);
    }
  };

  const sections = [
    { id: 'database', label: t('database_settings'), icon: Database },
    { id: 'users',    label: t('user_settings'),    icon: Users },
    { id: 'display',  label: t('display_settings'),  icon: Monitor },
    { id: 'print',    label: t('print_settings'),    icon: Printer },
  ];

  const inputCls = cn(
    'w-full border rounded-xl py-3 px-4 text-sm outline-none focus:border-blue-500 transition-colors',
    theme === 'dark' ? 'bg-gray-900 border-gray-800' : theme === 'soft' ? 'bg-white border-[#cfd8dc]' : 'bg-white border-gray-200'
  );

  return (
    <div
      className={cn('p-8 min-h-screen transition-colors', theme === 'dark' ? 'bg-[#0a0a0a] text-gray-100' : 'bg-gray-50 text-gray-900')}
      dir={dir}
    >
      <header className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{t('settings')}</h2>
          <p className="text-gray-400 mt-1">
            {language === 'ar' ? 'تخصيص بيئة العمل، إدارة الصلاحيات، وضبط المخرجات' : 'Customize workspace, manage permissions, and adjust outputs'}
          </p>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 px-6 py-2 rounded-xl font-bold transition-all flex items-center gap-2 shadow-lg shadow-blue-900/20 text-white"
        >
          {loading ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
          {saveSuccess ? (language === 'ar' ? 'تم الحفظ بنجاح' : 'Saved Successfully') : t('save')}
        </button>
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
                  : cn('text-gray-400',
                    theme === 'dark' ? 'hover:bg-gray-900 hover:text-gray-200' :
                    theme === 'soft' ? 'hover:bg-[#cfd8dc] hover:text-[#37474f]' :
                    'hover:bg-gray-200 hover:text-gray-900')
              )}
            >
              <section.icon size={20} />
              <span className="font-bold text-sm">{section.label}</span>
            </button>
          ))}
        </div>

        {/* Content */}
        <div className={cn('flex-1 border rounded-2xl p-8 shadow-xl', theme === 'dark' ? 'bg-[#151619] border-gray-800' : 'bg-white border-gray-200')}>
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
                  </div>
                </div>

                {/* ── Danger Zone ── */}
                <div className={cn('border rounded-2xl overflow-hidden', theme === 'dark' ? 'border-red-900/50' : 'border-red-200')}>
                  <button
                    type="button"
                    onClick={() => setDangerOpen((o) => !o)}
                    className={cn(
                      'w-full flex items-center justify-between px-5 py-4 transition-colors',
                      language === 'ar' ? 'text-right' : 'text-left',
                      theme === 'dark' ? 'bg-red-950/40 hover:bg-red-950/60 text-red-400' : 'bg-red-50 hover:bg-red-100 text-red-600'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <AlertTriangle size={20} />
                      <span className="font-bold">{language === 'ar' ? 'منطقة الخطر — حذف البيانات' : 'Danger Zone — Clear Data'}</span>
                    </div>
                    {dangerOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </button>

                  {dangerOpen && (
                    <div className={cn('p-5 space-y-4', theme === 'dark' ? 'bg-[#1a1d23]' : 'bg-white')}>
                      <p className={cn('text-sm', theme === 'dark' ? 'text-gray-400' : 'text-gray-500')}>
                        {language === 'ar'
                          ? 'اختر الوحدات التي تريد مسح بياناتها. العملية لا يمكن التراجع عنها.'
                          : 'Select the modules whose data you want to erase. This action cannot be undone.'}
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
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {CLEAR_DATA_GROUPS.map((g) => {
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
              </motion.div>
            )}

            {activeSection === 'users' && (
              <motion.div key="users" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <UsersSection language={language as 'ar' | 'en'} theme={theme} t={t} />
              </motion.div>
            )}

            {activeSection === 'display' && (
              <motion.div key="display" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-orange-900/20 rounded-lg text-orange-500"><Palette size={24} /></div>
                  <h3 className="text-xl font-bold">{t('display_settings')}</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    { id: 'light', label: t('light_mode'), icon: Monitor, color: 'bg-white text-gray-900 border-gray-200' },
                    { id: 'soft',  label: t('soft_mode'),  icon: Palette, color: 'bg-[#eceff1] text-[#37474f] border-[#cfd8dc]' },
                    { id: 'dark',  label: t('dark_mode'),  icon: Monitor, color: 'bg-[#0a0a0a] text-gray-100 border-gray-800' },
                  ].map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setTheme(mode.id as 'light' | 'soft' | 'dark')}
                      className={cn(
                        'relative p-6 rounded-2xl border-2 transition-all flex flex-col items-center gap-3',
                        mode.color,
                        theme === mode.id
                          ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-[#151619] border-transparent'
                          : 'opacity-60 grayscale hover:grayscale-0 hover:opacity-100'
                      )}
                    >
                      {theme === mode.id && (
                        <div className="absolute top-2 right-2 text-blue-500"><CheckCircle2 size={16} /></div>
                      )}
                      <mode.icon size={32} />
                      <span className="font-bold text-sm">{mode.label}</span>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {activeSection === 'print' && (
              <motion.div key="print" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-red-900/20 rounded-lg text-red-500"><Printer size={24} /></div>
                  <h3 className="text-xl font-bold">{t('print_settings')}</h3>
                </div>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label htmlFor="company-name" className="text-xs font-bold text-gray-400 uppercase">{language === 'ar' ? 'اسم الشركة' : 'Company Name'}</label>
                    <input id="company-name" type="text" className={inputCls} value={printSettings.companyName} onChange={(e) => setPrintSettings({ ...printSettings, companyName: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="tax-id" className="text-xs font-bold text-gray-400 uppercase">{language === 'ar' ? 'الرقم الضريبي' : 'Tax ID'}</label>
                    <input id="tax-id" type="text" className={inputCls} value={printSettings.taxId} onChange={(e) => setPrintSettings({ ...printSettings, taxId: e.target.value })} />
                  </div>
                </div>
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

      {showBackupModal && (
        <BackupModal
          language={language as 'ar' | 'en'}
          theme={theme}
          onClose={() => setShowBackupModal(false)}
        />
      )}
    </div>
  );
}
