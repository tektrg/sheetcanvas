
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
    // We do NOT uppercase the whole body here, to preserve string literal case (e.g. ="Yes")
    // The Tokenizer handles case insensitivity for Keywords/Cell IDs.
    const formulaBody = raw.substring(1);
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
    // console.warn("Eval error", e);
    return "#ERROR";
  }
};

export const extractCellReferences = (raw: string): string[] => {
  if (!raw || !raw.startsWith('=')) return [];
  
  try {
      const tokens = new Tokenizer(raw.substring(1)).getAllTokens();
      const refs = new Set<string>();
      
      for(let i=0; i<tokens.length; i++) {
          const t = tokens[i];
          if (t.type === 'CELL') {
              // Check for range A1:B2
              if (tokens[i+1]?.type === 'COLON' && tokens[i+2]?.type === 'CELL') {
                  const start = parseCellId(t.value);
                  const end = parseCellId(tokens[i+2].value);
                  if (start && end) {
                      const minCol = Math.min(start.col, end.col);
                      const maxCol = Math.max(start.col, end.col);
                      const minRow = Math.min(start.row, end.row);
                      const maxRow = Math.max(start.row, end.row);
                      for(let c=minCol; c<=maxCol; c++) {
                          for(let r=minRow; r<=maxRow; r++) {
                              refs.add(getCellId(c, r));
                          }
                      }
                  }
                  i += 2; // Skip colon and second cell
              } else {
                  refs.add(t.value);
              }
          }
      }
      return Array.from(refs);
  } catch (e) {
      return [];
  }
};

export const computeSheet = (sheet: SheetData): SheetData => {
  const cells = sheet.cells; // Don't spread yet, we want to check refs
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
  let hasChanges = false;

  Object.keys(cells).forEach(key => {
     const newValue = getVal(key);
     const oldCell = cells[key];

     // Granular Update Optimization:
     // If the value hasn't changed, reuse the old object reference.
     // This allows React.memo to skip re-rendering this cell.
     if (oldCell.value === newValue) {
        newCells[key] = oldCell;
     } else {
        newCells[key] = { 
            ...oldCell, 
            value: newValue 
        };
        hasChanges = true;
     }
  });
  
  // If nothing changed (unlikely given we usually call this after an edit), return original sheet
  if (!hasChanges) return sheet;

  return { ...sheet, cells: newCells };
};
