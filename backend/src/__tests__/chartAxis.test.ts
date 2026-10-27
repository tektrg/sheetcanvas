import { describe, expect, it } from 'vitest';
import type { PublishedChart } from '../../../shared/publishSnapshot';
import { CHAR_WIDTH_RATIO, COMPACT_LAYOUT, planXLabels, renderChartSvg, WIDE_LAYOUT, type ChartLayout } from '../render/chartSvg';

const chart = (labels: string[]): PublishedChart => ({
  id: 'c', title: 'Revenue', type: 'bar',
  series: [{ label: 'Revenue', color: '#6366f1' }],
  rows: labels.map((label, i) => ({ label, values: [i + 1] })),
} as PublishedChart);

/** Horizontal extent of each x-axis label, estimated the same way a browser lays out system-ui. */
const labelBoxes = (svg: string, layout: ChartLayout) =>
  [...svg.matchAll(/<text x="([\d.]+)" y="[\d.]+" text-anchor="(middle|end)"[^>]*class="cs-text cs-xlabel"[^>]*>(?:<title>[^<]*<\/title>)?([^<]*)<\/text>/g)].map(m => {
    const x = Number(m[1]);
    const width = m[3].length * layout.fontSize * CHAR_WIDTH_RATIO;
    return m[2] === 'middle' ? { left: x - width / 2, right: x + width / 2 } : { left: x - width, right: x };
  });

// Viewport -> rendered SVG width (16px page gutters) and the variant CSS shows there.
const viewports = [
  { viewport: 320, shown: 288, layout: COMPACT_LAYOUT },
  { viewport: 600, shown: 568, layout: WIDE_LAYOUT },
  { viewport: 760, shown: 728, layout: WIDE_LAYOUT },
];

describe('chart x-axis labels', () => {
  const months = Array.from({ length: 12 }, (_, i) => `Month ${i + 1}`);
  for (const { viewport, shown, layout } of viewports) {
    it(`never overlap and stay readable at ${viewport}px`, () => {
      const boxes = labelBoxes(renderChartSvg(chart(months), layout), layout);
      expect(boxes.length).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < boxes.length; i++) expect(boxes[i].left).toBeGreaterThan(boxes[i - 1].right);
      expect((layout.fontSize * Math.min(shown, layout.width)) / layout.width).toBeGreaterThanOrEqual(9.5);
    });
  }

  it('truncates very long labels with a full-text <title>', () => {
    const long = Array.from({ length: 4 }, (_, i) => `A really very long category name number ${i}`);
    const svg = renderChartSvg(chart(long), COMPACT_LAYOUT);
    expect(svg).toContain('…');
    expect(svg).toContain(`<title>${long[0]}</title>`);
    const boxes = labelBoxes(svg, COMPACT_LAYOUT);
    for (let i = 1; i < boxes.length; i++) expect(boxes[i].left).toBeGreaterThan(boxes[i - 1].right);
  });

  it('thins dense axes instead of overlapping', () => {
    const many = Array.from({ length: 200 }, (_, i) => `Category ${i}`);
    const boxes = labelBoxes(renderChartSvg(chart(many), COMPACT_LAYOUT), COMPACT_LAYOUT);
    expect(boxes.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < boxes.length; i++) expect(boxes[i].left).toBeGreaterThan(boxes[i - 1].right);
  });

  it('rotates only when 3 truncated labels would be unreadably short', () => {
    expect(planXLabels(['Alpha beta', 'Gamma delta', 'Epsilon'], 12, COMPACT_LAYOUT).rotate).toBe(true);
    expect(planXLabels(['Jan', 'Feb', 'Mar'], 80, COMPACT_LAYOUT)).toEqual({ step: 1, maxChars: 3, rotate: false });
  });

  it('keeps edge labels inside the SVG', () => {
    const long = Array.from({ length: 4 }, (_, i) => `A really very long category name number ${i}`);
    for (const layout of [COMPACT_LAYOUT, WIDE_LAYOUT]) {
      const boxes = labelBoxes(renderChartSvg(chart(long), layout), layout);
      expect(boxes[0].left + layout.margin.left).toBeGreaterThanOrEqual(0);
      expect(boxes[boxes.length - 1].right + layout.margin.left).toBeLessThanOrEqual(layout.width);
    }
  });
});
