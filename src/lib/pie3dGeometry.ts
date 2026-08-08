/**
 * Extruded / exploded elliptical pie geometry for SVG.
 * Angles in degrees: 0 = east, increasing counter-clockwise (standard math).
 * We start the first slice at -90° (12 o'clock).
 */
export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function ellipsePoint(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  angleDeg: number,
): { x: number; y: number } {
  const a = degToRad(angleDeg);
  return {
    x: cx + rx * Math.cos(a),
    y: cy + ry * Math.sin(a),
  };
}

export function shadeHex(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  if (full.length !== 6) return hex;
  const num = parseInt(full, 16);
  const clamp = (n: number) => Math.max(0, Math.min(255, n));
  const r = clamp(((num >> 16) & 255) + amount);
  const g = clamp(((num >> 8) & 255) + amount);
  const b = clamp((num & 255) + amount);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export interface Pie3dSliceInput {
  id: string;
  value: number;
  color: string;
  label: string;
}

export interface Pie3dPreparedSlice {
  id: string;
  label: string;
  color: string;
  topColor: string;
  sideColor: string;
  darkColor: string;
  startAngle: number;
  endAngle: number;
  midAngle: number;
  ox: number;
  oy: number;
  value: number;
  sharePct: number;
  fullCircle: boolean;
}

export function sweepDeg(slice: Pick<Pie3dPreparedSlice, 'startAngle' | 'endAngle'>): number {
  return slice.endAngle - slice.startAngle;
}

export function isFullCircleSlice(
  slice: Pick<Pie3dPreparedSlice, 'startAngle' | 'endAngle' | 'fullCircle'>,
): boolean {
  return slice.fullCircle || Math.abs(sweepDeg(slice)) >= 359.5;
}

export function prepareExplodedPieSlices(
  items: Pie3dSliceInput[],
  opts: { explode?: number; ryRatio?: number } = {},
): Pie3dPreparedSlice[] {
  const positive = items.filter((i) => i.value > 0);
  const total = positive.reduce((s, i) => s + i.value, 0);
  if (total <= 0) return [];

  const single = positive.length === 1;
  const explode = single ? 0 : (opts.explode ?? 18);
  const ryRatio = opts.ryRatio ?? 0.42;
  /** Small visual gap between slices (degrees), only when multiple. */
  const gap = single ? 0 : Math.min(2.5, 8 / positive.length);

  let cursor = -90;
  return positive.map((item) => {
    const rawSweep = (item.value / total) * 360;
    const sweep = Math.max(0.5, rawSweep - gap);
    const startAngle = cursor + gap / 2;
    const endAngle = startAngle + sweep;
    cursor += rawSweep;
    const midAngle = (startAngle + endAngle) / 2;
    const rad = degToRad(midAngle);
    const fullCircle = single || sweep >= 359.5;
    return {
      id: item.id,
      label: item.label,
      color: item.color,
      topColor: shadeHex(item.color, 22),
      sideColor: shadeHex(item.color, -32),
      darkColor: shadeHex(item.color, -55),
      startAngle: fullCircle ? -90 : startAngle,
      endAngle: fullCircle ? 270 : endAngle,
      midAngle: fullCircle ? 0 : midAngle,
      ox: fullCircle ? 0 : Math.cos(rad) * explode,
      oy: fullCircle ? 0 : Math.sin(rad) * explode * ryRatio,
      value: item.value,
      sharePct: Math.round((item.value / total) * 1000) / 10,
      fullCircle,
    };
  });
}

/** Closed elliptical disk (full pie top). */
export function fullEllipsePath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  steps = 64,
): string {
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = -180 + (360 * i) / steps;
    const p = ellipsePoint(cx, cy, rx, ry, a);
    pts.push(`${p.x} ${p.y}`);
  }
  return `M ${pts[0]} L ${pts.slice(1).join(' L ')} Z`;
}

/**
 * Top face — polygon approximation (reliable for large sweeps; SVG A fails at 360°).
 */
export function topFacePath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  slice: Pick<Pie3dPreparedSlice, 'startAngle' | 'endAngle' | 'ox' | 'oy' | 'fullCircle'>,
  steps = 48,
): string {
  const c = { x: cx + slice.ox, y: cy + slice.oy };
  if (isFullCircleSlice(slice)) {
    return fullEllipsePath(c.x, c.y, rx, ry, steps);
  }
  const delta = sweepDeg(slice);
  const n = Math.max(3, Math.ceil((Math.abs(delta) / 360) * steps));
  const rim: string[] = [];
  for (let i = 0; i <= n; i++) {
    const a = slice.startAngle + (delta * i) / n;
    const p = ellipsePoint(c.x, c.y, rx, ry, a);
    rim.push(`${p.x} ${p.y}`);
  }
  return `M ${c.x} ${c.y} L ${rim.join(' L ')} Z`;
}

export function radialWallPath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  depth: number,
  angle: number,
  ox: number,
  oy: number,
): string {
  const topC = { x: cx + ox, y: cy + oy };
  const botC = { x: cx + ox, y: cy + oy + depth };
  const topR = ellipsePoint(topC.x, topC.y, rx, ry, angle);
  const botR = ellipsePoint(botC.x, botC.y, rx, ry, angle);
  return `M ${topC.x} ${topC.y} L ${topR.x} ${topR.y} L ${botR.x} ${botR.y} L ${botC.x} ${botC.y} Z`;
}

export function outerWallPath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  depth: number,
  slice: Pick<Pie3dPreparedSlice, 'startAngle' | 'endAngle' | 'ox' | 'oy' | 'fullCircle'>,
  steps = 48,
): string {
  const topC = { x: cx + slice.ox, y: cy + slice.oy };
  const botC = { x: cx + slice.ox, y: cy + slice.oy + depth };
  const delta = isFullCircleSlice(slice) ? 360 : sweepDeg(slice);
  const start = isFullCircleSlice(slice) ? -180 : slice.startAngle;
  const n = Math.max(8, Math.ceil((Math.abs(delta) / 360) * steps));
  const topPts: { x: number; y: number }[] = [];
  const botPts: { x: number; y: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const a = start + (delta * i) / n;
    topPts.push(ellipsePoint(topC.x, topC.y, rx, ry, a));
    botPts.push(ellipsePoint(botC.x, botC.y, rx, ry, a));
  }
  let d = `M ${topPts[0].x} ${topPts[0].y}`;
  for (let i = 1; i < topPts.length; i++) d += ` L ${topPts[i].x} ${topPts[i].y}`;
  for (let i = botPts.length - 1; i >= 0; i--) d += ` L ${botPts[i].x} ${botPts[i].y}`;
  return `${d} Z`;
}

/** Front-facing outer wall only (better 3D; hides back rim). */
export function frontOuterWallPath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  depth: number,
  slice: Pick<Pie3dPreparedSlice, 'startAngle' | 'endAngle' | 'ox' | 'oy' | 'fullCircle'>,
  steps = 36,
): string | null {
  if (isFullCircleSlice(slice)) {
    // Front half of the cylinder: angles 0° → 180° (bottom of ellipse in screen space)
    return outerWallPath(
      cx,
      cy,
      rx,
      ry,
      depth,
      { ...slice, startAngle: 0, endAngle: 180, fullCircle: false },
      steps,
    );
  }
  const delta = sweepDeg(slice);
  const samples: number[] = [];
  const n = Math.max(4, Math.ceil((Math.abs(delta) / 360) * steps));
  for (let i = 0; i <= n; i++) {
    samples.push(slice.startAngle + (delta * i) / n);
  }
  // Keep angles whose ellipse point is on the front (lower) half: sin(a) >= -0.15
  const front = samples.filter((a) => Math.sin(degToRad(a)) >= -0.12);
  if (front.length < 2) return null;
  const sub = {
    ...slice,
    startAngle: front[0],
    endAngle: front[front.length - 1],
    fullCircle: false,
  };
  return outerWallPath(cx, cy, rx, ry, depth, sub, Math.max(front.length, 8));
}

export function sortSlicesForPaint<T extends { midAngle: number }>(slices: T[]): T[] {
  return [...slices].sort(
    (a, b) => Math.sin(degToRad(a.midAngle)) - Math.sin(degToRad(b.midAngle)),
  );
}
