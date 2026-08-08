/**
 * Builds a maximally-compatible multi-resolution Windows .ico from
 * branding/icon-app.svg using uncompressed 32-bit BMP (DIB) entries.
 *
 * Why BMP and not PNG-in-ICO: Windows Explorer renders PNG-compressed ICO
 * entries unreliably for the small sizes (16/24/32/48) it actually shows on
 * the desktop and taskbar, and falls back to the default Electron atom icon.
 * 32-bit BGRA DIB entries (with an empty AND mask; alpha drives transparency)
 * render correctly in every Explorer context.
 *
 * Run via: npm run branding:icons (chained) or `node scripts/generate-app-ico.mjs`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const svgPath = path.join(publicDir, 'branding', 'icon-app.svg');
const outIco = path.join(publicDir, 'desktop-icon.ico');

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const svg = fs.readFileSync(svgPath, 'utf8');

/** Render one size to an ICO BMP(DIB) entry: 40-byte header + BGRA XOR + 1bpp AND mask. */
function renderBmpEntry(size) {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    font: { loadSystemFonts: true },
  });
  const img = r.render();
  const w = img.width;
  const h = img.height;
  const rgba = Buffer.from(img.pixels); // RGBA, top-down

  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // biSize
  header.writeInt32LE(w, 4); // biWidth
  header.writeInt32LE(h * 2, 8); // biHeight = XOR + AND
  header.writeUInt16LE(1, 12); // biPlanes
  header.writeUInt16LE(32, 14); // biBitCount
  header.writeUInt32LE(0, 16); // biCompression = BI_RGB
  header.writeUInt32LE(0, 20); // biSizeImage (0 valid for BI_RGB)

  // XOR: 32-bit BGRA, bottom-up rows
  const xor = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4;
    const dst = y * w * 4;
    for (let x = 0; x < w; x++) {
      const s = src + x * 4;
      const d = dst + x * 4;
      xor[d] = rgba[s + 2]; // B
      xor[d + 1] = rgba[s + 1]; // G
      xor[d + 2] = rgba[s]; // R
      xor[d + 3] = rgba[s + 3]; // A
    }
  }

  // AND mask: 1 bit/pixel, rows padded to 4 bytes; all opaque (alpha handles transparency)
  const andRowBytes = Math.ceil(w / 32) * 4;
  const andMask = Buffer.alloc(andRowBytes * h, 0x00);

  return { size: w, data: Buffer.concat([header, xor, andMask]) };
}

const entries = SIZES.map(renderBmpEntry);
const count = entries.length;

const dir = Buffer.alloc(6 + 16 * count);
dir.writeUInt16LE(0, 0); // reserved
dir.writeUInt16LE(1, 2); // type: icon
dir.writeUInt16LE(count, 4); // count

let offset = 6 + 16 * count;
const blobs = [];
entries.forEach((e, i) => {
  const o = 6 + i * 16;
  const dim = e.size >= 256 ? 0 : e.size; // 256 stored as 0
  dir.writeUInt8(dim, o + 0); // width
  dir.writeUInt8(dim, o + 1); // height
  dir.writeUInt8(0, o + 2); // palette
  dir.writeUInt8(0, o + 3); // reserved
  dir.writeUInt16LE(1, o + 4); // planes
  dir.writeUInt16LE(32, o + 6); // bpp
  dir.writeUInt32LE(e.data.length, o + 8); // bytesInRes
  dir.writeUInt32LE(offset, o + 12); // imageOffset
  offset += e.data.length;
  blobs.push(e.data);
});

fs.writeFileSync(outIco, Buffer.concat([dir, ...blobs]));
console.log(`Wrote desktop-icon.ico (BMP DIB, ${SIZES.join(', ')} px)`);
