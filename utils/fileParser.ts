import * as XLSX from 'xlsx';
import { parseClipboardData } from './clipboard';
import { MAX_IMPORT_ROWS, MAX_IMPORT_COLS } from '../constants';

export const parseFile = async (file: File): Promise<{ data: string[][]; truncated: boolean } | null> => {
  const name = file.name.toLowerCase();
  
  try {
      if (name.endsWith('.csv')) {
        const text = await file.text();
        return parseClipboardData(text);
      }

      if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: 'array' });
        
        if (wb.SheetNames.length === 0) return null;

        const firstSheetName = wb.SheetNames[0];
        const ws = wb.Sheets[firstSheetName];
        
        // Convert sheet to array of arrays
        let data = XLSX.utils.sheet_to_json<Array<string | number | null>>(ws, { header: 1, defval: '' });
        
        let truncated = false;

        // Apply Limits
        if (data.length > MAX_IMPORT_ROWS) {
            data = data.slice(0, MAX_IMPORT_ROWS);
            truncated = true;
        }

        // Normalize data to strings and limit columns
        const finalData = data.map(row => {
             let r = row;
             if (r.length > MAX_IMPORT_COLS) {
                 r = r.slice(0, MAX_IMPORT_COLS);
                 truncated = true;
             }
             return r.map(cell => {
                 if (cell === null || cell === undefined) return '';
                 return String(cell);
             });
        });

        return { data: finalData, truncated };
      }
  } catch (err) {
      console.error("Error parsing file", err);
      return null;
  }

  return null;
};