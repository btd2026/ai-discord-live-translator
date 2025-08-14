// stt_openai.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Wrap raw 48k PCM (mono, 16-bit) into a WAV container
function pcmToWav(pcm, sampleRate = 48000, channels = 1) {
  const bps = 16;
  const header = Buffer.alloc(44);
  const byteRate = (sampleRate * channels * bps) / 8;

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);         // PCM fmt chunk size
  header.writeUInt16LE(1, 20);          // AudioFormat = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE((channels * bps) / 8, 32);
  header.writeUInt16LE(bps, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

async function transcribePcmChunk(pcmBuffer, { langHint } = {}) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing');

  // pcmBuffer may already include overlap (from AudioBufferer)
  const wav = pcmToWav(pcmBuffer, 48000, 1);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ldx-'));
  const tmpPath = path.join(tmpDir, 'clip.wav');
  fs.writeFileSync(tmpPath, wav);

  const tryOnce = async (language) => {
    const resp = await openai.audio.transcriptions.create({
      model: process.env.TRANSCRIBE_MODEL || 'whisper-1',
      file: fs.createReadStream(tmpPath),
      language: (language || process.env.LANG_HINT || '').trim() || undefined, // undefined = auto-detect
      temperature: 0
    });
    return (resp?.text || '').trim();
  };

  try {
    // 1) auto-detect or hinted
    let text = await tryOnce(langHint);

    // Lightweight retry with a few candidates if it's empty/very short
    if (!text || text.length < 3) {
      const candidates = (process.env.LANG_FALLBACKS || 'es,fr,de,pt,ja,zh,ko,ru,ar').split(',').map(s => s.trim());
      for (const cand of candidates) {
        text = await tryOnce(cand);
        if (text && text.length >= 3) break;
      }
    }
    return text;
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
    try { fs.rmdirSync(tmpDir); } catch {}
  }
}

module.exports = { transcribePcmChunk };
