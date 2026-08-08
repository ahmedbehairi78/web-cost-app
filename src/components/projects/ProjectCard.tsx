import { memo } from 'react';
import {
  AlertCircle,
  Briefcase,
  Clock,
  Edit2,
  ExternalLink,
  FileText,
  MoreVertical,
  TrendingUp,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { ManualHelpButton } from '../help/ManualHelpButton';
import { cn } from '../../lib/utils';

export interface ProjectCardProject {
  id: string;
  projectCode: string;
  projectName: string;
  clientName: string;
  status: 'active' | 'completed' | 'suspended' | 'cancelled';
}

export interface ProjectCardMetrics {
  budget: number;
  spent: number;
  collected: number;
  receivables: number;
  grossMargin: number;
  cashFlow: number;
  budgetUtilPct: number;
  collectionPct: number;
}

export interface ProjectCardProps {
  project: ProjectCardProject;
  metrics: ProjectCardMetrics;
  contractCount: number;
  language: string;
  theme: string;
  formatMoney: (value: number) => string;
  onEdit: (project: ProjectCardProject) => void;
  onDelete: (id: string) => void;
  onAddContract: (project: ProjectCardProject) => void;
  onOpenDetails: (project: ProjectCardProject) => void;
}

function ProjectCardInner({
  project,
  metrics,
  contractCount,
  language,
  theme,
  formatMoney,
  onEdit,
  onDelete,
  onAddContract,
  onOpenDetails,
}: ProjectCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        'border rounded-xl p-6 transition-all group relative overflow-hidden',
        theme === 'dark'
          ? 'bg-[#151619] border-gray-800 hover:border-gray-700'
          : theme === 'soft'
            ? 'bg-white border-[#cfd8dc] hover:border-[#546e7a]'
            : 'bg-white border-gray-200 hover:border-blue-200 shadow-sm',
      )}
    >
      <div
        className={cn(
          'absolute top-0 left-0 w-1 h-full',
          project.status === 'active' ? 'bg-green-500' : 'bg-gray-500',
        )}
      />

      <div className="flex justify-between items-start mb-6">
        <div className="flex gap-4">
          <div
            className={cn(
              'w-12 h-12 rounded-lg flex items-center justify-center border transition-colors relative',
              theme === 'dark'
                ? 'bg-gray-900 border-gray-800'
                : theme === 'soft'
                  ? 'bg-[#eceff1] border-[#cfd8dc]'
                  : 'bg-gray-50 border-gray-200',
            )}
          >
            <Briefcase className="text-blue-500" size={24} />
            {contractCount > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-purple-600 text-white text-[10px] font-black rounded-full flex items-center justify-center border-2 border-[#151619] shadow-lg">
                {contractCount}
              </span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold">{project.projectName}</h3>
              <span className="text-[10px] bg-gray-800 text-gray-400 px-2 py-0.5 rounded font-mono">
                {project.projectCode}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-1">{project.clientName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onEdit(project)}
            className="text-gray-500 hover:text-blue-500 p-1 transition-colors"
          >
            <Edit2 size={18} />
          </button>
          <button
            type="button"
            onClick={() => onDelete(project.id)}
            className="text-gray-500 hover:text-red-500 p-1 transition-colors"
          >
            <X size={18} />
          </button>
          <button type="button" className="text-gray-500 hover:text-white p-1">
            <MoreVertical size={18} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="space-y-1">
          <p className="text-[10px] text-gray-500 uppercase font-bold">
            {language === 'ar' ? 'الميزانية' : 'Budget'}
          </p>
          <p className="text-sm font-bold">
            {formatMoney(metrics.budget)}{' '}
            <span className="text-[10px] font-normal opacity-50">ج.م</span>
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] text-gray-500 uppercase font-bold">
            {language === 'ar' ? 'المصروف الفعلي' : 'Actual Spent'}
          </p>
          <p className="text-sm font-bold text-red-400">
            {formatMoney(metrics.spent)}{' '}
            <span className="text-[10px] font-normal opacity-50">ج.م</span>
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] text-gray-500 uppercase font-bold">
            {language === 'ar' ? 'المحصل' : 'Collected'}
          </p>
          <p className="text-sm font-bold text-green-400">
            {formatMoney(metrics.collected)}{' '}
            <span className="text-[10px] font-normal opacity-50">ج.م</span>
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] text-gray-500 uppercase font-bold">
            {language === 'ar' ? 'المستحق' : 'Receivable'}
          </p>
          <p className="text-sm font-bold text-yellow-400">
            {formatMoney(metrics.receivables)}{' '}
            <span className="text-[10px] font-normal opacity-50">ج.م</span>
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between text-[10px] font-bold uppercase">
            <span className="text-gray-400">
              {language === 'ar' ? 'نسبة استهلاك الميزانية' : 'Budget Utilization'}
            </span>
            <span className="text-blue-400">{Math.round(metrics.budgetUtilPct)}%</span>
          </div>
          <div
            className={cn(
              'h-1.5 rounded-full overflow-hidden',
              theme === 'dark' ? 'bg-gray-900' : 'bg-gray-100',
            )}
          >
            <div
              className="h-full bg-blue-600 rounded-full"
              style={{ width: `${Math.min(metrics.budgetUtilPct, 100)}%` }}
            />
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-[10px] font-bold uppercase">
            <span className="text-gray-400">
              {language === 'ar' ? 'نسبة التحصيل من المستخلصات' : 'Collection Rate'}
            </span>
            <span className="text-green-400">{Math.round(metrics.collectionPct)}%</span>
          </div>
          <div
            className={cn(
              'h-1.5 rounded-full overflow-hidden',
              theme === 'dark' ? 'bg-gray-900' : 'bg-gray-100',
            )}
          >
            <div
              className="h-full bg-green-600 rounded-full"
              style={{ width: `${Math.min(metrics.collectionPct, 100)}%` }}
            />
          </div>
        </div>
      </div>

      <div
        className={cn(
          'mt-6 pt-6 border-t flex justify-between items-center',
          theme === 'dark'
            ? 'border-gray-800'
            : theme === 'soft'
              ? 'border-[#cfd8dc]'
              : 'border-gray-200',
        )}
      >
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 text-[10px] text-gray-500">
            <Clock size={12} />
            <span>
              {language === 'ar' ? 'مؤشرات من القيود والمستخلصات' : 'Metrics from GL and IPCs'}
            </span>
          </div>
          <div
            className={cn(
              'flex items-center gap-1 text-[10px] font-bold',
              metrics.grossMargin >= 0 ? 'text-green-400' : 'text-red-400',
            )}
          >
            <TrendingUp size={12} />
            <span>
              {language === 'ar' ? 'هامش' : 'Margin'}: {formatMoney(metrics.grossMargin)} ج.م
            </span>
          </div>
          {metrics.cashFlow < 0 && Math.abs(metrics.cashFlow) > metrics.collected * 0.5 && (
            <div className="flex items-center gap-1 text-[10px] text-red-400 font-bold">
              <AlertCircle size={12} />
              <span>{language === 'ar' ? 'فجوة سيولة حادة' : 'Severe liquidity gap'}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onAddContract(project)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest border shadow-sm',
                theme === 'dark'
                  ? 'bg-purple-500/20 border-purple-500/30 text-purple-400 hover:bg-purple-500 hover:text-white'
                  : 'bg-purple-50 border-purple-100 text-purple-600 hover:bg-purple-600 hover:text-white',
              )}
            >
              <FileText size={14} />
              {language === 'ar' ? 'إضافة عقد' : 'Add Contract'}
            </button>
            <ManualHelpButton topicId="technical.projects.contract" size={16} />
          </div>
          <button
            type="button"
            onClick={() => onOpenDetails(project)}
            className="text-blue-500 hover:text-blue-400 text-xs font-bold flex items-center gap-1 transition-colors"
          >
            {language === 'ar' ? 'تفاصيل المشروع' : 'Project Details'}
            <ExternalLink size={14} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export const ProjectCard = memo(ProjectCardInner);
