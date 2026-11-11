

import { CellFormat } from '../types';
import { format as d3Format } from 'd3-format';
import { formatAxisNumber, toChartNumber } from '../shared/numberFormat';
import { formatNumericValue, type ValueFormat } from '../shared/valueFormat';

// Maps the simple string prop authors write (format="currency") to the app's
// richer CellFormat. Anything unknown falls back to the cell's own stored format.
export const FORMAT_ALIASES: Record<string, CellFormat> = {
  currency: { type: 'currency' },
  percent: { type: 'percent' },
  number: { type: 'number' },
  date: { type: 'date' },
  text: { type: 'text' },
};


export const formatValue = (value: string | number | null, format?: CellFormat): string => {
  if (value === null || value === undefined) return '';
  
  if (typeof value === 'string') {
      // If it's a string (e.g. error message or text), just return it
      // unless we specifically want to try parsing a date string if format is date
      if (format?.type === 'date') {
          const parsed = Date.parse(value);
          if (!isNaN(parsed)) {
              return formatValue(parsed, format);
          }
      }

      // Try to parse string as number if custom format is present and value looks like number
      if ((format as any)?.d3Format && !isNaN(parseFloat(value))) {
           const num = parseFloat(value);
           try {
              return d3Format((format as any).d3Format)(num);
           } catch (e) {
              return value;
           }
      }

      return value; 
  }
  
  // If no specific format is set, just return the number as string
  if (!format) return String(value);

  // d3 specifiers and number/currency/percent share one implementation with the published-page
  // renderer (shared/valueFormat.ts), so a chart reads the same live and published.
  if ((format as any).d3Format || format.type === 'percent' || format.type === 'currency' || format.type === 'number') {
      return formatNumericValue(value, format as ValueFormat);
  }

  try {
      switch (format.type) {
        case 'date': {
            const date = new Date(value);
            if (isNaN(date.getTime())) return String(value);
            
            const fmt = (format as any).dateFormat || 'YYYY-MM-DD';
            
            if (fmt === 'YYYY-MM-DD') {
                return date.toISOString().split('T')[0];
            }
            if (fmt === 'MM/DD/YYYY') {
                return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
            }
            if (fmt === 'DD/MM/YYYY') {
                return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
            }
            if (fmt === 'Full') {
                 return date.toLocaleDateString(undefined, { dateStyle: 'long' });
            }
            
            return date.toLocaleDateString();
        }
        default:
            return String(value);
      }
  } catch (e) {
      return String(value);
  }
};

/**
 * Value-axis tick label. Plain/number columns use compact thousands like the server
 * renderer uses (1.2K, 3.4M): full-length ticks overflow the fixed-width axis and
 * get clipped from the left, showing only their tail digits. Explicit currency,
 * percent, date and d3 formats keep their own formatting.
 */
export const formatAxisTick = (value: unknown, format?: CellFormat): string => {
  const num = toChartNumber(value);
  if (num === null) return value == null ? '' : String(value);
  const usesOwnFormat = format && ((format as any).d3Format || (format.type && format.type !== 'number' && format.type !== 'text'));
  return usesOwnFormat ? formatValue(num, format) : formatAxisNumber(num);
};
