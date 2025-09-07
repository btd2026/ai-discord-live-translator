// translate_openai.js
const OpenAI = require('openai');

let openai = null;

function hasUsableKey() {
  const k = process.env.OPENAI_API_KEY;
  // Basic sanity: most OpenAI keys start with 'sk-'
  return typeof k === 'string' && k.trim().length > 0 && /sk-/.test(k);
}

function getOpenAI() {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY not set for translation');
    }
    openai = new OpenAI({ apiKey });
  }
  return openai;
}

// Translation with same-language preservation.
// If input language == target language (ignoring region codes),
// return minimally cleaned text without paraphrasing.
// Otherwise, translate faithfully. Always avoid summarization.
async function translateText(text, targetLang = 'en') {
  if (!text || !targetLang) return '';

  const maxLen = Number(process.env.INTERIM_TRANSLATION_MAX_LENGTH || 300);
  const truncated = text.length > maxLen ? text.slice(0, maxLen) : text;

  try {
    const client = getOpenAI();
    const model = process.env.TRANSLATE_MODEL || 'gpt-4o-mini';

    const system = [
      'You are an expert translator and copy editor.',
      'Rules:',
      `- If the input language is the SAME as the target (${targetLang}), do NOT translate or paraphrase.`,
      '- Instead, minimally clean punctuation/casing and obvious ASR artifacts only.',
      '- Keep wording and word order identical as much as possible. Do not summarize or add/remove information.',
      '- If the input language differs from the target, translate faithfully into the target language.',
      '- Preserve names, terms, numbers exactly. Output ONLY the final text (no quotes or labels).'
    ].join('\n');

    const resp = await client.chat.completions.create({
      model,
      max_tokens: 180,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Target language: ${targetLang}\n\nText:\n${truncated}` }
      ]
    });

    const result = resp.choices?.[0]?.message?.content?.trim() || '';
    console.log('✅ Translation success:', result?.slice(0, 30) + '...');
    return result;
  } catch (err) {
    console.log('⚠️ Translation failed:', err?.message || String(err));
    return '';
  }
}

module.exports = { translateText };

