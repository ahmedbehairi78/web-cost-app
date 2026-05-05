/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { WindowManager, type AppWindow } from './components/WindowManager';
import { Login } from './components/Login';
import { auth, db } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { Loader2 } from 'lucide-react';
import { useLanguage } from './context/LanguageContext';
import { cn } from './lib/utils';
import { type UserPermissions, ALL_PERMISSIONS, DEFAULT_PERMISSIONS } from './types';

export default function App() {
  const { dir, language, theme } = useLanguage();
  const [user, setUser] = useState<import('firebase/auth').User | null>(null);
  const [userRole, setUserRole] = useState<'admin' | 'user'>('user');
  const [userPermissions, setUserPermissions] = useState<UserPermissions>(ALL_PERMISSIONS);
  const [loading, setLoading] = useState(true);

  // ── Window management ────────────────────────────────────────────────────────
  const [windows, setWindows] = useState<AppWindow[]>([]);
  const zBase = useRef(10);

  const nextZ = () => {
    zBase.current += 1;
    return zBase.current;
  };

  const openWindow = useCallback((moduleId: string) => {
    setWindows(prev => {
      const existing = prev.find(w => w.moduleId === moduleId);
      if (existing) {
        // Maximize the target window, minimize all others that are currently visible
        return prev.map(w => {
          if (w.id === existing.id) return { ...w, windowState: 'maximized' as const, zIndex: nextZ() };
          if (w.windowState !== 'minimized') return { ...w, windowState: 'minimized' as const };
          return w;
        });
      }

      const cascade   = (prev.length % 6) * 32;
      const available = { w: Math.max(300, window.innerWidth - 256), h: window.innerHeight };
      const winW = Math.min(1280, Math.round(available.w * 0.88));
      const winH = Math.round(available.h * 0.88);

      const newWin: AppWindow = {
        id: `${moduleId}-${Date.now()}`,
        moduleId,
        windowState: 'maximized',
        position: { x: cascade, y: cascade },
        size:     { width: winW, height: winH },
        zIndex:   nextZ(),
      };
      // Minimize all currently visible windows before adding the new one
      return [
        ...prev.map(w => w.windowState !== 'minimized' ? { ...w, windowState: 'minimized' as const } : w),
        newWin,
      ];
    });
  }, []);

  const closeWindow = useCallback((id: string) => {
    setWindows(prev => prev.filter(w => w.id !== id));
  }, []);

  const minimizeWindow = useCallback((id: string) => {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, windowState: 'minimized' } : w));
  }, []);

  const maximizeToggle = useCallback((id: string) => {
    setWindows(prev => prev.map(w => {
      if (w.id !== id) return w;
      return {
        ...w,
        windowState: w.windowState === 'maximized' ? 'normal' : 'maximized',
        zIndex: nextZ(),
      };
    }));
  }, []);

  const focusWindow = useCallback((id: string) => {
    setWindows(prev => {
      const win = prev.find(w => w.id === id);
      if (!win || win.zIndex === zBase.current) return prev; // already on top
      return prev.map(w => w.id === id ? { ...w, zIndex: nextZ() } : w);
    });
  }, []);

  const updateWindowPosition = useCallback((id: string, pos: { x: number; y: number }) => {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, position: pos } : w));
  }, []);

  const closeAllWindows = useCallback(() => {
    setWindows([]);
  }, []);

  const restoreMinimized = useCallback((id: string) => {
    setWindows(prev => prev.map(w => {
      if (w.id === id) return { ...w, windowState: 'maximized' as const, zIndex: nextZ() };
      if (w.windowState !== 'minimized') return { ...w, windowState: 'minimized' as const };
      return w;
    }));
  }, []);

  // ── Auth ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (firebaseUser) {
          const userRef  = doc(db, 'users', firebaseUser.uid);
          const userSnap = await getDoc(userRef);

          if (!userSnap.exists()) {
            const permRef  = doc(db, 'user_permissions', firebaseUser.email!);
            const permSnap = await getDoc(permRef);

            const role        = permSnap.exists() ? permSnap.data().role : 'user';
            const permissions = permSnap.exists() ? permSnap.data().permissions : DEFAULT_PERMISSIONS;

            await setDoc(userRef, {
              email: firebaseUser.email,
              role,
              permissions,
              createdAt: new Date().toISOString(),
            });

            setUserRole(role);
            setUserPermissions(permissions);
          } else {
            const data = userSnap.data();
            setUserRole(data.role || 'user');
            setUserPermissions(data.permissions || ALL_PERMISSIONS);
          }
        }
      } catch (error) {
        console.error('Error in auth state change:', error);
      } finally {
        setUser(firebaseUser);
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="h-screen w-full bg-[#0a0a0a] flex flex-col items-center justify-center text-white">
        <Loader2 className="animate-spin text-blue-500 mb-4" size={48} />
        <p className="text-gray-400 animate-pulse">
          {language === 'ar' ? 'جاري تحميل النظام المالي...' : 'Loading Financial System...'}
        </p>
      </div>
    );
  }

  if (!user) return <Login />;

  const isAdmin      = userRole === 'admin';
  const openModuleIds = new Set(windows.map(w => w.moduleId));

  return (
    <div
      className={cn(
        'flex h-screen overflow-hidden',
        theme === 'dark' ? 'bg-[#0a0a0a]' : theme === 'soft' ? 'bg-[#dde3e8]' : 'bg-gray-100'
      )}
      dir={dir}
    >
      <Sidebar
        openModuleIds={openModuleIds}
        openWindow={openWindow}
        closeAllWindows={closeAllWindows}
        permissions={userPermissions}
        isAdmin={isAdmin}
      />

      <main className="flex-1 flex overflow-hidden min-w-0">
        <WindowManager
          windows={windows}
          onClose={closeWindow}
          onMinimize={minimizeWindow}
          onMaximizeToggle={maximizeToggle}
          onFocus={focusWindow}
          onUpdatePosition={updateWindowPosition}
          onRestoreMinimized={restoreMinimized}
        />
      </main>
    </div>
  );
}
