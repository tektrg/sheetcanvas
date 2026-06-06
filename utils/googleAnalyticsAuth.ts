const GA_STORAGE_KEY = 'ga-oauth-pkce';
const GOOGLE_SHEETS_STORAGE_KEY = 'google-sheets-oauth-pkce';

type StoredGoogleAuth = {
  codeVerifier: string;
  state: string;
  redirectUri: string;
  createdAt: number;
};

const base64UrlEncode = (bytes: Uint8Array) => {
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const createCodeVerifier = () => {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
};

const createCodeChallenge = async (verifier: string) => {
  const data = new TextEncoder().encode(verifier);
  const digest = await window.crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
};

const storeGoogleAuth = (storageKey: string, payload: StoredGoogleAuth) => {
  sessionStorage.setItem(storageKey, JSON.stringify(payload));
};

const loadGoogleAuth = (storageKey: string): StoredGoogleAuth | null => {
  const raw = sessionStorage.getItem(storageKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredGoogleAuth;
  } catch {
    return null;
  }
};

const clearGoogleAuth = (storageKey: string) => {
  sessionStorage.removeItem(storageKey);
};

const buildGoogleAuthUrl = async (args: {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  storageKey: string;
}) => {
  const codeVerifier = createCodeVerifier();
  const codeChallenge = await createCodeChallenge(codeVerifier);
  const state = crypto.randomUUID();

  storeGoogleAuth(args.storageKey, {
    codeVerifier,
    state,
    redirectUri: args.redirectUri,
    createdAt: Date.now()
  });

  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: 'code',
    scope: args.scopes.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent'
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
};

export const storeGoogleAnalyticsAuth = (payload: StoredGoogleAuth) => storeGoogleAuth(GA_STORAGE_KEY, payload);
export const loadGoogleAnalyticsAuth = (): StoredGoogleAuth | null => loadGoogleAuth(GA_STORAGE_KEY);
export const clearGoogleAnalyticsAuth = () => clearGoogleAuth(GA_STORAGE_KEY);

export const buildGoogleAnalyticsAuthUrl = async (args: {
  clientId: string;
  redirectUri: string;
  scopes?: string[];
}) =>
  buildGoogleAuthUrl({
    clientId: args.clientId,
    redirectUri: args.redirectUri,
    scopes: args.scopes?.length ? args.scopes : ['https://www.googleapis.com/auth/analytics.readonly'],
    storageKey: GA_STORAGE_KEY,
  });

export const loadGoogleSheetsAuth = (): StoredGoogleAuth | null => loadGoogleAuth(GOOGLE_SHEETS_STORAGE_KEY);
export const clearGoogleSheetsAuth = () => clearGoogleAuth(GOOGLE_SHEETS_STORAGE_KEY);

export const buildGoogleSheetsAuthUrl = async (args: {
  clientId: string;
  redirectUri: string;
}) =>
  buildGoogleAuthUrl({
    clientId: args.clientId,
    redirectUri: args.redirectUri,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    storageKey: GOOGLE_SHEETS_STORAGE_KEY,
  });

export const clearGoogleAnalyticsAuthParams = () => {
  const url = new URL(window.location.href);
  ['code', 'state', 'scope', 'authuser', 'prompt', 'error', 'error_description'].forEach((key) => {
    url.searchParams.delete(key);
  });
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
};

export const clearGoogleAuthParams = clearGoogleAnalyticsAuthParams;
