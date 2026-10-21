export type ChartAxisMax = number | 'auto';

const AXIS_HEADROOM_RATIO = 1.1;
const AXIS_MAX_SIGNIFICANT_DIGITS = 2;

export const getPaddedChartAxisMax = (dataMax: number): ChartAxisMax => {
  if (!Number.isFinite(dataMax) || dataMax <= 0) return 'auto';

  const paddedMax = dataMax * AXIS_HEADROOM_RATIO;
  const magnitude = 10 ** Math.floor(Math.log10(paddedMax));
  const roundingIncrement = magnitude / 10 ** (AXIS_MAX_SIGNIFICANT_DIGITS - 1);
  const incrementCount = Number((paddedMax / roundingIncrement).toPrecision(12));
  const roundedMax = Math.ceil(incrementCount) * roundingIncrement;

  return Number(roundedMax.toPrecision(12));
};
