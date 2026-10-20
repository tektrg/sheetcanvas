import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Guards the committed output of `npm run seo:marketing`: structured data must match what a reader sees.
const PAGES = [
  'about',
  'compare/sheetcanvas-vs-excel',
  'compare/sheetcanvas-vs-google-sheets',
  'compare/sheetcanvas-vs-notion',
  'compare/sheetcanvas-vs-tableau',
];

const decode = (text: string) => text
  .replace(/<[^>]+>/g, '')
  .replace(/&#39;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
  .trim();

type Node = Record<string, any>;

function load(page: string) {
  const html = readFileSync(resolve(__dirname, '..', 'public', page, 'index.html'), 'utf8');
  const nodes: Node[] = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .flatMap((m) => {
      const data = JSON.parse(m[1]);
      return data['@graph'] ?? [data];
    });
  return { html, nodes };
}

describe.each(PAGES)('marketing page /%s/', (page) => {
  const { html, nodes } = load(page);
  const url = `https://sheetcanvas.com/${page}/`;

  it('has one h1, canonical, and OG url', () => {
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain(`<link rel="canonical" href="${url}">`);
    expect(html).toContain(`<meta property="og:url" content="${url}">`);
    expect(html).toMatch(/<meta property="og:title" content="[^"]+">/);
    expect(html).toMatch(/<meta property="og:image" content="https:\/\/[^"]+">/);
  });

  it('FAQPage JSON-LD matches the visible FAQ word for word', () => {
    const faq = nodes.find((n) => n['@type'] === 'FAQPage');
    expect(faq).toBeTruthy();
    const visible = [...html.matchAll(/<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g)]
      .map((m) => ({ q: decode(m[1]), a: decode(m[2]) }));
    const schema = faq!.mainEntity.map((q: Node) => ({ q: q.name, a: q.acceptedAnswer.text }));
    expect(visible.length).toBeGreaterThan(0);
    expect(schema).toEqual(visible);
  });

  it('SoftwareApplication / Article JSON-LD has the required shape', () => {
    const webPage = nodes.find((n) => n['@type'] === 'WebPage');
    expect(webPage?.url).toBe(url);
    expect(webPage?.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(webPage?.dateModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    if (page === 'about') {
      const app = nodes.find((n) => n['@type'] === 'SoftwareApplication');
      expect(app?.name).toBe('SheetCanvas');
      expect(app?.applicationCategory).toBeTruthy();
      expect(app?.operatingSystem).toBe('Web');
      expect(app?.offers).toMatchObject({ '@type': 'Offer', price: '0', priceCurrency: 'USD' });
    } else {
      const about = webPage!.about as Node[];
      expect(about.map((a) => a['@type'])).toEqual(['SoftwareApplication', 'SoftwareApplication']);
      expect(about[0].name).toBe('SheetCanvas');
      expect(about[1].name).toBeTruthy();
    }
  });
});
