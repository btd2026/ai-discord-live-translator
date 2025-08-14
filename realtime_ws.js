// realtime_ws.js
const WebSocket = require('ws');

// tiny fallback resampler: 48k -> 16k (decimate by 3), mono 16‑bit LE
function downsample48kTo16k(pcm48) {
  const inS = new Int16Array(pcm48.buffer, pcm48.byteOffset, pcm48.length / 2);
  const outS = new Int16Array(Math.floor(inS.length / 3));
  for (let i = 0, j = 0; j < outS.length; j++, i += 3) outS[j] = inS[i];
  return Buffer.from(outS.buffer, outS.byteOffset, outS.byteLength);
}
const b64 = (buf) => buf.toString('base64');

/**
 * Open an OpenAI Realtime WebSocket session.
 * Returns { sendPcm(pcm48k), close() }.
 * Calls onPartial(text) for interims and onFinal(text) for finals.
 */
function openRealtimeSession({
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.REALTIME_MODEL || 'gpt-4o-realtime-preview',
  onPartial,
  onFinal,
  vad = true,              // let server do voice-activity detection
  commitMs = 400,          // how often we commit/request a response
} = {}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY missing');

  const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;
  const ws = new WebSocket(url, {
    headers: { Authorization: `Bearer ${apiKey}`, 'OpenAI-Beta': 'realtime=v1' },
  });

  let wsReady = false;
  let closed = false;

  // Queue audio while connecting; flush when open
  const audioQueue = [];
  let pendingBytes = 0;
  let commitTimer = null;

  function safeSend(obj) {
    if (closed) return;
    if (ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(obj));
    return true;
  }

  ws.on('open', () => {
    wsReady = true;

    // configure session
    safeSend({
      type: 'session.update',
      session: {
        input_audio_format: { type: 'pcm16', sample_rate_hz: 16000, channels: 1 },
        vad: vad ? { type: 'server_vad' } : null,
        modalities: ['text'],
      },
    });

    // flush any queued audio
    if (audioQueue.length) {
      for (const pcm16k of audioQueue.splice(0)) {
        safeSend({ type: 'input_audio_buffer.append', audio: b64(pcm16k) });
        pendingBytes += pcm16k.length;
      }
      // commit right away so server starts decoding
      safeSend({ type: 'input_audio_buffer.commit' });
      safeSend({ type: 'response.create', response: { modalities: ['text'] } });
      pendingBytes = 0;
    }

    // periodic commit while streaming
    commitTimer = setInterval(() => {
      if (pendingBytes > 0 && ws.readyState === WebSocket.OPEN) {
        safeSend({ type: 'input_audio_buffer.commit' });
        safeSend({ type: 'response.create', response: { modalities: ['text'] } });
        pendingBytes = 0;
      }
    }, commitMs);
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'response.delta' && msg.delta?.transcript) {
        onPartial?.(msg.delta.transcript);
      }
      if (msg.type === 'response.completed') {
        const t1 = msg.response?.output?.[0]?.content?.[0]?.transcript;
        const t2 = msg.response?.output_text;
        const final = (t1 || t2 || '').trim();
        if (final) onFinal?.(final);
      }
    } catch { /* ignore parse issues */ }
  });

  ws.on('error', (e) => console.warn('Realtime WS error:', e?.message || e));
  ws.on('close', () => {
    closed = true;
    if (commitTimer) try { clearInterval(commitTimer); } catch {}
    console.log('Realtime WS closed');
  });

  function sendPcm(pcm48k) {
    if (closed) return;
    const pcm16k = downsample48kTo16k(pcm48k);

    if (!wsReady || ws.readyState !== WebSocket.OPEN) {
      // queue until ready
      audioQueue.push(pcm16k);
      return;
    }
    // append now
    safeSend({ type: 'input_audio_buffer.append', audio: b64(pcm16k) });
    pendingBytes += pcm16k.length;

    // if we’ve buffered ~0.5s worth, force a commit for snappier interims
    if (pendingBytes > 16000 /* ~0.5s @ 16k mono, 16-bit */) {
      safeSend({ type: 'input_audio_buffer.commit' });
      safeSend({ type: 'response.create', response: { modalities: ['text'] } });
      pendingBytes = 0;
    }
  }

  function close() {
    closed = true;
    try { if (commitTimer) clearInterval(commitTimer); } catch {}
    try { ws.close(); } catch {}
  }

  return { sendPcm, close };
}

module.exports = { openRealtimeSession };
