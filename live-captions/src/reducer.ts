import { InEvt, LaneState, Segment, Page, CaptionConfig } from './types';
import { detectLanguage, estimateCharsPerSecond } from './measure';

const DEFAULT_CONFIG: Required<CaptionConfig> = {
  silenceMsToFinalize: 700,
  coalesceMs: 100,
  maxRowsPerPage: 3,
  maxHeightPx: 96,
  maxHistoryPages: 5,
  softBreakAfterChars: 22,
  measureTimeoutMs: 250,
  maxQueuedUpdates: 6,
  conservativeWidthPx: 180,
  adaptiveCoalescing: true,
  minCoalesceMs: 80,
  maxCoalesceMs: 150,
  fastThresholdCharsPerSec: 14,
  slowThresholdCharsPerSec: 8,
};

function createInitialState(): LaneState {
  return {
    pages: [{
      id: generateId(),
      widthPx: 0,
      segments: []
    }],
    finalizedIds: new Set(),
    queuedUpdates: [],
    metrics: {
      pageFlips: 0,
      lateRespawns: 0,
      overflowPrevents: 0,
      droppedOutOfOrder: 0,
      queueFlushes: 0,
    }
  };
}

function generateId(): string {
  return `page_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function generateSyntheticId(originalId: string): string {
  const parts = originalId.split('#');
  const baseId = parts[0];
  const counter = parts.length > 1 ? parseInt(parts[1], 10) + 1 : 2;
  return `${baseId}#${counter}`;
}

function getCurrentPage(state: LaneState): Page {
  if (state.pages.length === 0) {
    state.pages.push({
      id: generateId(),
      widthPx: 0,
      segments: []
    });
  }
  return state.pages[state.pages.length - 1];
}

function flipPage(state: LaneState, widthPx: number): void {
  const newPage: Page = {
    id: generateId(),
    widthPx,
    segments: []
  };
  
  state.pages.push(newPage);
  state.metrics.pageFlips++;
  
  // Limit history
  const maxPages = 5; // from config
  if (state.pages.length > maxPages) {
    state.pages = state.pages.slice(-maxPages);
  }
}

function createSegment(event: InEvt, interim: boolean = true): Segment {
  return {
    id: event.id,
    text: event.type === 'update' ? event.text : '',
    interim,
    tStart: event.t,
    tLast: event.t,
    lang: event.lang,
    userId: event.userId
  };
}

function shouldDropOutOfOrder(state: LaneState, event: InEvt): boolean {
  if (event.type !== 'update' || !event.seq || !state.lastSeq) {
    return false;
  }
  
  // Drop if sequence number is not monotonic
  return event.seq <= state.lastSeq;
}

function handleCaption(state: LaneState, event: InEvt, config: Required<CaptionConfig>): LaneState {
  const newState = { ...state };
  
  // Caption starts a new utterance
  newState.activeId = event.id;
  newState.lastSeq = 0;
  
  // If we have queued updates, we might need to process them
  // But for caption, we typically just prepare for updates
  
  return newState;
}

function handleUpdate(
  state: LaneState, 
  event: InEvt, 
  config: Required<CaptionConfig>,
  measurementAvailable: boolean,
  currentWidthPx: number,
  wouldOverflowFn?: (text: string) => boolean
): LaneState {
  const newState = { ...state };
  
  if (event.type !== 'update') return newState;
  
  // Check for out-of-order
  if (shouldDropOutOfOrder(newState, event)) {
    newState.metrics.droppedOutOfOrder++;
    return newState;
  }
  
  // Check for late update after finalization
  if (newState.finalizedIds.has(event.id)) {
    // Auto-respawn with synthetic ID
    const syntheticId = generateSyntheticId(event.id);
    const syntheticEvent = { ...event, id: syntheticId };
    
    newState.metrics.lateRespawns++;
    newState.activeId = syntheticId;
    newState.lastSeq = event.seq || 0;
    
    // Process as new update
    return handleUpdate(newState, syntheticEvent, config, measurementAvailable, currentWidthPx, wouldOverflowFn);
  }
  
  // If no measurement available, queue the update
  if (!measurementAvailable) {
    newState.queuedUpdates.push(event);
    
    // Limit queue size
    if (newState.queuedUpdates.length > config.maxQueuedUpdates) {
      newState.queuedUpdates = newState.queuedUpdates.slice(-config.maxQueuedUpdates);
    }
    
    return newState;
  }
  
  // Process the update
  return processUpdate(newState, event, config, currentWidthPx, wouldOverflowFn);
}

function processUpdate(
  state: LaneState,
  event: InEvt,
  config: Required<CaptionConfig>,
  currentWidthPx: number,
  wouldOverflowFn?: (text: string) => boolean
): LaneState {
  const newState = { ...state };
  
  if (event.type !== 'update') return newState;
  
  const currentPage = getCurrentPage(newState);
  
  // Check if adding this text would overflow
  const candidateText = event.text;
  const willOverflow = wouldOverflowFn ? wouldOverflowFn(candidateText) : false;
  
  if (willOverflow) {
    flipPage(newState, currentWidthPx);
    newState.metrics.overflowPrevents++;
  }
  
  // Update or create segment
  const targetPage = getCurrentPage(newState);
  let segment = targetPage.segments.find(s => s.id === event.id);
  
  if (!segment) {
    segment = createSegment(event, true);
    targetPage.segments.push(segment);
  } else {
    segment.text = event.text;
    segment.tLast = event.t;
    segment.lang = event.lang || segment.lang;
  }
  
  newState.activeId = event.id;
  newState.lastSeq = event.seq || newState.lastSeq;
  
  return newState;
}

function handleFinalize(state: LaneState, event: InEvt, config: Required<CaptionConfig>): LaneState {
  const newState = { ...state };
  
  // Mark as finalized
  newState.finalizedIds.add(event.id);
  
  // Find and update the segment
  for (const page of newState.pages) {
    const segment = page.segments.find(s => s.id === event.id);
    if (segment) {
      segment.interim = false;
      segment.tLast = event.t;
      
      // Update text if provided
      if (event.type === 'finalize' && event.text !== undefined) {
        segment.text = event.text;
      }
      
      break;
    }
  }
  
  return newState;
}

function flushQueuedUpdates(
  state: LaneState,
  config: Required<CaptionConfig>,
  currentWidthPx: number,
  wouldOverflowFn?: (text: string) => boolean
): LaneState {
  if (state.queuedUpdates.length === 0) return state;
  
  let newState = { ...state };
  newState.queuedUpdates = [];
  newState.metrics.queueFlushes++;
  
  // Process all queued updates
  for (const queuedEvent of state.queuedUpdates) {
    newState = processUpdate(newState, queuedEvent, config, currentWidthPx, wouldOverflowFn);
  }
  
  return newState;
}

export function captionReducer(
  state: LaneState,
  action: {
    type: 'event' | 'measurement_ready' | 'measurement_timeout';
    event?: InEvt;
    widthPx?: number;
    wouldOverflowFn?: (text: string) => boolean;
    config?: CaptionConfig;
  }
): LaneState {
  const config = { ...DEFAULT_CONFIG, ...(action.config || {}) };
  
  switch (action.type) {
    case 'event': {
      if (!action.event) return state;
      
      const measurementAvailable = state.lastMeasureTime !== undefined;
      const currentWidthPx = action.widthPx || config.conservativeWidthPx;
      
      switch (action.event.type) {
        case 'caption':
          return handleCaption(state, action.event, config);
        
        case 'update':
          return handleUpdate(
            state, 
            action.event, 
            config, 
            measurementAvailable, 
            currentWidthPx, 
            action.wouldOverflowFn
          );
        
        case 'finalize':
          return handleFinalize(state, action.event, config);
        
        default:
          return state;
      }
    }
    
    case 'measurement_ready': {
      const newState = { 
        ...state, 
        lastMeasureTime: Date.now() 
      };
      
      // Update current page width
      const currentPage = getCurrentPage(newState);
      if (action.widthPx) {
        currentPage.widthPx = action.widthPx;
      }
      
      // Flush any queued updates
      return flushQueuedUpdates(
        newState, 
        config, 
        action.widthPx || config.conservativeWidthPx, 
        action.wouldOverflowFn
      );
    }
    
    case 'measurement_timeout': {
      // Force flush with conservative width
      const newState = { 
        ...state, 
        lastMeasureTime: Date.now() 
      };
      
      return flushQueuedUpdates(
        newState, 
        config, 
        config.conservativeWidthPx, 
        action.wouldOverflowFn
      );
    }
    
    default:
      return state;
  }
}

export { createInitialState, DEFAULT_CONFIG };
