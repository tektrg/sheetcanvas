
import { openDB } from 'idb';
import { SheetData, ChartData, NoteData, CanvasTransform, PrivateQueryResult } from '../types';

const DB_NAME = 'infini-calc-db';
const DB_VERSION = 3;

export interface AppState {
  sheets: SheetData[];
  charts: ChartData[];
  notes: NoteData[];
  privateQueryResults?: PrivateQueryResult[];
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
      if (!db.objectStoreNames.contains('privateQueryResults')) db.createObjectStore('privateQueryResults', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    },
  });
};

export const saveFullState = async (
  sheets: SheetData[],
  charts: ChartData[],
  notes: NoteData[],
  transform: CanvasTransform,
  privateQueryResults: PrivateQueryResult[] = [],
  defaultChartColor?: string,
  customColors?: string[]
) => {
  try {
    const db = await initDB();
    const tx = db.transaction(['sheets', 'charts', 'notes', 'privateQueryResults', 'meta'], 'readwrite');
    
    // Clear stores for a full clean state save
    await tx.objectStore('sheets').clear();
    for (const sheet of sheets) await tx.objectStore('sheets').put(sheet);
    
    await tx.objectStore('charts').clear();
    for (const chart of charts) await tx.objectStore('charts').put(chart);

    await tx.objectStore('notes').clear();
    for (const note of notes) await tx.objectStore('notes').put(note);

    await tx.objectStore('privateQueryResults').clear();
    for (const result of privateQueryResults) await tx.objectStore('privateQueryResults').put(result);

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
        privateQueryResults?: PrivateQueryResult[];
        deletedSheetIds?: string[];
        deletedChartIds?: string[];
        deletedNoteIds?: string[];
        deletedPrivateQueryResultIds?: string[];
        transform?: CanvasTransform;
        defaultChartColor?: string;
        customColors?: string[];
    }
) => {
    try {
        const db = await initDB();
        const tx = db.transaction(['sheets', 'charts', 'notes', 'privateQueryResults', 'meta'], 'readwrite');

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

        if (updates.privateQueryResults) {
            const store = tx.objectStore('privateQueryResults');
            for (const result of updates.privateQueryResults) await store.put(result);
        }
        if (updates.deletedPrivateQueryResultIds) {
            const store = tx.objectStore('privateQueryResults');
            for (const id of updates.deletedPrivateQueryResultIds) await store.delete(id);
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
    const privateQueryResults = db.objectStoreNames.contains('privateQueryResults')
      ? await db.getAll('privateQueryResults')
      : [];
    const transform = await db.get('meta', 'transform');
    const defaultChartColor = await db.get('meta', 'defaultChartColor');
    const customColors = await db.get('meta', 'customColors');
    
    const migratedSheets = (sheets || []).map((sheet: any) => {
      const cfg = sheet.connectorConfig;
      if (!cfg || !cfg.params) return sheet;
      if (cfg.connectionId !== undefined || cfg.query !== undefined) return sheet;
      const migrated: any = { ...cfg };
      const p = cfg.params as Record<string, unknown>;
      // Connector-owned payloads are persisted inside a versioned envelope { version, payload }.
      if (cfg.type === 'clickhouse' && p.connectorId) {
        migrated.connectionId = String(p.connectorId);
        if (p.sql) migrated.query = { version: 1, payload: { sql: String(p.sql) } };
      } else if (cfg.type === 'google-analytics' && p.connectorId) {
        migrated.connectionId = String(p.connectorId);
        if (p.propertyId) migrated.query = { version: 1, payload: { propertyId: String(p.propertyId), report: p.report ?? {} } };
      } else if (cfg.type === 'google-sheets' && p.connectorId) {
        migrated.connectionId = String(p.connectorId);
        const spreadsheetIdOrUrl = p.spreadsheetIdOrUrl ?? p.sheetId;
        if (spreadsheetIdOrUrl) {
          migrated.query = {
            version: 1,
            payload: {
              spreadsheetIdOrUrl: String(spreadsheetIdOrUrl),
              ...(p.range ? { range: String(p.range) } : {}),
            },
          };
        }
      }
      if (typeof p.lastRefreshedAt === 'number') migrated.lastRefreshedAt = p.lastRefreshedAt;
      if (typeof p.truncated === 'boolean') migrated.truncated = p.truncated;
      if (typeof p.lastError === 'string') migrated.lastError = p.lastError;
      // Drop connector-specific keys from params; keep anything else (e.g. simulate for csv/sheets)
      const {
        connectorId: _c,
        sql: _s,
        propertyId: _p,
        report: _r,
        spreadsheetIdOrUrl: _si,
        sheetId: _sid,
        range: _range,
        lastRefreshedAt: _lr,
        truncated: _tr,
        lastError: _le,
        ...remainingParams
      } = p;
      migrated.params = Object.keys(remainingParams).length > 0 ? remainingParams : undefined;
      return { ...sheet, connectorConfig: migrated };
    });
    return {
      sheets: migratedSheets,
      charts: charts || [],
      notes: notes || [],
      privateQueryResults: privateQueryResults || [],
      transform: transform || null,
      defaultChartColor,
      customColors
    };
  } catch (err) {
    console.error('Failed to load state from IndexedDB:', err);
    return { sheets: [], charts: [], notes: [], privateQueryResults: [], transform: null };
  }
};
