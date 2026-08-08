import { describe, expect, it } from 'vitest';
import {
  isFullCircleSlice,
  prepareExplodedPieSlices,
  shadeHex,
  sortSlicesForPaint,
  topFacePath,
} from './pie3dGeometry';

describe('shadeHex', () => {
  it('darkens and lightens', () => {
    expect(shadeHex('#808080', -40)).not.toBe('#808080');
    expect(shadeHex('#3D7AB5', 20).startsWith('#')).toBe(true);
  });
});

describe('prepareExplodedPieSlices', () => {
  it('builds exploded slices with offsets and share', () => {
    const slices = prepareExplodedPieSlices(
      [
        { id: 'a', value: 50, color: '#3D7AB5', label: 'A' },
        { id: 'b', value: 25, color: '#6B7280', label: 'B' },
        { id: 'c', value: 25, color: '#94A3B8', label: 'C' },
      ],
      { explode: 16 },
    );
    expect(slices).toHaveLength(3);
    expect(slices[0].sharePct).toBe(50);
    expect(Math.abs(slices[0].ox) + Math.abs(slices[0].oy)).toBeGreaterThan(0);
    const path = topFacePath(100, 100, 80, 40, slices[0]);
    expect(path.startsWith('M ')).toBe(true);
    expect(path.endsWith('Z')).toBe(true);
  });

  it('renders a solid disk for a single 100% slice (no hollow ring)', () => {
    const slices = prepareExplodedPieSlices([
      { id: 'only', value: 1000, color: '#3D7AB5', label: 'Solo' },
    ]);
    expect(slices).toHaveLength(1);
    expect(slices[0].fullCircle).toBe(true);
    expect(slices[0].ox).toBe(0);
    expect(isFullCircleSlice(slices[0])).toBe(true);
    const top = topFacePath(190, 118, 128, 56, slices[0]);
    // Disk polygon — many rim points, no spoke-to-center fan that collapses at 360°
    expect(top.split(' L ').length).toBeGreaterThan(20);
    expect(top.includes('A ')).toBe(false);
  });
});

describe('sortSlicesForPaint', () => {
  it('orders back slices first', () => {
    const sorted = sortSlicesForPaint([
      { midAngle: 90, id: 'front' },
      { midAngle: -90, id: 'back' },
    ]);
    expect(sorted[0].id).toBe('back');
    expect(sorted[1].id).toBe('front');
  });
});
