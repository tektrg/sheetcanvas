import { describe, expect, it } from 'vitest';
import { faqSchema, humanDate, publishableTestimonials, renderTestimonials, replaceBetweenMarkers } from '../scripts/marketing/render.mjs';
import testimonialsFile from '../marketing/testimonials.json';

describe('marketing testimonials', () => {
  it('renders nothing when there are no real entries', () => {
    expect(renderTestimonials([])).toBe('');
    expect(renderTestimonials(undefined)).toBe('');
  });

  it('skips entries without consent, quote, or name', () => {
    const entries = [
      { quote: 'Great', name: 'A', consent: false },
      { quote: '', name: 'B', consent: true },
      { quote: 'Useful', name: '', consent: true },
    ];
    expect(publishableTestimonials(entries)).toHaveLength(0);
    expect(renderTestimonials(entries)).toBe('');
  });

  it('renders consented entries as escaped figure/blockquote markup', () => {
    const html = renderTestimonials([{ quote: 'Fast <b>canvas</b>', name: 'Ana', role: 'Analyst', consent: true }]);
    expect(html).toContain('<blockquote><p>Fast &lt;b&gt;canvas&lt;/b&gt;</p></blockquote>');
    expect(html).toContain('<figcaption>Ana, Analyst</figcaption>');
  });

  it('ships with no testimonials until real ones are added', () => {
    expect(publishableTestimonials(testimonialsFile.testimonials)).toHaveLength(0);
  });
});

describe('marketing helpers', () => {
  it('formats dates and FAQ schema', () => {
    expect(humanDate('2026-10-20')).toBe('October 20, 2026');
    const schema = faqSchema([{ q: 'Q?', a: 'A.' }], 'https://sheetcanvas.com/');
    expect(schema['@type']).toBe('FAQPage');
    expect(schema.mainEntity[0].acceptedAnswer.text).toBe('A.');
  });

  it('replaces only between markers and fails loudly when missing', () => {
    const out = replaceBetweenMarkers('a<!-- x:start -->old<!-- x:end -->b', 'x', 'new');
    expect(out).toBe('a<!-- x:start -->\nnew\n<!-- x:end -->b');
    expect(() => replaceBetweenMarkers('nothing', 'x', 'new')).toThrow();
  });
});
