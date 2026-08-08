import {
  LayoutDashboard,
  HardHat,
  Receipt,
  Settings,
  BarChart3,
  BookOpen,
  Landmark,
  Package,
  Building2,
  Users,
} from 'lucide-react';

/**
 * Sidebar + top navigation module list (permission-filtered at render time).
 * Purchase requests live in the footer next to General Settings (not here).
 */
export const SHELL_NAV_ITEMS = [
  { id: 'dashboard', labelKey: 'dashboard', icon: LayoutDashboard },
  { id: 'ledger', labelKey: 'ledger', icon: BookOpen },
  { id: 'technical', labelKey: 'technical', icon: HardHat },
  { id: 'costs', labelKey: 'costs', icon: Receipt },
  { id: 'inventory', labelKey: 'inventory', icon: Package },
  { id: 'assets', labelKey: 'assets', icon: Building2 },
  { id: 'payroll', labelKey: 'payroll', icon: Users },
  { id: 'banks', labelKey: 'banks', icon: Landmark },
  { id: 'reports', labelKey: 'reports', icon: BarChart3 },
  { id: 'settings', labelKey: 'settings', icon: Settings },
] as const;
