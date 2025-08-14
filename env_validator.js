// env_validator.js
function validateEnv() {
  const errors = [];
  const warnings = [];

  // Required environment variables
  if (!process.env.BOT_TOKEN) {
    errors.push('BOT_TOKEN is required');
  }

  if (!process.env.DEEPGRAM_API_KEY) {
    errors.push('DEEPGRAM_API_KEY is required');
  }

  // Validate Deepgram settings
  const dgEndpointing = Number(process.env.DG_ENDPOINTING_MS || 1200);
  if (isNaN(dgEndpointing) || dgEndpointing < 100 || dgEndpointing > 5000) {
    warnings.push(`DG_ENDPOINTING_MS should be between 100-5000ms, got ${dgEndpointing}`);
  }

  const silenceMs = Number(process.env.SILENCE_MS || 1200);
  if (isNaN(silenceMs) || silenceMs < 100 || silenceMs > 5000) {
    warnings.push(`SILENCE_MS should be between 100-5000ms, got ${silenceMs}`);
  }

  const wsPort = Number(process.env.WS_PORT || 7071);
  if (isNaN(wsPort) || wsPort < 1024 || wsPort > 65535) {
    warnings.push(`WS_PORT should be between 1024-65535, got ${wsPort}`);
  }

  // Validate model settings
  const model = process.env.DG_MODEL || 'nova-3';
  const validModels = ['nova-3', 'nova-2', 'nova-1', 'enhanced', 'base'];
  if (!validModels.includes(model)) {
    warnings.push(`DG_MODEL should be one of ${validModels.join(', ')}, got ${model}`);
  }

  // Validate language
  const language = process.env.DG_LANGUAGE || 'auto';
  if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(language) && language !== 'auto') {
    warnings.push(`DG_LANGUAGE should be 'auto' or like 'en-US', got ${language}`);
  }

  // Log results
  if (errors.length > 0) {
    console.error('❌ Environment validation failed:');
    errors.forEach(err => console.error(`  - ${err}`));
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn('⚠️ Environment warnings:');
    warnings.forEach(warn => console.warn(`  - ${warn}`));
  }

  // Log successful validation
  console.log('✅ Environment validation passed');
  console.log(`📡 WebSocket port: ${wsPort}`);
  console.log(`🎤 Deepgram model: ${model}`);
  console.log(`🌍 Language: ${language}${language === 'auto' ? ' (auto-detect)' : ''}`);
  console.log(`⏱️ Endpointing: ${dgEndpointing}ms`);
  console.log(`🔇 Silence threshold: ${silenceMs}ms`);
  if (process.env.DG_IDLE_GRACE_MS) {
    console.log(`🕰️ Idle grace: ${Number(process.env.DG_IDLE_GRACE_MS)}ms`);
  }
}

module.exports = { validateEnv };
