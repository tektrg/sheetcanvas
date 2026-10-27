import { scaleBand, scaleLinear } from 'd3-scale';
import { arc, area, line, pie } from 'd3-shape';
import { hierarchy, treemap } from 'd3-hierarchy';
import type { PublishedChart, PublishedSeries } from '../../../shared/publishSnapshot';
import { escapeHtml, formatCompact } from './escape';

// DOM-free chart renderer for public pages: d3 computes geometry, we emit an SVG
// string. Mirrors the app's chart types (types.ts ChartType) at a static,
// print-quality level — no tooltips or animation.

export const CHART_WIDTH = 720;
export const CHART_HEIGHT = 360;

/**
 * Geometry for one rendered variant. The SVG scales to its container via viewBox, so the
 * server can't know the on-screen width: pages ship a WIDE and a COMPACT variant and CSS
 * picks one (pageHtml.ts). Both keep axis text >= ~10px on screen across their width band.
 */
export interface ChartLayout {
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
  fontSize: number;
}
export const WIDE_LAYOUT: ChartLayout = { width: CHART_WIDTH, height: CHART_HEIGHT, margin: { top: 16, right: 16, bottom: 56, left: 56 }, fontSize: 13 };
export const COMPACT_LAYOUT: ChartLayout = { width: 360, height: 260, margin: { top: 12, right: 12, bottom: 52, left: 44 }, fontSize: 13 };
// Presentation attributes = light colors (used as-is by the OG PNG renderer).
// HTML pages restyle the cs-* classes via CSS variables for dark mode (pageHtml.ts).
const AXIS_COLOR = '#9ca3af';
const TEXT_COLOR = '#4b5563';
const FONT_FAMILY = 'font-family="system-ui, -apple-system, Segoe UI, sans-serif"';
const font = (layout: ChartLayout) => `${FONT_FAMILY} font-size="${layout.fontSize}"`;
/** Average glyph width as a fraction of font size (system-ui, mixed case). */
export const CHAR_WIDTH_RATIO = 0.6;
const LABEL_GAP = 6;
const ROTATION_DEG = 35;
const MIN_TRUNCATED_CHARS = 4;

type CartesianType = 'line' | 'area' | 'bar';

const valueAt = (chart: PublishedChart, rowIndex: number, seriesIndex: number): number =>
  chart.rows[rowIndex]?.values[seriesIndex] ?? 0;

/** Screen-reader summary: what is plotted, how many points. */
const chartDescription = (chart: PublishedChart): string => {
  const series = chart.series.map(s => s.label).filter(Boolean).join(', ');
  return `${chart.rows.length} data points${series ? ` for ${series}` : ''}.`;
};

const svgOpen = (chart: PublishedChart, { width, height }: ChartLayout) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeHtml(chart.title)}"><title>${escapeHtml(chart.title)}</title><desc>${escapeHtml(chartDescription(chart))}</desc><rect class="cs-bg" width="100%" height="100%" fill="#ffffff"/>`;

const truncateLabel = (label: string, max = 14) => (label.length > max ? `${label.slice(0, max - 1)}…` : label);

const emptyChart = (chart: PublishedChart, layout: ChartLayout) =>
  `${svgOpen(chart, layout)}<text x="${layout.width / 2}" y="${layout.height / 2}" text-anchor="middle" class="cs-text" fill="${TEXT_COLOR}" ${font(layout)}>No data</text></svg>`;

export interface XLabelPlan {
  /** Show every Nth label (index % step === 0). */
  step: number;
  /** Max characters per label before truncating with an ellipsis. */
  maxChars: number;
  rotate: boolean;
}

/**
 * Category axis labels must never overlap: thin to every Nth label until the longest fits
 * its slot; if that would leave < 3 labels, keep 3 and truncate; if truncation would be
 * unreadably short, rotate -35deg (horizontal footprint ~ font-size / sin(35deg)).
 */
export const planXLabels = (labels: string[], slotWidth: number, layout: ChartLayout): XLabelPlan => {
  const n = labels.length;
  const charWidth = layout.fontSize * CHAR_WIDTH_RATIO;
  const longest = Math.max(1, ...labels.map(l => l.length));
  const fits = (step: number) => Math.floor((slotWidth * step - LABEL_GAP) / charWidth);
  const minShown = Math.min(n, 3);
  for (let step = 1; step <= n; step++) {
    if (Math.ceil(n / step) < minShown) break;
    if (fits(step) >= longest) return { step, maxChars: longest, rotate: false };
  }
  const keepStep = Math.max(1, Math.floor((n - 1) / Math.max(1, minShown - 1)));
  if (fits(keepStep) >= MIN_TRUNCATED_CHARS) return { step: keepStep, maxChars: fits(keepStep), rotate: false };
  const sin = Math.sin((ROTATION_DEG * Math.PI) / 180);
  const rotatedStep = Math.max(1, Math.ceil((layout.fontSize * 1.2) / sin / slotWidth));
  const rotatedChars = Math.max(MIN_TRUNCATED_CHARS, Math.floor((layout.margin.bottom - 14) / (charWidth * sin)));
  return { step: rotatedStep, maxChars: Math.min(longest, rotatedChars), rotate: true };
};

/**
 * Emit the planned labels. `bounds` = horizontal room (plot coords) incl. margins; unrotated
 * labels are nudged inside it, and any label a nudge pushed into its neighbour is dropped.
 */
const xLabels = (labels: string[], centerAt: (i: number) => number, y: number, plan: XLabelPlan, layout: ChartLayout, bounds: [number, number]): string[] => {
  const out: string[] = [];
  let prevRight = -Infinity;
  labels.forEach((label, i) => {
    if (i % plan.step !== 0) return;
    const shown = truncateLabel(label, plan.maxChars);
    const half = (shown.length * layout.fontSize * CHAR_WIDTH_RATIO) / 2;
    const x = plan.rotate ? centerAt(i) : Math.min(Math.max(centerAt(i), bounds[0] + half), bounds[1] - half);
    if (!plan.rotate && x - half < prevRight + LABEL_GAP) return;
    prevRight = x + half;
    const title = shown === label ? '' : `<title>${escapeHtml(label)}</title>`;
    const placement = plan.rotate
      ? `x="${x}" y="${y}" text-anchor="end" transform="rotate(-${ROTATION_DEG} ${x} ${y})"`
      : `x="${x}" y="${y}" text-anchor="middle"`;
    out.push(`<text ${placement} class="cs-text cs-xlabel" fill="${TEXT_COLOR}">${title}${escapeHtml(shown)}</text>`);
  });
  return out;
};

const seriesType = (chart: PublishedChart, series: PublishedSeries): CartesianType => {
  const type = series.type ?? chart.type;
  return type === 'line' || type === 'area' ? type : 'bar';
};

/** Per-row stacked baselines for stacked bar/area, keyed by series index. */
const stackOffsets = (chart: PublishedChart): number[][] => {
  const running = chart.rows.map(() => 0);
  return chart.series.map((_, seriesIndex) =>
    chart.rows.map((__, rowIndex) => {
      const base = running[rowIndex];
      running[rowIndex] += valueAt(chart, rowIndex, seriesIndex);
      return base;
    })
  );
};

const renderCartesian = (chart: PublishedChart, layout: ChartLayout): string => {
  const { margin } = layout;
  const innerWidth = layout.width - margin.left - margin.right;
  const innerHeight = layout.height - margin.top - margin.bottom;
  const stacked = !!chart.stacked;
  const offsets = stacked ? stackOffsets(chart) : null;
  const tops = chart.rows.flatMap((row, rowIndex) =>
    chart.series.map((_, s) => (offsets ? offsets[s][rowIndex] : 0) + valueAt(chart, rowIndex, s))
  );
  const yMin = Math.min(0, ...tops);
  const yMax = Math.max(0, ...tops);
  const y = scaleLinear().domain([yMin, yMax === yMin ? yMin + 1 : yMax]).nice().range([innerHeight, 0]);
  const x = scaleBand<number>().domain(chart.rows.map((_, i) => i)).range([0, innerWidth]).padding(0.2);
  const center = (i: number) => (x(i) ?? 0) + x.bandwidth() / 2;

  const parts: string[] = [svgOpen(chart, layout), `<g transform="translate(${margin.left},${margin.top})" ${font(layout)}>`];
  for (const tick of y.ticks(5)) {
    parts.push(
      `<line x1="0" x2="${innerWidth}" y1="${y(tick)}" y2="${y(tick)}" class="cs-grid" stroke="#e5e7eb"/>`,
      `<text x="-8" y="${y(tick)}" dy="0.32em" text-anchor="end" class="cs-text" fill="${TEXT_COLOR}">${escapeHtml(formatCompact(tick))}</text>`
    );
  }
  const plan = planXLabels(chart.rows.map(r => r.label), x.step(), layout);
  parts.push(...xLabels(chart.rows.map(r => r.label), center, innerHeight + layout.fontSize + 6, plan, layout, [2 - margin.left, innerWidth + margin.right - 2]));
  parts.push(`<line x1="0" x2="${innerWidth}" y1="${y(0)}" y2="${y(0)}" class="cs-axis" stroke="${AXIS_COLOR}"/>`);

  const barSeries = chart.series.map((s, i) => ({ s, i })).filter(({ s }) => seriesType(chart, s) === 'bar');
  const groupWidth = x.bandwidth() / (stacked ? 1 : Math.max(1, barSeries.length));
  barSeries.forEach(({ s, i }, barIndex) => {
    chart.rows.forEach((_, rowIndex) => {
      const base = offsets ? offsets[i][rowIndex] : 0;
      const value = valueAt(chart, rowIndex, i);
      const y0 = y(base);
      const y1 = y(base + value);
      const left = (x(rowIndex) ?? 0) + (stacked ? 0 : barIndex * groupWidth);
      parts.push(
        `<rect x="${left}" y="${Math.min(y0, y1)}" width="${Math.max(1, groupWidth - 1)}" height="${Math.abs(y1 - y0)}" fill="${s.color}"/>`
      );
    });
  });

  chart.series.forEach((s, i) => {
    const type = seriesType(chart, s);
    if (type === 'bar') return;
    const base = (rowIndex: number) => (offsets ? offsets[i][rowIndex] : 0);
    const top = (rowIndex: number) => y(base(rowIndex) + valueAt(chart, rowIndex, i));
    const indices = chart.rows.map((_, rowIndex) => rowIndex);
    if (type === 'area') {
      const path = area<number>().x(center).y0(r => y(base(r))).y1(top)(indices);
      parts.push(`<path d="${path}" fill="${s.color}" fill-opacity="0.25" stroke="none"/>`);
    }
    const path = line<number>().x(center).y(top)(indices);
    parts.push(`<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2"/>`);
  });

  parts.push('</g>', legend(chart.series, layout), '</svg>');
  return parts.join('');
};

const legend = (series: PublishedSeries[], layout: ChartLayout): string => {
  if (series.length < 2) return '';
  const fontSize = layout.fontSize - 1;
  let cursor = layout.margin.left;
  const items = series.slice(0, 8).map(s => {
    const label = truncateLabel(s.label, 20);
    const item = `<rect x="${cursor}" y="${layout.height - 16}" width="10" height="10" fill="${s.color}"/><text x="${cursor + 14}" y="${layout.height - 7}" class="cs-text" fill="${TEXT_COLOR}">${escapeHtml(label)}</text>`;
    cursor += 24 + label.length * fontSize * CHAR_WIDTH_RATIO;
    return item;
  });
  return `<g ${FONT_FAMILY} font-size="${fontSize}">${items.join('')}</g>`;
};

const renderScatter = (chart: PublishedChart, layout: ChartLayout): string => {
  const { margin } = layout;
  const innerWidth = layout.width - margin.left - margin.right;
  const innerHeight = layout.height - margin.top - margin.bottom;
  const xs = chart.rows.map((row, i) => {
    const numeric = Number(row.label);
    return Number.isFinite(numeric) ? numeric : i;
  });
  const values = chart.rows.flatMap((row) => row.values.filter((v): v is number => v !== null));
  const x = scaleLinear().domain([Math.min(...xs), Math.max(...xs)]).nice().range([0, innerWidth]);
  const y = scaleLinear().domain([Math.min(0, ...values), Math.max(1, ...values)]).nice().range([innerHeight, 0]);
  const parts = [svgOpen(chart, layout), `<g transform="translate(${margin.left},${margin.top})" ${font(layout)}>`];
  for (const tick of y.ticks(5)) {
    parts.push(
      `<line x1="0" x2="${innerWidth}" y1="${y(tick)}" y2="${y(tick)}" class="cs-grid" stroke="#e5e7eb"/>`,
      `<text x="-8" y="${y(tick)}" dy="0.32em" text-anchor="end" class="cs-text" fill="${TEXT_COLOR}">${escapeHtml(formatCompact(tick))}</text>`
    );
  }
  const xTickCount = Math.max(2, Math.floor(innerWidth / (layout.fontSize * CHAR_WIDTH_RATIO * 6 + LABEL_GAP)));
  for (const tick of x.ticks(Math.min(8, xTickCount))) {
    parts.push(`<text x="${x(tick)}" y="${innerHeight + layout.fontSize + 6}" text-anchor="middle" class="cs-text" fill="${TEXT_COLOR}">${escapeHtml(formatCompact(tick))}</text>`);
  }
  chart.series.forEach((s, seriesIndex) => {
    chart.rows.forEach((row, i) => {
      const value = row.values[seriesIndex];
      if (value === null || value === undefined) return;
      parts.push(`<circle cx="${x(xs[i])}" cy="${y(value)}" r="3.5" fill="${s.color}" fill-opacity="0.8"/>`);
    });
  });
  parts.push('</g>', legend(chart.series, layout), '</svg>');
  return parts.join('');
};

const sliceColor = (chart: PublishedChart, index: number) => chart.series[index % chart.series.length]?.color ?? '#6366f1';

/** Pie/treemap encode one series across rows; colors cycle a palette derived from series colors. */
const categoryPalette = (chart: PublishedChart): string[] => {
  const base = chart.series.map(s => s.color);
  const fallback = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#84cc16', '#ec4899'];
  return base.length > 1 ? base : [base[0] ?? fallback[0], ...fallback.filter(c => c !== base[0])];
};

const renderPie = (chart: PublishedChart, layout: ChartLayout): string => {
  const palette = categoryPalette(chart);
  const radius = Math.min(layout.width, layout.height) / 2 - 24;
  const slices = pie<{ label: string; value: number }>().value(d => d.value).sort(null)(
    chart.rows.map((row) => ({ label: row.label, value: Math.max(0, row.values[0] ?? 0) }))
  );
  const arcPath = arc<(typeof slices)[number]>().innerRadius(0).outerRadius(radius);
  const parts = [svgOpen(chart, layout), `<g transform="translate(${layout.width / 2},${layout.height / 2})" ${font(layout)}>`];
  slices.forEach((slice, i) => {
    parts.push(`<path d="${arcPath(slice)}" fill="${palette[i % palette.length]}" class="cs-sep" stroke="#ffffff"/>`);
    if (slice.endAngle - slice.startAngle > 0.25) {
      const [cx, cy] = arc<(typeof slices)[number]>().innerRadius(radius * 0.6).outerRadius(radius * 0.6).centroid(slice);
      parts.push(`<text x="${cx}" y="${cy}" text-anchor="middle" fill="#ffffff">${escapeHtml(truncateLabel(slice.data.label, 12))}</text>`);
    }
  });
  parts.push('</g></svg>');
  return parts.join('');
};

const renderTreemap = (chart: PublishedChart, layout: ChartLayout): string => {
  const palette = categoryPalette(chart);
  type Leaf = { label: string; value: number };
  const root = hierarchy<{ children?: Leaf[] } & Partial<Leaf>>({
    children: chart.rows.map(row => ({ label: row.label, value: Math.max(0, row.values[0] ?? 0) })),
  })
    .sum(d => d.value ?? 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const laidOut = treemap<{ children?: Leaf[] } & Partial<Leaf>>().size([layout.width, layout.height]).paddingInner(2)(root);
  const parts = [svgOpen(chart, layout), `<g ${font(layout)}>`];
  laidOut.leaves().forEach((leaf, i) => {
    const width = leaf.x1 - leaf.x0;
    const height = leaf.y1 - leaf.y0;
    parts.push(`<rect x="${leaf.x0}" y="${leaf.y0}" width="${width}" height="${height}" fill="${palette[i % palette.length] ?? sliceColor(chart, i)}"/>`);
    if (width > 50 && height > 18) {
      parts.push(`<text x="${leaf.x0 + 6}" y="${leaf.y0 + 15}" fill="#ffffff">${escapeHtml(truncateLabel(leaf.data.label ?? '', Math.floor((width - 12) / (layout.fontSize * CHAR_WIDTH_RATIO))))}</text>`);
    }
  });
  parts.push('</g></svg>');
  return parts.join('');
};

/** Render one published chart to a standalone SVG string. */
export const renderChartSvg = (chart: PublishedChart, layout: ChartLayout = WIDE_LAYOUT): string => {
  if (chart.rows.length === 0 || chart.series.length === 0) return emptyChart(chart, layout);
  switch (chart.type) {
    case 'pie':
      return renderPie(chart, layout);
    case 'treemap':
      return renderTreemap(chart, layout);
    case 'scatter':
      return renderScatter(chart, layout);
    default:
      return renderCartesian(chart, layout);
  }
};
