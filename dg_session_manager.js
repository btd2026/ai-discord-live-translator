// dg_session_manager.js
const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');

const MIN_CONNECT_BYTES = Math.floor(48000 * 2 * 0.08); // ~80ms @ 48k mono, ~7680 bytes
const REOPEN_DEBOUNCE_MS = 600; // don't reopen within 600ms of a close

function envStr(name, dflt) {
  const v = process.env[name];
  return (v == null || String(v).trim() === '') ? dflt : String(v).trim();
}

function envBool(name, dflt) {
  const v = process.env[name];
  if (v == null) return dflt;
  const s = String(v).trim().toLowerCase();
  if (['1','true','yes','on'].includes(s)) return true;
  if (['0','false','no','off'].includes(s)) return false;
  return dflt;
}

class DgSessionManager {
  constructor() {
    this.sessions = new Map(); // userId -> Session
    this.sweepTimer = null;
    this.startSweepTimer();
    this.MIN_CONNECT_BYTES = 48000 * 2 * 0.08;   // 80ms @ 48k mono Int16 = 7680
    this.REOPEN_DEBOUNCE_MS = 600;               // short cooldown after a close
  }

  startSweepTimer() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = setInterval(() => {
      this.closeIfIdle();
    }, 500);
  }

  getSession(userId) {
    return this.sessions.get(userId);
  }

  ensureSession(userId, username, onTranscript, onError) {
    let session = this.sessions.get(userId);
    
    if (session) {
      session.lastActivityTs = Date.now();
      session.username = username;
      return session; // keep and reuse the same session object
    }

    // We build the session object first (closed), and open sockets lazily when enough audio is buffered.
    const dgKey = process.env.DEEPGRAM_API_KEY;
    if (!dgKey) {
      throw new Error('DEEPGRAM_API_KEY not set (.env)');
    }

    const deepgram = createClient(dgKey);
    const model = (process.env.DG_MODEL || 'nova-3').trim();
    const language = (process.env.DG_LANGUAGE || 'auto').trim();
    const baseOpts = {
      model,
      encoding: 'linear16',
      sample_rate: 48000,
      channels: 1,
      smart_format: envBool('DG_SMART_FORMAT', true),
      interim_results: envBool('DG_INTERIM_RESULTS', true),
      endpointing: Number(process.env.DG_ENDPOINTING_MS || 1200),
      profanity_filter: envBool('DG_PROFANITY_FILTER', false),
      utterance_split: envBool('DG_UTTERANCE_SPLIT', false),
      punctuate: true,
      numerals: envBool('DG_NUMERALS', true),
      filler_words: envBool('DG_FILLER_WORDS', false),
      diarize: envBool('DG_DIARIZE', false),
    };

    let conn = null;
    let isOpen = false;
    let isConnecting = false;
    let keepAliveTimer = null;
    let interimCount = 0;
    let finalCount = 0;

    const openIfReady = () => {
      if (isOpen || isConnecting) return;
      const now = Date.now();
      if (now - session.lastCloseAt < this.REOPEN_DEBOUNCE_MS) return;
      if (session.pendingLen < this.MIN_CONNECT_BYTES) return; // need real audio before opening

      isConnecting = true;
      const opts = { ...baseOpts };
      if (language !== 'auto') opts.language = language;
      console.log(`[Sess] creating DG session for ${username} (${userId})`);
      conn = deepgram.listen.live(opts);

      conn.on(LiveTranscriptionEvents.Open, () => {
        isConnecting = false;
        isOpen = true;
        startKeepAlive();
        console.log(`[DG] socket OPEN for ${username} lang=${language}`);
        // Flush buffered audio
        if (session.pendingLen > 0 && session.pendingBytes.length) {
          try { conn.send(Buffer.concat(session.pendingBytes, session.pendingLen)); } catch {}
          session.pendingBytes = [];
          session.pendingLen = 0;
        }
      });

      conn.on(LiveTranscriptionEvents.Metadata, (m) => {
        // Only log metadata on errors or important events
        if (m?.error) {
          console.warn(`[DG] metadata error for ${username}:`, m.error);
        }
      });

      conn.on(LiveTranscriptionEvents.Transcript, (data) => {
        try {
          const alt = data?.channel?.alternatives?.[0];
          const text = alt?.transcript || '';
          const isFinal = Boolean(data?.is_final);
          const speechFinal = Boolean(data?.speech_final);
          
          if (isFinal || speechFinal) {
            finalCount++;
          } else {
            interimCount++;
          }

          onTranscript?.({ speakerId: userId, text, isFinal, speechFinal, raw: data });
        } catch (e) {
          onError?.(e);
        }
      });

      conn.on(LiveTranscriptionEvents.Error, (err) => {
        const msg = err?.message || String(err);
        console.warn(`[DG] error for ${username}: ${msg}`);
        onError?.(new Error(`[DG Error] ${msg}`));
      });

      conn.on(LiveTranscriptionEvents.Close, (event) => {
        stopKeepAlive();
        const code = event?.code != null ? ` code=${event.code}` : '';
        const reason = event?.reason ? ` reason="${event.reason}"` : '';
        console.log(`[DG] socket CLOSE for ${username}${code}${reason} (${interimCount} interims, ${finalCount} finals, pending=${session.pendingLen} bytes)`);
        session.isOpen = false;
        isOpen = false;
        isConnecting = false;
        session.lastCloseAt = Date.now();
        // Keep the session for reuse (even on 1011). Only delete on explicit destroy().
      });
    };

    function startKeepAlive() {
      stopKeepAlive();
      keepAliveTimer = setInterval(() => { 
        try { conn.keepAlive?.(); } catch {} 
      }, 25000);
    }

    function stopKeepAlive() {
      if (keepAliveTimer) { 
        clearInterval(keepAliveTimer); 
        keepAliveTimer = null; 
      }
    }

    session = {
      userId,
      username,
      get conn() { return conn; },
      isOpen: false,
      lastActivityTs: Date.now(),
      lastCloseAt: 0,
      pendingBytes: [],
      pendingLen: 0,
      interimCount: 0,
      finalCount: 0,
      send: (pcmBuffer) => {
        if (!pcmBuffer || !pcmBuffer.length) return;
        session.lastActivityTs = Date.now();
        // If closed or not yet open, buffer audio; else send through.
        if (!isOpen) {
          session.pendingBytes.push(pcmBuffer);
          session.pendingLen += pcmBuffer.length;
          openIfReady();
        } else {
          try { conn.send(pcmBuffer); } catch (e) { onError?.(e); }
        }
      },
      finish: () => {
        if (isOpen && conn) {
          try { 
            conn.finish(); 
            console.log(`[DG] finished session for ${username}`);
          } catch (e) { 
            onError?.(e); 
          }
        }
      },
      close: () => {
        try { conn?.finish?.(); } catch {}
        try { conn?.close?.(); } catch {}
        stopKeepAlive();
        isOpen = false;
        isConnecting = false;
        session.isOpen = false;
        session.lastCloseAt = Date.now();
      }
    };

    this.sessions.set(userId, session);
    return session;
  }



  writePcm(userId, pcmBuffer) {
    const session = this.sessions.get(userId);
    if (session) {
      session.send(pcmBuffer);
    }
  }

  markActivity(userId) {
    const session = this.sessions.get(userId);
    if (session) {
      session.lastActivityTs = Date.now();
    }
  }

  closeIfIdle(now = Date.now()) {
    const idleThreshold = Math.max(
      1200,
      Number(process.env.DG_ENDPOINTING_MS || 1200) + Number(process.env.DG_IDLE_GRACE_MS || 800)
    );

    for (const [userId, session] of this.sessions.entries()) {
      const idleMs = now - session.lastActivityTs;
      if (idleMs > idleThreshold) {
        if (session.isOpen && session.conn) {
          console.log(`[Sess] finishing idle DG socket for ${session.username} (${Math.round(idleMs)}ms idle)`);
          session.finish(); // socket closes, session persists for reuse
        }
      }
    }
  }

  forceClose(userId) {
    const session = this.sessions.get(userId);
    if (session) {
      console.log(`[Sess] force closing session for ${session.username}`);
      session.close(); // keep the session object (so pending audio can reopen later)
    }
  }

  getStats() {
    const stats = {
      activeSessions: 0,
      totalSessions: this.sessions.size
    };
    
    for (const session of this.sessions.values()) {
      if (session.isOpen) stats.activeSessions++;
    }
    
    return stats;
  }

  destroy() {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    
    for (const [userId] of this.sessions.entries()) {
      this.forceClose(userId);
    }
  }
}

module.exports = { DgSessionManager };
