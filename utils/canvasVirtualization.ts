import { CELL_HEIGHT, CELL_WIDTH, HEADER_COL_WIDTH, HEADER_ROW_HEIGHT } from '../constants';
import { CanvasTransform, ChartData, NoteData, Position, SelectionContext, SheetData } from '../types';

const CANVAS_OBJECT_OVERSCAN_PX = 900;

interface CanvasBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface ViewportSize {
  width: number;
  height: number;
}

interface VisibleCanvasIdsInput {
  sheetIds: string[];
  chartIds: string[];
  noteIds: string[];
  sheets: Record<string, SheetData>;
  charts: Record<string, ChartData>;
  notes: Record<string, NoteData>;
  transform: CanvasTransform;
  viewportSize: ViewportSize;
  selectedIds: Set<string>;
  draggingId: string | null;
  activeSelection: SelectionContext;
  editingNoteId: string | null;
}

export interface VisibleCanvasIds {
  sheetIds: string[];
  chartIds: string[];
  noteIds: string[];
}

const intersectsBounds = (
  position: Position,
  size: { width: number; height: number },
  bounds: CanvasBounds
) => (
  position.x < bounds.right &&
  position.x + size.width > bounds.left &&
  position.y < bounds.bottom &&
  position.y + size.height > bounds.top
);

const getViewportBounds = (
  transform: CanvasTransform,
  viewportSize: ViewportSize
): CanvasBounds => {
  const safeScale = Math.max(transform.scale, 0.001);
  // Cap the screen-space overscan based on zoom level. 
  // At high zoom (e.g. 1.0), use 400px overscan. At low zoom (e.g. < 0.4), scale it down to 150px.
  const screenOverscan = safeScale < 0.4 ? 150 : Math.min(400, 400 * safeScale);
  const overscan = screenOverscan / safeScale;
  const left = -transform.offset.x / safeScale;
  const top = -transform.offset.y / safeScale;

  return {
    left: left - overscan,
    top: top - overscan,
    right: left + viewportSize.width / safeScale + overscan,
    bottom: top + viewportSize.height / safeScale + overscan,
  };
};

const getSheetPixelSize = (sheet: SheetData) => {
  let width = HEADER_COL_WIDTH;
  for (let col = 0; col < sheet.size.width; col += 1) {
    width += sheet.colWidths?.[String(col)] ?? CELL_WIDTH;
  }

  return {
    width,
    height: sheet.size.height * CELL_HEIGHT + HEADER_ROW_HEIGHT,
  };
};

const shouldKeepMounted = (
  id: string,
  selectedIds: Set<string>,
  draggingId: string | null,
  activeSelection: SelectionContext,
  editingNoteId: string | null
) => (
  selectedIds.has(id) ||
  draggingId === id ||
  activeSelection.sheetId === id ||
  editingNoteId === id
);

export const getVisibleCanvasIds = ({
  sheetIds,
  chartIds,
  noteIds,
  sheets,
  charts,
  notes,
  transform,
  viewportSize,
  selectedIds,
  draggingId,
  activeSelection,
  editingNoteId,
}: VisibleCanvasIdsInput): VisibleCanvasIds => {
  const bounds = getViewportBounds(transform, viewportSize);
  const keepMounted = (id: string) => shouldKeepMounted(id, selectedIds, draggingId, activeSelection, editingNoteId);

  return {
    sheetIds: sheetIds.filter(id => {
      const sheet = sheets[id];
      return !!sheet && (keepMounted(id) || intersectsBounds(sheet.position, getSheetPixelSize(sheet), bounds));
    }),
    chartIds: chartIds.filter(id => {
      const chart = charts[id];
      return !!chart && (keepMounted(id) || intersectsBounds(chart.position, chart.size, bounds));
    }),
    noteIds: noteIds.filter(id => {
      const note = notes[id];
      return !!note && (keepMounted(id) || intersectsBounds(note.position, note.size, bounds));
    }),
  };
};
