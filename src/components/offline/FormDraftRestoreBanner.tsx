import { useLanguage } from '../../context/LanguageContext';

interface FormDraftRestoreBannerProps {
  show: boolean;
  updatedAt?: string;
  onRestore: () => void;
  onDiscard: () => void;
}

/** Compact banner when a local form draft is available. */
export function FormDraftRestoreBanner({
  show,
  updatedAt,
  onRestore,
  onDiscard,
}: FormDraftRestoreBannerProps) {
  const { t } = useLanguage();
  if (!show) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-xs text-blue-950 dark:border-blue-700 dark:bg-blue-950/50 dark:text-blue-50">
      <span className="flex-1">
        {t('offline_draft_found')}
        {updatedAt ? ` (${updatedAt.slice(0, 16).replace('T', ' ')})` : ''}
      </span>
      <button
        type="button"
        className="rounded bg-blue-600 px-2 py-1 text-white hover:bg-blue-700"
        onClick={onRestore}
      >
        {t('offline_draft_restore')}
      </button>
      <button
        type="button"
        className="rounded border border-blue-400 px-2 py-1 hover:bg-blue-100 dark:hover:bg-blue-900"
        onClick={onDiscard}
      >
        {t('offline_draft_discard')}
      </button>
    </div>
  );
}
