import type { AppWindow } from '../components/WindowManager';

/** Modules that may stay open alongside another shell module (floating calculator). */
export const SHELL_COEXIST_MODULE_IDS = new Set(['calculator']);

/** Fixed floating calculator panel — never maximize / never fill the shell. */
export const CALCULATOR_PANEL_SIZE = { width: 240, height: 400 } as const;
const CALCULATOR_PANEL_MARGIN = 24;

/** Legacy alias — both ids render `GeneralSettings.tsx`. */
export const GENERAL_SETTINGS_MODULE_IDS = new Set(['general', 'display']);

/** Floating utility modules in the exclusive single slot (sidebar windows + ERP overlay). */
export const SHELL_EXCLUSIVE_UTILITY_MODULE_IDS = new Set(['general', 'display', 'manual']);

export function shouldCoexistShellModule(moduleId: string): boolean {
  return SHELL_COEXIST_MODULE_IDS.has(moduleId);
}

/**
 * Position inside the WindowManager desktop (origin = top-left of main content,
 * sidebar already excluded from that container when `sidebarWidthPx` matches layout).
 */
export function calculatorPanelGeometry(
  sidebarWidthPx: number,
  viewportWidthPx: number = typeof window !== 'undefined' ? window.innerWidth : 1280,
): {
  windowState: 'normal';
  size: { width: number; height: number };
  position: { x: number; y: number };
} {
  const desktopW = Math.max(
    CALCULATOR_PANEL_SIZE.width + CALCULATOR_PANEL_MARGIN * 2,
    viewportWidthPx - sidebarWidthPx,
  );
  return {
    windowState: 'normal',
    size: { width: CALCULATOR_PANEL_SIZE.width, height: CALCULATOR_PANEL_SIZE.height },
    position: {
      x: Math.max(CALCULATOR_PANEL_MARGIN, desktopW - CALCULATOR_PANEL_SIZE.width - CALCULATOR_PANEL_MARGIN),
      y: CALCULATOR_PANEL_MARGIN,
    },
  };
}

export function normalizeShellModuleId(moduleId: string): string {
  return GENERAL_SETTINGS_MODULE_IDS.has(moduleId) ? 'general' : moduleId;
}

export function isSameShellModuleSlot(a: string, b: string): boolean {
  if (a === b) return true;
  return GENERAL_SETTINGS_MODULE_IDS.has(a) && GENERAL_SETTINGS_MODULE_IDS.has(b);
}

/** Keep calculator + the target module slot; drop everything else. */
export function retainExclusiveShellWindows(
  windows: AppWindow[],
  openingModuleId: string,
  focusedWindowId?: string,
): AppWindow[] {
  const slotId = normalizeShellModuleId(openingModuleId);
  return windows.filter(
    (w) =>
      shouldCoexistShellModule(w.moduleId)
      || isSameShellModuleSlot(w.moduleId, slotId)
      || normalizeShellModuleId(w.moduleId) === slotId
      || (focusedWindowId != null && w.id === focusedWindowId),
  );
}

/** ERP overlay utilities (general / display) — close when a workspace module opens. */
export function retainErpUtilityWindows(windows: AppWindow[]): AppWindow[] {
  return windows.filter((w) => shouldCoexistShellModule(w.moduleId));
}

export function partitionExclusiveShellWindows(
  windows: AppWindow[],
  openingModuleId: string,
  focusedWindowId?: string,
): { kept: AppWindow[]; removed: AppWindow[] } {
  const kept = retainExclusiveShellWindows(windows, openingModuleId, focusedWindowId);
  const keptIds = new Set(kept.map((w) => w.id));
  const removed = windows.filter((w) => !keptIds.has(w.id));
  return { kept, removed };
}
