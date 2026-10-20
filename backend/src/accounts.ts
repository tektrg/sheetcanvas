import type { Env } from './env';
import {
  AccountApiError,
  createTheIndieClient,
  THEINDIE_API_DEFAULT_URL,
  type AccountUser,
  type FetchLike,
  type PublicProfile,
} from '../../shared/theindieAccounts';
import { HttpError } from './errors';

// Backend view of theindie-api accounts: verify a browser's session token and
// resolve handle <-> user id for public pages. Successful lookups are cached in
// the Workers Cache API for 5 minutes (no KV); outside Workers there is no cache.

export const ACCOUNT_CACHE_SECONDS = 300;
/** Sessions are cached briefly: a sign-out/revocation upstream is honoured within a minute. */
export const SESSION_CACHE_SECONDS = 60;
const CACHE_ORIGIN = 'https://sheetcanvas.com/__account-cache';

export interface AccountsResolver {
  /** User for a session token; null when theindie-api rejects it. Throws 502 when the service is down. */
  verifySession(token: string): Promise<AccountUser | null>;
  profileByHandle(handle: string): Promise<PublicProfile | null>;
  profileById(id: string): Promise<PublicProfile | null>;
}

const sha256Hex = async (value: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2, '0')).join('');

const edgeCache = (): Cache | null => (typeof caches !== 'undefined' ? (caches as unknown as { default: Cache }).default : null);

/** Cache-API memo for JSON values, keyed by hashed input. `null` results (404/401) are never cached. */
const cachedJson = async <T>(key: string, load: () => Promise<T | null>, ttlSeconds = ACCOUNT_CACHE_SECONDS): Promise<T | null> => {
  const cache = edgeCache();
  const request = new Request(`${CACHE_ORIGIN}/${key}`);
  const hit = await cache?.match(request).catch(() => undefined);
  if (hit) return (await hit.json()) as T;
  const value = await load();
  if (value === null) {
    await cache?.delete(request).catch(() => false); // 401/404 upstream: drop any entry a racing request wrote
  } else if (cache) {
    const response = new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json', 'cache-control': `max-age=${ttlSeconds}` } });
    await cache.put(request, response).catch(() => {});
  }
  return value;
};

const nullOn = async <T>(kinds: AccountApiError['kind'][], run: () => Promise<T>): Promise<T | null> => {
  try {
    return await run();
  } catch (err) {
    if (err instanceof AccountApiError && kinds.includes(err.kind)) return null;
    throw new HttpError(502, 'accounts_unavailable', 'Account service unavailable');
  }
};

export const createAccountsResolver = (baseUrl: string, fetchImpl?: FetchLike): AccountsResolver => {
  const client = createTheIndieClient(baseUrl, fetchImpl);
  const withHandle = (p: PublicProfile | null) => (p && p.handle ? p : null);
  return {
    async verifySession(token) {
      if (!token) return null;
      return cachedJson(`me/${await sha256Hex(token)}`, () => nullOn(['unauthorized'], () => client.getMe(token)), SESSION_CACHE_SECONDS);
    },
    async profileByHandle(handle) {
      return withHandle(await cachedJson(`handle/${encodeURIComponent(handle)}`, () => nullOn(['not_found', 'invalid'], () => client.getByHandle(handle))));
    },
    async profileById(id) {
      return withHandle(await cachedJson(`id/${encodeURIComponent(id)}`, () => nullOn(['not_found'], () => client.getPublicById(id))));
    },
  };
};

export const accountsFromEnv = (env: Env): AccountsResolver => createAccountsResolver(env.THEINDIE_API_URL || THEINDIE_API_DEFAULT_URL);

/** "Authorization: Bearer x" → "x" (empty string when absent). */
export const bearerToken = (header: string | undefined) => header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? '';
