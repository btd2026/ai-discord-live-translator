// cleanup_llm.js
const OpenAI = require('openai');

let client = null;

function getOpenAI() {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY not set for cleanup');
    }
    client = new OpenAI({ apiKey });
  }
  return client;
}

const SYSTEM_PROMPT = `You are a caption post-processor.
Rules:
- Correct transcription errors, pubctuation, and capitalization.
- Fix casing, spacing, and obvious ASR artifacts.
- Do NOT add words or change meaning in any way.
- Keep names/numbers exactly. If a word is unclear, keep as-is.
- Output clean, well-punctuated text in the SAME language as input.
- No preface, no quotes — output ONLY the cleaned sentence.`;

async function llmPolishFinal(raw) {
  if (!raw) return raw;
  if (!process.env.CLEANUP_ENABLE || process.env.CLEANUP_ENABLE === 'false') return raw;

  const model = process.env.CLEANUP_MODEL || 'gpt-4o-mini';
  const timeout = Number(process.env.CLEANUP_TIMEOUT_MS || 1500);
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeout);

  try {
    const openaiClient = getOpenAI();
    const resp = await openaiClient.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: raw }
      ],
      max_tokens: Number(process.env.CLEANUP_MAXTOKENS || 120),
      temperature: 0
    }, { signal: controller.signal });

    const out = resp?.choices?.[0]?.message?.content?.trim();
    return out || raw;
  } catch {
    // Fail open to avoid blocking captions
    return raw;
  } finally {
    clearTimeout(t);
  }
}

module.exports = { llmPolishFinal };
