import { describe, it, expect, beforeEach, vi } from 'vitest';
import { captionReducer, createInitialState } from '../src/reducer';
import type { InEvt, LaneState } from '../src/types';

describe('Caption Reducer', () => {
  let initialState: LaneState;

  beforeEach(() => {
    initialState = createInitialState();
  });

  describe('Late Update Recovery', () => {
    it('should auto-respawn when update arrives after finalize', () => {
      const captionEvent: InEvt = {
        type: 'caption',
        id: 'test_event',
        userId: 'user1',
        t: 1000
      };

      const updateEvent: InEvt = {
        type: 'update',
        id: 'test_event',
        userId: 'user1',
        seq: 1,
        text: 'Hello',
        t: 1100
      };

      const finalizeEvent: InEvt = {
        type: 'finalize',
        id: 'test_event',
        userId: 'user1',
        text: 'Hello world',
        t: 1800
      };

      const lateUpdateEvent: InEvt = {
        type: 'update',
        id: 'test_event',
        userId: 'user1',
        seq: 2,
        text: 'Hello world continued',
        t: 2000
      };

      // Normal flow
      let state = captionReducer(initialState, {
        type: 'measurement_ready',
        widthPx: 300
      });

      state = captionReducer(state, {
        type: 'event',
        event: captionEvent,
        widthPx: 300
      });

      state = captionReducer(state, {
        type: 'event',
        event: updateEvent,
        widthPx: 300
      });

      state = captionReducer(state, {
        type: 'event',
        event: finalizeEvent,
        widthPx: 300
      });

      // Verify finalization
      expect(state.finalizedIds.has('test_event')).toBe(true);
      expect(state.metrics.lateRespawns).toBe(0);

      // Late update should trigger respawn
      state = captionReducer(state, {
        type: 'event',
        event: lateUpdateEvent,
        widthPx: 300
      });

      expect(state.metrics.lateRespawns).toBe(1);
      expect(state.activeId).toBe('test_event#2');
      
      // Should have segments with both original and synthetic IDs
      const allSegments = state.pages.flatMap(page => page.segments);
      const originalSegments = allSegments.filter(s => s.id === 'test_event');
      const syntheticSegments = allSegments.filter(s => s.id === 'test_event#2');
      
      expect(originalSegments.length).toBeGreaterThan(0);
      expect(syntheticSegments.length).toBeGreaterThan(0);
    });

    it('should handle multiple late updates with incrementing synthetic IDs', () => {
      // Setup finalized event
      let state = captionReducer(initialState, {
        type: 'measurement_ready',
        widthPx: 300
      });

      state = captionReducer(state, {
        type: 'event',
        event: { type: 'caption', id: 'test', userId: 'user1', t: 1000 },
        widthPx: 300
      });

      state = captionReducer(state, {
        type: 'event',
        event: { type: 'finalize', id: 'test', userId: 'user1', text: 'Final', t: 1500 },
        widthPx: 300
      });

      // First late update -> #2
      state = captionReducer(state, {
        type: 'event',
        event: { type: 'update', id: 'test', userId: 'user1', seq: 1, text: 'Late 1', t: 2000 },
        widthPx: 300
      });

      expect(state.activeId).toBe('test#2');
      expect(state.metrics.lateRespawns).toBe(1);

      // Finalize the synthetic one
      state = captionReducer(state, {
        type: 'event',
        event: { type: 'finalize', id: 'test#2', userId: 'user1', text: 'Late 1 final', t: 2500 },
        widthPx: 300
      });

      // Another late update to original -> #3
      state = captionReducer(state, {
        type: 'event',
        event: { type: 'update', id: 'test', userId: 'user1', seq: 2, text: 'Late 2', t: 3000 },
        widthPx: 300
      });

      expect(state.activeId).toBe('test#3');
      expect(state.metrics.lateRespawns).toBe(2);
    });
  });

  describe('Auto-paging on Overflow', () => {
    it('should flip page when text would overflow', () => {
      const wouldOverflowFn = vi.fn().mockReturnValue(true);
      
      let state = captionReducer(initialState, {
        type: 'measurement_ready',
        widthPx: 200,
        wouldOverflowFn
      });

      const initialPageCount = state.pages.length;

      state = captionReducer(state, {
        type: 'event',
        event: {
          type: 'update',
          id: 'overflow_test',
          userId: 'user1',
          seq: 1,
          text: 'This is a very long text that should cause overflow',
          t: 1000
        },
        widthPx: 200,
        wouldOverflowFn
      });

      expect(state.pages.length).toBe(initialPageCount + 1);
      expect(state.metrics.pageFlips).toBe(1);
      expect(state.metrics.overflowPrevents).toBe(1);
      expect(wouldOverflowFn).toHaveBeenCalled();
    });

    it('should not flip page when text fits', () => {
      const wouldOverflowFn = vi.fn().mockReturnValue(false);
      
      let state = captionReducer(initialState, {
        type: 'measurement_ready',
        widthPx: 400,
        wouldOverflowFn
      });

      const initialPageCount = state.pages.length;

      state = captionReducer(state, {
        type: 'event',
        event: {
          type: 'update',
          id: 'no_overflow_test',
          userId: 'user1',
          seq: 1,
          text: 'Short text',
          t: 1000
        },
        widthPx: 400,
        wouldOverflowFn
      });

      expect(state.pages.length).toBe(initialPageCount);
      expect(state.metrics.pageFlips).toBe(0);
      expect(state.metrics.overflowPrevents).toBe(0);
    });
  });

  describe('Measurement Gating', () => {
    it('should queue updates when no measurement available', () => {
      const updateEvent: InEvt = {
        type: 'update',
        id: 'queued_test',
        userId: 'user1',
        seq: 1,
        text: 'Queued text',
        t: 1000
      };

      // Process update without measurement
      const state = captionReducer(initialState, {
        type: 'event',
        event: updateEvent,
        widthPx: 0 // No measurement
      });

      expect(state.queuedUpdates).toHaveLength(1);
      expect(state.queuedUpdates[0]).toEqual(updateEvent);
      
      // No segments should be created yet
      const allSegments = state.pages.flatMap(page => page.segments);
      expect(allSegments).toHaveLength(0);
    });

    it('should flush queued updates when measurement becomes available', () => {
      // Queue some updates
      let state = captionReducer(initialState, {
        type: 'event',
        event: {
          type: 'update',
          id: 'queue1',
          userId: 'user1',
          seq: 1,
          text: 'First queued',
          t: 1000
        },
        widthPx: 0
      });

      state = captionReducer(state, {
        type: 'event',
        event: {
          type: 'update',
          id: 'queue2',
          userId: 'user2',
          seq: 1,
          text: 'Second queued',
          t: 1100
        },
        widthPx: 0
      });

      expect(state.queuedUpdates).toHaveLength(2);
      expect(state.metrics.queueFlushes).toBe(0);

      // Measurement becomes available
      state = captionReducer(state, {
        type: 'measurement_ready',
        widthPx: 300
      });

      expect(state.queuedUpdates).toHaveLength(0);
      expect(state.metrics.queueFlushes).toBe(1);
      
      // Segments should now be created
      const allSegments = state.pages.flatMap(page => page.segments);
      expect(allSegments.length).toBeGreaterThan(0);
    });

    it('should respect queue size limit', () => {
      const config = { maxQueuedUpdates: 2 };
      
      let state = initialState;
      
      // Add more updates than the limit
      for (let i = 0; i < 5; i++) {
        state = captionReducer(state, {
          type: 'event',
          event: {
            type: 'update',
            id: `queue${i}`,
            userId: 'user1',
            seq: i + 1,
            text: `Queued ${i}`,
            t: 1000 + i * 100
          },
          widthPx: 0,
          config
        });
      }

      expect(state.queuedUpdates.length).toBeLessThanOrEqual(2);
    });
  });

  describe('Sequence Ordering', () => {
    it('should drop out-of-order updates', () => {
      let state = captionReducer(initialState, {
        type: 'measurement_ready',
        widthPx: 300
      });

      // Send updates in order
      state = captionReducer(state, {
        type: 'event',
        event: {
          type: 'update',
          id: 'seq_test',
          userId: 'user1',
          seq: 1,
          text: 'First',
          t: 1000
        },
        widthPx: 300
      });

      state = captionReducer(state, {
        type: 'event',
        event: {
          type: 'update',
          id: 'seq_test',
          userId: 'user1',
          seq: 3,
          text: 'Third',
          t: 1200
        },
        widthPx: 300
      });

      // Out of order update should be dropped
      state = captionReducer(state, {
        type: 'event',
        event: {
          type: 'update',
          id: 'seq_test',
          userId: 'user1',
          seq: 2,
          text: 'Second (late)',
          t: 1300
        },
        widthPx: 300
      });

      expect(state.metrics.droppedOutOfOrder).toBe(1);
      expect(state.lastSeq).toBe(3);
    });
  });

  describe('Finalization', () => {
    it('should mark segments as non-interim when finalized', () => {
      let state = captionReducer(initialState, {
        type: 'measurement_ready',
        widthPx: 300
      });

      state = captionReducer(state, {
        type: 'event',
        event: {
          type: 'update',
          id: 'final_test',
          userId: 'user1',
          seq: 1,
          text: 'Test text',
          t: 1000
        },
        widthPx: 300
      });

      // Verify interim state
      let segment = state.pages[0].segments.find(s => s.id === 'final_test');
      expect(segment?.interim).toBe(true);

      state = captionReducer(state, {
        type: 'event',
        event: {
          type: 'finalize',
          id: 'final_test',
          userId: 'user1',
          text: 'Final text',
          t: 1500
        },
        widthPx: 300
      });

      // Verify finalized state
      segment = state.pages[0].segments.find(s => s.id === 'final_test');
      expect(segment?.interim).toBe(false);
      expect(segment?.text).toBe('Final text');
      expect(state.finalizedIds.has('final_test')).toBe(true);
    });
  });
});
