import { useStore } from '../../store';
import { CELL_WIDTH, CELL_HEIGHT, HEADER_COL_WIDTH, HEADER_ROW_HEIGHT } from '../../constants';
import type { ChartData, NoteData, SheetData } from '../../types';

const FOCUS_PADDING_PX = 60;
// Keep scale within a comfortable viewing range when framing agent output.
const AGENT_FOCUS_MIN_SCALE = 0.2;
const AGENT_FOCUS_MAX_SCALE = 1.5;

interface CanvasRect { x: number; y: number; width: number; height: number }

// Accumulates rects for all objects touched in one agent turn.
// Cleared after flushAgentFocus() — module-level because both the in-app
// Copilot and the MCP bridge share executeClientTool as a chokepoint.
let pendingRects: CanvasRect[] = [];

export function accumulateSheetFocus(sheet: SheetData): void {
  pendingRects.push({
    x: sheet.position.x,
    y: sheet.position.y,
    width: sheet.size.width * CELL_WIDTH + HEADER_COL_WIDTH,
    height: sheet.size.height * CELL_HEIGHT + HEADER_ROW_HEIGHT,
  });
}

export function accumulateChartFocus(chart: ChartData): void {
  pendingRects.push({
    x: chart.position.x,
    y: chart.position.y,
    width: chart.size.width,
    height: chart.size.height,
  });
}

export function accumulateNoteFocus(note: NoteData): void {
  // A note's size is already in pixels, so its rect is position + size directly.
  pendingRects.push({
    x: note.position.x,
    y: note.position.y,
    width: note.size.width,
    height: note.size.height,
  });
}

/**
 * Unions all accumulated rects, zooms to fit the combined bounding box,
 * and hard-centers it in the viewport. No-op if nothing was accumulated.
 * Should be called once per agent turn (on turn-end for the Copilot,
 * debounced for the MCP bridge which has no turn boundary).
 */
export function flushAgentFocus(): void {
  if (pendingRects.length === 0) return;
  if (typeof window === 'undefined') return;

  const rects = pendingRects;
  pendingRects = [];

  // Union all rects into one bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }

  const totalWidth = maxX - minX;
  const totalHeight = maxY - minY;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  // Scale to fit with padding, clamped to avoid extremes
  const scaleToFit = Math.min(
    (viewportW - FOCUS_PADDING_PX * 2) / totalWidth,
    (viewportH - FOCUS_PADDING_PX * 2) / totalHeight,
  );
  const scale = Math.max(AGENT_FOCUS_MIN_SCALE, Math.min(AGENT_FOCUS_MAX_SCALE, scaleToFit));

  // Hard-center the bounding box
  const bboxCenterX = minX + totalWidth / 2;
  const bboxCenterY = minY + totalHeight / 2;

  useStore.getState().setTransform({
    scale,
    offset: {
      x: viewportW / 2 - bboxCenterX * scale,
      y: viewportH / 2 - bboxCenterY * scale,
    },
  });
}
