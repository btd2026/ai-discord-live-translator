// segment_manager.js - Manages segments and sequences
const { log } = require('./log');
const config = require('./timing_config');

class SegmentManager {
    constructor() {
        this.segments = new Map(); // segmentId -> { userId, seq, lastInterimMs, sentFinal, text }
        this.userCounters = new Map(); // userId -> increment counter
        this.finalRate = { total: 0, finalized: 0 };
        
        // Cleanup old segments every 30 seconds
        setInterval(() => this.cleanup(), 30000);
    }
    
    createSegment(userId, username) {
        const increment = (this.userCounters.get(userId) || 0) + 1;
        this.userCounters.set(userId, increment);
        
        const segmentId = `u-${userId}-${increment}`;
        const segment = {
            userId,
            username,
            seq: 0,
            lastInterimMs: Date.now(),
            sentFinal: false,
            text: '',
            createdAt: Date.now()
        };
        
        this.segments.set(segmentId, segment);
        this.finalRate.total++;
        
        log('segment_created', { segmentId, userId, username });
        return segmentId;
    }
    
    updateSegment(segmentId, text, isFinal = false) {
        const segment = this.segments.get(segmentId);
        if (!segment) return null;
        
        segment.seq++;
        segment.text = text;
        segment.lastInterimMs = Date.now();
        
        if (isFinal) {
            segment.sentFinal = true;
            this.finalRate.finalized++;
        }
        
        return {
            segmentId,
            seq: segment.seq,
            kind: isFinal ? 'final' : 'interim',
            text,
            userId: segment.userId,
            username: segment.username,
            t_send: Date.now(),
            flags: { stt_is_final: isFinal },
            metrics: { chars: text.length }
        };
    }
    
    checkSilenceTimeouts() {
        const now = Date.now();
        const timeouts = [];
        
        for (const [segmentId, segment] of this.segments.entries()) {
            if (!segment.sentFinal && 
                (now - segment.lastInterimMs) > config.SILENCE_MS &&
                segment.text.trim().length > 0) {
                
                segment.sentFinal = true;
                this.finalRate.finalized++;
                
                timeouts.push({
                    segmentId,
                    seq: segment.seq + 1,
                    kind: 'final',
                    text: segment.text,
                    userId: segment.userId,
                    username: segment.username,
                    t_send: now,
                    flags: { stt_is_final: false, reason: 'silence_timeout' },
                    metrics: { chars: segment.text.length }
                });
                
                log('auto_finalize', { segmentId, silenceMs: now - segment.lastInterimMs });
            }
        }
        
        return timeouts;
    }
    
    getFinalRate() {
        return this.finalRate.total > 0 ? this.finalRate.finalized / this.finalRate.total : 0;
    }
    
    cleanup() {
        const now = Date.now();
        const oldThreshold = 300000; // 5 minutes
        
        for (const [segmentId, segment] of this.segments.entries()) {
            if (now - segment.createdAt > oldThreshold) {
                this.segments.delete(segmentId);
            }
        }
    }
    
    getSegment(segmentId) {
        return this.segments.get(segmentId);
    }
}

module.exports = { SegmentManager };
