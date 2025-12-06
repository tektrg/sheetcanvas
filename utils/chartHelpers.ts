

import { SheetData, CellData } from '../types';
import { parseCellId, getCellId } from './formulas';
import { getFilteredRows } from './dataAnalysis';

export const getSheetHeaders = (sheet: SheetData): { id: string; label: string; index: number }[] => {
  const headers = [];
  
  // Calculate the maximum column index based on both sheet size and actual cell content
  let maxCol = sheet.size.width;
  Object.keys(sheet.cells).forEach(key => {
      const pos = parseCellId(key);
      if (pos && pos.col >= maxCol) {
          maxCol = pos.col + 1;
      }
  });

  for (let c = 0; c < maxCol; c++) {
    const cellId = getCellId(c, 0); // Row 0 is header
    const cell = sheet.cells[cellId];
    // Fallback to Column letter if cell is empty
    const colLetter = getCellId(c, -1).replace(/[0-9]/g, ''); 
    const label = cell?.value ? String(cell.value) : `Column ${colLetter}`;
    
    headers.push({
      id: colLetter,
      label,
      index: c
    });
  }
  return headers;
};

export const extractChartData = (sheet: SheetData, labelCol: string, dataCols: string[]) => {
  if (!sheet) return [];

  const labelColIndex = parseCellId(`${labelCol}1`)?.col ?? 0;
  const dataColIndices = dataCols.map(c => parseCellId(`${c}1`)?.col ?? 1);

  // Use a Map to group data by row index to capture all valid data points
  // irrespective of visual truncation
  const rowDataMap = new Map<number, any>();
  const visibleRows = getFilteredRows(sheet);

  if (visibleRows) {
      visibleRows.forEach(r => {
          if (r === 0) return; // Skip header
          rowDataMap.set(r, { _rowIdx: r });
      });
  } else {
      Object.entries(sheet.cells).forEach(([key, cell]) => {
          const pos = parseCellId(key);
          // Skip headers (row 0) or invalid keys
          if (!pos || pos.row === 0) return;
          
          // We only care about rows that have data in the label column OR value columns
          // But simplest is to just ensure row object exists if any data exists
          if (!rowDataMap.has(pos.row)) {
              rowDataMap.set(pos.row, { _rowIdx: pos.row });
          }
      });
  }

  // Populate data
  const chartData: any[] = [];
  const sortedRowIndices = Array.from(rowDataMap.keys()).sort((a, b) => a - b);

  sortedRowIndices.forEach(r => {
      const labelId = getCellId(labelColIndex, r);
      const labelCell = sheet.cells[labelId];

      // Skip if label is empty? Usually charts need a label or at least an index.
      // If label is missing, we can default to empty string or skip.
      // Let's skip if label is completely missing to avoid empty gaps, 
      // unless user wants to plot everything. 
      // Standard behavior: if label exists, plot it.
      
      if (!labelCell?.value && String(labelCell?.value) !== '0') return; 

      // Check for Pivot Table Grand Total and exclude it
      if (sheet.pivotConfig && String(labelCell.value) === 'Grand Total') return;

      const dataPoint: any = {
          name: String(labelCell.value),
      };

      dataColIndices.forEach((colIdx, i) => {
          const cellId = getCellId(colIdx, r);
          const cell = sheet.cells[cellId];
          // Try to parse as number
          let val = Number(cell?.value);
          if (isNaN(val)) {
             // Try removing currency symbols/commas if string
             const clean = String(cell?.value || '').replace(/[^0-9.-]/g, '');
             val = Number(clean);
          }
          if (isNaN(val)) val = 0;
          dataPoint[`value_${i}`] = val;
      });

      chartData.push(dataPoint);
  });

  return chartData;
};
