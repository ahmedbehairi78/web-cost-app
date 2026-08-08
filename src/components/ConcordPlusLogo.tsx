import React from 'react';
import { cn } from '../lib/utils';
import {
  CONCORD_BRAND,
  CONCORD_FONT,
  CONCORD_LOGO_VIEWBOX,
  CONCORD_NAVY,
  CONCORD_ORANGE,
  concordFullLogoViewBox,
} from '../lib/concordPlusBrand';
import { ConcordPlusIconGroup } from './branding/ConcordPlusIconRow';
import { ConcordPlusTaglineStatic } from './branding/ConcordPlusTagline';

export type ConcordPlusLogoVariant = 'full' | 'compact';
/** 'dark' = original Navy/Orange; 'light' = White/Orange for dark backgrounds */
export type ConcordPlusLogoScheme = 'dark' | 'light';

export interface ConcordPlusLogoProps {
  className?: string;
  variant?: ConcordPlusLogoVariant;
  showTagline?: boolean;
  title?: string;
  /** Color scheme — 'light' renders white wordmark for dark navbars */
  scheme?: ConcordPlusLogoScheme;
}

export function ConcordPlusLogo({
  className,
  variant = 'full',
  showTagline = true,
  title = 'Concord Plus — MEP, Finishing, Infra',
  scheme = 'dark',
}: ConcordPlusLogoProps) {
  const textColor   = scheme === 'light' ? '#FFFFFF' : CONCORD_NAVY;
  const iconColor   = scheme === 'light' ? '#FFFFFF' : CONCORD_NAVY;
  const accentColor = CONCORD_ORANGE; // always orange

  if (variant === 'compact') {
    if (scheme === 'light') {
      // Inline SVG so we can control colors on dark backgrounds
      const { w, h } = CONCORD_LOGO_VIEWBOX.compact;
      return (
        <svg
          viewBox={`0 0 ${w} ${h}`}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={cn('block shrink-0', className)}
          role="img"
          aria-label={title}
        >
          {/* Icon strip — scaled to fit compact width */}
          <g transform="translate(0, 0) scale(0.92)">
            <ConcordPlusIconGroup fill={iconColor} />
          </g>
          {/* "Concord" */}
          <text
            x="0"
            y="44"
            fontFamily={CONCORD_FONT}
            fontSize="18"
            fontWeight="700"
            letterSpacing="-0.02em"
            fill={textColor}
          >
            Concord
          </text>
          {/* "Plus" */}
          <text
            x="82"
            y="44"
            fontFamily={CONCORD_FONT}
            fontSize="18"
            fontWeight="700"
            letterSpacing="-0.02em"
            fill={accentColor}
          >
            +
          </text>
        </svg>
      );
    }

    // Default: load pre-built SVG file
    return (
      <img
        src={CONCORD_BRAND.logoCompact}
        alt={title}
        className={cn('block shrink-0 h-auto w-auto max-h-full object-contain object-left', className)}
        draggable={false}
      />
    );
  }

  const wordmarkOx = CONCORD_LOGO_VIEWBOX.full.wordmarkOffsetX;

  return (
    <svg
      viewBox={concordFullLogoViewBox(showTagline)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('block shrink-0', className)}
      role="img"
      aria-label={title}
    >
      <g transform={`translate(${wordmarkOx}, 0)`}>
        <text
          x="0"
          y="30"
          fontFamily={CONCORD_FONT}
          fontSize="30"
          fontWeight="700"
          letterSpacing="-0.02em"
          fill={textColor}
        >
          Concord
        </text>

        <g transform="translate(0, 38)">
          <ConcordPlusIconGroup fill={iconColor} />
        </g>

        <text
          x="70"
          y="58"
          fontFamily={CONCORD_FONT}
          fontSize="30"
          fontWeight="700"
          letterSpacing="-0.02em"
          fill={accentColor}
        >
          Plus
        </text>
      </g>

      {showTagline && <ConcordPlusTaglineStatic />}
    </svg>
  );
}
