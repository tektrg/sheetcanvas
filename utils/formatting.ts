

import { CellFormat } from '../types';
import { format as d3Format } from 'd3-format';

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

  // D3 Format Support
  if ((format as any).d3Format) {
      try {
          return d3Format((format as any).d3Format)(value);
      } catch (e) {
          console.warn("Invalid d3 format", e);
          return String(value);
      }
  }

  try {
      switch (format.type) {
        case 'percent':
            return new Intl.NumberFormat('en-US', { 
                style: 'percent', 
                minimumFractionDigits: format.decimals ?? 0,
                maximumFractionDigits: format.decimals ?? 20 
            }).format(value);
        case 'currency':
            return new Intl.NumberFormat('en-US', { 
                style: 'currency', 
                currency: 'USD',
                minimumFractionDigits: format.decimals ?? 2,
                maximumFractionDigits: format.decimals ?? 2
            }).format(value);
        case 'number':
             return new Intl.NumberFormat('en-US', { 
                minimumFractionDigits: format.decimals ?? 0,
                maximumFractionDigits: format.decimals ?? 20
            }).format(value);
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