// log.js
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'logs');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
const stream = fs.createWriteStream(path.join(dir, 'ws_out.jsonl'), { flags: 'a' });

function log(evt, obj) {
  try {
    const entry = {
      ts: new Date().toISOString(),
      t_send: Date.now(),
      evt,
      ...obj
    };
    stream.write(JSON.stringify(entry) + '\n');
  } catch {}
}

// Enhanced logging with message schema
function logMessage(direction, message) {
  try {
    const entry = {
      ts: new Date().toISOString(),
      direction, // 'TX' or 'RX'
      type: message.type,
      eventId: message.eventId,
      segmentId: message.segmentId,
      seq: message.seq,
      kind: message.kind,
      src: message.src || 'stt',
      lang: message.lang || 'auto',
      t_send: message.t_send || Date.now(),
      textLen: message.text ? message.text.length : 0,
      preview: message.text ? message.text.slice(0, 120) : '',
      flags: message.flags || {},
      metrics: message.metrics || {}
    };
    stream.write(JSON.stringify(entry) + '\n');
  } catch {}
}

module.exports = { log, logMessage };
