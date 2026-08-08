/**
 * Regenerates public/branding/*.svg from src/lib/concordPlusBrand.ts tokens.
 * Run: npm run branding:sync
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const brandingDir = path.join(publicDir, 'branding');

const NAVY = '#003B71';
const ORANGE = '#F58220';
const FONT = 'Segoe UI, Helvetica Neue, Arial, sans-serif';

/** SYNC: must match CONCORD_LOGO_VIEWBOX in src/lib/concordPlusBrand.ts */
const CONCORD_LOGO_VIEWBOX = {
  full: { w: 208, h: 88, hNoTagline: 62, wordmarkW: 116, wordmarkOffsetX: 46 },
  compact: { w: 104, h: 58 },
  print: { w: 212, h: 92, padX: 2, padY: 2 },
};

const ICON = {
  lightning: 'M11.2 0L4.2 12.2H8.1L6.2 22.5L15.2 11.4H11.4L14 0H11.2z',
  finishing: 'M0 11.2L3.2 8.4L6.4 10.6L9.6 7.8L12.8 10.2L16 8L18.8 10.4V19.2H0V11.2z',
  infraTower: 'M5.5 17.5V9.2L9.5 6.2L13.5 9.2V17.5H5.5z',
};

function iconRow(g, opts = {}) {
  const { scale = 1, ox = 0, oy = 0, strokeNavy = NAVY } = opts;
  const s = scale;
  return `
  <g transform="translate(${ox}, ${oy}) scale(${s})" fill="${strokeNavy}">
    <path d="${ICON.lightning}"/>
    <g transform="translate(20, 1.5)"><path d="${ICON.finishing}"/></g>
    <g transform="translate(42, 0)">
      <rect x="0" y="0" width="19" height="21" rx="2.8" fill="none" stroke="${strokeNavy}" stroke-width="1.9"/>
      <path d="${ICON.infraTower}"/>
      <rect x="7.8" y="10.5" width="1.3" height="7" fill="#ffffff" opacity="0.92"/>
      <rect x="10.9" y="10.5" width="1.3" height="7" fill="#ffffff" opacity="0.92"/>
    </g>
  </g>`;
}

/** Concord + icon row + Plus — centered when tagline is wider than wordmark. */
function wordmarkBlock(offsetX) {
  return `
  <g transform="translate(${offsetX}, 0)">
    <text x="0" y="30" font-family="${FONT}" font-size="30" font-weight="700" letter-spacing="-0.02em" fill="${NAVY}">Concord</text>
    ${iconRow('', { oy: 38 })}
    <text x="70" y="58" font-family="${FONT}" font-size="30" font-weight="700" letter-spacing="-0.02em" fill="${ORANGE}">Plus</text>
  </g>`;
}

function taglinePartsBlock() {
  const parts = [
    { kind: 'word', text: 'MEP', x: 38 },
    { kind: 'sep', text: '\u2022', x: 66 },
    { kind: 'word', text: 'Finishing', x: 78 },
    { kind: 'sep', text: '\u2022', x: 148 },
    { kind: 'word', text: 'Infra', x: 160 },
  ];
  const rows = parts.map((p) => {
    const weight = p.kind === 'word' ? '600' : '400';
    const spacing = p.kind === 'word' ? ' letter-spacing="0.1em"' : '';
    return `  <text x="${p.x}" y="82" font-family="${FONT}" font-size="11" font-weight="${weight}"${spacing} fill="${NAVY}">${p.text}</text>`;
  });
  return `<g>\n${rows.join('\n')}\n  </g>`;
}

/** Single centered tagline — print only (no per-word layout). */
function taglinePrintBlock() {
  const { w: contentW } = CONCORD_LOGO_VIEWBOX.full;
  const x = contentW / 2 + 4;
  return `<text x="${x}" y="82" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="600" letter-spacing="0.1em" fill="${NAVY}">MEP &#8226; Finishing &#8226; Infra</text>`;
}

function logoFull() {
  const { w, h, wordmarkOffsetX } = CONCORD_LOGO_VIEWBOX.full;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Concord Plus">
  ${wordmarkBlock(wordmarkOffsetX)}
  ${taglinePartsBlock()}
</svg>`;
}

function logoCompact() {
  const { w, h } = CONCORD_LOGO_VIEWBOX.compact;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Concord Plus">
  <text x="0" y="24" font-family="${FONT}" font-size="24" font-weight="700" letter-spacing="-0.02em" fill="${NAVY}">Concord</text>
  ${iconRow('', { scale: 0.88, oy: 30 })}
  <text x="58" y="48" font-family="${FONT}" font-size="24" font-weight="700" letter-spacing="-0.02em" fill="${ORANGE}">Plus</text>
</svg>`;
}

function logoPrint() {
  const { w, h, padX, padY } = CONCORD_LOGO_VIEWBOX.print;
  const { wordmarkOffsetX } = CONCORD_LOGO_VIEWBOX.full;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Concord Plus">
  <rect width="${w}" height="${h}" fill="#FFFFFF"/>
  <g transform="translate(${padX}, ${padY})">
    ${wordmarkBlock(wordmarkOffsetX)}
    ${taglinePrintBlock()}
  </g>
</svg>`;
}

/**
 * App icon — square, NO text (text is unreadable at 16-32px).
 * Navy rounded tile, construction glyph row centered: orange bolt + white
 * buildings, navy windows (visible on the white tower). High contrast.
 */
function iconApp() {
  // Glyph row native bounds ≈ x[4.2..61] (w≈57), y[0..22.5]. Scale to ~320px
  // wide and center inside the 512 tile.
  const scale = 5.6;
  const rowCenterX = 32.6;
  const rowCenterY = 11.25;
  const tx = Math.round(256 - rowCenterX * scale);
  const ty = Math.round(256 - rowCenterY * scale);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Concord Plus">
  <rect width="512" height="512" rx="112" fill="${NAVY}"/>
  <rect x="14" y="14" width="484" height="484" rx="100" fill="none" stroke="${ORANGE}" stroke-width="6" opacity="0.5"/>
  <g transform="translate(${tx}, ${ty}) scale(${scale})">
    <path d="${ICON.lightning}" fill="${ORANGE}"/>
    <g transform="translate(20, 1.5)"><path d="${ICON.finishing}" fill="#FFFFFF"/></g>
    <g transform="translate(42, 0)">
      <rect x="0" y="0" width="19" height="21" rx="2.8" fill="none" stroke="#FFFFFF" stroke-width="1.9"/>
      <path d="${ICON.infraTower}" fill="#FFFFFF"/>
      <rect x="7.8" y="10.5" width="1.3" height="7" fill="${NAVY}"/>
      <rect x="10.9" y="10.5" width="1.3" height="7" fill="${NAVY}"/>
    </g>
  </g>
</svg>`;
}

function iconFavicon() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="Concord Plus">
  <rect width="32" height="32" rx="7" fill="${NAVY}"/>
  <path d="M16.5 4L12 13h2.8l-1.2 5.5 5.8-7.2H17.8L19.5 4h-3z" fill="#FFFFFF"/>
  <rect x="22" y="5" width="6" height="6" rx="1.5" fill="${ORANGE}"/>
</svg>`;
}

const files = {
  'logo-full.svg': logoFull(),
  'logo-compact.svg': logoCompact(),
  'logo-print.svg': logoPrint(),
  'icon-app.svg': iconApp(),
  'icon-favicon.svg': iconFavicon(),
};

fs.mkdirSync(brandingDir, { recursive: true });
for (const [name, content] of Object.entries(files)) {
  fs.writeFileSync(path.join(brandingDir, name), content, 'utf8');
  console.log(`Wrote branding/${name}`);
}

fs.writeFileSync(path.join(publicDir, 'favicon.svg'), files['icon-favicon.svg'], 'utf8');
fs.writeFileSync(path.join(publicDir, 'app-icon.svg'), files['icon-app.svg'], 'utf8');
fs.writeFileSync(path.join(publicDir, 'concord-plus-logo.svg'), files['logo-full.svg'], 'utf8');
console.log('Synced legacy public SVG aliases.');
