import { useState, useEffect, useMemo, useCallback } from 'react';
import { ManualHelpButton } from './help/ManualHelpButton';
import {
  Plus,
  Search,
  Briefcase,
  Loader2,
  FileText,
  X,
} from 'lucide-react';
import { collection, query, orderBy, addDoc, serverTimestamp, where, updateDoc, doc, limit } from 'firebase/firestore';
import { listenQuery } from '../lib/firestoreListen';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { accountingService, AccountCodes } from '../services/accountingService';
import { cn, listKey } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../context/LanguageContext';
import { isLocalBackend } from '../lib/dataBackend';
import { useApiQuery } from '../hooks/useApiQuery';
import toast from 'react-hot-toast';
import { ApiError } from '../lib/apiClient';
import {
  billingApi,
  contractsApi,
  glApi,
  projectsApi,
} from '../services/local/modulesApi';
import {
  computeLiquidityContractRow,
  contractCountByProject,
  hasCustomerReceivableGlActivity,
  receivablesBalanceFromGlTxs,
  type LiquidityGlTxSlice,
} from '../lib/liquidityMetrics';
import { ProjectCard } from './projects/ProjectCard';
import { ProjectFormModal, type ProjectFormData } from './projects/ProjectFormModal';
import { normalizeProjectCoverLogoPath } from '../lib/projectCoverLogos';

const safePct = (num: number | undefined, denom: number | undefined, fallback = 0) =>
  denom && denom > 0 ? (Number(num ?? 0) / denom) * 100 : fallback;

function apiLoadErrorToast(err: unknown, language: string, label: string) {
  const msg =
    err instanceof ApiError
      ? `${label}: ${err.message} (${err.status})`
      : `${label}: ${err instanceof Error ? err.message : String(err)}`;
  toast.error(language === 'ar' ? `فشل تحميل ${label} من الخادم` : `Failed to load ${label} from API`, {
    description: msg,
  } as Parameters<typeof toast.error>[1]);
}

interface Project {
  id: string;
  projectCode: string;
  projectName: string;
  projectNameEn?: string;
  clientName: string;
  clientNameEn?: string;
  status: 'active' | 'completed' | 'suspended' | 'cancelled';
  budget?: number;
  spent?: number;
  collected?: number;
  boqValue?: number;
  voValue?: number;
  coverLogoLeft?: string | null;
  coverLogoCenter?: string | null;
  coverLogoRight?: string | null;
}

interface Contract {
  id: string;
  projectId: string;
  contractName: string;
  contractNameEn?: string;
  contractNumber: string;
  createdAt: any;
}

interface BillingDoc {
  id: string;
  projectId: string;
  contractId: string;
  status: string;
  worksValueExVat?: number;
  vatAmount?: number;
  netPayable?: number;
  isDeleted?: boolean;
}

interface JournalEntry {
  accountCode: string;
  debit?: number;
  credit?: number;
}

interface Transaction {
  id: string;
  date?: string;
  projectId?: string;
  costCenterId?: string;
  reference?: string;
  entries?: JournalEntry[];
  isDeleted?: boolean;
}

interface ProjectMetrics {
  budget: number;
  billed: number;
  spent: number;
  collected: number;
  receivables: number;
  grossMargin: number;
  cashFlow: number;
  progressPct: number;
  budgetUtilPct: number;
  collectionPct: number;
}

const EMPTY_METRICS: ProjectMetrics = {
  budget: 0,
  billed: 0,
  spent: 0,
  collected: 0,
  receivables: 0,
  grossMargin: 0,
  cashFlow: 0,
  progressPct: 0,
  budgetUtilPct: 0,
  collectionPct: 0,
};

/** Project-card GL slice — lower than LISTENER_GL_TX_GENERAL_CAP; metrics are approximate if truncated. */
const PROJECT_CARDS_GL_TX_CAP = 2000;

const EMPTY_FORM: ProjectFormData = {
  projectCode: '',
  projectName: '',
  projectNameEn: '',
  clientName: '',
  clientNameEn: '',
  status: 'active',
  boqValue: 0,
  voValue: 0,
  coverLogoLeft: '',
  coverLogoCenter: '',
  coverLogoRight: '',
};

function projectBudget(project: Project): number {
  return Number(project.boqValue || project.budget || 0) + Number(project.voValue || 0);
}

export function Projects({ embedded = false }: { embedded?: boolean }) {
  const { language, theme, dir, formatMoney, t } = useLanguage();
  const [projects, setProjects] = useState<Project[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [billings, setBillings] = useState<BillingDoc[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [localTransactions, setLocalTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed'>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [formInitialData, setFormInitialData] = useState<ProjectFormData>(EMPTY_FORM);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isContractModalOpen, setIsContractModalOpen] = useState(false);
  const [targetProjectForContract, setTargetProjectForContract] = useState<Project | null>(null);
  const [dataRefreshKey, setDataRefreshKey] = useState(0);

  const [contractFormData, setContractFormData] = useState({
    contractName: '',
    contractNameEn: '',
    contractNumber: '',
  });

  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  useEffect(() => {
    if (isLocalBackend) return;
    const q = query(
      collection(db, 'projects'),
      where('isDeleted', '==', false),
      orderBy('projectCode'),
    );
    const unsubscribe = listenQuery(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((d) => {
          const docData = d.data();
          return {
            id: d.id,
            ...docData,
            budget: docData.budget || 0,
            spent: docData.spent || 0,
            collected: docData.collected || 0,
          } as Project;
        });
        setProjects(data);
        setLoading(false);
      },
      (error) => {
        setLoading(false);
        handleFirestoreError(error, OperationType.LIST, 'projects');
      },
    );
    return () => unsubscribe();
  }, []);

  const { data: apiProjects, loading: apiProjectsLoading, error: apiProjectsError } = useApiQuery<Project>(
    async () => {
      const rows = (await projectsApi.list()) as unknown as Project[];
      return rows
        .map((row) => ({
          ...row,
          budget: Number(row.budget ?? 0),
          spent: Number(row.spent ?? 0),
          collected: Number(row.collected ?? 0),
          boqValue: Number(row.boqValue ?? 0),
          voValue: Number(row.voValue ?? 0),
        }))
        .sort((a, b) => a.projectCode.localeCompare(b.projectCode));
    },
    [dataRefreshKey],
    { enabled: isLocalBackend, refreshKey: dataRefreshKey },
  );

  useEffect(() => {
    if (!isLocalBackend) return;
    setProjects(apiProjects);
    setLoading(apiProjectsLoading);
  }, [isLocalBackend, apiProjects, apiProjectsLoading]);

  useEffect(() => {
    if (!isLocalBackend || !apiProjectsError) return;
    apiLoadErrorToast(apiProjectsError, language, language === 'ar' ? 'المشاريع' : 'projects');
  }, [apiProjectsError, language]);

  useEffect(() => {
    if (isLocalBackend) return;
    const q = query(collection(db, 'contracts'), where('isDeleted', '==', false));
    const unsubscribe = listenQuery(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as Contract[];
        setContracts(data);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'contracts');
      },
    );
    return () => unsubscribe();
  }, []);

  const { data: apiContracts, error: apiContractsError } = useApiQuery<Contract>(
    () => contractsApi.list() as Promise<Contract[]>,
    [dataRefreshKey],
    { enabled: isLocalBackend, refreshKey: dataRefreshKey },
  );

  useEffect(() => {
    if (!isLocalBackend) return;
    setContracts(apiContracts);
  }, [isLocalBackend, apiContracts]);

  useEffect(() => {
    if (!isLocalBackend || !apiContractsError) return;
    apiLoadErrorToast(apiContractsError, language, language === 'ar' ? 'العقود' : 'contracts');
  }, [apiContractsError, language]);

  useEffect(() => {
    if (isLocalBackend) return;
    const q = query(collection(db, 'billing'), where('isDeleted', '!=', true));
    const unsubscribe = listenQuery(
      q,
      (snapshot) => {
        setBillings(snapshot.docs.map((d) => ({ ...d.data(), id: d.id } as BillingDoc)));
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'billing');
      },
    );
    return () => unsubscribe();
  }, []);

  const { data: apiBillings } = useApiQuery<BillingDoc>(
    () => billingApi.list() as Promise<BillingDoc[]>,
    [dataRefreshKey],
    { enabled: isLocalBackend, refreshKey: dataRefreshKey },
  );

  useEffect(() => {
    if (!isLocalBackend) return;
    setBillings(apiBillings);
  }, [isLocalBackend, apiBillings]);

  useEffect(() => {
    if (isLocalBackend) return;
    const q = query(
      collection(db, 'transactions'),
      where('isDeleted', '==', false),
      orderBy('date', 'desc'),
      limit(PROJECT_CARDS_GL_TX_CAP),
    );
    const unsubscribe = listenQuery(
      q,
      (snapshot) => {
        setTransactions(snapshot.docs.map((d) => ({ ...d.data(), id: d.id } as Transaction)));
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'transactions');
      },
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!isLocalBackend) {
      setLocalTransactions([]);
      return;
    }
    let cancelled = false;
    glApi
      .transactions(undefined, PROJECT_CARDS_GL_TX_CAP)
      .then((rows) => {
        if (!cancelled) setLocalTransactions(rows as Transaction[]);
      })
      .catch(() => {
        if (!cancelled) setLocalTransactions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [dataRefreshKey]);

  const mergedTransactions = useMemo(() => {
    if (isLocalBackend) {
      return [...localTransactions]
        .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
        .slice(0, PROJECT_CARDS_GL_TX_CAP);
    }
    const byId = new Map<string, Transaction>();
    for (const t of transactions) byId.set(String(t.id), t);
    for (const t of localTransactions) byId.set(String(t.id), t);
    return [...byId.values()]
      .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
      .slice(0, PROJECT_CARDS_GL_TX_CAP);
  }, [isLocalBackend, transactions, localTransactions]);

  const glSlice = useMemo((): LiquidityGlTxSlice[] => {
    return mergedTransactions.map((tx) => ({
      costCenterId: tx.costCenterId,
      projectId: tx.projectId,
      reference: tx.reference,
      entries: (tx.entries || []).map((e) => ({
        accountCode: e.accountCode,
        debit: Number(e.debit || 0),
        credit: Number(e.credit || 0),
      })),
    }));
  }, [mergedTransactions]);

  const contractProjectMap = useMemo(() => {
    const map = new Map<string, string>();
    contracts.forEach((contract) => map.set(contract.id, contract.projectId));
    return map;
  }, [contracts]);

  const contractsByProjectId = useMemo(() => {
    const map = new Map<string, Contract[]>();
    for (const contract of contracts) {
      const list = map.get(contract.projectId);
      if (list) list.push(contract);
      else map.set(contract.projectId, [contract]);
    }
    return map;
  }, [contracts]);

  const contractCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const [projectId, list] of contractsByProjectId) {
      map.set(projectId, list.length);
    }
    return map;
  }, [contractsByProjectId]);

  const projectMetricsMap = useMemo(() => {
    const map = new Map<string, ProjectMetrics>();
    const countMap = contractCountByProject(contracts);
    const activeBillings = billings.filter((b) => !b.isDeleted);

    for (const project of projects) {
      map.set(project.id, { ...EMPTY_METRICS, budget: projectBudget(project) });
    }

    for (const contract of contracts) {
      const row = computeLiquidityContractRow(contract, activeBillings, glSlice, countMap);
      const metrics = map.get(contract.projectId) || { ...EMPTY_METRICS };
      metrics.billed += row.totalBilled;
      metrics.collected += row.ipcCollected;
      metrics.receivables += row.uncollected;
      map.set(contract.projectId, metrics);
    }

    // One-pass over glSlice: spent + GL buckets by projectId (no per-project filter).
    const spentByProject = new Map<string, number>();
    const glByProject = new Map<string, typeof glSlice>();
    for (const tx of glSlice) {
      const projectId =
        tx.projectId || (tx.costCenterId ? contractProjectMap.get(tx.costCenterId) : undefined);
      if (!projectId) continue;

      let spentAdd = 0;
      for (const entry of tx.entries || []) {
        const code = String(entry.accountCode ?? '').trim();
        const debit = Number(entry.debit || 0);
        if (code.startsWith('5') || code === AccountCodes.VAT_INPUT) {
          spentAdd += debit;
        }
      }
      if (spentAdd) {
        spentByProject.set(projectId, (spentByProject.get(projectId) || 0) + spentAdd);
      }

      const bucket = glByProject.get(projectId);
      if (bucket) bucket.push(tx);
      else glByProject.set(projectId, [tx]);
    }

    for (const project of projects) {
      const metrics = map.get(project.id) || { ...EMPTY_METRICS, budget: projectBudget(project) };
      metrics.spent = spentByProject.get(project.id) || 0;
      const projectGlTxs = glByProject.get(project.id);
      if (projectGlTxs && hasCustomerReceivableGlActivity(projectGlTxs)) {
        metrics.receivables = Math.max(0, receivablesBalanceFromGlTxs(projectGlTxs));
      }
      metrics.grossMargin = metrics.billed - metrics.spent;
      metrics.cashFlow = metrics.collected - metrics.spent;
      metrics.progressPct = safePct(metrics.billed, metrics.budget);
      metrics.budgetUtilPct = safePct(metrics.spent, metrics.budget);
      metrics.collectionPct = safePct(metrics.collected, metrics.billed);
      map.set(project.id, metrics);
    }

    return map;
  }, [projects, billings, contracts, glSlice, contractProjectMap]);

  const nextProjectCode = useMemo(() => {
    const year = new Date().getFullYear();
    const nums = projects
      .map((p) => {
        const m = p.projectCode.match(/(\d+)$/);
        return m ? parseInt(m[1], 10) : 0;
      })
      .filter((n) => n > 0);
    const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
    return `PRJ-${year}-${String(next).padStart(3, '0')}`;
  }, [projects]);

  const handleSubmit = useCallback(
    async (formData: ProjectFormData) => {
      setIsSubmitting(true);
      try {
        const logoOrNull = (v: string) => {
          const t = normalizeProjectCoverLogoPath(v);
          return t || null;
        };
        const projectData = {
          ...formData,
          coverLogoLeft: logoOrNull(formData.coverLogoLeft),
          coverLogoCenter: logoOrNull(formData.coverLogoCenter),
          coverLogoRight: logoOrNull(formData.coverLogoRight),
          budget: formData.boqValue + formData.voValue,
          ...(isLocalBackend ? {} : { updatedAt: serverTimestamp() }),
        };

        if (isLocalBackend) {
          if (editingProject) {
            await projectsApi.update(editingProject.id, projectData);
          } else {
            await projectsApi.create({
              ...projectData,
              spent: 0,
              collected: 0,
              isDeleted: false,
            } as Parameters<typeof projectsApi.create>[0]);
          }
          setDataRefreshKey((k) => k + 1);
        } else if (editingProject) {
          await updateDoc(doc(db, 'projects', editingProject.id), {
            ...projectData,
            updatedAt: serverTimestamp(),
          });
        } else {
          await addDoc(collection(db, 'projects'), {
            ...projectData,
            createdAt: serverTimestamp(),
            spent: 0,
            collected: 0,
            isDeleted: false,
          });
        }

        setIsModalOpen(false);
        setEditingProject(null);
        setFormInitialData(EMPTY_FORM);
      } catch (error) {
        handleFirestoreError(error, editingProject ? OperationType.UPDATE : OperationType.CREATE, 'projects');
      } finally {
        setIsSubmitting(false);
      }
    },
    [editingProject],
  );

  const handleContractSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetProjectForContract) return;
    setIsSubmitting(true);

    try {
      if (isLocalBackend) {
        await contractsApi.create({
          ...contractFormData,
          projectId: targetProjectForContract.id,
          isDeleted: false,
        });
        setDataRefreshKey((k) => k + 1);
      } else {
        await addDoc(collection(db, 'contracts'), {
          ...contractFormData,
          projectId: targetProjectForContract.id,
          isDeleted: false,
          createdAt: serverTimestamp(),
        });
      }
      setIsContractModalOpen(false);
      setContractFormData({ contractName: '', contractNameEn: '', contractNumber: '' });
      setTargetProjectForContract(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'contracts');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = useCallback((project: Project) => {
    setEditingProject(project);
    setFormInitialData({
      projectCode: project.projectCode,
      projectName: project.projectName,
      projectNameEn: project.projectNameEn || '',
      clientName: project.clientName,
      clientNameEn: project.clientNameEn || '',
      status: project.status,
      boqValue: project.boqValue || 0,
      voValue: project.voValue || 0,
      coverLogoLeft: project.coverLogoLeft || '',
      coverLogoCenter: project.coverLogoCenter || '',
      coverLogoRight: project.coverLogoRight || '',
    });
    setIsModalOpen(true);
  }, []);

  const handleDelete = useCallback(
    (id: string) => {
      setConfirmConfig({
        isOpen: true,
        title: language === 'ar' ? 'تأكيد الحذف' : 'Confirm Delete',
        message:
          language === 'ar'
            ? 'هل أنت متأكد من حذف هذا المشروع؟'
            : 'Are you sure you want to delete this project?',
        onConfirm: async () => {
          setIsSubmitting(true);
          try {
            if (isLocalBackend) {
              await projectsApi.remove(id);
              setDataRefreshKey((k) => k + 1);
            } else {
              await accountingService.softDelete('projects', id);
            }
            setConfirmConfig((prev) => ({ ...prev, isOpen: false }));
          } catch (error) {
            console.error('Error deleting project:', error);
          } finally {
            setIsSubmitting(false);
          }
        },
      });
    },
    [language],
  );

  const handleAddContract = useCallback((project: Project) => {
    setTargetProjectForContract(project);
    setIsContractModalOpen(true);
  }, []);

  const handleOpenDetails = useCallback((project: Project) => {
    setSelectedProject(project);
  }, []);

  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim();
    return projects.filter((p) => {
      const matchesSearch =
        !q ||
        p.projectName.includes(q) ||
        p.projectCode.includes(q) ||
        (p.clientName?.includes(q) ?? false);
      if (!matchesSearch) return false;
      if (statusFilter === 'active') return p.status === 'active';
      if (statusFilter === 'completed') {
        return p.status === 'completed' || p.status === 'suspended' || p.status === 'cancelled';
      }
      return true;
    });
  }, [projects, searchQuery, statusFilter]);

  const selectedProjectMetrics = selectedProject
    ? projectMetricsMap.get(selectedProject.id) || {
        ...EMPTY_METRICS,
        budget: projectBudget(selectedProject),
      }
    : EMPTY_METRICS;

  const selectedProjectContracts = selectedProject
    ? contractsByProjectId.get(selectedProject.id) || []
    : [];

  const cardCls = cn(
    'rounded-xl border p-4',
    theme === 'dark'
      ? 'border-gray-800 bg-gray-900/40'
      : theme === 'soft'
        ? 'border-[#cfd8dc] bg-white'
        : 'border-gray-200 bg-white',
  );
  const sectionTitleCls = 'text-xs font-bold uppercase tracking-wide text-gray-500';
  const inputCls = cn(
    'w-full border rounded-lg py-2 px-3 text-sm outline-none focus:border-blue-500 transition-colors',
    theme === 'dark'
      ? 'bg-gray-900 border-gray-800 text-gray-100'
      : theme === 'soft'
        ? 'bg-white border-[#cfd8dc] text-[#37474f]'
        : 'bg-white border-gray-300 text-gray-900',
  );
  const btnSmCls = cn(
    'inline-flex items-center justify-center gap-1 rounded-lg text-xs font-bold transition-colors border',
    theme === 'dark' ? 'border-gray-700' : 'border-gray-200',
  );

  const openNewProjectModal = () => {
    setEditingProject(null);
    setFormInitialData({
      ...EMPTY_FORM,
      projectCode: nextProjectCode,
    });
    setIsModalOpen(true);
  };

  return (
    <div
      className={cn(
        embedded ? 'p-4 md:p-6' : 'p-8 min-h-screen',
        'transition-colors',
        !embedded &&
          (theme === 'dark'
            ? 'bg-[#0a0a0a] text-gray-100'
            : theme === 'soft'
              ? 'bg-[#eceff1] text-[#37474f]'
              : 'bg-gray-50 text-gray-900'),
      )}
      dir={dir}
    >
      {!embedded && (
        <header className="mb-6">
          <h2 className="text-3xl font-bold tracking-tight">
            {language === 'ar' ? 'إدارة المشاريع' : 'Project Management'}
          </h2>
          <p className="text-gray-400 mt-1">
            {language === 'ar'
              ? 'متابعة الحالة التنفيذية والمالية لمواقع العمل'
              : 'Track execution and financial status of work sites'}
          </p>
        </header>
      )}

      <ProjectFormModal
        open={isModalOpen}
        isEditing={!!editingProject}
        initialData={formInitialData}
        isSubmitting={isSubmitting}
        language={language}
        theme={theme}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleSubmit}
      />

      {/* Confirmation Modal */}
      <AnimatePresence>
        {confirmConfig.isOpen && (
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
                <h3 className="text-lg font-bold text-red-500">{confirmConfig.title}</h3>
                <button
                  type="button"
                  onClick={() => setConfirmConfig((prev) => ({ ...prev, isOpen: false }))}
                  className="text-gray-500 hover:text-white transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="p-6">
                <p className={cn('text-sm', theme === 'dark' ? 'text-gray-300' : 'text-gray-600')}>
                  {confirmConfig.message}
                </p>
              </div>
              <div
                className={cn(
                  'p-6 border-t flex justify-end gap-3',
                  theme === 'dark'
                    ? 'bg-gray-900/30 border-gray-800'
                    : theme === 'soft'
                      ? 'bg-[#eceff1] border-[#cfd8dc]'
                      : 'bg-gray-50 border-gray-200',
                )}
              >
                <button
                  type="button"
                  onClick={() => setConfirmConfig((prev) => ({ ...prev, isOpen: false }))}
                  className={cn(
                    'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                    theme === 'dark'
                      ? 'text-gray-400 hover:text-white hover:bg-gray-800'
                      : theme === 'soft'
                        ? 'text-[#546e7a] hover:bg-[#cfd8dc] hover:text-[#37474f]'
                        : 'text-gray-500 hover:bg-gray-100',
                  )}
                >
                  {language === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="button"
                  onClick={confirmConfig.onConfirm}
                  disabled={isSubmitting}
                  className="px-6 py-2 rounded-lg text-sm font-bold bg-red-600 hover:bg-red-500 text-white transition-colors flex items-center gap-2"
                >
                  {isSubmitting && <Loader2 className="animate-spin" size={16} />}
                  {language === 'ar' ? 'تأكيد' : 'Confirm'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Project Details Modal */}
      <AnimatePresence>
        {selectedProject && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className={cn(
                'border rounded-3xl w-full max-w-2xl flex flex-col max-h-[90vh] overflow-hidden shadow-2xl transition-colors',
                theme === 'dark'
                  ? 'bg-[#151619] border-gray-800'
                  : theme === 'soft'
                    ? 'bg-white border-[#cfd8dc]'
                    : 'bg-white border-gray-200',
              )}
            >
              <div
                className={cn(
                  'p-8 border-b flex justify-between items-start',
                  theme === 'dark'
                    ? 'bg-gray-900/50 border-gray-800'
                    : theme === 'soft'
                      ? 'bg-[#eceff1] border-[#cfd8dc]'
                      : 'bg-gray-50 border-gray-200',
                )}
              >
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-blue-500/20 rounded-lg text-blue-500">
                      <Briefcase size={24} />
                    </div>
                    <div>
                      <h3 className="text-2xl font-black">{selectedProject.projectName}</h3>
                      <p className="text-sm text-gray-400 font-mono tracking-widest">
                        {selectedProject.projectCode}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-4 text-xs">
                    <span
                      className={cn(
                        'px-3 py-1 rounded-full font-black uppercase',
                        selectedProject.status === 'active'
                          ? 'bg-green-900/20 text-green-500'
                          : 'bg-gray-800 text-gray-400',
                      )}
                    >
                      {selectedProject.status === 'active'
                        ? language === 'ar'
                          ? 'نشط'
                          : 'Active'
                        : language === 'ar'
                          ? 'مكتمل'
                          : 'Completed'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedProject(null)}
                  className={cn(
                    'p-2 rounded-xl transition-colors',
                    theme === 'dark'
                      ? 'bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white'
                      : 'bg-gray-100 hover:bg-gray-200 text-gray-500',
                  )}
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-8 space-y-8 overflow-y-auto flex-1">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div
                    className={cn(
                      'p-6 rounded-2xl border',
                      theme === 'dark'
                        ? 'bg-gray-900/30 border-gray-800'
                        : 'bg-gray-50 border-gray-100 shadow-sm',
                    )}
                  >
                    <p className="text-[10px] font-black text-gray-500 uppercase mb-2 tracking-widest">
                      {language === 'ar' ? 'الميزانية الإجمالية' : 'Total Budget'}
                    </p>
                    <p className="text-2xl font-black text-blue-500">
                      {formatMoney(selectedProjectMetrics.budget)}
                    </p>
                    <p className="text-[10px] text-gray-400 font-bold mt-1">ج.م</p>
                  </div>
                  <div
                    className={cn(
                      'p-6 rounded-2xl border',
                      theme === 'dark'
                        ? 'bg-gray-900/30 border-gray-800'
                        : 'bg-gray-50 border-gray-100 shadow-sm',
                    )}
                  >
                    <p className="text-[10px] font-black text-gray-500 uppercase mb-2 tracking-widest">
                      {language === 'ar' ? 'المصاريف الفعلية' : 'Actual Spent'}
                    </p>
                    <p className="text-2xl font-black text-red-500">
                      {formatMoney(selectedProjectMetrics.spent)}
                    </p>
                    <p className="text-[10px] text-gray-400 font-bold mt-1">ج.م</p>
                  </div>
                  <div
                    className={cn(
                      'p-6 rounded-2xl border',
                      theme === 'dark'
                        ? 'bg-gray-900/30 border-gray-800'
                        : 'bg-gray-50 border-gray-100 shadow-sm',
                    )}
                  >
                    <p className="text-[10px] font-black text-gray-500 uppercase mb-2 tracking-widest">
                      {language === 'ar' ? 'المبالغ المحصلة' : 'Collected'}
                    </p>
                    <p className="text-2xl font-black text-green-500">
                      {formatMoney(selectedProjectMetrics.collected)}
                    </p>
                    <p className="text-[10px] text-gray-400 font-bold mt-1">ج.م</p>
                  </div>
                  <div
                    className={cn(
                      'p-6 rounded-2xl border',
                      theme === 'dark'
                        ? 'bg-gray-900/30 border-gray-800'
                        : 'bg-gray-50 border-gray-100 shadow-sm',
                    )}
                  >
                    <p className="text-[10px] font-black text-gray-500 uppercase mb-2 tracking-widest">
                      {language === 'ar' ? 'إجمالي المستخلصات' : 'Billed'}
                    </p>
                    <p className="text-2xl font-black text-purple-500">
                      {formatMoney(selectedProjectMetrics.billed)}
                    </p>
                    <p className="text-[10px] text-gray-400 font-bold mt-1">ج.م</p>
                  </div>
                  <div
                    className={cn(
                      'p-6 rounded-2xl border',
                      theme === 'dark'
                        ? 'bg-gray-900/30 border-gray-800'
                        : 'bg-gray-50 border-gray-100 shadow-sm',
                    )}
                  >
                    <p className="text-[10px] font-black text-gray-500 uppercase mb-2 tracking-widest">
                      {language === 'ar' ? 'مستحقات تحت التحصيل' : 'Receivables'}
                    </p>
                    <p className="text-2xl font-black text-yellow-500">
                      {formatMoney(selectedProjectMetrics.receivables)}
                    </p>
                    <p className="text-[10px] text-gray-400 font-bold mt-1">ج.م</p>
                  </div>
                  <div
                    className={cn(
                      'p-6 rounded-2xl border',
                      theme === 'dark'
                        ? 'bg-gray-900/30 border-gray-800'
                        : 'bg-gray-50 border-gray-100 shadow-sm',
                    )}
                  >
                    <p className="text-[10px] font-black text-gray-500 uppercase mb-2 tracking-widest">
                      {language === 'ar' ? 'هامش الربح' : 'Gross Margin'}
                    </p>
                    <p
                      className={cn(
                        'text-2xl font-black',
                        selectedProjectMetrics.grossMargin >= 0 ? 'text-green-500' : 'text-red-500',
                      )}
                    >
                      {formatMoney(selectedProjectMetrics.grossMargin)}
                    </p>
                    <p className="text-[10px] text-gray-400 font-bold mt-1">ج.م</p>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="space-y-3">
                    <div className="flex justify-between items-end">
                      <span className="text-xs font-black text-gray-400 uppercase tracking-widest">
                        {language === 'ar' ? 'نسبة الإنجاز المالي' : 'Financial Progress'}
                      </span>
                      <span className="text-lg font-black text-purple-500">
                        {Math.round(selectedProjectMetrics.progressPct)}%
                      </span>
                    </div>
                    <div className="h-3 bg-gray-900 rounded-full overflow-hidden p-1 shadow-inner border border-gray-800">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(selectedProjectMetrics.progressPct, 100)}%` }}
                        className="h-full bg-purple-500 rounded-full shadow-[0_0_10px_rgba(168,85,247,0.5)]"
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-black text-gray-400 uppercase tracking-widest">
                        {language === 'ar' ? 'العقود المرتبطة' : 'Linked Contracts'}
                      </span>
                      <span className="bg-purple-500/10 text-purple-500 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest">
                        {selectedProjectContracts.length}{' '}
                        {language === 'ar' ? 'عقود' : 'Contracts'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                      {selectedProjectContracts.map((contract, ci) => (
                        <div
                          key={listKey(contract.id, ci, `contract-${contract.contractNumber}`)}
                          className={cn(
                            'p-3 rounded-xl border flex flex-col gap-1',
                            theme === 'dark'
                              ? 'bg-gray-900 border-purple-500/10'
                              : 'bg-purple-50/30 border-purple-100',
                          )}
                        >
                          <p className="text-xs font-black truncate">{contract.contractName}</p>
                          <p className="text-[10px] font-mono text-purple-500/80">
                            {contract.contractNumber}
                          </p>
                        </div>
                      ))}
                      {selectedProjectContracts.length === 0 && (
                        <p className="col-span-full text-center py-4 text-xs text-gray-500 italic">
                          {language === 'ar' ? 'لا توجد عقود حتى الآن' : 'No contracts yet'}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between items-end">
                      <span className="text-xs font-black text-gray-400 uppercase tracking-widest">
                        {language === 'ar' ? 'استهلاك الميزانية' : 'Budget Utilization'}
                      </span>
                      <span className="text-lg font-black text-blue-500">
                        {Math.round(selectedProjectMetrics.budgetUtilPct)}%
                      </span>
                    </div>
                    <div className="h-3 bg-gray-900 rounded-full overflow-hidden p-1 shadow-inner border border-gray-800">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{
                          width: `${Math.min(selectedProjectMetrics.budgetUtilPct, 100)}%`,
                        }}
                        className="h-full bg-blue-500 rounded-full shadow-[0_0_10px_rgba(59,130,246,0.5)]"
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between items-end">
                      <span className="text-xs font-black text-gray-400 uppercase tracking-widest">
                        {language === 'ar' ? 'كفاءة التحصيل' : 'Collection Efficiency'}
                      </span>
                      <span className="text-lg font-black text-green-500">
                        {Math.round(selectedProjectMetrics.collectionPct)}%
                      </span>
                    </div>
                    <div className="h-3 bg-gray-900 rounded-full overflow-hidden p-1 shadow-inner border border-gray-800">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{
                          width: `${Math.min(selectedProjectMetrics.collectionPct, 100)}%`,
                        }}
                        className="h-full bg-green-500 rounded-full shadow-[0_0_10px_rgba(34,197,94,0.5)]"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div
                    className={cn(
                      'p-6 rounded-2xl border flex items-center gap-4',
                      theme === 'dark'
                        ? 'bg-gray-900/30 border-gray-800'
                        : 'bg-white border-gray-200',
                    )}
                  >
                    <p className="text-xs font-black text-gray-500 uppercase vertical-text">
                      {language === 'ar' ? 'العميل' : 'Client'}
                    </p>
                    <div className="bg-gray-800/50 w-px h-10 mx-2" />
                    <p className="text-lg font-bold">{selectedProject.clientName}</p>
                  </div>
                  <div
                    className={cn(
                      'p-6 rounded-2xl border flex items-center gap-4',
                      theme === 'dark'
                        ? 'bg-gray-900/30 border-gray-800'
                        : 'bg-white border-gray-200',
                    )}
                  >
                    <p className="text-xs font-black text-gray-500 uppercase vertical-text">
                      {language === 'ar' ? 'السيولة' : 'Liquidity'}
                    </p>
                    <div className="bg-gray-800/50 w-px h-10 mx-2" />
                    <p
                      className={cn(
                        'text-lg font-bold',
                        selectedProjectMetrics.cashFlow >= 0 ? 'text-green-500' : 'text-red-500',
                      )}
                    >
                      {formatMoney(selectedProjectMetrics.cashFlow)} ج.م
                    </p>
                  </div>
                </div>
              </div>

              <div
                className={cn(
                  'p-8 border-t flex gap-4',
                  theme === 'dark' ? 'bg-gray-900/50 border-gray-800' : 'bg-gray-50 border-gray-100',
                )}
              >
                <button
                  type="button"
                  onClick={() => setSelectedProject(null)}
                  className="flex-1 bg-gray-800 hover:bg-gray-700 text-white font-black py-4 rounded-2xl transition-all uppercase tracking-widest text-sm"
                >
                  {language === 'ar' ? 'إغلاق التفاصيل' : 'Close Details'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* New Contract Modal */}
      <AnimatePresence>
        {isContractModalOpen && (
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
                <h3 className="text-xl font-bold flex items-center gap-2">
                  <FileText className="text-purple-500" size={24} />
                  {language === 'ar' ? 'إضافة عقد جديد' : 'Add New Contract'}
                </h3>
                <button
                  type="button"
                  onClick={() => setIsContractModalOpen(false)}
                  className={cn(
                    'transition-colors',
                    theme === 'dark'
                      ? 'text-gray-500 hover:text-white'
                      : 'text-gray-400 hover:text-gray-900',
                  )}
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-4 bg-purple-900/10 border-b border-purple-500/20">
                <p className="text-[10px] font-bold text-purple-400 uppercase tracking-widest leading-relaxed text-center">
                  {language === 'ar' ? 'للمشروع:' : 'For Project:'}{' '}
                  <span className={theme === 'dark' ? 'text-white' : 'text-gray-900'}>
                    {targetProjectForContract?.projectName}
                  </span>
                </p>
              </div>

              <form onSubmit={handleContractSubmit} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase">
                      {language === 'ar' ? 'اسم العقد (عربي)' : 'Contract Name (AR)'}
                    </label>
                    <input
                      required
                      type="text"
                      placeholder="اسم العقد بالعربية"
                      className={cn(
                        'w-full border rounded-lg py-2 px-4 text-sm outline-none focus:border-purple-500 transition-colors',
                        theme === 'dark'
                          ? 'bg-gray-900 border-gray-800 text-white'
                          : theme === 'soft'
                            ? 'bg-white border-[#cfd8dc]'
                            : 'bg-white border-gray-200 shadow-sm',
                      )}
                      value={contractFormData.contractName}
                      onChange={(e) =>
                        setContractFormData({ ...contractFormData, contractName: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase">
                      {language === 'ar' ? 'اسم العقد (إنجليزي)' : 'Contract Name (EN)'}
                    </label>
                    <input
                      type="text"
                      placeholder="Contract name in English"
                      dir="ltr"
                      className={cn(
                        'w-full border rounded-lg py-2 px-4 text-sm outline-none focus:border-purple-500 transition-colors',
                        theme === 'dark'
                          ? 'bg-gray-900 border-gray-800 text-white'
                          : theme === 'soft'
                            ? 'bg-white border-[#cfd8dc]'
                            : 'bg-white border-gray-200 shadow-sm',
                      )}
                      value={contractFormData.contractNameEn}
                      onChange={(e) =>
                        setContractFormData({
                          ...contractFormData,
                          contractNameEn: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-400 uppercase">
                    {language === 'ar' ? 'رقم العقد' : 'Contract Number'}
                  </label>
                  <input
                    required
                    type="text"
                    className={cn(
                      'w-full border rounded-lg py-2 px-4 text-sm outline-none focus:border-purple-500 transition-colors font-mono',
                      theme === 'dark'
                        ? 'bg-gray-900 border-gray-800 text-white'
                        : theme === 'soft'
                          ? 'bg-white border-[#cfd8dc]'
                          : 'bg-white border-gray-200 shadow-sm',
                    )}
                    value={contractFormData.contractNumber}
                    onChange={(e) =>
                      setContractFormData({
                        ...contractFormData,
                        contractNumber: e.target.value,
                      })
                    }
                  />
                </div>

                <div className="pt-4 flex gap-3">
                  <button
                    disabled={isSubmitting}
                    type="submit"
                    className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-800 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-purple-900/20 text-white"
                  >
                    {isSubmitting && <Loader2 className="animate-spin" size={18} />}
                    {language === 'ar' ? 'تأكيد الإضافة' : 'Confirm'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsContractModalOpen(false)}
                    className={cn(
                      'flex-1 py-3 rounded-xl font-bold transition-all',
                      theme === 'dark'
                        ? 'bg-gray-800 hover:bg-gray-700 text-white'
                        : 'bg-gray-100 hover:bg-gray-200 text-gray-700',
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

      <div
        className={cn(
          'flex flex-col md:flex-row md:items-start gap-4',
          dir === 'rtl' ? 'md:flex-row-reverse' : '',
        )}
      >
        <div className="flex-1 min-w-0 md:flex-[3] space-y-4 order-2 md:order-none">
          <div
            className={cn(
              'grid gap-4',
              embedded ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-2',
            )}
          >
            {loading ? (
              <div className="col-span-full p-12 text-center text-gray-500">
                {language === 'ar' ? 'جاري تحميل المشاريع...' : 'Loading projects...'}
              </div>
            ) : filteredProjects.length === 0 ? (
              <div
                className={cn(
                  'col-span-full border rounded-xl p-12 text-center',
                  theme === 'dark'
                    ? 'border-gray-800 bg-[#151619]'
                    : theme === 'soft'
                      ? 'border-[#cfd8dc] bg-white'
                      : 'border-gray-200 bg-white',
                )}
              >
                <p className={cn('text-sm', theme === 'dark' ? 'text-gray-400' : 'text-gray-600')}>
                  {t('projects_filter_empty')}
                </p>
              </div>
            ) : (
              filteredProjects.map((project, i) => (
                <ProjectCard
                  key={listKey(project.id, i, `project-${project.projectCode}`)}
                  project={project}
                  metrics={projectMetricsMap.get(project.id) || EMPTY_METRICS}
                  contractCount={contractCountMap.get(project.id) || 0}
                  language={language}
                  theme={theme}
                  formatMoney={formatMoney}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onAddContract={handleAddContract}
                  onOpenDetails={handleOpenDetails}
                />
              ))
            )}
          </div>
        </div>

        <aside
          className={cn(
            cardCls,
            'w-full md:flex-[2] md:min-w-[17rem] md:max-w-[24rem] shrink-0 space-y-4 md:sticky md:top-4 order-1 md:order-none',
          )}
        >
          <div>
            <h3 className="font-bold text-sm">{t('projects_filter_title')}</h3>
          </div>

          <div>
            <label
              className={cn(
                'block text-xs font-bold mb-1.5',
                theme === 'dark' ? 'text-gray-400' : 'text-gray-500',
              )}
            >
              {t('projects_filter_search')}
            </label>
            <div className="relative">
              <Search
                className={cn(
                  'absolute top-1/2 -translate-y-1/2 text-gray-500',
                  dir === 'rtl' ? 'right-3' : 'left-3',
                )}
                size={16}
              />
              <input
                type="text"
                className={cn(inputCls, dir === 'rtl' ? 'pr-9 pl-3' : 'pl-9 pr-3')}
                placeholder={t('projects_filter_search_placeholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div
            className={cn(
              'pt-3 border-t space-y-2.5',
              theme === 'dark' ? 'border-gray-800' : 'border-gray-200',
            )}
          >
            <p className={sectionTitleCls}>{t('projects_filter_status')}</p>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'all' as const, labelKey: 'projects_filter_status_all' },
                  { id: 'active' as const, labelKey: 'projects_filter_status_active' },
                  { id: 'completed' as const, labelKey: 'projects_filter_status_completed' },
                ] as const
              ).map(({ id, labelKey }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setStatusFilter(id)}
                  className={cn(
                    btnSmCls,
                    'py-2 px-1',
                    statusFilter === id
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : theme === 'dark'
                        ? 'text-gray-300 hover:bg-gray-800'
                        : 'text-gray-700 hover:bg-gray-50',
                  )}
                >
                  {t(labelKey)}
                </button>
              ))}
            </div>
          </div>

          <div
            className={cn(
              'pt-3 border-t',
              theme === 'dark' ? 'border-gray-800' : 'border-gray-200',
            )}
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openNewProjectModal}
                className="inline-flex flex-1 items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold transition-colors"
              >
                <Plus size={16} />
                {language === 'ar' ? 'مشروع جديد' : 'New Project'}
              </button>
              <ManualHelpButton topicId="technical.projects.create" />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
