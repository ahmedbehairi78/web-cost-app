import { CONCORD_ICON, CONCORD_NAVY } from '../../lib/concordPlusBrand';

interface IconGroupProps {
  fill?: string;
}

/** Inline SVG group — use inside a parent &lt;svg&gt; or via ConcordPlusIconRow. */
export function ConcordPlusIconGroup({ fill = CONCORD_NAVY }: IconGroupProps) {
  return (
    <g fill={fill}>
      <path d={CONCORD_ICON.lightning} />
      <g transform="translate(20, 1.5)">
        <path d={CONCORD_ICON.finishing} />
      </g>
      <g transform="translate(42, 0)">
        <rect
          x={CONCORD_ICON.infraFrame.x}
          y={CONCORD_ICON.infraFrame.y}
          width={CONCORD_ICON.infraFrame.w}
          height={CONCORD_ICON.infraFrame.h}
          rx={CONCORD_ICON.infraFrame.rx}
          fill="none"
          stroke={fill}
          strokeWidth="1.9"
        />
        <path d={CONCORD_ICON.infraTower} fill={fill} />
        {CONCORD_ICON.infraWindows.map((w) => (
          <rect key={`${w.x}-${w.y}`} x={w.x} y={w.y} width={w.w} height={w.h} fill="#fff" opacity={0.92} />
        ))}
      </g>
    </g>
  );
}

interface RowProps {
  className?: string;
  scale?: number;
  fill?: string;
}

/** Standalone icon strip with its own SVG viewport. */
export function ConcordPlusIconRow({ className, scale = 1, fill = CONCORD_NAVY }: RowProps) {
  return (
    <svg
      viewBox="0 0 68 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <g transform={`scale(${scale})`}>
        <ConcordPlusIconGroup fill={fill} />
      </g>
    </svg>
  );
}
