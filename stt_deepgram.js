// stt_deepgram.js
const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');

function envBool(name, dflt) {
  const v = process.env[name];
  if (v == null) return dflt;
  const s = String(v).trim().toLowerCase();
  if (['1','true','yes','on'].includes(s)) return true;
  if (['0','false','no','off'].includes(s)) return false;
  return dflt;
}



function saneModel() {
  const requested = (process.env.DG_MODEL || 'nova-3').trim();
  // Allow override if account lacks nova‑3 entitlement
  const fallback = (process.env.DG_MODEL_FALLBACK || 'nova-2').trim();
  return { requested, fallback };
}

function createDeepgramConnection({ speakerId, onTranscript, onError }) {
  const dgKey = process.env.DEEPGRAM_API_KEY;
  if (!dgKey) throw new Error('DEEPGRAM_API_KEY not set (.env)');

  const deepgram = createClient(dgKey);

  const { requested, fallback } = saneModel();

  // IMPORTANT: explicit audio params for Discord PCM
  const baseOpts = {
    language: (process.env.DG_LANGUAGE || 'en-US').trim(),
    encoding: 'linear16',
    sample_rate: 48000,
    channels: 1,
    smart_format: envBool('DG_SMART_FORMAT', true),
    interim_results: envBool('DG_INTERIM_RESULTS', true),
    endpointing: Number(process.env.DG_ENDPOINTING_MS || 1200),
    profanity_filter: envBool('DG_PROFANITY_FILTER', false),
    utterance_split: envBool('DG_UTTERANCE_SPLIT', false),
    punctuate: true,
  };

  let opts = { model: requested, ...baseOpts };
  console.log('[Deepgram] connect opts:', JSON.stringify(opts));

  // Open the live socket
  let conn = deepgram.listen.live(opts);

  // buffer until open
  let isOpen = false;
  const queue = [];
  let keepAliveTimer = null;

  function startKeepAlive() {
    stopKeepAlive();
    keepAliveTimer = setInterval(() => { try { conn.keepAlive?.(); } catch {} }, 25000);
  }
  function stopKeepAlive() {
    if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
  }

  // If we fail to open due to entitlement or auth, we’ll get Close with code/reason.
  // We’ll try a single model fallback (nova‑2) automatically when reason mentions model/tier.
  let triedFallback = false;

  function attachHandlers(c) {
    c.on(LiveTranscriptionEvents.Open, () => {
      isOpen = true;
      startKeepAlive();
      console.log('[Deepgram] socket OPEN');
      for (const buf of queue.splice(0)) {
        try { c.send(buf); } catch (e) { onError?.(e); }
      }
    });

    c.on(LiveTranscriptionEvents.Metadata, (m) => {
      console.log('[Deepgram] metadata:', JSON.stringify(m));
    });

    c.on(LiveTranscriptionEvents.Transcript, (data) => {
      try {
        const alt = data?.channel?.alternatives?.[0];
        const text = alt?.transcript || '';
        const isFinal = Boolean(data?.is_final);
        const speechFinal = Boolean(data?.speech_final);
        onTranscript?.({ speakerId, text, isFinal, speechFinal, raw: data });
      } catch (e) {
        onError?.(e);
      }
    });

    c.on(LiveTranscriptionEvents.Error, (err) => {
      const msg = err?.message || String(err);
      onError?.(new Error(`[Deepgram Error] ${msg}`));
    });

    c.on(LiveTranscriptionEvents.Close, (event) => {
      stopKeepAlive();
      const code = event?.code != null ? ` code=${event.code}` : '';
      const reason = event?.reason ? ` reason="${event.reason}"` : '';
      const msg = `[Deepgram Close]${code}${reason}`;
      console.warn(msg);

      // Try a single automatic fallback if reason hints at model entitlement or unsupported model
      const r = (event?.reason || '').toLowerCase();
      const looksLikeModelIssue =
        r.includes('model') || r.includes('tier') || r.includes('not allowed') || r.includes('unsupported');

      if (!isOpen && !triedFallback && looksLikeModelIssue && fallback && fallback !== opts.model) {
        triedFallback = true;
        console.warn(`[Deepgram] retrying with fallback model "${fallback}"…`);
        opts = { model: fallback, ...baseOpts };
        console.log('[Deepgram] connect opts (fallback):', JSON.stringify(opts));
        conn = createClient(dgKey).listen.live(opts);
        isOpen = false;
        attachHandlers(conn);
        return;
      }

      onError?.(new Error(msg));
    });
  }

  attachHandlers(conn);

  return {
    send: (pcmBuffer) => {
      if (!pcmBuffer || !pcmBuffer.length) return;
      if (!isOpen) { queue.push(pcmBuffer); return; }
      try { conn.send(pcmBuffer); } catch (e) { onError?.(e); }
    },
    finish: () => {
      if (isOpen) {
        try { conn.finish(); } catch (e) { onError?.(e); }
      }
    },
    close: () => {
      try { conn.finish?.(); } catch {}
      try { conn.close?.(); } catch {}
      stopKeepAlive();
    }
  };
}

module.exports = { createDeepgramConnection };
