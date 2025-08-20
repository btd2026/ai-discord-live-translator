// ws.js
const WebSocket = require('ws');
const { loadPrefs } = require('./prefs_store');           // defaults only
const { translateText } = require('./translate_openai');  // used per-client
// DG manager instance is set by index.js after construction; fetch lazily when needed
const { sessions } = require('./sessions');

// Read interim translation config from .env directly
function bool(name, dflt = false) {
  const v = process.env[name];
  if (v == null) return dflt;
  const s = String(v).trim().toLowerCase();
  if (["1","true","yes","on"].includes(s)) return true;
  if (["0","false","no","off"].includes(s)) return false;
  return dflt;
}
function num(name, dflt) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : dflt;
}

const CFG = {
  interimTranslationEnabled: bool('INTERIM_TRANSLATION_ENABLED', true),
  interimTranslationDebounceMs: num('INTERIM_TRANSLATION_DEBOUNCE', 200),
  interimTranslationMaxLen: num('INTERIM_TRANSLATION_MAX_LENGTH', 300),
};

// Speaker updates (snapshot + delta) with debounce
const SPEAKERS_PUSH_DEBOUNCE_MS = Number(process.env.SPEAKERS_PUSH_DEBOUNCE_MS || 200);
const clients = new Set();
const pendingPatches = new Map(); // userId -> mergedPatch
let patchTimer = null;
// Debounced interim translation cache: userId -> { lastText, timer, lastOut, targetLang }
const interimCache = Object.create(null);

function enqueueSpeakerDelta(userId, patch) {
  const curr = pendingPatches.get(userId) || {};
  Object.assign(curr, patch);
  pendingPatches.set(userId, curr);
  if (!patchTimer) patchTimer = setTimeout(flushSpeakerDeltas, SPEAKERS_PUSH_DEBOUNCE_MS);
}
function flushSpeakerDeltas() {
  patchTimer = null;
  if (pendingPatches.size === 0) return;
  for (const [userId, patch] of pendingPatches.entries()) {
    const msg = JSON.stringify({ type: 'speakers:update', userId, patch });
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(msg); } catch {}
      }
    }
  }
  pendingPatches.clear();
}
function broadcastSpeakersSnapshot() {
  const snapshot = sessions.getAllSpeakers ? sessions.getAllSpeakers() : [];
  const msg = JSON.stringify({ type: 'speakers:snapshot', speakers: snapshot });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(msg); } catch {}
    }
  }
}

// Exportable hub for other modules
const speakerHub = {
  onSpeakingStart(userId, username) {
    if (username) sessions.setUsername(userId, username);
    sessions.setSpeaking(userId, true);
    enqueueSpeakerDelta(userId, { username, isSpeaking: true, lastHeardAt: Date.now() });
  },
  onSpeakingStop(userId) {
    sessions.setSpeaking(userId, false);
    enqueueSpeakerDelta(userId, { isSpeaking: false, lastHeardAt: Date.now() });
  },
  onDetectedLang(userId, lang) {
    sessions.setDetectedLang(userId, lang);
    enqueueSpeakerDelta(userId, { detectedLang: lang });
  },
  onPinnedLang(userId, lang) {
    sessions.setLang(userId, lang);
    enqueueSpeakerDelta(userId, { pinnedInputLang: lang });
  },
  pushSnapshot() { broadcastSpeakersSnapshot(); }
};

module.exports.speakerHub = speakerHub;

function cleanLang(s, fallback = 'en') { return s ? String(s).trim() : fallback; }

const defaultPrefs = loadPrefs(); // { translate, targetLang, langHint }
const socketPrefs = new WeakMap();

function startWs(port = 7071) {
  const wss = new WebSocket.Server({ port });
  console.log(`📡 WS listening on ws://localhost:${port}`);
  let hooks = null; // optional callbacks registered by index.js

  wss.on('connection', (socket) => {
    clients.add(socket);
    socket.on('close', () => { clients.delete(socket); });

    const mine = { ...defaultPrefs };
    socketPrefs.set(socket, mine);
    safeSend(socket, { type: 'prefs', prefs: mine });
    // Optionally push a speakers snapshot on connect
    try { safeSend(socket, { type: 'speakers:snapshot', speakers: sessions.getAllSpeakers() }); } catch {}

    socket.on('message', async (data) => {
      let msg; try { msg = JSON.parse(String(data)); } catch { return; }
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'setPrefs' && msg.prefs && typeof msg.prefs === 'object') {
        const p = socketPrefs.get(socket) || { ...defaultPrefs };
        if ('translate'  in msg.prefs) p.translate  = bool(msg.prefs.translate,  p.translate);
        if ('targetLang' in msg.prefs) p.targetLang = cleanLang(msg.prefs.targetLang, p.targetLang);
        if ('langHint'   in msg.prefs) p.langHint   = cleanLang(msg.prefs.langHint,   p.langHint);
        socketPrefs.set(socket, p);
        safeSend(socket, { type: 'prefs', prefs: p });
      }

      if (msg.type === 'speakers:get') {
        try { safeSend(socket, { type: 'speakers:snapshot', speakers: sessions.getAllSpeakers() }); } catch {}
      }

      // Backend API: pin/switch input language per Discord speaker
      if (msg.type === 'speakers:set-inlang') {
        const userId = String(msg.userId || '').trim();
        const lang = typeof msg.lang === 'string' ? msg.lang.trim() : '';
        if (!userId || !lang) {
          return safeSend(socket, { type: 'error', error: 'bad_args' });
        }
        // Accept 'auto' or BCP-47-ish like en, en-US, pt-BR, ja-JP
        const valid = (lang === 'auto') || /^[a-z]{2}(-[A-Za-z]{2})?$/.test(lang);
        if (!valid) {
          return safeSend(socket, { type: 'error', error: 'bad_lang' });
        }
        try {
          const mgr = require('./dg_session_manager')._instance;
          if (!mgr || typeof mgr.switchLanguage !== 'function') throw new Error('dg_manager_missing');
          await mgr.switchLanguage(userId, lang);
          safeSend(socket, { type: 'speakers:inlang-ack', userId, lang });
          // Emit delta to all clients
          try { speakerHub.onPinnedLang(userId, lang); } catch {}
          // Notify app layer (to force-finalize/reset caption event)
          try { hooks?.onLanguagePinned?.(userId, lang); } catch {}
        } catch (e) {
          safeSend(socket, { type: 'error', error: 'switch_language_failed' });
        }
      }
    });
  });

  const api = {
    sendCaption(payload) { broadcast(wss, { type: 'caption', ...payload }); },
    // NEW: interim updates tied to an existing eventId
    sendUpdate(eventId, text, meta = {}) {
      // broadcast original update first
      broadcast(wss, { type: 'update', eventId, text });

      // console.log('🎤 Interim translation check:', { 
      //   enabled: CFG.interimTranslationEnabled, 
      //   textLen: text?.length,
      //   hasClients: clients.size,
      //   meta: meta ? 'has meta' : 'no meta'
      // });

      // Debounced interim translation (read-only, does not affect DG):
      if (!CFG.interimTranslationEnabled) {
        console.log('⏸️ Interim translation disabled');
        return;
      }
      // meta may include userId/username for logging; if not, we can’t translate per-client sensibly
      const userId = meta.userId || meta.speakerId;
      const username = meta.username || meta.userName || 'user';
      if (!userId || !text) return;

      // Prefer any connected client's prefs; if none, fall back to default prefs so we still log a translation.
      let targetLang = null;
      let doTranslate = false;
      for (const sock of wss.clients) {
        if (sock.readyState !== WebSocket.OPEN) continue;
        const p = socketPrefs.get(sock) || { ...defaultPrefs };
        if (p.translate === true && p.targetLang) {
          targetLang = p.targetLang;
          doTranslate = true;
          break;
        }
      }

      
      if (!doTranslate) {
        const p = { ...defaultPrefs };
        if (p.translate === true && p.targetLang) {
          targetLang = p.targetLang;
          doTranslate = true;
        }
      }
      if (!doTranslate || !targetLang) return;

      console.log('🎯 Translation target:', { targetLang, doTranslate });

      const key = String(userId);
      if (!interimCache[key]) interimCache[key] = { lastText: '', timer: null, lastOut: '', targetLang };
      const st = interimCache[key];
      st.targetLang = targetLang; // update sticky target per latest prefs
      if (st.lastText === text) return; // identical interim, skip
      st.lastText = text;

      if (st.timer) try { clearTimeout(st.timer); } catch {}
      const delay = CFG.interimTranslationDebounceMs || 200;
      st.timer = setTimeout(async () => {
        try {
          // recheck latest targetLang in case prefs changed
          let tgt = st.targetLang;
          // Re-check connected client prefs; if none, stick to default prefs fallback
          let found = false;
          for (const sock of wss.clients) {
            if (sock.readyState !== WebSocket.OPEN) continue;
            const p = socketPrefs.get(sock) || { ...defaultPrefs };
            if (p.translate === true && p.targetLang) { tgt = p.targetLang; found = true; break; }
          }
          if (!found) {
            const p = { ...defaultPrefs };
            if (p.translate === true && p.targetLang) tgt = p.targetLang;
          }
          const maxLen = CFG.interimTranslationMaxLen || 300;
          const src = st.lastText.length > maxLen ? st.lastText.slice(0, maxLen) : st.lastText;
          const translated = await translateText(src, tgt);
          if (!translated || translated === st.lastOut) return;
          st.lastOut = translated;

          // 1) Log immediately under the interim line
          console.log(`[Interim→${tgt}] ${username}: ${translated}`);

          // 2) Emit optional translated field so overlays can show it if they want
          broadcast(wss, { type: 'update', eventId, text: st.lastText, translated, tgt });
        } catch {}
      }, delay);
    },

    async sendFinalizeRaw(evt) {
      const clients = Array.from(wss.clients).filter(c => c.readyState === WebSocket.OPEN);
      await Promise.all(clients.map(async (sock) => {
        const p = socketPrefs.get(sock) || { ...defaultPrefs };
        let outText = evt.srcText || '';
        if (p.translate && p.targetLang && outText) {
          try { outText = await translateText(outText, p.targetLang); } catch {}
        }
        safeSend(sock, {
          type: 'finalize',
          eventId: evt.eventId,
          userId: evt.userId,
          username: evt.username,
          color: evt.color,
          text: outText,
          meta: { srcText: evt.srcText || '', srcLang: evt.srcLang || '' }
        });
      }));
    },

  getDefaultPrefs() { return { ...defaultPrefs }; },
  setHooks(h) { hooks = h || null; },
  };

  return api;
}

function broadcast(wss, obj) {
  const data = JSON.stringify(obj);
  for (const c of wss.clients) {
    if (c.readyState === WebSocket.OPEN) { try { c.send(data); } catch {} }
  }
}
function safeSend(sock, obj) {
  if (sock.readyState === WebSocket.OPEN) { try { sock.send(JSON.stringify(obj)); } catch {} }
}

module.exports = { startWs };
