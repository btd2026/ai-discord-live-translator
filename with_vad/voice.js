// voice.js
const { joinVoiceChannel, EndBehaviorType, getVoiceConnection } = require('@discordjs/voice');
const prism = require('prism-media');
// We no longer require 'vad' here. It will be passed in.

const SILENCE_MS = Number(process.env.SILENCE_MS || 900);
const VAD_MODE = 3; // Aggressiveness: 0 (least) to 3 (most)
const VAD_FRAME_MS = 20; // Supported frame sizes: 10, 20, 30 ms
const SAMPLE_RATE = 48000;
const FRAME_BYTES = SAMPLE_RATE * (VAD_FRAME_MS / 1000) * 2; // 2 bytes per sample (16-bit)

// Per-user VAD instances to maintain state across audio chunks
const userVads = new Map();

// Note: This function now takes the Vad class as a parameter.
function getOrCreateVad(userId, Vad) {
	if (userVads.has(userId)) return userVads.get(userId);
	try {
		// Instantiate the Vad class that was passed in.
		const vad = new Vad(SAMPLE_RATE, VAD_MODE);
		userVads.set(userId, vad);
		console.log(`[VAD] Created new VAD instance for user ${userId}.`);
		return vad;
	} catch (err) {
		console.error('[VAD] Failed to create VAD instance:', err);
		return null;
	}
}

function pickColor(id) {
	const colors = ['#6A9EFF','#FF6A6A','#FFD36A','#6AFFC2','#C06AFF','#7ED957','#FF9A6A','#6AD0FF','#FF6AE1','#C2FF6A'];
	let sum = 0; for (const ch of id) sum = (sum + ch.charCodeAt(0)) % colors.length;
	return colors[sum];
}

// Note: The function signature has changed to accept the Vad class.
async function joinAndListen(message, Vad, onPcm) {
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

			// Attach end/error handlers BEFORE piping
			decoder.once('end', () => {
				const vad = userVads.get(userId);
				if (vad) {
					vad.destroy(); // Call the destroy method on the class instance
				}
				userVads.delete(userId);
				try { opus.unpipe(decoder); } catch {}
				console.log(`🛑 ${username} stopped (silence)`);
				console.log(`[VAD] Cleaned up VAD instance for ${userId}.`);
			});
			decoder.on('error', (e) => {
				try { opus.unpipe(decoder); } catch {}
				console.warn('Decoder error:', e);
			});

			// Pass the Vad class to the factory function.
			const vad = getOrCreateVad(userId, Vad);
			if (!vad) {
				// Consume and drop to avoid push-after-EOF
				opus.on('data', () => {});
				opus.once('end', () => { try { opus.removeAllListeners(); } catch {} });
				return;
			}

			opus.pipe(decoder);

			decoder.on('data', (pcm) => {
				for (let i = 0; i < pcm.length; i += FRAME_BYTES) {
					const frame = pcm.subarray(i, i + FRAME_BYTES);
					if (frame.length < FRAME_BYTES) continue;
					const pcm16 = new Int16Array(frame.buffer, frame.byteOffset, frame.byteLength / 2);
					if (vad.process(pcm16)) {
						onPcm(userId, username, frame);
					}
				}
			});
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
