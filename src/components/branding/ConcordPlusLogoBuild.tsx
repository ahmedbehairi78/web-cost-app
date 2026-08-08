import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '../../lib/utils';
import {
  CONCORD_BRAND,
  CONCORD_FONT,
  CONCORD_ICON,
  CONCORD_LOGO_VIEWBOX,
  CONCORD_NAVY,
  CONCORD_ORANGE,
  CONCORD_TAGLINE_FONT_SIZE,
  CONCORD_TAGLINE_PARTS,
  CONCORD_TAGLINE_Y,
  concordFullLogoViewBox,
} from '../../lib/concordPlusBrand';

const EASE = [0.22, 1, 0.36, 1] as const;
const BUILD_MS = 1650;

/** Stagger delays — each tagline word arrives in order after Plus. */
const TAGLINE_DELAYS: Record<string, number> = {
  'word-MEP': 1.05,
  'sep-66': 1.2,
  'word-Finishing': 1.28,
  'sep-148': 1.45,
  'word-Infra': 1.52,
};

export interface ConcordPlusLogoBuildProps {
  className?: string;
  showTagline?: boolean;
  /** Gentle pulse after build completes */
  pulsing?: boolean;
  /** Show completed logo immediately (post sign-in splash) */
  skipBuild?: boolean;
}

/**
 * Concord Plus wordmark — icons assemble, wordmark stays visible throughout.
 * Uses width-based sizing + LTR so RTL login layout does not clip "Concord".
 */
export function ConcordPlusLogoBuild({
  className,
  showTagline = true,
  pulsing = false,
  skipBuild = false,
}: ConcordPlusLogoBuildProps) {
  const reduceMotion = useReducedMotion();
  const [buildDone, setBuildDone] = useState(skipBuild || !!reduceMotion);

  const height = showTagline ? CONCORD_LOGO_VIEWBOX.full.h : CONCORD_LOGO_VIEWBOX.full.hNoTagline;
  const width = CONCORD_LOGO_VIEWBOX.full.w;
  const wordmarkOx = CONCORD_LOGO_VIEWBOX.full.wordmarkOffsetX;

  useEffect(() => {
    if (reduceMotion || skipBuild) {
      setBuildDone(true);
      return;
    }
    setBuildDone(false);
    const t = window.setTimeout(() => setBuildDone(true), BUILD_MS);
    return () => window.clearTimeout(t);
  }, [reduceMotion, skipBuild, showTagline]);

  const showStaticImg = reduceMotion || skipBuild || buildDone;

  if (showStaticImg) {
    return (
      <div
        dir="ltr"
        className={cn(
          'relative flex w-full max-w-[220px] justify-center mx-auto',
          pulsing && 'login-logo-breathe',
          className,
        )}
      >
        <img
          src={CONCORD_BRAND.logoFull}
          alt="Concord Plus — MEP, Finishing, Infra"
          className="block w-full h-auto select-none"
          draggable={false}
          width={width}
          height={height}
        />
      </div>
    );
  }

  return (
    <div
      dir="ltr"
      className={cn(
        'relative w-full max-w-[220px] mx-auto',
        pulsing && buildDone && 'login-logo-breathe',
        className,
      )}
    >
      <svg
        viewBox={concordFullLogoViewBox(showTagline)}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="block w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Concord Plus — MEP, Finishing, Infra"
      >
        {/* Wordmark centered above full-width tagline */}
        <g transform={`translate(${wordmarkOx}, 0)`}>
          <text
            x="0"
            y="30"
            fontFamily={CONCORD_FONT}
            fontSize="30"
            fontWeight="700"
            letterSpacing="-0.02em"
            fill={CONCORD_NAVY}
          >
            Concord
          </text>

          <g transform="translate(0, 38)">
            <motion.g
              initial={{ opacity: 0, scale: 0.35 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.32, delay: 0.2, ease: EASE }}
              style={{ transformOrigin: '8px 12px', transformBox: 'fill-box' }}
            >
              <path d={CONCORD_ICON.lightning} fill={CONCORD_NAVY} />
            </motion.g>

            <motion.g
              transform="translate(20, 1.5)"
              initial={{ opacity: 0, scaleY: 0 }}
              animate={{ opacity: 1, scaleY: 1 }}
              transition={{ duration: 0.34, delay: 0.45, ease: EASE }}
              style={{ transformOrigin: '9px 19px', transformBox: 'fill-box' }}
            >
              <path d={CONCORD_ICON.finishing} fill={CONCORD_NAVY} />
            </motion.g>

            <g transform="translate(42, 0)">
              <motion.rect
                x={CONCORD_ICON.infraFrame.x}
                y={CONCORD_ICON.infraFrame.y}
                width={CONCORD_ICON.infraFrame.w}
                height={CONCORD_ICON.infraFrame.h}
                rx={CONCORD_ICON.infraFrame.rx}
                fill="none"
                stroke={CONCORD_NAVY}
                strokeWidth="1.9"
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.28, delay: 0.62, ease: EASE }}
                style={{ transformOrigin: '9.5px 10.5px', transformBox: 'fill-box' }}
              />
              <motion.g
                initial={{ opacity: 0, scaleY: 0 }}
                animate={{ opacity: 1, scaleY: 1 }}
                transition={{ duration: 0.32, delay: 0.78, ease: EASE }}
                style={{ transformOrigin: '9.5px 17px', transformBox: 'fill-box' }}
              >
                <path d={CONCORD_ICON.infraTower} fill={CONCORD_NAVY} />
                {CONCORD_ICON.infraWindows.map((w) => (
                  <rect
                    key={`${w.x}-${w.y}`}
                    x={w.x}
                    y={w.y}
                    width={w.w}
                    height={w.h}
                    fill="#fff"
                    opacity={0.92}
                  />
                ))}
              </motion.g>
            </g>
          </g>

          <motion.g
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.32, delay: 0.95, ease: EASE }}
          >
            <text
              x="70"
              y="58"
              fontFamily={CONCORD_FONT}
              fontSize="30"
              fontWeight="700"
              letterSpacing="-0.02em"
              fill={CONCORD_ORANGE}
            >
              Plus
            </text>
          </motion.g>
        </g>

        {showTagline && (
          <g>
            {CONCORD_TAGLINE_PARTS.map((part) => {
              const key = `${part.kind}-${part.x}`;
              const delay = TAGLINE_DELAYS[key] ?? 1.1;
              return (
                <motion.g
                  key={key}
                  initial={{ opacity: 0, x: part.kind === 'word' ? -6 : 0 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.28, delay, ease: EASE }}
                >
                  <text
                    x={part.x}
                    y={CONCORD_TAGLINE_Y}
                    fontFamily={CONCORD_FONT}
                    fontSize={CONCORD_TAGLINE_FONT_SIZE}
                    fontWeight={part.kind === 'word' ? '600' : '400'}
                    letterSpacing={part.kind === 'word' ? '0.1em' : undefined}
                    fill={CONCORD_NAVY}
                  >
                    {part.text}
                  </text>
                </motion.g>
              );
            })}
          </g>
        )}
      </svg>
    </div>
  );
}
