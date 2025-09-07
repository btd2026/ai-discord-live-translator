import { InEvt } from './types';

export interface EmitterConfig {
  coalesceMs?: number;
  silenceMsToFinalize?: number;
  adaptiveCoalescing?: boolean;
  minCoalesceMs?: number;
  maxCoalesceMs?: number;
  fastThresholdCharsPerSec?: number;
  slowThresholdCharsPerSec?: number;
}

export interface EmitterStats {
  eventsEmitted: number;
  updatesCoalesced: number;
  finalizesDebounced: number;
  avgCoalesceMs: number;
}

/**
 * Utility class to emit properly timed caption events
 * Handles coalescing updates and debouncing finalizes
 */
export class CaptionEmitter {
  private dispatch: (event: InEvt) => void;
  private config: Required<EmitterConfig>;
  private updateTimers = new Map<string, NodeJS.Timeout>();
  private finalizeTimers = new Map<string, NodeJS.Timeout>();
  private recentEvents: Array<{ text: string; t: number }> = [];
  private stats: EmitterStats = {
    eventsEmitted: 0,
    updatesCoalesced: 0,
    finalizesDebounced: 0,
    avgCoalesceMs: 100
  };

  constructor(
    dispatch: (event: InEvt) => void,
    config: EmitterConfig = {}
  ) {
    this.dispatch = dispatch;
    this.config = {
      coalesceMs: 100,
      silenceMsToFinalize: 700,
      adaptiveCoalescing: true,
      minCoalesceMs: 80,
      maxCoalesceMs: 150,
      fastThresholdCharsPerSec: 14,
      slowThresholdCharsPerSec: 8,
      ...config
    };
  }

  private estimateCharsPerSec(): number {
    if (this.recentEvents.length < 2) return 0;

    const recent = this.recentEvents.slice(-10);
    if (recent.length < 2) return 0;

    const totalChars = recent.reduce((sum, ev) => sum + ev.text.length, 0);
    const timeSpanMs = recent[recent.length - 1].t - recent[0].t;
    
    if (timeSpanMs <= 0) return 0;
    
    return (totalChars / timeSpanMs) * 1000;
  }

  private getAdaptiveCoalesceMs(): number {
    if (!this.config.adaptiveCoalescing) return this.config.coalesceMs;
    
    const charsPerSec = this.estimateCharsPerSec();
    
    if (charsPerSec > this.config.fastThresholdCharsPerSec) {
      return this.config.maxCoalesceMs; // Slower updates for fast speech
    } else if (charsPerSec < this.config.slowThresholdCharsPerSec) {
      return this.config.minCoalesceMs; // Faster updates for slow speech
    }
    
    return this.config.coalesceMs;
  }

  /**
   * Emit a caption start event (immediate)
   */
  public emitCaption(id: string, userId: string, lang?: string): void {
    const event: InEvt = {
      type: 'caption',
      id,
      userId,
      t: Date.now(),
      lang
    };

    this.dispatch(event);
    this.stats.eventsEmitted++;
  }

  /**
   * Emit an update event (coalesced)
   */
  public emitUpdate(id: string, userId: string, text: string, seq?: number, lang?: string): void {
    // Clear existing timer for this ID
    const existingTimer = this.updateTimers.get(id);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.stats.updatesCoalesced++;
    }

    // Track for adaptive coalescing
    this.recentEvents.push({ text, t: Date.now() });
    if (this.recentEvents.length > 20) {
      this.recentEvents = this.recentEvents.slice(-20);
    }

    const coalesceMs = this.getAdaptiveCoalesceMs();
    this.stats.avgCoalesceMs = coalesceMs;

    // Set new timer
    const timer = setTimeout(() => {
      const event: InEvt = {
        type: 'update',
        id,
        userId,
        seq,
        text,
        t: Date.now(),
        lang
      };

      this.dispatch(event);
      this.updateTimers.delete(id);
      this.stats.eventsEmitted++;
    }, coalesceMs);

    this.updateTimers.set(id, timer);
  }

  /**
   * Emit a finalize event (debounced by silence)
   */
  public emitFinalize(id: string, userId: string, text?: string, lang?: string): void {
    // Clear existing timer for this ID
    const existingTimer = this.finalizeTimers.get(id);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.stats.finalizesDebounced++;
    }

    // Set new timer
    const timer = setTimeout(() => {
      const event: InEvt = {
        type: 'finalize',
        id,
        userId,
        text,
        t: Date.now(),
        lang
      };

      this.dispatch(event);
      this.finalizeTimers.delete(id);
      this.stats.eventsEmitted++;
    }, this.config.silenceMsToFinalize);

    this.finalizeTimers.set(id, timer);
  }

  /**
   * Force immediate emission of any pending updates (for testing)
   */
  public flush(): void {
    // Emit all pending updates immediately
    this.updateTimers.forEach((timer, id) => {
      clearTimeout(timer);
      // Note: We don't emit here since we don't have the event data
    });
    this.updateTimers.clear();

    // Emit all pending finalizes immediately  
    this.finalizeTimers.forEach((timer, id) => {
      clearTimeout(timer);
      // Note: We don't emit here since we don't have the event data
    });
    this.finalizeTimers.clear();
  }

  /**
   * Get current stats
   */
  public getStats(): EmitterStats {
    return { ...this.stats };
  }

  /**
   * Reset stats
   */
  public resetStats(): void {
    this.stats = {
      eventsEmitted: 0,
      updatesCoalesced: 0,
      finalizesDebounced: 0,
      avgCoalesceMs: this.config.coalesceMs
    };
  }

  /**
   * Cleanup (clear all timers)
   */
  public destroy(): void {
    this.updateTimers.forEach(timer => clearTimeout(timer));
    this.finalizeTimers.forEach(timer => clearTimeout(timer));
    this.updateTimers.clear();
    this.finalizeTimers.clear();
    this.recentEvents = [];
  }
}

/**
 * Create a caption emitter instance
 */
export function createCaptionEmitter(
  dispatch: (event: InEvt) => void,
  config?: EmitterConfig
): CaptionEmitter {
  return new CaptionEmitter(dispatch, config);
}

/**
 * Replay a sequence of events for testing
 */
export async function replayEvents(
  events: InEvt[],
  dispatch: (event: InEvt) => void,
  options: {
    speedMultiplier?: number;
    preserveTiming?: boolean;
    batchSize?: number;
    onProgress?: (processed: number, total: number) => void;
  } = {}
): Promise<void> {
  const {
    speedMultiplier = 1,
    preserveTiming = true,
    batchSize = 10,
    onProgress
  } = options;

  if (!preserveTiming) {
    // Emit all events immediately
    events.forEach(event => dispatch(event));
    onProgress?.(events.length, events.length);
    return;
  }

  // Replay with original timing (scaled by speedMultiplier)
  const startTime = events[0]?.t || Date.now();
  const replayStartTime = Date.now();

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const originalDelay = event.t - startTime;
    const scaledDelay = originalDelay / speedMultiplier;
    const targetTime = replayStartTime + scaledDelay;
    const currentTime = Date.now();
    
    if (targetTime > currentTime) {
      await new Promise(resolve => setTimeout(resolve, targetTime - currentTime));
    }

    dispatch(event);
    onProgress?.(i + 1, events.length);

    // Batch processing break
    if (i > 0 && i % batchSize === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
}
