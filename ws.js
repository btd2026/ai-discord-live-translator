// ws.js
const WebSocket = require('ws');
const { loadPrefs } = require('./prefs_store');           // defaults only
const { translateText } = require('./translate_openai');  // used per-client
// DG manager instance is set by index.js after construction; fetch lazily when needed

function bool(v, dflt = false) {
  if (v == null) return dflt;
  const s = String(v).trim().toLowerCase();
  if (['1','true','yes','on'].includes(s)) return true;
  if (['0','false','no','off'].includes(s)) return false;
  return dflt;
}

function cleanLang(s, fallback = 'en') { return s ? String(s).trim() : fallback; }

const defaultPrefs = loadPrefs(); // { translate, targetLang, langHint }
const socketPrefs = new WeakMap();

function startWs(port = 7071) {
  const wss = new WebSocket.Server({ port });
  console.log(`📡 WS listening on ws://localhost:${port}`);

  wss.on('connection', (socket) => {
    const mine = { ...defaultPrefs };
    socketPrefs.set(socket, mine);
    safeSend(socket, { type: 'prefs', prefs: mine });

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
        } catch (e) {
          safeSend(socket, { type: 'error', error: 'switch_language_failed' });
        }
      }
    });
  });

  const api = {
    sendCaption(payload) { broadcast(wss, { type: 'caption', ...payload }); },
    // NEW: interim updates tied to an existing eventId
    sendUpdate(eventId, text) { broadcast(wss, { type: 'update', eventId, text }); },

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
