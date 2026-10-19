import { describe, expect, it } from 'vitest';
import { createPublishApp, PUBLISH_LIMITS, parseSlugId } from '../publish';
import { createMemoryPagesRepo } from '../pagesRepo';
import type { Env } from '../env';
import type { PublishSnapshot } from '../../../shared/publishSnapshot';
import { MAX_TABLE_ROWS, renderDataTable } from '../render/dataTable';
import { renderNoteHtml, sanitizeHtml } from '../render/noteHtml';
import { renderChartSvg } from '../render/chartSvg';

const env = {} as Env;
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

const snapshot = (overrides: Partial<PublishSnapshot> = {}): PublishSnapshot => ({
  version: 1,
  title: 'Revenue Report Q3',
  tags: ['finance'],
  format: 'markdown',
  content: `# Intro\n\n${words(200)}\n\n<CanvasChart id="c1" />\n\nOutro`,
  charts: [
    {
      id: 'c1',
      title: 'Monthly revenue',
      type: 'bar',
      series: [{ key: 'value_0', label: 'Revenue', color: '#4f46e5' }],
      rows: Array.from({ length: 150 }, (_, i) => ({ label: `M${i}`, values: [i * 10] })),
    },
  ],
  ...overrides,
});

const setup = () => {
  const memory = createMemoryPagesRepo();
  let clock = 1_700_000_000_000;
  const app = createPublishApp(() => memory.repo, () => clock);
  const send = (path: string, init: RequestInit & { ip?: string } = {}) =>
    app.request(path, { ...init, headers: { 'content-type': 'application/json', 'cf-connecting-ip': init.ip ?? '1.1.1.1', ...(init.headers ?? {}) } }, env);
  const publish = async (body: unknown = snapshot(), ip?: string) => send('/api/pages', { method: 'POST', body: JSON.stringify(body), ip });
  return { app, memory, send, publish, advance: (ms: number) => { clock += ms; } };
};

describe('publish API', () => {
  it('creates a page, stores only the key hash, and serves it at the canonical URL', async () => {
    const { publish, send, memory } = setup();
    const res = await publish();
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string; url: string; editKey: string; slug: string };
    expect(body.url).toBe(`https://sheetcanvas.com/p/revenue-report-q3-${body.id}`);
    const row = memory.pages.get(body.id)!;
    expect(row.edit_key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.edit_key_hash).not.toContain(body.editKey);
    const page = await send(`/p/${body.slug}-${body.id}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('<link rel="canonical" href="https://sheetcanvas.com/p/revenue-report-q3-');
    expect(html).toContain('<svg');
    expect(html).toContain('"@type":"Dataset"');
    expect(html).toContain('Made with SheetCanvas');
    expect(html).toContain('Report / request removal');
    expect(html).toContain('index, follow');
  });

  it('rejects PUT/DELETE without the right edit key (403)', async () => {
    const { publish, send } = setup();
    const { id } = await (await publish()).json() as { id: string };
    const put = await send(`/api/pages/${id}`, { method: 'PUT', body: JSON.stringify(snapshot()), headers: { 'x-edit-key': 'wrong' } });
    expect(put.status).toBe(403);
    const del = await send(`/api/pages/${id}`, { method: 'DELETE' });
    expect(del.status).toBe(403);
  });

  it('republishes with the key and the public page changes', async () => {
    const { publish, send } = setup();
    const { id, editKey } = await (await publish()).json() as { id: string; editKey: string };
    const put = await send(`/api/pages/${id}`, { method: 'PUT', body: JSON.stringify(snapshot({ title: 'New Title' })), headers: { 'x-edit-key': editKey } });
    expect(put.status).toBe(200);
    expect((await (await send(`/p/new-title-${id}`)).text())).toContain('<h1>New Title</h1>');
  });

  it('returns 413 over 512KB and 400 over 20 charts', async () => {
    const { publish } = setup();
    expect((await publish(snapshot({ content: 'x'.repeat(600 * 1024) }))).status).toBe(413);
    const chart = snapshot().charts[0];
    const tooMany = snapshot({ charts: Array.from({ length: 21 }, (_, i) => ({ ...chart, id: `c${i}` })) });
    expect((await publish(tooMany)).status).toBe(400);
  });

  it('rate limits publishes per IP (429) and resets after an hour', async () => {
    const { publish, advance } = setup();
    for (let i = 0; i < PUBLISH_LIMITS.publishesPerHour; i++) expect((await publish()).status).toBe(201);
    expect((await publish()).status).toBe(429);
    expect((await publish(snapshot(), '2.2.2.2')).status).toBe(201);
    advance(61 * 60 * 1000);
    expect((await publish()).status).toBe(201);
  });

  it('301s a wrong slug to the canonical one and 410s after unpublish', async () => {
    const { publish, send } = setup();
    const { id, editKey } = await (await publish()).json() as { id: string; editKey: string };
    const wrong = await send(`/p/old-name-${id}`);
    expect(wrong.status).toBe(301);
    expect(wrong.headers.get('location')).toBe(`/p/revenue-report-q3-${id}`);
    expect((await send(`/api/pages/${id}`, { method: 'DELETE', headers: { 'x-edit-key': editKey } })).status).toBe(200);
    expect((await send(`/p/revenue-report-q3-${id}`)).status).toBe(410);
    expect((await send('/p/nothing-zzzzzzzzzz')).status).toBe(404);
  });

  it('noindexes thin pages (< 150 words) and keeps them out of the sitemap', async () => {
    const { publish, send } = setup();
    const thin = await (await publish(snapshot({ title: 'Thin', content: 'Just a few words <CanvasChart id="c1"/>' }))).json() as { id: string };
    const html = await (await send(`/p/thin-${thin.id}`)).text();
    expect(html).toContain('content="noindex, follow"');
    await publish();
    const sitemap = await (await send('/sitemap-pages.xml')).text();
    expect(sitemap).not.toContain(thin.id);
    expect(sitemap).toContain('/p/revenue-report-q3-');
    expect(await (await send('/llms-pages.txt')).text()).toContain('Revenue Report Q3');
  });

  it('stores abuse reports', async () => {
    const { publish, send, memory } = setup();
    const { id } = await (await publish()).json() as { id: string };
    const res = await send(`/api/pages/${id}/report`, { method: 'POST', body: JSON.stringify({ reason: 'spam', details: 'ads' }) });
    expect(res.status).toBe(201);
    expect(memory.reports).toHaveLength(1);
    expect(memory.reports[0]).toMatchObject({ page_id: id, reason: 'spam' });
  });

  it('parses slug-id paths', () => {
    expect(parseSlugId('a-b-c-xyz123')).toEqual({ slug: 'a-b-c', id: 'xyz123' });
  });
});

describe('renderers', () => {
  it('caps the data table at 100 rows with a note', () => {
    const chart = snapshot().charts[0];
    const html = renderDataTable(chart);
    expect(html.match(/<tr><th scope="row">/g)).toHaveLength(MAX_TABLE_ROWS);
    expect(html).toContain('Showing 100 of 150 rows');
  });

  it('omits the table and Dataset JSON-LD when hideData is set', async () => {
    const hidden = snapshot({ charts: [{ ...snapshot().charts[0], hideData: true }] });
    expect(renderDataTable(hidden.charts[0])).toBe('');
    const { publish, send } = setup();
    const { id } = await (await publish(hidden)).json() as { id: string };
    const html = await (await send(`/p/revenue-report-q3-${id}`)).text();
    expect(html).not.toContain('"@type":"Dataset"');
    expect(html).not.toContain('<details class="data-table"');
    expect(html).toContain('<svg');
  });

  it('sanitizes scripts, handlers and javascript: links', () => {
    const out = sanitizeHtml('<p onclick="x()">hi<script>alert(1)</script><a href="javascript:alert(1)">l</a><a href="https://ok.com">ok</a><iframe src="x"></iframe></p>');
    expect(out).not.toMatch(/script|onclick|javascript|iframe/);
    expect(out).toContain('<a href="https://ok.com" rel="nofollow ugc noopener">ok</a>');
    expect(renderNoteHtml('**bold** <Sparkline sheet="s"/>', 'markdown')).toBe('<p><strong>bold</strong> </p>\n');
  });

  it('renders every chart type to SVG', () => {
    const base = snapshot().charts[0];
    for (const type of ['line', 'bar', 'pie', 'area', 'scatter', 'treemap'] as const) {
      const svg = renderChartSvg({ ...base, type, rows: base.rows.slice(0, 5) });
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).not.toContain('NaN');
    }
  });
  it('escapes hostile title/tags/labels across meta, SVG, table and JSON-LD', async () => {
    const t = setup();
    const evil = '</script><b>INJECTED</b><img src=x onerror=alert("INJECTED")>';
    const base = snapshot().charts[0];
    const created = await (await t.publish(snapshot({
      title: `T ${evil}`, tags: ["</script><b>INJECTED</b>"], description: evil,
      content: `${words(200)}\n\n<script>alert("INJECTED")</script><img src=x onerror=alert("INJECTED")>\n\n<a href="java&#115;cript:alert(1)">x</a>\n\n<CanvasChart id="c1" />`,
      charts: [{ ...base, title: evil, series: [{ ...base.series[0], label: evil }], rows: [{ label: evil, values: [1] }] }],
    }))).json() as { id: string; slug: string };
    expect(created.id, JSON.stringify(created)).toBeTruthy();
    const res = await t.send(`/p/${created.slug}-${created.id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('<b>INJECTED');
    expect(html).not.toMatch(/<img[^>]*onerror/i);
    expect(html).not.toContain('<script>alert');
    expect(html).not.toMatch(/href="java/i);
    expect(html.match(/<\/script>/g)?.length).toBe(1);
  });

  it('rate-limits reports per network', async () => {
    const t = setup();
    const { id } = await (await t.publish()).json() as { id: string };
    const report = () => t.send(`/api/pages/${id}/report`, { method: 'POST', body: JSON.stringify({ reason: 'spam' }), ip: '9.9.9.9' });
    for (let i = 0; i < PUBLISH_LIMITS.reportsPerHour; i++) expect((await report()).status).toBe(201);
    expect((await report()).status).toBe(429);
  });

  it('PUT is rate-limited and never echoes the edit key', async () => {
    const t = setup();
    const created = await (await t.publish()).json() as { id: string; editKey: string };
    const put = () => t.send(`/api/pages/${created.id}`, { method: 'PUT', body: JSON.stringify(snapshot()), headers: { 'x-edit-key': created.editKey } });
    for (let i = 0; i < PUBLISH_LIMITS.republishesPerHour; i++) {
      const res = await put();
      expect(res.status).toBe(200);
      if (i === 0) expect(await res.text()).not.toContain(created.editKey);
    }
    expect((await put()).status).toBe(429);
  });
});
