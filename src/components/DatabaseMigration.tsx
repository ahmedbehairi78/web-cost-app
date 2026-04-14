import React, { useState, useCallback, useRef } from 'react';
import { ArrowRightLeft, CheckCircle, XCircle, Loader2, Database, Download, Upload, AlertTriangle, FileJson, FolderOpen, HardDrive, Trash2, Info } from 'lucide-react';
import { motion } from 'motion/react';
import { db } from '../firebase';
import { initializeFirestore, collection, getDocs, doc, setDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { getApp } from 'firebase/app';

const OLD_DB_ID = "ai-studio-ed995a7f-1301-474a-bea7-988b7ce5664c";
const NEW_DB_ID = "megypt15061978";

const COLLECTIONS = [
  'users',
  'projects',
  'contracts',
  'boq_items',
  'actual_costs',
  'collections',
  'suppliers',
  'admin_expenses',
  'chart_of_accounts',
  'transactions',
  'billing',
  'ipc_progress',
  'settings',
  'cost_centers',
  'purchase_transactions',
];

interface MigrationResult {
  collection: string;
  status: 'success' | 'error' | 'empty';
  count: number;
  error?: string;
}

interface BackupData {
  version: string;
  exportedAt: string;
  databaseId: string;
  collections: Record<string, Record<string, any>>;
}

type TabType = 'migrate' | 'export' | 'import' | 'restore';

export function DatabaseMigration() {
  const [activeTab, setActiveTab] = useState<TabType>('export');
  const [isMigrating, setIsMigrating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<MigrationResult[]>([]);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── DB → DB Migration ─────────────────────────────────────
  const runMigration = useCallback(async () => {
    setIsMigrating(true);
    setProgress(0);
    setResults([]);
    setComplete(false);
    setError(null);

    try {
      const app = getApp();
      const oldDb = initializeFirestore(app, {}, OLD_DB_ID);
      const migrationResults: MigrationResult[] = [];

      for (let i = 0; i < COLLECTIONS.length; i++) {
        const coll = COLLECTIONS[i];
        setProgress(Math.round((i / COLLECTIONS.length) * 100));

        try {
          const oldCollection = collection(oldDb, coll);
          const snapshot = await getDocs(oldCollection);

          if (snapshot.empty) {
            migrationResults.push({ collection: coll, status: 'empty', count: 0 });
            continue;
          }

          let copied = 0;
          for (const oldDocSnap of snapshot.docs) {
            const docId = oldDocSnap.id;
            const data = oldDocSnap.data();
            const newDocRef = doc(db, coll, docId);
            await setDoc(newDocRef, data);
            copied++;
          }

          migrationResults.push({ collection: coll, status: 'success', count: copied });
        } catch (err: any) {
          migrationResults.push({ collection: coll, status: 'error', count: 0, error: err.message });
        }
      }

      setProgress(100);
      setResults(migrationResults);
      setComplete(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsMigrating(false);
    }
  }, []);

  // ─── Export Current DB → JSON File ─────────────────────────
  const runExport = useCallback(async () => {
    setIsMigrating(true);
    setProgress(0);
    setResults([]);
    setComplete(false);
    setError(null);

    try {
      const backupData: BackupData = {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        databaseId: NEW_DB_ID,
        collections: {},
      };

      for (let i = 0; i < COLLECTIONS.length; i++) {
        const coll = COLLECTIONS[i];
        setProgress(Math.round((i / COLLECTIONS.length) * 100));

        try {
          const collRef = collection(db, coll);
          const snapshot = await getDocs(collRef);

          if (snapshot.empty) {
            backupData.collections[coll] = {};
            continue;
          }

          const docsObj: Record<string, any> = {};
          for (const docSnap of snapshot.docs) {
            docsObj[docSnap.id] = docSnap.data();
          }
          backupData.collections[coll] = docsObj;
        } catch (err: any) {
          console.error(`Export failed for ${coll}:`, err);
        }
      }

      setProgress(100);

      // Download JSON file
      const jsonStr = JSON.stringify(backupData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.href = url;
      a.download = `firestore-backup-${NEW_DB_ID}-${timestamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Build results summary
      const migrationResults: MigrationResult[] = COLLECTIONS.map(coll => {
        const docCount = Object.keys(backupData.collections[coll] || {}).length;
        return {
          collection: coll,
          status: docCount > 0 ? 'success' : 'empty',
          count: docCount,
        };
      });
      setResults(migrationResults);
      setComplete(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsMigrating(false);
    }
  }, []);

  // ─── Import JSON File → Current DB ─────────────────────────
  const runImport = useCallback(async (file: File) => {
    setIsMigrating(true);
    setProgress(0);
    setResults([]);
    setComplete(false);
    setError(null);

    try {
      const text = await file.text();
      const backupData: BackupData = JSON.parse(text);

      if (!backupData.collections) {
        throw new Error('Invalid backup file: missing collections');
      }

      const migrationResults: MigrationResult[] = [];
      const collsToImport = COLLECTIONS.filter(c => backupData.collections[c] && Object.keys(backupData.collections[c]).length > 0);

      for (let i = 0; i < collsToImport.length; i++) {
        const coll = collsToImport[i];
        setProgress(Math.round((i / collsToImport.length) * 100));

        try {
          const docsObj = backupData.collections[coll];
          let copied = 0;

          for (const [docId, data] of Object.entries(docsObj)) {
            const newDocRef = doc(db, coll, docId);
            await setDoc(newDocRef, data as any);
            copied++;
          }

          migrationResults.push({ collection: coll, status: 'success', count: copied });
        } catch (err: any) {
          migrationResults.push({ collection: coll, status: 'error', count: 0, error: err.message });
        }
      }

      // Mark skipped collections
      COLLECTIONS.filter(c => !collsToImport.includes(c)).forEach(coll => {
        migrationResults.push({ collection: coll, status: 'empty', count: 0 });
      });

      setProgress(100);
      setResults(migrationResults);
      setComplete(true);
    } catch (err: any) {
      setError(err.message || 'Failed to parse backup file');
    } finally {
      setIsMigrating(false);
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      runImport(file);
    }
  }, [runImport]);

  // ─── Restore (Clear + Import) ──────────────────────────────
  const runRestore = useCallback(async (file: File) => {
    setIsMigrating(true);
    setProgress(0);
    setResults([]);
    setComplete(false);
    setError(null);

    try {
      const text = await file.text();
      const backupData: BackupData = JSON.parse(text);

      if (!backupData.collections) {
        throw new Error('Invalid backup file: missing collections');
      }

      const migrationResults: MigrationResult[] = [];
      const collsToRestore = COLLECTIONS.filter(c => backupData.collections[c] && Object.keys(backupData.collections[c]).length > 0);

      // Phase 1: Clear existing data
      for (let i = 0; i < collsToRestore.length; i++) {
        const coll = collsToRestore[i];
        setProgress(Math.round((i / collsToRestore.length) * 30));

        try {
          const collRef = collection(db, coll);
          const snapshot = await getDocs(collRef);
          const batch = writeBatch(db);
          snapshot.docs.forEach(d => batch.delete(d.ref));
          await batch.commit();
        } catch (err: any) {
          console.error(`Clear failed for ${coll}:`, err);
        }
      }

      // Phase 2: Import backup data
      for (let i = 0; i < collsToRestore.length; i++) {
        const coll = collsToRestore[i];
        setProgress(30 + Math.round((i / collsToRestore.length) * 70));

        try {
          const docsObj = backupData.collections[coll];
          let copied = 0;

          for (const [docId, data] of Object.entries(docsObj)) {
            const newDocRef = doc(db, coll, docId);
            await setDoc(newDocRef, data as any);
            copied++;
          }

          migrationResults.push({ collection: coll, status: 'success', count: copied });
        } catch (err: any) {
          migrationResults.push({ collection: coll, status: 'error', count: 0, error: err.message });
        }
      }

      COLLECTIONS.filter(c => !collsToRestore.includes(c)).forEach(coll => {
        migrationResults.push({ collection: coll, status: 'empty', count: 0 });
      });

      setProgress(100);
      setResults(migrationResults);
      setComplete(true);
    } catch (err: any) {
      setError(err.message || 'Failed to restore backup');
    } finally {
      setIsMigrating(false);
    }
  }, []);

  const handleRestoreFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      runRestore(file);
    }
  }, [runRestore]);

  // ─── Computed Stats ────────────────────────────────────────
  const totalCopied = results.filter(r => r.status === 'success').reduce((sum, r) => sum + r.count, 0);
  const totalErrors = results.filter(r => r.status === 'error').length;
  const totalEmpty = results.filter(r => r.status === 'empty').length;

  const tabs: { id: TabType; label: string; labelEn: string; icon: React.ElementType }[] = [
    { id: 'export', label: 'تصدير', labelEn: 'Export', icon: Download },
    { id: 'import', label: 'استيراد', labelEn: 'Import', icon: Upload },
    { id: 'restore', label: 'استعادة', labelEn: 'Restore', icon: FolderOpen },
    { id: 'migrate', label: 'ترحيل', labelEn: 'Migrate', icon: ArrowRightLeft },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4" dir="rtl">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-3xl w-full bg-[#151619] border border-gray-800 rounded-2xl p-8 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <div className="w-14 h-14 bg-blue-600 rounded-xl flex items-center justify-center">
            <HardDrive size={28} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">إدارة النسخ الاحتياطي</h1>
            <p className="text-gray-400 text-sm">Backup & Migration Center</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 bg-gray-800/50 rounded-xl p-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setComplete(false); setError(null); setResults([]); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              <tab.icon size={16} />
              <span>{tab.label}</span>
              <span className="text-[10px] opacity-60">{tab.labelEn}</span>
            </button>
          ))}
        </div>

        {/* Tab Content */}

        {/* ─── Export Tab ─── */}
        {activeTab === 'export' && (
          <>
            <div className="bg-blue-900/20 border border-blue-700/30 rounded-xl p-4 mb-6">
              <div className="flex items-start gap-3">
                <Info size={20} className="text-blue-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-blue-200 font-semibold text-sm">تصدير جميع البيانات إلى ملف JSON</p>
                  <p className="text-blue-400/60 text-xs mt-1">Export all collections from <code className="bg-blue-900/40 px-1 rounded">{NEW_DB_ID}</code> to a local JSON file</p>
                </div>
              </div>
            </div>

            {!isMigrating && !complete && (
              <button
                onClick={runExport}
                className="w-full flex items-center justify-center gap-3 bg-green-600 hover:bg-green-700 text-white font-bold py-4 px-6 rounded-xl transition-all duration-200 mb-6"
              >
                <FileJson size={20} />
                <span>تصدير النسخة الاحتياطية</span>
                <span className="text-xs text-green-200">(Export Backup)</span>
              </button>
            )}
          </>
        )}

        {/* ─── Import Tab ─── */}
        {activeTab === 'import' && (
          <>
            <div className="bg-yellow-900/20 border border-yellow-700/30 rounded-xl p-4 mb-6">
              <div className="flex items-start gap-3">
                <AlertTriangle size={20} className="text-yellow-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-yellow-200 font-semibold text-sm">استيراد بيانات من ملف JSON</p>
                  <p className="text-yellow-400/60 text-xs mt-1">Import data from a backup JSON file (adds to existing data, does not overwrite)</p>
                </div>
              </div>
            </div>

            {!isMigrating && !complete && (
              <div className="mb-6">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center justify-center gap-3 bg-purple-600 hover:bg-purple-700 text-white font-bold py-4 px-6 rounded-xl transition-all duration-200"
                >
                  <Upload size={20} />
                  <span>اختيار ملف النسخة الاحتياطية</span>
                  <span className="text-xs text-purple-200">(Select .json file)</span>
                </button>
              </div>
            )}
          </>
        )}

        {/* ─── Restore Tab ─── */}
        {activeTab === 'restore' && (
          <>
            <div className="bg-red-900/20 border border-red-700/30 rounded-xl p-4 mb-6">
              <div className="flex items-start gap-3">
                <AlertTriangle size={20} className="text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-red-200 font-semibold text-sm">⚠️ مسح البيانات الحالية واستبدالها بالنسخة الاحتياطية</p>
                  <p className="text-red-400/60 text-xs mt-1">This will DELETE all current data and REPLACE it with the backup. Make sure you have a recent backup first!</p>
                </div>
              </div>
            </div>

            {!isMigrating && !complete && (
              <div className="mb-6">
                <input
                  type="file"
                  accept=".json"
                  onChange={handleRestoreFile}
                  className="hidden"
                />
                <button
                  onClick={() => {
                    if (window.confirm('⚠️ Are you sure? This will DELETE all current data and replace it with the backup.')) {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.accept = '.json';
                      input.onchange = (e: any) => {
                        const file = e.target.files?.[0];
                        if (file) runRestore(file);
                      };
                      input.click();
                    }
                  }}
                  className="w-full flex items-center justify-center gap-3 bg-red-600 hover:bg-red-700 text-white font-bold py-4 px-6 rounded-xl transition-all duration-200"
                >
                  <Trash2 size={20} />
                  <span>مسح واستعادة من نسخة احتياطية</span>
                  <span className="text-xs text-red-200">(Clear & Restore)</span>
                </button>
              </div>
            )}
          </>
        )}

        {/* ─── Migrate Tab (DB → DB) ─── */}
        {activeTab === 'migrate' && (
          <>
            <div className="bg-yellow-900/20 border border-yellow-700/30 rounded-xl p-4 mb-6">
              <div className="flex items-start gap-3">
                <ArrowRightLeft size={20} className="text-yellow-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-yellow-200 font-semibold text-sm">نقل البيانات من قاعدة البيانات القديمة إلى الجديدة</p>
                  <p className="text-yellow-400/80 text-xs mt-1">{OLD_DB_ID.substring(0, 20)}... → {NEW_DB_ID}</p>
                </div>
              </div>
            </div>

            {!isMigrating && !complete && (
              <button
                onClick={runMigration}
                className="w-full flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-6 rounded-xl transition-all duration-200 mb-6"
              >
                <Database size={20} />
                <span>بدء الترحيل</span>
                <span className="text-xs text-blue-200">(Start Migration)</span>
              </button>
            )}
          </>
        )}

        {/* ─── Progress Bar (all tabs) ─── */}
        {isMigrating && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-300 text-sm">جاري المعالجة...</span>
              <span className="text-blue-400 font-mono text-sm">{progress}%</span>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
              <motion.div
                className="h-full bg-blue-600 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
            <div className="flex items-center justify-center gap-2 mt-3 text-gray-400 text-sm">
              <Loader2 size={16} className="animate-spin" />
              <span>Processing...</span>
            </div>
          </div>
        )}

        {/* ─── Error (all tabs) ─── */}
        {error && (
          <div className="bg-red-900/20 border border-red-700/30 rounded-xl p-4 mb-6">
            <div className="flex items-center gap-2 text-red-400">
              <XCircle size={18} />
              <span className="font-semibold">حدث خطأ</span>
            </div>
            <p className="text-red-300/80 text-sm mt-2 font-mono break-all">{error}</p>
          </div>
        )}

        {/* ─── Results (all tabs) ─── */}
        {complete && (
          <div className="space-y-4">
            {/* Summary Cards */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-green-900/20 border border-green-700/30 rounded-xl p-3 text-center">
                <CheckCircle size={20} className="text-green-500 mx-auto mb-1" />
                <p className="text-green-400 font-bold text-lg">{totalCopied}</p>
                <p className="text-green-500/60 text-xs">Documents</p>
              </div>
              <div className="bg-gray-800/50 border border-gray-700/30 rounded-xl p-3 text-center">
                <Database size={20} className="text-gray-500 mx-auto mb-1" />
                <p className="text-gray-400 font-bold text-lg">{totalEmpty}</p>
                <p className="text-gray-500/60 text-xs">Empty</p>
              </div>
              <div className="bg-red-900/20 border border-red-700/30 rounded-xl p-3 text-center">
                <XCircle size={20} className="text-red-500 mx-auto mb-1" />
                <p className="text-red-400 font-bold text-lg">{totalErrors}</p>
                <p className="text-red-500/60 text-xs">Errors</p>
              </div>
            </div>

            {/* Detailed Results */}
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {results.map((result, idx) => (
                <motion.div
                  key={result.collection}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    result.status === 'success'
                      ? 'bg-green-900/10 border-green-700/20'
                      : result.status === 'error'
                      ? 'bg-red-900/10 border-red-700/20'
                      : 'bg-gray-800/30 border-gray-700/20'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {result.status === 'success' && <CheckCircle size={14} className="text-green-500" />}
                    {result.status === 'error' && <XCircle size={14} className="text-red-500" />}
                    {result.status === 'empty' && <Database size={14} className="text-gray-500" />}
                    <span className="text-gray-300 text-sm font-mono">{result.collection}</span>
                  </div>
                  <span className={`text-sm font-bold ${
                    result.status === 'success' ? 'text-green-400' :
                    result.status === 'error' ? 'text-red-400' : 'text-gray-500'
                  }`}>
                    {result.status === 'success' ? `${result.count} docs` :
                     result.status === 'error' ? 'Failed' : 'Empty'}
                  </span>
                </motion.div>
              ))}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => window.location.reload()}
                className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-xl transition-all duration-200"
              >
                <CheckCircle size={18} />
                <span>إعادة تحميل</span>
              </button>
              <button
                onClick={() => { setComplete(false); setResults([]); }}
                className="flex-1 flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-6 rounded-xl transition-all duration-200"
              >
                <HardDrive size={18} />
                <span>عملية جديدة</span>
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
