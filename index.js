// index.js
require('dotenv').config();
const { validateEnv } = require('./env_validator');
const { Client, GatewayIntentBits } = require('discord.js');
const { joinAndListen, leave, pickColor } = require('./voice');
const { startWs } = require('./ws');
const { DgSessionManager } = require('./dg_session_manager');
const { llmPolishFinal } = require('./cleanup_llm');
const { localPolishInterim, localPolishFinal } = require('./clean_text');

// --- CLI arg: --ws-port=9090 (overrides .env WS_PORT) ---
const args = process.argv.slice(2);
const portArg = args.find(a => a.startsWith('--ws-port='));
const WS_PORT = Number.isFinite(Number(portArg?.split('=')[1]))
  ? Number(portArg.split('=')[1])
  : Number(process.env.WS_PORT || 7071);

const ws = startWs(WS_PORT);
const dgManager = new DgSessionManager();
// Expose the singleton for modules that can't import index.js (avoid cycles)
require('./dg_session_manager')._instance = dgManager;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// userId -> speaker state (not DG session)
const speakers = new Map();

function lcpWords(a, b) {
  const aw = String(a || '').split(/\s+/).filter(Boolean);
  const bw = String(b || '').split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < aw.length && i < bw.length && aw[i] === bw[i]) i++;
  return aw.slice(0, i).join(' ');
}

function getOrCreateSpeaker(userId, username) {
  let s = speakers.get(userId);
  if (s) { 
    s.username = username || s.username; 
    return s; 
  }

  const eventId = `c_${Date.now()}_${userId}`;
  s = { 
    username, 
    eventId, 
    committed: '', 
    prevHyp: '', 
    opened: false, 
    finalized: false,
    lastSendTs: Date.now()
  };

  // Ensure DG session exists
  const dgSession = dgManager.ensureSession(userId, username, 
    async ({ text, isFinal, speechFinal }) => {
      if (!s.opened) {
        ws.sendCaption({
          eventId: s.eventId,
          userId,
          username: s.username,
          color: pickColor(userId),
          text: localPolishInterim('…'),
          isFinal: false
        });
        s.opened = true;
      }

      const hyp = String(text || '').trim();
      if (!hyp) return;

      if (isFinal || speechFinal) {
        // Prevent duplicate finalization
        if (s.finalized) return;
        s.finalized = true;
        
        console.log(`[Final] ${s.username}: ${hyp}`);
        let polished = localPolishFinal(hyp);
        try { polished = await llmPolishFinal(polished); } catch {}
        await ws.sendFinalizeRaw({
          eventId: s.eventId,
          userId,
          username: s.username,
          color: pickColor(userId),
          srcText: polished || '',
          srcLang: process.env.DG_LANGUAGE || 'auto'
        });
        speakers.delete(userId);
        return;
      }

      // Log interim results (throttled)
      const now = Date.now();
      if (now - s.lastSendTs > 500) {
        console.log(`[Interim] ${s.username}: ${hyp}`);
        s.lastSendTs = now;
      }

      const stable = lcpWords(s.prevHyp, hyp);
      if (stable.length > s.committed.length) s.committed = stable;
      const tail = hyp.slice(s.committed.length).trim();
      const visible = (s.committed + (tail ? (' ' + tail) : '')).trim();
      ws.sendUpdate(s.eventId, localPolishInterim(visible));
      s.prevHyp = hyp;
    },
    (e) => console.warn('[Deepgram]', e?.message || e)
  );

  speakers.set(userId, s);
  return s;
}

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`📡 WS on ws://localhost:${WS_PORT}`);
  console.log('Join a voice channel, then type !join');
  console.log('Clients can set their language with WS: {type:"setPrefs", prefs:{ targetLang:"fr", translate:true }}');
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const [cmd] = message.content.trim().split(/\s+/);
  const lower = (cmd || '').toLowerCase();

  if (lower === '!ping') return void message.reply('Pong!');

  if (lower === '!permcheck') {
    const target = message.member?.voice?.channel;
    if (!target || !target.isVoiceBased()) {
      return void message.reply('⚠️ Not in a voice channel. Join a VC then run `!permcheck`.');
    }
    const perms = target.permissionsFor(message.guild.members.me);
    const need = { ViewChannel: perms?.has('ViewChannel'), Connect: perms?.has('Connect'), Speak: perms?.has('Speak') };
    const missing = Object.entries(need).filter(([, ok]) => !ok).map(([k]) => k);
    if (missing.length) return void message.reply(`❌ Missing in **${target.name}**: ${missing.join(', ')}`);
    return void message.reply(`✅ Permissions OK in **${target.name}**`);
  }

  if (lower === '!join') {
    if (!process.env.DEEPGRAM_API_KEY) {
      await message.reply('⚠️ DEEPGRAM_API_KEY is not set — cannot stream to STT.');
      console.warn('DEEPGRAM_API_KEY missing — transcription will not run.');
    }

    await joinAndListen(message, (userId, username, pcm) => {
      const s = getOrCreateSpeaker(userId, username);
      // Send PCM to DG session manager
      dgManager.writePcm(userId, pcm);
    });

    return void message.reply('✅ Joined. Transcribing via Deepgram Nova‑3…');
  }

  if (lower === '!leave') {
    leave(message.guild.id);
    return void message.reply('👋 Left the voice channel.');
  }

  if (lower === '!lang') {
    const lang = message.content.trim().split(/\s+/)[1];
    if (!lang) {
      const current = process.env.DG_LANGUAGE || 'auto';
      return void message.reply(`Current language: ${current} (use !lang auto, !lang en, !lang es, etc.)`);
    }
    
    if (lang === 'auto' || /^[a-z]{2}(-[A-Z]{2})?$/.test(lang)) {
      process.env.DG_LANGUAGE = lang;
      const msg = lang === 'auto' ? 'Language set to auto-detect.' : `Language forced to ${lang}. New sessions will use it.`;
      return void message.reply(`✅ ${msg}`);
    } else {
      return void message.reply('❌ Invalid language. Use: auto, en, es, fr, de, pt-BR, etc.');
    }
  }
});

// Validate environment before starting
validateEnv();

const token = process.env.BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;
if (!token) { console.error('❌ BOT_TOKEN missing in .env'); process.exit(1); }
client.login(token);
