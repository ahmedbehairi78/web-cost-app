import React, { useRef, useEffect, useCallback } from 'react';
import { X, Minus, Maximize2, Minimize2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { useLanguage } from '../context/LanguageContext';
import { MODULE_LABELS } from '../constants/modules';
import { Dashboard } from './Dashboard';
import { GeneralLedger } from './GeneralLedger';
import { Projects } from './Projects';
import { BOQ } from './BOQ';
import { Billing } from './Billing';
import { ActualCosts } from './ActualCosts';
import { Reports } from './Reports';
import { Settings } from './Settings';
import { LiquidityReport } from './LiquidityReport';

export interface AppWindow {
  id: string;
  moduleId: string;
  windowState: 'normal' | 'minimized' | 'maximized';
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
}

const MODULE_COMPONENTS: Record<string, React.ComponentType> = {
  dashboard: Dashboard,
  ledger: GeneralLedger,
  projects: Projects,
  boq: BOQ,
  billing: Billing,
  costs: ActualCosts,
  liquidity: LiquidityReport,
  reports: Reports,
  settings: Settings,
};


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

  // Theme-aware colours
  const titleBarCls = theme === 'dark'
    ? 'bg-[#1c1d22] border-gray-700/60'
    : theme === 'soft'
      ? 'bg-[#e4e9ec] border-[#cfd8dc]'
      : 'bg-gray-100 border-gray-200';

  const windowCls = theme === 'dark'
    ? 'bg-[#0d0e11] border-gray-700/60 shadow-2xl shadow-black/60'
    : theme === 'soft'
      ? 'bg-white border-[#cfd8dc] shadow-xl shadow-black/10'
      : 'bg-white border-gray-200 shadow-xl shadow-black/10';

  const titleTextCls = theme === 'dark' ? 'text-gray-200' : 'text-gray-700';

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
        {ModuleComponent && <ModuleComponent />}
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

  const minimized = windows.filter(w => w.windowState === 'minimized');
  const visible   = windows.filter(w => w.windowState !== 'minimized');

  const taskbarCls = theme === 'dark'
    ? 'bg-[#151619] border-gray-800'
    : theme === 'soft'
      ? 'bg-white border-[#cfd8dc]'
      : 'bg-gray-50 border-gray-200';

  const taskBtnCls = theme === 'dark'
    ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
    : theme === 'soft'
      ? 'bg-[#eceff1] text-[#546e7a] hover:bg-[#cfd8dc]'
      : 'bg-gray-200 text-gray-700 hover:bg-gray-300';

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* ── Desktop area ──────────────────────────────────────────── */}
      <div className="relative flex-1 overflow-hidden">
        {windows.length === 0 && (
          <div className={cn('absolute inset-0 flex flex-col items-center justify-center gap-3',
            theme === 'dark' ? 'text-gray-600' : 'text-gray-400')}>
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
