import React from 'react';
import { cn } from '../lib/utils';
import { CONCORD_FONT, CONCORD_NAVY, CONCORD_ORANGE } from '../lib/concordPlusBrand';
import { ConcordPlusIconGroup } from './branding/ConcordPlusIconRow';

export interface AppIconProps {
  className?: string;
}

/** Square Concord Plus mark — shell, login fallback, Electron PNG source. */
export function AppIcon({ className }: AppIconProps) {
  return (
    <svg
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('block shrink-0', className)}
      aria-hidden="true"
      focusable="false"
    >
      <rect width="512" height="512" rx="96" fill="#FFFFFF" />
      <rect
        x="20"
        y="20"
        width="472"
        height="472"
        rx="84"
        fill="none"
        stroke={CONCORD_NAVY}
        strokeWidth="6"
        opacity="0.15"
      />
      <text
        x="256"
        y="148"
        textAnchor="middle"
        fontFamily={CONCORD_FONT}
        fontSize="64"
        fontWeight="700"
        fill={CONCORD_NAVY}
      >
        Concord
      </text>
      <g transform="translate(138, 224) scale(2.8)">
        <ConcordPlusIconGroup />
      </g>
      <text
        x="256"
        y="400"
        textAnchor="middle"
        fontFamily={CONCORD_FONT}
        fontSize="80"
        fontWeight="700"
        fill={CONCORD_ORANGE}
      >
        Plus
      </text>
    </svg>
  );
}
