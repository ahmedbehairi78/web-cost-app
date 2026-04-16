import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  Search, 
  MoreVertical, 
  ExternalLink, 
  TrendingUp, 
  AlertCircle,
  CheckCircle2,
  Clock,
  DollarSign,
  X,
  Briefcase
} from 'lucide-react';
import { collection, onSnapshot, query, addDoc, serverTimestamp, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { accountingService } from '../services/accountingService';
import { cn } from '../lib/utils';
import { sortByTextField } from '../lib/firestoreSorts';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../context/LanguageContext';

interface Project {
  id: string;
  projectCode: string;
  projectName: string;
  clientName: string;
  status: 'active' | 'completed' | 'suspended' | 'cancelled';
  budget?: number;
  spent?: number;
  collected?: number;
}

export function Projects() {
  const { t, language, theme } = useLanguage();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    projectCode: '',
    projectName: '',
    clientName: '',
    status: 'active' as const
  });

  useEffect(() => {
    const q = query(
      collection(db, 'projects'), 
      where('isDeleted', '==', false)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = sortByTextField(snapshot.docs.map(doc => {
        const docData = doc.data();
        return { 
          id: doc.id, 
          ...docData,
          // Mocking some financial data for the demo until real transactions are linked
          budget: docData.budget || Math.random() * 5000000 + 1000000,
          spent: docData.spent || Math.random() * 3000000 + 500000,
          collected: docData.collected || Math.random() * 2000000 + 100000,
        } as Project;
      }), 'projectCode');
      setProjects(data);
      setLoading(false);
    }, (error) => {
      setLoading(false);
      handleFirestoreError(error, OperationType.LIST, 'projects');
    });
    return () => unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'projects'), {
        ...formData,
        createdAt: serverTimestamp(),
        budget: 0,
        spent: 0,
        collected: 0,
        isDeleted: false
      });
      setIsModalOpen(false);
      setFormData({ projectCode: '', projectName: '', clientName: '', status: 'active' });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'projects');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm(language === 'ar' ? 'هل أنت متأكد من حذف هذا المشروع؟' : 'Are you sure you want to delete this project?')) {
      try {
        await accountingService.softDelete('projects', id);
      } catch (error) {
        console.error("Error deleting project:", error);
      }
    }
  };

  const filteredProjects = projects.filter(p => 
    p.projectName.includes(searchQuery) || p.projectCode.includes(searchQuery)
  );

  return (
    <div className="p-8 bg-[#0a0a0a] min-h-screen text-gray-100" dir="rtl">
      <header className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">إدارة المشاريع</h2>
          <p className="text-gray-400 mt-1">متابعة الحالة التنفيذية والمالية لمواقع العمل</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2"
        >
          <Plus size={18} />
          مشروع جديد
        </button>
      </header>

      {/* New Project Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-[#151619] border border-gray-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-gray-800 flex justify-between items-center bg-gray-900/50">
                <h3 className="text-xl font-bold">إضافة مشروع جديد</h3>
                <button onClick={() => setIsModalOpen(false)} className="text-gray-500 hover:text-white transition-colors">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase">كود المشروع</label>
                  <input 
                    required
                    type="text" 
                    placeholder="مثال: PRJ-2024-001"
                    className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2.5 px-4 text-sm outline-none focus:border-blue-500 transition-colors"
                    value={formData.projectCode}
                    onChange={(e) => setFormData({...formData, projectCode: e.target.value})}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase">اسم المشروع</label>
                  <input 
                    required
                    type="text" 
                    placeholder="أدخل اسم المشروع بالكامل"
                    className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2.5 px-4 text-sm outline-none focus:border-blue-500 transition-colors"
                    value={formData.projectName}
                    onChange={(e) => setFormData({...formData, projectName: e.target.value})}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase">اسم العميل</label>
                  <input 
                    required
                    type="text" 
                    placeholder="اسم الجهة المالكة أو العميل"
                    className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2.5 px-4 text-sm outline-none focus:border-blue-500 transition-colors"
                    value={formData.clientName}
                    onChange={(e) => setFormData({...formData, clientName: e.target.value})}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase">حالة المشروع</label>
                  <select 
                    className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2.5 px-4 text-sm outline-none focus:border-blue-500 transition-colors appearance-none"
                    value={formData.status}
                    onChange={(e) => setFormData({...formData, status: e.target.value as any})}
                  >
                    <option value="active">نشط</option>
                    <option value="suspended">متوقف مؤقتاً</option>
                    <option value="cancelled">ملغي</option>
                  </select>
                </div>

                <div className="pt-4 flex gap-3">
                  <button 
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:text-gray-400 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2"
                  >
                    {isSubmitting ? 'جاري الحفظ...' : 'حفظ المشروع'}
                  </button>
                  <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 bg-gray-800 hover:bg-gray-700 py-3 rounded-xl font-bold transition-all"
                  >
                    إلغاء
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="mb-6 flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
          <input 
            type="text" 
            placeholder="بحث باسم المشروع أو الكود..." 
            className="w-full bg-[#151619] border border-gray-800 rounded-lg py-2 pr-10 pl-4 text-sm outline-none focus:border-blue-500 transition-colors"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex bg-[#151619] border border-gray-800 rounded-lg p-1">
          {['الكل', 'نشط', 'مكتمل'].map(filter => (
            <button key={filter} className="px-4 py-1 text-xs rounded-md hover:bg-gray-800 transition-colors">{filter}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {loading ? (
          <div className="col-span-full p-12 text-center text-gray-500">جاري تحميل المشاريع...</div>
        ) : filteredProjects.length === 0 ? (
          <div className="col-span-full p-12 text-center text-gray-500">لا توجد مشاريع مطابقة للبحث.</div>
        ) : (
          filteredProjects.map((project, i) => (
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.05 }}
              key={project.id}
              className="bg-[#151619] border border-gray-800 rounded-xl p-6 hover:border-gray-700 transition-all group relative overflow-hidden"
            >
              {/* Status Indicator */}
              <div className={cn(
                "absolute top-0 left-0 w-1 h-full",
                project.status === 'active' ? "bg-green-500" : "bg-gray-500"
              )} />

              <div className="flex justify-between items-start mb-6">
                <div className="flex gap-4">
                  <div className="w-12 h-12 bg-gray-900 rounded-lg flex items-center justify-center border border-gray-800 group-hover:border-blue-500/50 transition-colors">
                    <Briefcase className="text-blue-500" size={24} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-bold">{project.projectName}</h3>
                      <span className="text-[10px] bg-gray-800 text-gray-400 px-2 py-0.5 rounded font-mono">{project.projectCode}</span>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">{project.clientName}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => handleDelete(project.id)}
                    className="text-gray-500 hover:text-red-500 p-1 transition-colors"
                  >
                    <X size={18} />
                  </button>
                  <button className="text-gray-500 hover:text-white p-1"><MoreVertical size={18} /></button>
                </div>
              </div>

              {/* Financial Pulse */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="space-y-1">
                  <p className="text-[10px] text-gray-500 uppercase font-bold">الميزانية</p>
                  <p className="text-sm font-bold">{project.budget?.toLocaleString()} <span className="text-[10px] font-normal opacity-50">ج.م</span></p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-gray-500 uppercase font-bold">المصروف الفعلي</p>
                  <p className="text-sm font-bold text-red-400">{project.spent?.toLocaleString()} <span className="text-[10px] font-normal opacity-50">ج.م</span></p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-gray-500 uppercase font-bold">المحصل</p>
                  <p className="text-sm font-bold text-green-400">{project.collected?.toLocaleString()} <span className="text-[10px] font-normal opacity-50">ج.م</span></p>
                </div>
              </div>

              {/* Progress Bars */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-[10px] font-bold uppercase">
                    <span className="text-gray-400">نسبة استهلاك الميزانية</span>
                    <span className="text-blue-400">{Math.round((project.spent! / project.budget!) * 100)}%</span>
                  </div>
                  <div className="h-1.5 bg-gray-900 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-600 rounded-full" 
                      style={{ width: `${(project.spent! / project.budget!) * 100}%` }}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-[10px] font-bold uppercase">
                    <span className="text-gray-400">نسبة التحصيل من المصروف</span>
                    <span className="text-green-400">{Math.round((project.collected! / project.spent!) * 100)}%</span>
                  </div>
                  <div className="h-1.5 bg-gray-900 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-green-600 rounded-full" 
                      style={{ width: `${(project.collected! / project.spent!) * 100}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-6 border-t border-gray-800 flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1 text-[10px] text-gray-500">
                    <Clock size={12} />
                    <span>آخر تحديث: منذ ساعتين</span>
                  </div>
                  {project.spent! > project.collected! * 1.5 && (
                    <div className="flex items-center gap-1 text-[10px] text-red-400 font-bold">
                      <AlertCircle size={12} />
                      <span>فجوة سيولة حادة</span>
                    </div>
                  )}
                </div>
                <button className="text-blue-500 hover:text-blue-400 text-xs font-bold flex items-center gap-1 transition-colors">
                  تفاصيل المشروع
                  <ExternalLink size={14} />
                </button>
              </div>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}
