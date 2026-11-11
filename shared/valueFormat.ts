import { format as d3Format, formatSpecifier } from 'd3-format';
import { formatAxisNumber, toChartNumber } from './numberFormat';

// Pure (DOM/React-free) number formatting shared by the canvas (utils/formatting.ts) and
// the published-page chart renderer (backend). One implementation = a chart's ticks and
// value labels read the same live and published (currency, %, custom d3 specifiers).

export const VALUE_FORMAT_TYPES = ['number', 'currency', 'percent'] as const;
export const MAX_FORMAT_DECIMALS = 10;
export const MAX_D3_FORMAT_CHARS = 24;
const MAX_D3_WIDTH = 24;
const MAX_D3_PRECISION = 20;

/** The numeric slice of the app's CellFormat that survives into a published chart. */
export interface ValueFormat {
  type: (typeof VALUE_FORMAT_TYPES)[number];
  decimals?: number;
  /** d3-format specifier, e.g. "$,.0f". Printable ASCII, <= 24 chars, parseable, bounded width/precision. */
  d3Format?: string;
}

/**
 * True when `spec` is a printable-ASCII, short, parseable d3-format specifier with a sane width and
 * precision (an unbounded width such as "99999999999" would pad every label to that many characters).
 */
export const isSafeD3Format = (spec: unknown): spec is string => {
  if (typeof spec !== 'string' || spec.length === 0 || spec.length > MAX_D3_FORMAT_CHARS) return false;
  if (!/^[\x20-\x7e]+$/.test(spec)) return false;
  try {
    const parsed = formatSpecifier(spec);
    if (parsed.width !== undefined && !(parsed.width <= MAX_D3_WIDTH)) return false;
    if (parsed.precision !== undefined && !(parsed.precision <= MAX_D3_PRECISION)) return false;
    return true;
  } catch {
    return false;
  }
};

const intlCache = new Map<string, Intl.NumberFormat>();
const cachedIntl = (key: string, options: Intl.NumberFormatOptions): Intl.NumberFormat => {
  let formatter = intlCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', options);
    intlCache.set(key, formatter);
  }
  return formatter;
};

/**
 * Format a finite number with a number/currency/percent/d3 format. Identical rules to the canvas
 * (utils/formatting.ts formatValue): a d3 specifier wins; currency is USD with 2 decimals by default.
 */
export const formatNumericValue = (value: number, format?: ValueFormat): string => {
  if (!format) return String(value);
  try {
    if (format.d3Format) return d3Format(format.d3Format)(value);
    switch (format.type) {
      case 'percent':
        return cachedIntl(`p${format.decimals}`, {
          style: 'percent',
          minimumFractionDigits: format.decimals ?? 0,
          maximumFractionDigits: format.decimals ?? 20,
        }).format(value);
      case 'currency':
        return cachedIntl(`c${format.decimals}`, {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: format.decimals ?? 2,
          maximumFractionDigits: format.decimals ?? 2,
        }).format(value);
      case 'number':
        return cachedIntl(`n${format.decimals}`, {
          minimumFractionDigits: format.decimals ?? 0,
          maximumFractionDigits: format.decimals ?? 20,
        }).format(value);
      default:
        return String(value);
    }
  } catch {
    return String(value);
  }
};

/**
 * Value-axis tick label. Plain number columns (no decimals/d3) use the compact step-aware style;
 * currency, percent and d3 formats keep their own formatting. Mirrors utils/formatting.ts formatAxisTick.
 */
export const formatAxisTickValue = (value: unknown, format?: ValueFormat): string => {
  const num = toChartNumber(value);
  if (num === null) return value == null ? '' : String(value);
  const usesOwnFormat = !!format && (!!format.d3Format || format.type !== 'number');
  return usesOwnFormat ? formatNumericValue(num, format) : formatAxisNumber(num);
};

/**
 * Data-label text. Formatted columns use their format; unformatted values fall back to the compact
 * axis style (the canvas prints the raw number, which overflows a static page).
 */
export const formatLabelValue = (value: number, format?: ValueFormat): string =>
  format ? formatNumericValue(value, format) : formatAxisNumber(value);
