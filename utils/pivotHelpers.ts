import {
  CellData,
  FilterCondition,
  PivotCondition,
  PivotConfig,
  PivotOperation,
  PivotValue,
  SheetData
} from '../types';
import { getCellId, parseCellId } from './formulas';
import { getSheetHeaders } from './chartHelpers';
import { CELL_WIDTH, CELL_HEIGHT } from '../constants';
import { getFilteredRows, matchesFilterCondition } from './dataAnalysis';
import { applyFormatRulesToCells, extendFormatRulesToNewHeight } from './formatRules';

type SourceRow = Record<string, any>;

interface PivotAccumulator {
  values: number[];
  matchedRows: number;
  ignoredNonNumeric: number;
}

interface PivotCalculationResult {
  cells: Record<string, CellData>;
  width: number;
  height: number;
  warnings: string[];
}

const createAccumulator = (): PivotAccumulator => ({
  values: [],
  matchedRows: 0,
  ignoredNonNumeric: 0
});

const extractData = (sheet: SheetData): SourceRow[] => {
  const headers = getSheetHeaders(sheet);
  const colIndexToId = new Map<number, string>();
  headers.forEach(h => colIndexToId.set(h.index, h.id));

  const rowMap = new Map<number, SourceRow>();
  const visibleRows = getFilteredRows(sheet);

  if (visibleRows) {
    visibleRows.forEach(rowIndex => {
      if (rowIndex === 0) return;

      headers.forEach(header => {
        const cellId = getCellId(header.index, rowIndex);
        const cell = sheet.cells[cellId];
        if (cell && cell.value !== null && cell.value !== undefined && String(cell.value).trim() !== '') {
          if (!rowMap.has(rowIndex)) rowMap.set(rowIndex, {});
          rowMap.get(rowIndex)![header.id] = cell.value;
        }
      });
    });
  } else {
    Object.entries(sheet.cells).forEach(([cellId, cell]) => {
      if (!cell || cell.value === null || cell.value === undefined || String(cell.value).trim() === '') return;

      const position = parseCellId(cellId);
      if (!position || position.row === 0) return;

      if (!rowMap.has(position.row)) {
        rowMap.set(position.row, {});
      }

      const headerId = colIndexToId.get(position.col);
      if (headerId) {
        rowMap.get(position.row)![headerId] = cell.value;
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

const hasConditions = (valueConfig: PivotValue) =>
  Array.isArray(valueConfig.conditions) && valueConfig.conditions.length > 0;

const getConditionalOperationLabel = (valueConfig: PivotValue) => {
  if (hasConditions(valueConfig) && valueConfig.operation === 'SUM') return 'SUMIF';
  if (hasConditions(valueConfig) && valueConfig.operation === 'COUNT') return 'COUNTIF';
  return getTotalLabel(valueConfig.operation);
};

const formatConditionValue = (value: any) => {
  if (Array.isArray(value)) return value.join(' - ');
  return String(value);
};

const getConditionOperatorLabel = (operator: PivotCondition['operator']) => {
  switch (operator) {
    case 'contains': return 'contains';
    case 'equals':
    case 'eq':
    case 'on':
      return '=';
    case 'startsWith': return 'starts with';
    case 'endsWith': return 'ends with';
    case 'gt': return 'greater than';
    case 'lt': return 'less than';
    case 'neq': return 'not equals';
    case 'range': return 'between';
    case 'before': return 'before';
    case 'after': return 'after';
    default: return operator;
  }
};

const getConditionLabel = (
  condition: PivotCondition,
  getColumnName: (columnId: string) => string
) => `${getColumnName(condition.columnId)} ${getConditionOperatorLabel(condition.operator)} ${formatConditionValue(condition.value)}`;

const getMetricLabel = (
  valueConfig: PivotValue,
  getColumnName: (columnId: string) => string
) => {
  const explicitLabel = valueConfig.label?.trim();
  if (explicitLabel) return explicitLabel;

  const operationLabel = getConditionalOperationLabel(valueConfig);
  const valueColumnLabel = valueConfig.countRows || !valueConfig.column
    ? 'rows'
    : getColumnName(valueConfig.column);
  const baseLabel = `${operationLabel} of ${valueColumnLabel}`;

  if (!hasConditions(valueConfig)) return baseLabel;

  const conditionLabel = valueConfig.conditions!
    .map(condition => getConditionLabel(condition, getColumnName))
    .join(' and ');
  return `${baseLabel} where ${conditionLabel}`;
};

const getMatrixMetricLabel = (
  valueConfig: PivotValue,
  getColumnName: (columnId: string) => string
) => {
  if (!hasConditions(valueConfig) && !valueConfig.label && valueConfig.column && !valueConfig.countRows) {
    return `${getTotalLabel(valueConfig.operation)} ${getColumnName(valueConfig.column)}`;
  }
  return getMetricLabel(valueConfig, getColumnName);
};

const parsePivotNumber = (rawValue: any): { ok: true; value: number } | { ok: false } => {
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    return { ok: true, value: rawValue };
  }

  if (typeof rawValue === 'string' && rawValue.trim() !== '') {
    const normalized = rawValue.replace(/[^0-9.-]/g, '');
    if (normalized.trim() === '') return { ok: false };
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return { ok: true, value: parsed };
  }

  return { ok: false };
};

const conditionMatchesRow = (row: SourceRow, condition: PivotCondition) =>
  matchesFilterCondition(row[condition.columnId], {
    id: condition.id ?? '',
    columnId: condition.columnId,
    type: condition.type,
    operator: condition.operator,
    value: condition.value
  } as FilterCondition);

const metricMatchesRow = (row: SourceRow, valueConfig: PivotValue) => {
  if (!hasConditions(valueConfig)) return true;
  return valueConfig.conditions!.every(condition => conditionMatchesRow(row, condition));
};

const recordMetricValue = (
  row: SourceRow,
  valueConfig: PivotValue,
  accumulator: PivotAccumulator
) => {
  if (!metricMatchesRow(row, valueConfig)) return;

  accumulator.matchedRows++;

  if (valueConfig.operation === 'COUNT') {
    accumulator.values.push(1);
    return;
  }

  const parsed = parsePivotNumber(row[valueConfig.column ?? '']);
  if (parsed.ok) {
    accumulator.values.push(parsed.value);
    return;
  }

  if (valueConfig.operation === 'SUM' && hasConditions(valueConfig)) {
    accumulator.ignoredNonNumeric++;
    return;
  }

  accumulator.values.push(0);
};

const getAccumulatorValue = (accumulator: PivotAccumulator, operation: PivotOperation) =>
  aggregate(accumulator.values, operation);

const writeAccumulatorCell = (
  cells: Record<string, CellData>,
  cellId: string,
  accumulator: PivotAccumulator,
  valueConfig: PivotValue
) => {
  const shouldWriteZeroMatch = hasConditions(valueConfig)
    && (valueConfig.operation === 'SUM' || valueConfig.operation === 'COUNT');
  if (accumulator.matchedRows === 0 && !shouldWriteZeroMatch) return;
  const result = getAccumulatorValue(accumulator, valueConfig.operation);
  cells[cellId] = { raw: String(result), value: result };
};

const computePivotCells = (sourceSheet: SheetData, config: PivotConfig): PivotCalculationResult => {
  const rawData = extractData(sourceSheet);

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
  const rowKeys = new Set<string>();
  const colKeys = new Set<string>();

  const valueMap = new Map<string, PivotAccumulator[]>();
  const rowTotalsMap = new Map<string, PivotAccumulator[]>();
  const colTotalsMap = new Map<string, PivotAccumulator[]>();
  const allValues: PivotAccumulator[] = activeValues.map(createAccumulator);
  const initAcc = () => activeValues.map(createAccumulator);

  rawData.forEach(row => {
    const rowKey = String(row[config.rowLabelCol] ?? '(Blank)');
    rowKeys.add(rowKey);

    let colKey = '';
    if (config.colLabelCol) {
      colKey = String(row[config.colLabelCol] ?? '(Blank)');
      colKeys.add(colKey);
    }

    const mapKey = config.colLabelCol ? `${rowKey}|${colKey}` : rowKey;

    if (!valueMap.has(mapKey)) valueMap.set(mapKey, initAcc());
    if (!rowTotalsMap.has(rowKey)) rowTotalsMap.set(rowKey, initAcc());
    if (config.colLabelCol && !colTotalsMap.has(colKey)) colTotalsMap.set(colKey, initAcc());

    activeValues.forEach((valueConfig, valueIndex) => {
      const cellAccumulator = valueMap.get(mapKey)![valueIndex];
      recordMetricValue(row, valueConfig, cellAccumulator);
      recordMetricValue(row, valueConfig, rowTotalsMap.get(rowKey)![valueIndex]);

      if (config.colLabelCol) {
        recordMetricValue(row, valueConfig, colTotalsMap.get(colKey)![valueIndex]);
      }

      recordMetricValue(row, valueConfig, allValues[valueIndex]);
    });
  });

  const sortedRows = Array.from(rowKeys).sort();
  const sortedCols = Array.from(colKeys).sort();
  const headers = getSheetHeaders(sourceSheet);
  const getColumnName = (columnId: string) => headers.find(h => h.id === columnId)?.label || columnId;

  const newCells: Record<string, CellData> = {};
  let maxColIndex = 0;
  let maxRowIndex = 0;
  const rowHeaderLabel = getColumnName(config.rowLabelCol) || 'Row Labels';
  newCells.A1 = { raw: rowHeaderLabel, value: rowHeaderLabel };

  let currentHeaderCol = 1;

 if (config.colLabelCol) {
    sortedCols.forEach(colKey => {
      activeValues.forEach(valueConfig => {
        const metricLabel = getMatrixMetricLabel(valueConfig, getColumnName);
        const includeMetricLabel = activeValues.length > 1 || hasConditions(valueConfig) || !!valueConfig.label;
        const label = includeMetricLabel ? `${colKey} (${metricLabel})` : colKey;
        newCells[getCellId(currentHeaderCol, 0)] = { raw: label, value: label };
        currentHeaderCol++;
      });
    });

    if (showRowTotals) {
      activeValues.forEach(valueConfig => {
        const metricLabel = getMatrixMetricLabel(valueConfig, getColumnName);
        const label = activeValues.length > 1 || hasConditions(valueConfig) || !!valueConfig.label
          ? `Total ${metricLabel}`
          : 'Grand Total';
        newCells[getCellId(currentHeaderCol, 0)] = { raw: label, value: label };
        currentHeaderCol++;
      });
    }

    maxColIndex = currentHeaderCol - 1;
  } else {
    activeValues.forEach(valueConfig => {
      const label = getMetricLabel(valueConfig, getColumnName);
      newCells[getCellId(currentHeaderCol, 0)] = { raw: label, value: label };
      currentHeaderCol++;
    });
    maxColIndex = currentHeaderCol - 1;
  }

  sortedRows.forEach((rowKey, rowIndex) => {
    const gridRow = rowIndex + 1;
    maxRowIndex = Math.max(maxRowIndex, gridRow);
    newCells[getCellId(0, gridRow)] = { raw: rowKey, value: rowKey };

    let currentCol = 1;

    if (config.colLabelCol) {
      sortedCols.forEach(colKey => {
        const mapKey = `${rowKey}|${colKey}`;
        const accumulators = valueMap.get(mapKey);

        activeValues.forEach((valueConfig, valueIndex) => {
          if (accumulators) {
            writeAccumulatorCell(
              newCells,
              getCellId(currentCol, gridRow),
              accumulators[valueIndex],
              valueConfig
            );
          }
          currentCol++;
        });
      });

      if (showRowTotals) {
        const rowAccumulators = rowTotalsMap.get(rowKey);
        activeValues.forEach((valueConfig, valueIndex) => {
          if (rowAccumulators) {
            writeAccumulatorCell(
              newCells,
              getCellId(currentCol, gridRow),
              rowAccumulators[valueIndex],
              valueConfig
            );
          }
          currentCol++;
        });
      }
    } else {
      const accumulators = valueMap.get(rowKey);
      activeValues.forEach((valueConfig, valueIndex) => {
        if (accumulators) {
          writeAccumulatorCell(
            newCells,
            getCellId(currentCol, gridRow),
            accumulators[valueIndex],
            valueConfig
          );
        }
        currentCol++;
      });
    }
  });

  if (showColTotals) {
    const footerRow = maxRowIndex + 1;
    newCells[getCellId(0, footerRow)] = { raw: 'Grand Total', value: 'Grand Total' };
    maxRowIndex = footerRow;

    let currentCol = 1;

    if (config.colLabelCol) {
      sortedCols.forEach(colKey => {
        const colAccumulators = colTotalsMap.get(colKey);
        activeValues.forEach((valueConfig, valueIndex) => {
          if (colAccumulators) {
            writeAccumulatorCell(
              newCells,
              getCellId(currentCol, footerRow),
              colAccumulators[valueIndex],
              valueConfig
            );
          }
          currentCol++;
        });
      });

      if (showRowTotals) {
        activeValues.forEach((valueConfig, valueIndex) => {
          writeAccumulatorCell(
            newCells,
            getCellId(currentCol, footerRow),
            allValues[valueIndex],
            valueConfig
          );
          currentCol++;
        });
      }
    } else {
      activeValues.forEach((valueConfig, valueIndex) => {
        writeAccumulatorCell(
          newCells,
          getCellId(currentCol, footerRow),
          allValues[valueIndex],
          valueConfig
        );
        currentCol++;
      });
    }
  }

  const warnings = activeValues.flatMap((valueConfig, valueIndex) => {
    if (valueConfig.operation !== 'SUM' || !hasConditions(valueConfig)) return [];
    const ignoredCount = allValues[valueIndex].ignoredNonNumeric;
    if (ignoredCount === 0) return [];

    const metricLabel = getMetricLabel(valueConfig, getColumnName);
    const valueColumn = valueConfig.column ? getColumnName(valueConfig.column) : 'value';
    return [`${ignoredCount} blank/non-numeric ${valueColumn} value${ignoredCount === 1 ? '' : 's'} ignored in ${metricLabel}.`];
  });

  const desiredWidth = maxColIndex + 2;
  const desiredHeight = maxRowIndex + 2;
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 1080;
  const maxW = Math.max(5, Math.floor((viewportW * 0.85) / CELL_WIDTH));
  const maxH = Math.max(10, Math.floor((viewportH * 0.85) / CELL_HEIGHT));

  return {
    cells: newCells,
    width: Math.min(desiredWidth, maxW),
    height: Math.min(desiredHeight, maxH),
    warnings
  };
};

export const generatePivotTable = (sourceSheet: SheetData, config: PivotConfig): SheetData => {
  const { cells, width, height, warnings } = computePivotCells(sourceSheet, config);

  return {
    id: Math.random().toString(36).substr(2, 9),
    title: `Pivot: ${sourceSheet.title}`,
    position: {
      x: sourceSheet.position.x + (sourceSheet.size.width * CELL_WIDTH) + 60,
      y: sourceSheet.position.y
    },
    size: { width, height },
    cells,
    pivotConfig: config,
    pivotWarnings: warnings
  };
};

export const refreshPivotTable = (pivotSheet: SheetData, sourceSheet: SheetData): SheetData => {
  if (!pivotSheet.pivotConfig) return pivotSheet;

  const { cells: newCells, width, height, warnings } = computePivotCells(sourceSheet, pivotSheet.pivotConfig);

  // Pivot rows are re-sorted alphabetically by group label on every refresh, so a
  // newly-appearing group can insert in the middle and push existing rows down a
  // slot. Carrying a saved per-cell format forward by its raw cellId would leave
  // that format stuck on the old row position, now showing a different group's
  // data. Instead, find where each row's label ended up before refresh and carry
  // its per-column formats forward from there.
  const oldRowLabelToRow = new Map<string | number, number>();
  Object.keys(pivotSheet.cells).forEach(cellId => {
    const position = parseCellId(cellId);
    if (!position || position.col !== 0 || position.row === 0) return;
    const label = pivotSheet.cells[cellId].value;
    if (label !== null && label !== undefined) oldRowLabelToRow.set(label, position.row);
  });

  const mergedCells: Record<string, CellData> = {};
  Object.keys(newCells).forEach(cellId => {
    const newCell = newCells[cellId];
    const position = parseCellId(cellId);

    let oldCell = pivotSheet.cells[cellId];
    if (position && position.row > 0 && position.col > 0) {
      const rowLabel = newCells[getCellId(0, position.row)]?.value;
      const oldRow = rowLabel !== null && rowLabel !== undefined ? oldRowLabelToRow.get(rowLabel) : undefined;
      oldCell = oldRow !== undefined ? pivotSheet.cells[getCellId(position.col, oldRow)] : undefined;
    }

    if (oldCell && oldCell.format) {
      mergedCells[cellId] = { ...newCell, format: oldCell.format };
    } else {
      mergedCells[cellId] = newCell;
    }
  });

  const extendedFormatRules = extendFormatRulesToNewHeight(
    pivotSheet.formatRules,
    pivotSheet.size.height,
    height,
    pivotSheet.pivotConfig.showColTotals !== false
  );
  const formattedCells = applyFormatRulesToCells(mergedCells, extendedFormatRules);

  return {
    ...pivotSheet,
    size: { width, height },
    cells: formattedCells,
    formatRules: extendedFormatRules,
    pivotWarnings: warnings
  };
};
