# Live Captions

A resilient React component for live transcription with auto-paging, late-update recovery, and overflow handling. Designed for real-time speech transcription scenarios with messy, fast, or code-switching content.

## 🎯 Features

- **Never Stalls**: Auto-paging when content overflows, no dropped text
- **Late Update Recovery**: Handles updates that arrive after finalization with synthetic ID respawning
- **Adaptive Coalescing**: Adjusts update frequency based on speech rate (80-150ms)
- **Code-switching Support**: Seamless language transitions within utterances
- **Measurement Gating**: Queues updates until container width is measured
- **Accessible**: ARIA live regions and keyboard navigation
- **Performance Optimized**: Virtual paging and batched DOM updates

## 🚀 Quick Start

```bash
npm install live-captions
```

```tsx
import React from 'react';
import { CaptionLane, createCaptionEmitter } from 'live-captions';

function App() {
  const [emitter, setEmitter] = React.useState(null);
  
  const captionConfig = {
    silenceMsToFinalize: 700,    // Debounce finalize events
    maxRowsPerPage: 3,           // Auto-flip after 3 lines
    adaptiveCoalescing: true,    // Adjust speed based on speech rate
    conservativeWidthPx: 180     // Fallback width when measurement unavailable
  };

  React.useEffect(() => {
    // Hook up to your caption lane component
    const laneRef = React.useRef();
    if (laneRef.current) {
      const captionEmitter = createCaptionEmitter(
        (event) => {
          // Dispatch events to your caption lane
          laneRef.current.dispatch(event);
        },
        captionConfig
      );
      setEmitter(captionEmitter);
    }
  }, []);

  // Your STT integration
  React.useEffect(() => {
    if (!emitter) return;
    
    // Example STT integration
    speechRecognition.onstart = (userId) => {
      const eventId = generateEventId();
      emitter.emitCaption(eventId, userId);
    };
    
    speechRecognition.onresult = (eventId, userId, text, seq) => {
      emitter.emitUpdate(eventId, userId, text, seq);
    };
    
    speechRecognition.onend = (eventId, userId, finalText) => {
      emitter.emitFinalize(eventId, userId, finalText);
    };
  }, [emitter]);

  return (
    <div style={{ width: 320 }}>
      <CaptionLane
        config={captionConfig}
        showMetrics={true}
        showPager={true}
        className="my-captions"
      />
    </div>
  );
}
```

## 📋 API Reference

### `<CaptionLane>`

Main component for displaying live captions with auto-paging.

```tsx
interface CaptionLaneProps {
  config?: CaptionConfig;
  className?: string;
  showMetrics?: boolean;        // Show performance metrics
  showPager?: boolean;          // Show page navigation dots
  onPageChange?: (pageIndex: number, totalPages: number) => void;
  onMetricsUpdate?: (metrics: LaneMetrics) => void;
}
```

### `useCaptionReducer(config)`

Hook for managing caption state and events.

```tsx
const {
  state,              // Current lane state
  dispatch,           // Event dispatcher
  metrics,            // Performance metrics
  setContainer,       // Set measurement container
  getCurrentPageIndex,// Get current page index
  getTotalPages,      // Get total page count
  goToPage,          // Navigate to specific page
  isOnLatestPage     // Check if viewing latest page
} = useCaptionReducer(config);
```

### `createCaptionEmitter(dispatch, config)`

Creates an emitter for properly timed caption events.

```tsx
const emitter = createCaptionEmitter(dispatch, {
  coalesceMs: 100,              // Base coalesce time
  silenceMsToFinalize: 700,     // Finalize debounce time
  adaptiveCoalescing: true,     // Enable adaptive timing
  minCoalesceMs: 80,           // Min coalesce time (fast speech)
  maxCoalesceMs: 150,          // Max coalesce time (slow speech)
});

// Emit events
emitter.emitCaption(id, userId, lang?);
emitter.emitUpdate(id, userId, text, seq?, lang?);
emitter.emitFinalize(id, userId, text?, lang?);
```

## ⚙️ Configuration

### Core Config

```tsx
interface CaptionConfig {
  // Timing
  silenceMsToFinalize?: number;     // 700ms - Finalize debounce
  coalesceMs?: number;              // 100ms - Base update coalesce time
  measureTimeoutMs?: number;        // 250ms - Max wait for measurement
  
  // Layout
  maxRowsPerPage?: number;          // 3 - Rows before page flip
  maxHeightPx?: number;             // 96px - Height before page flip (overrides rows)
  maxHistoryPages?: number;         // 5 - Pages to keep in memory
  conservativeWidthPx?: number;     // 180px - Fallback width
  
  // Performance
  maxQueuedUpdates?: number;        // 6 - Max queued during measurement
  softBreakAfterChars?: number;     // 22 - Soft word break length
  
  // Adaptive behavior
  adaptiveCoalescing?: boolean;     // true - Adjust timing by speech rate
  minCoalesceMs?: number;           // 80ms - Fast speech timing
  maxCoalesceMs?: number;           // 150ms - Slow speech timing
  fastThresholdCharsPerSec?: number; // 14 - Fast speech threshold
  slowThresholdCharsPerSec?: number; // 8 - Slow speech threshold
}
```

### Tuning for Different Scenarios

**Fast Speakers (200+ WPM)**
```tsx
{
  maxCoalesceMs: 200,
  fastThresholdCharsPerSec: 16,
  maxRowsPerPage: 2,
  silenceMsToFinalize: 500
}
```

**Narrow Lanes (< 250px)**
```tsx
{
  maxRowsPerPage: 2,
  softBreakAfterChars: 15,
  conservativeWidthPx: 120,
  maxHeightPx: 60
}
```

**Multi-language Support**
```tsx
{
  // Language detection and switching is automatic
  // Just pass lang in your events when available
}
```

## 🧪 Testing Integration

### Replay Log Fixtures

```tsx
import { replayEvents } from 'live-captions';

// Replay captured events for testing
const events = [
  { type: 'caption', id: 'c_123', userId: 'user1', t: 1000 },
  { type: 'update', id: 'c_123', userId: 'user1', seq: 1, text: 'Hello', t: 1100 },
  { type: 'finalize', id: 'c_123', userId: 'user1', text: 'Hello world', t: 1800 },
  // Late update (should trigger respawn)
  { type: 'update', id: 'c_123', userId: 'user1', seq: 2, text: 'Hello world!', t: 2000 }
];

await replayEvents(events, dispatch, {
  speedMultiplier: 3,           // 3x speed
  preserveTiming: true,         // Keep relative timing
  onProgress: (done, total) => console.log(`${done}/${total}`)
});
```

### Unit Testing

```tsx
import { captionReducer, createInitialState } from 'live-captions';

test('should handle late updates with respawn', () => {
  let state = createInitialState();
  
  // Normal flow
  state = captionReducer(state, {
    type: 'event',
    event: { type: 'finalize', id: 'test', userId: 'user1', t: 1000 }
  });
  
  // Late update should trigger respawn
  state = captionReducer(state, {
    type: 'event', 
    event: { type: 'update', id: 'test', userId: 'user1', seq: 1, text: 'Late', t: 2000 }
  });
  
  expect(state.metrics.lateRespawns).toBe(1);
  expect(state.activeId).toBe('test#2');
});
```

## 📊 Monitoring & Metrics

The component exposes real-time metrics for monitoring:

```tsx
interface LaneMetrics {
  pageFlips: number;              // Auto-page flips due to overflow
  lateRespawns: number;           // Updates after finalize
  overflowPrevents: number;       // Successful overflow detection
  droppedOutOfOrder: number;      // Dropped sequence violations
  queueFlushes: number;           // Measurement gating flushes
  avgCharsPerSec?: number;        // Current speech rate
  currentCoalesceMs?: number;     // Current adaptive timing
}
```

### Success Criteria

- ✅ `lateRespawns > 0` for post-finalize scenarios
- ✅ `pageFlips > 0` for overflow scenarios  
- ✅ `droppedOutOfOrder = 0` for well-behaved sequences
- ✅ `queueFlushes > 0` when measurement delayed

## 🔧 Common Integration Patterns

### WebSocket Integration

```tsx
const emitter = createCaptionEmitter(dispatch);

websocket.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  switch (data.type) {
    case 'transcript_start':
      emitter.emitCaption(data.event_id, data.user_id, data.lang);
      break;
    case 'transcript_partial':
      emitter.emitUpdate(data.event_id, data.user_id, data.text, data.seq, data.lang);
      break;
    case 'transcript_final':
      emitter.emitFinalize(data.event_id, data.user_id, data.text, data.lang);
      break;
  }
};
```

### Browser Speech Recognition

```tsx
const recognition = new webkitSpeechRecognition();
recognition.continuous = true;
recognition.interimResults = true;

let currentEventId = null;

recognition.onstart = () => {
  currentEventId = generateEventId();
  emitter.emitCaption(currentEventId, 'local_user');
};

recognition.onresult = (event) => {
  const result = event.results[event.results.length - 1];
  const text = result[0].transcript;
  
  if (result.isFinal) {
    emitter.emitFinalize(currentEventId, 'local_user', text);
  } else {
    emitter.emitUpdate(currentEventId, 'local_user', text, event.results.length);
  }
};
```

### Error Boundaries

```tsx
import { ErrorBoundary } from 'react-error-boundary';

function CaptionErrorFallback({ error, resetErrorBoundary }) {
  return (
    <div className="caption-error">
      <p>Caption display error: {error.message}</p>
      <button onClick={resetErrorBoundary}>Retry</button>
    </div>
  );
}

<ErrorBoundary FallbackComponent={CaptionErrorFallback}>
  <CaptionLane config={config} />
</ErrorBoundary>
```

## 🎨 Styling

The component uses CSS modules. Override styles by targeting classes:

```css
/* Custom styling */
.my-captions {
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}

.my-captions .segment {
  font-family: 'Roboto Mono', monospace;
}

.my-captions .interim {
  color: #666;
  font-style: italic;
}

.my-captions .final {
  color: #000;
  font-weight: 600;
}
```

## 🐛 Troubleshooting

### Common Issues

**Stalled Updates**
- Check `metrics.queueFlushes` - indicates measurement delays
- Verify container has non-zero width
- Ensure `setContainer` is called with valid element

**Dropped Events**  
- Monitor `metrics.droppedOutOfOrder` for sequence issues
- Check event timestamps and sequence numbers
- Verify events arrive in monotonic order

**Poor Performance**
- Reduce `maxHistoryPages` if memory constrained
- Increase `coalesceMs` for high-frequency updates
- Disable `adaptiveCoalescing` if not needed

**Layout Issues**
- Set explicit container width
- Check CSS `white-space` and `overflow-wrap` settings
- Verify `maxRowsPerPage` matches your design

### Debug Mode

```tsx
<CaptionLane 
  config={{
    ...config,
    // Enable verbose logging
    debug: true
  }}
  showMetrics={true}
  onMetricsUpdate={(metrics) => {
    console.log('Caption metrics:', metrics);
  }}
/>
```

## 📄 License

MIT License - see LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Run tests: `npm test`
4. Commit changes: `git commit -m 'Add amazing feature'`
5. Push to branch: `git push origin feature/amazing-feature`
6. Open a Pull Request

### Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Run tests
npm test

# Run tests with UI
npm run test:ui

# Build package
npm run build
```
