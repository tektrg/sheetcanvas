
import { openDB } from 'idb';
import { SheetData, ChartData, NoteData, CanvasTransform } from '../types';

const DB_NAME = 'infini-calc-db';
const DB_VERSION = 2;

export interface AppState {
  sheets: SheetData[];
  charts: ChartData[];
  notes: NoteData[];
  transform: CanvasTransform | null;
  defaultChartColor?: string;
  customColors?: string[];
}

const initDB = async () => {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('sheets')) db.createObjectStore('sheets', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('charts')) db.createObjectStore('charts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    },
  });
};

export const saveFullState = async (
  sheets: SheetData[],
  charts: ChartData[],
  notes: NoteData[],
  transform: CanvasTransform,
  defaultChartColor?: string,
  customColors?: string[]
) => {
  try {
    const db = await initDB();
    const tx = db.transaction(['sheets', 'charts', 'notes', 'meta'], 'readwrite');
    
    // Clear stores for a full clean state save
    await tx.objectStore('sheets').clear();
    for (const sheet of sheets) await tx.objectStore('sheets').put(sheet);
    
    await tx.objectStore('charts').clear();
    for (const chart of charts) await tx.objectStore('charts').put(chart);

    await tx.objectStore('notes').clear();
    for (const note of notes) await tx.objectStore('notes').put(note);
    
    await tx.objectStore('meta').put(transform, 'transform');
    if (defaultChartColor) await tx.objectStore('meta').put(defaultChartColor, 'defaultChartColor');
    if (customColors) await tx.objectStore('meta').put(customColors, 'customColors');
    
    await tx.done;
  } catch (err) {
    console.error('Failed to save full state:', err);
  }
};

export const saveIncrementalState = async (
    updates: {
        sheets?: SheetData[];
        charts?: ChartData[];
        notes?: NoteData[];
        deletedSheetIds?: string[];
        deletedChartIds?: string[];
        deletedNoteIds?: string[];
        transform?: CanvasTransform;
        defaultChartColor?: string;
        customColors?: string[];
    }
) => {
    try {
        const db = await initDB();
        const tx = db.transaction(['sheets', 'charts', 'notes', 'meta'], 'readwrite');

        if (updates.sheets) {
            const store = tx.objectStore('sheets');
            for (const s of updates.sheets) await store.put(s);
        }
        if (updates.deletedSheetIds) {
            const store = tx.objectStore('sheets');
            for (const id of updates.deletedSheetIds) await store.delete(id);
        }

        if (updates.charts) {
            const store = tx.objectStore('charts');
            for (const c of updates.charts) await store.put(c);
        }
        if (updates.deletedChartIds) {
            const store = tx.objectStore('charts');
            for (const id of updates.deletedChartIds) await store.delete(id);
        }

        if (updates.notes) {
            const store = tx.objectStore('notes');
            for (const n of updates.notes) await store.put(n);
        }
        if (updates.deletedNoteIds) {
            const store = tx.objectStore('notes');
            for (const id of updates.deletedNoteIds) await store.delete(id);
        }

        if (updates.transform) await tx.objectStore('meta').put(updates.transform, 'transform');
        if (updates.defaultChartColor) await tx.objectStore('meta').put(updates.defaultChartColor, 'defaultChartColor');
        if (updates.customColors) await tx.objectStore('meta').put(updates.customColors, 'customColors');

        await tx.done;
    } catch (err) {
        console.error('Failed to save incremental state:', err);
    }
};

export const loadAppState = async (id: string = 'default'): Promise<AppState> => {
  try {
    const db = await initDB();
    
    const sheets = await db.getAll('sheets');
    const charts = await db.getAll('charts');
    const notes = await db.getAll('notes');
    const transform = await db.get('meta', 'transform');
    const defaultChartColor = await db.get('meta', 'defaultChartColor');
    const customColors = await db.get('meta', 'customColors');
    
    return {
      sheets: sheets || [],
      charts: charts || [],
      notes: notes || [],
      transform: transform || null,
      defaultChartColor,
      customColors
    };
  } catch (err) {
    console.error('Failed to load state from IndexedDB:', err);
    return { sheets: [], charts: [], notes: [], transform: null };
  }
};
