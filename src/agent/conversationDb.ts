import { openDB } from 'idb';
import type { UIMessage } from 'ai';

const DB_NAME = 'sheetcanvas-agent';
const STORE = 'conversations';
const DB_VERSION = 1;

export interface Conversation {
  id: string;
  name: string;
  messages: UIMessage[];
  createdAt: number;
  updatedAt: number;
}

function getDb() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('by_createdAt', 'createdAt');
      }
    },
  });
}

export async function getAllConversations(): Promise<Conversation[]> {
  const db = await getDb();
  return db.getAllFromIndex(STORE, 'by_createdAt');
}

export async function putConversation(conv: Conversation): Promise<void> {
  try {
    const db = await getDb();
    await db.put(STORE, conv);
  } catch {
    // IDB not available (e.g. private browsing in some browsers) — fail silently
  }
}

export function makeConversationId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function nameFromFirstMessage(text: string): string {
  const t = text.trim();
  return t.length > 40 ? t.slice(0, 40) + '…' : t || 'New chat';
}
