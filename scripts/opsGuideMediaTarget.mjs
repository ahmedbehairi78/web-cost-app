/**
 * Shared resolver for ops-guide slideshow folders (video-walkthrough | promo-ad).
 *
 *   --target=video-walkthrough   (default)
 *   --target=promo-ad
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(__dirname, '..');
export const opsGuideRoot = path.join(root, 'docs', 'operations-guide');

const PRESETS = {
  'video-walkthrough': {
    folder: 'video-walkthrough',
    silentVideo: 'ops-walkthrough.webm',
    voicedVideo: 'ops-walkthrough-with-voice.mp4',
    label: 'docs:video',
  },
  'promo-ad': {
    folder: 'promo-ad',
    silentVideo: 'promo.webm',
    voicedVideo: 'promo-with-voice.mp4',
    label: 'docs:promo',
  },
};

export function resolveOpsGuideTarget(argv = process.argv) {
  const arg = argv.find((a) => a.startsWith('--target='));
  const raw = arg ? arg.slice('--target='.length).trim() : process.env.OPS_GUIDE_TARGET?.trim() || '';
  const key = raw || 'video-walkthrough';
  const preset = PRESETS[key];
  if (!preset) {
    throw new Error(`Unknown --target=${key}. Use: ${Object.keys(PRESETS).join(' | ')}`);
  }
  const walkDir = path.join(opsGuideRoot, preset.folder);
  return {
    key,
    ...preset,
    walkDir,
    audioDir: path.join(walkDir, 'audio'),
    outDir: path.join(walkDir, 'output'),
    stepsPath: path.join(walkDir, 'steps.json'),
    indexUrlPath: `/${preset.folder}/index.html`,
  };
}
