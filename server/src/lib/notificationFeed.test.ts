import { describe, expect, it } from 'vitest';
import { daysUntil, sortNotificationItems, type NotificationItem } from './notificationFeed.js';

describe('daysUntil', () => {
  it('returns positive for future dates', () => {
    const future = new Date();
    future.setDate(future.getDate() + 5);
    const iso = future.toISOString().slice(0, 10);
    expect(daysUntil(iso)).toBeGreaterThanOrEqual(4);
  });

  it('returns negative for past dates', () => {
    expect(daysUntil('2020-01-01')).toBeLessThan(0);
  });
});

describe('sortNotificationItems', () => {
  const base = (priority: NotificationItem['priority'], createdAt: string): NotificationItem => ({
    key: `k-${priority}-${createdAt}`,
    type: 'test',
    priority,
    titleAr: 'ar',
    titleEn: 'en',
    moduleId: 'inventory',
    createdAt,
    read: false,
  });

  it('orders urgent before normal before low', () => {
    const sorted = sortNotificationItems([
      base('low', '2026-06-15'),
      base('urgent', '2026-06-01'),
      base('normal', '2026-06-10'),
    ]);
    expect(sorted.map((i) => i.priority)).toEqual(['urgent', 'normal', 'low']);
  });
});
