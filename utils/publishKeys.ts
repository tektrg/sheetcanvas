import { openDB } from 'idb';

// Edit keys for published pages, in their OWN IndexedDB database so workspace
// export/share/persistence (utils/persistence.ts) can never include them.
// Losing a key = the page can no longer be edited from this browser.

const DB_NAME = 'sheetcanvas-publish-keys';
const STORE = 'editKeys';

const openKeysDb = () =>
  openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    },
  });

export const saveEditKey = async (pageId: string, editKey: string) => {
  const db = await openKeysDb();
  await db.put(STORE, editKey, pageId);
};

export const readEditKey = async (pageId: string): Promise<string | null> => {
  const db = await openKeysDb();
  return ((await db.get(STORE, pageId)) as string | undefined) ?? null;
};

export const deleteEditKey = async (pageId: string) => {
  const db = await openKeysDb();
  await db.delete(STORE, pageId);
};

/** Every (pageId, editKey) pair this browser holds — used to claim pages after sign-in. */
export const listEditKeys = async (): Promise<Array<{ id: string; editKey: string }>> => {
  const db = await openKeysDb();
  const tx = db.transaction(STORE);
  const [ids, keys] = await Promise.all([tx.store.getAllKeys(), tx.store.getAll()]);
  return ids.map((id, i) => ({ id: String(id), editKey: String(keys[i]) }));
};
