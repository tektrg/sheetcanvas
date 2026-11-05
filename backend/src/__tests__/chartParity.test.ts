import { describe, expect, it } from 'vitest';
import { publishedChartSchema, publishSnapshotSchema, type PublishedChart } from '../../../shared/publishSnapshot';
import { COMPACT_LAYOUT, renderChartSvg, WIDE_LAYOUT } from '../render/chartSvg';
import { renderPageHtml } from '../render/pageHtml';

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May'];
const make = (overrides: Partial<PublishedChart> = {}): PublishedChart => ({
  id: 'c1', title: 'Revenue', type: 'bar',
  series: [{ key: 'a', label: 'Revenue', color: '#4f46e5' }],
  rows: months.map((label, i) => ({ label, values: [(i + 1) * 20_000] })),
  ...overrides,
});
const dual = (overrides: Partial<PublishedChart> = {}) => make({
  series: [
    { key: 'a', label: 'Revenue', color: '#4f46e5' },
    { key: 'b', label: 'Rate', color: '#06b6d4', type: 'line', axis: 'right' },
  ],
  rows: months.map((label, i) => ({ label, values: [(i + 1) * 20_000, 0.02 + i * 0.005] })),
  ...overrides,
});

const gridWidth = (svg: string) => Number(svg.match(/class="cs-grid"/) && svg.match(/<line x1="0" x2="([\d.]+)"/)![1]);
// Data dots carry a stroke (the legend's circles do not).
const circles = (svg: string) => [...svg.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([\d.]+)"[^>]*stroke=/g)].map(m => ({ cx: +m[1], cy: +m[2], r: +m[3] }));
const tickTexts = (svg: string, anchor: 'start' | 'end') =>
  [...svg.matchAll(new RegExp(`<text x="[-\\d.]+" text-anchor="${anchor}" y="[\\d.]+" dy="0.32em" class="cs-text"[^>]*>([^<]*)</text>`, 'g'))].map(m => m[1]);
const valueLabels = (svg: string) =>
  [...svg.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)" text-anchor="middle" font-size="10" font-weight="500"[^>]*>([^<]*)<\/text>/g)]
    .map(m => ({ x: +m[1], y: +m[2], text: m[3] }));

describe('right-hand Y axis', () => {
  it('draws right tick labels from their own scale and plots right series against it', () => {
    const svg = renderChartSvg(dual(), WIDE_LAYOUT);
    expect(tickTexts(svg, 'start').length).toBeGreaterThan(2);
    // The rate (0.02..0.04) sits high on its own scale; on the shared revenue scale it would hug the bottom.
    const innerHeight = WIDE_LAYOUT.height - WIDE_LAYOUT.margin.top - WIDE_LAYOUT.margin.bottom;
    const dots = circles(svg);
    expect(dots).toHaveLength(5);
    expect(Math.min(...dots.map(d => d.cy))).toBeLessThan(innerHeight * 0.25);

    const shared = renderChartSvg(dual({ series: dual().series.map(({ axis: _axis, ...s }) => s) }), WIDE_LAYOUT);
    expect(tickTexts(shared, 'start')).toHaveLength(0);
    expect(Math.min(...circles(shared).map(d => d.cy))).toBeGreaterThan(innerHeight * 0.9);
  });

  it('reserves right margin only when a right axis exists', () => {
    const without = renderChartSvg(make(), WIDE_LAYOUT);
    expect(gridWidth(without)).toBe(WIDE_LAYOUT.width - WIDE_LAYOUT.margin.left - WIDE_LAYOUT.margin.right);
    expect(gridWidth(renderChartSvg(dual(), WIDE_LAYOUT))).toBeLessThan(gridWidth(without));
  });

  it('stacks bars per axis and never stacks lines', () => {
    const svg = renderChartSvg(dual({ stacked: true }), WIDE_LAYOUT);
    expect(svg).not.toContain('NaN');
    expect(circles(svg)).toHaveLength(5);
  });
});

describe('number formats', () => {
  const currency = { type: 'currency', decimals: 0 } as const;

  it('formats axis ticks with the source format, left and right', () => {
    const svg = renderChartSvg(dual({ axisFormats: { left: currency, right: { type: 'percent', decimals: 1 } } }), WIDE_LAYOUT);
    expect(tickTexts(svg, 'end').every(t => /^\$[\d,]+$/.test(t))).toBe(true);
    expect(tickTexts(svg, 'start').every(t => /^\d+\.\d%$/.test(t))).toBe(true);
  });

  it('widens the left margin for wide currency ticks but keeps compact ticks unchanged', () => {
    const plain = renderChartSvg(make(), WIDE_LAYOUT);
    expect(tickTexts(plain, 'end')).toContain('100K');
    expect(gridWidth(plain)).toBe(648);
    expect(gridWidth(renderChartSvg(make({ axisFormats: { left: { type: 'currency', decimals: 2 } } }), WIDE_LAYOUT))).toBeLessThan(648);
  });

  it('applies a d3 specifier and escapes a hostile fill character', () => {
    const svg = renderChartSvg(make({ showLabels: true, axisFormats: { left: { type: 'number', d3Format: '<<9,.0f' } } }), WIDE_LAYOUT);
    expect(svg).toContain('&lt;&lt;');
    expect(svg).not.toMatch(/<<</);
  });
});

describe('line / area / bar styling', () => {
  it('draws lines and areas as monotone curves, not straight segments', () => {
    const line = renderChartSvg(make({ type: 'line' }), WIDE_LAYOUT);
    const path = line.match(/<path d="(M[^"]+)" fill="none" stroke="#4f46e5" stroke-width="2.5"/)![1];
    expect(path).toContain('C');
    expect(path).not.toContain('L');
    expect(renderChartSvg(make({ type: 'area' }), WIDE_LAYOUT)).toMatch(/<path d="M[^"]*C[^"]*Z"/);
  });

  it('fills areas with a vertical gradient and keeps ids unique between the two variants and charts', () => {
    const chart = make({ type: 'area' });
    const wide = renderChartSvg(chart, WIDE_LAYOUT);
    const compact = renderChartSvg(chart, COMPACT_LAYOUT);
    expect(wide).toMatch(/<linearGradient id="cs-ag-[^"]+" x1="0" y1="0" x2="0" y2="1">/);
    expect(wide).toMatch(/fill="url\(#cs-ag-[^)]+\)"/);
    const ids = (svg: string) => [...svg.matchAll(/ id="([^"]+)"/g)].map(m => m[1]);
    expect(ids(wide).some(id => ids(compact).includes(id))).toBe(false);
    expect(ids(renderChartSvg({ ...chart, id: 'c2' }, WIDE_LAYOUT)).some(id => ids(wide).includes(id))).toBe(false);
  });

  it('rounds the far end of plain bars, keeps stacked segments square with a separator', () => {
    const plain = renderChartSvg(make(), WIDE_LAYOUT);
    expect(plain).toMatch(/<path d="M[\d.]+,[\d.]+V[\d.]+A7,7 0 0 1/);
    const stacked = renderChartSvg(dual({ type: 'bar', stacked: true, series: [{ key: 'a', label: 'A', color: '#4f46e5' }, { key: 'b', label: 'B', color: '#06b6d4' }], rows: months.map((label) => ({ label, values: [5, 3] })) }), WIDE_LAYOUT);
    expect(stacked).toContain('class="cs-sep" stroke="#ffffff" stroke-width="1"');
    expect(stacked).not.toContain('A7,7');
  });

  it('rounds the bottom of negative bars instead', () => {
    const svg = renderChartSvg(make({ rows: [{ label: 'x', values: [10] }, { label: 'y', values: [-10] }] }), WIDE_LAYOUT);
    expect(svg).toMatch(/A7,7 0 0 0/);
  });

  it('draws dots on short lines only', () => {
    expect(circles(renderChartSvg(make({ type: 'line' }), WIDE_LAYOUT))).toHaveLength(5);
    const many = make({ type: 'line', rows: Array.from({ length: 200 }, (_, i) => ({ label: `r${i}`, values: [i] })) });
    expect(circles(renderChartSvg(many, WIDE_LAYOUT))).toHaveLength(0);
  });
});

describe('value labels', () => {
  it('draws formatted labels above bars only when showLabels is set', () => {
    expect(valueLabels(renderChartSvg(make(), WIDE_LAYOUT))).toHaveLength(0);
    const labels = valueLabels(renderChartSvg(make({ showLabels: true, axisFormats: { left: { type: 'currency', decimals: 0 } } }), WIDE_LAYOUT));
    expect(labels.map(l => l.text)).toEqual(['$20,000', '$40,000', '$60,000', '$80,000', '$100,000']);
  });

  it('skips labels that would collide', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ label: `r${i}`, values: [1000 + i] }));
    const labels = valueLabels(renderChartSvg(make({ showLabels: true, rows }), COMPACT_LAYOUT));
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.length).toBeLessThan(40);
    const boxes = labels.map(l => ({ l: l.x - (l.text.length * 6) / 2, r: l.x + (l.text.length * 6) / 2, y: l.y }));
    for (const a of boxes) for (const b of boxes) if (a !== b && a.y === b.y) expect(a.l >= b.r || a.r <= b.l).toBe(true);
  });

  it('draws white labels inside stacked segments that are tall enough', () => {
    const svg = renderChartSvg(make({ stacked: true, showLabels: true, series: [{ key: 'a', label: 'A', color: '#4f46e5' }, { key: 'b', label: 'B', color: '#06b6d4' }], rows: months.map((label) => ({ label, values: [50, 30] })) }), WIDE_LAYOUT);
    expect(svg).toContain('font-weight="500" fill="#ffffff"');
  });
});

describe('highlightIndex and category colours', () => {
  it('paints the highlighted bar, dot and pie slice in the canvas highlight colour', () => {
    expect(renderChartSvg(make({ highlightIndex: 2 }), WIDE_LAYOUT).match(/#f2c94c/g)).toHaveLength(1);
    expect(renderChartSvg(make({ type: 'line', highlightIndex: 2 }), WIDE_LAYOUT)).toMatch(/<circle [^>]*r="6" fill="#f2c94c"/);
    const pie = renderChartSvg(make({ type: 'pie', highlightIndex: 1 }), WIDE_LAYOUT);
    expect(pie).toMatch(/fill="#f2c94c" stroke="#ffffff" stroke-width="2"/);
    expect(renderChartSvg(make(), WIDE_LAYOUT)).not.toContain('#f2c94c');
  });

  it('uses the snapshot palette for pie and treemap, with a legend for the pie', () => {
    const categoryColors = ['#111111', '#222222', '#333333', '#444444', '#555555'];
    const pie = renderChartSvg(make({ type: 'pie', categoryColors }), WIDE_LAYOUT);
    for (const color of categoryColors) expect(pie).toContain(`fill="${color}"`);
    expect(pie).toContain('>Jan</text>');
    const treemap = renderChartSvg(make({ type: 'treemap', categoryColors }), WIDE_LAYOUT);
    expect(treemap).toContain('stop-color="#555555"');
    expect(treemap).toContain('rx="6"');
  });

  it('limits the treemap to the 16 largest and the pie legend to a short list', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ label: `Region ${i}`, values: [i + 1] }));
    expect((renderChartSvg(make({ type: 'treemap', rows }), WIDE_LAYOUT).match(/<linearGradient/g) ?? []).length).toBe(16);
    expect(renderChartSvg(make({ type: 'pie', rows }), WIDE_LAYOUT)).toMatch(/\+\d+ more/);
  });
});

describe('snapshot compatibility', () => {
  const OLD = {
    version: 1, title: 'Old page', tags: [], format: 'markdown', content: '<CanvasChart id="c1"/>',
    charts: [{ id: 'c1', title: 'Old', type: 'line', series: [{ key: 'a', label: 'A', color: '#4f46e5' }], rows: [{ label: 'x', values: [1500] }, { label: 'y', values: [2500] }] }],
  };

  it('parses a pre-parity snapshot unchanged and renders it with a single scale and generic ticks', () => {
    const parsed = publishSnapshotSchema.parse(OLD);
    expect(parsed.charts[0]).toEqual(OLD.charts[0]);
    const svg = renderChartSvg(parsed.charts[0], WIDE_LAYOUT);
    expect(tickTexts(svg, 'end').some(t => /K$/.test(t))).toBe(true);
    expect(tickTexts(svg, 'start')).toHaveLength(0);
    expect(svg).not.toContain('#f2c94c');
    expect(svg).not.toContain('NaN');
  });

  it('renders pre-parity pie/treemap/scatter snapshots without the new fields', () => {
    for (const type of ['pie', 'treemap', 'scatter'] as const) {
      const svg = renderChartSvg({ ...OLD.charts[0], type } as PublishedChart, WIDE_LAYOUT);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).not.toContain('NaN');
    }
  });

  it('keeps the root <svg> replaceable by the OG renderer (one root, defs inside)', () => {
    const svg = renderChartSvg(make({ type: 'area' }), WIDE_LAYOUT);
    const nested = svg.replace(/^<svg [^>]*>/, '<svg x="60" y="120">');
    expect(nested.match(/<svg\b/g)).toHaveLength(1);
    expect(nested).toContain('<defs>');
  });

  it('puts the highlight/axis styling into the full page', () => {
    const snapshot = publishSnapshotSchema.parse({ ...OLD, charts: [{ ...dual(), highlightIndex: 1 }] });
    const html = renderPageHtml(snapshot, { id: 'abc', slug: 's', createdAt: 1, updatedAt: 1, wordCount: 200 });
    expect(html).toContain('.cs-dot{fill:var(--chart-bg)}');
    const ids = [...html.matchAll(/ id="(cs-[^"]+)"/g)].map(m => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('wire validation (zod)', () => {
  const base = make();
  const parse = (extra: Record<string, unknown>) => publishedChartSchema.safeParse({ ...base, ...extra });

  it('accepts the new fields', () => {
    expect(parse({ axisFormats: { left: { type: 'currency', decimals: 2 }, right: { type: 'number', d3Format: ',.1f' } }, showLabels: true, highlightIndex: 3, categoryColors: ['#112233'] }).success).toBe(true);
    expect(publishedChartSchema.safeParse({ ...base, series: [{ ...base.series[0], axis: 'right' }] }).success).toBe(true);
  });

  it('rejects oversized or garbage formats and other bad new fields', () => {
    const bad: Array<Record<string, unknown>> = [
      { axisFormats: { left: { type: 'date' } } },
      { axisFormats: { left: { type: 'number', decimals: 11 } } },
      { axisFormats: { left: { type: 'number', decimals: 1.5 } } },
      { axisFormats: { left: { type: 'number', d3Format: 'x'.repeat(25) } } },
      { axisFormats: { left: { type: 'number', d3Format: '$(echo INJECTED)' } } },
      { axisFormats: { left: { type: 'number', d3Format: '<script>INJECTED</script>' } } },
      { axisFormats: { left: { type: 'number', d3Format: '99999999999' } } },
      { axisFormats: { left: { type: 'number', d3Format: 'é' } } },
      { highlightIndex: -1 },
      { highlightIndex: 2.5 },
      { highlightIndex: 100_000 },
      { showLabels: 'yes' },
      { categoryColors: [] },
      { categoryColors: Array.from({ length: 33 }, () => '#112233') },
      { categoryColors: ['red'] },
      { categoryColors: ['#112233"/><script>INJECTED</script>'] },
    ];
    for (const extra of bad) expect(parse(extra).success, JSON.stringify(extra)).toBe(false);
    expect(publishedChartSchema.safeParse({ ...base, series: [{ ...base.series[0], axis: 'top' }] }).success).toBe(false);
  });

  it('strips unknown keys inside a format so nothing else reaches the renderer', () => {
    const parsed = parse({ axisFormats: { left: { type: 'number', decimals: 1, onload: '<script>INJECTED</script>' } } });
    expect(parsed.success && JSON.stringify(parsed.data)).not.toContain('INJECTED');
  });
});
