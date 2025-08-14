// prefs_store.js
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'prefs.json');

const defaults = {
  translate: (process.env.TRANSLATE || 'true').toLowerCase() === 'true',
  targetLang: (process.env.TARGET_LANG || 'en').trim(),
  langHint:   (process.env.LANG_HINT || 'en').trim(),
};

function loadPrefs() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...defaults, ...parsed };
  } catch {
    return { ...defaults };
  }
}

function savePrefs(p) {
  try { fs.writeFileSync(FILE, JSON.stringify(p, null, 2), 'utf8'); } catch {}
}

module.exports = { loadPrefs, savePrefs, defaults };
