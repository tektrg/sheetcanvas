import { useStore } from '../../store';
import type { CanvasTransform, ChartData, NoteData, SheetData } from '../../types';
import { initSheetCalculation } from '../../utils/calculationEngine';

export interface PublicCanvasSnapshot {
  version: 1;
  sheets: SheetData[];
  charts: ChartData[];
  notes: NoteData[];
  transform: CanvasTransform;
}

export const MAX_PUBLIC_SNAPSHOT_BYTES = 1_048_576;
let publicCanvasReady = false;

export function isPublicCanvasReady(): boolean { return publicCanvasReady; }
export function setPublicCanvasReady(ready: boolean): void { publicCanvasReady = ready; }

function publicSheetState(sheet: SheetData): SheetData {
  const { id, position, size, title, cells, colWidths, pivotConfig, pivotWarnings,
    refreshWarnings, sparklineConfig, formatRules, setupRequired, filters, sort, showFilterPanel } = sheet;
  return { id, position, size, title, cells, colWidths, pivotConfig, pivotWarnings,
    refreshWarnings, sparklineConfig, formatRules, setupRequired, filters, sort, showFilterPanel };
}

export function capturePublicCanvasSnapshot(): PublicCanvasSnapshot {
  const state = useStore.getState();
  const snapshot: PublicCanvasSnapshot = {
    version: 1,
    sheets: state.sheetIds.map(id => publicSheetState(state.sheets[id])),
    charts: state.chartIds.map(id => state.charts[id]),
    notes: state.noteIds.map(id => state.notes[id]),
    transform: state.transform,
  };
  if (new TextEncoder().encode(JSON.stringify(snapshot)).length > MAX_PUBLIC_SNAPSHOT_BYTES) {
    throw new Error('This temporary canvas exceeds the 1 MB session recovery limit. Reduce the data before continuing.');
  }
  return snapshot;
}

export function restorePublicCanvasSnapshot(value: unknown): void {
  const snapshot = value as PublicCanvasSnapshot | null;
  if (snapshot !== null && (
    !snapshot || snapshot.version !== 1 ||
    !Array.isArray(snapshot.sheets) || !Array.isArray(snapshot.charts) || !Array.isArray(snapshot.notes) ||
    !Number.isFinite(snapshot.transform?.scale) || snapshot.transform.scale <= 0 ||
    !Number.isFinite(snapshot.transform?.offset?.x) || !Number.isFinite(snapshot.transform?.offset?.y) ||
    [...snapshot.sheets, ...snapshot.charts, ...snapshot.notes].some(item => !item || typeof item.id !== 'string')
  )) throw new Error('The temporary canvas recovery state is invalid.');
  const sheets = (snapshot?.sheets ?? []).map(sheet => ({
    ...publicSheetState(sheet), cells: { ...sheet.cells, ...initSheetCalculation(sheet) },
  }));
  const charts = snapshot?.charts ?? [];
  const notes = snapshot?.notes ?? [];
  useStore.setState({
    sheets: Object.fromEntries(sheets.map(sheet => [sheet.id, sheet])),
    sheetIds: sheets.map(sheet => sheet.id),
    charts: Object.fromEntries(charts.map(chart => [chart.id, chart])),
    chartIds: charts.map(chart => chart.id),
    notes: Object.fromEntries(notes.map(note => [note.id, note])),
    noteIds: notes.map(note => note.id),
    transform: snapshot?.transform ?? { scale: 1, offset: { x: 0, y: 0 } },
    selectedIds: new Set(), refreshingIds: new Set(), history: [], future: [], historyBase: 0,
    privateQueryResults: {}, privateQueryResultIds: [], connections: [],
    gaMetadataCache: {}, connectionSchemaTokens: {},
  });
}
