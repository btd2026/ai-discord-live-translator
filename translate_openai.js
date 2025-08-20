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

// In translate_openai.js, modify translateText function:
async function translateText(text, targetLang = 'en') {
  // console.log('🔍 Translation attempt:', { 
  //   text: text?.slice(0, 30) + '...', 
  //   targetLang, 
  //   textLen: text?.length,
  //   hasKey: !!process.env.OPENAI_API_KEY 
  // });
  
  if (!text || !targetLang) {
    console.log('⚠️ Skipping - missing text or targetLang');
    return '';
  }
  
  const maxLen = Number(process.env.INTERIM_TRANSLATION_MAX_LENGTH || 300);
  const truncated = text.length > maxLen ? text.slice(0, maxLen) : text;
  
  try {
    const client = getOpenAI();
    const model = process.env.TRANSLATE_MODEL || 'gpt-4o-mini';

    const resp = await client.chat.completions.create({
      model,
      max_tokens: 150,
      temperature: 0.3,
      messages: [
        { role: 'system', content: `You are a precise translator. Translate the user's text into ${targetLang}. Keep names/terms. Return only the translation.` },
        { role: 'user', content: truncated }
      ]
    });

    const result = resp.choices?.[0]?.message?.content?.trim() || '';
    console.log('✅ Translation success:', result?.slice(0, 30) + '...');
    return result;
  } catch (err) {
    console.log('❌ Translation failed:', err.message);
    return '';
  }
}

module.exports = { translateText };
