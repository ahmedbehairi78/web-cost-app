import React, { memo } from 'react';
import { Loader2, Plus, Search } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ManualHelpButton } from '../help/ManualHelpButton';

export type CostsSidebarPurchaseRow = {
  id: string;
  type?: string;
  referenceNumber?: string;
  date?: string;
  supplierName?: string;
  paymentType?: string | null;
  status?: string;
  transactionId?: string | null;
};

export type CostsPurchaseStatusFilter =
  | 'all'
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'pending'
  | 'posted'
  | 'paid';

export type CostsPurchaseStatusCounts = {
  all: number;
  draft: number;
  submitted: number;
  approved: number;
  pending: number;
  posted: number;
  paid: number;
};

type ProjectOpt = { id: string; projectName: string };
type ContractOpt = { id: string; contractName: string; contractNumber: string };

type Props = {
  theme: string;
  language: string;
  dir: string;
  activeTab: 'invoice' | 'ipc' | 'service_ipc';
  cardCls: string;
  labelCls: string;
  selectCls: string;
  sectionTitleCls: string;
  canCreate: boolean;
  loading: boolean;
  filterProjectId: string;
  filterContractId: string;
  purchaseStatusFilter: CostsPurchaseStatusFilter;
  searchTerm: string;
  projects: ProjectOpt[];
  contracts: ContractOpt[];
  purchaseStatusCounts: CostsPurchaseStatusCounts;
  list: CostsSidebarPurchaseRow[];
  selectedPurchaseId: string | null;
  statusLabel: (tx: CostsSidebarPurchaseRow) => string;
  paymentTypeOf: (tx: CostsSidebarPurchaseRow) => 'cash' | 'credit' | null;
  t: (key: string) => string;
  onFilterProject: (id: string) => void;
  onFilterContract: (id: string) => void;
  onStatusFilter: (value: CostsPurchaseStatusFilter) => void;
  onSearch: (value: string) => void;
  onSelect: (tx: CostsSidebarPurchaseRow) => void;
  onNew: () => void;
};

function CostsPurchaseSidebarInner({
  theme,
  language,
  dir,
  activeTab,
  cardCls,
  labelCls,
  selectCls,
  sectionTitleCls,
  canCreate,
  loading,
  filterProjectId,
  filterContractId,
  purchaseStatusFilter,
  searchTerm,
  projects,
  contracts,
  purchaseStatusCounts,
  list,
  selectedPurchaseId,
  statusLabel,
  paymentTypeOf,
  t,
  onFilterProject,
  onFilterContract,
  onStatusFilter,
  onSearch,
  onSelect,
  onNew,
}: Props) {
  const isAr = language === 'ar';
  return (
    <aside className={cn(cardCls, 'w-full md:flex-[2] md:min-w-[17rem] md:max-w-[24rem] shrink-0 space-y-4 md:sticky md:top-4 order-1 md:order-none')}>
      <div>
        <h3 className="font-bold text-sm">{t('costs_filter_title')}</h3>
      </div>

      {canCreate && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onNew}
            className={cn(
              'flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-bold text-white transition-colors',
              'bg-blue-600 hover:bg-blue-500',
            )}
          >
            <Plus size={16} />
            {activeTab === 'invoice' ? t('costs_new_invoice') : activeTab === 'service_ipc' ? t('costs_new_service_ipc') : t('costs_new_ipc')}
          </button>
          {activeTab === 'invoice' && (
            <ManualHelpButton topicId="costs.invoice.purchase" size={16} />
          )}
          {activeTab === 'ipc' && (
            <ManualHelpButton topicId="costs.ipc.subcontractor" size={16} />
          )}
          {activeTab === 'service_ipc' && (
            <ManualHelpButton topicId="costs.ipc.service" size={16} />
          )}
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className={labelCls}>{t('project')}</label>
          <select className={selectCls} value={filterProjectId} onChange={(e) => onFilterProject(e.target.value)}>
            <option value="">{isAr ? '— كل المشاريع —' : '— All projects —'}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.projectName}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>{t('contract')}</label>
          <select className={selectCls} value={filterContractId} onChange={(e) => onFilterContract(e.target.value)}>
            <option value="">{isAr ? '— كل العقود —' : '— All contracts —'}</option>
            {contracts.map((c) => (
              <option key={c.id} value={c.id}>{c.contractName} ({c.contractNumber})</option>
            ))}
          </select>
        </div>
      </div>

      <div className={cn('pt-3 border-t space-y-2', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
        <label className={labelCls}>{isAr ? 'تصفية حسب الحالة' : 'Filter by status'}</label>
        <select
          className={selectCls}
          value={purchaseStatusFilter}
          onChange={(e) => onStatusFilter(e.target.value as CostsPurchaseStatusFilter)}
        >
          <option value="all">{isAr ? `الكل (${purchaseStatusCounts.all})` : `All (${purchaseStatusCounts.all})`}</option>
          {activeTab === 'ipc' || activeTab === 'service_ipc' ? (
            <>
              <option value="draft">{isAr ? 'مسودة' : 'Draft'} ({purchaseStatusCounts.draft})</option>
              <option value="submitted">{isAr ? 'بانتظار الاعتماد' : 'Awaiting approval'} ({purchaseStatusCounts.submitted})</option>
              <option value="approved">{isAr ? 'معتمد' : 'Approved'} ({purchaseStatusCounts.approved})</option>
            </>
          ) : (
            <>
              <option value="pending">{isAr ? 'معلق' : 'Pending'} ({purchaseStatusCounts.pending})</option>
              <option value="posted">{isAr ? 'مرحّلة' : 'Posted'} ({purchaseStatusCounts.posted})</option>
              <option value="paid">{isAr ? 'تم السداد' : 'Paid'} ({purchaseStatusCounts.paid})</option>
            </>
          )}
        </select>
      </div>

      <div className={cn('pt-3 border-t space-y-2', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
        <label className={labelCls}>{isAr ? 'بحث' : 'Search'}</label>
        <div className="relative">
          <Search className={cn('absolute top-1/2 -translate-y-1/2 text-gray-500', dir === 'rtl' ? 'right-3' : 'left-3')} size={16} />
          <input
            type="text"
            placeholder={isAr ? 'بحث...' : 'Search...'}
            className={cn(
              'w-full border rounded-lg py-2 text-sm outline-none focus:border-blue-500',
              dir === 'rtl' ? 'pr-9 pl-4' : 'pl-9 pr-4',
              theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200',
            )}
            value={searchTerm}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
      </div>

      <div className={cn('pt-3 border-t space-y-2', theme === 'dark' ? 'border-gray-800' : 'border-gray-200')}>
        <p className={sectionTitleCls}>{t('costs_filter_list')}</p>
        {loading ? (
          <Loader2 className="animate-spin mx-auto" size={18} />
        ) : list.length === 0 ? (
          <p className="text-xs text-gray-500">{t('costs_filter_empty')}</p>
        ) : (
          <ul className="space-y-1 max-h-52 overflow-auto">
            {list.map((tx, txIdx) => {
              const active = selectedPurchaseId === tx.id;
              const paymentType = paymentTypeOf(tx);
              return (
                <li key={tx.id || `tx-${tx.referenceNumber}-${txIdx}`}>
                  <button
                    type="button"
                    onClick={() => onSelect(tx)}
                    className={cn(
                      'w-full text-start px-2.5 py-1 rounded-lg text-sm border transition-colors',
                      active
                        ? 'bg-blue-600 text-white border-blue-600'
                        : theme === 'dark'
                          ? 'text-gray-300 border-gray-800 hover:bg-gray-800'
                          : 'text-gray-700 border-gray-200 hover:bg-gray-50',
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0 min-h-[1.25rem] leading-tight">
                      {activeTab === 'service_ipc' ? (
                        <>
                          <span className="font-bold shrink-0 truncate max-w-[9rem]">{tx.supplierName || '—'}</span>
                          <span className="text-xs opacity-80 shrink-0">{tx.referenceNumber || '—'}</span>
                        </>
                      ) : (
                        <>
                          <span className="font-bold shrink-0">{tx.referenceNumber || tx.id.slice(0, 8)}</span>
                          <span className="text-[10px] opacity-75 shrink-0 truncate max-w-[8rem]">{tx.supplierName}</span>
                        </>
                      )}
                      <span className="text-xs opacity-80 shrink-0">{tx.date}</span>
                      <span className="text-[10px] opacity-75 shrink-0">{statusLabel(tx)}</span>
                      {paymentType && (
                        <span className="text-[10px] opacity-75 shrink-0">
                          {paymentType === 'cash' ? t('invoice_payment_cash') : t('invoice_payment_credit')}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

export const CostsPurchaseSidebar = memo(CostsPurchaseSidebarInner);
