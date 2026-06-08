
import { SheetData, CellData, FilterCondition, FilterType, TimeGranularity } from '../types';
import { getCellId, parseCellId } from './formulas';

export const inferColumnType = (sheet: SheetData, colId: string): FilterType => {
  const colIndex = parseCellId(`${colId}1`)?.col;
  if (colIndex === undefined) return 'text';

  let numCount = 0;
  let dateCount = 0;
  let textCount = 0;
  let sampleSize = 0;

  const maxRows = 50; // Check first 50 rows for inference

  for (let r = 1; r < maxRows; r++) { // Skip header
    const cellId = getCellId(colIndex, r);
    const cell = sheet.cells[cellId];
    if (!cell || cell.value === null || cell.value === '') continue;

    sampleSize++;
    const val = cell.value;
    const strVal = String(val).trim();

    if (typeof val === 'number') {
      numCount++;
      continue;
    }

    // Check strict number string
    if (!isNaN(Number(strVal)) && strVal !== '') {
      numCount++;
      continue;
    }

    // Check Date
    // Simple check: parseable date and contains separators
    const date = Date.parse(strVal);
    if (!isNaN(date) && (strVal.includes('/') || strVal.includes('-') || strVal.includes(','))) {
       dateCount++;
       continue;
    }

    textCount++;
  }

  if (sampleSize === 0) return 'text';
  
  if (numCount > sampleSize * 0.8) return 'number';
  if (dateCount > sampleSize * 0.8) return 'date';
  
  return 'text';
};

const parseDateValue = (val: any): number | null => {
    if (val instanceof Date) return val.getTime();
    if (typeof val === 'number') return val; // Assume timestamp?
    const d = Date.parse(String(val));
    return isNaN(d) ? null : d;
};

export const matchesFilterCondition = (cellValue: any, filter: FilterCondition): boolean => {
    const valStr = String(cellValue ?? '').toLowerCase();
    
    if (filter.type === 'text') {
        const filterVal = String(filter.value).toLowerCase();
        switch (filter.operator) {
            case 'contains': return valStr.includes(filterVal);
            case 'equals': return valStr === filterVal;
            case 'startsWith': return valStr.startsWith(filterVal);
            case 'endsWith': return valStr.endsWith(filterVal);
            default: return true;
        }
    }

    if (filter.type === 'number') {
        const numVal = parseFloat(valStr);
        if (isNaN(numVal)) return false; // Non-numbers don't match number filters

        const filterNum = Number(filter.value);
        
        switch (filter.operator) {
            case 'eq': return numVal === filterNum;
            case 'neq': return numVal !== filterNum;
            case 'gt': return numVal > filterNum;
            case 'lt': return numVal < filterNum;
            case 'range': 
                const [min, max] = Array.isArray(filter.value) ? filter.value : [0, 0];
                return numVal >= min && numVal <= max;
            default: return true;
        }
    }

    if (filter.type === 'date') {
        const dateVal = parseDateValue(cellValue);
        if (dateVal === null) return false;

        if (filter.operator === 'range') {
             const [startStr, endStr] = Array.isArray(filter.value) ? filter.value : ['', ''];
             const start = parseDateValue(startStr);
             const end = parseDateValue(endStr);
             if (start === null || end === null) return true;
             // Include the whole end day (add 24h)
             return dateVal >= start && dateVal <= (end + 86400000); 
        }

        const targetDate = parseDateValue(filter.value);
        if (targetDate === null) return true;
        
        // Normalize for 'on' comparison (ignore time)
        const d1 = new Date(dateVal);
        d1.setHours(0,0,0,0);
        const d2 = new Date(targetDate);
        d2.setHours(0,0,0,0);
        
        switch (filter.operator) {
            case 'before': return dateVal < targetDate;
            case 'after': return dateVal > targetDate;
            case 'on': return d1.getTime() === d2.getTime();
            default: return true;
        }
    }

    return true;
};

export const getFilteredRows = (sheet: SheetData, explicitMaxRow?: number): number[] | null => {
    const hasFilter = sheet.filters && sheet.filters.length > 0;
    const hasSort = !!sheet.sort;

    if (!hasFilter && !hasSort) {
        return null; // Indicates no filtering/sorting (linear 0..N)
    }

    // Determine max row to scan
    let maxRow = explicitMaxRow ?? 0;
    
    if (explicitMaxRow === undefined) {
        Object.keys(sheet.cells).forEach(k => {
            const pos = parseCellId(k);
            if (pos) maxRow = Math.max(maxRow, pos.row);
        });
    }

    // Ensure we scan at least the visible grid area
    maxRow = Math.max(maxRow, sheet.size.height - 1);

    let visibleRows: number[] = [];
    
    // Always include header (row 0)
    visibleRows.push(0);

    // Filter caches
    const colIndexCache: Record<string, number> = {};
    if (hasFilter && sheet.filters) {
        sheet.filters.forEach(f => {
            if (colIndexCache[f.columnId] === undefined) {
                 colIndexCache[f.columnId] = parseCellId(`${f.columnId}1`)?.col ?? -1;
            }
        });
    }

    // Identify Grand Total row if sorting is active on a Pivot Table
    // We want to exclude it from the sort and pin it to the bottom
    let grandTotalRowIndex = -1;
    if (hasSort && sheet.pivotConfig && sheet.pivotConfig.showColTotals !== false) {
        // Optimistic search: check from the bottom up since GT is usually at the end
        // Limit search to last 50 rows or full sheet if small
        const searchLimit = Math.max(0, maxRow - 500); 
        for(let r = maxRow; r >= searchLimit; r--) {
            const cell = sheet.cells[getCellId(0, r)];
            // Pivot tables put "Grand Total" string in first column
            if (cell && cell.value === 'Grand Total') {
                grandTotalRowIndex = r;
                break;
            }
        }
    }

    for (let r = 1; r <= maxRow; r++) {
        // Skip Grand Total row if we found one (we'll append it later)
        if (r === grandTotalRowIndex) continue;

        let match = true;
        if (hasFilter && sheet.filters) {
            for (const filter of sheet.filters) {
                const colIdx = colIndexCache[filter.columnId];
                if (colIdx === -1) continue;

                const cellId = getCellId(colIdx, r);
                const cell = sheet.cells[cellId];
                const val = cell?.value;
                
                if (!matchesFilterCondition(val, filter)) {
                    match = false;
                    break;
                }
            }
        }
        if (match) {
            visibleRows.push(r);
        }
    }

    // If sorting is active, sort the rows (excluding header at index 0)
    if (hasSort && sheet.sort) {
        const sortColId = sheet.sort.columnId;
        const sortColIdx = parseCellId(`${sortColId}1`)?.col;
        
        if (sortColIdx !== undefined) {
            const direction = sheet.sort.direction === 'asc' ? 1 : -1;
            
            // Extract header and sort body
            const header = visibleRows[0];
            const body = visibleRows.slice(1);
            
            body.sort((rowA, rowB) => {
                const cellA = sheet.cells[getCellId(sortColIdx, rowA)];
                const cellB = sheet.cells[getCellId(sortColIdx, rowB)];
                
                const valA = cellA?.value;
                const valB = cellB?.value;
                
                // Handle null/undefined/empty
                const isEmptyA = valA === null || valA === undefined || valA === '';
                const isEmptyB = valB === null || valB === undefined || valB === '';
                
                if (isEmptyA && isEmptyB) return 0;
                if (isEmptyA) return 1; // Empty always at bottom
                if (isEmptyB) return -1;
                
                // Compare Numbers
                if (typeof valA === 'number' && typeof valB === 'number') {
                    return (valA - valB) * direction;
                }
                
                // Compare Dates/Strings
                const strA = String(valA).toLowerCase();
                const strB = String(valB).toLowerCase();
                
                // Try numeric string comparison
                const numA = parseFloat(strA);
                const numB = parseFloat(strB);
                if (!isNaN(numA) && !isNaN(numB) && isFinite(numA) && isFinite(numB)) {
                    // Check if strings were purely numeric
                    if (strA.trim() === String(numA) && strB.trim() === String(numB)) {
                         return (numA - numB) * direction;
                    }
                }

                if (strA < strB) return -1 * direction;
                if (strA > strB) return 1 * direction;
                return 0;
            });
            
            visibleRows = [header, ...body];
        }
    }

    if (grandTotalRowIndex !== -1) {
        let showGT = true;
        if (hasFilter && sheet.filters) {
             for (const filter of sheet.filters) {
                const colIdx = colIndexCache[filter.columnId];
                if (colIdx === -1) continue;
                const cell = sheet.cells[getCellId(colIdx, grandTotalRowIndex)];
                if (!matchesFilterCondition(cell?.value, filter)) {
                    showGT = false;
                    break;
                }
             }
        }
        
        if (showGT) {
            visibleRows.push(grandTotalRowIndex);
        }
    }

    return visibleRows;
};

// Calculate smart granularity based on a set of dates
export const determineSmartGranularity = (dates: number[]): TimeGranularity => {
    if (dates.length < 2) return 'day';

    const minDate = Math.min(...dates);
    const maxDate = Math.max(...dates);
    const spanMs = maxDate - minDate;
    
    // Estimate counts based on full span to check density
    const days = spanMs / (1000 * 60 * 60 * 24);
    if (days <= 20) return 'day';

    const weeks = days / 7;
    if (weeks <= 20) return 'week';

    const months = days / 30;
    if (months <= 20) return 'month';

    const quarters = days / 90;
    if (quarters <= 20) return 'quarter';

    return 'year';
};

// Estimates the amount of data points in a specific column, accounting for filters
export const getValidDataCount = (sheet: SheetData, colId: string): number => {
    const colIdx = parseCellId(`${colId}1`)?.col;
    if (colIdx === undefined) return 0;

    const visibleRows = getFilteredRows(sheet);
    if (visibleRows) {
        return Math.max(0, visibleRows.length - 1);
    }

    let count = 0;
    Object.keys(sheet.cells).forEach(k => {
        const p = parseCellId(k);
        if (p && p.col === colIdx && p.row > 0) {
            count++;
        }
    });
    return count;
};

// Determines time granularity based purely on the number of data points
export const suggestGranularityByCount = (count: number): TimeGranularity => {
    if (count >= 1000) return 'year';
    if (count >= 360) return 'quarter';
    if (count >= 90) return 'month';
    if (count >= 21) return 'week';
    return 'day';
};
