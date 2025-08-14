Quick steps to run:
1) Extract this zip into your folder: F:\01. DEV\Discord Voice Translator\02. Discord Bot
2) In VS Code terminal:
     F:
     cd "F:\01. DEV\Discord Voice Translator\02. Discord Bot"
     npm install
     npm start
3) In Discord:
     - Join a voice channel
     - Type !join   (chunked captions)   or   !joinrt   (realtime captions)
Notes:
  • This build waits for the voice connection to be READY before listening, which fixes cases where 'speaking' never fires.
  • If you change SILENCE_MS, MIN_CHUNK_MS, or MAX_CHUNK_MS, restart the bot.
