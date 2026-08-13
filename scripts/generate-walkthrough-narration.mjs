/**
 * Generate per-step MP3 narration with a cloned ElevenLabs voice.
 *
 *   npm run docs:voice:narrate
 *   npm run docs:promo:narrate
 *
 *   --target=video-walkthrough | promo-ad
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { resolveOpsGuideTarget, root } from './opsGuideMediaTarget.mjs';

const target = resolveOpsGuideTarget();
const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim();
const modelId = process.env.ELEVENLABS_MODEL_ID?.trim() || 'eleven_multilingual_v2';

/** ق → ء for Egyptian glottal pronunciation; strip punctuation so TTS does not read marks aloud. */
function prepareNarrationForTts(raw) {
  return String(raw || '')
    .replace(/\u0642/g, '\u0621')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[.,:;!?…،؛؟«»""''()[\]{}<>/\\|@#$%^&*_+=~`—–\-·•]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function tts(text, outFile) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.8,
        style: 0.15,
        use_speaker_boost: true,
      },
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`TTS ${res.status}: ${errText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outFile, buf);
  return buf.length;
}

async function main() {
  if (!apiKey || !voiceId) {
    console.error('Set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in .env');
    process.exit(1);
  }
  const steps = JSON.parse(fs.readFileSync(target.stepsPath, 'utf8'));
  fs.mkdirSync(target.audioDir, { recursive: true });

  const manifest = {
    generatedAt: new Date().toISOString(),
    modelId,
    voiceId,
    target: target.key,
    steps: [],
  };

  console.log(`[${target.label}:narrate] ${target.key} · ${steps.length} steps`);
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const fileName = `${String(i + 1).padStart(2, '0')}.mp3`;
    const outFile = path.join(target.audioDir, fileName);
    const text = prepareNarrationForTts(step.narration || step.body || step.title || '');
    if (!text) {
      console.warn(`  skip ${fileName} — empty narration`);
      continue;
    }
    process.stdout.write(`  · ${fileName} … `);
    const bytes = await tts(text, outFile);
    console.log(`${bytes} bytes`);
    manifest.steps.push({
      id: step.id,
      index: i,
      file: `audio/${fileName}`,
      text,
    });
  }

  fs.writeFileSync(path.join(target.audioDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`[${target.label}:narrate] → ${path.relative(root, target.audioDir)}`);
}

await main();
