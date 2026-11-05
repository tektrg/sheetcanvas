import { scaleBand, scaleLinear, type ScaleLinear } from 'd3-scale';
import { arc, area, curveMonotoneX, line, pie } from 'd3-shape';
import { hierarchy, treemap } from 'd3-hierarchy';
import type { PublishedChart, PublishedFormat, PublishedSeries } from '../../../shared/publishSnapshot';
import {
  CHART_BAR_RADIUS,
  CHART_DOT_RADIUS,
  CHART_DOT_STROKE_WIDTH,
  CHART_HIGHLIGHT_COLOR,
  CHART_LINE_STROKE_WIDTH,
  CHART_PIE_STROKE_WIDTH,
  getAreaGradientStops,
} from '../../../shared/chartStyle';
import { formatAxisTickValue, formatLabelValue } from '../../../shared/valueFormat';
import { escapeHtml } from './escape';

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

type AxisSide = 'left' | 'right';
type Scale = ScaleLinear<number, number>;

/** min/max without spreading (a 20k-row x 50-series chart would overflow the argument limit). */
const extent = (values: Iterable<number>, floor = 0): [number, number] => {
  let lo = floor;
  let hi = floor;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
};

const axisScale = (values: number[], height: number): Scale => {
  const [lo, hi] = extent(values);
  return scaleLinear().domain([lo, hi === lo ? lo + 1 : hi]).nice().range([height, 0]);
};

/** Element ids must be unique per page: both SVG variants of every chart share one document. */
const hash36 = (value: string): string => {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) hash = ((hash * 33) ^ value.charCodeAt(i)) >>> 0;
  return hash.toString(36);
};
const chartUid = (chart: PublishedChart, layout: ChartLayout) =>
  `${chart.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24)}-${hash36(chart.id)}-${layout.width}`;

/** Per-series baseline/top of every row. Bar/area stack per axis (positives up, negatives down); lines never stack. */
const stackSeries = (chart: PublishedChart, sideOf: (i: number) => AxisSide, stackable: boolean[]) => {
  const rows = chart.rows.length;
  const run = {
    left: { pos: new Array<number>(rows).fill(0), neg: new Array<number>(rows).fill(0) },
    right: { pos: new Array<number>(rows).fill(0), neg: new Array<number>(rows).fill(0) },
  };
  const bases: number[][] = [];
  const tops: number[][] = [];
  chart.series.forEach((_, i) => {
    const base = new Array<number>(rows).fill(0);
    const top = new Array<number>(rows).fill(0);
    for (let r = 0; r < rows; r++) {
      const value = valueAt(chart, r, i);
      if (stackable[i]) {
        const acc = run[sideOf(i)];
        const bucket = value < 0 ? acc.neg : acc.pos;
        base[r] = bucket[r];
        bucket[r] += value;
      }
      top[r] = base[r] + value;
    }
    bases.push(base);
    tops.push(top);
  });
  return { bases, tops };
};

/** Bar outline with only the far end rounded (canvas barRadius); `r` = 0 gives a plain rectangle. */
const barShape = (x: number, yTop: number, yBottom: number, width: number, radius: number, roundBottom: boolean, attrs: string): string => {
  const height = yBottom - yTop;
  const r = Math.max(0, Math.min(radius, width / 2, height));
  if (r < 0.5) return `<rect x="${x}" y="${yTop}" width="${width}" height="${height}" ${attrs}/>`;
  const right = x + width;
  const d = roundBottom
    ? `M${x},${yTop}V${yBottom - r}A${r},${r} 0 0 0 ${x + r},${yBottom}H${right - r}A${r},${r} 0 0 0 ${right},${yBottom - r}V${yTop}Z`
    : `M${x},${yBottom}V${yTop + r}A${r},${r} 0 0 1 ${x + r},${yTop}H${right - r}A${r},${r} 0 0 1 ${right},${yTop + r}V${yBottom}Z`;
  return `<path d="${d}" ${attrs}/>`;
};

/** Value labels that never overlap each other (first placed wins) or leave the drawing. */
const createLabelPlacer = (layout: ChartLayout, bounds: { left: number; right: number; top: number }) => {
  const size = Math.max(9, layout.fontSize - 3);
  const boxes: Array<{ l: number; r: number; t: number; b: number }> = [];
  return (cx: number, baseline: number, text: string, fill?: string): string => {
    const half = (text.length * size * CHAR_WIDTH_RATIO) / 2;
    const box = { l: cx - half, r: cx + half, t: baseline - size, b: baseline + 2 };
    if (box.l < bounds.left || box.r > bounds.right || box.t < bounds.top) return '';
    if (boxes.some(o => box.l < o.r + 2 && box.r > o.l - 2 && box.t < o.b && box.b > o.t)) return '';
    boxes.push(box);
    const color = fill ? `fill="${fill}"` : `class="cs-text" fill="${TEXT_COLOR}"`;
    return `<text x="${cx}" y="${baseline}" text-anchor="middle" font-size="${size}" font-weight="500" ${color}>${escapeHtml(text)}</text>`;
  };
};

const MAX_DOT_ROWS = 60;

const renderCartesian = (chart: PublishedChart, baseLayout: ChartLayout): string => {
  const rowCount = chart.rows.length;
  const sideOf = (i: number): AxisSide => (chart.series[i].axis === 'right' ? 'right' : 'left');
  const types = chart.series.map(s => seriesType(chart, s));
  const stackable = types.map(type => !!chart.stacked && (type === 'bar' || type === 'area'));
  const { bases, tops } = stackSeries(chart, sideOf, stackable);
  const fmt: Record<AxisSide, PublishedFormat | undefined> = { left: chart.axisFormats?.left, right: chart.axisFormats?.right };

  const innerHeight = baseLayout.height - baseLayout.margin.top - baseLayout.margin.bottom;
  const scaleFor = (side: AxisSide): Scale | null => {
    const members = chart.series.map((_, i) => i).filter(i => sideOf(i) === side);
    return members.length ? axisScale(members.flatMap(i => [...bases[i], ...tops[i]]), innerHeight) : null;
  };
  const scales: Record<AxisSide, Scale | null> = { left: scaleFor('left'), right: scaleFor('right') };
  const scaleOf = (i: number) => scales[sideOf(i)] ?? scales.left ?? (scales.right as Scale);
  const gridScale = (scales.left ?? scales.right) as Scale;

  // Margins grow to fit the tick labels (currency/percent ticks are wider than "1.2K"); a side with
  // no series gets none. With plain compact ticks this stays at the layout's own margins.
  const cap = baseLayout.width * 0.28;
  const tickRoom = (side: AxisSide, own: number) => {
    const scale = scales[side];
    if (!scale) return null;
    const chars = Math.max(...scale.ticks(5).map(t => formatAxisTickValue(t, fmt[side]).length));
    return Math.min(cap, Math.max(own, chars * baseLayout.fontSize * CHAR_WIDTH_RATIO + 10));
  };
  const layout: ChartLayout = {
    ...baseLayout,
    margin: {
      ...baseLayout.margin,
      left: tickRoom('left', baseLayout.margin.left) ?? Math.min(baseLayout.margin.left, 16),
      right: tickRoom('right', baseLayout.margin.right) ?? baseLayout.margin.right,
    },
  };
  const { margin } = layout;
  const innerWidth = layout.width - margin.left - margin.right;
  const x = scaleBand<number>().domain(chart.rows.map((_, i) => i)).range([0, innerWidth]).padding(0.2);
  const center = (i: number) => (x(i) ?? 0) + x.bandwidth() / 2;
  const uid = chartUid(chart, layout);
  const indices = chart.rows.map((_, i) => i);
  const single = chart.series.length === 1;
  const highlight = single ? chart.highlightIndex : undefined;

  const defs: string[] = [];
  const parts: string[] = [`<g transform="translate(${margin.left},${margin.top})" ${font(layout)}>`];
  for (const tick of gridScale.ticks(5)) {
    parts.push(`<line x1="0" x2="${innerWidth}" y1="${gridScale(tick)}" y2="${gridScale(tick)}" class="cs-grid" stroke="#e5e7eb" stroke-dasharray="4 6"/>`);
  }
  (['left', 'right'] as const).forEach(side => {
    const scale = scales[side];
    if (!scale) return;
    const placement = side === 'left' ? `x="-8" text-anchor="end"` : `x="${innerWidth + 8}" text-anchor="start"`;
    for (const tick of scale.ticks(5)) {
      parts.push(`<text ${placement} y="${scale(tick)}" dy="0.32em" class="cs-text" fill="${TEXT_COLOR}">${escapeHtml(formatAxisTickValue(tick, fmt[side]))}</text>`);
    }
  });
  const plan = planXLabels(chart.rows.map(r => r.label), x.step(), layout);
  parts.push(...xLabels(chart.rows.map(r => r.label), center, innerHeight + layout.fontSize + 6, plan, layout, [2 - margin.left, innerWidth + margin.right - 2]));
  parts.push(`<line x1="0" x2="${innerWidth}" y1="${gridScale(0)}" y2="${gridScale(0)}" class="cs-axis" stroke="${AXIS_COLOR}"/>`);

  // Paint order like the canvas: areas, then bars, then lines (and their dots) on top.
  chart.series.forEach((s, i) => {
    if (types[i] !== 'area') return;
    const scale = scaleOf(i);
    const gradient = getAreaGradientStops(s.color, false);
    const id = `cs-ag-${uid}-${i}`;
    defs.push(
      `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stop-color="${gradient.startColor}" stop-opacity="${gradient.startOpacity}"/><stop offset="95%" stop-color="${gradient.endColor}" stop-opacity="${gradient.endOpacity}"/></linearGradient>`
    );
    const fill = area<number>().curve(curveMonotoneX).x(center).y0(r => scale(bases[i][r])).y1(r => scale(tops[i][r]))(indices);
    parts.push(`<path d="${fill}" fill="url(#${id})" stroke="none"/>`);
    const edge = line<number>().curve(curveMonotoneX).x(center).y(r => scale(tops[i][r]))(indices);
    parts.push(`<path d="${edge}" fill="none" stroke="${s.color}" stroke-width="${CHART_LINE_STROKE_WIDTH}" stroke-linejoin="round" stroke-linecap="round"/>`);
  });

  const barSeries = chart.series.map((_, i) => i).filter(i => types[i] === 'bar');
  // Stacked bars share a slot per axis (left and right stacks sit side by side); plain bars get one slot each.
  const slotKeys: Array<AxisSide | number> = chart.stacked ? [...new Set(barSeries.map(sideOf))] : barSeries;
  const slotWidth = x.bandwidth() / Math.max(1, slotKeys.length);
  const barGeometry = new Map<string, { left: number; width: number; y0: number; y1: number }>();
  barSeries.forEach(i => {
    const scale = scaleOf(i);
    const slot = chart.stacked ? slotKeys.indexOf(sideOf(i)) : slotKeys.indexOf(i);
    for (let r = 0; r < rowCount; r++) {
      const y0 = scale(bases[i][r]);
      const y1 = scale(tops[i][r]);
      const left = (x(r) ?? 0) + slot * slotWidth;
      const width = Math.max(1, slotWidth - 1);
      barGeometry.set(`${i}:${r}`, { left, width, y0, y1 });
      const color = highlight === r ? CHART_HIGHLIGHT_COLOR : chart.series[i].color;
      // Stacked segments get a hairline separator (canvas: mono stacks) and square corners; plain bars round the far end.
      const attrs = chart.stacked
        ? `fill="${color}" class="cs-sep" stroke="#ffffff" stroke-width="1"`
        : `fill="${color}"`;
      const value = valueAt(chart, r, i);
      parts.push(barShape(left, Math.min(y0, y1), Math.max(y0, y1), width, chart.stacked ? 0 : CHART_BAR_RADIUS, value < 0, attrs));
    }
  });

  chart.series.forEach((s, i) => {
    if (types[i] !== 'line') return;
    const scale = scaleOf(i);
    const path = line<number>().curve(curveMonotoneX).x(center).y(r => scale(tops[i][r]))(indices);
    parts.push(`<path d="${path}" fill="none" stroke="${s.color}" stroke-width="${CHART_LINE_STROKE_WIDTH}" stroke-linejoin="round" stroke-linecap="round"/>`);
    if (rowCount <= MAX_DOT_ROWS) {
      for (let r = 0; r < rowCount; r++) {
        const marked = highlight === r;
        parts.push(
          `<circle cx="${center(r)}" cy="${scale(tops[i][r])}" r="${marked ? CHART_DOT_RADIUS + 2 : CHART_DOT_RADIUS}" ${marked ? `fill="${CHART_HIGHLIGHT_COLOR}"` : 'class="cs-dot" fill="#ffffff"'} stroke="${s.color}" stroke-width="${CHART_DOT_STROKE_WIDTH}"/>`
        );
      }
    }
  });

  if (chart.showLabels) {
    const place = createLabelPlacer(layout, { left: -margin.left + 2, right: innerWidth + margin.right - 2, top: -margin.top + 2 });
    const labelSize = Math.max(9, layout.fontSize - 3);
    chart.series.forEach((_, i) => {
      const scale = scaleOf(i);
      const side = sideOf(i);
      for (let r = 0; r < rowCount; r++) {
        const raw = chart.rows[r].values[i];
        if (raw === null || raw === undefined) continue;
        const text = formatLabelValue(raw, fmt[side]);
        const bar = barGeometry.get(`${i}:${r}`);
        if (bar && chart.stacked) {
          // Inside the segment, white, only when it is tall/wide enough to hold the text.
          const height = Math.abs(bar.y1 - bar.y0);
          if (height < labelSize + 2 || text.length * labelSize * CHAR_WIDTH_RATIO > bar.width) continue;
          parts.push(place(bar.left + bar.width / 2, (bar.y0 + bar.y1) / 2 + labelSize * 0.35, text, '#ffffff'));
        } else if (bar) {
          const cx = bar.left + bar.width / 2;
          parts.push(raw < 0 ? place(cx, Math.max(bar.y0, bar.y1) + labelSize + 2, text) : place(cx, Math.min(bar.y0, bar.y1) - 4, text));
        } else {
          parts.push(place(center(r), scale(tops[i][r]) - 10, text));
        }
      }
    });
  }

  parts.push('</g>', legend(chart.series, layout), '</svg>');
  return [svgOpen(chart, layout), defs.length ? `<defs>${defs.join('')}</defs>` : '', ...parts].join('');
};

const legend = (series: PublishedSeries[], layout: ChartLayout): string => {
  if (series.length < 2) return '';
  const fontSize = layout.fontSize - 1;
  let cursor = layout.margin.left;
  const items = series.slice(0, 8).map(s => {
    const label = truncateLabel(s.label, 20);
    const item = `<circle cx="${cursor + 4}" cy="${layout.height - 11}" r="4" fill="${s.color}"/><text x="${cursor + 14}" y="${layout.height - 7}" class="cs-text" fill="${TEXT_COLOR}">${escapeHtml(label)}</text>`;
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
  const [xLo, xHi] = extent(xs, xs[0] ?? 0);
  const [yLo, yHi] = extent(values);
  const x = scaleLinear().domain([xLo, xHi]).nice().range([0, innerWidth]);
  const y = scaleLinear().domain([Math.min(0, yLo), Math.max(1, yHi)]).nice().range([innerHeight, 0]);
  const format = chart.axisFormats?.left;
  const parts = [svgOpen(chart, layout), `<g transform="translate(${margin.left},${margin.top})" ${font(layout)}>`];
  for (const tick of y.ticks(5)) {
    parts.push(
      `<line x1="0" x2="${innerWidth}" y1="${y(tick)}" y2="${y(tick)}" class="cs-grid" stroke="#e5e7eb" stroke-dasharray="4 6"/>`,
      `<text x="-8" y="${y(tick)}" dy="0.32em" text-anchor="end" class="cs-text" fill="${TEXT_COLOR}">${escapeHtml(formatAxisTickValue(tick, format))}</text>`
    );
  }
  const xTickCount = Math.max(2, Math.floor(innerWidth / (layout.fontSize * CHAR_WIDTH_RATIO * 6 + LABEL_GAP)));
  for (const tick of x.ticks(Math.min(8, xTickCount))) {
    parts.push(`<text x="${x(tick)}" y="${innerHeight + layout.fontSize + 6}" text-anchor="middle" class="cs-text" fill="${TEXT_COLOR}">${escapeHtml(formatAxisTickValue(tick))}</text>`);
  }
  chart.series.forEach((s, seriesIndex) => {
    chart.rows.forEach((row, i) => {
      const value = row.values[seriesIndex];
      if (value === null || value === undefined) return;
      parts.push(`<circle cx="${x(xs[i])}" cy="${y(value)}" r="3.5" fill="${s.color}" fill-opacity="0.8"/>`);
    });
  });
  if (chart.showLabels) {
    const place = createLabelPlacer(layout, { left: -margin.left + 2, right: innerWidth + margin.right - 2, top: -margin.top + 2 });
    chart.series.forEach((_, seriesIndex) => {
      chart.rows.forEach((row, i) => {
        const value = row.values[seriesIndex];
        if (value === null || value === undefined) return;
        parts.push(place(x(xs[i]), y(value) - 10, formatLabelValue(value, format)));
      });
    });
  }
  parts.push('</g>', legend(chart.series, layout), '</svg>');
  return parts.join('');
};

const sliceColor = (chart: PublishedChart, index: number) => chart.series[index % chart.series.length]?.color ?? '#6366f1';

/**
 * Pie/treemap encode one series across rows. Snapshots carry the canvas palette (`categoryColors`:
 * mono ramp etc.); older ones cycle a palette derived from the series colors.
 */
const categoryPalette = (chart: PublishedChart): string[] => {
  if (chart.categoryColors?.length) return chart.categoryColors;
  const base = chart.series.map(s => s.color);
  const fallback = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#84cc16', '#ec4899'];
  return base.length > 1 ? base : [base[0] ?? fallback[0], ...fallback.filter(c => c !== base[0])];
};

const PIE_LEGEND_MAX_ITEMS = 12;
const PIE_LEGEND_MAX_LINES = 3;

/** Centered, wrapped pie legend (canvas: dot + name under the pie). Returns the SVG and the height it needs. */
const pieLegend = (labels: string[], colors: string[], layout: ChartLayout): { svg: string; height: number } => {
  const fontSize = layout.fontSize - 1;
  const lineHeight = fontSize + 8;
  const maxWidth = layout.width - 24;
  const lines: Array<Array<{ x: number; label: string; color?: string }>> = [[]];
  let cursor = 0;
  let placed = 0;
  for (const [i, raw] of labels.slice(0, PIE_LEGEND_MAX_ITEMS).entries()) {
    const label = truncateLabel(raw, 18);
    const width = 14 + label.length * fontSize * CHAR_WIDTH_RATIO;
    if (cursor + width > maxWidth && lines[lines.length - 1].length) {
      if (lines.length === PIE_LEGEND_MAX_LINES) break;
      lines.push([]);
      cursor = 0;
    }
    lines[lines.length - 1].push({ x: cursor, label, color: colors[i % colors.length] });
    cursor += width + 14;
    placed++;
  }
  if (placed < labels.length) lines[lines.length - 1].push({ x: cursor, label: `+${labels.length - placed} more` });
  const widthOf = (line: typeof lines[number]) => {
    const last = line[line.length - 1];
    return last.x + 14 + last.label.length * fontSize * CHAR_WIDTH_RATIO;
  };
  const items = lines.map((line, li) => {
    const offset = (layout.width - widthOf(line)) / 2;
    const baseline = layout.height - 10 - (lines.length - 1 - li) * lineHeight;
    return line.map(item => {
      const dot = item.color ? `<circle cx="${offset + item.x + 4}" cy="${baseline - 4}" r="4" fill="${item.color}"/>` : '';
      return `${dot}<text x="${offset + item.x + (item.color ? 14 : 0)}" y="${baseline}" class="cs-text" fill="${TEXT_COLOR}">${escapeHtml(item.label)}</text>`;
    }).join('');
  });
  return { svg: `<g ${FONT_FAMILY} font-size="${fontSize}">${items.join('')}</g>`, height: lines.length * lineHeight + 10 };
};

const renderPie = (chart: PublishedChart, layout: ChartLayout): string => {
  const palette = categoryPalette(chart);
  const showLegend = chart.rows.length > 1;
  const legendBlock = showLegend ? pieLegend(chart.rows.map(r => r.label), palette, layout) : { svg: '', height: 0 };
  const plotHeight = layout.height - legendBlock.height;
  const radius = Math.max(24, Math.min(layout.width / 2 - 24, plotHeight / 2 - 12));
  const slices = pie<{ label: string; value: number }>().value(d => d.value).sort(null)(
    chart.rows.map((row) => ({ label: row.label, value: Math.max(0, row.values[0] ?? 0) }))
  );
  const arcPath = arc<(typeof slices)[number]>().innerRadius(0).outerRadius(radius);
  const labelArc = arc<(typeof slices)[number]>().innerRadius(radius * 0.6).outerRadius(radius * 0.6);
  const parts = [svgOpen(chart, layout), `<g transform="translate(${layout.width / 2},${plotHeight / 2})" ${font(layout)}>`];
  slices.forEach((slice, i) => {
    const marked = chart.highlightIndex === i;
    const style = marked
      ? `fill="${CHART_HIGHLIGHT_COLOR}" stroke="#ffffff"`
      : `fill="${palette[i % palette.length]}" class="cs-sep" stroke="#ffffff"`;
    parts.push(`<path d="${arcPath(slice)}" ${style} stroke-width="${CHART_PIE_STROKE_WIDTH}"/>`);
    if (chart.showLabels && slice.endAngle - slice.startAngle > 0.25) {
      const [cx, cy] = labelArc.centroid(slice);
      parts.push(`<text x="${cx}" y="${cy}" dy="0.32em" text-anchor="middle" font-weight="500" fill="${marked ? '#111827' : '#ffffff'}">${escapeHtml(formatLabelValue(slice.data.value, chart.axisFormats?.left))}</text>`);
    }
  });
  parts.push('</g>', legendBlock.svg, '</svg>');
  return parts.join('');
};

const TREEMAP_MAX_LEAVES = 16;
const TREEMAP_INSET = 2;
const TREEMAP_RADIUS = 6;

const renderTreemap = (chart: PublishedChart, layout: ChartLayout): string => {
  const palette = categoryPalette(chart);
  type Leaf = { label: string; value: number };
  // Canvas: largest first, top 16 only.
  const leaves = chart.rows
    .map(row => ({ label: row.label, value: Math.max(0, row.values[0] ?? 0) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, TREEMAP_MAX_LEAVES);
  const root = hierarchy<{ children?: Leaf[] } & Partial<Leaf>>({ children: leaves })
    .sum(d => d.value ?? 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const laidOut = treemap<{ children?: Leaf[] } & Partial<Leaf>>().size([layout.width, layout.height]).paddingInner(0)(root);
  const uid = chartUid(chart, layout);
  const defs: string[] = [];
  const body: string[] = [];
  laidOut.leaves().forEach((leaf, i) => {
    const color = palette[i % palette.length] ?? sliceColor(chart, i);
    const width = leaf.x1 - leaf.x0;
    const height = leaf.y1 - leaf.y0;
    const id = `cs-tg-${uid}-${i}`;
    defs.push(`<linearGradient id="${id}" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${color}" stop-opacity="1"/><stop offset="100%" stop-color="${color}" stop-opacity="0.65"/></linearGradient>`);
    body.push(`<rect x="${leaf.x0 + TREEMAP_INSET}" y="${leaf.y0 + TREEMAP_INSET}" width="${Math.max(0, width - TREEMAP_INSET * 2)}" height="${Math.max(0, height - TREEMAP_INSET * 2)}" rx="${TREEMAP_RADIUS}" ry="${TREEMAP_RADIUS}" fill="url(#${id})"/>`);
    const cx = leaf.x0 + width / 2;
    const cy = leaf.y0 + height / 2;
    if (width > 40 && height > 24) {
      const size = Math.min(layout.fontSize, width / 7);
      const label = truncateLabel(leaf.data.label ?? '', Math.max(1, Math.floor((width - 12) / (size * CHAR_WIDTH_RATIO))));
      const showValue = width > 60 && height > 40;
      body.push(`<text x="${cx}" y="${showValue ? cy - 2 : cy}" dy="0.32em" text-anchor="middle" font-size="${size}" font-weight="600" fill="#ffffff">${escapeHtml(label)}</text>`);
      if (showValue) {
        body.push(`<text x="${cx}" y="${cy + size * 0.9}" dy="0.32em" text-anchor="middle" font-size="${Math.min(10, width / 9)}" fill="#ffffff" fill-opacity="0.9">${escapeHtml(formatLabelValue(leaf.data.value ?? 0, chart.axisFormats?.left))}</text>`);
      }
    }
  });
  return [svgOpen(chart, layout), `<defs>${defs.join('')}</defs>`, `<g ${font(layout)}>`, ...body, '</g></svg>'].join('');
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
