import React, { useEffect, useRef, useState } from 'react';
import { useCaptionReducer, CaptionHookResult } from './useCaptionReducer';
import { CaptionConfig, Segment, Page } from './types';
import { detectLanguage } from './measure';
import styles from './CaptionLane.module.css';

export interface CaptionLaneProps {
  config?: CaptionConfig;
  className?: string;
  showMetrics?: boolean;
  showPager?: boolean;
  onPageChange?: (pageIndex: number, totalPages: number) => void;
  onMetricsUpdate?: (metrics: any) => void;
}

interface SegmentComponentProps {
  segment: Segment;
  showLangIndicator?: boolean;
}

const SegmentComponent: React.FC<SegmentComponentProps> = ({ segment, showLangIndicator = true }) => {
  const lang = segment.lang || detectLanguage(segment.text);
  const isTranslating = segment.interim && segment.text && !segment.text.trim();
  
  return (
    <span 
      className={`${styles.segment} ${segment.interim ? styles.interim : styles.final} ${isTranslating ? styles.translating : ''}`}
      data-segment-id={segment.id}
      data-lang={lang}
    >
      {showLangIndicator && lang !== 'en' && (
        <span className={`${styles.langIndicator} ${styles[lang] || ''}`}>
          {lang}
        </span>
      )}
      {segment.text}
      {isTranslating && (
        <span className={styles.translatingBadge}>
          Translating…
        </span>
      )}
    </span>
  );
};

interface PageComponentProps {
  page: Page;
  isActive: boolean;
  showLangIndicators?: boolean;
}

const PageComponent: React.FC<PageComponentProps> = ({ page, isActive, showLangIndicators = true }) => {
  return (
    <div 
      className={`${styles.pageContainer} ${isActive ? styles.active : styles.exiting}`}
      data-page-id={page.id}
    >
      <div className={styles.segmentsList}>
        {page.segments.map((segment, index) => (
          <React.Fragment key={`${segment.id}-${index}`}>
            <SegmentComponent 
              segment={segment} 
              showLangIndicator={showLangIndicators}
            />
            {index < page.segments.length - 1 && ' '}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

interface PagerProps {
  currentPageIndex: number;
  totalPages: number;
  onPageClick: (index: number) => void;
}

const Pager: React.FC<PagerProps> = ({ currentPageIndex, totalPages, onPageClick }) => {
  if (totalPages <= 1) return null;
  
  return (
    <div className={styles.pager}>
      {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
        const pageIndex = Math.max(0, totalPages - 5) + i;
        return (
          <button
            key={pageIndex}
            className={`${styles.pageIndicator} ${pageIndex === currentPageIndex ? styles.current : ''}`}
            onClick={() => onPageClick(pageIndex)}
            title={`Page ${pageIndex + 1}`}
            aria-label={`Go to page ${pageIndex + 1}`}
          />
        );
      })}
      <span className={styles.pageText}>
        {currentPageIndex + 1}/{totalPages}
      </span>
    </div>
  );
};

interface MetricsDisplayProps {
  metrics: any;
}

const MetricsDisplay: React.FC<MetricsDisplayProps> = ({ metrics }) => {
  return (
    <div className={styles.metrics}>
      P:{metrics.pageFlips} R:{metrics.lateRespawns} O:{metrics.overflowPrevents}
      {metrics.avgCharsPerSec && (
        <> | {metrics.avgCharsPerSec.toFixed(1)}c/s</>
      )}
    </div>
  );
};

export const CaptionLane: React.FC<CaptionLaneProps> = ({
  config,
  className = '',
  showMetrics = false,
  showPager = true,
  onPageChange,
  onMetricsUpdate
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [currentViewPageIndex, setCurrentViewPageIndex] = useState(0);
  
  const {
    state,
    dispatch,
    metrics,
    setContainer,
    getCurrentPageIndex,
    getTotalPages,
    goToPage,
    isOnLatestPage
  } = useCaptionReducer(config);
  
  // Set up container reference
  useEffect(() => {
    if (containerRef.current) {
      setContainer(containerRef.current);
    }
  }, [setContainer]);
  
  // Auto-follow latest page unless user has navigated away
  useEffect(() => {
    if (isOnLatestPage()) {
      const latestIndex = getTotalPages() - 1;
      if (latestIndex !== currentViewPageIndex) {
        setCurrentViewPageIndex(latestIndex);
        onPageChange?.(latestIndex, getTotalPages());
      }
    }
  }, [state.pages.length, isOnLatestPage, getTotalPages, currentViewPageIndex, onPageChange]);
  
  // Metrics callback
  useEffect(() => {
    onMetricsUpdate?.(metrics);
  }, [metrics, onMetricsUpdate]);
  
  const handlePageClick = (index: number) => {
    setCurrentViewPageIndex(index);
    goToPage(index);
    onPageChange?.(index, getTotalPages());
  };
  
  const currentPage = state.pages[currentViewPageIndex];
  
  if (!currentPage) {
    return (
      <div className={`${styles.captionLane} ${className}`} ref={containerRef}>
        <div className={styles.loadingState}>
          Waiting for captions...
        </div>
      </div>
    );
  }
  
  return (
    <div 
      className={`${styles.captionLane} ${className}`} 
      ref={containerRef}
      role="log"
      aria-live="polite"
      aria-label="Live captions"
    >
      <PageComponent 
        page={currentPage}
        isActive={true}
        showLangIndicators={true}
      />
      
      {showPager && (
        <Pager
          currentPageIndex={currentViewPageIndex}
          totalPages={getTotalPages()}
          onPageClick={handlePageClick}
        />
      )}
      
      {showMetrics && (
        <MetricsDisplay metrics={metrics} />
      )}
    </div>
  );
};

// Export the hook and types for external use
export { useCaptionReducer };
export type { CaptionHookResult, CaptionConfig };

export default CaptionLane;
