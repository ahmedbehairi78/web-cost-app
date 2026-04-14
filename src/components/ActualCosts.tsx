import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  Search, 
  Receipt, 
  Filter, 
  X, 
  Calendar, 
  DollarSign, 
  Briefcase, 
  Users,
  Loader2
} from 'lucide-react';
import { collection, onSnapshot, query, addDoc, serverTimestamp, orderBy, where } from 'firebase/firestore';
import { db } from '../firebase';
import { accountingService } from '../services/accountingService';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useLanguage } from '../context/LanguageContext';

export function ActualCosts() {
  const { t, language, theme, dir } = useLanguage();
  const [projects, setProjects] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [costs, setCosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  const [formData, setFormData] = useState({
    projectId: '',
    boqItemId: '',
    supplierId: '',
    amount: 0,
    description: '',
    date: new Date().toISOString().split('T')[0],
    category: 'materials'
  });

  useEffect(() => {
    const unsubProjects = onSnapshot(collection(db, 'projects'), (snap) => {
      setProjects(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => {
      console.error("ActualCosts projects listener error:", err);
    });
    const unsubSuppliers = onSnapshot(collection(db, 'suppliers'), (snap) => {
      setSuppliers(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => {
      console.error("ActualCosts suppliers listener error:", err);
    });
    const unsubCosts = onSnapshot(
      query(
        collection(db, 'actual_costs'), 
        where('isDeleted', '==', false),
        orderBy('date', 'desc')
      ), 
      (snap) => {
        setCosts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        setLoading(false);
      },
      (err) => {
        console.error("ActualCosts costs listener error:", err);
        setLoading(false);
      }
    );

    return () => { unsubProjects(); unsubSuppliers(); unsubCosts(); };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // 1. Record the cost in actual_costs collection
      await addDoc(collection(db, 'actual_costs'), {
        ...formData,
        projectName: projects.find(p => p.id === formData.projectId)?.projectName,
        supplierName: suppliers.find(s => s.id === formData.supplierId)?.name,
        createdAt: serverTimestamp(),
        isDeleted: false
      });

      // 2. Generate automatic journal entry via accounting service
      await accountingService.recordExpense({
        amount: formData.amount,
        description: formData.description,
        projectId: formData.projectId,
        category: formData.category as any,
        date: formData.date
      });

      setShowAddModal(false);
      setFormData({
        projectId: '',
        boqItemId: '',
        supplierId: '',
        amount: 0,
        description: '',
        date: new Date().toISOString().split('T')[0],
        category: 'materials'
      });
    } catch (error) {
      console.error("Error saving cost:", error);
      alert(language === 'ar' ? 'حدث خطأ أثناء الحفظ' : 'Error saving cost');
    }
  };

  return (
    <div className={cn("p-8 min-h-screen transition-colors", theme === 'dark' ? "bg-[#0a0a0a] text-gray-100" : "bg-gray-50 text-gray-900")} dir={dir}>
      <header className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{t('costs')}</h2>
          <p className="text-gray-400 mt-1">{language === 'ar' ? 'تسجيل ومتابعة المصروفات الفعلية للمشاريع' : 'Record and track actual project expenses'}</p>
        </div>
        <button 
          onClick={() => setShowAddModal(true)}
          className="bg-blue-600 hover:bg-blue-500 px-6 py-2 rounded-xl font-bold transition-all flex items-center gap-2 shadow-lg shadow-blue-900/20 text-white"
        >
          <Plus size={20} />
          {language === 'ar' ? 'إضافة مصروف' : 'Add Expense'}
        </button>
      </header>

      {/* Costs List */}
      <div className={cn("border rounded-2xl overflow-hidden shadow-xl", theme === 'dark' ? "bg-[#151619] border-gray-800" : "bg-white border-gray-200")}>
        <table className="w-full text-right">
          <thead className={cn("border-b", theme === 'dark' ? "bg-gray-900/50 border-gray-800" : "bg-gray-50 border-gray-200")}>
            <tr>
              <th className={cn("px-6 py-4 text-sm font-bold text-gray-400", language === 'ar' ? "text-right" : "text-left")}>{t('project')}</th>
              <th className={cn("px-6 py-4 text-sm font-bold text-gray-400", language === 'ar' ? "text-right" : "text-left")}>{language === 'ar' ? 'الوصف' : 'Description'}</th>
              <th className={cn("px-6 py-4 text-sm font-bold text-gray-400", language === 'ar' ? "text-right" : "text-left")}>{t('suppliers')}</th>
              <th className={cn("px-6 py-4 text-sm font-bold text-gray-400", language === 'ar' ? "text-right" : "text-left")}>{language === 'ar' ? 'المبلغ' : 'Amount'}</th>
              <th className={cn("px-6 py-4 text-sm font-bold text-gray-400", language === 'ar' ? "text-right" : "text-left")}>{language === 'ar' ? 'التاريخ' : 'Date'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                  <div className="flex flex-col items-center gap-4">
                    <Loader2 className="animate-spin text-blue-500" size={32} />
                    {language === 'ar' ? 'جاري تحميل المصروفات...' : 'Loading expenses...'}
                  </div>
                </td>
              </tr>
            ) : costs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                  {language === 'ar' ? 'لا توجد مصروفات مسجلة.' : 'No expenses recorded.'}
                </td>
              </tr>
            ) : costs.map((cost) => (
              <tr key={cost.id} className={cn("transition-colors", theme === 'dark' ? "hover:bg-gray-900/50" : "hover:bg-gray-50")}>
                <td className="px-6 py-4 font-bold">{cost.projectName}</td>
                <td className="px-6 py-4">{cost.description}</td>
                <td className="px-6 py-4 text-blue-400">{cost.supplierName || '-'}</td>
                <td className="px-6 py-4 font-mono font-bold text-red-400">{cost.amount.toLocaleString()}</td>
                <td className="px-6 py-4 text-gray-500">{cost.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add Cost Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className={cn("w-full max-w-lg border rounded-2xl shadow-2xl overflow-hidden", theme === 'dark' ? "bg-[#151619] border-gray-800" : "bg-white border-gray-200")}
            >
              <div className={cn("p-6 border-b flex justify-between items-center", theme === 'dark' ? "bg-gray-900/50 border-gray-800" : "bg-gray-50 border-gray-200")}>
                <h3 className="text-xl font-bold flex items-center gap-2">
                  <Receipt className="text-blue-500" size={24} />
                  {language === 'ar' ? 'تسجيل مصروف جديد' : 'Record New Expense'}
                </h3>
                <button onClick={() => setShowAddModal(false)} className="text-gray-500 hover:text-white">
                  <X size={24} />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-8 space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase">{t('project')}</label>
                  <select 
                    required
                    value={formData.projectId}
                    onChange={(e) => setFormData({...formData, projectId: e.target.value})}
                    className={cn("w-full border rounded-xl py-3 px-4 text-sm outline-none focus:border-blue-500 transition-colors", theme === 'dark' ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200")}
                  >
                    <option value="">{language === 'ar' ? 'اختر المشروع' : 'Select Project'}</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.projectName}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase">{t('suppliers')}</label>
                  <select 
                    value={formData.supplierId}
                    onChange={(e) => setFormData({...formData, supplierId: e.target.value})}
                    className={cn("w-full border rounded-xl py-3 px-4 text-sm outline-none focus:border-blue-500 transition-colors", theme === 'dark' ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200")}
                  >
                    <option value="">{language === 'ar' ? 'اختر المورد (اختياري)' : 'Select Supplier (Optional)'}</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase">{language === 'ar' ? 'المبلغ' : 'Amount'}</label>
                    <input 
                      required
                      type="number"
                      className={cn("w-full border rounded-xl py-3 px-4 text-sm outline-none focus:border-blue-500 transition-colors", theme === 'dark' ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200")}
                      value={formData.amount}
                      onChange={(e) => setFormData({...formData, amount: Number(e.target.value)})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase">{language === 'ar' ? 'التاريخ' : 'Date'}</label>
                    <input 
                      required
                      type="date"
                      className={cn("w-full border rounded-xl py-3 px-4 text-sm outline-none focus:border-blue-500 transition-colors", theme === 'dark' ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200")}
                      value={formData.date}
                      onChange={(e) => setFormData({...formData, date: e.target.value})}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase">{language === 'ar' ? 'الوصف' : 'Description'}</label>
                  <textarea 
                    required
                    rows={3}
                    className={cn("w-full border rounded-xl py-3 px-4 text-sm outline-none focus:border-blue-500 transition-colors resize-none", theme === 'dark' ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200")}
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                  />
                </div>

                <div className="flex gap-4 pt-4">
                  <button 
                    type="submit"
                    className="flex-1 bg-blue-600 hover:bg-blue-500 py-3 rounded-xl font-bold transition-all shadow-lg shadow-blue-900/20 text-white"
                  >
                    {language === 'ar' ? 'حفظ المصروف' : 'Save Expense'}
                  </button>
                  <button 
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className={cn("flex-1 py-3 rounded-xl font-bold transition-all", theme === 'dark' ? "bg-gray-800 hover:bg-gray-700 text-white" : "bg-gray-200 hover:bg-gray-300 text-gray-700")}
                  >
                    {t('cancel')}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
