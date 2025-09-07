import { MeasurementResult } from './types';

export class TextMeasurer {
  private measureNode: HTMLDivElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private lastMeasurement: MeasurementResult | null = null;
  private callbacks: Array<(result: MeasurementResult) => void> = [];

  constructor(private container?: HTMLElement) {
    this.setupMeasureNode();
    this.setupResizeObserver();
  }

  private setupMeasureNode(): void {
    if (typeof document === 'undefined') return;

    this.measureNode = document.createElement('div');
    this.measureNode.style.cssText = `
      position: absolute;
      top: -9999px;
      left: -9999px;
      visibility: hidden;
      pointer-events: none;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      word-break: break-word;
      font-family: inherit;
      font-size: inherit;
      line-height: inherit;
      padding: 0;
      margin: 0;
      border: 0;
    `;
    document.body.appendChild(this.measureNode);
  }

  private setupResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined' || !this.container) return;

    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        if (width > 0) {
          this.updateContainerWidth(width);
        }
      }
    });

    if (this.container) {
      this.resizeObserver.observe(this.container);
    }
  }

  private updateContainerWidth(widthPx: number): void {
    const result: MeasurementResult = {
      widthPx,
      heightPx: 0,
      rowCount: 0
    };

    this.lastMeasurement = result;
    this.callbacks.forEach(cb => cb(result));
  }

  public setContainer(container: HTMLElement): void {
    if (this.resizeObserver && this.container) {
      this.resizeObserver.unobserve(this.container);
    }

    this.container = container;

    if (this.resizeObserver && container) {
      this.resizeObserver.observe(container);
      // Get initial measurement
      const rect = container.getBoundingClientRect();
      if (rect.width > 0) {
        this.updateContainerWidth(rect.width);
      }
    }
  }

  public onMeasurement(callback: (result: MeasurementResult) => void): () => void {
    this.callbacks.push(callback);

    // Fire immediately if we have a measurement
    if (this.lastMeasurement) {
      callback(this.lastMeasurement);
    }

    // Return unsubscribe function
    return () => {
      const index = this.callbacks.indexOf(callback);
      if (index > -1) {
        this.callbacks.splice(index, 1);
      }
    };
  }

  public measureText(
    text: string,
    widthPx: number,
    fontFamily: string = 'inherit',
    fontSize: string = 'inherit',
    lineHeight: string = 'inherit'
  ): MeasurementResult {
    if (!this.measureNode) {
      return { widthPx: 0, heightPx: 0, rowCount: 0 };
    }

    // Apply styles
    this.measureNode.style.width = `${widthPx}px`;
    this.measureNode.style.fontFamily = fontFamily;
    this.measureNode.style.fontSize = fontSize;
    this.measureNode.style.lineHeight = lineHeight;

    // Set text and measure
    this.measureNode.textContent = text;
    const height = this.measureNode.scrollHeight;
    const computedStyle = getComputedStyle(this.measureNode);
    const lineHeightPx = parseFloat(computedStyle.lineHeight) || parseFloat(computedStyle.fontSize) * 1.4;
    const rowCount = Math.ceil(height / lineHeightPx);

    return {
      widthPx,
      heightPx: height,
      rowCount
    };
  }

  public wouldOverflow(
    text: string,
    widthPx: number,
    maxRows?: number,
    maxHeightPx?: number,
    fontFamily?: string,
    fontSize?: string,
    lineHeight?: string
  ): boolean {
    const measurement = this.measureText(text, widthPx, fontFamily, fontSize, lineHeight);

    if (maxHeightPx && measurement.heightPx > maxHeightPx) {
      return true;
    }

    if (maxRows && measurement.rowCount > maxRows) {
      return true;
    }

    return false;
  }

  public getLastMeasurement(): MeasurementResult | null {
    return this.lastMeasurement;
  }

  public hasValidMeasurement(): boolean {
    return this.lastMeasurement !== null && this.lastMeasurement.widthPx > 0;
  }

  public destroy(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.measureNode && this.measureNode.parentNode) {
      this.measureNode.parentNode.removeChild(this.measureNode);
      this.measureNode = null;
    }

    this.callbacks = [];
    this.lastMeasurement = null;
  }
}

// Utility functions
export function createMeasurer(container?: HTMLElement): TextMeasurer {
  return new TextMeasurer(container);
}

export function sliceTextWithSoftBreaks(text: string, maxChars: number = 22): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + maxChars;
    
    if (end >= text.length) {
      chunks.push(text.slice(start));
      break;
    }

    // Try to break at a space near the end
    let breakPoint = end;
    for (let i = end; i > start + maxChars * 0.75; i--) {
      if (text[i] === ' ') {
        breakPoint = i;
        break;
      }
    }

    chunks.push(text.slice(start, breakPoint));
    start = breakPoint + (text[breakPoint] === ' ' ? 1 : 0); // Skip space
  }

  return chunks;
}

export function detectLanguage(text: string): string {
  // Simple heuristic language detection
  const french = /[àâäéèêëïîôöùûüÿç]/i;
  const spanish = /[áéíóúñü]/i;
  const german = /[äöüß]/i;
  
  if (french.test(text)) return 'fr';
  if (spanish.test(text)) return 'es';
  if (german.test(text)) return 'de';
  
  return 'en'; // default
}

export function estimateCharsPerSecond(events: Array<{text: string; t: number}>): number {
  if (events.length < 2) return 0;

  const recent = events.slice(-10); // Last 10 events
  if (recent.length < 2) return 0;

  const totalChars = recent.reduce((sum, ev) => sum + ev.text.length, 0);
  const timeSpanMs = recent[recent.length - 1].t - recent[0].t;
  
  if (timeSpanMs <= 0) return 0;
  
  return (totalChars / timeSpanMs) * 1000; // chars per second
}
