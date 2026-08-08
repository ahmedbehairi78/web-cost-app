import { describe, expect, it } from 'vitest';
import type { AppWindow } from '../components/WindowManager';
import {
  isSameShellModuleSlot,
  normalizeShellModuleId,
  partitionExclusiveShellWindows,
  retainErpUtilityWindows,
} from './shellWindowPolicy';

function win(moduleId: string, id = moduleId): AppWindow {
  return {
    id,
    moduleId,
    windowState: 'maximized',
    position: { x: 0, y: 0 },
    size: { width: 800, height: 600 },
    zIndex: 1,
  };
}

describe('shellWindowPolicy', () => {
  it('normalizes display to general', () => {
    expect(normalizeShellModuleId('display')).toBe('general');
    expect(isSameShellModuleSlot('general', 'display')).toBe(true);
  });

  it('keeps calculator when opening another module', () => {
    const prev = [win('ledger'), win('calculator', 'calc-1')];
    const { kept, removed } = partitionExclusiveShellWindows(prev, 'dashboard');
    expect(kept.map((w) => w.moduleId)).toEqual(['calculator']);
    expect(removed.map((w) => w.moduleId)).toEqual(['ledger']);
  });

  it('replaces general with ledger and drops display alias slot', () => {
    const prev = [win('display')];
    const { kept, removed } = partitionExclusiveShellWindows(prev, 'ledger');
    expect(kept).toHaveLength(0);
    expect(removed).toHaveLength(1);
  });

  it('retainErpUtilityWindows keeps calculator only', () => {
    const prev = [win('general'), win('calculator', 'calc-1')];
    expect(retainErpUtilityWindows(prev).map((w) => w.moduleId)).toEqual(['calculator']);
  });
});
