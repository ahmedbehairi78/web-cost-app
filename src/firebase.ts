import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  getDocFromServer,
} from 'firebase/firestore';
import appletDefaults from '../config/firebase-applet.defaults.json';

const REQUIRED_ENV_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
] as const;

/** Non-empty `import.meta.env` string, otherwise `undefined`. */
function envTrimmed(key: string): string | undefined {
  const v = import.meta.env[key as keyof ImportMetaEnv] as unknown;
  if (v === undefined || v === null || String(v).trim() === '') return undefined;
  return String(v).trim();
}

/**
 * Prefer `.env` (VITE_*); in **development** only, falls back to `config/firebase-applet.defaults.json`
 * (or local `firebase-applet-config.json` via the same shape).
 */
function requiredFirebaseValue(key: (typeof REQUIRED_ENV_KEYS)[number], devFallback?: string): string {
  const fromEnv = envTrimmed(key);
  if (fromEnv) return fromEnv;
  const fb = devFallback?.trim();
  if (import.meta.env.DEV && fb) return fb;
  throw new Error(
    `${key} is not set. Add it to web-cost-app/.env (see .env.example) or set Firebase env vars in your host/CI. ` +
    'In development, you can also rely on values in config/firebase-applet.defaults.json.',
  );
}

const applet = appletDefaults;

const firebaseConfig = {
  apiKey: requiredFirebaseValue('VITE_FIREBASE_API_KEY', applet.apiKey),
  authDomain: requiredFirebaseValue('VITE_FIREBASE_AUTH_DOMAIN', applet.authDomain),
  projectId: requiredFirebaseValue('VITE_FIREBASE_PROJECT_ID', applet.projectId),
  appId: requiredFirebaseValue('VITE_FIREBASE_APP_ID', applet.appId),
  storageBucket: requiredFirebaseValue('VITE_FIREBASE_STORAGE_BUCKET', applet.storageBucket),
  messagingSenderId: requiredFirebaseValue('VITE_FIREBASE_MESSAGING_SENDER_ID', applet.messagingSenderId),
};

const databaseId =
  envTrimmed('VITE_FIREBASE_DATABASE_ID') ||
  (import.meta.env.DEV && applet.firestoreDatabaseId?.trim() ? applet.firestoreDatabaseId.trim() : undefined);
const useEmulators = import.meta.env.VITE_USE_EMULATORS === 'true';
const useMemoryFirestore = import.meta.env.DEV || import.meta.env.VITE_DATA_BACKEND === 'local' || useEmulators;

/**
 * Delete all Firestore IndexedDB databases once per localStorage version key.
 * This prevents the "INTERNAL ASSERTION FAILED" crash caused by stale IndexedDB
 * state left from sessions that used persistentLocalCache.
 */
const FS_CACHE_CLEARED_KEY = 'fs_idb_cleared_v2';
// Dev-only: clearing Firestore IDB reloads the page and breaks Electron OAuth redirect return.
if (import.meta.env.DEV && useMemoryFirestore && typeof window !== 'undefined' && !localStorage.getItem(FS_CACHE_CLEARED_KEY)) {
  localStorage.setItem(FS_CACHE_CLEARED_KEY, '1');
  if (typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function') {
    indexedDB.databases().then((dbs) => {
      const targets = dbs.filter((d) => /firestore/i.test(d.name ?? ''));
      if (targets.length > 0) {
        targets.forEach((d) => { if (d.name) indexedDB.deleteDatabase(d.name); });
        window.location.reload();
      }
    }).catch(() => { /* best-effort */ });
  }
}

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);

// Use in-memory cache in dev/local mode to avoid stale IndexedDB causing Firestore assertion errors.
export const db = initializeFirestore(app, {
  localCache: useMemoryFirestore
    ? memoryLocalCache()
    : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
}, databaseId);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Error Handling Logic
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Test Connection
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. ");
    }
  }
}
if (!useMemoryFirestore) {
  testConnection();
}
