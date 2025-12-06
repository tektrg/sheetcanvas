

import { SheetData, CellData, PivotConfig, PivotOperation, PivotValue } from '../types';
import { getCellId, parseCellId } from './formulas';
import { getSheetHeaders } from './chartHelpers';
import { CELL_WIDTH, CELL_HEIGHT } from '../constants';
import { getFilteredRows } from './dataAnalysis';

// Extract raw data from sheet into array of objects
const extractData = (sheet: SheetData) => {
  const headers = getSheetHeaders(sheet);
  
  // Create a quick lookup for column index to ID
  const colIndexToId = new Map<number, string>();
  headers.forEach(h => colIndexToId.set(h.index, h.id));

  // Use a Map to gather row objects, keyed by row index
  const rowMap = new Map<number, Record<string, any>>();
  const visibleRows = getFilteredRows(sheet);
  
  if (visibleRows) {
      visibleRows.forEach(r => {
          if (r === 0) return; // Skip Header

          // We iterate known headers to extract data for this row
          headers.forEach(h => {
               const cellId = getCellId(h.index, r);
               const cell = sheet.cells[cellId];
               if (cell && cell.value !== null && cell.value !== undefined && String(cell.value).trim() !== '') {
                   if (!rowMap.has(r)) rowMap.set(r, {});
                   rowMap.get(r)![h.id] = cell.value;
               }
          });
      });
  } else {
      Object.entries(sheet.cells).forEach(([key, cell]) => {
        // Skip empty cells
        if (!cell || cell.value === null || cell.value === undefined || String(cell.value).trim() === '') return;
    
        const pos = parseCellId(key);
        if (!pos || pos.row === 0) return; // Skip invalid IDs or Header Row (0)
    
        if (!rowMap.has(pos.row)) {
            rowMap.set(pos.row, {});
        }
    
        const rowObj = rowMap.get(pos.row)!;
        const headerId = colIndexToId.get(pos.col);
        
        if (headerId) {
            rowObj[headerId] = cell.value;
        }
      });
  }
  
  return Array.from(rowMap.values());
};

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

const getTotalLabel = (op: PivotOperation) => {
    switch (op) {
        case 'SUM': return 'Sum';
        case 'COUNT': return 'Count';
        case 'AVG': return 'Avg';
        case 'MIN': return 'Min';
        case 'MAX': return 'Max';
        default: return 'Total';
    }
};

interface PivotCalculationResult {
    cells: Record<string, CellData>;
    width: number;
    height: number;
}

const computePivotCells = (sourceSheet: SheetData, config: PivotConfig): PivotCalculationResult => {
    const rawData = extractData(sourceSheet);
    
    // Normalize config to handle legacy single-value pivot tables
    let activeValues: PivotValue[] = config.values;
    if (!activeValues || activeValues.length === 0) {
        if (config.valueCol && config.operation) {
            activeValues = [{ column: config.valueCol, operation: config.operation }];
        } else {
            activeValues = [];
        }
    }

    const showRowTotals = config.showRowTotals !== false;
    const showColTotals = config.showColTotals !== false;

    // 1. Collect Data & Accumulate Totals
    const rowKeys = new Set<string>();
    const colKeys = new Set<string>();
    
    // Maps store arrays of arrays: Map<Key, Array<Array<number>>>
    // The outer array index corresponds to the activeValues index.
    // The inner array is the list of values collected for aggregation.
    const valueMap = new Map<string, number[][]>(); 
    
    const rowTotalsMap = new Map<string, number[][]>();
    const colTotalsMap = new Map<string, number[][]>();
    const allValues: number[][] = activeValues.map(() => []);

    const initAcc = () => activeValues.map(() => [] as number[]);

    rawData.forEach(row => {
        const rVal = String(row[config.rowLabelCol] ?? '(Blank)');
        rowKeys.add(rVal);
        
        let cVal = '';
        if (config.colLabelCol) {
            cVal = String(row[config.colLabelCol] ?? '(Blank)');
            colKeys.add(cVal);
        }

        const mapKey = config.colLabelCol ? `${rVal}|${cVal}` : rVal;
        
        if (!valueMap.has(mapKey)) valueMap.set(mapKey, initAcc());
        if (!rowTotalsMap.has(rVal)) rowTotalsMap.set(rVal, initAcc());
        if (config.colLabelCol) {
            if (!colTotalsMap.has(cVal)) colTotalsMap.set(cVal, initAcc());
        }

        activeValues.forEach((vConfig, idx) => {
            let rawVal = row[vConfig.column];
            let val = Number(rawVal);
            
            if (isNaN(val) && typeof rawVal === 'string') {
                 val = parseFloat(rawVal.replace(/[^0-9.-]/g, ''));
            }
            if (isNaN(val)) val = 0;

            if (vConfig.operation === 'COUNT') val = 1;

            valueMap.get(mapKey)![idx].push(val);
            rowTotalsMap.get(rVal)![idx].push(val);
            
            if (config.colLabelCol) {
                colTotalsMap.get(cVal)![idx].push(val);
            }
            allValues[idx].push(val);
        });
    });

    const sortedRows = Array.from(rowKeys).sort();
    const sortedCols = Array.from(colKeys).sort();
    
    // Helper to get friendly name for a value column
    const headers = getSheetHeaders(sourceSheet);
    const getValName = (col: string) => headers.find(h => h.id === col)?.label || col;

    // 2. Build new Cells
    const newCells: Record<string, CellData> = {};
    let maxColIndex = 0;
    let maxRowIndex = 0;

    // Header Setup
    // A1: Row Label Name
    const rowHeaderLabel = headers.find(h => h.id === config.rowLabelCol)?.label || 'Row Labels';
    newCells['A1'] = { raw: rowHeaderLabel, value: rowHeaderLabel };
    
    let currentHeaderCol = 1;

    if (config.colLabelCol) {
        // Matrix Layout
        // If multiple values, each col label spans multiple columns
        // e.g. | Region A | Region A | Region B | Region B |
        //      | Sum Sales| Count Id | Sum Sales| Count Id |

        // B1...: Column Label Values
        sortedCols.forEach((cVal) => {
            activeValues.forEach((vConfig) => {
                const cellId = getCellId(currentHeaderCol, 0);
                
                // Construct header label
                let label = cVal;
                if (activeValues.length > 1) {
                    label = `${cVal} (${getTotalLabel(vConfig.operation)} ${getValName(vConfig.column)})`;
                }
                
                newCells[cellId] = { raw: label, value: label };
                currentHeaderCol++;
            });
        });
        
        // Grand Total Header (Top Right)
        if (showRowTotals) {
             activeValues.forEach((vConfig) => {
                const cellId = getCellId(currentHeaderCol, 0);
                let label = 'Grand Total';
                if (activeValues.length > 1) {
                    label = `Total ${getTotalLabel(vConfig.operation)} ${getValName(vConfig.column)}`;
                }
                newCells[cellId] = { raw: label, value: label };
                currentHeaderCol++;
             });
        }
        
        maxColIndex = currentHeaderCol - 1;

    } else {
        // Simple List Layout
        activeValues.forEach((vConfig) => {
            const cellId = getCellId(currentHeaderCol, 0);
            const opLabel = `${getTotalLabel(vConfig.operation)} of ${getValName(vConfig.column)}`;
            newCells[cellId] = { raw: opLabel, value: opLabel };
            currentHeaderCol++;
        });
        maxColIndex = currentHeaderCol - 1;
    }

    // Body Construction
    sortedRows.forEach((rVal, rIdx) => {
        const gridRow = rIdx + 1; // Start at row 2
        maxRowIndex = Math.max(maxRowIndex, gridRow);

        // Row Label
        newCells[getCellId(0, gridRow)] = { raw: rVal, value: rVal };

        let currentCol = 1;

        if (config.colLabelCol) {
            // Matrix Body
            sortedCols.forEach((cVal) => {
                const mapKey = `${rVal}|${cVal}`;
                const valArrays = valueMap.get(mapKey);
                
                activeValues.forEach((vConfig, vIdx) => {
                    if (valArrays && valArrays[vIdx].length > 0) {
                        const result = aggregate(valArrays[vIdx], vConfig.operation);
                        newCells[getCellId(currentCol, gridRow)] = { raw: String(result), value: result };
                    }
                    currentCol++;
                });
            });

            // Row Total (End of row)
            if (showRowTotals) {
                const rowValArrays = rowTotalsMap.get(rVal);
                activeValues.forEach((vConfig, vIdx) => {
                     if (rowValArrays && rowValArrays[vIdx].length > 0) {
                        const rowResult = aggregate(rowValArrays[vIdx], vConfig.operation);
                        newCells[getCellId(currentCol, gridRow)] = { raw: String(rowResult), value: rowResult };
                     }
                     currentCol++;
                });
            }
        } else {
            // List Body
            const valArrays = valueMap.get(rVal);
            activeValues.forEach((vConfig, vIdx) => {
                if (valArrays && valArrays[vIdx].length > 0) {
                    const result = aggregate(valArrays[vIdx], vConfig.operation);
                    newCells[getCellId(currentCol, gridRow)] = { raw: String(result), value: result };
                }
                currentCol++;
            });
        }
    });

    // Column Grand Totals (Bottom row)
    if (showColTotals) {
        const footerRow = maxRowIndex + 1;
        newCells[getCellId(0, footerRow)] = { raw: 'Grand Total', value: 'Grand Total' };
        maxRowIndex = footerRow;

        let currentCol = 1;

        if (config.colLabelCol) {
            // Col Totals
            sortedCols.forEach((cVal) => {
                const colValArrays = colTotalsMap.get(cVal);
                activeValues.forEach((vConfig, vIdx) => {
                    if (colValArrays && colValArrays[vIdx].length > 0) {
                        const colResult = aggregate(colValArrays[vIdx], vConfig.operation);
                        newCells[getCellId(currentCol, footerRow)] = { raw: String(colResult), value: colResult };
                    }
                    currentCol++;
                });
            });
            
            // Bottom Right Grand Total
            if (showRowTotals) {
                 activeValues.forEach((vConfig, vIdx) => {
                    if (allValues[vIdx].length > 0) {
                        const grandResult = aggregate(allValues[vIdx], vConfig.operation);
                        newCells[getCellId(currentCol, footerRow)] = { raw: String(grandResult), value: grandResult };
                    }
                    currentCol++;
                 });
            }
        } else {
            // List Mode Grand Total
             activeValues.forEach((vConfig, vIdx) => {
                if (allValues[vIdx].length > 0) {
                    const grandResult = aggregate(allValues[vIdx], vConfig.operation);
                    newCells[getCellId(currentCol, footerRow)] = { raw: String(grandResult), value: grandResult };
                }
                currentCol++;
             });
        }
    }

    const desiredWidth = maxColIndex + 2;
    const desiredHeight = maxRowIndex + 2;

    const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const viewportH = typeof window !== 'undefined' ? window.innerHeight : 1080;

    const maxW = Math.max(5, Math.floor((viewportW * 0.85) / CELL_WIDTH));
    const maxH = Math.max(10, Math.floor((viewportH * 0.85) / CELL_HEIGHT));

    return {
        cells: newCells,
        width: Math.min(desiredWidth, maxW),
        height: Math.min(desiredHeight, maxH)
    };
};

export const generatePivotTable = (sourceSheet: SheetData, config: PivotConfig): SheetData => {
    const { cells, width, height } = computePivotCells(sourceSheet, config);

    return {
        id: Math.random().toString(36).substr(2, 9),
        title: `Pivot: ${sourceSheet.title}`,
        position: { 
            x: sourceSheet.position.x + (sourceSheet.size.width * CELL_WIDTH) + 60, 
            y: sourceSheet.position.y 
        },
        size: { width, height },
        cells,
        pivotConfig: config
    };
};

export const refreshPivotTable = (pivotSheet: SheetData, sourceSheet: SheetData): SheetData => {
    if (!pivotSheet.pivotConfig) return pivotSheet;

    const { cells: newCells, width, height } = computePivotCells(sourceSheet, pivotSheet.pivotConfig);
    
    const mergedCells: Record<string, CellData> = {};
    Object.keys(newCells).forEach(key => {
        const newCell = newCells[key];
        const oldCell = pivotSheet.cells[key];
        
        if (oldCell && oldCell.format) {
             mergedCells[key] = { ...newCell, format: oldCell.format };
        } else {
             mergedCells[key] = newCell;
        }
    });

    return {
        ...pivotSheet,
        size: { width, height },
        cells: mergedCells
    };
};