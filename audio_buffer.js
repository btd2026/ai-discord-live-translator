/**
 * Manages buffering of PCM audio data per user, creating chunks for speech-to-text processing.
 * Implements a rolling pre-buffer to prepend a small amount of recent audio to each chunk,
 * which helps prevent transcription errors from missing leading phonemes.
 */
class AudioBufferer {
  /**
   * @param {object} options
   * @param {number} [options.minMs=800] - Minimum duration of an audio chunk.
   * @param {number} [options.maxMs=1600] - Maximum duration of an audio chunk.
   * @param {number} [options.preBufferMs=300] - Duration of the rolling pre-buffer to prepend.
   * @param {number} [options.overlapMs] - Alias for preBufferMs (back-compat).
   * @param {number} [options.silenceThresholdMs=1000] - Time to consider a pre-buffer stale.
   */
  constructor({ minMs = 800, maxMs = 1600, preBufferMs = 300, overlapMs, silenceThresholdMs = 1000 } = {}) {
    this.minMs = minMs;
    this.maxMs = maxMs;
    // accept either preBufferMs or overlapMs
    this.preBufferMs = Number.isFinite(overlapMs) ? overlapMs : preBufferMs;
    this.silenceThresholdMs = silenceThresholdMs;

    // Maps userId to their audio state
    this.map = new Map(); // userId -> { bufs, started, busy, username, preBuffer, prependingSlice, lastIngest }
    this.SAMPLE_RATE = 48000; // 48 kHz
    this.BYTES_PER_SAMPLE = 2; // 16-bit PCM
    this.preBufferBytes = this._bytesForMs(this.preBufferMs);
  }

  /** Calculates the number of bytes for a given duration in milliseconds. */
  _bytesForMs(ms) {
    if (!ms || ms <= 0) return 0;
    const samples = Math.floor(this.SAMPLE_RATE * (ms / 1000));
    return samples * this.BYTES_PER_SAMPLE;
  }

  /** Trims a user's pre-buffer to the configured size. */
  _trimPreBuffer(s) {
    if (!this.preBufferBytes) {
      s.preBuffer = [];
      return;
    }
    let preBufferLen = s.preBuffer.reduce((acc, b) => acc + b.length, 0);
    while (preBufferLen > this.preBufferBytes) {
      const buf = s.preBuffer[0];
      if (preBufferLen - buf.length >= this.preBufferBytes) {
        preBufferLen -= buf.length;
        s.preBuffer.shift();
      } else {
        const bytesToRemove = preBufferLen - this.preBufferBytes;
        s.preBuffer[0] = buf.subarray(bytesToRemove);
        preBufferLen -= bytesToRemove;
        break;
      }
    }
  }

  /**
   * Ingests a new PCM audio chunk for a user.
   * @param {string} userId - The Discord user ID.
   * @param {string} username - The Discord username.
   * @param {Buffer} pcm - The raw PCM data chunk.
   * @param {function} onReady - Callback when a chunk is ready for processing.
   */
  ingest(userId, username, pcm, onReady) {
    const now = Date.now();
    const s = this.map.get(userId) || { bufs: [], started: 0, busy: false, username, preBuffer: [], prependingSlice: null, lastIngest: 0 };
    s.username = username;

    // If this is the first audio for a new chunk, snapshot the pre-buffer.
    if (s.bufs.length === 0) {
      s.started = now;
      // Only snapshot if the pre-buffer is recent (not from a previous, stale utterance).
      if (s.preBuffer.length > 0 && (now - s.lastIngest < this.silenceThresholdMs)) {
        s.prependingSlice = Buffer.concat(s.preBuffer);
      } else {
        s.prependingSlice = null;
        // If the pre-buffer is stale, clear it so we don't use it next time by mistake.
        s.preBuffer = [];
      }
    }

    s.bufs.push(pcm);
    s.lastIngest = now;

    // Always add to the rolling pre-buffer and trim it.
    s.preBuffer.push(pcm);
    this._trimPreBuffer(s);

    const elapsed = now - s.started;
    const shouldCut = (!s.busy && (elapsed >= this.minMs)) || (!s.busy && elapsed > this.maxMs);

    if (shouldCut && s.bufs.length) {
      const clip = Buffer.concat(s.bufs.splice(0)); // Clear bufs, starting a new chunk period.
      s.busy = true;

      // Build the final payload for STT: prepend the snapshot we took at the start of the utterance.
      const sttClip = s.prependingSlice && s.prependingSlice.length
        ? Buffer.concat([s.prependingSlice, clip])
        : clip;

      s.prependingSlice = null; // Consume the slice.

      /**
       * @callback onReady
       * @param {string} userId
       * @param {string} username
       * @param {Buffer} clip - The raw audio chunk without the prepended buffer.
       * @param {Buffer} sttClip - The audio chunk with the prepended buffer, ready for STT.
       * @param {function} release - A function to call to release the busy lock.
       */
      onReady(userId, s.username, clip, sttClip, () => { s.busy = false; });
    }

    this.map.set(userId, s);
  }
}
module.exports = { AudioBufferer };
