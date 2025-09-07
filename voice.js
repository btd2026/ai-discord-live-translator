const { joinVoiceChannel, EndBehaviorType, getVoiceConnection } = require('@discordjs/voice');
const prism = require('prism-media');
const { DgSessionManager } = require('./dg_session_manager');
const { speakerHub } = require('./ws');
const { sessions } = require('./sessions');

const SILENCE_MS = Number(process.env.SILENCE_MS || 1200);
const FRAME_BYTES_20MS = Math.floor(48000 * 2 * 0.02); // 1920

function pickColor(id) {
  const colors = ['#6A9EFF','#FF6A6A','#FFD36A','#6AFFC2','#C06AFF','#7ED957','#FF9A6A','#6AD0FF','#FF6AE1','#C2FF6A'];
  let sum = 0; for (const ch of id) sum = (sum + ch.charCodeAt(0)) % colors.length;
  return colors[sum];
}

async function joinAndListen(message, onPcm) {
  const { guild, member } = message;
  const vc = member?.voice?.channel;
  if (!vc) return void message.reply('⚠️ Join a voice channel first, then type **!join**.');

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
    const active = new Set();

    receiver.speaking.on('start', async (userId) => {
      if (active.has(userId)) return; // debounce multiple starts
      active.add(userId);
      
      // Try to resolve member + avatar robustly
      const gm = await guild.members.fetch(userId).catch(() => null);
      const username = gm?.displayName || gm?.user?.username || userId;
      let avatar = null;
      try {
        // 1) Prefer guild member's user avatar
        avatar = gm?.user?.displayAvatarURL?.({ extension: 'png', size: 64, forceStatic: true }) || null;
        // 2) Fallback: fetch the User via the global users API (does not require Guild Members intent)
        if (!avatar) {
          const user = await guild.client.users.fetch(userId).catch(() => null);
          avatar = user?.displayAvatarURL?.({ extension: 'png', size: 64, forceStatic: true }) || null;
        }
      } catch {}
      console.log('[Voice] avatar URL:', avatar);
      console.log(`[Voice] ${username} started speaking`);
      try { speakerHub.onSpeakingStart(userId, username, avatar); } catch {}

      const opus = receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: SILENCE_MS }
      });

      if (typeof opus.setMaxListeners === 'function') opus.setMaxListeners(0);

      const decoder = new prism.opus.Decoder({ rate: 48000, channels: 1, frameSize: 960 });
      if (typeof decoder.setMaxListeners === 'function') decoder.setMaxListeners(0);

      decoder.once('end', () => {
        try { opus.unpipe(decoder); } catch {}
        active.delete(userId);
        console.log(`[Voice] ${username} stopped (silence)`);
        try { speakerHub.onSpeakingStop(userId); } catch {}
        // Drop any carry remainder for this user
        const m = joinAndListen._carryMap;
        if (m) m.delete(userId);
      });
      decoder.on('error', (e) => {
        try { opus.unpipe(decoder); } catch {}
        console.warn('[Voice] decoder error:', e);
      });

      opus.pipe(decoder);

      // Per-user carry buffer so we always emit exact 20ms frames
      const carryMap = joinAndListen._carryMap || (joinAndListen._carryMap = new Map());
      decoder.on('data', (pcm) => {
        if (!(pcm instanceof Buffer)) {
          console.warn('[Voice] received non-Buffer PCM data, skipping');
          return;
        }
        if (pcm.length % 2 !== 0) return; // must be Int16LE sample aligned

        // Mark activity even on short bursts to keep session alive
        try { require('./dg_session_manager')._instance?.markActivity?.(userId); } catch {}
        try { sessions.touch(userId); } catch {}

        const prev = carryMap.get(userId);
        let buf = prev ? Buffer.concat([prev, pcm], prev.length + pcm.length) : pcm;
        let offset = 0;
        while (buf.length - offset >= FRAME_BYTES_20MS) {
          const chunk = buf.slice(offset, offset + FRAME_BYTES_20MS);
          onPcm(userId, username, chunk);
          offset += FRAME_BYTES_20MS;
        }
        const rem = buf.slice(offset);
        if (rem.length) carryMap.set(userId, rem); else carryMap.delete(userId);
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
