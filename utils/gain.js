// utils/gain.js
// Minimal, fast loudness normalization + clip protection for 16‑bit mono PCM @ 48kHz.

const toFloat = (i16) => i16 / 32768;
const toI16   = (f)   => Math.max(-1, Math.min(1, f)) * 32767 | 0;

function rmsDbFS(samples) {
  let acc = 0;
  for (let i = 0; i < samples.length; i++) acc += samples[i]*samples[i];
  const rms = Math.sqrt(acc / samples.length) + 1e-12;
  return 20 * Math.log10(rms);
}

function countClipped(samples, thr=0.98) {
  let n=0; for (let i=0;i<samples.length;i++) if (Math.abs(samples[i]) >= thr) n++;
  return n;
}

function onePoleHPF(samples, sr=48000, fc=80) {
  if (!fc || fc <= 0) return;
  const x = samples;
  const RC = 1/(2*Math.PI*fc);
  const dt = 1/sr;
  const a = RC/(RC+dt);
  let yPrev = 0, xPrev = 0;
  for (let i=0;i<x.length;i++){
    const xi = x[i];
    const y = a*(yPrev + xi - xPrev);
    xPrev = xi; yPrev = y;
    x[i] = y;
  }
}

function softLimiter(samples, ceiling=0.7079 /* -3 dBFS */, atk=0.002, rel=0.050, sr=48000) {
  const aAtk = Math.exp(-1/(atk*sr));
  const aRel = Math.exp(-1/(rel*sr));
  let env = 0, gain = 1;
  for (let i=0;i<samples.length;i++) {
    const x = samples[i];
    const a = Math.abs(x);
    env = a > env ? aAtk*env + (1-aAtk)*a : aRel*env + (1-aRel)*a;
    const over = env / ceiling;
    const target = over > 1 ? 1/over : 1;
    gain = 0.98*gain + 0.02*target;  // smooth GR
    samples[i] = x * gain;
  }
}

function normalizeInt16LE(int16Buf, cfg={}) {
  const {
    TARGET_RMS_DBFS = -20,
    MAX_GAIN = 6.0,
    MIN_GAIN = 0.5,
    LIMITER_CEILING_DBFS = -3,
    NOISE_GATE_RMS_DBFS = -45,
    HPF_HZ = 80
  } = cfg;

  const n = int16Buf.length / 2;
  const view = new Int16Array(int16Buf.buffer, int16Buf.byteOffset, n);
  const f = new Float32Array(n);
  for (let i=0;i<n;i++) f[i] = toFloat(view[i]);

  if (HPF_HZ > 0) onePoleHPF(f, 48000, HPF_HZ);

  const rmsIn = rmsDbFS(f);
  if (rmsIn < NOISE_GATE_RMS_DBFS) {
    return { action: 'skip', reason: 'too_quiet', stats: { rmsDbIn: rmsIn } };
  }

  const g = Math.max(MIN_GAIN, Math.min(MAX_GAIN,
    Math.pow(10, (TARGET_RMS_DBFS - rmsIn) / 20)));

  for (let i=0;i<n;i++) f[i] *= g;

  const ceiling = Math.pow(10, LIMITER_CEILING_DBFS / 20);
  softLimiter(f, ceiling);

  const out = new Int16Array(n);
  for (let i=0;i<n;i++) out[i] = toI16(f[i]);
  return {
    action: 'ok',
    buf: Buffer.from(out.buffer, out.byteOffset, out.byteLength),
    stats: { rmsDbIn: rmsIn, gain: g, clipFracIn: countClipped(f)/f.length }
  };
}

module.exports = { normalizeInt16LE };
