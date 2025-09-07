// Main exports for the live-captions package
export { CaptionLane as default, CaptionLane } from './CaptionLane';
export { useCaptionReducer } from './useCaptionReducer';
export { createCaptionEmitter, replayEvents, CaptionEmitter } from './emitter';
export { TextMeasurer, createMeasurer, sliceTextWithSoftBreaks, detectLanguage, estimateCharsPerSecond } from './measure';
export { captionReducer, createInitialState, DEFAULT_CONFIG } from './reducer';

// Type exports
export type {
  InEvt,
  Segment,
  Page,
  LaneState,
  CaptionConfig,
  MeasurementResult,
  LaneMetrics,
  PagingState
} from './types';

export type { CaptionHookResult } from './useCaptionReducer';
export type { EmitterConfig, EmitterStats } from './emitter';
