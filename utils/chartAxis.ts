export type ChartAxisMax = number | 'auto';

const AXIS_HEADROOM_RATIO = 1.1;
const AXIS_MAX_SIGNIFICANT_DIGITS = 2;
const AXIS_TARGET_TICKS = 5;
const NICE_STEPS = [1, 2, 2.5, 5, 10];

export const getPaddedChartAxisMax = (dataMax: number): ChartAxisMax => {
  if (!Number.isFinite(dataMax) || dataMax <= 0) return 'auto';

  const paddedMax = dataMax * AXIS_HEADROOM_RATIO;
  const magnitude = 10 ** Math.floor(Math.log10(paddedMax));
  const roundingIncrement = magnitude / 10 ** (AXIS_MAX_SIGNIFICANT_DIGITS - 1);
  const incrementCount = Number((paddedMax / roundingIncrement).toPrecision(12));
  const roundedMax = Math.ceil(incrementCount) * roundingIncrement;

  return Number(roundedMax.toPrecision(12));
};

export interface ChartAxisScale {
  domain: [ChartAxisMax, ChartAxisMax];
  /** Explicit ticks, only for axes that cross 0; otherwise Recharts picks them. */
  ticks?: number[];
}

/**
 * Value-axis domain. All-positive data keeps the 0 baseline and the padded max.
 * Negative values extend the axis below 0 on a nice step (1/2/2.5/5 x 10^k) that
 * lands on 0, so the 0 line is labelled; all-negative data caps the axis at 0.
 */
export const getChartAxisScale = (dataMin: number, dataMax: number): ChartAxisScale => {
  if (!(Number.isFinite(dataMin) && dataMin < 0)) return { domain: [0, getPaddedChartAxisMax(dataMax)] };
  const lower = dataMin * AXIS_HEADROOM_RATIO;
  const upper = Number.isFinite(dataMax) && dataMax > 0 ? dataMax * AXIS_HEADROOM_RATIO : 0;
  const rawStep = (upper - lower) / AXIS_TARGET_TICKS;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = (NICE_STEPS.find((n) => n * magnitude >= rawStep) ?? 10) * magnitude;
  const first = Math.floor(lower / step);
  const last = Math.ceil(upper / step);
  const ticks: number[] = [];
  for (let i = first; i <= last; i++) ticks.push(Number((i * step).toPrecision(12)) || 0);
  return { domain: [ticks[0], ticks[ticks.length - 1]], ticks };
};
