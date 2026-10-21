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

const MAX_TICK_DECIMALS = 4;
const tickFormatters = new Map<number, Intl.NumberFormat>();

/**
 * Axis tick label whose precision follows the tick itself. Ticks sit on "nice"
 * steps (0.05, 0.25, 1, ...), so a tick's own decimals are the step's precision:
 * 0.75 stays "0.75" instead of rounding to "0.8". Thousands and up use compact.
 */
export const formatAxisNumber = (value: number): string => {
  if (Math.abs(value) >= 1000) return formatCompact(value);
  const clean = Number(value.toPrecision(10)); // drop float noise (0.1 + 0.2)
  const decimals = Math.min((String(clean).split('.')[1] || '').length, MAX_TICK_DECIMALS);
  let formatter = tickFormatters.get(decimals);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: decimals });
    tickFormatters.set(decimals, formatter);
  }
  return formatter.format(clean);
};
