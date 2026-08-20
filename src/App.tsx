/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import { ManualNavigationListeners } from './components/help/ManualNavigationListeners';
import { Sidebar } from './components/Sidebar';
import { TopNavBar } from './components/TopNavBar';
import { WindowManager, type AppWindow } from './components/WindowManager';
import { ErpWorkspace } from './components/ErpWorkspace';
import { ErpWorkspaceProvider, useErpWorkspace } from './context/ErpWorkspaceContext';
import { ERP_UTILITY_MODULE_IDS, getModuleMenu } from './constants/moduleMenus';
import { Login } from './components/Login';
import { auth, db } from './firebase';
import { onAuthStateChanged, onIdTokenChanged, signOut, getRedirectResult } from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { ShieldAlert, CheckCircle2, LogIn, Loader2 } from 'lucide-react';
import { useLanguage } from './context/LanguageContext';
import { cn } from './lib/utils';
import { SHELL_MODAL_STACK_Z, isAppTheme, shellAppBackground, shellSidebarWidth, usesTopNav, ERP_GRADIENT_BG, SHELL_MAIN_CLASS } from './lib/shellTheme';
import { isErpTheme } from './lib/erpBrand';
import { type AppUser, type UserPermissions, ALL_PERMISSIONS, DEFAULT_PERMISSIONS, type UserRole } from './types';
import { DEFAULT_MODULE, MODULE_LABELS, NONE_DEFAULT_MODULE, isNoDefaultModule } from './constants/modules';
import { logActivity } from './services/activityLogService';
import { useActivitySession } from './hooks/useActivitySession';
import { useSetAppPermissions } from './context/PermissionsContext';
import {
  canOpenModule,
  canOpenShellModule,
  canOpenModuleView,
  defaultShellViewForModule,
  permissionKeyForModuleView,
  firstPermittedStartupModule,
  hasAnyGrantedPermission,
  hasSettingsAccess,
  normalizeUserPermissions,
  permissionsNeedBootstrap,
  resolvePermissionsFromUserData,
} from './lib/permissions';
import { authApi } from './services/local/authApi';
import { setApiAuthIdToken } from './lib/authToken';
import { ApiError } from './lib/apiClient';
import { isLocalBackend } from './lib/dataBackend';
import { settingsApi } from './services/local/modulesApi';
import {
  isAppLanguagePreference,
  readLocalDefaultModule,
  resolveStoredDefaultModule,
  USER_PREFS_UPDATED_EVENT,
  type UserPrefsUpdatedDetail,
} from './lib/userPreferences';
import { normalizeVisibleShellModules } from './lib/shellModuleVisibility';
import { bootstrapLocalCoaFromFirestore, resetLocalCoaBootstrap } from './lib/localCoaSync';
import { isElectronShell, isDesktopSessionReuseWindow, requestWindowMaximize, requestRevealDesktopWindow } from './lib/electronShell';
import { resolveShellNavigation, resolveStartupModule, resolveSavedDefaultModulePreference, setPendingShellView, setPendingBoqFocus } from './lib/shellNavigation';
import {
  normalizeShellModuleId,
  partitionExclusiveShellWindows,
  retainErpUtilityWindows,
  isSameShellModuleSlot,
  shouldCoexistShellModule,
  calculatorPanelGeometry,
} from './lib/shellWindowPolicy';
import {
  performAppLogout,
  performColdStartAuthReset,
  performFactoryResetReentry,
  readSessionUserLock,
  writeSessionUserLock,
  mustPasswordLogin,
  clearFreshLoginRequired,
  broadcastSessionLock,
  subscribeSessionLock,
} from './lib/sessionLogout';
import {
  API_UNAUTHORIZED_EVENT,
  FACTORY_RESET_DONE_EVENT,
  clearApiUnauthorizedLogoutSuppress,
  isApiUnauthorizedLogoutSuppressed,
} from './lib/apiSession';
import { useIdleLogout } from './hooks/useIdleLogout';
import { OfflineStatusBar } from './components/offline/OfflineStatusBar';
import { PendingSyncPanel, usePendingSyncPanelState } from './components/offline/PendingSyncPanel';
import { startOfflineSyncController } from './lib/offline';
import toast from 'react-hot-toast';

const LOGIN_ERROR_KEY = 'web_cost_login_error';

function isHostedDeployment(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.toLowerCase();
  return host !== 'localhost' && host !== '127.0.0.1';
}

function moduleLabelForToast(moduleId: string, language: 'ar' | 'en'): string {
  const labels = MODULE_LABELS[moduleId];
  if (labels) return language === 'ar' ? labels.ar : labels.en;
  return moduleId;
}

export default function App() {
  const { dir, language, setLanguage, theme, setTheme, t } = useLanguage();
  // Keep a ref so the auth callback can read the current language without
  // being listed as a useEffect dependency (avoids tearing down the Firebase
  // listener every time the user switches language).
  const languageRef = useRef(language);
  useEffect(() => { languageRef.current = language; }, [language]);

  const [user, setUser] = useState<import('firebase/auth').User | null>(null);
  const [passwordSession, setPasswordSession] = useState<AppUser | null>(null);
  const [idleLocked, setIdleLocked] = useState(false);
  const [userRole, setUserRole] = useState<UserRole>('user');
  const [userPermissions, setUserPermissions] = useState<UserPermissions>(ALL_PERMISSIONS);
  /** UI-only nav whitelist; null = show all permitted modules */
  const [visibleShellModules, setVisibleShellModules] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [authInitDone, setAuthInitDone] = useState(!isElectronShell());
  const [bootAuthResetDone, setBootAuthResetDone] = useState(!isElectronShell());
  const electronMaximizedRef = useRef(false);

  const setAppPermissions = useSetAppPermissions();

  useEffect(() => {
    if (!user && !passwordSession) {
      setAppPermissions(DEFAULT_PERMISSIONS, 'user');
      return;
    }
    setAppPermissions(userPermissions, userRole);
  }, [user, passwordSession, userPermissions, userRole, setAppPermissions]);

  // ── Window management ────────────────────────────────────────────────────────
  const [windows, setWindows] = useState<AppWindow[]>([]);
  const zBase = useRef(10);
  const defaultModuleRef = useRef<string>(DEFAULT_MODULE);
  const defaultViewRef = useRef<string | undefined>(undefined);
  const [hasOpenedDefault, setHasOpenedDefault] = useState(false);
  const [startupPrefsReady, setStartupPrefsReady] = useState(false);
  const startupLayoutOpenedRef = useRef<'topnav' | 'sidebar' | null>(null);

  const resetStartupSession = useCallback(() => {
    setHasOpenedDefault(false);
    setStartupPrefsReady(false);
    startupLayoutOpenedRef.current = null;
  }, []);

  useEffect(() => {
    const onPrefsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<UserPrefsUpdatedDetail>).detail;
      if (detail?.defaultModule != null) {
        const resolved = resolveSavedDefaultModulePreference(detail.defaultModule);
        defaultModuleRef.current = firstPermittedStartupModule(
          userPermissions,
          userRole,
          resolved.moduleId,
          visibleShellModules,
        );
        defaultViewRef.current = resolved.viewId;
      }
      if (detail?.reloadVisibleShellModules || detail?.visibleShellModules !== undefined) {
        if (detail.visibleShellModules !== undefined && !detail.reloadVisibleShellModules) {
          setVisibleShellModules(normalizeVisibleShellModules(detail.visibleShellModules));
        } else if (isLocalBackend) {
          void settingsApi
            .getUserPreferences()
            .then((prefs) => {
              setVisibleShellModules(normalizeVisibleShellModules(prefs.visibleShellModules));
            })
            .catch(() => undefined);
        } else if (detail.visibleShellModules !== undefined) {
          setVisibleShellModules(normalizeVisibleShellModules(detail.visibleShellModules));
        }
      }
    };
    window.addEventListener(USER_PREFS_UPDATED_EVENT, onPrefsUpdated);
    return () => window.removeEventListener(USER_PREFS_UPDATED_EVENT, onPrefsUpdated);
  }, [userPermissions, userRole, visibleShellModules]);

  const nextZ = () => {
    zBase.current += 1;
    return zBase.current;
  };

  const denyModuleAccess = useCallback(
    (moduleId: string) => {
      const name = moduleLabelForToast(moduleId, languageRef.current);
      toast.error(
        t('shell_module_access_denied').replace('{module}', name),
        { id: `module-denied-${moduleId}` },
      );
    },
    [t],
  );

  const logClosedShellWindows = useCallback((removed: AppWindow[]) => {
    removed.forEach(w => {
      queueMicrotask(() => void logActivity({ kind: 'module_close', moduleId: w.moduleId }));
    });
  }, []);

  const openWindow = useCallback((moduleId: string, viewId?: string) => {
    const resolved = resolveShellNavigation(moduleId, viewId);
    moduleId = normalizeShellModuleId(resolved.moduleId);
    viewId = resolved.viewId;
    const isAdminUser = hasSettingsAccess(userPermissions);
    if (!canOpenShellModule(userPermissions, moduleId, { isAdmin: isAdminUser })) {
      denyModuleAccess(moduleId);
      return;
    }
    if (viewId && !canOpenModuleView(userPermissions, moduleId, viewId, { isAdmin: isAdminUser })) {
      denyModuleAccess(permissionKeyForModuleView(moduleId, viewId));
      return;
    }
    if (viewId) {
      setPendingShellView(moduleId, viewId);
    }
    const isCalc = moduleId === 'calculator';
    const sidebarW = shellSidebarWidth(theme);
      const compositeRemount =
        !!viewId
        && (
          moduleId === 'technical'
          || moduleId === 'ledger'
          || moduleId === 'purchase_requests'
          || moduleId === 'costs'
          || moduleId === 'inventory'
          || moduleId === 'banks'
        );
    setWindows(prev => {
      const existing = prev.find(w => isSameShellModuleSlot(w.moduleId, moduleId));
      const kind = existing ? ('module_focus' as const) : ('module_open' as const);
      queueMicrotask(() => void logActivity({ kind, moduleId }));
      if (existing) {
        if (isCalc) {
          // Calculator: keep floating panel size — never leave it maximized over other modules
          const panel = calculatorPanelGeometry(sidebarW);
          return prev.map(w =>
            w.id === existing.id
              ? { ...w, ...panel, zIndex: nextZ() }
              : w
          );
        }
        const { kept, removed } = partitionExclusiveShellWindows(prev, moduleId, existing.id);
        logClosedShellWindows(removed);
        return kept.map(w => {
          if (w.id === existing.id) {
            return {
              ...w,
              moduleId,
              id: compositeRemount ? `${moduleId}-${Date.now()}` : w.id,
              windowState: 'maximized' as const,
              zIndex: nextZ(),
            };
          }
          return w;
        });
      }

      if (isCalc) {
        // Small floating panel over whatever module is already open
        const panel = calculatorPanelGeometry(sidebarW);
        const newWin: AppWindow = {
          id: `${moduleId}-${Date.now()}`,
          moduleId,
          ...panel,
          zIndex: nextZ(),
          enterAnim: isErpTheme(theme),
        };
        return [...prev, newWin];
      }

      const cascade   = (prev.length % 6) * 32;
      const available = { w: Math.max(300, window.innerWidth - sidebarW), h: window.innerHeight };
      const winW = Math.min(1280, Math.round(available.w * 0.88));
      const winH = Math.round(available.h * 0.88);

      const newWin: AppWindow = {
        id: `${moduleId}-${Date.now()}`,
        moduleId,
        windowState: 'maximized',
        position: { x: cascade, y: cascade },
        size:     { width: winW, height: winH },
        zIndex:   nextZ(),
        enterAnim: isErpTheme(theme),
      };
      const { kept, removed } = partitionExclusiveShellWindows(prev, moduleId);
      logClosedShellWindows(removed);
      return [...kept, newWin];
    });
  }, [userPermissions, userRole, denyModuleAccess, theme, logClosedShellWindows]);

  const closeShellOverlayWindows = useCallback(() => {
    setWindows(prev => {
      const next = retainErpUtilityWindows(prev);
      if (next.length === prev.length) return prev;
      const removed = prev.filter(w => !next.some(n => n.id === w.id));
      logClosedShellWindows(removed);
      return next;
    });
  }, [logClosedShellWindows]);


  const handleLogout = useCallback(async (options?: { quitElectron?: boolean }) => {
    setPasswordSession(null);
    setVisibleShellModules(null);
    resetStartupSession();
    electronMaximizedRef.current = false;
    setWindows([]);
    await performAppLogout({ quitElectron: options?.quitElectron });
  }, [resetStartupSession]);

  useEffect(() => {
    let clearing = false;
    const onUnauthorized = () => {
      if (clearing || isApiUnauthorizedLogoutSuppressed()) return;
      clearing = true;
      toast.error(
        languageRef.current === 'ar'
          ? 'انتهت الجلسة — سجّل الدخول مرة أخرى'
          : 'Session expired — please sign in again',
        { id: 'api-unauthorized' },
      );
      // Never quit Electron on a 401 (Railway bounce during deploy looks like an update-then-close).
      void handleLogout({ quitElectron: false }).finally(() => {
        clearing = false;
      });
    };
    window.addEventListener(API_UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(API_UNAUTHORIZED_EVENT, onUnauthorized);
  }, [handleLogout]);

  const applyLocalAppUser = useCallback(async (localUser: AppUser) => {
    const role = localUser.role;
    const effectivePermissions = resolvePermissionsFromUserData({
      permissions: localUser.permissions,
    });
    setUserRole(role);
    setUserPermissions(effectivePermissions);
    let savedDefaultModule = DEFAULT_MODULE;
    let savedDefaultView: string | undefined;
    let savedDefaultTheme: string | undefined;
    let savedVisibleModules: string[] | null = null;
    if (isLocalBackend) {
      try {
        const prefs = await settingsApi.getUserPreferences();
        const resolved = resolveSavedDefaultModulePreference(
          resolveStoredDefaultModule(prefs.defaultModule as string | null | undefined),
        );
        savedDefaultModule = resolved.moduleId;
        savedDefaultView = resolved.viewId;
        savedVisibleModules = normalizeVisibleShellModules(prefs.visibleShellModules);
        if (prefs.defaultTheme && isAppTheme(prefs.defaultTheme as string)) {
          savedDefaultTheme = prefs.defaultTheme as string;
        }
        if (isAppLanguagePreference(prefs.defaultLanguage)) {
          setLanguage(prefs.defaultLanguage);
        }
      } catch {
        const localRaw = readLocalDefaultModule();
        if (localRaw) {
          const resolved = resolveSavedDefaultModulePreference(localRaw);
          savedDefaultModule = resolved.moduleId;
          savedDefaultView = resolved.viewId;
        }
      }
    } else {
      const localRaw = readLocalDefaultModule();
      if (localRaw) {
        const resolved = resolveSavedDefaultModulePreference(localRaw);
        savedDefaultModule = resolved.moduleId;
        savedDefaultView = resolved.viewId;
      }
    }
    setVisibleShellModules(savedVisibleModules);
    defaultModuleRef.current = firstPermittedStartupModule(
      effectivePermissions,
      role,
      savedDefaultModule,
      savedVisibleModules,
    );
    defaultViewRef.current = savedDefaultView;
    if (savedDefaultTheme && isAppTheme(savedDefaultTheme)) {
      setTheme(savedDefaultTheme);
    }
    writeSessionUserLock(localUser.email);
    void bootstrapLocalCoaFromFirestore().catch((err) => {
      console.warn('Local COA bootstrap failed:', err);
    });
    setStartupPrefsReady(true);
  }, [setTheme, setLanguage]);

  const handlePasswordLogin = useCallback(async (localUser: AppUser) => {
    resetStartupSession();
    setPasswordSession(localUser);
    await applyLocalAppUser(localUser);
    setLoading(false);
    setAuthChecked(true);
  }, [applyLocalAppUser, resetStartupSession]);

  const closeWindow = useCallback((id: string) => {
    setWindows(prev => {
      const win = prev.find(w => w.id === id);
      if (win) queueMicrotask(() => void logActivity({ kind: 'module_close', moduleId: win.moduleId }));
      return prev.filter(w => w.id !== id);
    });
  }, []);

  const minimizeWindow = useCallback((id: string) => {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, windowState: 'minimized' } : w));
  }, []);

  const maximizeToggle = useCallback((id: string) => {
    setWindows(prev => prev.map(w => {
      if (w.id !== id) return w;
      // Calculator stays a fixed floating panel — maximize would cover the active module
      if (shouldCoexistShellModule(w.moduleId)) {
        const panel = calculatorPanelGeometry(shellSidebarWidth(theme));
        return { ...w, ...panel, zIndex: nextZ() };
      }
      return {
        ...w,
        windowState: w.windowState === 'maximized' ? 'normal' : 'maximized',
        zIndex: nextZ(),
      };
    }));
  }, [theme]);

  const focusWindow = useCallback((id: string) => {
    setWindows(prev => {
      const win = prev.find(w => w.id === id);
      if (!win || win.zIndex === zBase.current) return prev; // already on top
      queueMicrotask(() => void logActivity({ kind: 'module_focus', moduleId: win.moduleId }));
      return prev.map(w => w.id === id ? { ...w, zIndex: nextZ() } : w);
    });
  }, []);

  const updateWindowPosition = useCallback((id: string, pos: { x: number; y: number }) => {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, position: pos } : w));
  }, []);

  const closeAllWindows = useCallback(() => {
    void logActivity({ kind: 'shell_close_all' });
    setWindows([]);
  }, []);

  const restoreMinimized = useCallback((id: string) => {
    setWindows(prev => {
      const win = prev.find(w => w.id === id);
      if (win && !canOpenShellModule(userPermissions, win.moduleId, { isAdmin: hasSettingsAccess(userPermissions) })) {
        denyModuleAccess(win.moduleId);
        return prev;
      }
      if (!win) return prev;
      queueMicrotask(() =>
        void logActivity({
          kind: 'module_focus',
          moduleId: win.moduleId,
          detail: 'restore_taskbar',
        }),
      );
      // Calculator coexists — restore as floating panel without closing the active module
      if (shouldCoexistShellModule(win.moduleId)) {
        const panel = calculatorPanelGeometry(shellSidebarWidth(theme));
        return prev.map(w => {
          if (w.id !== id) return w;
          return {
            ...w,
            ...panel,
            zIndex: nextZ(),
            restoreToken: isErpTheme(theme) ? Date.now() : undefined,
            enterAnim: false,
          };
        });
      }
      const { kept, removed } = partitionExclusiveShellWindows(prev, win.moduleId, id);
      logClosedShellWindows(removed);
      return kept.map(w => {
        if (w.id !== id) return w;
        return {
          ...w,
          windowState: 'maximized' as const,
          zIndex: nextZ(),
          restoreToken: isErpTheme(theme) ? Date.now() : undefined,
          enterAnim: false,
        };
      });
    });
  }, [userPermissions, userRole, denyModuleAccess, theme, logClosedShellWindows]);


  // ── Auth ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isElectronShell()) return;
    let cancelled = false;
    void (async () => {
      // Secondary "New GUI" window (SAP-style): keep persist:webcost cookies —
      // do NOT clear session or force password screen again.
      if (isDesktopSessionReuseWindow()) {
        if (cancelled) return;
        setBootAuthResetDone(true);
        setAuthInitDone(true);
        return;
      }
      await performColdStartAuthReset();
      if (cancelled) return;
      setBootAuthResetDone(true);
      const href = window.location.href;
      const probablyRedirectReturn =
        window.location.pathname.includes('/__/auth/')
        || /(?:^|[?&#])apiKey=/.test(window.location.hash + window.location.search);
      if (!probablyRedirectReturn) {
        setAuthInitDone(true);
        return;
      }
      try {
        await getRedirectResult(auth);
      } catch (err) {
        console.error('Electron redirect sign-in failed:', err);
      } finally {
        if (!cancelled) {
          setAuthInitDone(true);
          if (href !== window.location.href) {
            window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Never leave Electron stuck on a blank splash if Railway/API is slow.
   *  Do not force authChecked on New GUI reuse windows — that flashes the login form. */
  useEffect(() => {
    if (!isElectronShell()) return;
    if (isDesktopSessionReuseWindow()) return;
    const timer = window.setTimeout(() => {
      setBootAuthResetDone((done) => done || true);
      setAuthInitDone((done) => done || true);
      setAuthChecked((done) => done || true);
    }, 8000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!bootAuthResetDone) return;
    const unsub = onIdTokenChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        void firebaseUser.getIdToken().then(setApiAuthIdToken).catch(() => setApiAuthIdToken(null));
      }
    });
    return () => unsub();
  }, [bootAuthResetDone]);

  useEffect(() => {
    if (!authInitDone || !bootAuthResetDone) return;
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      let authenticatedUser = firebaseUser;
      setStartupPrefsReady(false);
      startupLayoutOpenedRef.current = null;
      try {
        if (firebaseUser) {
          if (mustPasswordLogin()) {
            await signOut(auth);
            setApiAuthIdToken(null);
            authenticatedUser = null;
            setUserRole('user');
            setUserPermissions(DEFAULT_PERMISSIONS);
            defaultModuleRef.current = DEFAULT_MODULE;
            setHasOpenedDefault(false);
            setWindows([]);
            return;
          }
          setPasswordSession(null);
          try {
            const idToken = await firebaseUser.getIdToken();
            setApiAuthIdToken(idToken);
          } catch {
            setApiAuthIdToken(null);
          }

          const email = firebaseUser.email?.trim().toLowerCase() ?? '';
          const lockedEmail = readSessionUserLock();
          if (email && lockedEmail && lockedEmail !== email) {
            const ar = languageRef.current === 'ar';
            toast.error(
              ar
                ? `لا يمكن تبديل الحساب داخل نفس جلسة التطبيق. المستخدم الحالي لهذه الجلسة هو: ${lockedEmail}`
                : `Account switching is blocked in this app session. Current session user: ${lockedEmail}`
            );
            await signOut(auth);
            setApiAuthIdToken(null);
            authenticatedUser = null;
            setUserRole('user');
            setUserPermissions(DEFAULT_PERMISSIONS);
            defaultModuleRef.current = DEFAULT_MODULE;
            setHasOpenedDefault(false);
            setWindows([]);
            return;
          }

          const userRef  = doc(db, 'users', firebaseUser.uid);
          const userSnap = await getDoc(userRef);

          const handleLocalSessionFailure = async (syncErr: unknown) => {
            console.error('API session sync:', syncErr);
            const ar = languageRef.current === 'ar';
            const hosted = isHostedDeployment();
            if (syncErr instanceof ApiError) {
              const code = (syncErr.payload as { error?: string })?.error;
              if (syncErr.status === 404 && code === 'no_local_user') {
                toast.error(
                  ar
                    ? 'لا يوجد مستخدم يطابق بريد Google. يجب إضافة المستخدم من داخل النظام أولاً.'
                    : 'No user matches your Google email. Ask an admin to add you in Settings first.'
                );
              } else if (syncErr.status === 503) {
                toast.error(
                  ar
                    ? 'الخادم: تحقق من FIREBASE_PROJECT_ID على Railway'
                    : 'Server: verify FIREBASE_PROJECT_ID on Railway'
                );
              } else if (syncErr.status === 403 && code === 'user_inactive') {
                toast.error(
                  ar ? 'حسابك معطّل. تواصل مع مدير النظام.' : 'Your account is inactive. Contact an admin.'
                );
              } else {
                toast.error(
                  ar
                    ? (hosted ? 'تعذر ربط الجلسة مع الخادم.' : 'تعذر ربط الجلسة مع الخادم المحلي.')
                    : (hosted ? 'Could not establish server session.' : 'Could not establish local API session.')
                );
              }
            } else {
              toast.error(
                ar
                  ? (hosted
                    ? 'تعذر الاتصال بالخادم. تحقق من الإنترنت أو أعد المحاولة.'
                    : 'تعذر الاتصال بالخادم المحلي. تأكد من تشغيل npm run dev:local.')
                  : (hosted
                    ? 'Could not reach the server. Check your connection and retry.'
                    : 'Could not reach local API. Ensure npm run dev:local is running.')
              );
            }
            try {
              sessionStorage.setItem(LOGIN_ERROR_KEY, 'session_sync_failed');
            } catch {
              // ignore
            }
            await signOut(auth);
            setApiAuthIdToken(null);
            authenticatedUser = null;
            setUserRole('user');
            setUserPermissions(DEFAULT_PERMISSIONS);
            defaultModuleRef.current = DEFAULT_MODULE;
            setHasOpenedDefault(false);
            setWindows([]);
          };

          if (!userSnap.exists()) {
            // أول دخول: ننشئ الحساب تلقائياً بصلاحيات صفر — المدير يُفعّل الصلاحيات لاحقاً
            await setDoc(userRef, {
              email: firebaseUser.email,
              role: 'user',
              permissions: DEFAULT_PERMISSIONS,
              assignedContractIds: [],
              assignedProjectIds: [],
              createdAt: new Date().toISOString(),
            });
            setUserRole('user');
            setUserPermissions(DEFAULT_PERMISSIONS);
            defaultModuleRef.current = DEFAULT_MODULE;
            setStartupPrefsReady(true);

            if (isLocalBackend && authenticatedUser) {
              try {
                const idToken = await firebaseUser.getIdToken();
                const localUser = await authApi.firebaseSession(idToken);
                if (hasAnyGrantedPermission(resolvePermissionsFromUserData({ permissions: localUser.permissions }))) {
                  const ar = languageRef.current === 'ar';
                  toast.error(
                    ar
                      ? 'تم إنشاء ملف Firebase بصلاحيات افتراضية. اطلب من المدير حفظ المستخدم من الإعدادات لمزامنة الصلاحيات.'
                      : 'Firebase profile was created with default access. Ask an admin to re-save your user in Settings to sync permissions.'
                  );
                }
              } catch (syncErr: unknown) {
                await handleLocalSessionFailure(syncErr);
                return;
              }
            }
          } else {
            const data = userSnap.data();
            let role = String(data.role || 'user') as UserRole;
            let effectivePermissions = resolvePermissionsFromUserData(data);

            let localUser: AppUser | null = null;
            if (isLocalBackend && authenticatedUser) {
              try {
                const idToken = await firebaseUser.getIdToken();
                localUser = await authApi.firebaseSession(idToken);
              } catch (syncErr: unknown) {
                await handleLocalSessionFailure(syncErr);
                return;
              }
            }

            const loginPatch: Record<string, unknown> = {
              email: firebaseUser.email ?? data.email,
            };

            if (localUser) {
              const localPermissions = resolvePermissionsFromUserData({
                permissions: localUser.permissions,
              });
              const localContractIds = Array.isArray(localUser.assignedContractIds)
                ? localUser.assignedContractIds.filter((id): id is string => typeof id === 'string')
                : [];
              const fsContractIds = Array.isArray(data.assignedContractIds) ? data.assignedContractIds : [];

              if (hasAnyGrantedPermission(localPermissions)) {
                role = localUser.role;
                effectivePermissions = localPermissions;
              }

              if (
                localContractIds.length > 0
                && JSON.stringify([...localContractIds].sort()) !== JSON.stringify([...fsContractIds].sort())
              ) {
                loginPatch.assignedContractIds = localContractIds;
              }

              if (
                permissionsNeedBootstrap(data.permissions)
                || JSON.stringify(normalizeUserPermissions(data.permissions)) !== JSON.stringify(localPermissions)
              ) {
                loginPatch.role = role;
                loginPatch.permissions = effectivePermissions;
              }
            } else if (permissionsNeedBootstrap(data.permissions)) {
              loginPatch.role = role;
              loginPatch.permissions = effectivePermissions;
            }

            await setDoc(userRef, loginPatch, { merge: true });

            setUserRole(role);
            setUserPermissions(effectivePermissions);

            let savedDefaultModule = DEFAULT_MODULE;
            let savedDefaultView: string | undefined;
            let savedDefaultTheme = data.defaultTheme as string | undefined;
            let savedVisibleModules: string[] | null = normalizeVisibleShellModules(
              data.visibleShellModules,
            );
            if (isLocalBackend && localUser) {
              try {
                const prefs = await settingsApi.getUserPreferences();
                const resolved = resolveSavedDefaultModulePreference(
                  resolveStoredDefaultModule(
                    prefs.defaultModule as string | null | undefined,
                  ),
                );
                savedDefaultModule = resolved.moduleId;
                savedDefaultView = resolved.viewId;
                savedVisibleModules = normalizeVisibleShellModules(prefs.visibleShellModules);
                if (prefs.defaultTheme && isAppTheme(prefs.defaultTheme as string)) {
                  savedDefaultTheme = prefs.defaultTheme as string;
                }
                if (isAppLanguagePreference(prefs.defaultLanguage)) {
                  setLanguage(prefs.defaultLanguage);
                }
              } catch {
                const localRaw = readLocalDefaultModule();
                if (localRaw) {
                  const resolved = resolveSavedDefaultModulePreference(localRaw);
                  savedDefaultModule = resolved.moduleId;
                  savedDefaultView = resolved.viewId;
                }
              }
            } else {
              const resolved = resolveSavedDefaultModulePreference(
                resolveStoredDefaultModule(data.defaultModule as string | null | undefined),
              );
              savedDefaultModule = resolved.moduleId;
              savedDefaultView = resolved.viewId;
            }
            if (isAppLanguagePreference(data.defaultLanguage)) {
              setLanguage(data.defaultLanguage);
            }

            setVisibleShellModules(savedVisibleModules);
            defaultModuleRef.current = firstPermittedStartupModule(
              effectivePermissions,
              role,
              savedDefaultModule,
              savedVisibleModules,
            );
            defaultViewRef.current = savedDefaultView;
            if (savedDefaultTheme && isAppTheme(savedDefaultTheme)) {
              setTheme(savedDefaultTheme);
            }
            setStartupPrefsReady(true);
          }

          if (authenticatedUser && email) {
            writeSessionUserLock(email);
            if (isLocalBackend) {
              void bootstrapLocalCoaFromFirestore().catch((err) => {
                console.warn('Local COA bootstrap failed:', err);
              });
            }
          }
        } else if (isLocalBackend) {
          resetLocalCoaBootstrap();
          setApiAuthIdToken(null);
          try {
            const probe = await authApi.sessionProbe();
            if (probe.authenticated && probe.user) {
              // Electron primary cold start still requires a fresh password login.
              // Secondary New GUI windows reuse the Express cookie session instead.
              const allowReuseSession =
                isDesktopSessionReuseWindow() || !mustPasswordLogin();
              if (!allowReuseSession) {
                void authApi.logout().catch(() => undefined);
              } else {
                if (isDesktopSessionReuseWindow()) {
                  clearFreshLoginRequired();
                }
                setPasswordSession(probe.user);
                await applyLocalAppUser(probe.user);
                authenticatedUser = null;
                return;
              }
            }
          } catch {
            /* no password session */
          }
          setPasswordSession(null);
          void authApi.logout().catch(() => undefined);
          setUserRole('user');
          setUserPermissions(DEFAULT_PERMISSIONS);
          defaultModuleRef.current = DEFAULT_MODULE;
          resetStartupSession();
          setWindows([]);
        }
      } catch (error) {
        console.error('Error in auth state change:', error);
      } finally {
        setUser(authenticatedUser);
        setLoading(false);
        setAuthChecked(true);
      }
    });
    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authInitDone, bootAuthResetDone, applyLocalAppUser]); // languageRef.current is used instead of language

  useActivitySession(
    user ?? (passwordSession ? ({ email: passwordSession.email } as import('firebase/auth').User) : null),
    { language, theme },
  );

  const isAuthenticated = !!user || !!passwordSession;
  const sessionEmail = user?.email ?? passwordSession?.email ?? '';
  const sessionDisplayName = user?.displayName ?? passwordSession?.displayName ?? null;
  const offlineUserId = passwordSession?.id ?? user?.uid ?? (sessionEmail ? `email:${sessionEmail}` : null);

  const unlockIdleSession = useCallback(() => {
    setIdleLocked(false);
    broadcastSessionLock(false);
  }, []);

  useEffect(() => subscribeSessionLock(setIdleLocked), []);

  useIdleLogout(isAuthenticated && !idleLocked, () => {
    setIdleLocked(true);
    broadcastSessionLock(true);
  }, undefined, offlineUserId);

  const { open: pendingSyncOpen, setOpen: setPendingSyncOpen } = usePendingSyncPanelState(offlineUserId);

  useEffect(() => {
    if (!isLocalBackend || !isAuthenticated || !offlineUserId) return;
    return startOfflineSyncController(offlineUserId);
  }, [isAuthenticated, offlineUserId]);

  // Electron: maximize the native window once after a successful login.
  useEffect(() => {
    if (!isElectronShell() || electronMaximizedRef.current) return;
    if (isAuthenticated && authChecked && !loading) {
      electronMaximizedRef.current = true;
      requestWindowMaximize();
    }
  }, [isAuthenticated, authChecked, loading]);

  // New GUI: keep OS window hidden until the real app (or Login on failure) is ready.
  useEffect(() => {
    if (!isDesktopSessionReuseWindow()) return;
    if (!authChecked) return;
    if (isAuthenticated) {
      if (loading || !startupPrefsReady) return;
      requestRevealDesktopWindow();
      return;
    }
    requestRevealDesktopWindow();
  }, [authChecked, isAuthenticated, loading, startupPrefsReady]);

  const canOpenDefault = hasAnyGrantedPermission(userPermissions);
  /** Splash after login only — not when the user closes all module windows manually.
   *  Secondary New GUI windows skip this entirely (no login card flash). */
  const enteringApp =
    isAuthenticated
    && authChecked
    && !loading
    && canOpenDefault
    && !hasOpenedDefault
    && !isDesktopSessionReuseWindow();

  // ERP / Electron: never leave the post-login splash up indefinitely.
  useEffect(() => {
    if (!enteringApp) return;
    const id = window.setTimeout(() => setHasOpenedDefault(true), 4000);
    return () => window.clearTimeout(id);
  }, [enteringApp]);

  // ── Open default module once after login (sidebar / window shell) ─────────────
  useLayoutEffect(() => {
    if (usesTopNav(theme)) return;
    if (!startupPrefsReady || loading || !isAuthenticated) return;
    const canOpenDefault = hasAnyGrantedPermission(userPermissions);
    if (!canOpenDefault) return;
    if (startupLayoutOpenedRef.current === 'sidebar') return;

    startupLayoutOpenedRef.current = 'sidebar';
    setHasOpenedDefault(true);
    if (!isNoDefaultModule(defaultModuleRef.current)) {
      openWindow(defaultModuleRef.current, defaultViewRef.current);
    }
  }, [
    startupPrefsReady,
    loading,
    isAuthenticated,
    userPermissions,
    userRole,
    openWindow,
    theme,
  ]);

  // The active module = topmost non-minimized window (must be before any early returns)
  const activeModuleId = useMemo(() => {
    const visible = windows.filter(w => w.windowState !== 'minimized');
    if (visible.length === 0) return null;
    return visible.reduce((top, w) => (w.zIndex > top.zIndex ? w : top)).moduleId;
  }, [windows]);

  const idleLockScreen = idleLocked ? (
    <Login
      idleResume={{
        email: sessionEmail,
        displayName: sessionDisplayName,
        onContinue: unlockIdleSession,
      }}
      onPasswordLogin={() => undefined}
    />
  ) : null;

  // ── Render ───────────────────────────────────────────────────────────────────
  if (!authInitDone || !authChecked || !isAuthenticated) {
    // New GUI: blank while OS window stays hidden — no Login, no logo.
    if (isDesktopSessionReuseWindow()) {
      const restoreFailed = authChecked && !isAuthenticated;
      if (!restoreFailed) return null;
    }
    return (
      <Login
        bootstrapping={!authInitDone || !bootAuthResetDone || !authChecked}
        onPasswordLogin={(u) => void handlePasswordLogin(u)}
      />
    );
  }

  const isAdmin      = hasSettingsAccess(userPermissions);
  const hasGrantedAccess = hasAnyGrantedPermission(userPermissions);

  // شاشة الانتظار: حساب مسجّل لكن بدون صلاحيات — فقط تبديل اللغة وتسجيل الخروج
  if (!hasGrantedAccess) {
    const toggleLang = () => setLanguage(language === 'ar' ? 'en' : 'ar');
    return (
      <>
      <div
        className={cn(
          'h-screen w-full flex flex-col items-center justify-center p-6 gap-6',
          theme === 'erp' ? ERP_GRADIENT_BG : 'bg-[#0a0a0a]',
        )}
        dir={dir}
      >
        <div className={cn(
          'w-full max-w-md rounded-2xl p-8 shadow-2xl text-center',
          theme === 'erp'
            ? 'bg-white/95 backdrop-blur-md border border-[var(--erp-border)] text-[var(--erp-text)] erp-animate-rise-in'
            : 'bg-[#151619] border border-gray-800',
        )}>
          <div className="flex justify-center mb-5">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-400">
              <ShieldAlert size={30} />
            </div>
          </div>
          <h1 className={cn('text-xl font-bold mb-1', isErpTheme(theme) ? 'text-[var(--erp-text-heading)]' : 'text-white')}>
            {language === 'ar' ? 'الحساب بانتظار التفعيل' : 'Account Pending Activation'}
          </h1>
          <p className={cn('text-sm mb-4', isErpTheme(theme) ? 'text-[var(--erp-text-muted)]' : 'text-gray-500')}>{sessionEmail}</p>
          <p className={cn('text-sm leading-6', isErpTheme(theme) ? 'text-[var(--erp-text-muted)]' : 'text-gray-400')}>
            {language === 'ar'
              ? 'تم تسجيل بريدك في النظام، لكن لم يتم منحك أي صلاحيات بعد. يرجى التواصل مع مدير النظام لتفعيل حسابك.'
              : 'Your account is registered, but no permissions have been granted yet. Please contact the system administrator to activate your account.'}
          </p>
        </div>

        {/* Actions: language toggle + sign out only */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleLang}
            className={cn(
              'text-xs border rounded-lg px-4 py-2 shell-transition',
              isErpTheme(theme)
                ? 'text-[var(--erp-text-muted)] hover:text-[var(--erp-primary)] border-[var(--erp-border)] hover:bg-white/60 erp-nav-entry'
                : 'text-gray-400 hover:text-gray-200 border-gray-700',
            )}
          >
            {language === 'ar' ? 'English' : 'عربي'}
          </button>
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="text-xs text-red-400 hover:text-red-300 border border-red-900/40 rounded-lg px-4 py-2 transition-colors"
          >
            {language === 'ar' ? 'تسجيل الخروج' : 'Sign Out'}
          </button>
        </div>
      </div>
      {idleLockScreen}
    </>
    );
  }

  const openModuleIds = new Set(windows.map(w => w.moduleId));
  const topNavLayout = usesTopNav(theme);

  const shellProps = {
    windows,
    userPermissions,
    userRole,
    isAdmin,
    visibleShellModules,
    sessionEmail,
    sessionDisplayName,
    denyModuleAccess,
    openWindow,
    closeAllWindows,
    closeShellOverlayWindows,
    closeWindow,
    minimizeWindow,
    maximizeToggle,
    focusWindow,
    updateWindowPosition,
    restoreMinimized,
    handleLogout,
    defaultModuleRef,
    defaultViewRef,
    setHasOpenedDefault,
    hasOpenedDefault,
    startupPrefsReady,
    startupLayoutOpenedRef,
    loading,
    isAuthenticated,
  };

  return (
    <>
      <ErpWorkspaceProvider enabled={topNavLayout} userKey={sessionEmail}>
        <div
          className={cn(
            topNavLayout ? 'flex flex-col' : 'flex',
            'h-screen overflow-hidden shell-transition',
            shellAppBackground(theme),
          )}
          dir={dir}
        >
          {topNavLayout ? (
            <ErpShellContent {...shellProps} />
          ) : (
            <>
              <Sidebar
                openModuleIds={openModuleIds}
                activeModuleId={activeModuleId}
                openWindow={openWindow}
                closeAllWindows={closeAllWindows}
                permissions={userPermissions}
                isAdmin={isAdmin}
                visibleShellModules={visibleShellModules}
                currentUserEmail={sessionEmail}
                currentUserName={sessionDisplayName}
                onLogout={handleLogout}
              />
              <main className={cn(SHELL_MAIN_CLASS, 'relative z-0 flex-1 flex overflow-hidden min-w-0 min-h-0')}>
                <ManualNavigationListeners
                  openManual={() => openWindow('manual')}
                  navigate={openWindow}
                />
                <WindowManager
                  windows={windows}
                  onClose={closeWindow}
                  onMinimize={minimizeWindow}
                  onMaximizeToggle={maximizeToggle}
                  onFocus={focusWindow}
                  onUpdatePosition={updateWindowPosition}
                  onRestoreMinimized={restoreMinimized}
                  layoutMode="sidebar"
                />
              </main>
            </>
          )}
        </div>
        <EnteringAppSplash
          show={enteringApp}
          onDismiss={() => setHasOpenedDefault(true)}
        />
        {isLocalBackend && isAuthenticated && (
          <>
            <OfflineStatusBar userId={offlineUserId} />
            <PendingSyncPanel
              userId={offlineUserId}
              open={pendingSyncOpen}
              onClose={() => setPendingSyncOpen(false)}
            />
          </>
        )}
        <FactoryResetReentryGate onFreezeShell={closeAllWindows} />
        {idleLockScreen}
      </ErpWorkspaceProvider>
    </>
  );
}

/** Full-screen prompt after factory reset — modules are frozen; session is already gone. */
function FactoryResetReentryGate({ onFreezeShell }: { onFreezeShell: () => void }) {
  const erp = useErpWorkspace();
  const { t, theme, dir } = useLanguage();
  const [keptEmails, setKeptEmails] = useState<string[] | null>(null);
  const [reentering, setReentering] = useState(false);

  useEffect(() => {
    const onDone = (e: Event) => {
      const emails = (e as CustomEvent<{ keptEmails?: string[] }>).detail?.keptEmails ?? [];
      onFreezeShell();
      erp.closeWorkspace();
      setKeptEmails(emails);
    };
    window.addEventListener(FACTORY_RESET_DONE_EVENT, onDone);
    return () => window.removeEventListener(FACTORY_RESET_DONE_EVENT, onDone);
  }, [erp, onFreezeShell]);

  if (keptEmails === null) return null;

  const isDark = theme === 'dark';

  return (
    <div
      className={cn(
        'fixed inset-0 flex items-center justify-center p-4',
        SHELL_MODAL_STACK_Z,
      )}
      dir={dir}
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/70" />
      <div
        className={cn(
          'relative w-full max-w-lg rounded-2xl border shadow-2xl p-6 space-y-4',
          isDark ? 'bg-[#1a1d23] border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-900',
        )}
      >
        <div className="flex items-center gap-2 text-emerald-500">
          <CheckCircle2 size={22} />
          <h3 className="text-lg font-bold">{t('settings_factory_reset_done_title')}</h3>
        </div>
        <div
          className={cn(
            'rounded-xl border p-4 space-y-2 text-sm',
            isDark ? 'bg-emerald-950/30 border-emerald-900/50' : 'bg-emerald-50 border-emerald-200',
          )}
        >
          <p className={isDark ? 'text-emerald-300' : 'text-emerald-800'}>
            {t('settings_factory_reset_done_body')}
          </p>
          {keptEmails.length > 0 && (
            <p className={cn('text-xs', isDark ? 'text-emerald-400/80' : 'text-emerald-700')}>
              {t('settings_factory_reset_success').replace('{emails}', keptEmails.join(', '))}
            </p>
          )}
        </div>
        <button
          type="button"
          disabled={reentering}
          onClick={() => {
            if (reentering) return;
            setReentering(true);
            clearApiUnauthorizedLogoutSuppress();
            void performFactoryResetReentry();
          }}
          className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2"
        >
          {reentering ? <Loader2 size={18} className="animate-spin" /> : <LogIn size={18} />}
          {t('settings_factory_reset_relogin_btn')}
        </button>
      </div>
    </div>
  );
}

/** Post-login splash — dismiss when ERP workspace navigates or after safety timeout. */
function EnteringAppSplash({
  show,
  onDismiss,
}: {
  show: boolean;
  onDismiss: () => void;
}) {
  const erp = useErpWorkspace();

  useEffect(() => {
    if (show && erp.location) onDismiss();
  }, [show, erp.location, onDismiss]);

  useEffect(() => {
    if (!show) return;
    const id = window.setTimeout(onDismiss, 2500);
    return () => window.clearTimeout(id);
  }, [show, onDismiss]);

  if (!show) return null;

  return (
    <Login
      enteringApp
      onPasswordLogin={() => undefined}
    />
  );
}

interface ErpShellContentProps {
  windows: AppWindow[];
  userPermissions: UserPermissions;
  userRole: UserRole;
  isAdmin: boolean;
  visibleShellModules: string[] | null;
  sessionEmail: string;
  sessionDisplayName: string | null;
  denyModuleAccess: (moduleId: string) => void;
  openWindow: (moduleId: string, viewId?: string) => void;
  closeAllWindows: () => void;
  closeShellOverlayWindows: () => void;
  closeWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  maximizeToggle: (id: string) => void;
  focusWindow: (id: string) => void;
  updateWindowPosition: (id: string, pos: { x: number; y: number }) => void;
  restoreMinimized: (id: string) => void;
  handleLogout: () => void | Promise<void>;
  defaultModuleRef: React.MutableRefObject<string>;
  defaultViewRef: React.MutableRefObject<string | undefined>;
  hasOpenedDefault: boolean;
  setHasOpenedDefault: React.Dispatch<React.SetStateAction<boolean>>;
  startupPrefsReady: boolean;
  startupLayoutOpenedRef: React.MutableRefObject<'topnav' | 'sidebar' | null>;
  loading: boolean;
  isAuthenticated: boolean;
}

function ErpShellContent({
  windows,
  userPermissions,
  userRole,
  isAdmin,
  visibleShellModules,
  sessionDisplayName,
  denyModuleAccess,
  openWindow,
  closeAllWindows,
  closeShellOverlayWindows,
  closeWindow,
  minimizeWindow,
  maximizeToggle,
  focusWindow,
  updateWindowPosition,
  restoreMinimized,
  handleLogout,
  defaultModuleRef,
  defaultViewRef,
  hasOpenedDefault,
  setHasOpenedDefault,
  startupPrefsReady,
  startupLayoutOpenedRef,
  loading,
  isAuthenticated,
  sessionEmail,
}: ErpShellContentProps) {
  const erp = useErpWorkspace();
  const { theme } = useLanguage();

  const navigateToModule = useCallback(
    (moduleId: string, viewId?: string, opts?: { force?: boolean }) => {
      const resolved = resolveShellNavigation(moduleId, viewId);
      const targetModule = resolved.moduleId;
      const resolvedView =
        resolved.viewId
        ?? defaultShellViewForModule(userPermissions, targetModule, { isAdmin })
        ?? getModuleMenu(targetModule)?.defaultViewId
        ?? 'main';

      // Calculator floats over the workspace — never close the active module
      if (shouldCoexistShellModule(moduleId)) {
        openWindow(moduleId, viewId);
        return;
      }

      if (ERP_UTILITY_MODULE_IDS.has(moduleId)) {
        erp.closeWorkspace();
        closeShellOverlayWindows();
        openWindow(moduleId, viewId);
        return;
      }

      if (!canOpenShellModule(userPermissions, targetModule, { isAdmin })) {
        denyModuleAccess(targetModule);
        return;
      }

      if (!canOpenModuleView(userPermissions, targetModule, resolvedView, { isAdmin })) {
        const permKey = permissionKeyForModuleView(targetModule, resolvedView);
        denyModuleAccess(permKey);
        return;
      }

      closeShellOverlayWindows();
      erp.navigateTo(targetModule, resolvedView, opts);
    },
    [erp, userPermissions, isAdmin, denyModuleAccess, openWindow, closeShellOverlayWindows],
  );

  /** Notification bell must remount the target view even when already open. */
  const openFromNotification = useCallback(
    (moduleId: string, viewId?: string) => {
      navigateToModule(moduleId, viewId, { force: true });
    },
    [navigateToModule],
  );

  // Dev-only hook for docs screenshot capture (Playwright).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as Window & {
      __webCostNavigate?: (moduleId: string, viewId?: string) => void;
      __webCostSetBoqFocus?: (focus: { projectId?: string; contractId: string }) => void;
    };
    w.__webCostNavigate = (moduleId, viewId) => {
      navigateToModule(moduleId, viewId, { force: true });
    };
    w.__webCostSetBoqFocus = (focus) => {
      setPendingBoqFocus(focus);
    };
    return () => {
      delete w.__webCostNavigate;
      delete w.__webCostSetBoqFocus;
    };
  }, [navigateToModule]);

  useLayoutEffect(() => {
    if (!usesTopNav(theme)) return;
    if (!startupPrefsReady || loading || !isAuthenticated) return;
    const canOpenDefault = hasAnyGrantedPermission(userPermissions);
    if (!canOpenDefault) return;
    if (startupLayoutOpenedRef.current === 'topnav') return;

    startupLayoutOpenedRef.current = 'topnav';
    setHasOpenedDefault(true);
    if (!isNoDefaultModule(defaultModuleRef.current)) {
      navigateToModule(defaultModuleRef.current, defaultViewRef.current);
    }
  }, [
    theme,
    startupPrefsReady,
    loading,
    isAuthenticated,
    userPermissions,
    userRole,
    navigateToModule,
    defaultModuleRef,
    defaultViewRef,
    startupLayoutOpenedRef,
    setHasOpenedDefault,
  ]);

  const utilityWindows = useMemo(
    () => windows.filter((w) => ERP_UTILITY_MODULE_IDS.has(w.moduleId)),
    [windows],
  );

  const utilityActiveModuleId = useMemo(() => {
    const visible = utilityWindows.filter((w) => w.windowState !== 'minimized');
    if (visible.length === 0) return null;
    return visible.reduce((top, w) => (w.zIndex > top.zIndex ? w : top)).moduleId;
  }, [utilityWindows]);

  const openModuleIds = useMemo(() => {
    const ids = new Set<string>();
    if (erp.location) ids.add(erp.location.moduleId);
    utilityWindows.forEach((w) => ids.add(w.moduleId));
    return ids;
  }, [erp.location, utilityWindows]);

  const handleCloseAll = useCallback(() => {
    erp.closeWorkspace();
    closeAllWindows();
  }, [erp, closeAllWindows]);

  return (
    <>
      <ManualNavigationListeners
        openManual={() => navigateToModule('manual')}
        navigate={navigateToModule}
      />
      <TopNavBar
        openModuleIds={openModuleIds}
        activeModuleId={erp.location?.moduleId ?? utilityActiveModuleId}
        activeViewId={erp.location?.viewId ?? null}
        openWindow={navigateToModule}
        openFromNotification={openFromNotification}
        navigateTo={navigateToModule}
        erpNavigation
        modulesWithDrafts={erp.modulesWithDrafts}
        closeAllWindows={handleCloseAll}
        permissions={userPermissions}
        isAdmin={isAdmin}
        visibleShellModules={visibleShellModules}
        currentUserEmail={sessionEmail}
        currentUserName={sessionDisplayName}
        onLogout={handleLogout}
      />
      <main className={cn(SHELL_MAIN_CLASS, 'relative z-0 flex-1 flex flex-col overflow-hidden min-w-0 min-h-0')}>
        <ErpWorkspace />
        {utilityWindows.length > 0 && (
          <WindowManager
              windows={utilityWindows}
              onClose={closeWindow}
              onMinimize={minimizeWindow}
              onMaximizeToggle={maximizeToggle}
              onFocus={focusWindow}
              onUpdatePosition={updateWindowPosition}
              onRestoreMinimized={restoreMinimized}
            layoutMode="topnav"
            overlayMode
          />
        )}
      </main>
    </>
  );
}
