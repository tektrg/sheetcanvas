const STORAGE_KEY = 'ga-oauth-pkce';

type StoredGoogleAnalyticsAuth = {
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

export const storeGoogleAnalyticsAuth = (payload: StoredGoogleAnalyticsAuth) => {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
};

export const loadGoogleAnalyticsAuth = (): StoredGoogleAnalyticsAuth | null => {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredGoogleAnalyticsAuth;
  } catch {
    return null;
  }
};

export const clearGoogleAnalyticsAuth = () => {
  sessionStorage.removeItem(STORAGE_KEY);
};

export const buildGoogleAnalyticsAuthUrl = async (args: {
  clientId: string;
  redirectUri: string;
  scopes?: string[];
}) => {
  const codeVerifier = createCodeVerifier();
  const codeChallenge = await createCodeChallenge(codeVerifier);
  const state = crypto.randomUUID();
  const scopes = args.scopes?.length ? args.scopes : ['https://www.googleapis.com/auth/analytics.readonly'];

  storeGoogleAnalyticsAuth({
    codeVerifier,
    state,
    redirectUri: args.redirectUri,
    createdAt: Date.now()
  });

  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent'
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
};

export const clearGoogleAnalyticsAuthParams = () => {
  const url = new URL(window.location.href);
  ['code', 'state', 'scope', 'authuser', 'prompt', 'error', 'error_description'].forEach((key) => {
    url.searchParams.delete(key);
  });
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
};
