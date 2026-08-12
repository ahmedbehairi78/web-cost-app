/**
 * Instant Voice Clone via ElevenLabs from local samples.
 *
 *   1. Put mp3/wav samples in docs/operations-guide/video-walkthrough/voice-samples/
 *   2. Set ELEVENLABS_API_KEY in .env
 *   3. npm run docs:voice:clone
 *
 * Prints voice_id — save as ELEVENLABS_VOICE_ID in .env (never commit the key).
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const samplesDir = path.join(root, 'docs', 'operations-guide', 'video-walkthrough', 'voice-samples');
const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
const voiceName = process.env.ELEVENLABS_VOICE_NAME?.trim() || 'Web Cost App Narrator';

const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.webm']);

function listSamples() {
  if (!fs.existsSync(samplesDir)) return [];
  return fs
    .readdirSync(samplesDir)
    .filter((f) => AUDIO_EXT.has(path.extname(f).toLowerCase()))
    .map((f) => path.join(samplesDir, f));
}

async function main() {
  if (!apiKey) {
    console.error('Missing ELEVENLABS_API_KEY in .env');
    process.exit(1);
  }
  const files = listSamples();
  if (files.length === 0) {
    console.error(`No audio samples in:\n  ${samplesDir}`);
    console.error('See voice-samples/README.md');
    process.exit(1);
  }

  const form = new FormData();
  form.append('name', voiceName);
  form.append('description', 'Cloned narrator for Web Cost App ops walkthrough');
  form.append('labels', JSON.stringify({ language: 'ar', use: 'narration' }));
  for (const filePath of files) {
    const buf = fs.readFileSync(filePath);
    const blob = new Blob([buf], { type: 'application/octet-stream' });
    form.append('files', blob, path.basename(filePath));
  }

  console.log(`[docs:voice:clone] uploading ${files.length} sample(s) as "${voiceName}"…`);
  const res = await fetch('https://api.elevenlabs.io/v1/voices/add', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: form,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    console.error('ElevenLabs error', res.status, data);
    process.exit(1);
  }

  const voiceId = data.voice_id || data.voiceId;
  console.log('');
  console.log('✅ Voice cloned.');
  console.log(`   voice_id = ${voiceId}`);
  if (data.requires_verification) {
    console.log('   ⚠ requires_verification = true — أكمل التحقق من لوحة ElevenLabs قبل narrate.');
  }
  console.log('');
  console.log('أضف إلى .env ثم نفّذ npm run docs:voice:narrate:');
  console.log(`ELEVENLABS_VOICE_ID=${voiceId}`);
}

await main();
