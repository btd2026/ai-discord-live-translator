// audio_buffer.js
class AudioBufferer {
  constructor({ minMs = 800, maxMs = 1600, overlapMs = Number(process.env.OVERLAP_MS || 0) } = {}) {
    this.minMs = minMs;
    this.maxMs = maxMs;
    this.overlapMs = overlapMs;
    this.map = new Map();   // userId -> { bufs:[], started:number, busy:boolean, username:string }
    this.tails = new Map(); // userId -> Buffer (tail cache)
    this.SAMPLE_RATE = 48000;          // 48 kHz mono PCM (handbook baseline) 
    this.BYTES_PER_SAMPLE = 2;         // 16-bit
  }

  _tailBytes(ms) {
    if (!ms || ms <= 0) return 0;
    const samples = Math.floor(this.SAMPLE_RATE * (ms / 1000));
    return samples * this.BYTES_PER_SAMPLE;
  }

  _takeTail(buf) {
    const n = this._tailBytes(this.overlapMs);
    if (!n) return null;
    if (!buf || buf.length === 0) return null;
    const start = Math.max(0, buf.length - n);
    return buf.subarray(start);
  }

  ingest(userId, username, pcm, onReady) {
    const now = Date.now();
    const s = this.map.get(userId) || { bufs: [], started: now, busy: false, username };
    s.username = username;
    s.bufs.push(pcm);

    const elapsed = now - s.started;
    // unchanged min/max gating (your chunker) 
    const shouldCut = (!s.busy && (elapsed >= this.minMs)) || (!s.busy && elapsed > this.maxMs);

    if (shouldCut && s.bufs.length) {
      const clip = Buffer.concat(s.bufs.splice(0)); // non-overlapped window (for timing logs, etc.)
      s.started = now;
      s.busy = true;

      // Build overlapped payload for STT: prepend previous tail (if any)
      const prevTail = this.tails.get(userId);
      const sttClip = prevTail && prevTail.length
        ? Buffer.concat([prevTail, clip])
        : clip;

      // Update tail cache from THIS freshly emitted clip
      const newTail = this._takeTail(clip);
      if (newTail && newTail.length) this.tails.set(userId, Buffer.from(newTail));

      // NOTE: onReady now receives both: (clip, sttClip)
      onReady(userId, s.username, clip, sttClip, () => { s.busy = false; });
    }

    this.map.set(userId, s);
  }
}
module.exports = { AudioBufferer };
