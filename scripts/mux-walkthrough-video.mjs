/**
 * Mux silent WebM + per-step MP3s → one video with voice.
 *
 *   npm run docs:video:mux
 *   npm run docs:promo:mux
 *   --target=video-walkthrough | promo-ad
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { resolveOpsGuideTarget, root } from './opsGuideMediaTarget.mjs';

const target = resolveOpsGuideTarget();
const PAD_MS = 450;
const END_HOLD_MS = 1200;

function resolveFfmpeg() {
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }
  try {
    const require = createRequire(import.meta.url);
    const p = require('ffmpeg-static');
    if (p && fs.existsSync(p)) return p;
  } catch {
    /* optional */
  }
  return 'ffmpeg';
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => {
      err += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${bin} exited ${code}\n${err.slice(-2000)}`));
    });
  });
}

async function main() {
  const ffmpeg = resolveFfmpeg();
  const videoIn = path.join(target.outDir, target.silentVideo);
  if (!fs.existsSync(videoIn)) {
    throw new Error(`Missing ${videoIn} — run record first`);
  }

  const clips = [];
  for (let i = 1; i <= 30; i++) {
    const f = path.join(target.audioDir, `${String(i).padStart(2, '0')}.mp3`);
    if (!fs.existsSync(f)) break;
    clips.push(f);
  }
  if (clips.length === 0) {
    throw new Error(`No audio in ${target.audioDir} — run narrate first`);
  }

  fs.mkdirSync(target.outDir, { recursive: true });
  const work = path.join(target.outDir, '_mux_work');
  fs.mkdirSync(work, { recursive: true });

  const silence = path.join(work, 'pad.mp3');
  const endHold = path.join(work, 'end.mp3');
  await run(ffmpeg, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=44100:cl=mono',
    '-t',
    (PAD_MS / 1000).toFixed(3),
    '-q:a',
    '9',
    '-acodec',
    'libmp3lame',
    silence,
  ]);
  await run(ffmpeg, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=44100:cl=mono',
    '-t',
    (END_HOLD_MS / 1000).toFixed(3),
    '-q:a',
    '9',
    '-acodec',
    'libmp3lame',
    endHold,
  ]);

  const listFile = path.join(work, 'concat.txt');
  const lines = [];
  for (let i = 0; i < clips.length; i++) {
    lines.push(`file '${clips[i].replace(/\\/g, '/')}'`);
    if (i < clips.length - 1) lines.push(`file '${silence.replace(/\\/g, '/')}'`);
  }
  lines.push(`file '${endHold.replace(/\\/g, '/')}'`);
  fs.writeFileSync(listFile, lines.join('\n'), 'utf8');

  const narration = path.join(target.outDir, 'full-narration.mp3');
  console.log(`[${target.label}:mux] concat ${clips.length} clips…`);
  await run(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', narration]);

  const videoOut = path.join(target.outDir, target.voicedVideo);
  console.log(`[${target.label}:mux] mux → ${target.voicedVideo}…`);
  await run(ffmpeg, [
    '-y',
    '-i',
    videoIn,
    '-i',
    narration,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-shortest',
    '-movflags',
    '+faststart',
    videoOut,
  ]);

  fs.rmSync(work, { recursive: true, force: true });
  console.log(`[${target.label}:mux] saved → ${path.relative(root, videoOut)}`);
}

await main();
