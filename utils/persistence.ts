import { openDB } from 'idb';
import { SheetData, ChartData, CanvasTransform } from '../types';

const DB_NAME = 'infini-calc-db';
const DB_VERSION = 1;

export interface AppState {
  sheets: SheetData[];
  charts: ChartData[];
  transform: CanvasTransform | null;
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
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta');
      }
    },
  });
};

export const saveAppState = async (
  sheets: SheetData[],
  charts: ChartData[],
  transform: CanvasTransform
) => {
  try {
    const db = await initDB();
    const tx = db.transaction(['sheets', 'charts', 'meta'], 'readwrite');
    
    // We clear and rewrite to ensure deleted items are removed.
    // For extremely large datasets, a diff-based approach would be better,
    // but for "many sheets" this is usually fast enough in IDB.
    await tx.objectStore('sheets').clear();
    for (const sheet of sheets) {
      await tx.objectStore('sheets').put(sheet);
    }
    
    await tx.objectStore('charts').clear();
    for (const chart of charts) {
      await tx.objectStore('charts').put(chart);
    }
    
    await tx.objectStore('meta').put(transform, 'transform');
    
    await tx.done;
  } catch (err) {
    console.error('Failed to save state to IndexedDB:', err);
  }
};

export const loadAppState = async (): Promise<AppState> => {
  try {
    const db = await initDB();
    
    const sheets = await db.getAll('sheets');
    const charts = await db.getAll('charts');
    const transform = await db.get('meta', 'transform');
    
    return {
      sheets: sheets || [],
      charts: charts || [],
      transform: transform || null
    };
  } catch (err) {
    console.error('Failed to load state from IndexedDB:', err);
    return { sheets: [], charts: [], transform: null };
  }
};