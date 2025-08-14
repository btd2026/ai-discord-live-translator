// translate_openai.js
const OpenAI = require('openai');

let openai = null;

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

async function translateText(text, targetLang = 'en') {
  if (!text || !text.trim()) return '';
  
  try {
    const client = getOpenAI();
    const model = process.env.TRANSLATE_MODEL || 'gpt-4o-mini';

    const resp = await client.chat.completions.create({
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: `You are a precise translator. Translate the user's text into ${targetLang}. Keep names/terms. Return only the translation.` },
        { role: 'user', content: text }
      ],
    });

    return resp?.choices?.[0]?.message?.content?.trim() || '';
  } catch (error) {
    console.warn('[Translation] Error:', error.message);
    return text; // Return original text on error
  }
}

module.exports = { translateText };
