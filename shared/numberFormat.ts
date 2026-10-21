// Compact number format shared by the in-app Recharts axes and the server chart
// renderer, so a chart's ticks read the same live and published (1.2K, 3.4M).
const compactFormatter = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export const formatCompact = (value: number): string => compactFormatter.format(value);

/** Coerce a chart value (numbers may arrive as numeric strings) to a finite number, else null. */
export const toChartNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const num = Number(value.replace(/[$,%\s]/g, ''));
  return Number.isFinite(num) ? num : null;
};
