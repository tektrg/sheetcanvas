import { CellData } from '../types';
import { getCellId } from './formulas';
import { CELL_WIDTH, CELL_HEIGHT, INITIAL_COLS, INITIAL_ROWS, MAX_CONNECTED_IMPORT_COLS, MAX_IMPORT_ROWS } from '../constants';

export interface MatrixResult {
  cells: Record<string, CellData>;
  size: { width: number; height: number };
  truncated: boolean;
}

export function applyMatrixToSheet(matrix: string[][]): MatrixResult {
  let finalMatrix = matrix;
  let truncated = false;
  if (finalMatrix.length > MAX_IMPORT_ROWS) {
    finalMatrix = finalMatrix.slice(0, MAX_IMPORT_ROWS);
    truncated = true;
  }
  const widestColumnCount = finalMatrix.reduce((max, row) => Math.max(max, row.length), 0);
  if (widestColumnCount > MAX_CONNECTED_IMPORT_COLS) {
    finalMatrix = finalMatrix.map(row => row.slice(0, MAX_CONNECTED_IMPORT_COLS));
    truncated = true;
  }
  const rows = finalMatrix.length;
  const cols = finalMatrix.reduce((max, row) => Math.max(max, row.length), 0);
  const finalCols = Math.max(cols, INITIAL_COLS);
  const finalRows = Math.max(rows, INITIAL_ROWS);
  const maxViewportRows = Math.floor((window.innerHeight - 200) / CELL_HEIGHT);
  const maxViewportCols = Math.floor((window.innerWidth - 200) / CELL_WIDTH);
  const constrainedRows = Math.min(finalRows, Math.max(INITIAL_ROWS, maxViewportRows));
  const constrainedCols = Math.min(finalCols, Math.max(INITIAL_COLS, maxViewportCols));
  const newCells: Record<string, CellData> = {};
  finalMatrix.forEach((rowVals, r) => {
    rowVals.forEach((val, c) => {
      const strVal = String(val);
      if (strVal.trim()) {
        newCells[getCellId(c, r)] = { raw: strVal.trim(), value: null };
      }
    });
  });
  return { cells: newCells, size: { width: constrainedCols, height: constrainedRows }, truncated };
}
