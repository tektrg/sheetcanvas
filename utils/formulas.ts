import { CellData, SheetData } from '../types';
import { Tokenizer, Parser, evaluateAST } from './formulaEngine';

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

// Core evaluation function using AST
export const evaluateFormula = (raw: string, getValue: (id: string) => any): string | number => {
  if (!raw.startsWith('=')) {
    const num = Number(raw);
    return isNaN(num) ? raw : num;
  }

  try {
    const formulaBody = raw.substring(1).toUpperCase();
    const tokens = new Tokenizer(formulaBody).getAllTokens();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    
    const result = evaluateAST(ast, getValue);
    
    if (typeof result === 'number') {
        // Round to avoid floating point nastiness for UI
        return Math.round(result * 100000000) / 100000000;
    }
    return result;

  } catch (e) {
    console.warn("Eval error", e);
    return "#ERROR";
  }
};

export const computeSheet = (sheet: SheetData): SheetData => {
  const cells = { ...sheet.cells };
  const computedCache: Record<string, number | string | null> = {};
  const visiting = new Set<string>();

  const getVal = (id: string): number | string | null => {
     if (visiting.has(id)) return "#CYCLE!";
     if (computedCache[id] !== undefined) return computedCache[id];
     
     visiting.add(id);
     
     const cell = cells[id];
     const raw = cell?.raw;
     let val: string | number | null;

     if (raw === undefined || raw === null || String(raw) === '') {
       val = null;
     } else if (!String(raw).startsWith('=')) {
         // Check for percentage input (e.g. "10%")
         const trimmed = String(raw).trim();
         if (trimmed.endsWith('%')) {
            const numPart = parseFloat(trimmed.slice(0, -1));
            if (!isNaN(numPart)) {
                val = numPart / 100;
            } else {
                val = raw;
            }
         } else {
            const num = Number(raw);
            val = isNaN(num) ? raw : num;
         }
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