// index.js
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { joinAndListen, leave, pickColor } = require('./voice');
const { startWs } = require('./ws');
const { AudioBufferer } = require('./audio_buffer');
const { transcribePcmChunk } = require('./stt_openai');
const { llmPolishFinal } = require('./cleanup_llm');
const { localPolishInterim, localPolishFinal } = require('./clean_text');
const { initialize: initializeVad } = require('./vad'); // Import the initialize function

// --- Main async entry point ---
async function main() {
	// Initialize the VAD module and get the configured Vad class.
	const Vad = await initializeVad();
	console.log('[VAD] WebAssembly module initialized.');

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
	const MIN_CHUNK_MS = Number(process.env.MIN_CHUNK_MS || 1200);
	const MAX_CHUNK_MS = Number(process.env.MAX_CHUNK_MS || 2200);
	const OVERLAP_MS   = Number(process.env.OVERLAP_MS || 320);
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

			// Pass the initialized Vad class into the function that needs it.
			await joinAndListen(message, Vad, (userId, username, pcm) => {
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
