// timing_config.js - Centralized timing configuration
module.exports = {
    // Backend timing controls
    SILENCE_MS: 850,                    // Auto-finalize after idle
    TRANSLATE_THROTTLE_HZ: 4,           // Max translations per second
    MAX_INTERIMS_PER_SEC: 6,            // Max interim updates per second
    DROP_OLDER_THAN_MS: 1200,           // Skip interims older than this
    
    // STT controls
    STT_INTERIM_DELAY: 100,             // ms between interim results
    AUTO_FINALIZE_SILENCE: 1500,        // ms of silence before auto-finalize
    
    // Translation controls
    TRANSLATION_DELAY: 500,             // ms to wait before translating partial
    MIN_WORDS_FOR_TRANSLATION: 3,       // word count threshold
    
    // WebSocket controls
    UPDATE_THROTTLE: 200,               // ms between update broadcasts
    HEARTBEAT_INTERVAL: 5000,           // ms between heartbeats
    
    // Logging
    LOG_LEVEL: 'DEBUG',                 // DEBUG, INFO, WARN, ERROR
    ENABLE_METRICS: true                // Enable performance metrics
};
