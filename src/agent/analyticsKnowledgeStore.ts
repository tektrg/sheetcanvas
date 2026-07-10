import { openDB } from 'idb';
import type { UserKnowledgeOverlay } from './analyticsKnowledgeTypes';

const DB_NAME = 'sheetcanvas-analytics-knowledge';
const DB_VERSION = 1;
const OVERLAY_STORE = 'userKnowledgeOverlays';

let cachedUserKnowledgeOverlays: UserKnowledgeOverlay[] = [];

function canUseIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function getDb() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(OVERLAY_STORE)) {
        const store = db.createObjectStore(OVERLAY_STORE, { keyPath: 'id' });
        store.createIndex('by_updatedAt', 'updatedAt');
      }
    },
  });
}

export function getCachedUserKnowledgeOverlays(): UserKnowledgeOverlay[] {
  return [...cachedUserKnowledgeOverlays];
}

export function setCachedUserKnowledgeOverlays(overlays: UserKnowledgeOverlay[]): void {
  cachedUserKnowledgeOverlays = [...overlays].sort((a, b) => a.updatedAt - b.updatedAt || a.id.localeCompare(b.id));
}

export async function hydrateAnalyticsKnowledgeOverlays(): Promise<UserKnowledgeOverlay[]> {
  if (!canUseIndexedDb()) return getCachedUserKnowledgeOverlays();
  try {
    const db = await getDb();
    const overlays = await db.getAllFromIndex(OVERLAY_STORE, 'by_updatedAt');
    setCachedUserKnowledgeOverlays(overlays);
  } catch (error) {
    console.warn('Failed to load analytics knowledge overlays:', error);
  }
  return getCachedUserKnowledgeOverlays();
}

export async function putUserKnowledgeOverlay(overlay: UserKnowledgeOverlay): Promise<void> {
  const nextOverlays = [
    ...cachedUserKnowledgeOverlays.filter((cachedOverlay) => cachedOverlay.id !== overlay.id),
    overlay,
  ];
  setCachedUserKnowledgeOverlays(nextOverlays);

  if (!canUseIndexedDb()) return;
  try {
    const db = await getDb();
    await db.put(OVERLAY_STORE, overlay);
  } catch (error) {
    console.warn('Failed to save analytics knowledge overlay:', error);
  }
}

export async function deleteUserKnowledgeOverlay(overlayId: string): Promise<void> {
  setCachedUserKnowledgeOverlays(cachedUserKnowledgeOverlays.filter((overlay) => overlay.id !== overlayId));

  if (!canUseIndexedDb()) return;
  try {
    const db = await getDb();
    await db.delete(OVERLAY_STORE, overlayId);
  } catch (error) {
    console.warn('Failed to delete analytics knowledge overlay:', error);
  }
}
