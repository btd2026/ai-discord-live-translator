// Core types for the live captions system
export type InEvt =
  | { type: 'caption'; id: string; userId: string; t: number; lang?: string }
  | { type: 'update'; id: string; userId: string; seq?: number; text: string; t: number; lang?: string }
  | { type: 'finalize'; id: string; userId: string; text?: string; t: number; lang?: string };

export interface Segment {
  id: string; // event id or synthetic "id#2", "id#3" etc
  text: string;
  interim: boolean;
  tStart: number;
  tLast: number;
  lang?: string;
  userId?: string;
}

export interface Page {
  id: string;
  widthPx: number;
  segments: Segment[];
  heightPx?: number;
}

export interface LaneState {
  pages: Page[];           // last = current page
  activeId?: string;
  lastSeq?: number;
  finalizedIds: Set<string>;
  queuedUpdates: InEvt[];  // buffered when no measurement available
  lastMeasureTime?: number;
  metrics: {
    pageFlips: number;
    lateRespawns: number;
    overflowPrevents: number;
    droppedOutOfOrder: number;
    queueFlushes: number;
  };
}

export interface CaptionConfig {
  silenceMsToFinalize?: number;     // 700ms default
  coalesceMs?: number;              // 100ms default (adaptive 80-150)
  maxRowsPerPage?: number;          // 3 default
  maxHeightPx?: number;             // 96px default (overrides rows if set)
  maxHistoryPages?: number;         // 5 default
  softBreakAfterChars?: number;     // 22 default
  measureTimeoutMs?: number;        // 250ms max wait for measurement
  maxQueuedUpdates?: number;        // 6 default
  conservativeWidthPx?: number;     // 180px fallback width
  adaptiveCoalescing?: boolean;     // true default
  minCoalesceMs?: number;           // 80ms default
  maxCoalesceMs?: number;           // 150ms default
  fastThresholdCharsPerSec?: number; // 14 default
  slowThresholdCharsPerSec?: number; // 8 default
}

export interface MeasurementResult {
  widthPx: number;
  heightPx: number;
  rowCount: number;
}

export interface LaneMetrics {
  pageFlips: number;
  lateRespawns: number;
  overflowPrevents: number;
  droppedOutOfOrder: number;
  queueFlushes: number;
  avgCharsPerSec?: number;
  currentCoalesceMs?: number;
}

// Language detection result
export interface LangDetection {
  lang: string;
  confidence: number;
}

// Paging state for UI
export interface PagingState {
  currentPageIndex: number;
  totalPages: number;
  canGoBack: boolean;
  canGoForward: boolean;
}
