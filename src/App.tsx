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

export default function App() {
  const { dir, t, language, theme } = useLanguage();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      try {
        if (user) {
          // Ensure user document exists
          const userRef = doc(db, 'users', user.uid);
          const userSnap = await getDoc(userRef);
          
          if (!userSnap.exists()) {
            // Default role is 'user' unless it's the admin email
            const isAdminEmail = user.email === "myline78@gmail.com";
            await setDoc(userRef, {
              email: user.email,
              role: isAdminEmail ? 'admin' : 'user',
              createdAt: new Date().toISOString()
            });
          }
        }
      } catch (error) {
        console.error("Error in auth state change:", error);
      } finally {
        setUser(user);
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="h-screen w-full bg-[#0a0a0a] flex flex-col items-center justify-center text-white">
        <Loader2 className="animate-spin text-blue-500 mb-4" size={48} />
        <p className="text-gray-400 animate-pulse">{language === 'ar' ? 'جاري تحميل النظام المالي...' : 'Loading Financial System...'}</p>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <div className={cn(
      "flex h-screen overflow-hidden",
      theme === 'dark' ? "bg-[#0a0a0a]" : theme === 'soft' ? "bg-[#eceff1]" : "bg-gray-50"
    )} dir={dir}>
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      
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
        {!['dashboard', 'ledger', 'projects', 'boq', 'billing', 'costs', 'suppliers', 'reports', 'settings'].includes(activeTab) && (
          <div className="h-full flex flex-col items-center justify-center text-gray-500 p-8 text-center">
            <div className="w-16 h-16 bg-gray-900 rounded-full flex items-center justify-center mb-4">
              <Loader2 size={32} />
            </div>
            <h3 className="text-xl font-bold text-gray-300">قيد التطوير</h3>
            <p className="max-w-md mt-2">
              جاري العمل على موديول "{activeTab}" لربطه بقاعدة البيانات الجديدة. 
              التركيز الحالي على لوحة التحكم المالية لفك تشويش الرؤية.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

