import { useSyncExternalStore } from 'react';
import { openDB } from 'idb';
import { createTheIndieClient, THEINDIE_API_DEFAULT_URL, type AccountUser } from '../shared/theindieAccounts';

// Signed-in session (theindie-api token + user), kept in its OWN IndexedDB
// database so workspace export/persistence never includes it — same rule as
// edit keys (utils/publishKeys.ts). Exposed to React via useAccountSession().

export interface AccountSession {
  token: string;
  expiresAt: string;
  user: AccountUser;
}

const DB_NAME = 'sheetcanvas-account';
const STORE = 'session';
const KEY = 'current';

const openSessionDb = () =>
  openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    },
  });

export const theindieApiUrl = () => {
  const fromEnv = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_THEINDIE_API_URL;
  return fromEnv?.trim() || THEINDIE_API_DEFAULT_URL;
};
export const theindieClient = () => createTheIndieClient(theindieApiUrl());

// --- in-memory mirror + subscribers ------------------------------------------

let current: AccountSession | null = null;
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

export const getSession = () => current;
export const isSessionLoaded = () => loaded;

const isExpired = (session: AccountSession) => Number.isFinite(Date.parse(session.expiresAt)) && Date.parse(session.expiresAt) <= Date.now();

export const loadSession = async (): Promise<AccountSession | null> => {
  try {
    const stored = ((await (await openSessionDb()).get(STORE, KEY)) as AccountSession | undefined) ?? null;
    current = stored && !isExpired(stored) ? stored : null;
  } catch {
    current = null;
  }
  loaded = true;
  emit();
  return current;
};

export const saveSession = async (session: AccountSession | null) => {
  current = session;
  loaded = true;
  emit();
  const db = await openSessionDb();
  if (session) await db.put(STORE, session, KEY);
  else await db.delete(STORE, KEY);
};

export const updateSessionUser = (user: AccountUser) => (current ? saveSession({ ...current, user }) : Promise.resolve());

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useAccountSession = () => useSyncExternalStore(subscribe, getSession, getSession);
