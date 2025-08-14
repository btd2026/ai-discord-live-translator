<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# I've uploaded a project description for this discord translator. I need help debugging my current implementation of the following new feature:

Implement Advanced Voice Activity Detection (VAD):

Problem: The current system relies on simple silence detection (SILENCE_MS) to segment speech. This can be fooled by background noise, causing it to transcribe non-speech sounds, or it can cut off speakers too early or late.
Suggestion: Integrate a more sophisticated VAD library.

I did this by:
I downloaded "@echogarden/fvad-wasm": "^0.2.x" to avoid native build with a WASM VAD. This uses a WebAssembly implementation of VAD to avoid compiling native addons on Windows.

Using this package, I tried to integrate advanced voice activity detection (VAD).

I adjusted usage according to this package's API documentation, which is in the attached fvad.h .

I get the following error currently when I try to run the current implementation:
npm start

> discord-voice-translator-bot-checkpoint@1.0.0 start
> node index.js

📡 WS listening on ws://localhost:9090
✅ Logged in as Voice Translator\#6580
📡 WS on ws://localhost:9090
Join a voice channel, then type !join
Clients can set their language with WS: {type:"setPrefs", prefs:{ targetLang:"fr", translate:true }}
🎤 brian started speaking
[VAD] Initializing WebAssembly VAD module...
[VAD] WebAssembly VAD module initialized successfully.
[VAD] Error: VAD module is not available.
[VAD] Could not create VAD for brian, skipping audio processing.
🎤 brian started speaking
[VAD] Error: VAD module is not available.
[VAD] Could not create VAD for brian, skipping audio processing.
🎤 brian started speaking
[VAD] Error: VAD module is not available.
[VAD] Could not create VAD for brian, skipping audio processing.
🎤 isiah started speaking
[VAD] Error: VAD module is not available.
[VAD] Could not create VAD for isiah, skipping audio processing.
🎤 isiah started speaking
[VAD] Error: VAD module is not available.
[VAD] Could not create VAD for isiah, skipping audio processing.
node:events:496
throw er; // Unhandled 'error' event
^

Error [ERR_STREAM_PUSH_AFTER_EOF]: stream.push() after EOF
at readableAddChunkPushObjectMode (node:internal/streams/readable:524:28)
at Readable.push (node:internal/streams/readable:393:5)
at AudioReceiveStream.push (F:\01. DEV\Discord Voice Translator\02. Discord Bot\node_modules\@discordjs\voice\dist\index.js:1378:18)
at VoiceReceiver.onUdpMessage (F:\01. DEV\Discord Voice Translator\02. Discord Bot\node_modules\@discordjs\voice\dist\index.js:1634:16)
at VoiceUDPSocket.emit (node:events:518:28)
at VoiceUDPSocket.onMessage (F:\01. DEV\Discord Voice Translator\02. Discord Bot\node_modules\@discordjs\voice\dist\index.js:325:10)
at Socket.<anonymous> (F:\01. DEV\Discord Voice Translator\02. Discord Bot\node_modules\@discordjs\voice\dist\index.js:312:48)
at Socket.emit (node:events:518:28)
at UDP.onMessage [as onmessage] (node:dgram:988:8)
Emitted 'error' event on AudioReceiveStream instance at:
at emitErrorNT (node:internal/streams/destroy:170:8)
at emitErrorCloseNT (node:internal/streams/destroy:129:3)
at process.processTicksAndRejections (node:internal/process/task_queues:90:21) {
code: 'ERR_STREAM_PUSH_AFTER_EOF'
}

Node.js v22.18.0

This is my current voice.js file:
// voice.js
const { joinVoiceChannel, EndBehaviorType, getVoiceConnection } = require('@discordjs/voice');
const prism = require('prism-media');
const { default: fvadLoader } = require('@echogarden/fvad-wasm');

let FVad;
let vadInitializationPromise = null;

const SILENCE_MS = Number(process.env.SILENCE_MS || 900);
const VAD_MODE = 3; // Aggressiveness: 0 (least) to 3 (most)
const VAD_FRAME_MS = 20; // Supported frame sizes: 10, 20, 30 ms
const SAMPLE_RATE = 48000;
const FRAME_BYTES = SAMPLE_RATE * (VAD_FRAME_MS / 1000) * 2; // 2 bytes per sample (16-bit)

// Per-user VAD instances to maintain state across audio chunks
const userVads = new Map();

/**

* Initializes the VAD module just once, returning a promise that resolves when ready.
*/
function initializeVAD() {
if (vadInitializationPromise) {
return vadInitializationPromise;
}
// Start the initialization and store the promise.
vadInitializationPromise = new Promise(async (resolve, reject) => {
try {
console.log('[VAD] Initializing WebAssembly VAD module...');
const module = await fvadLoader();
FVad = module.FVad;
console.log('[VAD] WebAssembly VAD module initialized successfully.');
resolve();
} catch (err) {
console.error('[VAD] Failed to initialize VAD module:', err);
reject(err);
}
});
return vadInitializationPromise;
}

async function getOrCreateVad(userId) {
// Ensure the VAD module is loaded and ready before proceeding.
if (!vadInitializationPromise) {
initializeVAD();
}
await vadInitializationPromise;

    if (!FVad) {
        console.error('[VAD] Error: VAD module is not available.');
        return null;
    }
    
    
    if (userVads.has(userId)) {
        return userVads.get(userId);
    }
    
    const vad = new FVad(SAMPLE_RATE, VAD_MODE);
    userVads.set(userId, vad);
    console.log(`[VAD] Created new VAD instance for user ${userId}. Mode: ${VAD_MODE}`);
    return vad;
    }

function pickColor(id) {
const colors = ['\#6A9EFF','\#FF6A6A','\#FFD36A','\#6AFFC2','\#C06AFF','\#7ED957','\#FF9A6A','\#6AD0FF','\#FF6AE1','\#C2FF6A'];
let sum = 0; for (const ch of id) sum = (sum + ch.charCodeAt(0)) % colors.length;
return colors[sum];
}

async function joinAndListen(message, onPcm) {
const { guild, member } = message;
const vc = member?.voice?.channel;
if (!vc) return void message.reply('⚠️ Join a voice channel first, then type **!join**.');

// Pre-join permission check
const perms = vc.permissionsFor(guild.members.me);
const need = ['ViewChannel','Connect','Speak'];
const missing = need.filter(p => !perms?.has(p));
if (missing.length) return void message.reply(`❌ I lack: ${missing.join(', ')} in **${vc.name}**.`);

try {
const connection = joinVoiceChannel({
channelId: vc.id,
guildId: guild.id,
adapterCreator: guild.voiceAdapterCreator,
selfDeaf: false,
});
await message.reply(`✅ Joined **${vc.name}**. Listening… (cut after ${SILENCE_MS}ms silence)`);

    const receiver = connection.receiver;
    
    
    receiver.speaking.on('start', async (userId) => {
      const gm = await guild.members.fetch(userId).catch(() => null);
      const username = gm?.displayName || gm?.user?.username || userId;
      console.log(`🎤 ${username} started speaking`);
    
    
      const opus = receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: SILENCE_MS }
      });
    
    
      // ⬇️ prevent EventEmitter warnings on long sessions
      if (typeof opus.setMaxListeners === 'function') opus.setMaxListeners(0);
    
    
      const decoder = new prism.opus.Decoder({ rate: 48000, channels: 1, frameSize: 960 });
      if (typeof decoder.setMaxListeners === 'function') decoder.setMaxListeners(0);
    
    
      // Make the function async to await the VAD initialization.
      const vad = await getOrCreateVad(userId);
      if (!vad) {
          console.error(`[VAD] Could not create VAD for ${username}, skipping audio processing.`);
          return;
      }
    
    
      opus.pipe(decoder);
    
    
      decoder.on('data', (pcm) => {
        // Process the incoming PCM data in VAD-compatible frame sizes.
        for (let i = 0; i < pcm.length; i += FRAME_BYTES) {
          const frame = pcm.subarray(i, i + FRAME_BYTES);
          if (frame.length < FRAME_BYTES) continue; // Ignore partial frames
    
    
          // The fvad-wasm library requires an Int16Array.
          const pcm16 = new Int16Array(frame.buffer, frame.byteOffset, frame.byteLength / 2);
          
          // If the VAD detects speech, pass the audio frame to the bufferer.
          if (vad.process(pcm16)) {
            onPcm(userId, username, frame);
          }
        }
      });
      decoder.on('end',  () => {
        console.log(`🛑 ${username} stopped (silence)`);
        // Clean up the VAD instance when the user stops talking to save memory.
        userVads.delete(userId);
        console.log(`[VAD] Cleaned up VAD instance for ${userId}.`);
      });
      decoder.on('error', (e) => console.warn('Decoder error:', e));
    });
    } catch (e) {
console.error('Join failed:', e);
await message.reply('❌ Could not join that voice channel (permissions or voice error).');
}
}

function leave(guildId) {
const conn = getVoiceConnection(guildId);
if (conn) conn.destroy();
}

module.exports = { joinAndListen, leave, pickColor };

This is my current index.js file:
// index.js
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { joinAndListen, leave, pickColor } = require('./voice');
const { startWs } = require('./ws');
const { AudioBufferer } = require('./audio_buffer');
const { transcribePcmChunk } = require('./stt_openai');
const { llmPolishFinal } = require('./cleanup_llm');            // ← already added earlier
const { localPolishInterim, localPolishFinal } = require('./clean_text'); // ← local polish

// --- Main async entry point ---
async function main() {
// VAD initialization is now handled just-in-time in voice.js,
// so we no longer need to call it here at startup.

// --- CLI arg: --ws-port=9090 (overrides .env WS_PORT) ---
const args = process.argv.slice(2);
const portArg = args.find(a => a.startsWith('--ws-port='));
const WS_PORT = Number.isFinite(Number(portArg?.split('=')[1]))
? Number(portArg.split('=')[1])
: Number(process.env.WS_PORT || 7071);

// ---- WebSocket broadcaster (per-client translation) ----
const ws = startWs(WS_PORT);

// ---- Discord client ----
const client = new Client({
intents: [
GatewayIntentBits.Guilds,
GatewayIntentBits.GuildMessages,
GatewayIntentBits.MessageContent,
GatewayIntentBits.GuildVoiceStates
]
});

// ---- per-speaker clip buffer (chunked mode) ----
// Handbook defaults: MIN≈1200, MAX≈2200; you can keep these and add overlap safely.
const MIN_CHUNK_MS = Number(process.env.MIN_CHUNK_MS || 1200);
const MAX_CHUNK_MS = Number(process.env.MAX_CHUNK_MS || 2200);
const OVERLAP_MS   = Number(process.env.OVERLAP_MS || 320); // new knob; 0 disables overlap
const buffers = new AudioBufferer({ minMs: MIN_CHUNK_MS, maxMs: MAX_CHUNK_MS, overlapMs: OVERLAP_MS });

// --- simple per-speaker tail text for de-dup ---
const speakerTail = new Map(); // userId -> last tail (10 words)

function tailWords(s, n = 10) {
return String(s || '').split(/\s+/).filter(Boolean).slice(-n).join(' ');
}

// Longest suffix(a) == prefix(b) matcher (punctuation-insensitive, simple)
function dedupeOverlap(prevTail, curr) {
if (!prevTail) return curr;
const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ');
const a = norm(prevTail);
const b = norm(curr);
const max = Math.min(a.length, b.length);
let k = 0;
for (let i = 1; i <= max; i++) {
if (a.slice(-i) === b.slice(0, i)) k = i;
}
return curr.slice(k);
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
      if (!process.env.OPENAI_API_KEY) {
        await message.reply('⚠️ OPENAI_API_KEY is not set — I will join and detect speakers, but captions will say "…".');
        console.warn('OPENAI_API_KEY missing — transcription will not run.');
      }
    
    
      const { langHint: defaultHint } = ws.getDefaultPrefs();
    
    
      await joinAndListen(message, (userId, username, pcm) => {
        buffers.ingest(userId, username, pcm, async (uid, uname, clip, sttClip, done) => {
          const eventId = `c_${Date.now()}_${uid}`;
    
    
          // Light interim (placeholder) — unchanged flow 
          ws.sendCaption({
            eventId,
            userId: uid,
            username: uname,
            color: pickColor(uid),
            text: localPolishInterim('…'),
            isFinal: false
          });
    
    
          try {
            // 1) STT → raw text (feed overlapped buffer)
            let srcText = '…';
            if (process.env.OPENAI_API_KEY) {
              srcText = await transcribePcmChunk(sttClip, { langHint: defaultHint });
            }
    
    
            // 2) De-duplicate overlap against this speaker's last tail
            const prevTail = speakerTail.get(uid) || '';
            const deduped = dedupeOverlap(prevTail, srcText || '');
    
    
            // 3) Local polish (fast, zero-cost)
            let polished = localPolishFinal(deduped || '');
    
    
            // 4) Tiny LLM polish (final only)
            polished = await llmPolishFinal(polished);
    
    
            // Update speaker tail for next chunk
            speakerTail.set(uid, tailWords(polished, 10));
    
    
            console.log(`[${uname}] ${polished || '(no speech)'}`);
    
    
            // 5) WS fan-out (per-client translate on the other side) 
            await ws.sendFinalizeRaw({
              eventId,
              userId: uid,
              username: uname,
              color: pickColor(uid),
              srcText: polished || '',
              srcLang: defaultHint || ''
            });
          } catch (err) {
            console.warn('STT error:', err?.message || err);
            await ws.sendFinalizeRaw({
              eventId,
              userId: uid,
              username: uname,
              color: pickColor(uid),
              srcText: `${uname} (transcription error)`,
              srcLang: ''
            });
          } finally {
            done();
          }
        });
      });
    }
    
    
    if (lower === '!leave') {
      leave(message.guild.id);
      await message.reply('👋 Left the voice channel.');
    }
    });

const token = process.env.BOT_TOKEN;
if (!token) { console.error('❌ BOT_TOKEN missing in .env'); process.exit(1); }
client.login(token);
}

// Start the application
main().catch(err => {
console.error("Fatal error during startup:", err);
process.exit(1);
});

this is my current audio_buffer.js file:
// audio_buffer.js
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
    * @param {number} [options.silenceThresholdMs=1000] - Time to consider a pre-buffer stale.
*/
constructor({ minMs = 800, maxMs = 1600, preBufferMs = 300, silenceThresholdMs = 1000 } = {}) {
this.minMs = minMs;
this.maxMs = maxMs;
this.preBufferMs = preBufferMs;
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

Help me debug the issue with my VAD usage. do not over-engineer. think hard.

The immediate cause is that the WASM VAD never becomes available to your handler, so getOrCreateVad() returns null and you skip audio processing, while the Discord voice receiver continues pushing decoded PCM until the AfterSilence end closes the stream, leading to “stream.push() after EOF.” The fix is to correctly load and hold a singleton fvad-wasm module instance, use the right constructor and API (mode and sampleRate setters), and tear down per-user pipelines cleanly on end/error so no writes occur after the readable is closed.[^1]

# What is going wrong

Your logs show the module appears to initialize, but FVad is still falsy when getOrCreateVad() runs (“VAD module is not available”), which means either the module instance is not retained, the shape of the export is different than expected, or getOrCreateVad() races before initialization resolves in some code paths. Because vad is null, you return early and never attach downstream consumers that would backpressure/consume data; the opus→decoder stream keeps flowing until EndBehaviorType.AfterSilence closes the AudioReceiveStream, and discordjs/voice then throws when further audio arrives: ERR_STREAM_PUSH_AFTER_EOF.[^1]

# Minimal code fixes

1) Initialize fvad-wasm once at process start and retain the module instance and constructor correctly. The API mirrors the fvad.h contract: create an instance, set sample rate, set mode, then call process() with 10/20/30 ms int16 frames; make sure the exported class name matches the package (often Fvad, not FVad), and that it exposes set_sample_rate and set_mode methods (or equivalent), not a sample-rate-taking constructor.[^2][^1]

Replace the loader and instance creation with a safe, awaited singleton:

```js
// vad.js
const fvadLoader = require('@echogarden/fvad-wasm').default;

let vadModule = null;

async function initVadModule() {
  if (vadModule) return vadModule;
  const m = await fvadLoader();
  vadModule = m; // m should contain the class/ctor, e.g., m.Fvad or m.FVad depending on package
  return vadModule;
}

function createVad(sampleRate = 48000, mode = 3) {
  if (!vadModule) throw new Error('VAD module not initialized');
  const Ctor = vadModule.Fvad || vadModule.FVad || vadModule.default || vadModule;
  const vad = new Ctor(); // mirror fvad.h: constructor usually parameterless
  if (typeof vad.set_sample_rate === 'function') vad.set_sample_rate(sampleRate);
  else if (typeof vad.setSampleRate === 'function') vad.setSampleRate(sampleRate);
  if (typeof vad.set_mode === 'function') vad.set_mode(mode);
  else if (typeof vad.setMode === 'function') vad.setMode(mode);
  return vad;
}

module.exports = { initVadModule, createVad };
```

In index.js, call initVadModule() at startup (before joining voice) to avoid races:

```js
const { initVadModule } = require('./vad');

async function main() {
  await initVadModule();
  // … existing startup …
}
```

2) Fix getOrCreateVad to use the above singleton and remove the race:
```js
// voice.js
const { initVadModule, createVad } = require('./vad');

async function getOrCreateVad(userId) {
  await initVadModule();
  if (userVads.has(userId)) return userVads.get(userId);
  const vad = createVad(SAMPLE_RATE, VAD_MODE);
  userVads.set(userId, vad);
  return vad;
}
```

3) Ensure frames are exactly 20 ms of mono 16-bit at 48 kHz. Your math is correct: 48_000 * 0.02 * 2 = 1920 bytes per frame; keep decoder at rate 48000, channels 1, frameSize 960 samples, which yields 20 ms frames from opus decoder; then slice pcm in multiples of 1920 and pass as Int16Array to vad.process().[^2][^1]
4) Guard against stream writes after end by wiring end/error handlers first, and by unpiping/cleanup when end fires:
```js
const opus = receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: SILENCE_MS }});
if (typeof opus.setMaxListeners === 'function') opus.setMaxListeners(0);

const decoder = new prism.opus.Decoder({ rate: SAMPLE_RATE, channels: 1, frameSize: 960 });
if (typeof decoder.setMaxListeners === 'function') decoder.setMaxListeners(0);

// Attach handlers BEFORE piping
decoder.once('end', () => {
  userVads.delete(userId);
  try { opus.unpipe(decoder); } catch {}
});
decoder.on('error', (e) => {
  try { opus.unpipe(decoder); } catch {}
});

opus.pipe(decoder);
```

5) Do not early-return before attaching handlers; if VAD is temporarily unavailable, still consume and drop frames to avoid backpressure errors, or skip piping entirely and also unsubscribe from the receiver to prevent pushes:
```js
const vad = await getOrCreateVad(userId).catch(() => null);
if (!vad) {
  // Consume and drop to avoid push-after-EOF
  opus.on('data', () => {});
  opus.once('end', () => { try { opus.removeAllListeners(); } catch {} });
  return;
}
```


# Validate fvad-wasm API shape

The header indicates functions: fvad_new, fvad_free, fvad_reset, fvad_set_mode, fvad_set_sample_rate, fvad_process; most WASM wrappers surface a class with methods set_mode/set_sample_rate/process returning 1/0/-1 per frame; do not rely on a constructor with (sampleRate, mode) unless the package documents it; use setters to match the C API consistently.[^2][^1]

# Final quick checklist

- Initialize module once at startup; verify exported class name and methods via console.log(Object.keys(module)) during dev; then remove logs.[^1]
- Construct per-user VAD with setters, not with parameters to the constructor, unless the package explicitly supports that signature.[^2][^1]
- Keep frame size to 10/20/30 ms; you chose 20 ms correctly; pass Int16Array view over the Buffer without copying.[^1][^2]
- Always attach end/error handlers and unpipe to prevent push-after-EOF; if skipping VAD, still drain or unsubscribe so underlying streams don’t push into a closed Readable.[^1]
- Clean up userVads on end/error; avoid deleting too early if the decoder may still emit buffered data.[^1]

<div style="text-align: center">⁂</div>

[^1]: translatorprojectupdate.txt.txt

[^2]: fvad.h

