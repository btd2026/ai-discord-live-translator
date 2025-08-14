// clean_text.js
const SENT_END_RE = /[.!?…。！？]$/u;

function simpleCapitalize(s) {
  if (!s) return s;
  // Uppercase the first letter (skips open quotes/brackets)
  return s.replace(/^(\s*["“'（(【]?\s*)(\p{L})/u, (_, pre, first) => pre + first.toUpperCase());
}

function collapseSpaces(s) {
  return s
    .replace(/\s+/g, ' ')                 // collapse runs of spaces
    .replace(/\s+([,.;:!?])/g, '$1')      // no space before punctuation
    .replace(/([(\[“"‘'])\s+/g, '$1')     // no space immediately after opening quotes/brackets
    .trim();
}

function tidyQuotesDashes(s) {
  return s
    .replace(/``/g, '“').replace(/''/g, '”')
    .replace(/\s?--\s?/g, '—');
}

function heuristicFinish(s) {
  if (!s) return s;
  const t = s.trim();
  if (SENT_END_RE.test(t)) return t;
  if (t.length < 18) return t; // short fragments: don't force a period
  return t + '.';
}

// Live/interim: conservative (no forced period)
function localPolishInterim(text) {
  let s = String(text || '');
  s = s.replace(/[ \t]+/g, ' ');
  s = tidyQuotesDashes(s);
  s = simpleCapitalize(s);
  s = collapseSpaces(s);
  return s;
}

// Final: add end punctuation when it looks like a complete clause
function localPolishFinal(text) {
  let s = localPolishInterim(text);
  s = heuristicFinish(s);
  s = s.replace(/\s{2,}/g, ' ').trim(); // ensure single spaces after de-dup joins
  return s;
}

module.exports = { localPolishInterim, localPolishFinal };
