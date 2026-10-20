import { describe, expect, it } from 'vitest';
import { createPublishApp } from '../publish';
import { createMemoryPagesRepo } from '../pagesRepo';
import { createAccountsResolver } from '../accounts';
import { createFakeTheIndie } from '../../../shared/theindieFake';
import type { Env } from '../env';
import type { PublishSnapshot } from '../../../shared/publishSnapshot';

const env = {} as Env;
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
const SENTINEL = '<script>$(echo INJECTED)</script>';

const snapshot = (overrides: Partial<PublishSnapshot> = {}): PublishSnapshot => ({
  version: 1,
  title: 'Revenue Report',
  tags: ['finance'],
  format: 'markdown',
  content: words(200),
  charts: [],
  ...overrides,
});

const setup = () => {
  const memory = createMemoryPagesRepo();
  const fake = createFakeTheIndie();
  const accounts = createAccountsResolver('https://accounts.test', fake.fetch);
  let clock = 1_700_000_000_000;
  const app = createPublishApp(() => memory.repo, () => (clock += 1000), () => accounts);
  const send = (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.1.1.1', ...(init.headers ?? {}) } }, env);
  const publish = async (body: PublishSnapshot = snapshot(), token?: string) => {
    const res = await send('/api/pages', { method: 'POST', body: JSON.stringify(body), headers: token ? { authorization: `Bearer ${token}` } : {} });
    return (await res.json()) as { id: string; slug: string; editKey: string };
  };
  const claim = (token: string | null, pages: Array<{ id: string; editKey: string }>) =>
    send('/api/pages/claim', { method: 'POST', body: JSON.stringify({ pages }), headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { memory, fake, send, publish, claim };
};

describe('claim', () => {
  it('401 without or with a bad session token', async () => {
    const { publish, claim } = setup();
    const page = await publish();
    expect((await claim(null, [page])).status).toBe(401);
    expect((await claim('nope', [page])).status).toBe(401);
  });

  it('claims pages with the right edit key and skips wrong keys', async () => {
    const { publish, claim, fake, memory } = setup();
    const token = fake.seedUser({ id: 'u_ann', handle: 'ann' });
    const good = await publish();
    const other = await publish();
    const res = await claim(token, [good, { id: other.id, editKey: 'wrong' }, { id: 'missing', editKey: 'x' }]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { claimed: string[]; skipped: Array<{ id: string; reason: string }> };
    expect(body.claimed).toEqual([good.id]);
    expect(body.skipped).toEqual([{ id: other.id, reason: 'forbidden' }, { id: 'missing', reason: 'not_found' }]);
    expect(memory.pages.get(good.id)!.owner_user_id).toBe('u_ann');
    expect(memory.pages.get(other.id)!.owner_user_id).toBeFalsy();
  });

  it('never steals a page owned by another account; edit key still works', async () => {
    const { publish, claim, fake, send, memory } = setup();
    const ann = fake.seedUser({ id: 'u_ann', handle: 'ann' });
    const bob = fake.seedUser({ id: 'u_bob', handle: 'bob' });
    const page = await publish(snapshot(), ann);
    expect(memory.pages.get(page.id)!.owner_user_id).toBe('u_ann');
    const body = (await (await claim(bob, [page])).json()) as { skipped: Array<{ reason: string }> };
    expect(body.skipped[0].reason).toBe('owned_by_other');
    const put = await send(`/api/pages/${page.id}`, { method: 'PUT', body: JSON.stringify(snapshot({ title: 'Edited' })), headers: { 'x-edit-key': page.editKey } });
    expect(put.status).toBe(200);
    expect(memory.pages.get(page.id)!.owner_user_id).toBe('u_ann');
  });

  it('rate-limits claim requests per network', async () => {
    const { publish, claim, fake } = setup();
    const token = fake.seedUser({ id: 'u_ann', handle: 'ann' });
    const page = await publish();
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await claim(token, [page])).status);
    expect(statuses.slice(0, 20).every(s => s === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it('publish with a bad bearer is 401, anonymous publish still works', async () => {
    const { send } = setup();
    const bad = await send('/api/pages', { method: 'POST', body: JSON.stringify(snapshot()), headers: { authorization: 'Bearer nope' } });
    expect(bad.status).toBe(401);
    const anon = await send('/api/pages', { method: 'POST', body: JSON.stringify(snapshot()) });
    expect(anon.status).toBe(201);
  });
});

describe('profile pages', () => {
  const seeded = async () => {
    const ctx = setup();
    const token = ctx.fake.seedUser({ id: 'u_ann', handle: 'ann', displayName: 'Ann Analyst' });
    const a = await ctx.publish(snapshot({ title: 'Churn deep dive', tags: ['saas', 'retention'] }), token);
    const b = await ctx.publish(snapshot({ title: 'Pricing test', tags: ['saas'] }), token);
    const anon = await ctx.publish(snapshot({ title: 'Anonymous one' }));
    return { ...ctx, token, a, b, anon };
  };

  it('lists the owner pages with tag chips, SEO tags and ProfilePage JSON-LD', async () => {
    const { send } = await seeded();
    const res = await send('/@ann');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    const html = await res.text();
    expect(html).toContain('<title>Ann Analyst (@ann) — SheetCanvas</title>');
    expect(html).toContain('<link rel="canonical" href="https://sheetcanvas.com/@ann">');
    expect(html).toContain('Churn deep dive');
    expect(html).toContain('Pricing test');
    expect(html).not.toContain('Anonymous one');
    expect(html).toContain('href="/@ann/tag/saas"');
    expect(html).toContain('"@type":"ProfilePage"');
    expect(html).toContain('"@type":"ItemList"');
    expect(html).toContain('content="index, follow"');
    expect(html).toContain('<meta property="og:image" content="https://sheetcanvas.com/brand/sheetcanvas-og.png">');
    expect(html).not.toContain('<script>');
  });

  it('tag page filters and uses CollectionPage', async () => {
    const { send } = await seeded();
    const html = await (await send('/@ann/tag/retention')).text();
    expect(html).toContain('Churn deep dive');
    expect(html).not.toContain('Pricing test');
    expect(html).toContain('"@type":"CollectionPage"');
    expect(html).toContain('<link rel="canonical" href="https://sheetcanvas.com/@ann/tag/retention">');
    expect((await send('/@ann/tag/nothing')).status).toBe(404);
  });

  it('404 for unknown handle, handle with no pages; redirects uppercase', async () => {
    const { send, fake } = await seeded();
    fake.seedUser({ id: 'u_empty', handle: 'empty' });
    expect((await send('/@ghost')).status).toBe(404);
    expect((await send('/@empty')).status).toBe(404);
    const upper = await send('/@Ann');
    expect(upper.status).toBe(301);
    expect(upper.headers.get('location')).toBe('/@ann');
  });

  it('noindex when no page reaches the word threshold', async () => {
    const { publish, fake, send } = setup();
    const token = fake.seedUser({ id: 'u_tiny', handle: 'tiny' });
    await publish(snapshot({ content: 'short note' }), token);
    expect(await (await send('/@tiny')).text()).toContain('content="noindex, follow"');
  });

  it('escapes hostile titles, tags and display names', async () => {
    const { publish, fake, send } = setup();
    const token = fake.seedUser({ id: 'u_x', handle: 'xss', displayName: SENTINEL });
    await publish(snapshot({ title: SENTINEL, tags: [SENTINEL] }), token);
    const html = await (await send('/@xss')).text();
    expect(html).not.toContain('<script>$(echo');
    expect(html).toContain('&lt;script&gt;$(echo INJECTED)&lt;/script&gt;');
    const tagHtml = await (await send(`/@xss/tag/${encodeURIComponent(SENTINEL)}`)).text();
    expect(tagHtml).not.toContain('<script>$(echo');
  });

  it('/p/ page shows "by @handle" only when owned and the owner has a handle', async () => {
    const { send, a, anon, fake, publish } = await seeded();
    const owned = await (await send(`/p/${a.slug}-${a.id}`)).text();
    expect(owned).toContain('By <a href="/@ann" rel="author">@ann</a>');
    expect(owned).toContain('"author":{"@type":"Person"');
    const anonymous = await (await send(`/p/${anon.slug}-${anon.id}`)).text();
    expect(anonymous).not.toContain('rel="author"');
    const noHandle = fake.seedUser({ id: 'u_nohandle' });
    const page = await publish(snapshot(), noHandle);
    expect(await (await send(`/p/${page.slug}-${page.id}`)).text()).not.toContain('rel="author"');
  });

  it('sitemap includes profiles and tag hubs with >= 2 indexable pages', async () => {
    const { send, fake, publish } = await seeded();
    const solo = fake.seedUser({ id: 'u_solo', handle: 'solo' });
    await publish(snapshot({ tags: ['one'] }), solo);
    const xml = await (await send('/sitemap-pages.xml')).text();
    expect(xml).toContain('<loc>https://sheetcanvas.com/@ann</loc>');
    expect(xml).toContain('<loc>https://sheetcanvas.com/@ann/tag/saas</loc>');
    expect(xml).not.toContain('/@ann/tag/retention');
    expect(xml).not.toContain('/@solo');
  });
});

describe('profile truncation', () => {
  it('shows "Showing latest 500 pages" only when the owner has more than 500', async () => {
    const { memory, fake, send } = setup();
    fake.seedUser({ id: 'u_big', handle: 'big' });
    const insert = (i: number) => memory.repo.insertPage({
      id: `p${i}`, slug: `page-${i}`, edit_key_hash: 'x', title: `Page ${i}`, description: '',
      snapshot_json: JSON.stringify(snapshot({ title: `Page ${i}`, tags: ['bulk'] })), word_count: 200,
      status: 'published', created_at: i, updated_at: i, owner_user_id: 'u_big',
    });
    for (let i = 0; i < 500; i++) await insert(i);
    const full = await (await send('/@big')).text();
    expect(full).not.toContain('Showing latest');
    await insert(500);
    const html = await (await send('/@big')).text();
    expect(html).toContain('Showing latest 500 pages.');
    expect(html.match(/<li><h2>/g)?.length).toBe(500);
    expect(html).not.toContain('/p/page-0-p0'); // oldest dropped
    expect(await (await send('/@big/tag/bulk')).text()).toContain('Showing latest 500 pages.');
  });
});
