// ws_client.js
const WebSocket = require('ws');

// ---------- CLI helpers ----------
function parseFlag(name, dflt) {
  const arg = process.argv.slice(2).find(x => x.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=') : dflt;
}
const url = parseFlag('url', `ws://127.0.0.1:${process.env.WS_PORT || 7071}`);

// command and k=v pairs, e.g.:
// node ws_client.js set translate=true targetLang=fr langHint=auto
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const cmd = args[0];
const pairs = args.slice(1);

// ---------- connection with simple retry ----------
let ws;
let retries = 0;
const maxRetries = 5;

function connect() {
  console.log('Connecting to', url, '...');
  ws = new WebSocket(url);

  ws.on('open', () => {
    console.log('Connected to', url);
    retries = 0;

    // If the user passed "set" with k=v pairs, send them now
    if (cmd === 'set' && pairs.length) {
      const prefs = {};
      for (const p of pairs) {
        const i = p.indexOf('=');
        if (i > 0) {
          const k = p.slice(0, i).trim();
          const v = p.slice(i + 1).trim();
          prefs[k] = v;
        }
      }
      safeSend({ type: 'setPrefs', prefs });
      console.log('Sent setPrefs:', prefs);
    }
  });

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(String(data)); } catch { return; }

    if (msg.type === 'prefs') {
      console.log('PREFS:', msg.prefs);
    }
    else if (msg.type === 'caption') {
      // interim line (same for all clients)
      process.stdout.write(`\r${msg.username}: ${msg.text}        `);
    }
    else if (msg.type === 'finalize') {
      // personalized final for this client
      // meta.srcText may contain the raw source transcript from the bot
      const src = msg.meta?.srcText ? `  [src: ${msg.meta.srcText}]` : '';
      console.log(`\nFINAL ${msg.username}: ${msg.text}${src}`);
    }
  });

  ws.on('error', (err) => {
    console.error('WS error:', err.message || err);
  });

  ws.on('close', () => {
    if (retries < maxRetries) {
      retries++;
      const delay = Math.min(1000 * retries, 5000);
      console.log(`Disconnected. Retrying in ${delay}ms...`);
      setTimeout(connect, delay);
    } else {
      console.error('Gave up reconnecting. Make sure the bot is running (npm start) and the URL/port is correct.');
    }
  });
}

function safeSend(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(obj)); } catch {}
  }
}

connect();
