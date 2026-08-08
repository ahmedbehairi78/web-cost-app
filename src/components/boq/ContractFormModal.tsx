import React, { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

export type ContractFormFields = { contractName: string; contractNumber: string };

const EMPTY: ContractFormFields = { contractName: '', contractNumber: '' };

interface Props {
  isOpen: boolean;
  isSubmitting: boolean;
  onSubmit: (data: ContractFormFields) => void | Promise<void>;
  onClose: () => void;
  theme: string;
  language: string;
}

export function ContractFormModal({ isOpen, isSubmitting, onSubmit, onClose, theme, language }: Props) {
  const [form, setForm] = useState<ContractFormFields>(EMPTY);

  useEffect(() => {
    if (isOpen) setForm(EMPTY);
  }, [isOpen]);

  const inputCls = cn(
    'w-full border rounded-lg py-2 px-4 text-sm outline-none focus:border-blue-500 transition-colors',
    theme === 'dark'
      ? 'bg-gray-900 border-gray-800'
      : theme === 'soft'
        ? 'bg-white border-[#cfd8dc]'
        : 'bg-white border-gray-200 shadow-sm',
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className={cn(
              'border rounded-2xl w-full max-w-md overflow-hidden shadow-2xl',
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
                {language === 'ar' ? 'إضافة عقد جديد' : 'Add New Contract'}
              </h3>
              <button
                type="button"
                onClick={onClose}
                className={cn(
                  'transition-colors',
                  theme === 'dark' ? 'text-gray-500 hover:text-white' : 'text-gray-400 hover:text-gray-900',
                )}
              >
                <X size={20} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void onSubmit(form);
              }}
              className="p-6 space-y-4"
            >
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-gray-400 uppercase">
                  {language === 'ar' ? 'اسم العقد' : 'Contract Name'}
                </label>
                <input
                  required
                  type="text"
                  className={inputCls}
                  value={form.contractName}
                  onChange={(e) => setForm((p) => ({ ...p, contractName: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-gray-400 uppercase">
                  {language === 'ar' ? 'رقم العقد' : 'Contract Number'}
                </label>
                <input
                  required
                  type="text"
                  className={inputCls}
                  value={form.contractNumber}
                  onChange={(e) => setForm((p) => ({ ...p, contractNumber: e.target.value }))}
                />
              </div>
              <div className="pt-4 flex gap-3">
                <button
                  disabled={isSubmitting}
                  type="submit"
                  className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-800 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 text-white"
                >
                  {isSubmitting && <Loader2 className="animate-spin" size={18} />}
                  {language === 'ar' ? 'إضافة العقد' : 'Add Contract'}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className={cn(
                    'flex-1 py-3 rounded-xl font-bold transition-all',
                    theme === 'dark'
                      ? 'bg-gray-800 hover:bg-gray-700 text-white'
                      : 'bg-gray-200 hover:bg-gray-300 text-gray-700',
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
