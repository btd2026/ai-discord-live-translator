import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TextMeasurer, sliceTextWithSoftBreaks, detectLanguage, estimateCharsPerSecond } from '../src/measure';

// Mock DOM APIs for testing
Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })),
});

Object.defineProperty(document, 'createElement', {
  writable: true,
  value: vi.fn().mockImplementation((tagName: string) => {
    const element = {
      style: {},
      textContent: '',
      scrollHeight: 50,
      parentNode: null,
      appendChild: vi.fn(),
      removeChild: vi.fn()
    };
    
    if (tagName === 'div') {
      Object.defineProperty(element, 'scrollHeight', {
        get() {
          // Simple mock: return height based on text length
          const textLength = this.textContent?.length || 0;
          return Math.ceil(textLength / 20) * 20; // 20px per line, ~20 chars per line
        }
      });
    }
    
    return element;
  })
});

Object.defineProperty(document, 'body', {
  writable: true,
  value: {
    appendChild: vi.fn(),
    removeChild: vi.fn()
  }
});

// Mock getComputedStyle
Object.defineProperty(window, 'getComputedStyle', {
  writable: true,
  value: vi.fn().mockReturnValue({
    lineHeight: '20px',
    fontSize: '16px'
  })
});

describe('TextMeasurer', () => {
  let measurer: TextMeasurer;

  beforeEach(() => {
    vi.clearAllMocks();
    measurer = new TextMeasurer();
  });

  afterEach(() => {
    measurer.destroy();
  });

  describe('Text Measurement', () => {
    it('should measure text dimensions', () => {
      const result = measurer.measureText('Hello world', 200);
      
      expect(result.widthPx).toBe(200);
      expect(result.heightPx).toBeGreaterThan(0);
      expect(result.rowCount).toBeGreaterThan(0);
    });

    it('should calculate correct row count', () => {
      // Short text should be 1 row
      const shortResult = measurer.measureText('Hi', 200);
      expect(shortResult.rowCount).toBe(1);
      
      // Longer text should be multiple rows
      const longResult = measurer.measureText('This is a very long text that should span multiple rows when constrained to a narrow width', 200);
      expect(longResult.rowCount).toBeGreaterThan(1);
    });

    it('should detect overflow correctly', () => {
      // Text that should fit
      const fitsResult = measurer.wouldOverflow('Short text', 400, 3);
      expect(fitsResult).toBe(false);
      
      // Text that should overflow by height
      const overflowResult = measurer.wouldOverflow('Very long text that should definitely overflow when constrained to very few rows and narrow width', 100, 1);
      expect(overflowResult).toBe(true);
    });

    it('should respect maxHeightPx constraint', () => {
      const overflowResult = measurer.wouldOverflow('Long text content', 200, undefined, 15);
      // Should overflow because height > 15px
      expect(overflowResult).toBe(true);
    });
  });

  describe('Measurement Callbacks', () => {
    it('should call measurement callbacks', () => {
      const callback = vi.fn();
      const unsubscribe = measurer.onMeasurement(callback);
      
      // Simulate container size change
      measurer.setContainer({
        getBoundingClientRect: () => ({ width: 300, height: 100 })
      } as HTMLElement);
      
      // Should call callback with measurement
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          widthPx: 300
        })
      );
      
      unsubscribe();
    });

    it('should provide unsubscribe function', () => {
      const callback = vi.fn();
      const unsubscribe = measurer.onMeasurement(callback);
      
      unsubscribe();
      
      // After unsubscribe, callback should not be called
      measurer.setContainer({
        getBoundingClientRect: () => ({ width: 400, height: 100 })
      } as HTMLElement);
      
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('Cleanup', () => {
    it('should cleanup properly', () => {
      const mockElement = {
        parentNode: { removeChild: vi.fn() }
      };
      
      measurer['measureNode'] = mockElement as any;
      measurer.destroy();
      
      expect(mockElement.parentNode.removeChild).toHaveBeenCalledWith(mockElement);
    });
  });
});

describe('Text Utility Functions', () => {
  describe('sliceTextWithSoftBreaks', () => {
    it('should slice long text at safe boundaries', () => {
      const longText = 'This is a very long sentence without breaks';
      const chunks = sliceTextWithSoftBreaks(longText, 10);
      
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.every(chunk => chunk.length <= 10 || chunk.includes(' '))).toBe(true);
    });

    it('should prefer word boundaries', () => {
      const text = 'Hello world how are you';
      const chunks = sliceTextWithSoftBreaks(text, 12);
      
      // Should break at spaces when possible
      expect(chunks[0]).toBe('Hello world');
    });

    it('should handle text shorter than max', () => {
      const shortText = 'Hi';
      const chunks = sliceTextWithSoftBreaks(shortText, 10);
      
      expect(chunks).toEqual(['Hi']);
    });

    it('should handle text with no spaces', () => {
      const noSpaces = 'verylongtextwithoutanyspaces';
      const chunks = sliceTextWithSoftBreaks(noSpaces, 8);
      
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.every(chunk => chunk.length <= 8)).toBe(true);
    });
  });

  describe('detectLanguage', () => {
    it('should detect French', () => {
      expect(detectLanguage('Bonjour, ça va?')).toBe('fr');
      expect(detectLanguage('Hôtel français')).toBe('fr');
    });

    it('should detect Spanish', () => {
      expect(detectLanguage('Hola, ¿cómo estás?')).toBe('es');
      expect(detectLanguage('Niño pequeño')).toBe('es');
    });

    it('should detect German', () => {
      expect(detectLanguage('Guten Tag, wie geht\'s?')).toBe('de');
      expect(detectLanguage('Größe')).toBe('de');
    });

    it('should default to English', () => {
      expect(detectLanguage('Hello world')).toBe('en');
      expect(detectLanguage('Regular text')).toBe('en');
    });
  });

  describe('estimateCharsPerSecond', () => {
    it('should calculate chars per second', () => {
      const events = [
        { text: 'Hello', t: 1000 },
        { text: 'Hello world', t: 1200 },
        { text: 'Hello world!', t: 1400 }
      ];
      
      const rate = estimateCharsPerSecond(events);
      expect(rate).toBeGreaterThan(0);
    });

    it('should return 0 for insufficient data', () => {
      expect(estimateCharsPerSecond([])).toBe(0);
      expect(estimateCharsPerSecond([{ text: 'Hi', t: 1000 }])).toBe(0);
    });

    it('should handle zero time span', () => {
      const events = [
        { text: 'Hello', t: 1000 },
        { text: 'World', t: 1000 }
      ];
      
      expect(estimateCharsPerSecond(events)).toBe(0);
    });

    it('should use recent events only', () => {
      const events = Array.from({ length: 15 }, (_, i) => ({
        text: `Event ${i}`,
        t: 1000 + i * 100
      }));
      
      const rate = estimateCharsPerSecond(events);
      expect(rate).toBeGreaterThan(0);
      // Should only consider last 10 events
    });
  });
});
