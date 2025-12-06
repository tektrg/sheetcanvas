import { CellFormat } from '../types';

export const formatValue = (value: string | number | null, format?: CellFormat): string => {
  if (value === null || value === undefined) return '';
  
  if (typeof value === 'string') {
      // If it's a string (e.g. error message or text), just return it
      return value; 
  }
  
  // If no specific format is set, just return the number as string (or maybe apply default number formatting?)
  if (!format) return String(value);

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
        default:
            return String(value);
      }
  } catch (e) {
      return String(value);
  }
};