# Discord Voice Transcription Bot

A Discord bot that joins voice channels, transcribes speech in real-time using Deepgram Nova-3, and displays captions in a WPF overlay.

## Features

- **Real-time transcription** using Deepgram Nova-3 streaming
- **Per-speaker tracking** with color-coded captions
- **WPF overlay** for displaying captions
- **WebSocket protocol** for caption updates
- **Optional translation** (disabled by default)
- **Text cleanup** and formatting

## Setup

### 1. Environment Variables

Create a `.env` file in the project root:

```env
BOT_TOKEN=REPLACE_ME
DEEPGRAM_API_KEY=REPLACE_ME

WS_PORT=7071

DG_MODEL=nova-3
DG_LANGUAGE=en-US
DG_SMART_FORMAT=true
DG_INTERIM_RESULTS=true
DG_ENDPOINTING_MS=1200
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

### 2. Install Dependencies

```bash
npm install
```

### 3. Get API Keys

- **Discord Bot Token**: Create a bot at [Discord Developer Portal](https://discord.com/developers/applications)
- **Deepgram API Key**: Get a key from [Deepgram Console](https://console.deepgram.com/)

## Running

### 1. Start the Bot

```bash
npm start
```

You should see:
```
✅ Logged in as <bot-name>
📡 WS on ws://localhost:7071
Join a voice channel, then type !join
```

### 2. Start the Overlay

Build and run the WPF overlay:
```bash
cd DiscordCaptionOverlay
dotnet build
dotnet run
```

### 3. Use in Discord

1. Join a voice channel
2. Type `!join` to start transcription
3. Speak - you should see interim updates and final captions in the overlay

## Commands

- `!join` - Join voice channel and start transcription
- `!leave` - Leave voice channel
- `!ping` - Test bot response
- `!permcheck` - Check bot permissions in current voice channel

## Overlay Controls

- **Ctrl+Alt+C** - Toggle click-through mode
- **Ctrl+Alt+Plus** - Increase opacity
- **Ctrl+Alt+Minus** - Decrease opacity
- **Drag** - Move overlay (when not in click-through mode)

## Troubleshooting

1. **No transcription**: Check `DEEPGRAM_API_KEY` is set correctly
2. **Overlay not showing**: Ensure WPF app is running and connected to same port
3. **Permission errors**: Use `!permcheck` to verify bot permissions
4. **Connection issues**: Check firewall settings for WebSocket port 7071

## Architecture

- **Node.js backend** - Discord bot + Deepgram streaming
- **WPF overlay** - Caption display with WebSocket client
- **WebSocket protocol** - Real-time caption updates
- **Per-speaker sessions** - Individual Deepgram connections per user
