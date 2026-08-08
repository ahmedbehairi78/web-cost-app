import React, { memo } from 'react';
import { X, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../../lib/utils';

type Props = {
  open: boolean;
  theme: string;
  language: string;
  title: string;
  message: string;
  isDeleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

function ConfirmDeleteModalInner({
  open,
  theme,
  language,
  title,
  message,
  isDeleting,
  onClose,
  onConfirm,
}: Props) {
  const isAr = language === 'ar';
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className={cn(
          'border rounded-2xl w-full max-w-md overflow-hidden shadow-2xl',
          theme === 'dark' ? 'bg-[#151619] border-gray-800' : 'bg-white border-gray-200',
        )}
      >
        <div
          className={cn(
            'p-6 border-b flex justify-between items-center',
            theme === 'dark' ? 'bg-gray-900/50 border-gray-800' : 'bg-gray-50 border-gray-200',
          )}
        >
          <h3 className="text-lg font-bold text-red-500">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={isAr ? 'إغلاق النافذة' : 'Close dialog'}
            title={isAr ? 'إغلاق النافذة' : 'Close dialog'}
            className="text-gray-500 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-6">
          <p className={cn('text-sm', theme === 'dark' ? 'text-gray-300' : 'text-gray-600')}>{message}</p>
        </div>
        <div
          className={cn(
            'p-6 border-t flex justify-end gap-3',
            theme === 'dark' ? 'bg-gray-900/30 border-gray-800' : 'bg-gray-50 border-gray-200',
          )}
        >
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          >
            {isAr ? 'إلغاء' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="px-6 py-2 rounded-lg text-sm font-bold bg-red-600 hover:bg-red-500 text-white transition-colors flex items-center gap-2"
          >
            {isDeleting && <Loader2 className="animate-spin" size={16} />}
            {isAr ? 'تأكيد' : 'Confirm'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export const ConfirmDeleteModal = memo(ConfirmDeleteModalInner);
