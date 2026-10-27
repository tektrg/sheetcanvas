// Accounts come from the shared portfolio server theindie-api (not this repo).
// This file is the wire contract SheetCanvas relies on plus one typed client,
// compiled by both the frontend (sign-in, handle picker) and the backend
// (session check on claim/publish, handle lookups for /@handle pages).

export const THEINDIE_API_DEFAULT_URL = 'https://api.theindie.app';
export const THEINDIE_APP_ID = 'sheetcanvas';

export interface AccountUser {
  id: string;
  handle: string | null;
  /** null until the person sets one (Google sign-in may leave it empty). */
  displayName: string | null;
  /** Own avatar only; theindie-api serves it to contacts, so web clients must not rely on it loading. */
  avatarUrl: string | null;
}

export interface PublicProfile {
  id: string;
  handle: string;
  displayName: string | null;
  /** Always null from theindie-api: avatars are never public. */
  avatarUrl: null;
}

export interface GoogleSignInResult {
  token: string;
  expiresAt: string;
  isNewAccount: boolean;
  user: AccountUser;
}

// --- Handles ----------------------------------------------------------------

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 30;
const HANDLE_PATTERN = /^[a-z][a-z0-9_-]*$/;

/** Client-side check mirroring the server rule; the server still decides (reserved, taken). */
export const handleProblem = (handle: string): string | null => {
  if (handle.length < HANDLE_MIN) return `At least ${HANDLE_MIN} characters`;
  if (handle.length > HANDLE_MAX) return `At most ${HANDLE_MAX} characters`;
  if (!/^[a-z]/.test(handle)) return 'Must start with a letter';
  if (!HANDLE_PATTERN.test(handle)) return 'Use lowercase letters, numbers, - and _ only';
  return null;
};

export const isValidHandle = (handle: string) => handleProblem(handle) === null;

// --- Client -------------------------------------------------------------------

export type AccountErrorKind = 'unauthorized' | 'invalid' | 'taken' | 'too_soon' | 'not_found' | 'unavailable';

export class AccountApiError extends Error {
  constructor(public kind: AccountErrorKind, public status: number, message: string) {
    super(message);
    this.name = 'AccountApiError';
  }
}

const KIND_BY_STATUS: Record<number, AccountErrorKind> = { 401: 'unauthorized', 403: 'unauthorized', 404: 'not_found', 409: 'taken', 422: 'invalid', 429: 'too_soon' };
const DEFAULT_MESSAGE: Record<AccountErrorKind, string> = {
  unauthorized: 'Session expired — sign in again',
  invalid: 'That handle is not allowed',
  taken: 'That handle is taken',
  too_soon: 'You changed your handle recently — try again later',
  not_found: 'Not found',
  unavailable: 'Account service unavailable',
};

const serverMessage = (json: unknown): string | undefined => {
  if (!json || typeof json !== 'object') return undefined;
  const error = (json as { error?: unknown }).error;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') return (error as { message: string }).message;
  const message = (json as { message?: unknown }).message;
  return typeof message === 'string' ? message : undefined;
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const createTheIndieClient = (baseUrl: string = THEINDIE_API_DEFAULT_URL, fetchImpl: FetchLike = (i, init) => fetch(i, init)) => {
  const root = baseUrl.replace(/\/+$/, '');
  const request = async <T>(path: string, init: RequestInit = {}, token?: string): Promise<T> => {
    let res: Response;
    try {
      res = await fetchImpl(`${root}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(init.headers ?? {}),
        },
      });
    } catch {
      throw new AccountApiError('unavailable', 0, DEFAULT_MESSAGE.unavailable);
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const kind = KIND_BY_STATUS[res.status] ?? 'unavailable';
      throw new AccountApiError(kind, res.status, serverMessage(json) ?? DEFAULT_MESSAGE[kind]);
    }
    return json as T;
  };
  return {
    signInWithGoogle: (input: { idToken: string; nonce?: string; deviceName?: string }) =>
      request<GoogleSignInResult>('/v1/auth/google', { method: 'POST', body: JSON.stringify({ ...input, app: THEINDIE_APP_ID }) }),
    getMe: (token: string) => request<AccountUser>('/v1/me', {}, token),
    setHandle: (token: string, handle: string) =>
      request<AccountUser>('/v1/me/handle', { method: 'PUT', body: JSON.stringify({ handle }) }, token),
    getByHandle: (handle: string) => request<PublicProfile>(`/v1/users/by-handle/${encodeURIComponent(handle)}`),
    getPublicById: (id: string) => request<PublicProfile>(`/v1/users/${encodeURIComponent(id)}/public`),
  };
};

export type TheIndieClient = ReturnType<typeof createTheIndieClient>;
