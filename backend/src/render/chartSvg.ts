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
const MARGIN = { top: 16, right: 16, bottom: 48, left: 56 };
const AXIS_COLOR = '#9ca3af';
const TEXT_COLOR = '#4b5563';
const FONT = 'font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="11"';
const MAX_X_TICKS = 12;

type CartesianType = 'line' | 'area' | 'bar';

const valueAt = (chart: PublishedChart, rowIndex: number, seriesIndex: number): number =>
  chart.rows[rowIndex]?.values[seriesIndex] ?? 0;

/** Screen-reader summary: what is plotted, how many points. */
const chartDescription = (chart: PublishedChart): string => {
  const series = chart.series.map(s => s.label).filter(Boolean).join(', ');
  return `${chart.rows.length} data points${series ? ` for ${series}` : ''}.`;
};

const svgOpen = (chart: PublishedChart, width = CHART_WIDTH, height = CHART_HEIGHT) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeHtml(chart.title)}"><title>${escapeHtml(chart.title)}</title><desc>${escapeHtml(chartDescription(chart))}</desc><rect width="100%" height="100%" fill="#ffffff"/>`;

const truncateLabel = (label: string, max = 14) => (label.length > max ? `${label.slice(0, max - 1)}…` : label);

const emptyChart = (chart: PublishedChart) =>
  `${svgOpen(chart)}<text x="${CHART_WIDTH / 2}" y="${CHART_HEIGHT / 2}" text-anchor="middle" fill="${TEXT_COLOR}" ${FONT}>No data</text></svg>`;

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

const renderCartesian = (chart: PublishedChart): string => {
  const innerWidth = CHART_WIDTH - MARGIN.left - MARGIN.right;
  const innerHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;
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

  const parts: string[] = [svgOpen(chart), `<g transform="translate(${MARGIN.left},${MARGIN.top})" ${FONT}>`];
  for (const tick of y.ticks(5)) {
    parts.push(
      `<line x1="0" x2="${innerWidth}" y1="${y(tick)}" y2="${y(tick)}" stroke="#e5e7eb"/>`,
      `<text x="-8" y="${y(tick)}" dy="0.32em" text-anchor="end" fill="${TEXT_COLOR}">${escapeHtml(formatCompact(tick))}</text>`
    );
  }
  const labelStep = Math.max(1, Math.ceil(chart.rows.length / MAX_X_TICKS));
  chart.rows.forEach((row, i) => {
    if (i % labelStep !== 0) return;
    parts.push(
      `<text x="${center(i)}" y="${innerHeight + 18}" text-anchor="middle" fill="${TEXT_COLOR}">${escapeHtml(truncateLabel(row.label))}</text>`
    );
  });
  parts.push(`<line x1="0" x2="${innerWidth}" y1="${y(0)}" y2="${y(0)}" stroke="${AXIS_COLOR}"/>`);

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

  parts.push('</g>', legend(chart.series), '</svg>');
  return parts.join('');
};

const legend = (series: PublishedSeries[]): string => {
  if (series.length < 2) return '';
  let cursor = MARGIN.left;
  const items = series.slice(0, 8).map(s => {
    const label = truncateLabel(s.label, 20);
    const item = `<rect x="${cursor}" y="${CHART_HEIGHT - 16}" width="10" height="10" fill="${s.color}"/><text x="${cursor + 14}" y="${CHART_HEIGHT - 7}" fill="${TEXT_COLOR}">${escapeHtml(label)}</text>`;
    cursor += 24 + label.length * 6.5;
    return item;
  });
  return `<g ${FONT}>${items.join('')}</g>`;
};

const renderScatter = (chart: PublishedChart): string => {
  const innerWidth = CHART_WIDTH - MARGIN.left - MARGIN.right;
  const innerHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;
  const xs = chart.rows.map((row, i) => {
    const numeric = Number(row.label);
    return Number.isFinite(numeric) ? numeric : i;
  });
  const values = chart.rows.flatMap((row) => row.values.filter((v): v is number => v !== null));
  const x = scaleLinear().domain([Math.min(...xs), Math.max(...xs)]).nice().range([0, innerWidth]);
  const y = scaleLinear().domain([Math.min(0, ...values), Math.max(1, ...values)]).nice().range([innerHeight, 0]);
  const parts = [svgOpen(chart), `<g transform="translate(${MARGIN.left},${MARGIN.top})" ${FONT}>`];
  for (const tick of y.ticks(5)) {
    parts.push(
      `<line x1="0" x2="${innerWidth}" y1="${y(tick)}" y2="${y(tick)}" stroke="#e5e7eb"/>`,
      `<text x="-8" y="${y(tick)}" dy="0.32em" text-anchor="end" fill="${TEXT_COLOR}">${escapeHtml(formatCompact(tick))}</text>`
    );
  }
  for (const tick of x.ticks(8)) {
    parts.push(`<text x="${x(tick)}" y="${innerHeight + 18}" text-anchor="middle" fill="${TEXT_COLOR}">${escapeHtml(formatCompact(tick))}</text>`);
  }
  chart.series.forEach((s, seriesIndex) => {
    chart.rows.forEach((row, i) => {
      const value = row.values[seriesIndex];
      if (value === null || value === undefined) return;
      parts.push(`<circle cx="${x(xs[i])}" cy="${y(value)}" r="3.5" fill="${s.color}" fill-opacity="0.8"/>`);
    });
  });
  parts.push('</g>', legend(chart.series), '</svg>');
  return parts.join('');
};

const sliceColor = (chart: PublishedChart, index: number) => chart.series[index % chart.series.length]?.color ?? '#6366f1';

/** Pie/treemap encode one series across rows; colors cycle a palette derived from series colors. */
const categoryPalette = (chart: PublishedChart): string[] => {
  const base = chart.series.map(s => s.color);
  const fallback = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#84cc16', '#ec4899'];
  return base.length > 1 ? base : [base[0] ?? fallback[0], ...fallback.filter(c => c !== base[0])];
};

const renderPie = (chart: PublishedChart): string => {
  const palette = categoryPalette(chart);
  const radius = Math.min(CHART_WIDTH, CHART_HEIGHT) / 2 - 24;
  const slices = pie<{ label: string; value: number }>().value(d => d.value).sort(null)(
    chart.rows.map((row) => ({ label: row.label, value: Math.max(0, row.values[0] ?? 0) }))
  );
  const arcPath = arc<(typeof slices)[number]>().innerRadius(0).outerRadius(radius);
  const parts = [svgOpen(chart), `<g transform="translate(${CHART_WIDTH / 2},${CHART_HEIGHT / 2})" ${FONT}>`];
  slices.forEach((slice, i) => {
    parts.push(`<path d="${arcPath(slice)}" fill="${palette[i % palette.length]}" stroke="#ffffff"/>`);
    if (slice.endAngle - slice.startAngle > 0.25) {
      const [cx, cy] = arc<(typeof slices)[number]>().innerRadius(radius * 0.6).outerRadius(radius * 0.6).centroid(slice);
      parts.push(`<text x="${cx}" y="${cy}" text-anchor="middle" fill="#ffffff">${escapeHtml(truncateLabel(slice.data.label, 12))}</text>`);
    }
  });
  parts.push('</g></svg>');
  return parts.join('');
};

const renderTreemap = (chart: PublishedChart): string => {
  const palette = categoryPalette(chart);
  type Leaf = { label: string; value: number };
  const root = hierarchy<{ children?: Leaf[] } & Partial<Leaf>>({
    children: chart.rows.map(row => ({ label: row.label, value: Math.max(0, row.values[0] ?? 0) })),
  })
    .sum(d => d.value ?? 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const laidOut = treemap<{ children?: Leaf[] } & Partial<Leaf>>().size([CHART_WIDTH, CHART_HEIGHT]).paddingInner(2)(root);
  const parts = [svgOpen(chart), `<g ${FONT}>`];
  laidOut.leaves().forEach((leaf, i) => {
    const width = leaf.x1 - leaf.x0;
    const height = leaf.y1 - leaf.y0;
    parts.push(`<rect x="${leaf.x0}" y="${leaf.y0}" width="${width}" height="${height}" fill="${palette[i % palette.length] ?? sliceColor(chart, i)}"/>`);
    if (width > 50 && height > 18) {
      parts.push(`<text x="${leaf.x0 + 6}" y="${leaf.y0 + 15}" fill="#ffffff">${escapeHtml(truncateLabel(leaf.data.label ?? '', Math.floor(width / 7)))}</text>`);
    }
  });
  parts.push('</g></svg>');
  return parts.join('');
};

/** Render one published chart to a standalone SVG string. */
export const renderChartSvg = (chart: PublishedChart): string => {
  if (chart.rows.length === 0 || chart.series.length === 0) return emptyChart(chart);
  switch (chart.type) {
    case 'pie':
      return renderPie(chart);
    case 'treemap':
      return renderTreemap(chart);
    case 'scatter':
      return renderScatter(chart);
    default:
      return renderCartesian(chart);
  }
};
