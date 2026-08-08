import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '../../lib/utils';

export interface ProjectFormData {
  projectCode: string;
  projectName: string;
  projectNameEn: string;
  clientName: string;
  clientNameEn: string;
  status: 'active' | 'completed' | 'suspended' | 'cancelled';
  boqValue: number;
  voValue: number;
}

export interface ProjectFormModalProps {
  open: boolean;
  isEditing: boolean;
  initialData: ProjectFormData;
  isSubmitting: boolean;
  language: string;
  theme: string;
  onClose: () => void;
  onSubmit: (data: ProjectFormData) => void;
}

const emptyForm = (): ProjectFormData => ({
  projectCode: '',
  projectName: '',
  projectNameEn: '',
  clientName: '',
  clientNameEn: '',
  status: 'active',
  boqValue: 0,
  voValue: 0,
});

export function ProjectFormModal({
  open,
  isEditing,
  initialData,
  isSubmitting,
  language,
  theme,
  onClose,
  onSubmit,
}: ProjectFormModalProps) {
  const [formData, setFormData] = useState<ProjectFormData>(emptyForm);
  const wasOpenRef = useRef(false);

  // Seed local form only when the modal opens — typing must not re-sync from parent.
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setFormData({ ...initialData });
    }
    wasOpenRef.current = open;
  }, [open, initialData]);

  const inputCls = cn(
    'w-full border rounded-lg py-2.5 px-4 text-sm outline-none focus:border-blue-500 transition-colors',
    theme === 'dark'
      ? 'bg-gray-900 border-gray-800'
      : theme === 'soft'
        ? 'bg-white border-[#cfd8dc]'
        : 'bg-white border-gray-200 text-gray-900',
  );

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className={cn(
              'border rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl transition-colors',
              theme === 'dark'
                ? 'bg-[#151619] border-gray-800'
                : theme === 'soft'
                  ? 'bg-white border-[#cfd8dc]'
                  : 'bg-white border-gray-200',
            )}
          >
            <div
              className={cn(
                'p-6 border-b flex justify-between items-center',
                theme === 'dark'
                  ? 'bg-gray-900/50 border-gray-800'
                  : theme === 'soft'
                    ? 'bg-[#eceff1] border-[#cfd8dc]'
                    : 'bg-gray-50 border-gray-200',
              )}
            >
              <h3 className="text-xl font-bold">
                {isEditing
                  ? language === 'ar'
                    ? 'تعديل بيانات المشروع'
                    : 'Edit Project'
                  : language === 'ar'
                    ? 'إضافة مشروع جديد'
                    : 'Add New Project'}
              </h3>
              <button
                type="button"
                onClick={onClose}
                className="text-gray-500 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                onSubmit(formData);
              }}
              className="p-6 space-y-4"
            >
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase">
                  {language === 'ar' ? 'كود المشروع' : 'Project Code'}
                </label>
                <input
                  required
                  type="text"
                  placeholder="e.g. PRJ-2024-001"
                  className={inputCls}
                  value={formData.projectCode}
                  onChange={(e) => setFormData({ ...formData, projectCode: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase">
                    {language === 'ar' ? 'اسم المشروع (عربي)' : 'Project Name (Arabic)'}
                  </label>
                  <input
                    required
                    type="text"
                    placeholder="اسم المشروع بالعربية"
                    className={inputCls}
                    value={formData.projectName}
                    onChange={(e) => setFormData({ ...formData, projectName: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase">
                    {language === 'ar' ? 'اسم المشروع (إنجليزي)' : 'Project Name (English)'}
                  </label>
                  <input
                    type="text"
                    placeholder="Project name in English"
                    dir="ltr"
                    className={inputCls}
                    value={formData.projectNameEn}
                    onChange={(e) => setFormData({ ...formData, projectNameEn: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase">
                    {language === 'ar' ? 'اسم العميل (عربي)' : 'Client Name (Arabic)'}
                  </label>
                  <input
                    required
                    type="text"
                    placeholder="اسم العميل بالعربية"
                    className={inputCls}
                    value={formData.clientName}
                    onChange={(e) => setFormData({ ...formData, clientName: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase">
                    {language === 'ar' ? 'اسم العميل (إنجليزي)' : 'Client Name (English)'}
                  </label>
                  <input
                    type="text"
                    placeholder="Client name in English"
                    dir="ltr"
                    className={inputCls}
                    value={formData.clientNameEn}
                    onChange={(e) => setFormData({ ...formData, clientNameEn: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase">
                  {language === 'ar' ? 'حالة المشروع' : 'Project Status'}
                </label>
                <select
                  className={cn(inputCls, 'appearance-none')}
                  value={formData.status}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      status: e.target.value as ProjectFormData['status'],
                    })
                  }
                >
                  <option value="active">{language === 'ar' ? 'نشط' : 'Active'}</option>
                  <option value="suspended">
                    {language === 'ar' ? 'متوقف مؤقتاً' : 'Suspended'}
                  </option>
                  <option value="cancelled">{language === 'ar' ? 'ملغي' : 'Cancelled'}</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase">
                    {language === 'ar'
                      ? 'إجمالي قيمة المشروع في قوائم الكميات'
                      : 'Total Project Value in BOQ'}
                  </label>
                  <input
                    type="number"
                    className={cn(
                      inputCls,
                      theme !== 'dark' && theme !== 'soft' && 'border-gray-200 text-gray-900',
                    )}
                    value={formData.boqValue || ''}
                    onChange={(e) =>
                      setFormData({ ...formData, boqValue: Number(e.target.value) })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase">
                    {language === 'ar' ? 'قيمة أوامر التغيير (VO)' : 'Variation Orders (VO)'}
                  </label>
                  <input
                    type="number"
                    className={cn(
                      inputCls,
                      theme !== 'dark' && theme !== 'soft' && 'border-gray-200 text-gray-900',
                    )}
                    value={formData.voValue || ''}
                    onChange={(e) =>
                      setFormData({ ...formData, voValue: Number(e.target.value) })
                    }
                  />
                </div>
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:text-gray-400 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 text-white"
                >
                  {isSubmitting
                    ? language === 'ar'
                      ? 'جاري الحفظ...'
                      : 'Saving...'
                    : language === 'ar'
                      ? 'حفظ المشروع'
                      : 'Save Project'}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className={cn(
                    'flex-1 py-3 rounded-xl font-bold transition-all',
                    theme === 'dark'
                      ? 'bg-gray-800 hover:bg-gray-700 text-white'
                      : theme === 'soft'
                        ? 'bg-[#eceff1] hover:bg-[#cfd8dc] text-[#37474f]'
                        : 'bg-gray-100 hover:bg-gray-200 text-gray-900',
                  )}
                >
                  {language === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
