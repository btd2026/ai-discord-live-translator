# Discord Voice Translator - Runbook

## Quick Start

### 1. Environment Setup

Create a `.env` file in the project root:

```env
BOT_TOKEN=your_discord_bot_token_here
DEEPGRAM_API_KEY=dg_your_deepgram_secret_key_here

WS_PORT=7071

DG_MODEL=nova-3
DG_LANGUAGE=en-US
DG_SMART_FORMAT=true
DG_INTERIM_RESULTS=true
DG_ENDPOINTING_MS=1500
DG_PROFANITY_FILTER=false
DG_UTTERANCE_SPLIT=false

SILENCE_MS=1200

TRANSLATE=false
TARGET_LANG=en
TRANSLATE_MODEL=gpt-4o-mini

CLEANUP_ENABLE=true
CLEANUP_MODEL=gpt-4o-mini
CLEANUP_MAXTOKENS=120
CLEANUP_TIMEOUT_MS=1500
```

**Important**: Deepgram API key should be a **Secret Key** (starts with `dg_...`), not a Project API key.

### 2. Verify Environment

```bash
node -e "require('dotenv').config(); console.log(process.env.DEEPGRAM_API_KEY?.slice(0,3)+'…')"
```

Should output: `dg_…`

### 3. Install Dependencies

```bash
npm install
```

### 4. Start the Bot

```bash
npm start
```

Expected output:
```
✅ Environment validation passed
📡 WebSocket port: 7071
🎤 Deepgram model: nova-3
🌍 Language: en-US
⏱️ Endpointing: 1500ms
🔇 Silence threshold: 1200ms
✅ Logged in as YourBot#1234
📡 WS on ws://localhost:7071
Join a voice channel, then type !join
```

### 5. Start the Overlay

```bash
cd DiscordCaptionOverlay
dotnet run
```

### 6. Test in Discord

1. Join a voice channel
2. Type `!join` in any text channel
3. Speak a sentence
4. Watch for:
   - Console: `interim <name>: <text>` then `FINAL <name>: <text>`
   - Overlay: Live updates during speech, final caption after pause

## First Utterance Success Checklist

- [ ] Bot responds to `!join` with "✅ Joined. Transcribing via Deepgram Nova‑3…"
- [ ] Console shows `🎤 <name> started speaking`
- [ ] Console shows `[Deepgram] creating session for <name>`
- [ ] Console shows `[Deepgram] socket OPEN for <name>`
- [ ] Console shows `interim <name>: <text>` while speaking
- [ ] Console shows `FINAL <name>: <text>` after silence
- [ ] Console shows `🛑 <name> stopped (silence)`
- [ ] Overlay displays live updates during speech
- [ ] Overlay shows final caption after pause

## Troubleshooting

### No Transcription

**Symptoms**: Bot joins but no transcription appears

**Check**:
1. `DEEPGRAM_API_KEY` is set and valid
2. Bot has permissions in voice channel (`!permcheck`)
3. You're not muted in Discord
4. Console shows `[Deepgram] socket OPEN`

**Solutions**:
- Verify API key format: should start with `dg_`
- Check bot permissions: `!permcheck`
- Restart bot after changing `.env`

### Multiple Connection Errors

**Symptoms**: Many `[Deepgram] socket OPEN` lines for same user

**Check**:
1. Speaking start debounce is working
2. Session reuse is enabled
3. Idle timer is reasonable

**Solutions**:
- Increase `DG_ENDPOINTING_MS` to 1500-2000ms
- Check for Discord client issues (restart Discord)
- Verify no other bots are in the channel

### Overlay Not Updating

**Symptoms**: Console shows transcription but overlay is static

**Check**:
1. Overlay is running and connected
2. WebSocket port matches (default 7071)
3. Overlay handles `update` messages

**Solutions**:
- Restart overlay application
- Check firewall settings for port 7071
- Verify overlay connects to correct WebSocket URL

### Audio Quality Issues

**Symptoms**: Poor transcription accuracy

**Check**:
1. Microphone quality and settings
2. Discord audio settings
3. Network stability

**Solutions**:
- Use better microphone
- Check Discord audio input settings
- Ensure stable internet connection
- Try different `DG_MODEL` (nova-2, enhanced)

## Performance Tuning

### For Better Accuracy

```env
DG_MODEL=nova-3
DG_SMART_FORMAT=true
DG_INTERIM_RESULTS=true
DG_ENDPOINTING_MS=1500
```

### For Faster Response

```env
DG_ENDPOINTING_MS=800
SILENCE_MS=800
```

### For Multiple Speakers

```env
DG_UTTERANCE_SPLIT=true
DG_ENDPOINTING_MS=1200
```

## Commands Reference

- `!join` - Join voice channel and start transcription
- `!leave` - Leave voice channel
- `!ping` - Test bot response
- `!permcheck` - Check bot permissions in current voice channel

## Overlay Controls

- **Ctrl+Alt+C** - Toggle click-through mode
- **Ctrl+Alt+Plus** - Increase opacity
- **Ctrl+Alt+Minus** - Decrease opacity
- **Drag** - Move overlay (when not in click-through mode)

## Self-Test

Run the automated test to verify WebSocket protocol:

```bash
node scripts/selftest.js
```

Expected output:
```
🧪 Running Discord Voice Translator self-test...
✅ WebSocket client connected
📝 1. Sending caption...
🔄 2. Sending update...
✅ 3. Sending finalize...
🔍 4. Analyzing results...
✅ Message sequence is correct
✅ All message types received
✅ EventId consistency maintained
✅ User info consistency maintained
```

## Log Analysis

### Normal Operation Logs

```
[Deepgram] creating session for UserName (userId)
[Deepgram] socket OPEN for UserName
interim UserName: Hello world
FINAL UserName: Hello world!
[Deepgram] socket CLOSE for UserName code=1000 (5 interims, 1 finals)
```

### Error Logs

```
[Deepgram] error for UserName: Network error
[Deepgram] socket CLOSE for UserName code=1006 reason="Connection lost"
```

### Performance Logs

```
[Deepgram] closing idle session for UserName (2500ms idle)
```

## Architecture

- **Node.js Backend**: Discord bot + Deepgram streaming
- **WPF Overlay**: Caption display with WebSocket client
- **WebSocket Protocol**: Real-time caption updates
- **Session Management**: One Deepgram connection per speaker
- **Audio Pipeline**: Discord → Opus → PCM → Deepgram

## Support

For issues:
1. Check this runbook first
2. Run `node scripts/selftest.js` to verify WebSocket
3. Check console logs for error messages
4. Verify environment variables are set correctly
