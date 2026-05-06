import React, { useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import { X, Minus, Maximize2, Minimize2, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { shellTheme } from '../lib/shellTheme';
import { useLanguage } from '../context/LanguageContext';
import { MODULE_LABELS } from '../constants/modules';

const DashboardLazy = lazy(() => import('./Dashboard').then(m => ({ default: m.Dashboard })));
const GeneralLedgerLazy = lazy(() => import('./GeneralLedger').then(m => ({ default: m.GeneralLedger })));
const ProjectsLazy = lazy(() => import('./Projects').then(m => ({ default: m.Projects })));
const BOQLazy = lazy(() => import('./BOQ').then(m => ({ default: m.BOQ })));
const BillingLazy = lazy(() => import('./Billing').then(m => ({ default: m.Billing })));
const ActualCostsLazy = lazy(() => import('./ActualCosts').then(m => ({ default: m.ActualCosts })));
const LiquidityReportLazy = lazy(() => import('./LiquidityReport').then(m => ({ default: m.LiquidityReport })));
const ReportsLazy = lazy(() => import('./Reports').then(m => ({ default: m.Reports })));
const SettingsLazy = lazy(() => import('./Settings').then(m => ({ default: m.Settings })));

const MODULE_COMPONENTS: Record<string, React.LazyExoticComponent<React.ComponentType>> = {
  dashboard: DashboardLazy,
  ledger: GeneralLedgerLazy,
  projects: ProjectsLazy,
  boq: BOQLazy,
  billing: BillingLazy,
  costs: ActualCostsLazy,
  liquidity: LiquidityReportLazy,
  reports: ReportsLazy,
  settings: SettingsLazy,
};

export interface AppWindow {
  id: string;
  moduleId: string;
  windowState: 'normal' | 'minimized' | 'maximized';
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
}

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
      <Loader2 className="animate-spin text-blue-500 shrink-0" size={28} />
      <span className="text-sm">{language === 'ar' ? 'جاري تحميل الوحدة…' : 'Loading module…'}</span>
    </div>
  );
}

// ─── Single window frame ──────────────────────────────────────────────────────

interface WindowFrameProps {
  win: AppWindow;
  onClose: () => void;
  onMinimize: () => void;
  onMaximizeToggle: () => void;
  onFocus: () => void;
  onUpdatePosition: (pos: { x: number; y: number }) => void;
}

function WindowFrame({ win, onClose, onMinimize, onMaximizeToggle, onFocus, onUpdatePosition }: WindowFrameProps) {
  const { language, theme } = useLanguage();
  const shell = shellTheme(theme);
  const windowRef = useRef<HTMLDivElement>(null);
  const posRef = useRef(win.position);
  const isMaximized = win.windowState === 'maximized';

  // Keep ref in sync when parent updates position (e.g. after drag ends)
  useEffect(() => {
    posRef.current = win.position;
    if (windowRef.current && !isMaximized) {
      windowRef.current.style.left = `${win.position.x}px`;
      windowRef.current.style.top  = `${win.position.y}px`;
    }
  }, [win.position, isMaximized]);

  const handleTitleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isMaximized) return;
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
  }, [isMaximized, onFocus, onUpdatePosition]);

  const title = MODULE_LABELS[win.moduleId]?.[language] ?? win.moduleId;
  const ModuleComponent = MODULE_COMPONENTS[win.moduleId];

  const titleBarCls = shell.wmTitleBar;
  const windowCls = shell.wmWindow;
  const titleTextCls = shell.wmTitleText;

  const style: React.CSSProperties = isMaximized
    ? { position: 'absolute', inset: 0, zIndex: win.zIndex }
    : {
        position: 'absolute',
        left: win.position.x,
        top:  win.position.y,
        width:  win.size.width,
        height: win.size.height,
        zIndex: win.zIndex,
      };

  return (
    <div
      ref={windowRef}
      style={style}
      className={cn('flex flex-col border overflow-hidden', windowCls, isMaximized ? 'rounded-none' : 'rounded-xl')}
      onMouseDown={onFocus}
    >
      {/* ── Title bar ─────────────────────────────────────────────────── */}
      {/* Force direction:ltr so controls stay on the visual right always  */}
      <div
        style={{ direction: 'ltr' }}
        className={cn(
          'flex items-center gap-2 px-3 h-10 border-b flex-shrink-0 select-none',
          titleBarCls,
          !isMaximized && 'cursor-move',
        )}
        onMouseDown={handleTitleMouseDown}
        onDoubleClick={onMaximizeToggle}
      >
        {/* Title — uses app text direction */}
        <span
          className={cn('flex-1 text-sm font-semibold truncate', titleTextCls)}
          style={{ direction: language === 'ar' ? 'rtl' : 'ltr', textAlign: language === 'ar' ? 'right' : 'left' }}
        >
          {title}
        </span>

        {/* Window controls: Minimize · Maximize · Close */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onMinimize(); }}
            title={language === 'ar' ? 'تصغير' : 'Minimize'}
            className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-yellow-400 transition-colors rounded"
          >
            <Minus size={14} />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onMaximizeToggle(); }}
            title={language === 'ar' ? (isMaximized ? 'استعادة' : 'تكبير') : (isMaximized ? 'Restore' : 'Maximize')}
            className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-green-400 transition-colors rounded"
          >
            {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            title={language === 'ar' ? 'إغلاق' : 'Close'}
            className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-red-400 transition-colors rounded"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* ── Module content ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
        {ModuleComponent && (
          <Suspense fallback={<ModuleLoadFallback />}>
            <ModuleComponent />
          </Suspense>
        )}
      </div>
    </div>
  );
}

// ─── Window manager + taskbar ─────────────────────────────────────────────────

interface WindowManagerProps {
  windows: AppWindow[];
  onClose: (id: string) => void;
  onMinimize: (id: string) => void;
  onMaximizeToggle: (id: string) => void;
  onFocus: (id: string) => void;
  onUpdatePosition: (id: string, pos: { x: number; y: number }) => void;
  onRestoreMinimized: (id: string) => void;
}

export function WindowManager({
  windows,
  onClose,
  onMinimize,
  onMaximizeToggle,
  onFocus,
  onUpdatePosition,
  onRestoreMinimized,
}: WindowManagerProps) {
  const { language, theme } = useLanguage();
  const shell = shellTheme(theme);

  const minimized = windows.filter(w => w.windowState === 'minimized');
  const visible   = windows.filter(w => w.windowState !== 'minimized');

  const taskbarCls = shell.taskbar;
  const taskBtnCls = shell.taskbarBtn;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* ── Desktop area ──────────────────────────────────────────── */}
      <div className="relative flex-1 overflow-hidden">
        {windows.length === 0 && (
          <div className={cn('absolute inset-0 flex flex-col items-center justify-center gap-3',
            shell.emptyDesktop)}>
            <Maximize2 size={48} className="opacity-30" />
            <p className="text-base">
              {language === 'ar'
                ? 'اختر وحدة من القائمة الجانبية لفتحها'
                : 'Select a module from the sidebar to open it'}
            </p>
          </div>
        )}

        {visible.map(win => (
          <WindowFrame
            key={win.id}
            win={win}
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
          className={cn('flex items-center gap-2 px-4 py-2 border-t flex-wrap flex-shrink-0', taskbarCls)}
          style={{ direction: 'ltr' }}
        >
          {minimized.map(win => {
            const title = MODULE_LABELS[win.moduleId]?.[language] ?? win.moduleId;
            return (
              <button
                key={win.id}
                type="button"
                onClick={() => onRestoreMinimized(win.id)}
                className={cn('flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors', taskBtnCls)}
              >
                <span style={{ direction: language === 'ar' ? 'rtl' : 'ltr' }}>{title}</span>
                <X
                  size={12}
                  className="opacity-50 hover:opacity-100"
                  onClick={(e) => { e.stopPropagation(); onClose(win.id); }}
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
