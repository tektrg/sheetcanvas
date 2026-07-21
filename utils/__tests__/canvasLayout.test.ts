import { describe, expect, it } from 'vitest';
import type { SheetData, ChartData, NoteData } from '../../types';
import { CELL_WIDTH, CELL_HEIGHT, HEADER_COL_WIDTH, HEADER_ROW_HEIGHT } from '../../constants';
import { placeOriginal, placeDerivative, placeNote, isOriginalSheet, type CanvasSnapshot } from '../canvasLayout';

const DERIVATIVE_GAP = 60;
const ORIGINAL_GAP = 100;
const NOTE_GAP = 60;

const sheetW = (cols: number) => cols * CELL_WIDTH + HEADER_COL_WIDTH;
const sheetH = (rows: number) => rows * CELL_HEIGHT + HEADER_ROW_HEIGHT;

const sheet = (
  id: string,
  x: number,
  y: number,
  cols = 4,
  rows = 8,
  extra: Partial<SheetData> = {},
): SheetData => ({
  id,
  title: id,
  position: { x, y },
  size: { width: cols, height: rows },
  cells: {},
  ...extra,
});

const chart = (id: string, sourceSheetId: string, x: number, y: number, w = 400, h = 400): ChartData => ({
  id,
  sourceSheetId,
  position: { x, y },
  size: { width: w, height: h },
  title: id,
  config: { labelColumn: 'A', dataColumns: ['B'], color: '#000', highlightIndex: -1, animation: true, type: 'bar' },
});

const note = (id: string, x: number, y: number, w = 400, h = 300): NoteData => ({
  id,
  position: { x, y },
  size: { width: w, height: h },
  content: '',
  color: 'yellow',
});

const snap = (
  sheets: SheetData[] = [],
  charts: ChartData[] = [],
  notes: NoteData[] = [],
): CanvasSnapshot => ({
  sheets: Object.fromEntries(sheets.map((s) => [s.id, s])),
  charts: Object.fromEntries(charts.map((c) => [c.id, c])),
  notes: Object.fromEntries(notes.map((n) => [n.id, n])),
});

describe('isOriginalSheet', () => {
  it('treats plain and connector sheets as originals, pivots/sparklines as derived', () => {
    expect(isOriginalSheet(sheet('a', 0, 0))).toBe(true);
    expect(isOriginalSheet(sheet('c', 0, 0, 4, 8, { connectorConfig: { type: 'clickhouse', name: 'x' } as any }))).toBe(true);
    expect(isOriginalSheet(sheet('p', 0, 0, 4, 8, { pivotConfig: { sourceSheetId: 'a', rowLabelCol: 'A', values: [] } as any }))).toBe(false);
    expect(isOriginalSheet(sheet('s', 0, 0, 4, 8, { sparklineConfig: { sourceSheetId: 'a', dateCol: 'A', mode: 'metrics' } as any }))).toBe(false);
  });
});

describe('placeOriginal', () => {
  it('uses the empty fallback on a blank canvas', () => {
    expect(placeOriginal(snap(), { x: 42, y: 99 })).toEqual({ x: 42, y: 99 });
  });

  it('stacks a new original below everything, left-aligned to the leftmost original', () => {
    const s1 = sheet('s1', 100, 100, 4, 8); // bottom = 100 + sheetH(8)
    const s2 = sheet('s2', 100, 100 + sheetH(8) + ORIGINAL_GAP, 4, 8);
    const pos = placeOriginal(snap([s1, s2]));
    const expectedBottom = s2.position.y + sheetH(8);
    expect(pos).toEqual({ x: 100, y: expectedBottom + ORIGINAL_GAP });
  });

  it('clears a tall derivative row (goes below the lowest object, not just the last sheet)', () => {
    const s1 = sheet('s1', 100, 100, 4, 6);
    const tallChart = chart('c1', 's1', 700, 100, 400, 900); // bottom = 1000
    const pos = placeOriginal(snap([s1], [tallChart]));
    expect(pos.y).toBe(1000 + ORIGINAL_GAP);
    expect(pos.x).toBe(100); // left-aligned to the original, not the chart
  });
});

describe('placeDerivative', () => {
  it('places the first derivative to the right of its source, top-aligned', () => {
    const s1 = sheet('s1', 100, 200, 4, 8);
    const pos = placeDerivative(snap([s1]), 's1');
    expect(pos).toEqual({ x: 100 + sheetW(4) + DERIVATIVE_GAP, y: 200 });
  });

  it('cascades siblings so a second derivative does not overlap the first', () => {
    const s1 = sheet('s1', 100, 200, 4, 8);
    const c1x = 100 + sheetW(4) + DERIVATIVE_GAP;
    const c1 = chart('c1', 's1', c1x, 200, 400, 400);
    const pos = placeDerivative(snap([s1], [c1]), 's1');
    expect(pos).toEqual({ x: c1x + 400 + DERIVATIVE_GAP, y: 200 });
  });

  it('continues the same row for a chart-of-a-pivot (derivation chain flows right)', () => {
    const s1 = sheet('s1', 100, 200, 4, 8);
    const pivotX = 100 + sheetW(4) + DERIVATIVE_GAP;
    const pivot = sheet('p1', pivotX, 200, 4, 15, { pivotConfig: { sourceSheetId: 's1', rowLabelCol: 'A', values: [] } as any });
    // A chart derived from the pivot should land to the right of the pivot, same row.
    const pos = placeDerivative(snap([s1, pivot]), 'p1');
    expect(pos).toEqual({ x: pivotX + sheetW(4) + DERIVATIVE_GAP, y: 200 });
  });

  it('ignores free-floating notes when finding the row right edge', () => {
    const s1 = sheet('s1', 100, 200, 4, 8);
    const parkedNote = note('n1', 5000, 200); // sits in the row band but should not shove the chart
    const pos = placeDerivative(snap([s1], [], [parkedNote]), 's1');
    expect(pos.x).toBe(100 + sheetW(4) + DERIVATIVE_GAP);
  });

  it('does not attach to a different row that lies outside the source band', () => {
    const s1 = sheet('s1', 100, 200, 4, 4); // short: band ~ [200, 200+sheetH(4)]
    const otherRowChart = chart('c9', 's9', 5000, 5000, 400, 400); // far below, different row
    const pos = placeDerivative(snap([s1], [otherRowChart]), 's1');
    expect(pos.x).toBe(100 + sheetW(4) + DERIVATIVE_GAP);
  });

  it('falls back to placeOriginal when the source is unknown', () => {
    const s1 = sheet('s1', 100, 100, 4, 8);
    const pos = placeDerivative(snap([s1]), 'missing');
    expect(pos).toEqual(placeOriginal(snap([s1])));
  });
});

describe('placeNote', () => {
  it('uses the empty fallback on a blank canvas', () => {
    expect(placeNote(snap(), { x: 7, y: 8 })).toEqual({ x: 7, y: 8 });
  });

  it('drops to the far right of everything, top-aligned', () => {
    const s1 = sheet('s1', 100, 300, 4, 8);
    const c1 = chart('c1', 's1', 900, 300, 400, 400); // right = 1300
    const pos = placeNote(snap([s1], [c1]));
    expect(pos).toEqual({ x: 1300 + NOTE_GAP, y: 300 });
  });

  it('cascades notes rightward instead of stacking them', () => {
    const s1 = sheet('s1', 100, 300, 4, 8);
    const n1 = note('n1', 2000, 300, 400, 300); // right = 2400
    const pos = placeNote(snap([s1], [], [n1]));
    expect(pos.x).toBe(2400 + NOTE_GAP);
  });
});
