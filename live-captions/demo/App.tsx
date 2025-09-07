import React, { useState, useEffect, useCallback } from 'react';
import { CaptionLane, createCaptionEmitter, replayEvents } from '../src';
import type { InEvt, LaneMetrics } from '../src';
import './App.css';

// Sample log data that simulates the problematic patterns from your logs
const SAMPLE_EVENTS: InEvt[] = [
  // Normal flow
  { type: 'caption', id: 'c_1755722773051_140356', userId: 'brian', t: 1640995580641 },
  { type: 'update', id: 'c_1755722773051_140356', userId: 'brian', seq: 1, text: 'Hello', t: 1640995580700 },
  { type: 'update', id: 'c_1755722773051_140356', userId: 'brian', seq: 2, text: 'Hello there', t: 1640995580800 },
  { type: 'update', id: 'c_1755722773051_140356', userId: 'brian', seq: 3, text: 'Hello there how are you doing today?', t: 1640995580900 },
  { type: 'finalize', id: 'c_1755722773051_140356', userId: 'brian', text: 'Hello there how are you doing today?', t: 1640995581641 },
  
  // Late updates after finalize (problematic case)
  { type: 'update', id: 'c_1755722773051_140356', userId: 'brian', seq: 4, text: 'Hello there how are you doing today? I hope', t: 1640995583578 },
  { type: 'update', id: 'c_1755722773051_140356', userId: 'brian', seq: 5, text: 'Hello there how are you doing today? I hope you are', t: 1640995584585 },
  
  // Very long text that should trigger overflow
  { type: 'caption', id: 'c_overflow_test', userId: 'alice', t: 1640995590000 },
  { type: 'update', id: 'c_overflow_test', userId: 'alice', seq: 1, text: 'This is a very long sentence that should definitely trigger an overflow when the lane width is narrow and should cause the system to flip to a new page automatically without dropping any content or causing any rendering issues', t: 1640995590100 },
  
  // Code-switching (English to French)
  { type: 'caption', id: 'c_codeswitching', userId: 'marie', t: 1640995600000, lang: 'en' },
  { type: 'update', id: 'c_codeswitching', userId: 'marie', seq: 1, text: 'Let me explain this in français', t: 1640995600100, lang: 'en' },
  { type: 'update', id: 'c_codeswitching', userId: 'marie', seq: 2, text: 'Let me explain this in français - voici comment ça marche', t: 1640995600200, lang: 'fr' },
  { type: 'finalize', id: 'c_codeswitching', userId: 'marie', text: 'Let me explain this in français - voici comment ça marche parfaitement', t: 1640995601000, lang: 'fr' },
  
  // High WPM burst (fast speech)
  { type: 'caption', id: 'c_fast_speech', userId: 'speed_talker', t: 1640995610000 },
  { type: 'update', id: 'c_fast_speech', userId: 'speed_talker', seq: 1, text: 'Quick', t: 1640995610050 },
  { type: 'update', id: 'c_fast_speech', userId: 'speed_talker', seq: 2, text: 'Quick brown', t: 1640995610100 },
  { type: 'update', id: 'c_fast_speech', userId: 'speed_talker', seq: 3, text: 'Quick brown fox', t: 1640995610150 },
  { type: 'update', id: 'c_fast_speech', userId: 'speed_talker', seq: 4, text: 'Quick brown fox jumps', t: 1640995610200 },
  { type: 'update', id: 'c_fast_speech', userId: 'speed_talker', seq: 5, text: 'Quick brown fox jumps over', t: 1640995610250 },
  { type: 'update', id: 'c_fast_speech', userId: 'speed_talker', seq: 6, text: 'Quick brown fox jumps over the', t: 1640995610300 },
  { type: 'update', id: 'c_fast_speech', userId: 'speed_talker', seq: 7, text: 'Quick brown fox jumps over the lazy', t: 1640995610350 },
  { type: 'update', id: 'c_fast_speech', userId: 'speed_talker', seq: 8, text: 'Quick brown fox jumps over the lazy dog', t: 1640995610400 },
  { type: 'finalize', id: 'c_fast_speech', userId: 'speed_talker', text: 'Quick brown fox jumps over the lazy dog and runs away', t: 1640995611100 },
];

const NARROW_LANE_EVENTS: InEvt[] = [
  { type: 'caption', id: 'narrow_test', userId: 'test_user', t: 1640995620000 },
  { type: 'update', id: 'narrow_test', userId: 'test_user', seq: 1, text: 'Testing narrow lane with very long words that should definitely wrap or overflow and trigger automatic page flipping behavior', t: 1640995620100 },
  { type: 'update', id: 'narrow_test', userId: 'test_user', seq: 2, text: 'Testing narrow lane with very long words that should definitely wrap or overflow and trigger automatic page flipping behavior. Additional content to make it even longer and test multiple page flips.', t: 1640995620200 },
  { type: 'finalize', id: 'narrow_test', userId: 'test_user', text: 'Testing narrow lane with very long words that should definitely wrap or overflow and trigger automatic page flipping behavior. Additional content to make it even longer and test multiple page flips. Final version with even more content.', t: 1640995621000 },
];

const App: React.FC = () => {
  const [selectedWidth, setSelectedWidth] = useState<number>(320);
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayProgress, setReplayProgress] = useState(0);
  const [currentDataset, setCurrentDataset] = useState<'sample' | 'narrow'>('sample');
  const [metrics, setMetrics] = useState<LaneMetrics | null>(null);
  const [emitterRef, setEmitterRef] = useState<any>(null);

  const captionConfig = {
    silenceMsToFinalize: 700,
    coalesceMs: 100,
    maxRowsPerPage: 3,
    maxHeightPx: 96,
    adaptiveCoalescing: true,
    measureTimeoutMs: 250,
    conservativeWidthPx: Math.min(180, selectedWidth)
  };

  const handleReplay = useCallback(async (events: InEvt[]) => {
    if (!emitterRef) return;
    
    setIsReplaying(true);
    setReplayProgress(0);
    
    try {
      await replayEvents(events, emitterRef.dispatch, {
        speedMultiplier: 3, // 3x speed for demo
        preserveTiming: true,
        batchSize: 5,
        onProgress: (processed, total) => {
          setReplayProgress((processed / total) * 100);
        }
      });
    } catch (error) {
      console.error('Replay failed:', error);
    } finally {
      setIsReplaying(false);
      setReplayProgress(0);
    }
  }, [emitterRef]);

  const handleManualEvent = useCallback(() => {
    if (!emitterRef) return;
    
    const id = `manual_${Date.now()}`;
    emitterRef.emitCaption(id, 'manual_user');
    
    setTimeout(() => {
      emitterRef.emitUpdate(id, 'manual_user', 'This is a manually triggered event', 1);
    }, 200);
    
    setTimeout(() => {
      emitterRef.emitUpdate(id, 'manual_user', 'This is a manually triggered event with more content', 2);
    }, 600);
    
    setTimeout(() => {
      emitterRef.emitFinalize(id, 'manual_user', 'This is a manually triggered event with more content - finalized');
    }, 1200);
  }, [emitterRef]);

  const stats = emitterRef?.getStats() || {
    eventsEmitted: 0,
    updatesCoalesced: 0,
    finalizesDebounced: 0,
    avgCoalesceMs: 0
  };

  return (
    <div className="app">
      <div className="header">
        <h1>Live Captions Demo</h1>
        <p>Testing resilient transcription UI with auto-paging and late-update recovery</p>
      </div>

      <div className="controls">
        <div className="control-group">
          <label>
            Lane Width:
            <select value={selectedWidth} onChange={(e) => setSelectedWidth(Number(e.target.value))}>
              <option value={180}>Narrow (180px)</option>
              <option value={220}>Small (220px)</option>
              <option value={320}>Medium (320px)</option>
              <option value={480}>Wide (480px)</option>
              <option value={640}>Extra Wide (640px)</option>
            </select>
          </label>
        </div>

        <div className="control-group">
          <label>
            Test Dataset:
            <select value={currentDataset} onChange={(e) => setCurrentDataset(e.target.value as 'sample' | 'narrow')}>
              <option value="sample">Standard Tests</option>
              <option value="narrow">Narrow Lane Tests</option>
            </select>
          </label>
        </div>

        <div className="control-group">
          <button 
            onClick={() => handleReplay(currentDataset === 'sample' ? SAMPLE_EVENTS : NARROW_LANE_EVENTS)}
            disabled={isReplaying}
          >
            {isReplaying ? `Replaying... ${replayProgress.toFixed(0)}%` : 'Replay Events'}
          </button>
          
          <button onClick={handleManualEvent} disabled={isReplaying}>
            Manual Event
          </button>
        </div>
      </div>

      <div className="demo-container">
        <div className="lane-container" style={{ width: selectedWidth }}>
          <CaptionLane
            config={captionConfig}
            showMetrics={true}
            showPager={true}
            onMetricsUpdate={setMetrics}
            className="demo-lane"
          />
        </div>

        <div className="metrics-panel">
          <h3>Metrics</h3>
          <div className="metric-grid">
            <div className="metric">
              <span className="metric-label">Page Flips:</span>
              <span className="metric-value">{metrics?.pageFlips || 0}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Late Respawns:</span>
              <span className="metric-value">{metrics?.lateRespawns || 0}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Overflow Prevents:</span>
              <span className="metric-value">{metrics?.overflowPrevents || 0}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Queue Flushes:</span>
              <span className="metric-value">{metrics?.queueFlushes || 0}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Avg Chars/Sec:</span>
              <span className="metric-value">{metrics?.avgCharsPerSec?.toFixed(1) || '0.0'}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Current Coalesce:</span>
              <span className="metric-value">{metrics?.currentCoalesceMs || 0}ms</span>
            </div>
          </div>

          <h4>Emitter Stats</h4>
          <div className="metric-grid">
            <div className="metric">
              <span className="metric-label">Events Emitted:</span>
              <span className="metric-value">{stats.eventsEmitted}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Updates Coalesced:</span>
              <span className="metric-value">{stats.updatesCoalesced}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Finalizes Debounced:</span>
              <span className="metric-value">{stats.finalizesDebounced}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="info-panel">
        <h3>Test Scenarios</h3>
        <ul>
          <li><strong>Late Updates:</strong> Events continue after finalize (should auto-respawn with #2, #3, etc.)</li>
          <li><strong>Overflow Handling:</strong> Long text should trigger page flips, not drops</li>
          <li><strong>Code-switching:</strong> Language changes mid-utterance should be handled gracefully</li>
          <li><strong>Fast Speech:</strong> High WPM bursts should use adaptive coalescing</li>
          <li><strong>Narrow Lanes:</strong> Width constraints should trigger more frequent page flips</li>
        </ul>
        
        <h4>Success Criteria:</h4>
        <ul>
          <li>✅ Zero dropped events</li>
          <li>✅ Page flips &gt; 0 for overflow scenarios</li>
          <li>✅ Late respawns &gt; 0 for post-finalize updates</li>
          <li>✅ No stalls or infinite loops</li>
          <li>✅ Smooth adaptive coalescing based on speech rate</li>
        </ul>
      </div>
    </div>
  );
};

export default App;
