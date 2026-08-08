import { useMemo, useState } from 'react';
import { cn } from '../../lib/utils';
import type { ContractProgressPieSlice } from '../../lib/dashboardMetrics';
import {
  frontOuterWallPath,
  isFullCircleSlice,
  outerWallPath,
  prepareExplodedPieSlices,
  radialWallPath,
  sortSlicesForPaint,
  topFacePath,
} from '../../lib/pie3dGeometry';

interface Props {
  slices: ContractProgressPieSlice[];
  selectedContractId: string;
  onSelectContract: (contractId: string, projectId: string) => void;
  theme: string;
  language: string;
  t: (key: string) => string;
  formatMoney: (n: number) => string;
}

const VIEW_W = 380;
const VIEW_H = 280;
const CX = 190;
const CY = 118;
const RX = 128;
const RY = 56;
const DEPTH = 36;
const EXPLODE = 20;

export function DashboardPie3D({
  slices,
  selectedContractId,
  onSelectContract,
  theme,
  language,
  t,
  formatMoney,
}: Props) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [tip, setTip] = useState<{
    x: number;
    y: number;
    slice: ContractProgressPieSlice;
  } | null>(null);

  const prepared = useMemo(() => {
    const items = slices
      .filter((s) => s.completedValue > 0)
      .map((s) => ({
        id: s.contractId,
        value: s.completedValue,
        color: s.color,
        label: s.name,
      }));
    return prepareExplodedPieSlices(items, { explode: EXPLODE, ryRatio: RY / RX });
  }, [slices]);

  const painted = useMemo(() => sortSlicesForPaint(prepared), [prepared]);

  const sliceById = useMemo(() => {
    const map = new Map(slices.map((s) => [s.contractId, s]));
    return map;
  }, [slices]);

  if (prepared.length === 0) {
    return (
      <p className="h-full flex items-center justify-center text-sm text-gray-500">
        {t('dashboard_pie_empty')}
      </p>
    );
  }

  return (
    <div className="h-full w-full flex flex-col relative">
      <div className="relative flex-1 min-h-[210px]">
        <div
          className={cn(
            'pointer-events-none absolute left-1/2 top-[76%] h-6 w-[62%] -translate-x-1/2 rounded-[100%] blur-md',
            theme === 'dark' ? 'bg-black/50' : 'bg-slate-500/30',
          )}
        />
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="w-full h-full"
          role="img"
          aria-label={t('dashboard_pie_completed_share')}
        >
          <defs>
            <linearGradient id="pie3d-top-sheen" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.28" />
              <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
            <filter id="pie3d-soft" x="-25%" y="-25%" width="150%" height="150%">
              <feDropShadow dx="0" dy="4" stdDeviation="3" floodOpacity="0.25" />
            </filter>
          </defs>

          {painted.map((slice) => {
            const selected = selectedContractId === slice.id;
            const hovered = hoverId === slice.id;
            const dimmed =
              !!selectedContractId &&
              selectedContractId !== slice.id &&
              !hovered;
            const lift = slice.fullCircle ? 1 : hovered || selected ? 1.4 : 1;
            const ox = slice.ox * lift;
            const oy = slice.oy * lift;
            const lifted = { ...slice, ox, oy };
            const opacity = dimmed ? 0.38 : 1;
            const frontWall = frontOuterWallPath(CX, CY, RX, RY, DEPTH, lifted);
            const fullWall = slice.fullCircle
              ? outerWallPath(CX, CY, RX, RY, DEPTH, lifted)
              : null;

            return (
              <g
                key={slice.id}
                opacity={opacity}
                filter="url(#pie3d-soft)"
                className="cursor-pointer"
                onMouseEnter={(e) => {
                  setHoverId(slice.id);
                  const src = sliceById.get(slice.id);
                  if (!src) return;
                  const svg = e.currentTarget.ownerSVGElement;
                  if (!svg) return;
                  const rect = svg.getBoundingClientRect();
                  setTip({
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top,
                    slice: src,
                  });
                }}
                onMouseMove={(e) => {
                  const src = sliceById.get(slice.id);
                  if (!src) return;
                  const svg = e.currentTarget.ownerSVGElement;
                  if (!svg) return;
                  const rect = svg.getBoundingClientRect();
                  setTip({
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top,
                    slice: src,
                  });
                }}
                onMouseLeave={() => {
                  setHoverId(null);
                  setTip(null);
                }}
                onClick={() => {
                  const src = sliceById.get(slice.id);
                  if (!src) return;
                  onSelectContract(
                    selectedContractId === src.contractId ? '' : src.contractId,
                    src.projectId,
                  );
                }}
              >
                {fullWall && (
                  <path
                    d={fullWall}
                    fill={slice.sideColor}
                    stroke={slice.darkColor}
                    strokeWidth={0.35}
                  />
                )}
                {!slice.fullCircle && frontWall && (
                  <path
                    d={frontWall}
                    fill={slice.sideColor}
                    stroke={slice.darkColor}
                    strokeWidth={0.35}
                  />
                )}
                {!isFullCircleSlice(slice) && (
                  <>
                    <path
                      d={radialWallPath(
                        CX,
                        CY,
                        RX,
                        RY,
                        DEPTH,
                        slice.startAngle,
                        ox,
                        oy,
                      )}
                      fill={slice.darkColor}
                      stroke={slice.darkColor}
                      strokeWidth={0.25}
                    />
                    <path
                      d={radialWallPath(
                        CX,
                        CY,
                        RX,
                        RY,
                        DEPTH,
                        slice.endAngle,
                        ox,
                        oy,
                      )}
                      fill={slice.sideColor}
                      stroke={slice.darkColor}
                      strokeWidth={0.25}
                    />
                  </>
                )}
                <path
                  d={topFacePath(CX, CY, RX, RY, lifted)}
                  fill={slice.topColor}
                  stroke={
                    theme === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.65)'
                  }
                  strokeWidth={selected || hovered ? 1.5 : 0.8}
                />
                <path
                  d={topFacePath(CX, CY, RX, RY, lifted)}
                  fill="url(#pie3d-top-sheen)"
                  style={{ pointerEvents: 'none' }}
                />
              </g>
            );
          })}
        </svg>

        {tip && (
          <div
            className={cn(
              'pointer-events-none absolute z-10 max-w-[240px] rounded-lg px-2.5 py-1.5 text-[11px] shadow-lg border',
              theme === 'dark'
                ? 'bg-gray-900 border-gray-700 text-gray-100'
                : 'bg-white border-gray-200 text-gray-800',
            )}
            style={{
              left: Math.min(Math.max(8, tip.x + 12), VIEW_W - 160),
              top: Math.max(8, tip.y - 40),
            }}
          >
            <p className="font-bold truncate">{tip.slice.name}</p>
            {tip.slice.projectName && (
              <p className="text-gray-500 truncate text-[10px]">{tip.slice.projectName}</p>
            )}
            <p className="font-mono mt-0.5">
              {formatMoney(tip.slice.completedValue)} · {tip.slice.sharePct}%{' '}
              {t('dashboard_pie_of_total')}
            </p>
            <p className="text-gray-500 mt-0.5">
              {t('dashboard_col_progress')} {tip.slice.progressPct}%
            </p>
          </div>
        )}
      </div>

      <ul
        className={cn(
          'mt-1 grid grid-cols-1 gap-1 max-h-[72px] overflow-y-auto text-[11px]',
          language === 'ar' ? 'text-right' : 'text-left',
        )}
      >
        {slices
          .filter((s) => s.completedValue > 0)
          .map((s) => {
            const active = selectedContractId === s.contractId;
            return (
              <li key={s.contractId}>
                <button
                  type="button"
                  className={cn(
                    'w-full flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors',
                    language === 'ar' ? 'flex-row-reverse' : '',
                    active
                      ? theme === 'dark'
                        ? 'bg-blue-950/50'
                        : 'bg-blue-50'
                      : theme === 'dark'
                        ? 'hover:bg-gray-900/70'
                        : 'hover:bg-gray-50',
                  )}
                  onClick={() =>
                    onSelectContract(active ? '' : s.contractId, s.projectId)
                  }
                >
                  <span
                    className="shrink-0 w-2.5 h-2.5 rounded-sm shadow-sm"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="truncate flex-1 font-medium">{s.name}</span>
                  <span className="font-mono text-gray-500 shrink-0">{s.sharePct}%</span>
                </button>
              </li>
            );
          })}
      </ul>
    </div>
  );
}
