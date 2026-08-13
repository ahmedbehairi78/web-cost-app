import { describe, expect, it } from 'vitest';
import { guideTranslations } from '../context/LanguageContext';
import { ALL_PERMISSIONS, DEFAULT_PERMISSIONS } from '../types';
import { buildPermissionsForRole, crudOn } from './permissions';
import {
  MANUAL_TOPICS,
  collectManualTopicTranslationKeys,
  getManualTopic,
  isManualTopicAllowed,
  resolveManualTopics,
  type ManualTopicId,
} from './operationsManual';

const MANUAL_UI_KEYS = [
  'manual_title',
  'manual_subtitle',
  'manual_search_placeholder',
  'manual_filter_all',
  'manual_no_results',
  'manual_help_aria',
  'manual_open_full',
  'manual_before_you_start',
  'manual_steps',
  'manual_common_mistakes',
  'manual_open_module',
] as const;

describe('operationsManual registry', () => {
  it('has unique topic ids and non-empty steps', () => {
    const ids = MANUAL_TOPICS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(60);
    for (const topic of MANUAL_TOPICS) {
      expect(topic.steps.length).toBeGreaterThan(0);
      expect(topic.labelKey.startsWith('manual_')).toBe(true);
    }
  });

  it('getManualTopic resolves every registered id', () => {
    for (const topic of MANUAL_TOPICS) {
      expect(getManualTopic(topic.id as ManualTopicId)?.id).toBe(topic.id);
    }
  });

  it('every topic has ar/en translations for all content keys', () => {
    const missing: string[] = [];
    for (const topic of MANUAL_TOPICS) {
      for (const key of collectManualTopicTranslationKeys(topic)) {
        if (!guideTranslations.ar[key]?.trim()) missing.push(`ar:${key}`);
        if (!guideTranslations.en[key]?.trim()) missing.push(`en:${key}`);
      }
    }
    for (const key of MANUAL_UI_KEYS) {
      if (!guideTranslations.ar[key]?.trim()) missing.push(`ar:${key}`);
      if (!guideTranslations.en[key]?.trim()) missing.push(`en:${key}`);
    }
    expect(missing, missing.slice(0, 20).join('\n')).toEqual([]);
  });
});

describe('operationsManual permissions', () => {
  it('shell utilities (display, calculator) visible without module flags', () => {
    expect(
      isManualTopicAllowed(getManualTopic('settings.display.preferences')!, DEFAULT_PERMISSIONS),
    ).toBe(true);
    expect(isManualTopicAllowed(getManualTopic('tools.calculator.use')!, DEFAULT_PERMISSIONS)).toBe(
      true,
    );
  });

  it('settings COA topic requires ledger.view and settings access', () => {
    const coa = getManualTopic('settings.coa.tree')!;
    const settingsOnly = { ...DEFAULT_PERMISSIONS, settings: true };
    const ledgerOnly = { ...DEFAULT_PERMISSIONS, ledger: crudOn() };
    expect(isManualTopicAllowed(coa, settingsOnly)).toBe(false);
    expect(isManualTopicAllowed(coa, ledgerOnly)).toBe(false);
    expect(
      isManualTopicAllowed(coa, { ...DEFAULT_PERMISSIONS, settings: true, ledger: crudOn() }),
    ).toBe(true);
  });

  it('print settings topic requires settings permission', () => {
    const print = getManualTopic('settings.print.company')!;
    expect(isManualTopicAllowed(print, DEFAULT_PERMISSIONS)).toBe(false);
    expect(isManualTopicAllowed(print, { ...DEFAULT_PERMISSIONS, settings: true })).toBe(true);
  });

  it('project_accountant sees costs/inventory topics but not settings database', () => {
    const pa = buildPermissionsForRole('project_accountant');
    const visible = resolveManualTopics({ permissions: pa, isAdmin: false });
    const ids = new Set(visible.map((t) => t.id));
    expect(ids.has('costs.invoice.purchase')).toBe(true);
    expect(ids.has('inventory.consumption.issue')).toBe(true);
    expect(ids.has('settings.database.backup')).toBe(false);
  });

  it('full permissions resolve full topic list', () => {
    expect(resolveManualTopics({ permissions: ALL_PERMISSIONS }).length).toBe(
      MANUAL_TOPICS.length,
    );
  });

  it('projects_manager sees technical billing and payroll view topics but not settings', () => {
    const pm = buildPermissionsForRole('projects_manager');
    const ids = new Set(resolveManualTopics({ permissions: pm }).map((t) => t.id));
    expect(ids.has('technical.billing.interim')).toBe(true);
    expect(ids.has('payroll.run.accrue')).toBe(true);
    expect(ids.has('settings.database.backup')).toBe(false);
  });
});
