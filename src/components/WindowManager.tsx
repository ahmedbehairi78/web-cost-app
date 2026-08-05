import React, { useRef, useEffect, useCallback, Suspense, useState, Component } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { lazyWithRetry } from '../lib/lazyImport';
import { CalcProvider, CalcTitleBarExtras } from './Calculator';
import { X, Minus, Maximize2, Minimize2, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import { shellTheme, shellInteractiveFocus, ERP_GRADIENT_BG } from '../lib/shellTheme';
import { isErpTheme } from '../lib/erpBrand';
import { useLanguage } from '../context/LanguageContext';
import { MODULE_LABELS } from '../constants/modules';
import { db } from '../firebase';
import { isLocalBackend } from '../lib/dataBackend';
import { resolveHeaderLogo } from '../lib/concordPlusBrand';
import { settingsApi } from '../services/local/modulesApi';
import { shouldCoexistShellModule } from '../lib/shellWindowPolicy';
import {
  playTap,
  playWindowClose,
  playWindowMinimize,
  playWindowRestore,
} from '../lib/uiSound';

const DashboardLazy = lazyWithRetry(() => import('./Dashboard').then(m => ({ default: m.Dashboard })));
const GeneralLedgerLazy = lazyWithRetry(() => import('./GeneralLedger').then(m => ({ default: m.GeneralLedger })));
const TechnicalOfficeLazy = lazyWithRetry(() => import('./TechnicalOffice').then(m => ({ default: m.TechnicalOffice })));
const BanksLazy = lazyWithRetry(() => import('./Banks').then(m => ({ default: m.Banks })));
const ActualCostsLazy = lazyWithRetry(() => import('./ActualCosts').then(m => ({ default: m.ActualCosts })));
const OverheadAllocationLazy = lazyWithRetry(() => import('./OverheadAllocation').then(m => ({ default: m.OverheadAllocation })));
const ReportsLazy = lazyWithRetry(() => import('./Reports').then(m => ({ default: m.Reports })));
const GeneralSettingsLazy = lazyWithRetry(() => import('./GeneralSettings').then(m => ({ default: m.GeneralSettings })));
const SettingsLazy = lazyWithRetry(() => import('./Settings').then(m => ({ default: m.Settings })));
const InventoryLazy = lazyWithRetry(() => import('./Inventory'));
const CalculatorLazy = lazyWithRetry(() => import('./Calculator').then(m => ({ default: m.Calculator })));
const FixedAssetsLazy = lazyWithRetry(() => import('./FixedAssets').then(m => ({ default: m.FixedAssets })));
const PayrollLazy = lazyWithRetry(() => import('./Payroll').then(m => ({ default: m.Payroll })));
const PurchaseRequestsLazy = lazyWithRetry(() =>
  import('./PurchaseRequests').then((m) => ({ default: m.PurchaseRequests })),
);
const OperationsManualLazy = lazyWithRetry(() => import('./OperationsManual').then(m => ({ default: m.OperationsManual })));

const MODULE_COMPONENTS: Record<string, React.LazyExoticComponent<React.ComponentType>> = {
  dashboard: DashboardLazy,
  ledger: GeneralLedgerLazy,
  technical: TechnicalOfficeLazy,
  banks: BanksLazy,
  costs: ActualCostsLazy,
  overhead: OverheadAllocationLazy,
  reports: ReportsLazy,
  general: GeneralSettingsLazy,
  display: GeneralSettingsLazy,
  settings: SettingsLazy,
  inventory: InventoryLazy,
  purchase_requests: PurchaseRequestsLazy,
  assets: FixedAssetsLazy,
  payroll: PayrollLazy,
  calculator: CalculatorLazy,
  manual: OperationsManualLazy,
};

export interface AppWindow {
  id: string;
  moduleId: string;
  windowState: 'normal' | 'minimized' | 'maximized';
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
  /** Play Odoo bounce-in when the frame first mounts (new module open). */
  enterAnim?: boolean;
  /** Changes each taskbar restore — drives erp-window-restore animation. */
  restoreToken?: number;
}

// ─── Per-window error boundary ────────────────────────────────────────────────

interface WindowErrorBoundaryProps {
  children: React.ReactNode;
  retryKey: number;
  onRetry: () => void;
  onClose: () => void;
}
interface WindowErrorBoundaryState { hasError: boolean; error: Error | null }

class WindowErrorBoundary extends Component<WindowErrorBoundaryProps, WindowErrorBoundaryState> {
  constructor(props: WindowErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error): WindowErrorBoundaryState {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error) {
    console.error('[WindowErrorBoundary]', error);
  }
  componentDidUpdate(prev: WindowErrorBoundaryProps) {
    if (prev.retryKey !== this.props.retryKey && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <WindowErrorFallback
        error={this.state.error}
        onRetry={this.props.onRetry}
        onClose={this.props.onClose}
      />
    );
  }
}

function WindowErrorFallback({
  error,
  onRetry,
  onClose,
}: { error: Error | null; onRetry: () => void; onClose: () => void }) {
  const { language } = useLanguage();
  const ar = language === 'ar';
  const isChunkError = error?.message.includes('Failed to fetch dynamically imported module')
    || error?.message.includes('Importing a module script failed');
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center select-none">
      <div className="w-14 h-14 bg-red-500/10 rounded-full flex items-center justify-center">
        <AlertTriangle className="w-7 h-7 text-red-500" />
      </div>
      <div>
        <p className="font-semibold text-gray-700 dark:text-gray-200 mb-1">
          {isChunkError
            ? (ar ? 'تحديث جديد — يلزم إعادة تحميل الصفحة' : 'App updated — reload required')
            : (ar ? 'حدث خطأ في هذه النافذة' : 'This window encountered an error')}
        </p>
        {error && (
          <p className="text-xs text-gray-400 font-mono max-w-xs break-all">
            {error.message}
          </p>
        )}
      </div>
      <div className="flex gap-2 flex-wrap justify-center">
        {isChunkError ? (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {ar ? 'إعادة تحميل التطبيق' : 'Reload App'}
          </button>
        ) : (
          <button
            type="button"
            onClick={onRetry}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {ar ? 'إعادة المحاولة' : 'Retry'}
          </button>
        )}
        <button
          onClick={onClose}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm rounded-lg transition-colors"
        >
          {ar ? 'إغلاق النافذة' : 'Close Window'}
        </button>
      </div>
    </div>
  );
}

// ─── Loading fallback ─────────────────────────────────────────────────────────

function ModuleLoadFallback() {
  const { theme, language } = useLanguage();
  const shell = shellTheme(theme);
  return (
    <div
      className={cn(
        'flex flex-1 items-center justify-center gap-3 py-12 min-h-[160px]',
        shell.wmModuleLoader,
      )}
    >
      <Loader2 className={cn('animate-spin shrink-0', isErpTheme(theme) ? 'text-[var(--erp-primary)]' : 'text-blue-500')} size={28} />
      <span className="text-sm">{language === 'ar' ? 'جاري تحميل الوحدة…' : 'Loading module…'}</span>
    </div>
  );
}

// ─── Single window frame ──────────────────────────────────────────────────────

interface WindowFrameProps {
  win: AppWindow;
  overlayPointerEvents?: boolean;
  onClose: () => void;
  onMinimize: () => void;
  onMaximizeToggle: () => void;
  onFocus: () => void;
  onUpdatePosition: (pos: { x: number; y: number }) => void;
}

// Custom comparator: skip callback equality (inline lambdas always change reference
// on parent re-render) and only bail out when window data is unchanged.
function areWindowPropsEqual(prev: WindowFrameProps, next: WindowFrameProps): boolean {
  const a = prev.win;
  const b = next.win;
  return (
    a.id          === b.id          &&
    a.moduleId    === b.moduleId    &&
    a.windowState === b.windowState &&
    a.zIndex      === b.zIndex      &&
    a.position.x  === b.position.x  &&
    a.position.y  === b.position.y  &&
    a.size.width  === b.size.width  &&
    a.size.height === b.size.height &&
    !!a.enterAnim === !!b.enterAnim &&
    a.restoreToken === b.restoreToken
  );
}

const WindowFrame = React.memo(function WindowFrame({ win, overlayPointerEvents, onClose, onMinimize, onMaximizeToggle, onFocus, onUpdatePosition }: WindowFrameProps) {
  const { language, theme } = useLanguage();
  const shell = shellTheme(theme);
  const [retryKey, setRetryKey] = useState(0);
  const [restoreFlash, setRestoreFlash] = useState(false);
  const windowRef = useRef<HTMLDivElement>(null);
  const posRef = useRef(win.position);
  const isMaximized = win.windowState === 'maximized';
  const isFloatingCalc = shouldCoexistShellModule(win.moduleId);
  const useFixedPanel = !isMaximized || isFloatingCalc;

  useEffect(() => {
    if (win.restoreToken == null || !isErpTheme(theme)) return;
    setRestoreFlash(true);
    const t = window.setTimeout(() => setRestoreFlash(false), 280);
    return () => window.clearTimeout(t);
  }, [win.restoreToken, theme]);

  // Keep ref in sync when parent updates position (e.g. after drag ends)
  useEffect(() => {
    posRef.current = win.position;
    if (windowRef.current && useFixedPanel) {
      windowRef.current.style.left = `${win.position.x}px`;
      windowRef.current.style.top  = `${win.position.y}px`;
    }
  }, [win.position, useFixedPanel]);

  const handleTitleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!useFixedPanel) return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    onFocus();

    const startX    = e.clientX;
    const startY    = e.clientY;
    const startPosX = posRef.current.x;
    const startPosY = posRef.current.y;

    const handleMouseMove = (ev: MouseEvent) => {
      const newX = Math.max(0, startPosX + ev.clientX - startX);
      const newY = Math.max(0, startPosY + ev.clientY - startY);
      posRef.current = { x: newX, y: newY };
      if (windowRef.current) {
        windowRef.current.style.left = `${newX}px`;
        windowRef.current.style.top  = `${newY}px`;
      }
    };

    const handleMouseUp = () => {
      onUpdatePosition(posRef.current);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [useFixedPanel, onFocus, onUpdatePosition]);

  const title = MODULE_LABELS[win.moduleId]?.[language] ?? win.moduleId;
  const ModuleComponent = MODULE_COMPONENTS[win.moduleId];

  const titleBarCls = shell.wmTitleBar;
  const windowCls = shell.wmWindow;
  const titleTextCls = shell.wmTitleText;

  const style: React.CSSProperties = useFixedPanel
    ? {
        position: 'absolute',
        left: win.position.x,
        top:  win.position.y,
        width:  win.size.width,
        height: win.size.height,
        zIndex: win.zIndex,
      }
    : { position: 'absolute', inset: 0, zIndex: win.zIndex };

  const frame = (
    <div
      ref={windowRef}
      style={style}
        className={cn(
        'flex flex-col border overflow-hidden shell-transition',
        overlayPointerEvents && 'pointer-events-auto',
        windowCls,
        useFixedPanel ? (isErpTheme(theme) ? 'rounded-lg' : 'rounded-xl') : 'rounded-none',
        isErpTheme(theme) && win.enterAnim && 'erp-window-enter',
        isErpTheme(theme) && restoreFlash && 'erp-window-restore',
      )}
      onMouseDown={onFocus}
    >
      {/* ── Title bar ─────────────────────────────────────────────────── */}
      {/* Force direction:ltr so controls stay on the visual right always  */}
      <div
        style={{ direction: 'ltr' }}
        className={cn(
          'flex items-center gap-2 px-3 h-10 border-b flex-shrink-0 select-none',
          titleBarCls,
          useFixedPanel && 'cursor-move',
        )}
        data-no-global-ui-sound
        onMouseDown={handleTitleMouseDown}
        onDoubleClick={() => {
          if (isFloatingCalc) return;
          playTap();
          onMaximizeToggle();
        }}
      >
        {/* Title — uses app text direction */}
        <span
          className={cn('flex-1 text-sm font-semibold truncate', titleTextCls)}
          style={{ direction: language === 'ar' ? 'rtl' : 'ltr', textAlign: language === 'ar' ? 'right' : 'left' }}
        >
          {title}
        </span>

        {/* Calculator history menu — injected for calculator windows only */}
        {win.moduleId === 'calculator' && <CalcTitleBarExtras />}

        {/* Window controls: Minimize · Maximize · Close */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              playWindowMinimize();
              onMinimize();
            }}
            title={language === 'ar' ? 'تصغير' : 'Minimize'}
            className={cn('w-5 h-5 flex items-center justify-center text-gray-400 hover:text-yellow-400 transition-colors rounded', shellInteractiveFocus)}
          >
            <Minus size={14} />
          </button>
          {!isFloatingCalc && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                playTap();
                onMaximizeToggle();
              }}
              title={language === 'ar' ? (isMaximized ? 'استعادة' : 'تكبير') : (isMaximized ? 'Restore' : 'Maximize')}
              className={cn('w-5 h-5 flex items-center justify-center text-gray-400 hover:text-green-400 transition-colors rounded', shellInteractiveFocus)}
            >
              {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              playWindowClose();
              onClose();
            }}
            title={language === 'ar' ? 'إغلاق' : 'Close'}
            className={cn('w-5 h-5 flex items-center justify-center text-gray-400 hover:text-red-400 transition-colors rounded', shellInteractiveFocus)}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* ── Module content ─────────────────────────────────────────────── */}
      <div className={cn(
        'flex-1 overflow-y-auto overflow-x-hidden min-h-0',
        isErpTheme(theme) && ERP_GRADIENT_BG,
      )}>
        {ModuleComponent && (
          <WindowErrorBoundary
            retryKey={retryKey}
            onRetry={() => setRetryKey((k) => k + 1)}
            onClose={onClose}
          >
            <Suspense fallback={<ModuleLoadFallback />}>
              <ModuleComponent />
            </Suspense>
          </WindowErrorBoundary>
        )}
      </div>
    </div>
  );

  // Wrap calculator windows in CalcProvider so both the title-bar extras
  // and the Calculator content share the same history/showHistory state.
  return win.moduleId === 'calculator'
    ? <CalcProvider>{frame}</CalcProvider>
    : frame;
}, areWindowPropsEqual);

// ─── Window manager + taskbar ─────────────────────────────────────────────────

interface WindowManagerProps {
  windows: AppWindow[];
  onClose: (id: string) => void;
  onMinimize: (id: string) => void;
  onMaximizeToggle: (id: string) => void;
  onFocus: (id: string) => void;
  onUpdatePosition: (id: string, pos: { x: number; y: number }) => void;
  onRestoreMinimized: (id: string) => void;
  layoutMode?: 'sidebar' | 'topnav';
  /** ERP utility overlay — clicks pass through to workspace except on windows/taskbar */
  overlayMode?: boolean;
}

export function WindowManager({
  windows,
  onClose,
  onMinimize,
  onMaximizeToggle,
  onFocus,
  onUpdatePosition,
  onRestoreMinimized,
  layoutMode = 'sidebar',
  overlayMode = false,
}: WindowManagerProps) {
  const { language, theme } = useLanguage();
  const shell = shellTheme(theme);
  const [desktopLogoUrl, setDesktopLogoUrl] = useState(() => resolveHeaderLogo(null));

  useEffect(() => {
    const load = async () => {
      try {
        if (isLocalBackend) {
          const res = await settingsApi.getCompanyInfo();
          setDesktopLogoUrl(resolveHeaderLogo(res.value?.headerLogo));
          return;
        }
        const settingsDoc = await getDoc(doc(db, 'settings', 'company_info'));
        if (settingsDoc.exists()) {
          const data = settingsDoc.data();
          setDesktopLogoUrl(resolveHeaderLogo(typeof data.headerLogo === 'string' ? data.headerLogo : null));
        }
      } catch {
        /* keep default brand logo */
      }
    };
    void load();
  }, []);

  const minimized = windows.filter(w => w.windowState === 'minimized');
  const visible   = windows.filter(w => w.windowState !== 'minimized');

  const taskbarCls = shell.taskbar;
  const taskBtnCls = shell.taskbarBtn;

  return (
    <div className={cn('flex flex-col flex-1 min-h-0', overlayMode && 'pointer-events-none absolute inset-0 z-20')}>
      {/* ── Desktop area ──────────────────────────────────────────── */}
      <div className={cn('relative flex-1 overflow-hidden', isErpTheme(theme) && ERP_GRADIENT_BG)}>
        {windows.length === 0 && (
          <div
            className={cn(
              'absolute inset-0 flex items-center justify-center pointer-events-none select-none',
              shell.emptyDesktop,
            )}
            aria-hidden
          >
            <img
              src={desktopLogoUrl}
              alt=""
              className={cn(
                'max-w-[min(420px,55vw)] max-h-[min(240px,38vh)] w-auto h-auto object-contain opacity-50',
                isErpTheme(theme) && 'erp-desktop-logo',
              )}
              draggable={false}
            />
          </div>
        )}

        {visible.map(win => (
          <WindowFrame
            key={win.id}
            win={win}
            overlayPointerEvents={overlayMode}
            onClose={() => onClose(win.id)}
            onMinimize={() => onMinimize(win.id)}
            onMaximizeToggle={() => onMaximizeToggle(win.id)}
            onFocus={() => onFocus(win.id)}
            onUpdatePosition={(pos) => onUpdatePosition(win.id, pos)}
          />
        ))}
      </div>

      {/* ── Taskbar (minimized windows) ────────────────────────────── */}
      {minimized.length > 0 && (
        <div
          className={cn('flex items-center gap-2 px-4 py-2 border-t flex-wrap flex-shrink-0', taskbarCls, overlayMode && 'pointer-events-auto')}
          style={{ direction: 'ltr' }}
          data-no-global-ui-sound
        >
          {minimized.map(win => {
            const title = MODULE_LABELS[win.moduleId]?.[language] ?? win.moduleId;
            return (
              <button
                key={win.id}
                type="button"
                onClick={() => {
                  playWindowRestore();
                  onRestoreMinimized(win.id);
                }}
                className={cn('flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors', taskBtnCls, shellInteractiveFocus)}
              >
                <span style={{ direction: language === 'ar' ? 'rtl' : 'ltr' }}>{title}</span>
                <X
                  size={12}
                  className="opacity-50 hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    playWindowClose();
                    onClose(win.id);
                  }}
                />
              </button>
            );
          })}

        </div>
      )}
    </div>
  );
}
