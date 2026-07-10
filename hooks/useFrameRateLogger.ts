import { useEffect } from 'react';

const FPS_QUERY_PARAM = 'fps';
const FPS_STORAGE_KEY = 'sheetcanvas:fps-logger';
const LOG_INTERVAL_MS = 5000;
const OVERLAY_UPDATE_INTERVAL_MS = 1000;
const LONG_FRAME_THRESHOLD_MS = 50;

interface FrameRateMetrics {
  fps: number;
  averageFps: number;
  minFps: number;
  maxFps: number;
  frameCount: number;
  longFrameCount: number;
  worstFrameMs: number;
  startedAt: number;
  updatedAt: number;
}

declare global {
  interface Window {
    __sheetcanvasFps?: FrameRateMetrics;
  }
}

const isLoggerEnabled = () => {
  if (typeof window === 'undefined') return false;

  const params = new URLSearchParams(window.location.search);
  const queryValue = params.get(FPS_QUERY_PARAM);

  if (queryValue === '1' || queryValue === 'true') {
    window.localStorage.setItem(FPS_STORAGE_KEY, '1');
    return true;
  }

  if (queryValue === '0' || queryValue === 'false') {
    window.localStorage.removeItem(FPS_STORAGE_KEY);
    return false;
  }

  return window.localStorage.getItem(FPS_STORAGE_KEY) === '1';
};

const formatFps = (value: number) => value.toFixed(1);
const formatFrameMs = (value: number) => value.toFixed(1);

const createOverlay = () => {
  const overlay = document.createElement('div');
  overlay.setAttribute('data-sheetcanvas-fps-overlay', 'true');
  overlay.style.position = 'fixed';
  overlay.style.right = '12px';
  overlay.style.bottom = '12px';
  overlay.style.zIndex = '2147483647';
  overlay.style.pointerEvents = 'none';
  overlay.style.padding = '6px 8px';
  overlay.style.borderRadius = '8px';
  overlay.style.background = 'rgba(17, 24, 39, 0.82)';
  overlay.style.color = '#f9fafb';
  overlay.style.font = '11px/1.35 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
  overlay.style.boxShadow = '0 8px 24px rgba(0,0,0,0.22)';
  overlay.style.backdropFilter = 'blur(8px)';
  overlay.textContent = 'FPS: measuring...';
  document.body.appendChild(overlay);
  return overlay;
};

const updateOverlay = (overlay: HTMLDivElement, metrics: FrameRateMetrics) => {
  overlay.textContent = [
    `FPS ${formatFps(metrics.fps)}`,
    `avg ${formatFps(metrics.averageFps)}`,
    `min ${formatFps(metrics.minFps)}`,
    `worst ${formatFrameMs(metrics.worstFrameMs)}ms`,
  ].join('  ');
};

export const useFrameRateLogger = () => {
  useEffect(() => {
    if (!isLoggerEnabled()) {
      return;
    }

    let animationFrameId = 0;
    let frameCount = 0;
    let intervalFrameCount = 0;
    let longFrameCount = 0;
    let lastFrameAt = performance.now();
    let startedAt = lastFrameAt;
    let intervalStartedAt = lastFrameAt;
    let lastLogAt = lastFrameAt;
    let lastOverlayUpdateAt = lastFrameAt;
    let averageFps = 0;
    let sampleCount = 0;
    let minFps = Number.POSITIVE_INFINITY;
    let maxFps = 0;
    let worstFrameMs = 0;
    const overlay = createOverlay();

    console.info('[SheetCanvas FPS] Logger enabled. Use ?fps=0 to disable. Latest metrics are available at window.__sheetcanvasFps.');

    const publishMetrics = (now: number, fps: number) => {
      sampleCount += 1;
      averageFps += (fps - averageFps) / sampleCount;
      minFps = Math.min(minFps, fps);
      maxFps = Math.max(maxFps, fps);

      const metrics: FrameRateMetrics = {
        fps,
        averageFps,
        minFps,
        maxFps,
        frameCount,
        longFrameCount,
        worstFrameMs,
        startedAt,
        updatedAt: now,
      };
      window.__sheetcanvasFps = metrics;

      if (now - lastOverlayUpdateAt >= OVERLAY_UPDATE_INTERVAL_MS) {
        updateOverlay(overlay, metrics);
        lastOverlayUpdateAt = now;
      }

      if (now - lastLogAt >= LOG_INTERVAL_MS) {
        console.info(
          `[SheetCanvas FPS] current=${formatFps(fps)} avg=${formatFps(averageFps)} min=${formatFps(minFps)} max=${formatFps(maxFps)} worstFrame=${formatFrameMs(worstFrameMs)}ms longFrames=${longFrameCount} totalFrames=${frameCount}`,
        );
        lastLogAt = now;
      }
    };

    const measureFrame = (now: number) => {
      const frameDurationMs = now - lastFrameAt;
      lastFrameAt = now;
      frameCount += 1;
      intervalFrameCount += 1;

      if (frameDurationMs > LONG_FRAME_THRESHOLD_MS) {
        longFrameCount += 1;
      }
      worstFrameMs = Math.max(worstFrameMs, frameDurationMs);

      const intervalDurationMs = now - intervalStartedAt;
      if (intervalDurationMs >= OVERLAY_UPDATE_INTERVAL_MS) {
        const fps = (intervalFrameCount * 1000) / intervalDurationMs;
        publishMetrics(now, fps);
        intervalFrameCount = 0;
        intervalStartedAt = now;
      }

      animationFrameId = window.requestAnimationFrame(measureFrame);
    };

    animationFrameId = window.requestAnimationFrame(measureFrame);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      overlay.remove();
      delete window.__sheetcanvasFps;
    };
  }, []);
};
