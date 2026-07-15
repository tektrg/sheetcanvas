// utils/chartDefaults.ts
//
// Smart Visualization Defaults — the single source of truth for "what form
// should this chart take?" (F-rules F0–F13 from
// docs/smart-visualization-defaults-plan.md).
//
// This module is intentionally PURE and side-effect free so it can be unit
// tested with a table of data-shapes → expected forms. Both the UI chart button
// (App.tsx handleInitChart) and the agent (clientToolExecutor createChart)
// consume it, so a chart comes out in the right form regardless of who created
// it. Never re-implement a rule elsewhere — add it here.
//
// F0 evaluation order (governs all rules): X-type constraints → series-count
// caps → dual-axis gate → cosmetics. Lines are only valid when X is ordered.

import { ChartType, SortConfig, SheetData, FilterType } from '../types';
import { getSheetHeaders } from './chartHelpers';
import { inferColumnType } from './dataAnalysis';
import { getCellId, parseCellId } from './formulas';

export type XAxisKind = 'time' | 'ordinal' | 'categorical';
export type RateSignal = 'strong' | 'weak' | 'none';

export const CHART_DEFAULTS = {
  /** F2: magnitudes differing by this ratio gate a dual axis. */
  DUAL_AXIS_SCALE_RATIO: 10,
  /** F3: grouped-bar ceiling over categories. */
  GROUPED_BAR_CEILING: 3,
  /** F4: at or above this many series over time, switch bars → lines. */
  MANY_SERIES: 4,
  /** F5: at or above this many series, recommend top-N + Other / sparkline. */
  TOO_MANY_SERIES: 7,
  /** F5: coverage target for choosing N in top-N. */
  TOPN_COVERAGE: 0.8,
  /** F5: default N when coverage cannot be computed. */
  TOPN_DEFAULT: 5,
  /** F11: a small absolute count under this must NOT read as a rate. */
  SMALL_COUNT_CEILING: 100,
  /** F13: category count at/above this reads better as horizontal bars. */
  MANY_CATEGORIES: 10,
  /** F13: label length at/above this reads better sideways. */
  LONG_LABEL: 16,
} as const;

export interface SeriesShape {
  /** Column letter (metrics mode) or series key (group mode). */
  id: string;
  label?: string;
  /** Representative |value| (median of absolute values). */
  magnitude: number;
  min: number;
  max: number;
  rateSignal: RateSignal;
}

export interface ChartShape {
  xType: XAxisKind;
  categoryCount: number;
  labelMaxLength: number;
  /** F7: the X categories are an ordinal sequence (months, tiers, ranges). */
  isOrdinal: boolean;
  series: SeriesShape[];
  /**
   * The base type the caller wants. The engine only reshapes bar/line charts
   * (the "series over an axis" family). pie/area/scatter/treemap are
   * intentional intent choices (composition, relationship, cumulative) and are
   * returned unchanged.
   */
  requestedType?: ChartType;
  /** Dual axis + per-series combo only render in metrics mode. */
  supportsDualAxis?: boolean;
  /** F7: label column letter, for emitting a concrete sort suggestion. */
  labelColumn?: string;
}

export interface ChartFormDecision {
  type: ChartType;
  seriesTypes: Record<string, ChartType>;
  rightAxisColumns: string[];
  sort: SortConfig | null;
  warnings: string[];
  /** Plain-English log of which rules fired, for agent narration. */
  firedRules: string[];
  /** F5: recommended N for top-N + Other (Phase 1 warns; Phase 4 consolidates). */
  topN: number | null;
  /** F13: horizontal orientation recommended (may be warning-only). */
  horizontal: boolean;
}

const RESHAPEABLE: ChartType[] = ['bar', 'line'];

// ── Ordinal detection (F7) ──────────────────────────────────────────────────

const MONTHS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
];
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const SIZE_TIERS = ['xxs', 'xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl', 'small', 'medium', 'large'];

/**
 * F7 ordinal detection via known sequences. Returns true when the majority of
 * labels belong to a recognised ordered vocabulary (months, weekdays, quarters,
 * size tiers) or are numeric-range bands ("18-24", "$0-$50"). Value-sorting an
 * ordinal scale destroys its story, so when in doubt keep source order.
 */
export function detectOrdinalCategories(labels: string[]): boolean {
  const clean = labels.map(l => String(l ?? '').trim().toLowerCase()).filter(Boolean);
  if (clean.length === 0) return false;

  const isRangeBand = (s: string) =>
    /^[^\d]*\d+(\.\d+)?\s*[-–—to]+\s*[^\d]*\d+(\.\d+)?/.test(s) || /^\d+(\.\d+)?\+$/.test(s);
  const isQuarter = (s: string) => /^q[1-4]\b/.test(s) || /^quarter\s*[1-4]/.test(s);

  let hits = 0;
  for (const s of clean) {
    if (MONTHS.includes(s)) { hits++; continue; }
    if (DAYS.includes(s)) { hits++; continue; }
    if (SIZE_TIERS.includes(s)) { hits++; continue; }
    if (isQuarter(s)) { hits++; continue; }
    if (isRangeBand(s)) { hits++; continue; }
  }
  return hits >= clean.length * 0.6;
}

// ── Rate detection (F11) ────────────────────────────────────────────────────

const RATE_WORDS = /\b(rate|ratio|pct|percent|percentage|conversion|cvr|ctr|margin|share|bounce|churn|retention)\b/i;

/**
 * F11 rate heuristic feeding the F2 dual-axis gate. STRONG = percent number
 * format or a rate word in the header. WEAK = bare 0–1 / 0–100 bounds — which
 * NEVER trigger a dual axis on their own, because small absolute counts (daily
 * signups under 100) would false-positive.
 */
export function detectRateSignal(input: {
  formatType?: string;
  header?: string;
  min: number;
  max: number;
  count: number;
}): RateSignal {
  if (input.formatType === 'percent') return 'strong';
  if (input.header && RATE_WORDS.test(input.header)) return 'strong';

  const { min, max, count } = input;
  // Bounds-only signal. Guard against the small-count trap: a column of daily
  // signups (0..80) is bounded 0–100 but is a count, not a rate.
  const boundedFraction = min >= 0 && max <= 1 && max > 0;
  const boundedPercent = min >= 0 && max <= 100 && count >= CHART_DEFAULTS.SMALL_COUNT_CEILING;
  if (boundedFraction) return 'weak';
  if (boundedPercent && !Number.isInteger(max)) return 'weak';
  return 'none';
}

// ── Dual-axis gate (F2) ─────────────────────────────────────────────────────

interface GateResult {
  fires: boolean;
  rightSeries: string[];
  reason: string;
  kind: 'rate' | 'scale' | 'none';
}

function evaluateDualAxisGate(series: SeriesShape[]): GateResult {
  const none: GateResult = { fires: false, rightSeries: [], reason: '', kind: 'none' };
  if (series.length < 2) return none;

  const rateSeries = series.filter(s => s.rateSignal === 'strong');
  const absoluteSeries = series.filter(s => s.rateSignal !== 'strong');

  // Case 1 (the classic legitimate combo): a rate/% paired with absolutes.
  if (rateSeries.length > 0 && absoluteSeries.length > 0) {
    return {
      fires: true,
      rightSeries: rateSeries.map(s => s.id),
      reason: 'a rate/percentage series is paired with absolute volumes → volume as bars (left), rate as line (right axis)',
      kind: 'rate',
    };
  }

  // Case 2: magnitudes differ by ≥ ~10×. Put the small series on the right.
  const mags = series.map(s => Math.abs(s.magnitude)).filter(m => m > 0);
  if (mags.length >= 2) {
    const maxMag = Math.max(...mags);
    const minMag = Math.min(...mags);
    if (minMag > 0 && maxMag / minMag >= CHART_DEFAULTS.DUAL_AXIS_SCALE_RATIO) {
      const threshold = maxMag / CHART_DEFAULTS.DUAL_AXIS_SCALE_RATIO;
      const rightSeries = series.filter(s => Math.abs(s.magnitude) > 0 && Math.abs(s.magnitude) <= threshold).map(s => s.id);
      // Guard: never push every series to the right — that is just a rescaled
      // single axis. Require a real split.
      if (rightSeries.length > 0 && rightSeries.length < series.length) {
        return {
          fires: true,
          rightSeries,
          reason: `series magnitudes differ by ≥ ${CHART_DEFAULTS.DUAL_AXIS_SCALE_RATIO}× → smaller series on a right axis`,
          kind: 'scale',
        };
      }
    }
  }

  return none;
}

// ── F5: choose N for top-N + Other ──────────────────────────────────────────

function chooseTopN(series: SeriesShape[]): number {
  const mags = series.map(s => Math.abs(s.magnitude)).sort((a, b) => b - a);
  const total = mags.reduce((a, b) => a + b, 0);
  if (total <= 0) return Math.min(CHART_DEFAULTS.TOPN_DEFAULT, series.length);
  let cum = 0;
  for (let i = 0; i < mags.length; i++) {
    cum += mags[i];
    if (cum / total >= CHART_DEFAULTS.TOPN_COVERAGE) return i + 1;
  }
  return Math.min(CHART_DEFAULTS.TOPN_DEFAULT, series.length);
}

// ── The pipeline (F0) ────────────────────────────────────────────────────────

/**
 * Pure core: data shape → chart form. Implements F1–F13 as an explicit ordered
 * pipeline (F0) so conflicting rules resolve deterministically. Unit tested in
 * __tests__/chartDefaults.test.ts against the four trap cases.
 */
export function pickChartForm(shape: ChartShape): ChartFormDecision {
  const decision: ChartFormDecision = {
    type: shape.requestedType ?? 'bar',
    seriesTypes: {},
    rightAxisColumns: [],
    sort: null,
    warnings: [],
    firedRules: [],
    topN: null,
    horizontal: false,
  };

  // Only the "series over an axis" family (bar/line) is reshaped. pie / area /
  // scatter / treemap encode deliberate intent — return them untouched.
  if (shape.requestedType && !RESHAPEABLE.includes(shape.requestedType)) {
    decision.firedRules.push(`requested ${shape.requestedType} kept (intentional form)`);
    return decision;
  }

  const series = shape.series;
  const n = series.length;
  const ordered = shape.xType === 'time' || shape.xType === 'ordinal';
  const isTime = shape.xType === 'time';

  // ── F5: too many series (warn-only in Phase 1) ──
  if (n >= CHART_DEFAULTS.TOO_MANY_SERIES) {
    decision.topN = chooseTopN(series);
    decision.warnings.push(
      `${n} series is too many to distinguish. Recommend top-${decision.topN} + "Other" (≥${Math.round(CHART_DEFAULTS.TOPN_COVERAGE * 100)}% coverage) or a sparkline table.`
    );
    decision.firedRules.push(`F5: ${n} series → recommend top-${decision.topN} + Other`);
  }

  if (n <= 1) {
    // ── F1: single series ──
    if (isTime) {
      decision.type = 'line';
      decision.firedRules.push('F1: single time series → line');
    } else {
      decision.type = 'bar';
      decision.firedRules.push('F1: single series → bar');
    }
  } else {
    // ── F2: dual-axis gate (metrics mode only) ──
    const gate = evaluateDualAxisGate(series);
    if (gate.fires && shape.supportsDualAxis) {
      decision.type = 'bar';
      for (const s of series) {
        if (gate.rightSeries.includes(s.id)) {
          decision.seriesTypes[s.id] = 'line';
          decision.rightAxisColumns.push(s.id);
        } else {
          decision.seriesTypes[s.id] = 'bar';
        }
      }
      decision.firedRules.push(`F2: ${gate.reason}`);
      if (gate.kind === 'scale') {
        decision.warnings.push(
          'Neither series is a rate; rebasing both to index = 100 on one shared axis often reads better than a dual axis.'
        );
      }
    } else {
      // ── Shared axis: count caps (F3/F4) ──
      if (n >= CHART_DEFAULTS.MANY_SERIES) {
        if (ordered) {
          decision.type = 'line';
          decision.firedRules.push(`F4: ${n} series over ${isTime ? 'time' : 'an ordinal axis'} → lines (never bars)`);
        } else {
          decision.type = 'bar';
          decision.warnings.push(
            `${n} series over categories renders as a dense bar wall. Consolidate to top-N + "Other" or use a sparkline table.`
          );
          decision.firedRules.push(`F4: ${n} categorical series → bars flagged as unreadable`);
        }
      } else {
        // n is 2 or 3.
        if (ordered) {
          decision.type = 'line';
          decision.firedRules.push(`F3: ${n} same-unit series over ${isTime ? 'time' : 'an ordinal axis'} → lines`);
        } else {
          decision.type = 'bar';
          decision.firedRules.push(`F3: ${n} same-unit series over categories → grouped bars`);
        }
      }
      if (gate.fires && !shape.supportsDualAxis) {
        decision.warnings.push(
          'A rate/scale split suggests a bar + line dual-axis combo, but that only renders in metrics mode. Consider metrics mode for this chart.'
        );
      }
    }
  }

  // ── Cosmetics: F7 sort + F13 horizontal (only meaningful for bar charts) ──
  if (decision.type === 'bar' && shape.xType === 'categorical') {
    if (shape.isOrdinal) {
      decision.firedRules.push('F7: ordinal categories kept in natural order (not value-sorted)');
    } else if (shape.labelColumn) {
      decision.sort = { columnId: shape.labelColumn, direction: 'desc' };
      decision.firedRules.push('F7: categorical bars value-sorted (descending)');
    }
  }

  if (
    decision.type === 'bar' &&
    (shape.categoryCount >= CHART_DEFAULTS.MANY_CATEGORIES || shape.labelMaxLength >= CHART_DEFAULTS.LONG_LABEL)
  ) {
    decision.horizontal = true;
    decision.warnings.push(
      'Long labels or many categories read better as horizontal bars (rotated/truncated labels are hard to read).'
    );
    decision.firedRules.push('F13: horizontal-bar orientation recommended');
  }

  return decision;
}

// ── Sheet adapter ────────────────────────────────────────────────────────────

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function readColumnNumbers(sheet: SheetData, colId: string, maxRows = 500): number[] {
  const colIdx = parseCellId(`${colId}1`)?.col;
  if (colIdx === undefined) return [];
  const out: number[] = [];
  for (let r = 1; r < maxRows; r++) {
    const cell = sheet.cells[getCellId(colIdx, r)];
    if (!cell || cell.value === null || cell.value === '') continue;
    let v = Number(cell.value);
    if (Number.isNaN(v)) {
      const clean = String(cell.value).replace(/[^0-9.-]/g, '');
      v = Number(clean);
    }
    if (!Number.isNaN(v)) out.push(v);
  }
  return out;
}

function readColumnLabels(sheet: SheetData, colId: string, maxRows = 500): string[] {
  const colIdx = parseCellId(`${colId}1`)?.col;
  if (colIdx === undefined) return [];
  const out: string[] = [];
  for (let r = 1; r < maxRows; r++) {
    const cell = sheet.cells[getCellId(colIdx, r)];
    if (!cell || cell.value === null || cell.value === '') continue;
    if (sheet.pivotConfig && String(cell.value) === 'Grand Total') continue;
    out.push(String(cell.value));
  }
  return out;
}

function classifyXType(sheet: SheetData, labelColId: string): { xType: XAxisKind; isOrdinal: boolean; labels: string[] } {
  const labels = readColumnLabels(sheet, labelColId);
  const inferred: FilterType = inferColumnType(sheet, labelColId);
  if (inferred === 'date') return { xType: 'time', isOrdinal: false, labels };
  const isOrdinal = detectOrdinalCategories(labels);
  return { xType: isOrdinal ? 'ordinal' : 'categorical', isOrdinal, labels };
}

function buildSeriesShape(sheet: SheetData, colId: string): SeriesShape {
  const nums = readColumnNumbers(sheet, colId);
  const header = getSheetHeaders(sheet).find(h => h.id === colId)?.label;
  const headerCell = sheet.cells[`${colId}1`];
  const anyValueCell = (() => {
    const colIdx = parseCellId(`${colId}1`)?.col;
    if (colIdx === undefined) return undefined;
    for (let r = 1; r < 100; r++) {
      const c = sheet.cells[getCellId(colIdx, r)];
      if (c?.format?.type) return c;
    }
    return undefined;
  })();
  const formatType = anyValueCell?.format?.type ?? headerCell?.format?.type;
  const min = nums.length ? Math.min(...nums) : 0;
  const max = nums.length ? Math.max(...nums) : 0;
  const magnitude = median(nums.map(Math.abs));
  const rateSignal = detectRateSignal({ formatType, header, min, max, count: nums.length });
  return { id: colId, label: header, magnitude, min, max, rateSignal };
}

export interface ChartDefaultsRequest {
  mode: 'metrics' | 'group';
  labelColumn: string; // metrics X / group X (groupCol)
  dataColumns: string[]; // metrics series columns
  seriesGroupCol?: string; // group mode series split
  valueCol?: string; // group mode value column
  requestedType?: ChartType;
}

/**
 * Adapter: reads the relevant columns off a real sheet, builds a ChartShape, and
 * runs pickChartForm. Metrics mode gets full combo/dual-axis support; group mode
 * uses the cheap path (global type only) because the renderer's group mode does
 * not yet support per-series types or a right axis.
 */
export function computeChartDefaults(sheet: SheetData, req: ChartDefaultsRequest): ChartFormDecision {
  const { xType, isOrdinal, labels } = classifyXType(sheet, req.labelColumn);
  const labelMaxLength = labels.reduce((m, l) => Math.max(m, l.length), 0);

  let series: SeriesShape[];
  let categoryCount = new Set(labels).size;
  let supportsDualAxis: boolean;

  if (req.mode === 'group') {
    supportsDualAxis = false; // cheap path — group mode is single-type
    if (req.seriesGroupCol) {
      // Series = distinct values of the split column; magnitude approximated by
      // the value column overall (fine for count-cap decisions).
      const seriesKeys = Array.from(new Set(readColumnLabels(sheet, req.seriesGroupCol)));
      const valueShape = req.valueCol ? buildSeriesShape(sheet, req.valueCol) : undefined;
      series = seriesKeys.map(k => ({
        id: k,
        label: k,
        magnitude: valueShape?.magnitude ?? 1,
        min: valueShape?.min ?? 0,
        max: valueShape?.max ?? 0,
        rateSignal: 'none' as RateSignal,
      }));
    } else {
      series = req.valueCol ? [buildSeriesShape(sheet, req.valueCol)] : [];
    }
  } else {
    supportsDualAxis = true;
    series = req.dataColumns.map(c => buildSeriesShape(sheet, c));
  }

  return pickChartForm({
    xType,
    categoryCount,
    labelMaxLength,
    isOrdinal,
    series,
    requestedType: req.requestedType,
    supportsDualAxis,
    labelColumn: req.labelColumn,
  });
}

// ── A6: partial-period detection ─────────────────────────────────────────────

/**
 * Returns true when the most recent date in the label column falls inside the
 * still-in-progress current period bucket (today / this week / this month / …),
 * i.e. the trailing bar is incomplete and would read as a fake decline. Kept
 * conservative on purpose: only fires when the latest point is within the
 * current bucket relative to `now`.
 */
export function detectPartialTrailingPeriod(
  sheet: SheetData,
  labelColId: string,
  granularity: 'day' | 'week' | 'month' | 'quarter' | 'year',
  now: Date = new Date()
): boolean {
  const labels = readColumnLabels(sheet, labelColId);
  let latest = -Infinity;
  for (const l of labels) {
    const t = Date.parse(l);
    if (!Number.isNaN(t)) latest = Math.max(latest, t);
  }
  if (latest === -Infinity) return false;
  const d = new Date(latest);
  const n = now;

  switch (granularity) {
    case 'day':
      return d.toDateString() === n.toDateString();
    case 'week': {
      const weekStart = (x: Date) => {
        const c = new Date(x);
        const day = (c.getDay() + 6) % 7; // Monday = 0
        c.setHours(0, 0, 0, 0);
        c.setDate(c.getDate() - day);
        return c.getTime();
      };
      return weekStart(d) === weekStart(n);
    }
    case 'month':
      return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
    case 'quarter':
      return d.getFullYear() === n.getFullYear() && Math.floor(d.getMonth() / 3) === Math.floor(n.getMonth() / 3);
    case 'year':
      return d.getFullYear() === n.getFullYear();
    default:
      return false;
  }
}

// ── Renderer advisories for the chart config panel ──────────────────────────

/**
 * Advisory warnings for an EXISTING chart config, surfaced (non-blocking) in the
 * chart settings panel. Reuses the defaults engine to flag when the current form
 * fights the data shape (dense bar wall, dual-axis scale caveat, horizontal
 * recommendation), and adds the A6 partial-period caveat.
 */
export function computeChartAdvisories(
  sheet: SheetData,
  config: {
    mode?: 'metrics' | 'group';
    type: ChartType;
    labelColumn: string;
    dataColumns: string[];
    groupCol?: string;
    seriesGroupCol?: string;
    valueCol?: string;
    timeGranularity?: 'day' | 'week' | 'month' | 'quarter' | 'year';
  }
): string[] {
  const mode = config.mode ?? 'metrics';
  const labelColumn = mode === 'group' ? (config.groupCol ?? config.labelColumn) : config.labelColumn;
  const decision = computeChartDefaults(sheet, {
    mode,
    labelColumn,
    dataColumns: config.dataColumns,
    seriesGroupCol: mode === 'group' ? config.seriesGroupCol : undefined,
    valueCol: mode === 'group' ? config.valueCol : undefined,
    requestedType: config.type,
  });

  const advisories = [...decision.warnings];

  if (config.timeGranularity && detectPartialTrailingPeriod(sheet, labelColumn, config.timeGranularity)) {
    advisories.push(
      'The most recent period looks incomplete — the trailing point may read as a false decline. Exclude or mark it.'
    );
  }

  return advisories;
}
