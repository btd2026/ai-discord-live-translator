import { useCallback, useEffect, useReducer, useRef } from 'react';
import { InEvt, LaneState, CaptionConfig, LaneMetrics } from './types';
import { captionReducer, createInitialState, DEFAULT_CONFIG } from './reducer';
import { TextMeasurer, estimateCharsPerSecond } from './measure';

export interface CaptionHookResult {
  state: LaneState;
  dispatch: (event: InEvt) => void;
  metrics: LaneMetrics;
  setContainer: (container: HTMLElement | null) => void;
  getCurrentPageIndex: () => number;
  getTotalPages: () => number;
  goToPage: (index: number) => void;
  isOnLatestPage: () => boolean;
}

export function useCaptionReducer(config: CaptionConfig = {}): CaptionHookResult {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  const [state, dispatch] = useReducer(captionReducer, createInitialState());
  
  // Text measurement
  const measurerRef = useRef<TextMeasurer | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  const currentWidthRef = useRef<number>(0);
  
  // Timing and coalescing
  const coalescingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const finalizeTimerRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const measurementTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const recentEventsRef = useRef<Array<{text: string; t: number}>>([]);
  
  // Current page navigation
  const currentPageIndexRef = useRef<number>(0);
  
  // Initialize measurer
  useEffect(() => {
    if (!measurerRef.current) {
      measurerRef.current = new TextMeasurer();
    }
    
    return () => {
      if (measurerRef.current) {
        measurerRef.current.destroy();
        measurerRef.current = null;
      }
    };
  }, []);
  
  // Set up measurement callback
  useEffect(() => {
    if (!measurerRef.current) return;
    
    const unsubscribe = measurerRef.current.onMeasurement((result) => {
      currentWidthRef.current = result.widthPx;
      
      // Clear measurement timeout
      if (measurementTimeoutRef.current) {
        clearTimeout(measurementTimeoutRef.current);
        measurementTimeoutRef.current = null;
      }
      
      // Create overflow check function
      const wouldOverflowFn = (text: string) => {
        if (!measurerRef.current) return false;
        return measurerRef.current.wouldOverflow(
          text,
          result.widthPx,
          fullConfig.maxRowsPerPage,
          fullConfig.maxHeightPx
        );
      };
      
      dispatch({
        type: 'measurement_ready',
        widthPx: result.widthPx,
        wouldOverflowFn,
        config: fullConfig
      });
    });
    
    return unsubscribe;
  }, [fullConfig]);
  
  // Update current page index when state changes
  useEffect(() => {
    currentPageIndexRef.current = Math.max(0, state.pages.length - 1);
  }, [state.pages.length]);
  
  const setContainer = useCallback((container: HTMLElement | null) => {
    containerRef.current = container;
    if (measurerRef.current && container) {
      measurerRef.current.setContainer(container);
    }
  }, []);
  
  const adaptiveCoalesceMs = useCallback(() => {
    if (!fullConfig.adaptiveCoalescing) return fullConfig.coalesceMs;
    
    const charsPerSec = estimateCharsPerSecond(recentEventsRef.current);
    
    if (charsPerSec > fullConfig.fastThresholdCharsPerSec) {
      return fullConfig.maxCoalesceMs; // Slower updates for fast speech
    } else if (charsPerSec < fullConfig.slowThresholdCharsPerSec) {
      return fullConfig.minCoalesceMs; // Faster updates for slow speech
    }
    
    return fullConfig.coalesceMs;
  }, [fullConfig]);
  
  const processEventImmediate = useCallback((event: InEvt) => {
    // Update recent events for adaptive coalescing
    if (event.type === 'update') {
      recentEventsRef.current.push({ text: event.text, t: event.t });
      if (recentEventsRef.current.length > 20) {
        recentEventsRef.current = recentEventsRef.current.slice(-20);
      }
    }
    
    // Create overflow check function if we have a measurer
    let wouldOverflowFn: ((text: string) => boolean) | undefined;
    if (measurerRef.current && currentWidthRef.current > 0) {
      wouldOverflowFn = (text: string) => {
        if (!measurerRef.current) return false;
        return measurerRef.current.wouldOverflow(
          text,
          currentWidthRef.current,
          fullConfig.maxRowsPerPage,
          fullConfig.maxHeightPx
        );
      };
    }
    
    dispatch({
      type: 'event',
      event,
      widthPx: currentWidthRef.current,
      wouldOverflowFn,
      config: fullConfig
    });
    
    // Set measurement timeout if we don't have measurement yet
    if (currentWidthRef.current === 0 && !measurementTimeoutRef.current) {
      measurementTimeoutRef.current = setTimeout(() => {
        dispatch({
          type: 'measurement_timeout',
          config: fullConfig
        });
        measurementTimeoutRef.current = null;
      }, fullConfig.measureTimeoutMs);
    }
  }, [fullConfig]);
  
  const dispatchEvent = useCallback((event: InEvt) => {
    switch (event.type) {
      case 'caption':
        // Captions are processed immediately
        processEventImmediate(event);
        break;
        
      case 'update':
        // Updates are coalesced
        if (coalescingTimerRef.current) {
          clearTimeout(coalescingTimerRef.current);
        }
        
        coalescingTimerRef.current = setTimeout(() => {
          processEventImmediate(event);
          coalescingTimerRef.current = null;
        }, adaptiveCoalesceMs());
        break;
        
      case 'finalize':
        // Finalize is debounced by silence
        const timerId = finalizeTimerRef.current.get(event.id);
        if (timerId) {
          clearTimeout(timerId);
        }
        
        const newTimerId = setTimeout(() => {
          processEventImmediate(event);
          finalizeTimerRef.current.delete(event.id);
        }, fullConfig.silenceMsToFinalize);
        
        finalizeTimerRef.current.set(event.id, newTimerId);
        break;
    }
  }, [processEventImmediate, adaptiveCoalesceMs, fullConfig.silenceMsToFinalize]);
  
  const getCurrentPageIndex = useCallback(() => {
    return currentPageIndexRef.current;
  }, []);
  
  const getTotalPages = useCallback(() => {
    return state.pages.length;
  }, [state.pages.length]);
  
  const goToPage = useCallback((index: number) => {
    const maxIndex = state.pages.length - 1;
    currentPageIndexRef.current = Math.max(0, Math.min(index, maxIndex));
  }, [state.pages.length]);
  
  const isOnLatestPage = useCallback(() => {
    return currentPageIndexRef.current >= state.pages.length - 1;
  }, [state.pages.length]);
  
  const metrics: LaneMetrics = {
    ...state.metrics,
    avgCharsPerSec: estimateCharsPerSecond(recentEventsRef.current),
    currentCoalesceMs: adaptiveCoalesceMs()
  };
  
  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (coalescingTimerRef.current) {
        clearTimeout(coalescingTimerRef.current);
      }
      if (measurementTimeoutRef.current) {
        clearTimeout(measurementTimeoutRef.current);
      }
      finalizeTimerRef.current.forEach(timer => clearTimeout(timer));
      finalizeTimerRef.current.clear();
    };
  }, []);
  
  return {
    state,
    dispatch: dispatchEvent,
    metrics,
    setContainer,
    getCurrentPageIndex,
    getTotalPages,
    goToPage,
    isOnLatestPage
  };
}
