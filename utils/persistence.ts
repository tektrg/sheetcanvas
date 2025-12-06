import { openDB } from 'idb';
import { SheetData, ChartData, NoteData, CanvasTransform } from '../types';

const DB_NAME = 'infini-calc-db';
const DB_VERSION = 2; // Bumped version to add notes store

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
      // Create object stores if they don't exist
      if (!db.objectStoreNames.contains('sheets')) {
        db.createObjectStore('sheets', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('charts')) {
        db.createObjectStore('charts', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('notes')) {
        db.createObjectStore('notes', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta');
      }
    },
  });
};

export const saveAppState = async (
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
    
    // We clear and rewrite to ensure deleted items are removed.
    await tx.objectStore('sheets').clear();
    for (const sheet of sheets) {
      await tx.objectStore('sheets').put(sheet);
    }
    
    await tx.objectStore('charts').clear();
    for (const chart of charts) {
      await tx.objectStore('charts').put(chart);
    }

    await tx.objectStore('notes').clear();
    for (const note of notes) {
      await tx.objectStore('notes').put(note);
    }
    
    await tx.objectStore('meta').put(transform, 'transform');
    if (defaultChartColor) await tx.objectStore('meta').put(defaultChartColor, 'defaultChartColor');
    if (customColors) await tx.objectStore('meta').put(customColors, 'customColors');
    
    await tx.done;
  } catch (err) {
    console.error('Failed to save state to IndexedDB:', err);
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