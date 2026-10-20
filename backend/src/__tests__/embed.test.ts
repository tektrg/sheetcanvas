import { describe, expect, it } from 'vitest';
import { createPublishApp } from '../publish';
import { createMemoryPagesRepo } from '../pagesRepo';
import { parseEmbeddableUrl } from '../embed';
import type { Env } from '../env';
import type { PublishSnapshot } from '../../../shared/publishSnapshot';

const env = {} as Env;

const snapshot = (): PublishSnapshot => ({
  version: 1,
  title: 'Revenue Report Q3',
  tags: [],
  format: 'markdown',
  content: 'Intro\n\n<CanvasChart id="c1" />',
  charts: [
    { id: 'c1', title: 'Monthly revenue', type: 'bar', series: [{ key: 'v', label: 'Revenue', color: '#4f46e5' }], rows: Array.from({ length: 150 }, (_, i) => ({ label: `M${i}`, values: [i] })) },
    { id: 'c2', title: 'Secret chart', type: 'line', hideData: true, series: [{ key: 'v', label: 'Cost', color: '#ff0000' }], rows: [{ label: 'A', values: [1] }] },
  ],
});

const setup = async () => {
  const memory = createMemoryPagesRepo();
  const app = createPublishApp(() => memory.repo);
  const send = (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.1.1.1', ...(init.headers ?? {}) } }, env);
  const created = await (await send('/api/pages', { method: 'POST', body: JSON.stringify(snapshot()) })).json() as { id: string; slug: string; editKey: string; url: string };
  return { send, ...created };
};

const expectEmbedHeaders = (res: Response) => {
  expect(res.headers.get('content-security-policy')).toContain('frame-ancestors *');
  expect(res.headers.get('x-robots-tag')).toBe('noindex');
  expect(res.headers.get('cache-control')).toContain('max-age=60');
};

describe('embeds /e/*', () => {
  it('renders the whole page with canonical link, backlink and no script', async () => {
    const { send, id, url } = await setup();
    const res = await send(`/e/p/${id}`);
    expect(res.status).toBe(200);
    expectEmbedHeaders(res);
    const html = await res.text();
    expect(html).toContain(`<link rel="canonical" href="${url}">`);
    expect(html).toContain(`<a class="cta" href="${url}" target="_blank" rel="noopener">View on SheetCanvas ↗</a>`);
    expect(html).not.toContain('nofollow');
    expect(html).not.toContain('<script');
    expect(html).toContain('<svg');
    expect(html).toContain('Monthly revenue');
  });

  it('keeps /p/* unframable and adds the oEmbed discovery tag there', async () => {
    const { send, id, slug } = await setup();
    const res = await send(`/p/${slug}-${id}`);
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('content-security-policy')).not.toContain('frame-ancestors *');
    const html = await res.text();
    expect(html).toContain('<link rel="alternate" type="application/json+oembed" href="https://sheetcanvas.com/oembed?url=https%3A%2F%2Fsheetcanvas.com%2Fp%2F');
  });

  it('renders a single chart with a capped table, and data=0 hides it', async () => {
    const { send, id, url } = await setup();
    const res = await send(`/e/c/${id}/0`);
    expectEmbedHeaders(res);
    const html = await res.text();
    expect(html).toContain('<figcaption>Monthly revenue<span class="as-of">Data as of <time');
    expect(html).toContain('Showing 100 of 150 rows');
    expect(html).toContain(`href="${url}#chart-c1"`);
    expect(html).not.toContain('Secret chart');
    expect(await (await send(`/e/c/${id}/0?data=0`)).text()).not.toContain('class="data-table"');
  });

  it('respects the author hideData flag', async () => {
    const { send, id } = await setup();
    expect(await (await send(`/e/c/${id}/1`)).text()).not.toContain('class="data-table"');
  });

  it('forces a theme and ignores unknown theme values without reflecting them', async () => {
    const { send, id } = await setup();
    expect(await (await send(`/e/c/${id}/0?theme=dark`)).text()).toContain(':root{color-scheme:dark;--bg:#111318');
    expect(await (await send(`/e/c/${id}/0?theme=light`)).text()).toContain(':root{color-scheme:light;--bg:#fff');
    const hostile = await (await send(`/e/c/${id}/0?theme=${encodeURIComponent('"><b>INJECTED</b>')}`)).text();
    expect(hostile).not.toContain('INJECTED');
    expect(hostile).not.toContain('color-scheme:dark;');
  });

  it('themes chart SVG chrome via CSS variables (dark-aware, no JS)', async () => {
    const { send, id } = await setup();
    const html = await (await send(`/e/c/${id}/0?theme=dark`)).text();
    expect(html).toContain('class="cs-bg"');
    expect(html).toContain('figure.chart .cs-bg{fill:var(--chart-bg)}');
    expect(html).toMatch(/color-scheme:dark;[^}]*--chart-bg:#16191f/);
    expect(html).not.toContain('<script');
  });

  it('answers 404 for bad chart index / unknown page and 410 when unpublished (still framable)', async () => {
    const { send, id, editKey } = await setup();
    expect((await send(`/e/c/${id}/2`)).status).toBe(404);
    expect((await send(`/e/c/${id}/abc`)).status).toBe(404);
    expect((await send('/e/p/nosuchpage')).status).toBe(404);
    await send(`/api/pages/${id}`, { method: 'DELETE', headers: { 'x-edit-key': editKey } });
    const gone = await send(`/e/p/${id}`);
    expect(gone.status).toBe(410);
    expectEmbedHeaders(gone);
    // Inside a host iframe the home link must open a new tab, not navigate the frame.
    expect(await gone.text()).toContain('target="_blank" rel="noopener">Go to SheetCanvas');
    expect((await send(`/e/c/${id}/0`)).status).toBe(410);
  });
});

describe('/oembed', () => {
  const oembed = (send: (p: string) => Response | Promise<Response>, url: string, extra = '') =>
    send(`/oembed?url=${encodeURIComponent(url)}&format=json${extra}`);

  it('returns a rich iframe card for a /p/ URL', async () => {
    const { send, id, url } = await setup();
    const res = await oembed(send, url);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ version: '1.0', type: 'rich', title: 'Revenue Report Q3', provider_name: 'SheetCanvas', provider_url: 'https://sheetcanvas.com/', width: 760, height: 800, thumbnail_url: `https://sheetcanvas.com/og/${id}.png` });
    expect(body.html).toBe(`<iframe src="https://sheetcanvas.com/e/p/${id}" title="Revenue Report Q3" width="100%" height="800" style="border:0;max-width:100%" loading="lazy"></iframe>`);
  });

  it('supports chart embeds, keeps their options and clamps to maxwidth/maxheight', async () => {
    const { send, id } = await setup();
    const body = await (await oembed(send, `https://www.sheetcanvas.com/e/c/${id}/0?theme=dark&data=0`, '&maxwidth=500&maxheight=300')).json() as Record<string, unknown>;
    expect(body).toMatchObject({ title: 'Monthly revenue', width: 500, height: 300 });
    expect(body.html).toContain(`src="https://sheetcanvas.com/e/c/${id}/0?theme=dark&amp;data=0"`);
  });

  it('rejects other hosts, unknown pages, bad chart index; 501 for non-json', async () => {
    const { send, id, url } = await setup();
    expect((await oembed(send, `https://evil.example/p/x-${id}`)).status).toBe(404);
    expect((await oembed(send, `http://sheetcanvas.com/e/p/${id}`)).status).toBe(404);
    expect((await oembed(send, `https://sheetcanvas.com.evil.example/e/p/${id}`)).status).toBe(404);
    expect((await oembed(send, 'https://sheetcanvas.com/p/nope-zzzzzz')).status).toBe(404);
    expect((await oembed(send, `https://sheetcanvas.com/e/c/${id}/9`)).status).toBe(404);
    expect((await send(`/oembed?url=${encodeURIComponent(url)}&format=xml`)).status).toBe(501);
  });

  it('parses only canonical shapes', () => {
    expect(parseEmbeddableUrl('https://sheetcanvas.com/p/my-title-abc123')?.target).toEqual({ kind: 'page', pageId: 'abc123' });
    expect(parseEmbeddableUrl('https://sheetcanvas.com/e/c/abc123/2')?.target).toEqual({ kind: 'chart', pageId: 'abc123', chartIndex: 2 });
    expect(parseEmbeddableUrl('https://sheetcanvas.com/e/x/abc123')).toBeNull();
    expect(parseEmbeddableUrl('not a url')).toBeNull();
  });
});
