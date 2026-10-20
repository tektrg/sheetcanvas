import { describe, expect, it } from 'vitest';
import { createPublishApp } from '../publish';
import { createMemoryPagesRepo } from '../pagesRepo';
import type { Env } from '../env';
import { ANSWER_BOX_LIMITS, publishSnapshotSchema, type PublishSnapshot } from '../../../shared/publishSnapshot';
import { renderPageHtml } from '../render/pageHtml';
import { renderPageEmbedHtml } from '../render/embedHtml';

const CREATED = Date.UTC(2026, 8, 1, 10);
const UPDATED = Date.UTC(2026, 9, 15, 12);
const REFRESHED = Date.UTC(2026, 9, 19, 6);
const SENTINEL = '<script>$(echo INJECTED)</script>"\'&';

const snapshot = (overrides: Partial<PublishSnapshot> = {}): PublishSnapshot => ({
  version: 1,
  title: 'Signups by month',
  tags: [],
  format: 'markdown',
  content: 'Body text\n\n<CanvasChart id="c1" />\n\n<CanvasChart id="c2" />',
  charts: [
    { id: 'c1', title: 'Static', type: 'bar', series: [{ key: 'v', label: 'Signups', color: '#4f46e5' }], rows: [{ label: 'Jan', values: [1] }] },
    { id: 'c2', title: 'Live', type: 'line', dataAsOf: REFRESHED, series: [{ key: 'v', label: 'Visits', color: '#4f46e5' }], rows: [{ label: 'Jan', values: [2] }] },
  ],
  ...overrides,
});
const meta = { id: 'abc123', slug: 'signups-by-month', createdAt: CREATED, updatedAt: UPDATED, wordCount: 500 };
const jsonLdGraph = (html: string) => JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1])['@graph'] as Array<Record<string, unknown>>;

describe('published page dates', () => {
  it('shows Published + Updated as <time> and matching JSON-LD dates', () => {
    const html = renderPageHtml(snapshot(), meta);
    expect(html).toContain('Published <time datetime="2026-09-01T10:00:00.000Z">2026-09-01</time> · Updated <time datetime="2026-10-15T12:00:00.000Z">2026-10-15</time>');
    const article = jsonLdGraph(html).find(node => node['@type'] === 'Article')!;
    expect(article.datePublished).toBe('2026-09-01T10:00:00.000Z');
    expect(article.dateModified).toBe('2026-10-15T12:00:00.000Z');
  });

  it('captions each chart "Data as of": refresh time when known, else the publish time', () => {
    const html = renderPageHtml(snapshot(), meta);
    expect(html).toMatch(/Static<span class="as-of">Data as of <time datetime="2026-10-15T12:00:00.000Z">2026-10-15<\/time><\/span>/);
    expect(html).toMatch(/Live<span class="as-of">Data as of <time datetime="2026-10-19T06:00:00.000Z">2026-10-19<\/time><\/span>/);
    const datasets = jsonLdGraph(html).filter(node => node['@type'] === 'Dataset');
    expect(datasets.map(d => d.dateModified)).toEqual(['2026-10-15T12:00:00.000Z', '2026-10-19T06:00:00.000Z']);
  });
});

describe('answer box', () => {
  const faq = [
    { q: 'How many signups in January?', a: 'One signup.' },
    { q: 'Is it growing?', a: 'Yes.\n\nSlowly.' },
  ];

  it('renders nothing extra without summary/faq', () => {
    const html = renderPageHtml(snapshot(), meta);
    expect(html).not.toContain('<section class="answer-summary"');
    expect(html).not.toContain('FAQPage');
  });

  it('puts the summary under the title with the main question as its <h2>, then an FAQ section + FAQPage JSON-LD', () => {
    const html = renderPageHtml(snapshot({ summary: 'January had one signup.', faq }), meta);
    const summaryAt = html.indexOf('<section class="answer-summary"');
    expect(summaryAt).toBeGreaterThan(html.indexOf('<h1>'));
    expect(summaryAt).toBeLessThan(html.indexOf('<article>'));
    expect(html).toContain('<h2>How many signups in January?</h2><p>January had one signup.</p>');
    expect(html).toContain('<section class="faq" id="faq"><h2>Frequently asked questions</h2><h3>How many signups in January?</h3><p>One signup.</p><h3>Is it growing?</h3><p>Yes.</p><p>Slowly.</p></section>');
    const faqPage = jsonLdGraph(html).find(node => node['@type'] === 'FAQPage')!;
    expect(faqPage.mainEntity).toEqual([
      { '@type': 'Question', name: faq[0].q, acceptedAnswer: { '@type': 'Answer', text: faq[0].a } },
      { '@type': 'Question', name: faq[1].q, acceptedAnswer: { '@type': 'Answer', text: faq[1].a } },
    ]);
    expect(html).toContain('<meta name="description" content="January had one signup.">');
  });

  it('titles the summary "Summary" when there is no FAQ', () => {
    expect(renderPageHtml(snapshot({ summary: 'TL;DR' }), meta)).toContain('<h2>Summary</h2><p>TL;DR</p>');
  });

  it('escapes hostile summary and FAQ text in HTML and JSON-LD', () => {
    const html = renderPageHtml(snapshot({ summary: SENTINEL, faq: [{ q: SENTINEL, a: SENTINEL }] }), meta);
    expect(html).not.toContain('<script>$(echo INJECTED)');
    expect(html).toContain('&lt;script&gt;$(echo INJECTED)&lt;/script&gt;&quot;&#39;&amp;');
    const ld = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1];
    expect(ld).not.toContain('<');
    expect(jsonLdGraph(html).find(node => node['@type'] === 'FAQPage')).toBeTruthy();
  });

  it('page embeds show the summary but not the FAQ', () => {
    const html = renderPageEmbedHtml(snapshot({ summary: 'Short answer.', faq }), 'https://sheetcanvas.com/p/x-abc123', 'auto', false);
    expect(html).toContain('<p>Short answer.</p>');
    expect(html).not.toContain('class="faq"');
  });
});

describe('answer box limits (Zod)', () => {
  const parse = (overrides: Partial<PublishSnapshot>) => publishSnapshotSchema.safeParse(snapshot(overrides));
  const faqItem = { q: 'Q?', a: 'A.' };

  it('accepts the maximum sizes', () => {
    expect(parse({
      summary: 'x'.repeat(ANSWER_BOX_LIMITS.summaryChars),
      faq: Array.from({ length: ANSWER_BOX_LIMITS.faqItems }, () => ({ q: 'q'.repeat(200), a: 'a'.repeat(600) })),
    }).success).toBe(true);
  });

  it('rejects oversize summary, answers, questions, too many items and empty entries', () => {
    expect(parse({ summary: 'x'.repeat(301) }).success).toBe(false);
    expect(parse({ faq: [{ q: 'Q?', a: 'a'.repeat(601) }] }).success).toBe(false);
    expect(parse({ faq: [{ q: 'q'.repeat(201), a: 'A.' }] }).success).toBe(false);
    expect(parse({ faq: Array.from({ length: 6 }, () => faqItem) }).success).toBe(false);
    expect(parse({ faq: [{ q: '  ', a: 'A.' }] }).success).toBe(false);
  });

  it('the publish API answers 400 for an oversize summary', async () => {
    const memory = createMemoryPagesRepo();
    const app = createPublishApp(() => memory.repo, () => CREATED);
    const res = await app.request('/api/pages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.1.1.1' },
      body: JSON.stringify(snapshot({ summary: 'x'.repeat(301) })),
    }, {} as Env);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'invalid_snapshot' } });
  });
});
