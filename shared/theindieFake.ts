import { HANDLE_MAX, isValidHandle, type AccountUser } from './theindieAccounts';

// In-memory stand-in for theindie-api, implementing only the contract in
// theindieAccounts.ts. Used by unit tests (as a fetch) and by the local stub
// server (scripts/theindie-stub.ts). Never shipped to production code paths.
//
// Fake Google id tokens: any string; "google:<sub>:<Display Name>" picks the
// account, anything else maps to sub = the string itself.

const RESERVED = new Set(['admin', 'api', 'support', 'sheetcanvas', 'theindie']);

export const createFakeTheIndie = () => {
  const users = new Map<string, AccountUser>();
  const sessions = new Map<string, string>(); // token -> user id
  const calls: string[] = [];
  let seq = 0;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });
  const fail = (status: number, message: string) => json({ error: { message } }, status);
  const sessionUser = (req: Request) => {
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const id = sessions.get(token);
    return id ? users.get(id) ?? null : null;
  };
  const publicView = (u: AccountUser) => ({ id: u.id, handle: u.handle, displayName: u.displayName, avatarUrl: null }); // real server: avatars never public

  /** Create a signed-in user directly (tests). Returns its session token. */
  const seedUser = (user: Partial<AccountUser> & { id: string }, token = `tok-${user.id}`) => {
    users.set(user.id, { handle: null, displayName: user.id, avatarUrl: null, ...user });
    sessions.set(token, user.id);
    return token;
  };

  const handle = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;
    calls.push(`${req.method} ${path}`);
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, PUT, OPTIONS' } });
    }
    if (req.method === 'POST' && path === '/v1/auth/google') {
      const body = (await req.json().catch(() => ({}))) as { idToken?: string; app?: string };
      if (!body.idToken || body.app !== 'sheetcanvas') return fail(400, 'idToken and app required');
      const [, sub, name] = body.idToken.match(/^google:([^:]+):?(.*)$/) ?? [null, body.idToken, ''];
      const id = `u_${sub}`;
      const isNewAccount = !users.has(id);
      if (isNewAccount) users.set(id, { id, handle: null, displayName: name || sub, avatarUrl: null });
      const token = `tok-${id}-${++seq}`;
      sessions.set(token, id);
      return json({ token, expiresAt: new Date(Date.now() + 30 * 864e5).toISOString(), isNewAccount, user: users.get(id) });
    }
    if (path === '/v1/me' && req.method === 'GET') {
      const user = sessionUser(req);
      return user ? json(user) : fail(401, 'Invalid session');
    }
    if (path === '/v1/me/handle' && req.method === 'PUT') {
      const user = sessionUser(req);
      if (!user) return fail(401, 'Invalid session');
      const { handle: wanted = '' } = (await req.json().catch(() => ({}))) as { handle?: string };
      if (!isValidHandle(wanted) || wanted.length > HANDLE_MAX) return fail(422, 'Handle is invalid');
      if (RESERVED.has(wanted)) return fail(422, 'Handle is reserved');
      if ([...users.values()].some(u => u.handle === wanted && u.id !== user.id)) return fail(409, 'Handle is taken');
      user.handle = wanted;
      return json(user);
    }
    const byHandle = path.match(/^\/v1\/users\/by-handle\/([^/]+)$/);
    if (byHandle && req.method === 'GET') {
      const user = [...users.values()].find(u => u.handle === decodeURIComponent(byHandle[1]));
      return user ? json(publicView(user)) : fail(404, 'Not found');
    }
    const byId = path.match(/^\/v1\/users\/([^/]+)\/public$/);
    if (byId && req.method === 'GET') {
      const user = users.get(decodeURIComponent(byId[1]));
      // Real theindie-api: 404 when the account never chose a handle.
      return user?.handle ? json(publicView(user)) : fail(404, 'Not found');
    }
    return fail(404, 'Unknown route');
  };

  /** Drop-in `fetch` for createTheIndieClient / backend env injection. */
  const fetchImpl = (input: string, init?: RequestInit) => handle(new Request(input, init));

  return { handle, fetch: fetchImpl, seedUser, users, sessions, calls };
};
