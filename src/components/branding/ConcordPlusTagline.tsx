import {
  CONCORD_FONT,
  CONCORD_NAVY,
  CONCORD_TAGLINE_FONT_SIZE,
  CONCORD_TAGLINE_PARTS,
  CONCORD_TAGLINE_Y,
} from '../../lib/concordPlusBrand';

/** Static tagline row — three words with bullet separators. */
export function ConcordPlusTaglineStatic() {
  return (
    <g>
      {CONCORD_TAGLINE_PARTS.map((part) => (
        <text
          key={`${part.kind}-${part.x}`}
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
      ))}
    </g>
  );
}
