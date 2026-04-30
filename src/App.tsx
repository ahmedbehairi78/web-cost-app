/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { GeneralLedger } from './components/GeneralLedger';
import { Projects } from './components/Projects';
import { BOQ } from './components/BOQ';
import { Billing } from './components/Billing';
import { ActualCosts } from './components/ActualCosts';
import { Purchases } from './components/Purchases';
import { Reports } from './components/Reports';
import { Settings } from './components/Settings';
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
  const [activeTab, setActiveTab] = useState('dashboard');
  const [user, setUser] = useState<import('firebase/auth').User | null>(null);
  const [userRole, setUserRole] = useState<'admin' | 'user'>('user');
  const [userPermissions, setUserPermissions] = useState<UserPermissions>(ALL_PERMISSIONS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (firebaseUser) {
          const userRef = doc(db, 'users', firebaseUser.uid);
          const userSnap = await getDoc(userRef);

          if (!userSnap.exists()) {
            // Check for pre-registered permissions set by admin
            const permRef = doc(db, 'user_permissions', firebaseUser.email!);
            const permSnap = await getDoc(permRef);

            const role = permSnap.exists() ? permSnap.data().role : 'user';
            const permissions = permSnap.exists()
              ? permSnap.data().permissions
              : DEFAULT_PERMISSIONS;

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

  if (!user) {
    return <Login />;
  }

  const isAdmin = userRole === 'admin';

  return (
    <div
      className={cn(
        'flex h-screen overflow-hidden',
        theme === 'dark' ? 'bg-[#0a0a0a]' : theme === 'soft' ? 'bg-[#eceff1]' : 'bg-gray-50'
      )}
      dir={dir}
    >
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        permissions={userPermissions}
        isAdmin={isAdmin}
      />

      <main className="flex-1 overflow-y-auto">
        {activeTab === 'dashboard' && <Dashboard />}
        {activeTab === 'ledger' && <GeneralLedger />}
        {activeTab === 'projects' && <Projects />}
        {activeTab === 'boq' && <BOQ />}
        {activeTab === 'billing' && <Billing />}
        {activeTab === 'costs' && <ActualCosts />}
        {activeTab === 'suppliers' && <Purchases />}
        {activeTab === 'reports' && <Reports />}
        {activeTab === 'settings' && <Settings />}
        {![
          'dashboard', 'ledger', 'projects', 'boq', 'billing',
          'costs', 'suppliers', 'reports', 'settings',
        ].includes(activeTab) && (
          <div className="h-full flex flex-col items-center justify-center text-gray-500 p-8 text-center">
            <div className="w-16 h-16 bg-gray-900 rounded-full flex items-center justify-center mb-4">
              <Loader2 size={32} />
            </div>
            <h3 className="text-xl font-bold text-gray-300">قيد التطوير</h3>
            <p className="max-w-md mt-2">
              جاري العمل على موديول &quot;{activeTab}&quot; لربطه بقاعدة البيانات الجديدة.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
