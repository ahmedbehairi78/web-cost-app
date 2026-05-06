/**
 * Centralized Tailwind classes for the app shell (sidebar + floating windows).
 * Keeps dark / soft / light in one place — extend here before copying hex into new UI.
 */

export type AppTheme = 'dark' | 'light' | 'soft';

export interface ShellThemePalette {
  /** Sidebar outer container */
  sidebarSurface: string;
  /** Horizontal rule under sidebar header */
  sidebarDivider: string;
  /** Muted nav rows + tertiary footer actions */
  navMuted: string;
  /** App title row in sidebar */
  brandHeading: string;
  /** Sidebar footer top border */
  footerTopBorder: string;
  logoutRow: string;
  closeAllRow: string;
  /** Window chrome */
  wmTitleBar: string;
  wmWindow: string;
  wmTitleText: string;
  wmModuleLoader: string;
  taskbar: string;
  taskbarBtn: string;
  emptyDesktop: string;
}

export function shellTheme(mode: AppTheme): ShellThemePalette {
  if (mode === 'dark') {
    return {
      sidebarSurface: 'bg-[#151619] text-white border-gray-800',
      sidebarDivider: 'border-gray-800',
      navMuted: 'text-gray-400 hover:bg-gray-800 hover:text-white',
      brandHeading: 'text-white',
      footerTopBorder: 'border-gray-800',
      logoutRow: 'text-gray-400 hover:bg-red-900/30 hover:text-red-400',
      closeAllRow: 'text-orange-400 hover:bg-orange-900/20 hover:text-orange-300',
      wmTitleBar: 'bg-[#1c1d22] border-gray-700/60',
      wmWindow: 'bg-[#0d0e11] border-gray-700/60 shadow-2xl shadow-black/60',
      wmTitleText: 'text-gray-200',
      wmModuleLoader: 'bg-[#0d0e11] text-gray-500',
      taskbar: 'bg-[#151619] border-gray-800',
      taskbarBtn: 'bg-gray-800 text-gray-300 hover:bg-gray-700',
      emptyDesktop: 'text-gray-600',
    };
  }

  if (mode === 'soft') {
    return {
      sidebarSurface: 'bg-white text-[#37474f] border-[#cfd8dc]',
      sidebarDivider: 'border-[#cfd8dc]',
      navMuted: 'text-[#546e7a] hover:bg-[#eceff1] hover:text-[#37474f]',
      brandHeading: 'text-gray-900',
      footerTopBorder: 'border-[#cfd8dc]',
      logoutRow: 'text-[#546e7a] hover:bg-red-50 hover:text-red-500',
      closeAllRow: 'text-orange-600 hover:bg-orange-50 hover:text-orange-700',
      wmTitleBar: 'bg-[#e4e9ec] border-[#cfd8dc]',
      wmWindow: 'bg-white border-[#cfd8dc] shadow-xl shadow-black/10',
      wmTitleText: 'text-gray-700',
      wmModuleLoader: 'bg-white text-[#546e7a]',
      taskbar: 'bg-white border-[#cfd8dc]',
      taskbarBtn: 'bg-[#eceff1] text-[#546e7a] hover:bg-[#cfd8dc]',
      emptyDesktop: 'text-gray-400',
    };
  }

  return {
    sidebarSurface: 'bg-white text-gray-900 border-gray-200',
    sidebarDivider: 'border-gray-200',
    navMuted: 'text-gray-500 hover:bg-gray-100 hover:text-gray-900',
    brandHeading: 'text-gray-900',
    footerTopBorder: 'border-gray-200',
    logoutRow: 'text-gray-500 hover:bg-red-50 hover:text-red-500',
    closeAllRow: 'text-orange-600 hover:bg-orange-50 hover:text-orange-700',
    wmTitleBar: 'bg-gray-100 border-gray-200',
    wmWindow: 'bg-white border-gray-200 shadow-xl shadow-black/10',
    wmTitleText: 'text-gray-700',
    wmModuleLoader: 'bg-white text-gray-500',
    taskbar: 'bg-gray-50 border-gray-200',
    taskbarBtn: 'bg-gray-200 text-gray-700 hover:bg-gray-300',
    emptyDesktop: 'text-gray-400',
  };
}

/** Use on sidebar / window chrome buttons for keyboard focus (high contrast without theme-offset hacks). */
export const shellInteractiveFocus =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500';
