

import { SheetData, CellData, ChartConfig, PivotOperation } from '../types';
import { parseCellId, getCellId } from './formulas';
import { getFilteredRows } from './dataAnalysis';
import { formatValue } from './formatting';

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

// Helper for aggregation
const aggregate = (values: number[], op: PivotOperation): number => {
    if (values.length === 0) return 0;
    switch (op) {
        case 'SUM': return values.reduce((a, b) => a + b, 0);
        case 'COUNT': return values.length;
        case 'AVG': return values.reduce((a, b) => a + b, 0) / values.length;
        case 'MIN': return Math.min(...values);
        case 'MAX': return Math.max(...values);
        default: return 0;
    }
};

export const extractChartData = (sheet: SheetData, config: ChartConfig) => {
  if (!sheet) return [];

  const visibleRows = getFilteredRows(sheet);
  let rowsToProcess: number[] = [];

  if (visibleRows) {
      // Use the sorted/filtered rows directly, skipping header (row 0)
      rowsToProcess = visibleRows.filter(r => r !== 0);
  } else {
      // No sort/filter, find all rows with data and sort by index
      const rowSet = new Set<number>();
      Object.entries(sheet.cells).forEach(([key, cell]) => {
          const pos = parseCellId(key);
          // Skip headers (row 0) or invalid keys
          if (!pos || pos.row === 0) return;
          rowSet.add(pos.row);
      });
      rowsToProcess = Array.from(rowSet).sort((a, b) => a - b);
  }

  // --- GROUP MODE LOGIC ---
  if (config.mode === 'group' && config.groupCol && config.valueCol) {
      const groupColIdx = parseCellId(`${config.groupCol}1`)?.col;
      const valueColIdx = parseCellId(`${config.valueCol}1`)?.col;
      const seriesColIdx = config.seriesGroupCol ? parseCellId(`${config.seriesGroupCol}1`)?.col : undefined;
      const op = config.operation || 'SUM';

      if (groupColIdx === undefined || valueColIdx === undefined) return [];

      // Map<GroupKey, Map<SeriesKey, number[]>>
      const dataMap = new Map<string, Map<string, number[]>>();
      // If no series split, we use a default series key
      const DEFAULT_SERIES_KEY = 'value_0';

      rowsToProcess.forEach(r => {
          const groupKeyId = getCellId(groupColIdx, r);
          const groupCell = sheet.cells[groupKeyId];
          
          if (groupCell?.value === null || groupCell?.value === undefined) return;
          const groupKey = String(groupCell.value);

          // Check for Pivot Table Grand Total and exclude it
          if (sheet.pivotConfig && groupKey === 'Grand Total') return;

          const valId = getCellId(valueColIdx, r);
          const valCell = sheet.cells[valId];
          
          let val = Number(valCell?.value);
          if (isNaN(val)) {
             const clean = String(valCell?.value || '').replace(/[^0-9.-]/g, '');
             val = Number(clean);
          }
          if (isNaN(val)) val = 0;
          if (op === 'COUNT') val = 1;

          let seriesKey = DEFAULT_SERIES_KEY;
          if (seriesColIdx !== undefined) {
              const seriesCell = sheet.cells[getCellId(seriesColIdx, r)];
              // Handle empty series explicitly or just stringify
              seriesKey = String(seriesCell?.value ?? '(Empty)');
          }

          if (!dataMap.has(groupKey)) dataMap.set(groupKey, new Map());
          const seriesMap = dataMap.get(groupKey)!;
          
          if (!seriesMap.has(seriesKey)) seriesMap.set(seriesKey, []);
          seriesMap.get(seriesKey)!.push(val);
      });

      const chartData: any[] = [];
      const sortedGroupKeys = Array.from(dataMap.keys()).sort();

      sortedGroupKeys.forEach(key => {
          const seriesMap = dataMap.get(key)!;
          const dataPoint: any = { name: key };
          
          seriesMap.forEach((values, sKey) => {
              dataPoint[sKey] = aggregate(values, op);
          });
          
          chartData.push(dataPoint);
      });

      return chartData;
  }

  // --- METRICS MODE (Manual Series) LOGIC ---
  
  const labelColIndex = parseCellId(`${config.labelColumn}1`)?.col ?? 0;
  const dataColIndices = config.dataColumns.map(c => parseCellId(`${c}1`)?.col ?? 1);

  const chartData: any[] = [];
  
  rowsToProcess.forEach(r => {
      const labelId = getCellId(labelColIndex, r);
      const labelCell = sheet.cells[labelId];

      if (!labelCell?.value && String(labelCell?.value) !== '0') return; 
      if (sheet.pivotConfig && String(labelCell.value) === 'Grand Total') return;

      const dataPoint: any = {
          name: formatValue(labelCell?.value, labelCell?.format),
      };

      dataColIndices.forEach((colIdx, i) => {
          const cellId = getCellId(colIdx, r);
          const cell = sheet.cells[cellId];
          let val = Number(cell?.value);
          if (isNaN(val)) {
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