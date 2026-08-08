/**
 * Renders branding SVGs to PNG for Electron desktop / taskbar icons.
 * Run: npm run branding:icons
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');
const brandingDir = path.join(publicDir, 'branding');

const outputs = [
  { src: 'branding/icon-app.svg', dest: 'desktop-icon.png', width: 512 },
  { src: 'branding/icon-app.svg', dest: 'branding/icon-app-256.png', width: 256 },
  { src: 'branding/icon-app.svg', dest: 'branding/icon-app-128.png', width: 128 },
  { src: 'branding/icon-favicon.svg', dest: 'branding/favicon-32.png', width: 32 },
  { src: 'branding/logo-print.svg', dest: 'branding/logo-print.png', width: 720 },
];

for (const { src, dest, width } of outputs) {
  const svgPath = path.join(publicDir, src.replace(/\//g, path.sep));
  const outPath = path.join(publicDir, dest.replace(/\//g, path.sep));
  const svg = fs.readFileSync(svgPath, 'utf8');
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: true },
  });
  const png = resvg.render().asPng();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, png);
  console.log(`Wrote ${dest} (${width}px)`);
}

console.log('Branding PNG export complete.');
