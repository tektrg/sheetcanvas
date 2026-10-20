import { AccountApiError, type AccountUser } from '../shared/theindieAccounts';
import { getSession, loadSession, saveSession, theindieClient, updateSessionUser } from './accountSession';
import { listEditKeys } from './publishKeys';
import { claimPublishedPages, type ClaimPagesResponse } from './publish';

// Account flows used by the account menu: sign in (Google id token → theindie
// session → claim this browser's pages), pick a handle, sign out.

/** Claim every page this browser holds an edit key for. No keys → no request. */
export const claimLocalPages = async (
  token: string,
  deps: { listKeys?: typeof listEditKeys; claim?: typeof claimPublishedPages } = {},
): Promise<ClaimPagesResponse | null> => {
  const pages = await (deps.listKeys ?? listEditKeys)();
  if (!pages.length) return null;
  return (deps.claim ?? claimPublishedPages)(token, pages);
};

const claimQuietly = (token: string) =>
  claimLocalPages(token).catch(err => {
    console.warn('[account] claiming pages failed', err instanceof Error ? err.message : err);
    return null;
  });

export const signInWithGoogleIdToken = async (idToken: string, nonce?: string) => {
  const result = await theindieClient().signInWithGoogle({ idToken, nonce, deviceName: 'SheetCanvas web' });
  await saveSession({ token: result.token, expiresAt: result.expiresAt, user: result.user });
  const claim = await claimQuietly(result.token);
  return { ...result, claimedCount: claim?.claimed.length ?? 0 };
};

/** On app start: restore the session, refresh the user, drop it if theindie-api rejects it. */
export const restoreSession = async () => {
  const session = await loadSession();
  if (!session) return null;
  try {
    const user = await theindieClient().getMe(session.token);
    await updateSessionUser(user);
    await claimQuietly(session.token); // pages published while signed out
    return user;
  } catch (err) {
    if (err instanceof AccountApiError && err.kind === 'unauthorized') await saveSession(null);
    return session.user; // offline: keep the cached user
  }
};

export const chooseHandle = async (handle: string): Promise<AccountUser> => {
  const session = getSession();
  if (!session) throw new AccountApiError('unauthorized', 401, 'Sign in first');
  try {
    const user = await theindieClient().setHandle(session.token, handle);
    await updateSessionUser(user);
    return user;
  } catch (err) {
    if (err instanceof AccountApiError && err.kind === 'unauthorized') await saveSession(null);
    throw err;
  }
};

export const signOut = () => {
  (window as { google?: GoogleIdentity }).google?.accounts.id.disableAutoSelect();
  return saveSession(null);
};

// --- Google Identity Services (https://accounts.google.com/gsi/client) --------

export interface GoogleIdentity {
  accounts: {
    id: {
      initialize(config: { client_id: string; callback: (response: { credential: string }) => void; nonce?: string; ux_mode?: 'popup' }): void;
      renderButton(parent: HTMLElement, options: Record<string, string | number>): void;
      disableAutoSelect(): void;
    };
  };
}

const GSI_SRC = 'https://accounts.google.com/gsi/client';
let gsiLoading: Promise<GoogleIdentity> | null = null;

export const googleClientId = () => (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_GOOGLE_CLIENT_ID?.trim() || '';

export const loadGoogleIdentity = (): Promise<GoogleIdentity> => {
  const existing = (window as { google?: GoogleIdentity }).google;
  if (existing?.accounts?.id) return Promise.resolve(existing);
  gsiLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GSI_SRC;
    script.async = true;
    script.onload = () => {
      const google = (window as { google?: GoogleIdentity }).google;
      if (google?.accounts?.id) resolve(google);
      else reject(new Error('Google sign-in failed to load'));
    };
    script.onerror = () => {
      gsiLoading = null;
      reject(new Error('Google sign-in failed to load'));
    };
    document.head.appendChild(script);
  });
  return gsiLoading;
};

/** Random nonce bound into the Google id token and echoed to theindie-api. */
export const newNonce = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
};

// TODO(accounts): Sign in with Apple on web (theindie-api supports Apple for the
// native apps; web needs Apple JS + a Services ID) — out of scope for now.
