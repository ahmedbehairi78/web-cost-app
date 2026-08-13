import { describe, expect, it } from 'vitest';
import {
  buildSpaUpdateNotificationItem,
  isSpaUpdateNotificationType,
  parseSpaBuildManifest,
  spaBuildNeedsUpdate,
  SPA_UPDATE_NOTIFICATION_TYPE,
} from './spaBuild';

describe('spaBuild', () => {
  it('parses a Railway spa-build manifest', () => {
    expect(parseSpaBuildManifest({ id: 'abc123', builtAt: '2026-08-13T15:00:00.000Z' })).toEqual({
      id: 'abc123',
      builtAt: '2026-08-13T15:00:00.000Z',
    });
    expect(parseSpaBuildManifest({ id: '  ' })).toBeNull();
    expect(parseSpaBuildManifest(null)).toBeNull();
  });

  it('detects a hosted build change', () => {
    expect(spaBuildNeedsUpdate('old', 'new')).toBe(true);
    expect(spaBuildNeedsUpdate('same', 'same')).toBe(false);
    expect(spaBuildNeedsUpdate('', 'new')).toBe(false);
  });

  it('builds an urgent inbox item for the notification bell', () => {
    const item = buildSpaUpdateNotificationItem(new Date('2026-08-13T15:00:00.000Z'));
    expect(item.type).toBe(SPA_UPDATE_NOTIFICATION_TYPE);
    expect(isSpaUpdateNotificationType(item.type)).toBe(true);
    expect(item.priority).toBe('urgent');
    expect(item.read).toBe(false);
    expect(item.titleAr).toContain('تحديث');
  });
});
