
import { create } from 'zustand';
import { SheetData, ChartData, NoteData, CanvasTransform, ToolMode, CellData, ConnectionSchemaScope, PrivateQueryResult } from './types';
import { refreshPivotTable } from './utils/pivotHelpers';
import { refreshSparklineTable } from './utils/sparklineHelpers';
import { propagateDerivedRefresh, collectDependentSheetIdsTopo, collectDependentChartIds } from './utils/propagateRefresh';
import { saveFullState, saveIncrementalState, loadAppState } from './utils/persistence';
import { initSheetCalculation, updateSheetCalculation, deleteSheetCalculation } from './utils/calculationEngine';
import { htmlToMarkdown } from './utils/htmlToMarkdown';
import { placeOriginal } from './utils/canvasLayout';

export interface AppState {
  sheets: Record<string, SheetData>;
  charts: Record<string, ChartData>;
  notes: Record<string, NoteData>;
  privateQueryResults: Record<string, PrivateQueryResult>;
  sheetIds: string[];
  chartIds: string[];
  noteIds: string[];
  privateQueryResultIds: string[];
  
  transform: CanvasTransform;
  selectedIds: Set<string>;
  toolMode: ToolMode;
  
  // Undo/Redo Stacks
  history: Array<{ sheets: Record<string, SheetData>, charts: Record<string, ChartData>, notes: Record<string, NoteData> }>;
  future: Array<{ sheets: Record<string, SheetData>, charts: Record<string, ChartData>, notes: Record<string, NoteData> }>;
  // Absolute count of snapshots ever shifted out of `history` by the MAX_HISTORY cap below.
  // historyBase + history.length is a depth that stays stable across that shift, unlike a raw
  // index into `history` (see saveSnapshot). Read by src/agent/activityTrail.ts.
  historyBase: number;

  // Actions
  init: () => Promise<void>;
  setTransform: (transform: CanvasTransform | ((prev: CanvasTransform) => CanvasTransform)) => void;
  setToolMode: (mode: ToolMode) => void;
  select: (ids: string[], append?: boolean) => void;
  clearSelection: () => void;
  
  addSheet: (sheet: SheetData) => void;
  updateSheet: (id: string, updates: Partial<SheetData>) => void;
  deleteSheet: (id: string) => void;

  // Transient (not persisted, not in undo history): object ids currently showing
  // a "refreshing" state because their origin sheet is mid-refresh. Covers the
  // origin plus every dependent sheet/chart, so derivatives can indicate that
  // fresh data is on the way during the (async) connector fetch.
  refreshingIds: Set<string>;
  beginSourceRefresh: (sourceId: string) => void;
  endSourceRefresh: (sourceId: string) => void;
  
  addChart: (chart: ChartData) => void;
  updateChart: (id: string, updates: Partial<ChartData>) => void;
  deleteChart: (id: string) => void;
  
  addNote: (note: NoteData) => void;
  updateNote: (id: string, updates: Partial<NoteData>) => void;
  deleteNote: (id: string) => void;

  addPrivateQueryResult: (result: PrivateQueryResult) => void;
  deletePrivateQueryResult: (id: string) => void;
  
  deleteSelected: () => void;
  undo: () => void;
  redo: () => void;
  saveSnapshot: () => void;

  connections: Array<{ connectionId: string; type: string; name: string }>;
  gaMetadataCache: Record<string, { dimensions: Array<{ apiName: string; displayName: string; description?: string }>; metrics: Array<{ apiName: string; displayName: string; description?: string }> }>;
  connectionSchemaTokens: Record<string, ConnectionSchemaScope>;
  getNextSheetPosition: () => { x: number; y: number };
  setConnections: (connections: Array<{ connectionId: string; type: string; name: string }>) => void;
  setGaMetadata: (cacheKey: string, metadata: { dimensions: Array<{ apiName: string; displayName: string; description?: string }>; metrics: Array<{ apiName: string; displayName: string; description?: string }> }) => void;
  setConnectionSchemaToken: (token: string, scope: ConnectionSchemaScope) => void;
}

const MAX_HISTORY = 50;

// Dirty tracking module-scope variables for optimized persistence
const dirtyFlags = {
    fullSync: false,
    sheets: new Set<string>(),
    charts: new Set<string>(),
    notes: new Set<string>(),
    privateQueryResults: new Set<string>(),
    deletedSheets: new Set<string>(),
    deletedCharts: new Set<string>(),
    deletedNotes: new Set<string>(),
    deletedPrivateQueryResults: new Set<string>(),
    transform: false,
    colors: false
};

const markDirty = (type: 'sheet' | 'chart' | 'note', id: string) => {
    if (type === 'sheet') dirtyFlags.sheets.add(id);
    if (type === 'chart') dirtyFlags.charts.add(id);
    if (type === 'note') dirtyFlags.notes.add(id);
};

const markDeleted = (type: 'sheet' | 'chart' | 'note', id: string) => {
    if (type === 'sheet') {
        dirtyFlags.sheets.delete(id);
        dirtyFlags.deletedSheets.add(id);
    }
    if (type === 'chart') {
        dirtyFlags.charts.delete(id);
        dirtyFlags.deletedCharts.add(id);
    }
    if (type === 'note') {
        dirtyFlags.notes.delete(id);
        dirtyFlags.deletedNotes.add(id);
    }
};

const markFullSync = () => {
    dirtyFlags.fullSync = true;
    dirtyFlags.sheets.clear();
    dirtyFlags.charts.clear();
    dirtyFlags.notes.clear();
    dirtyFlags.privateQueryResults.clear();
    dirtyFlags.deletedSheets.clear();
    dirtyFlags.deletedCharts.clear();
    dirtyFlags.deletedNotes.clear();
    dirtyFlags.deletedPrivateQueryResults.clear();
    dirtyFlags.transform = false;
    dirtyFlags.colors = false;
};

export function hasPersistedWorkspaceState(loaded: {
    sheets: unknown[];
    charts: unknown[];
    notes: unknown[];
    privateQueryResults?: unknown[];
} | null | undefined): boolean {
    return !!loaded && (
        loaded.sheets.length > 0 ||
        loaded.charts.length > 0 ||
        loaded.notes.length > 0 ||
        (loaded.privateQueryResults?.length ?? 0) > 0
    );
}

const materializeDerivedSheet = (
    sheet: SheetData,
    sheets: Record<string, SheetData>
): SheetData => {
    let materializedSheet = sheet;

    if (!materializedSheet.setupRequired && materializedSheet.pivotConfig) {
        const sourceSheet = sheets[materializedSheet.pivotConfig.sourceSheetId];
        if (sourceSheet) {
            materializedSheet = refreshPivotTable(materializedSheet, sourceSheet);
        }
    }

    if (!materializedSheet.setupRequired && materializedSheet.sparklineConfig) {
        const sourceSheet = sheets[materializedSheet.sparklineConfig.sourceSheetId];
        if (sourceSheet) {
            materializedSheet = refreshSparklineTable(materializedSheet, sourceSheet);
        }
    }

    return materializedSheet;
};

// Migrate a legacy HTML sticky note to the MDX-lite Markdown format on load.
// The original HTML is preserved (legacyHtml) as a recovery net. Safety net:
// if non-trivial HTML converts to nothing, keep the note as HTML so no content
// is ever lost to a bad conversion.
const migrateNoteToMarkdown = (note: NoteData): { note: NoteData; changed: boolean } => {
    if (note.format === 'markdown') return { note, changed: false };

    const original = note.content ?? '';
    const hadContent = original.trim() !== '' && original.trim() !== '<br>';
    const markdown = htmlToMarkdown(original);

    if (hadContent && markdown.trim() === '') {
        return { note, changed: false };
    }

    return {
        note: {
            ...note,
            content: markdown,
            format: 'markdown',
            legacyHtml: hadContent ? original : undefined,
        },
        changed: true,
    };
};

export const useStore = create<AppState>((set, get) => ({
  sheets: {},
  charts: {},
  notes: {},
  privateQueryResults: {},
  sheetIds: [],
  chartIds: [],
  noteIds: [],
  privateQueryResultIds: [],
  
  transform: { scale: 1, offset: { x: 0, y: 0 } },
  selectedIds: new Set<string>(),
  refreshingIds: new Set<string>(),
  toolMode: ToolMode.SELECT,
  
  history: [],
  future: [],
  historyBase: 0,

  connections: [],
  gaMetadataCache: {},
  connectionSchemaTokens: {},

  init: async () => {
      const loaded = await loadAppState('default');

      if (loaded && hasPersistedWorkspaceState(loaded)) {
          const sheets: Record<string, SheetData> = {};
          const sheetIds: string[] = [];
          
          loaded.sheets.forEach(s => {
              const calculatedCells = initSheetCalculation(s);
              const mergedSheet = { ...s, cells: { ...s.cells, ...calculatedCells } };
              sheets[s.id] = mergedSheet;
              sheetIds.push(s.id);
          });

          sheetIds.forEach(id => {
              sheets[id] = materializeDerivedSheet(sheets[id], sheets);
          });

          const charts: Record<string, ChartData> = {};
          const chartIds: string[] = [];
          loaded.charts.forEach(c => { charts[c.id] = c; chartIds.push(c.id); });

          const notes: Record<string, NoteData> = {};
          const noteIds: string[] = [];
          loaded.notes.forEach(n => {
              const { note: migratedNote, changed } = migrateNoteToMarkdown(n as NoteData);
              notes[migratedNote.id] = migratedNote;
              noteIds.push(migratedNote.id);
              if (changed) markDirty('note', migratedNote.id);
          });

          const privateQueryResults: Record<string, PrivateQueryResult> = {};
          const privateQueryResultIds: string[] = [];
          (loaded.privateQueryResults ?? []).forEach(result => {
              privateQueryResults[result.id] = result;
              privateQueryResultIds.push(result.id);
          });

          set({
              sheets, sheetIds,
              charts, chartIds,
              notes, noteIds,
              privateQueryResults, privateQueryResultIds,
              transform: loaded.transform || { scale: 1, offset: { x: 0, y: 0 } }
          });
      } else {
          // Sample state setup
          const initialSheet: SheetData = {
              id: 'demo-1',
              title: 'Monthly Budget',
              position: { x: 100, y: 100 },
              size: { width: 5, height: 9 }, 
              cells: {
                'A1': { raw: 'Category', value: 'Category', format: { type: 'text' } },
                'B1': { raw: 'Estimated', value: 'Estimated', format: { type: 'text' } },
                'C1': { raw: 'Actual', value: 'Actual', format: { type: 'text' } },
                'D1': { raw: 'Diff', value: 'Diff', format: { type: 'text' } },
                'E1': { raw: 'Note', value: 'Note', format: { type: 'text' } },
                'A2': { raw: 'Rent', value: 'Rent' },
                'B2': { raw: '1200', value: 1200, format: { type: 'currency', symbol: '$' } },
                'C2': { raw: '1200', value: 1200, format: { type: 'currency', symbol: '$' } },
                'D2': { raw: '=C2-B2', value: 0, format: { type: 'currency', symbol: '$' } },
                'A3': { raw: 'Groceries', value: 'Groceries' },
                'B3': { raw: '400', value: 400, format: { type: 'currency', symbol: '$' } },
                'C3': { raw: '450', value: 450, format: { type: 'currency', symbol: '$' } },
                'D3': { raw: '=C3-B3', value: 50, format: { type: 'currency', symbol: '$' } },
                'E3': { raw: 'Hosted dinner', value: 'Hosted dinner' },
                'A4': { raw: 'Utilities', value: 'Utilities' },
                'B4': { raw: '150', value: 150, format: { type: 'currency', symbol: '$' } },
                'C4': { raw: '135', value: 135, format: { type: 'currency', symbol: '$' } },
                'D4': { raw: '=C4-B4', value: -15, format: { type: 'currency', symbol: '$' } },
                'E4': { raw: 'Saved energy', value: 'Saved energy' },
                'A5': { raw: 'Entertainment', value: 'Entertainment' },
                'B5': { raw: '100', value: 100, format: { type: 'currency', symbol: '$' } },
                'C5': { raw: '120', value: 120, format: { type: 'currency', symbol: '$' } },
                'D5': { raw: '=C5-B5', value: 20, format: { type: 'currency', symbol: '$' } },
                'A7': { raw: 'Total', value: 'Total' },
                'B7': { raw: '=SUM(B2:B5)', value: null, format: { type: 'currency', symbol: '$' } },
                'C7': { raw: '=SUM(C2:C5)', value: null, format: { type: 'currency', symbol: '$' } },
                'D7': { raw: '=C7-B7', value: null, format: { type: 'currency', symbol: '$' } },
                'A8': { raw: 'Average', value: 'Average' },
                'B8': { raw: '=AVG(B2:B5)', value: null, format: { type: 'currency', symbol: '$' } },
                'C8': { raw: '=AVG(C2:C5)', value: null, format: { type: 'currency', symbol: '$' } },
              },
              colWidths: { '0': 140, '1': 100, '2': 100, '3': 100, '4': 120 }
          };
          
          const calculatedCells = initSheetCalculation(initialSheet);
          const computed = { ...initialSheet, cells: { ...initialSheet.cells, ...calculatedCells } };

          const initialNote: NoteData = {
              id: 'note-welcome',
              position: { x: 700, y: 100 },
              size: { width: 280, height: 220 },
              content: '<h3>Welcome to Sheetable!</h3><br>This is your infinite flexible canvas.<br><ul><li><b>Add Tables:</b> Click the grid icon or press T</li><li><b>Formulas:</b> Try =SUM(A1:A5) or =AVG(B1:B5)</li><li><b>Charts:</b> Select data and click the chart icon</li></ul>',
              color: 'blue'
          };

          set({
              sheets: { [computed.id]: computed },
              sheetIds: [computed.id],
              notes: { [initialNote.id]: initialNote },
              noteIds: [initialNote.id]
          });
          
          // Initial save of default content
          markFullSync();
      }
      
      // Optimized Auto-save loop
      setInterval(() => {
          const s = get();
          
          if (dirtyFlags.fullSync) {
              saveFullState(
                  Object.values(s.sheets),
                  Object.values(s.charts),
                  Object.values(s.notes),
                  s.transform,
                  Object.values(s.privateQueryResults)
              );
              dirtyFlags.fullSync = false;
              return;
          }

          // Check if any incremental changes
          const hasChanges = 
              dirtyFlags.sheets.size > 0 ||
              dirtyFlags.charts.size > 0 ||
              dirtyFlags.notes.size > 0 ||
              dirtyFlags.privateQueryResults.size > 0 ||
              dirtyFlags.deletedSheets.size > 0 ||
              dirtyFlags.deletedCharts.size > 0 ||
              dirtyFlags.deletedNotes.size > 0 ||
              dirtyFlags.deletedPrivateQueryResults.size > 0 ||
              dirtyFlags.transform ||
              dirtyFlags.colors;

          if (hasChanges) {
              const sheetsToSave = Array.from(dirtyFlags.sheets).map(id => s.sheets[id]).filter(Boolean);
              const chartsToSave = Array.from(dirtyFlags.charts).map(id => s.charts[id]).filter(Boolean);
              const notesToSave = Array.from(dirtyFlags.notes).map(id => s.notes[id]).filter(Boolean);
              const privateQueryResultsToSave = Array.from(dirtyFlags.privateQueryResults).map(id => s.privateQueryResults[id]).filter(Boolean);

              saveIncrementalState({
                  sheets: sheetsToSave.length > 0 ? sheetsToSave : undefined,
                  charts: chartsToSave.length > 0 ? chartsToSave : undefined,
                  notes: notesToSave.length > 0 ? notesToSave : undefined,
                  privateQueryResults: privateQueryResultsToSave.length > 0 ? privateQueryResultsToSave : undefined,
                  deletedSheetIds: dirtyFlags.deletedSheets.size > 0 ? Array.from(dirtyFlags.deletedSheets) : undefined,
                  deletedChartIds: dirtyFlags.deletedCharts.size > 0 ? Array.from(dirtyFlags.deletedCharts) : undefined,
                  deletedNoteIds: dirtyFlags.deletedNotes.size > 0 ? Array.from(dirtyFlags.deletedNotes) : undefined,
                  deletedPrivateQueryResultIds: dirtyFlags.deletedPrivateQueryResults.size > 0 ? Array.from(dirtyFlags.deletedPrivateQueryResults) : undefined,
                  transform: dirtyFlags.transform ? s.transform : undefined
              });

              // Reset flags
              dirtyFlags.sheets.clear();
              dirtyFlags.charts.clear();
              dirtyFlags.notes.clear();
              dirtyFlags.privateQueryResults.clear();
              dirtyFlags.deletedSheets.clear();
              dirtyFlags.deletedCharts.clear();
              dirtyFlags.deletedNotes.clear();
              dirtyFlags.deletedPrivateQueryResults.clear();
              dirtyFlags.transform = false;
              dirtyFlags.colors = false;
          }
      }, 1000);
  },

  setTransform: (transform) => {
      dirtyFlags.transform = true;
      set(state => ({
          transform: typeof transform === 'function' ? transform(state.transform) : transform
      }));
  },

  setToolMode: (mode) => set({ toolMode: mode }),

  select: (ids, append = false) => set(state => {
      const newSet = append ? new Set<string>(state.selectedIds) : new Set<string>();
      ids.forEach(id => newSet.add(id));
      return { selectedIds: newSet };
  }),

  clearSelection: () => set({ selectedIds: new Set<string>() }),

  saveSnapshot: () => {
      set(state => {
          const snapshot = {
              sheets: state.sheets,
              charts: state.charts,
              notes: state.notes
          };
          const newHistory = [...state.history, snapshot];
          if (newHistory.length > MAX_HISTORY) {
              newHistory.shift();
              return { history: newHistory, future: [], historyBase: state.historyBase + 1 };
          }
          return { history: newHistory, future: [] };
      });
  },

  addSheet: (sheet) => {
      get().saveSnapshot();
      markDirty('sheet', sheet.id);
      set(state => {
          const sheetToStore = materializeDerivedSheet(sheet, state.sheets);
          const calculatedCells = initSheetCalculation(sheetToStore);
          const computed = { ...sheetToStore, cells: { ...sheetToStore.cells, ...calculatedCells } };

          return {
              sheets: { ...state.sheets, [computed.id]: computed },
              sheetIds: [...state.sheetIds, computed.id],
              selectedIds: new Set([computed.id])
          };
      });
  },

  updateSheet: (id, updates) => {
      markDirty('sheet', id);
      set(state => {
          const oldSheet = state.sheets[id];
          if (!oldSheet) return {};
          
          let newSheet = { ...oldSheet, ...updates };
          
          if (updates.cells) {
              const calculatedUpdates = updateSheetCalculation(newSheet, updates.cells);
              const mergedCells = { ...newSheet.cells, ...calculatedUpdates };
              newSheet = { ...newSheet, cells: mergedCells };
          }

          if ((updates.pivotConfig || (updates.setupRequired === false && oldSheet.setupRequired)) && newSheet.pivotConfig) {
              const sourceId = newSheet.pivotConfig.sourceSheetId;
              const sourceSheet = state.sheets[sourceId];
              if (sourceSheet) {
                  newSheet = refreshPivotTable(newSheet, sourceSheet);
              }
          }
          
          if ((updates.sparklineConfig || (updates.setupRequired === false && oldSheet.setupRequired)) && newSheet.sparklineConfig) {
              const sourceId = newSheet.sparklineConfig.sourceSheetId;
              const sourceSheet = state.sheets[sourceId];
              if (sourceSheet) {
                  newSheet = refreshSparklineTable(newSheet, sourceSheet);
              }
          }

          // Propagate the change through the full chain of dependents (charts,
          // pivot & sparkline tables, and anything derived from those), rebinding
          // column references if the source's shape changed. Computed atomically
          // and committed in this single set() so the canvas never shows a
          // half-updated chain.
          const propagated = propagateDerivedRefresh({
              sheets: state.sheets,
              charts: state.charts,
              rootId: id,
              rootSheet: newSheet,
          });

          propagated.changedSheetIds.forEach(key => markDirty('sheet', key));
          propagated.changedChartIds.forEach(key => markDirty('chart', key));

          return propagated.changedChartIds.length > 0
              ? { sheets: propagated.sheets, charts: propagated.charts }
              : { sheets: propagated.sheets };
      });
  },

  beginSourceRefresh: (sourceId) => {
      set(state => {
          if (!state.sheets[sourceId]) return {};
          const dependentSheetIds = collectDependentSheetIdsTopo(sourceId, state.sheets);
          const affectedSheetIds = new Set<string>([sourceId, ...dependentSheetIds]);
          const dependentChartIds = collectDependentChartIds(affectedSheetIds, state.charts);
          const next = new Set(state.refreshingIds);
          affectedSheetIds.forEach(id => next.add(id));
          dependentChartIds.forEach(id => next.add(id));
          return { refreshingIds: next };
      });
  },

  endSourceRefresh: (sourceId) => {
      set(state => {
          if (state.refreshingIds.size === 0) return {};
          // Recompute the affected set from current state (dependents may have
          // changed during the refresh) and also drop the source itself.
          const dependentSheetIds = collectDependentSheetIdsTopo(sourceId, state.sheets);
          const affectedSheetIds = new Set<string>([sourceId, ...dependentSheetIds]);
          const dependentChartIds = collectDependentChartIds(affectedSheetIds, state.charts);
          const next = new Set(state.refreshingIds);
          affectedSheetIds.forEach(id => next.delete(id));
          dependentChartIds.forEach(id => next.delete(id));
          return { refreshingIds: next };
      });
  },

  deleteSheet: (id) => {
      get().saveSnapshot();
      deleteSheetCalculation(id);
      markDeleted('sheet', id);
      
      set(state => {
          const newSheets = { ...state.sheets };
          const newCharts = { ...state.charts };
          
          delete newSheets[id];
          
          Object.keys(newSheets).forEach(k => {
              if (newSheets[k].pivotConfig?.sourceSheetId === id) {
                  delete newSheets[k];
                  markDeleted('sheet', k);
              }
              if (newSheets[k].sparklineConfig?.sourceSheetId === id) {
                  delete newSheets[k];
                  markDeleted('sheet', k);
              }
          });
          
          Object.keys(newCharts).forEach(k => {
              if (newCharts[k].sourceSheetId === id) {
                  delete newCharts[k];
                  markDeleted('chart', k);
              }
          });

          return {
              sheets: newSheets,
              sheetIds: state.sheetIds.filter(sid => newSheets[sid]),
              charts: newCharts,
              chartIds: state.chartIds.filter(cid => newCharts[cid]),
              selectedIds: new Set(Array.from(state.selectedIds).filter(sid => sid !== id))
          };
      });
  },

  addChart: (chart) => {
      get().saveSnapshot();
      markDirty('chart', chart.id);
      set(state => ({
          charts: { ...state.charts, [chart.id]: chart },
          chartIds: [...state.chartIds, chart.id],
          selectedIds: new Set([chart.id])
      }));
  },

  updateChart: (id, updates) => {
      markDirty('chart', id);
      set(state => ({
          charts: { ...state.charts, [id]: { ...state.charts[id], ...updates } }
      }));
  },

  deleteChart: (id) => {
      get().saveSnapshot();
      markDeleted('chart', id);
      set(state => {
          const newCharts = { ...state.charts };
          delete newCharts[id];
          return {
              charts: newCharts,
              chartIds: state.chartIds.filter(cid => cid !== id),
              selectedIds: new Set(Array.from(state.selectedIds).filter(sid => sid !== id))
          };
      });
  },

  addNote: (note) => {
      get().saveSnapshot();
      markDirty('note', note.id);
      set(state => ({
          notes: { ...state.notes, [note.id]: note },
          noteIds: [...state.noteIds, note.id],
          selectedIds: new Set([note.id])
      }));
  },

  updateNote: (id, updates) => {
      markDirty('note', id);
      set(state => ({
          notes: { ...state.notes, [id]: { ...state.notes[id], ...updates } }
      }));
  },

  deleteNote: (id) => {
      get().saveSnapshot();
      markDeleted('note', id);
      set(state => {
          const newNotes = { ...state.notes };
          delete newNotes[id];
          return {
              notes: newNotes,
              noteIds: state.noteIds.filter(nid => nid !== id),
              selectedIds: new Set(Array.from(state.selectedIds).filter(sid => sid !== id))
          };
      });
  },

  addPrivateQueryResult: (result) => {
      dirtyFlags.privateQueryResults.add(result.id);
      dirtyFlags.deletedPrivateQueryResults.delete(result.id);
      set(state => ({
          privateQueryResults: { ...state.privateQueryResults, [result.id]: result },
          privateQueryResultIds: state.privateQueryResultIds.includes(result.id)
              ? state.privateQueryResultIds
              : [...state.privateQueryResultIds, result.id],
      }));
  },

  deletePrivateQueryResult: (id) => {
      dirtyFlags.privateQueryResults.delete(id);
      dirtyFlags.deletedPrivateQueryResults.add(id);
      set(state => {
          const nextResults = { ...state.privateQueryResults };
          delete nextResults[id];
          return {
              privateQueryResults: nextResults,
              privateQueryResultIds: state.privateQueryResultIds.filter(resultId => resultId !== id),
          };
      });
  },

  deleteSelected: () => {
      const state = get();
      state.saveSnapshot();
      const ids = state.selectedIds;
      
      const newSheets = { ...state.sheets };
      const newCharts = { ...state.charts };
      const newNotes = { ...state.notes };
      
      ids.forEach(id => {
          if (newSheets[id]) {
               delete newSheets[id];
               deleteSheetCalculation(id);
               markDeleted('sheet', id);
               
               Object.keys(newSheets).forEach(k => {
                    if (newSheets[k].pivotConfig?.sourceSheetId === id) {
                        delete newSheets[k];
                        markDeleted('sheet', k);
                    }
                    if (newSheets[k].sparklineConfig?.sourceSheetId === id) {
                        delete newSheets[k];
                        markDeleted('sheet', k);
                    }
               });
               Object.keys(newCharts).forEach(k => {
                   if (newCharts[k].sourceSheetId === id) {
                       delete newCharts[k];
                       markDeleted('chart', k);
                   }
               });
          } else if (newCharts[id]) {
              delete newCharts[id];
              markDeleted('chart', id);
          } else if (newNotes[id]) {
              delete newNotes[id];
              markDeleted('note', id);
          }
      });
      
      set({
          sheets: newSheets,
          sheetIds: state.sheetIds.filter(id => newSheets[id]),
          charts: newCharts,
          chartIds: state.chartIds.filter(id => newCharts[id]),
          notes: newNotes,
          noteIds: state.noteIds.filter(id => newNotes[id]),
          selectedIds: new Set<string>()
      });
  },

  undo: () => set(state => {
      if (state.history.length === 0) return {};
      const previous = state.history[state.history.length - 1];
      const newHistory = state.history.slice(0, -1);
      
      const currentSnapshot = { sheets: state.sheets, charts: state.charts, notes: state.notes };
      const newFuture = [...state.future, currentSnapshot];

      const sheetIds = Object.keys(previous.sheets);
      const chartIds = Object.keys(previous.charts);
      const noteIds = Object.keys(previous.notes);
      
      sheetIds.forEach(id => {
          initSheetCalculation(previous.sheets[id]);
      });

      markFullSync();

      return {
          ...previous,
          sheetIds, chartIds, noteIds,
          history: newHistory,
          future: newFuture
      };
  }),

  // Delegates to the shared canvas layout: a new original sheet lands at the
  // bottom of the left column (see utils/canvasLayout.ts).
  getNextSheetPosition: () => {
    const state = get();
    return placeOriginal({ sheets: state.sheets, charts: state.charts, notes: state.notes }, { x: 100, y: 100 });
  },
  setConnections: (connections) => set({ connections }),
  setGaMetadata: (cacheKey, metadata) =>
    set((state) => ({ gaMetadataCache: { ...state.gaMetadataCache, [cacheKey]: metadata } })),
  setConnectionSchemaToken: (token, scope) =>
    set((state) => ({ connectionSchemaTokens: { ...state.connectionSchemaTokens, [token]: scope } })),

  redo: () => set(state => {
      if (state.future.length === 0) return {};
      const next = state.future[state.future.length - 1];
      const newFuture = state.future.slice(0, -1);
      
      const currentSnapshot = { sheets: state.sheets, charts: state.charts, notes: state.notes };
      const newHistory = [...state.history, currentSnapshot];

      const sheetIds = Object.keys(next.sheets);
      const chartIds = Object.keys(next.charts);
      const noteIds = Object.keys(next.notes);

      sheetIds.forEach(id => {
          initSheetCalculation(next.sheets[id]);
      });

      markFullSync();

      return {
          ...next,
          sheetIds, chartIds, noteIds,
          history: newHistory,
          future: newFuture
      };
  })
}));
