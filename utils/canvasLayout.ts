// Single source of truth for where a newly-created canvas object lands.
//
// Layout model (a 2D grid, read like a table: each ROW is one data source and
// its outputs):
//   - Originals  (data sources: connector sheets, typed/imported/blank sheets)
//     stack DOWN in a left-aligned column. New original -> bottom of the canvas.
//   - Derivatives (charts, pivot tables, sparkline tables — anything built FROM
//     a source) flow RIGHT along their source's row. New derivative -> right end
//     of that row, so siblings cascade instead of overlapping, and a
//     chart-of-a-pivot continues the same row (derivation chains flow right).
//   - Notes float free: agent-created notes default to the far right of the
//     canvas so they never sit inside the grid; the user can drag them anywhere.
//
// Every creation path (agent tools + human toolbar/import/paste) routes through
// here so the canvas behaves identically regardless of who added the object.
// Placement reads LIVE positions, so it adapts to manual drags and each call
// sees objects added earlier in the same turn.

import type { SheetData, ChartData, NoteData } from '../types';
import { CELL_WIDTH, CELL_HEIGHT, HEADER_COL_WIDTH, HEADER_ROW_HEIGHT } from '../constants';

export interface Position {
  x: number;
  y: number;
}

// Minimal read-only view of the canvas the layout math needs. Both the Zustand
// store state and App-local state satisfy this shape.
export interface CanvasSnapshot {
  sheets: Record<string, SheetData>;
  charts: Record<string, ChartData>;
  notes: Record<string, NoteData>;
}

// Gaps between objects, in canvas (unscaled) pixels.
const DERIVATIVE_GAP = 60; // horizontal, between a source and its derivative
const ORIGINAL_GAP = 100; // vertical, between stacked originals
const NOTE_GAP = 60; // horizontal, to the right of everything

// Fallback spot on a truly empty canvas when the caller gives no viewport hint.
const EMPTY_FALLBACK: Position = { x: 200, y: 200 };

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const sheetPixelWidth = (s: SheetData): number => s.size.width * CELL_WIDTH + HEADER_COL_WIDTH;
const sheetPixelHeight = (s: SheetData): number => s.size.height * CELL_HEIGHT + HEADER_ROW_HEIGHT;

const sheetBox = (s: SheetData): Box => ({
  left: s.position.x,
  top: s.position.y,
  right: s.position.x + sheetPixelWidth(s),
  bottom: s.position.y + sheetPixelHeight(s),
});

const rectBox = (o: ChartData | NoteData): Box => ({
  left: o.position.x,
  top: o.position.y,
  right: o.position.x + o.size.width,
  bottom: o.position.y + o.size.height,
});

/** True for a data source (not a pivot/sparkline table). Connector sheets count. */
export const isOriginalSheet = (s: SheetData): boolean => !s.pivotConfig && !s.sparklineConfig;

const allSheets = (snap: CanvasSnapshot): SheetData[] => Object.values(snap.sheets);
const allCharts = (snap: CanvasSnapshot): ChartData[] => Object.values(snap.charts);
const allNotes = (snap: CanvasSnapshot): NoteData[] => Object.values(snap.notes);

// Every box on the canvas — used for the "below everything" bottom edge so a new
// original never collides with a tall derivative row.
const collectAllBoxes = (snap: CanvasSnapshot): Box[] => [
  ...allSheets(snap).map(sheetBox),
  ...allCharts(snap).map(rectBox),
  ...allNotes(snap).map(rectBox),
];

const spansOverlap = (aTop: number, aBottom: number, bTop: number, bBottom: number): boolean =>
  aTop < bBottom && bTop < aBottom;

/**
 * Bottom of the left column: x left-aligned to the leftmost existing original,
 * y just below the lowest object anywhere on the canvas.
 */
export function placeOriginal(snap: CanvasSnapshot, emptyFallback: Position = EMPTY_FALLBACK): Position {
  const boxes = collectAllBoxes(snap);
  if (boxes.length === 0) return { ...emptyFallback };

  const originals = allSheets(snap).filter(isOriginalSheet);
  const columnX = originals.length > 0
    ? Math.min(...originals.map((s) => s.position.x))
    : Math.min(...boxes.map((b) => b.left));

  const maxBottom = Math.max(...boxes.map((b) => b.bottom));
  return { x: columnX, y: maxBottom + ORIGINAL_GAP };
}

/**
 * Right end of the source's row: y aligned to the source's top, x past the
 * rightmost sheet/chart sharing the source's vertical band. Notes are ignored
 * so a parked note never shoves derivatives. Falls back to `placeOriginal` if
 * the source is unknown.
 */
export function placeDerivative(
  snap: CanvasSnapshot,
  sourceId: string,
  emptyFallback: Position = EMPTY_FALLBACK,
): Position {
  const source = snap.sheets[sourceId];
  if (!source) return placeOriginal(snap, emptyFallback);

  const rowTop = source.position.y;
  const rowBottom = source.position.y + sheetPixelHeight(source);

  // Sheets + charts only (exclude free-floating notes) that share the row band.
  const rowBoxes = [
    ...allSheets(snap).map(sheetBox),
    ...allCharts(snap).map(rectBox),
  ].filter((b) => spansOverlap(rowTop, rowBottom, b.top, b.bottom));

  const maxRight = rowBoxes.length > 0
    ? Math.max(...rowBoxes.map((b) => b.right))
    : source.position.x + sheetPixelWidth(source);

  return { x: maxRight + DERIVATIVE_GAP, y: source.position.y };
}

/**
 * Far right of the canvas, top-aligned — keeps agent-created notes out of the
 * grid. Successive notes cascade rightward instead of stacking on each other.
 */
export function placeNote(snap: CanvasSnapshot, emptyFallback: Position = EMPTY_FALLBACK): Position {
  const boxes = collectAllBoxes(snap);
  if (boxes.length === 0) return { ...emptyFallback };
  const maxRight = Math.max(...boxes.map((b) => b.right));
  const topY = Math.min(...boxes.map((b) => b.top));
  return { x: maxRight + NOTE_GAP, y: topY };
}
