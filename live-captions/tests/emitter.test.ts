import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createCaptionEmitter, replayEvents } from '../src/emitter';
import type { InEvt } from '../src/types';

describe('Caption Emitter', () => {
  let mockDispatch: ReturnType<typeof vi.fn>;
  let emitter: ReturnType<typeof createCaptionEmitter>;

  beforeEach(() => {
    mockDispatch = vi.fn();
    emitter = createCaptionEmitter(mockDispatch, {
      coalesceMs: 50,
      silenceMsToFinalize: 100,
      adaptiveCoalescing: false
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    emitter.destroy();
    vi.useRealTimers();
  });

  describe('Caption Events', () => {
    it('should emit caption events immediately', () => {
      emitter.emitCaption('test_id', 'user1', 'en');
      
      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'caption',
        id: 'test_id',
        userId: 'user1',
        lang: 'en',
        t: expect.any(Number)
      });
    });
  });

  describe('Update Coalescing', () => {
    it('should coalesce multiple updates for same ID', () => {
      emitter.emitUpdate('test_id', 'user1', 'First', 1);
      emitter.emitUpdate('test_id', 'user1', 'Second', 2);
      emitter.emitUpdate('test_id', 'user1', 'Third', 3);

      // No dispatch yet
      expect(mockDispatch).toHaveBeenCalledTimes(0);

      // Fast-forward past coalesce time
      vi.advanceTimersByTime(60);

      // Should only dispatch the last update
      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'update',
          text: 'Third',
          seq: 3
        })
      );

      const stats = emitter.getStats();
      expect(stats.updatesCoalesced).toBe(2); // Two updates were coalesced
    });

    it('should handle multiple IDs independently', () => {
      emitter.emitUpdate('id1', 'user1', 'Text1', 1);
      emitter.emitUpdate('id2', 'user2', 'Text2', 1);

      vi.advanceTimersByTime(60);

      expect(mockDispatch).toHaveBeenCalledTimes(2);
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'id1', text: 'Text1' })
      );
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'id2', text: 'Text2' })
      );
    });
  });

  describe('Finalize Debouncing', () => {
    it('should debounce finalize events', () => {
      emitter.emitFinalize('test_id', 'user1', 'Final text');
      
      // No immediate dispatch
      expect(mockDispatch).toHaveBeenCalledTimes(0);

      // Fast-forward past silence time
      vi.advanceTimersByTime(110);

      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'finalize',
        id: 'test_id',
        userId: 'user1',
        text: 'Final text',
        t: expect.any(Number)
      });
    });

    it('should restart debounce timer on repeated finalize', () => {
      emitter.emitFinalize('test_id', 'user1', 'First final');
      
      vi.advanceTimersByTime(50); // Half way through debounce
      
      emitter.emitFinalize('test_id', 'user1', 'Second final');
      
      // Should not have dispatched yet
      expect(mockDispatch).toHaveBeenCalledTimes(0);
      
      vi.advanceTimersByTime(110); // Complete new debounce period
      
      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'Second final' })
      );

      const stats = emitter.getStats();
      expect(stats.finalizesDebounced).toBe(1);
    });
  });

  describe('Adaptive Coalescing', () => {
    it('should adapt coalesce time based on speech rate', () => {
      const adaptiveEmitter = createCaptionEmitter(mockDispatch, {
        coalesceMs: 100,
        adaptiveCoalescing: true,
        minCoalesceMs: 50,
        maxCoalesceMs: 200,
        fastThresholdCharsPerSec: 10,
        slowThresholdCharsPerSec: 5
      });

      // Simulate fast speech (short intervals, long text)
      for (let i = 0; i < 5; i++) {
        adaptiveEmitter.emitUpdate(`fast_${i}`, 'user1', 'Very long text that indicates fast speech pattern', i + 1);
        vi.advanceTimersByTime(10); // Very short intervals
      }

      const stats = adaptiveEmitter.getStats();
      // Should use longer coalesce time for fast speech
      expect(stats.avgCoalesceMs).toBeGreaterThan(100);

      adaptiveEmitter.destroy();
    });
  });

  describe('Statistics', () => {
    it('should track emission statistics', () => {
      emitter.emitCaption('test1', 'user1');
      emitter.emitUpdate('test1', 'user1', 'Update 1', 1);
      emitter.emitUpdate('test1', 'user1', 'Update 2', 2); // This should coalesce
      emitter.emitFinalize('test1', 'user1', 'Final');

      vi.advanceTimersByTime(110);

      const stats = emitter.getStats();
      expect(stats.eventsEmitted).toBe(3); // caption + coalesced update + finalize
      expect(stats.updatesCoalesced).toBe(1);
      expect(stats.finalizesDebounced).toBe(0); // No repeated finalizes
    });

    it('should reset statistics', () => {
      emitter.emitCaption('test', 'user1');
      vi.advanceTimersByTime(10);
      
      expect(emitter.getStats().eventsEmitted).toBe(1);
      
      emitter.resetStats();
      
      const stats = emitter.getStats();
      expect(stats.eventsEmitted).toBe(0);
      expect(stats.updatesCoalesced).toBe(0);
      expect(stats.finalizesDebounced).toBe(0);
    });
  });
});

describe('Event Replay', () => {
  let mockDispatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockDispatch = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should replay events with original timing', async () => {
    const events: InEvt[] = [
      { type: 'caption', id: 'test', userId: 'user1', t: 1000 },
      { type: 'update', id: 'test', userId: 'user1', seq: 1, text: 'Hello', t: 1100 },
      { type: 'update', id: 'test', userId: 'user1', seq: 2, text: 'Hello world', t: 1300 },
      { type: 'finalize', id: 'test', userId: 'user1', text: 'Hello world!', t: 1800 }
    ];

    const replayPromise = replayEvents(events, mockDispatch, {
      speedMultiplier: 1,
      preserveTiming: true
    });

    // Should dispatch first event immediately
    await vi.advanceTimersByTimeAsync(0);
    expect(mockDispatch).toHaveBeenCalledTimes(1);

    // After 100ms, should dispatch second event
    await vi.advanceTimersByTimeAsync(100);
    expect(mockDispatch).toHaveBeenCalledTimes(2);

    // After 200ms more, should dispatch third event
    await vi.advanceTimersByTimeAsync(200);
    expect(mockDispatch).toHaveBeenCalledTimes(3);

    // After 500ms more, should dispatch final event
    await vi.advanceTimersByTimeAsync(500);
    expect(mockDispatch).toHaveBeenCalledTimes(4);

    await replayPromise;
  });

  it('should replay events immediately when preserveTiming is false', async () => {
    const events: InEvt[] = [
      { type: 'caption', id: 'test', userId: 'user1', t: 1000 },
      { type: 'update', id: 'test', userId: 'user1', seq: 1, text: 'Hello', t: 2000 },
      { type: 'finalize', id: 'test', userId: 'user1', text: 'Hello!', t: 3000 }
    ];

    await replayEvents(events, mockDispatch, {
      preserveTiming: false
    });

    expect(mockDispatch).toHaveBeenCalledTimes(3);
  });

  it('should call progress callback during replay', async () => {
    const events: InEvt[] = [
      { type: 'caption', id: 'test', userId: 'user1', t: 1000 },
      { type: 'update', id: 'test', userId: 'user1', seq: 1, text: 'Hello', t: 1100 }
    ];

    const onProgress = vi.fn();

    await replayEvents(events, mockDispatch, {
      preserveTiming: false,
      onProgress
    });

    expect(onProgress).toHaveBeenCalledWith(1, 2);
    expect(onProgress).toHaveBeenCalledWith(2, 2);
  });

  it('should respect speed multiplier', async () => {
    const events: InEvt[] = [
      { type: 'caption', id: 'test', userId: 'user1', t: 1000 },
      { type: 'update', id: 'test', userId: 'user1', seq: 1, text: 'Hello', t: 1200 }, // 200ms delay
    ];

    const replayPromise = replayEvents(events, mockDispatch, {
      speedMultiplier: 2, // 2x speed
      preserveTiming: true
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(mockDispatch).toHaveBeenCalledTimes(1);

    // At 2x speed, 200ms becomes 100ms
    await vi.advanceTimersByTimeAsync(100);
    expect(mockDispatch).toHaveBeenCalledTimes(2);

    await replayPromise;
  });
});
