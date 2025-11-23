import { CellData, SheetData } from '../types';

// Convert "A1" to {col: 0, row: 0}
export const parseCellId = (id: string): { col: number; row: number } | null => {
  const match = id.match(/^([A-Z]+)([0-9]+)$/);
  if (!match) return null;
  
  const colStr = match[1];
  const rowStr = match[2];
  
  let col = 0;
  for (let i = 0; i < colStr.length; i++) {
    col = col * 26 + (colStr.charCodeAt(i) - 64);
  }
  
  return {
    col: col - 1,
    row: parseInt(rowStr, 10) - 1
  };
};

// Convert {col: 0, row: 0} to "A1"
export const getCellId = (col: number, row: number): string => {
  let tempCol = col + 1;
  let colStr = '';
  while (tempCol > 0) {
    let rem = (tempCol - 1) % 26;
    colStr = String.fromCharCode(65 + rem) + colStr;
    tempCol = Math.floor((tempCol - 1) / 26);
  }
  return `${colStr}${row + 1}`;
};

// Evaluates a range like "A1:B3" into an array of values
const evaluateRange = (range: string, getValue: (id: string) => number): number[] => {
  const parts = range.split(':');
  if (parts.length !== 2) return [];
  
  const start = parseCellId(parts[0]);
  const end = parseCellId(parts[1]);
  
  if (!start || !end) return [];
  
  const values: number[] = [];
  const minCol = Math.min(start.col, end.col);
  const maxCol = Math.max(start.col, end.col);
  const minRow = Math.min(start.row, end.row);
  const maxRow = Math.max(start.row, end.row);
  
  for (let c = minCol; c <= maxCol; c++) {
    for (let r = minRow; r <= maxRow; r++) {
      values.push(getValue(getCellId(c, r)));
    }
  }
  return values;
};

// Core evaluation function
export const evaluateFormula = (raw: string, getValue: (id: string) => any): string | number => {
  if (!raw.startsWith('=')) {
    const num = Number(raw);
    return isNaN(num) ? raw : num;
  }

  const expression = raw.substring(1).toUpperCase();

  try {
    let parsedExpr = expression;

    const getNumericValue = (id: string): number => {
        const val = getValue(id);
        const num = Number(val);
        return isNaN(num) ? 0 : num;
    };

    // Helper to replace range functions with their computed values
    const replaceRangeOp = (regex: RegExp, op: (vals: number[]) => number) => {
      parsedExpr = parsedExpr.replace(regex, (_, range) => {
        const vals = evaluateRange(range, getNumericValue);
        return op(vals).toString();
      });
    };

    // SUM(RANGE)
    replaceRangeOp(/SUM\(([A-Z]+[0-9]+:[A-Z]+[0-9]+)\)/g, (vals) => vals.reduce((a, b) => a + b, 0));

    // AVERAGE(RANGE) or AVG(RANGE)
    const avgOp = (vals: number[]) => vals.length === 0 ? 0 : vals.reduce((a, b) => a + b, 0) / vals.length;
    replaceRangeOp(/AVERAGE\(([A-Z]+[0-9]+:[A-Z]+[0-9]+)\)/g, avgOp);
    replaceRangeOp(/AVG\(([A-Z]+[0-9]+:[A-Z]+[0-9]+)\)/g, avgOp);

    // MIN(RANGE)
    replaceRangeOp(/MIN\(([A-Z]+[0-9]+:[A-Z]+[0-9]+)\)/g, (vals) => vals.length === 0 ? 0 : Math.min(...vals));

    // MAX(RANGE)
    replaceRangeOp(/MAX\(([A-Z]+[0-9]+:[A-Z]+[0-9]+)\)/g, (vals) => vals.length === 0 ? 0 : Math.max(...vals));

    // Handle direct cell references (e.g. A1 * B2)
    // We iterate to replace all cell IDs with their values
    parsedExpr = parsedExpr.replace(/[A-Z]+[0-9]+/g, (match) => {
       if (!parseCellId(match)) return match; 
       return getNumericValue(match).toString();
    });

    // Safety: Only allow basic math characters
    if (!/^[0-9+\-*/().\s]+$/.test(parsedExpr)) {
       return "#ERR:Unsafe";
    }

    // Evaluate
    // eslint-disable-next-line no-new-func
    const result = new Function(`return ${parsedExpr}`)();
    
    if (!isFinite(result) || isNaN(result)) return "#ERR:Math";
    
    return result;

  } catch (e) {
    return "#ERROR";
  }
};

export const computeSheet = (sheet: SheetData): SheetData => {
  const cells = { ...sheet.cells };
  const computedCache: Record<string, number | string> = {};
  const visiting = new Set<string>();

  const getVal = (id: string): number | string => {
     if (visiting.has(id)) return "#CYCLE!";
     if (computedCache[id] !== undefined) return computedCache[id];
     
     visiting.add(id);
     
     const cell = cells[id];
     const raw = cell?.raw;
     let val: string | number;

     if (raw === undefined || raw === null || String(raw) === '') {
       val = 0;
     } else if (!String(raw).startsWith('=')) {
         const num = Number(raw);
         val = isNaN(num) ? raw : num;
     } else {
         val = evaluateFormula(raw, (refId) => getVal(refId));
     }
     
     visiting.delete(id);
     computedCache[id] = val;
     return val;
  };

  const newCells: Record<string, CellData> = {};
  Object.keys(cells).forEach(key => {
     newCells[key] = { 
         ...cells[key], 
         value: getVal(key) 
     };
  });
  
  return { ...sheet, cells: newCells };
};