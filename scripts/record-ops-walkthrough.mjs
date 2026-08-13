/**
 * Record annotated slideshow to silent WebM.
 *
 *   npm run docs:video [-- --headed]
 *   npm run docs:promo [-- --headed]
 *   --target=video-walkthrough | promo-ad
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { opsGuideRoot, resolveOpsGuideTarget, root } from './opsGuideMediaTarget.mjs';

const target = resolveOpsGuideTarget();
const headed = process.argv.includes('--headed');

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json';
  if (filePath.endsWith('.mp3')) return 'audio/mpeg';
  if (filePath.endsWith('.wav')) return 'audio/wav';
  if (filePath.endsWith('.m4a')) return 'audio/mp4';
  return 'application/octet-stream';
}

async function startStaticServer() {
  const base = opsGuideRoot;
  const server = createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
      const filePath = path.join(
        base,
        safe === path.sep || safe === '/' ? `${target.folder}/index.html` : safe,
      );
      if (!filePath.startsWith(base)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType(filePath) });
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      res.writeHead(500);
      res.end(String(err));
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, port };
}

async function main() {
  fs.mkdirSync(target.outDir, { recursive: true });
  const { server, port } = await startStaticServer();
  const url = `http://127.0.0.1:${port}${target.indexUrlPath}`;
  console.log(`[${target.label}] ${url}`);

  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'ar-EG',
    recordVideo: {
      dir: target.outDir,
      size: { width: 1440, height: 900 },
    },
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60_000 });
    const withVoice = await page.evaluate(() => document.body.dataset.voice === '1');
    console.log(
      withVoice
        ? '  · started (voice clips present)'
        : '  · started (no audio/ — silent timings)',
    );
    await page.waitForFunction(() => document.body.dataset.done === '1', null, { timeout: 600_000 });
    console.log('  · finished');
    await page.waitForTimeout(1200);
  } finally {
    await context.close();
    await browser.close();
    server.close();
  }

  const videos = fs.readdirSync(target.outDir).filter((f) => f.endsWith('.webm'));
  if (videos.length === 0) throw new Error('No webm recorded');
  videos.sort(
    (a, b) =>
      fs.statSync(path.join(target.outDir, b)).mtimeMs -
      fs.statSync(path.join(target.outDir, a)).mtimeMs,
  );
  const src = path.join(target.outDir, videos[0]);
  const dest = path.join(target.outDir, target.silentVideo);
  if (path.resolve(src) !== path.resolve(dest)) {
    fs.copyFileSync(src, dest);
  }
  console.log(`[${target.label}] saved → ${path.relative(root, dest)}`);
}

await main();
