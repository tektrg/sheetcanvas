import { SheetData, PivotConfig, SparklineConfig, ChartConfig } from '../types';
import { getSheetHeaders } from './chartHelpers';

// A derived object (pivot/sparkline/chart) references its source's columns by
// spreadsheet letter (A, B, C…). When the source refreshes and its columns move
// (reorder), disappear, or get renamed, those letters must be re-resolved against
// the new source — or the reference dropped. This module owns that rebinding.
//
// Safety rule (the whole point of rebinding by name): a column that HAS a real
// header name is matched ONLY by that name. If the name is gone or ambiguous the
// reference is DROPPED, never silently repointed to whatever now sits at the old
// position — that is exactly the wrong-number corruption we are avoiding. Columns
// with EMPTY headers have no name to match on, so they fall back to position.

interface SourceColumn {
  colId: string;        // spreadsheet letter, e.g. "B"
  label: string | null; // real header text, or null when the header cell is blank
}

export interface ColumnRebind {
  // Resolve an old source column letter to its new letter, or null if it can no
  // longer be resolved (removed / renamed / ambiguous).
  resolve(oldColumnId: string): string | null;
  // True when the source's column layout (count, order, or any header text)
  // changed. When false, callers can skip rebinding entirely (fast path).
  shapeChanged: boolean;
}

const readSourceColumns = (sheet: SheetData): SourceColumn[] =>
  getSheetHeaders(sheet).map(header => {
    const cell = sheet.cells[`${header.id}1`];
    const value = cell?.value;
    const isBlank = value === null || value === undefined || String(value).trim() === '';
    return { colId: header.id, label: isBlank ? null : String(value) };
  });

export const buildColumnRebind = (oldSheet: SheetData, newSheet: SheetData): ColumnRebind => {
  const oldColumns = readSourceColumns(oldSheet);
  const newColumns = readSourceColumns(newSheet);

  const oldById = new Map(oldColumns.map(col => [col.colId, col]));
  const newById = new Map(newColumns.map(col => [col.colId, col]));

  const newLabelCount = new Map<string, number>();
  const newLabelToId = new Map<string, string>();
  newColumns.forEach(col => {
    if (col.label === null) return;
    newLabelCount.set(col.label, (newLabelCount.get(col.label) ?? 0) + 1);
    if (!newLabelToId.has(col.label)) newLabelToId.set(col.label, col.colId);
  });

  const shapeChanged =
    oldColumns.length !== newColumns.length ||
    oldColumns.some((col, index) => col.label !== (newColumns[index]?.label ?? null));

  const resolve = (oldColumnId: string): string | null => {
    const oldColumn = oldById.get(oldColumnId);
    if (!oldColumn) return null;

    if (oldColumn.label !== null) {
      // Named column: match by unique header text only.
      if (newLabelCount.get(oldColumn.label) === 1) return newLabelToId.get(oldColumn.label)!;
      return null; // gone, renamed, or duplicated → drop rather than guess.
    }

    // Empty header: nothing to match by name, so fall back to position — but only
    // if that position still exists AND is still an empty-header column (so we
    // don't silently bind onto a newly-named column that took the slot).
    if (newById.get(oldColumnId)?.label === null) return oldColumnId;
    return null;
  };

  return { resolve, shapeChanged };
};

export interface ConfigRebindResult<TConfig> {
  config: TConfig;
  warnings: string[];
  // When true a structural column (the pivot row dimension, sparkline date/group
  // dimension, or chart label/group axis) could not be resolved. The derived
  // object cannot be meaningfully recomputed and should keep its last-good data.
  structuralBroken: boolean;
}

export const rebindPivotConfig = (config: PivotConfig, rebind: ColumnRebind): ConfigRebindResult<PivotConfig> => {
  const warnings: string[] = [];
  let structuralBroken = false;

  const newRowLabelCol = rebind.resolve(config.rowLabelCol);
  if (newRowLabelCol === null) {
    structuralBroken = true;
    warnings.push(`Pivot row dimension (source column ${config.rowLabelCol}) was removed or renamed; the pivot needs reconfiguration.`);
  }

  let newColLabelCol = config.colLabelCol;
  if (config.colLabelCol) {
    const resolved = rebind.resolve(config.colLabelCol);
    if (resolved === null) {
      warnings.push(`Pivot column split (source column ${config.colLabelCol}) was removed; showing the pivot without the split.`);
      newColLabelCol = undefined;
    } else {
      newColLabelCol = resolved;
    }
  }

  const newValues: PivotConfig['values'] = [];
  for (const value of config.values) {
    let conditions = value.conditions;
    if (conditions && conditions.length > 0) {
      const remapped = [];
      let conditionDropped = false;
      for (const condition of conditions) {
        const resolved = rebind.resolve(condition.columnId);
        if (resolved === null) {
          conditionDropped = true;
          break;
        }
        remapped.push({ ...condition, columnId: resolved });
      }
      if (conditionDropped) {
        warnings.push(`Dropped metric "${value.label ?? value.operation}" — a column used by its condition was removed from the source.`);
        continue;
      }
      conditions = remapped;
    }

    if (value.countRows || !value.column) {
      newValues.push({ ...value, conditions });
      continue;
    }

    const resolved = rebind.resolve(value.column);
    if (resolved === null) {
      warnings.push(`Dropped metric "${value.label ?? value.column}" — its source column was removed or renamed.`);
      continue;
    }
    newValues.push({ ...value, column: resolved, conditions });
  }

  if (newValues.length === 0 && !structuralBroken) {
    structuralBroken = true;
    warnings.push('All pivot metrics were removed from the source; the pivot needs reconfiguration.');
  }

  return {
    config: {
      ...config,
      rowLabelCol: newRowLabelCol ?? config.rowLabelCol,
      colLabelCol: newColLabelCol,
      values: newValues,
    },
    warnings,
    structuralBroken,
  };
};

export const rebindSparklineConfig = (config: SparklineConfig, rebind: ColumnRebind): ConfigRebindResult<SparklineConfig> => {
  const warnings: string[] = [];
  let structuralBroken = false;

  const newDateCol = rebind.resolve(config.dateCol);
  if (newDateCol === null) {
    structuralBroken = true;
    warnings.push(`Sparkline date column (source column ${config.dateCol}) was removed or renamed; the table needs reconfiguration.`);
  }

  const next: SparklineConfig = { ...config, dateCol: newDateCol ?? config.dateCol };

  if (config.mode === 'group') {
    const newGroupCol = config.groupCol ? rebind.resolve(config.groupCol) : null;
    if (config.groupCol && newGroupCol === null) {
      structuralBroken = true;
      warnings.push(`Sparkline group column (source column ${config.groupCol}) was removed or renamed; the table needs reconfiguration.`);
    } else if (newGroupCol) {
      next.groupCol = newGroupCol;
    }

    const newValueCol = config.valueCol ? rebind.resolve(config.valueCol) : null;
    if (config.valueCol && newValueCol === null) {
      structuralBroken = true;
      warnings.push(`Sparkline value column (source column ${config.valueCol}) was removed or renamed; the table needs reconfiguration.`);
    } else if (newValueCol) {
      next.valueCol = newValueCol;
    }
  } else {
    // metrics mode: each data column is an independent series that can be dropped.
    const newDataCols: string[] = [];
    for (const dataCol of config.dataCols ?? []) {
      const resolved = rebind.resolve(dataCol);
      if (resolved === null) {
        warnings.push(`Dropped sparkline metric (source column ${dataCol}) — it was removed or renamed.`);
        continue;
      }
      newDataCols.push(resolved);
    }
    next.dataCols = newDataCols;
    if (newDataCols.length === 0 && !structuralBroken) {
      structuralBroken = true;
      warnings.push('All sparkline metrics were removed from the source; the table needs reconfiguration.');
    }
  }

  return { config: next, warnings, structuralBroken };
};

// Rewrite a per-column-keyed record (seriesTypes / seriesDisplayNames), keeping
// only entries whose key still resolves and remapping the key to its new letter.
const rebindColumnKeyedRecord = <T>(
  record: Record<string, T> | undefined,
  rebind: ColumnRebind,
): Record<string, T> | undefined => {
  if (!record) return record;
  const next: Record<string, T> = {};
  for (const [key, entry] of Object.entries(record)) {
    const resolved = rebind.resolve(key);
    // Group-series keys (from group mode) are not source-column letters and will
    // not resolve; preserve them untouched so display names survive.
    next[resolved ?? key] = entry;
  }
  return next;
};

export const rebindChartConfig = (config: ChartConfig, rebind: ColumnRebind): ConfigRebindResult<ChartConfig> => {
  const warnings: string[] = [];
  let structuralBroken = false;
  const next: ChartConfig = { ...config };

  if (config.mode === 'group') {
    const newGroupCol = config.groupCol ? rebind.resolve(config.groupCol) : null;
    if (config.groupCol && newGroupCol === null) {
      structuralBroken = true;
      warnings.push(`Chart X-axis (source column ${config.groupCol}) was removed or renamed; the chart needs reconfiguration.`);
    } else if (newGroupCol) {
      next.groupCol = newGroupCol;
    }

    const newValueCol = config.valueCol ? rebind.resolve(config.valueCol) : null;
    if (config.valueCol && newValueCol === null) {
      structuralBroken = true;
      warnings.push(`Chart value column (source column ${config.valueCol}) was removed or renamed; the chart needs reconfiguration.`);
    } else if (newValueCol) {
      next.valueCol = newValueCol;
    }

    const newSeriesCol = config.seriesGroupCol ? rebind.resolve(config.seriesGroupCol) : null;
    if (config.seriesGroupCol && newSeriesCol === null) {
      warnings.push(`Chart series split (source column ${config.seriesGroupCol}) was removed; showing the chart without the split.`);
      next.seriesGroupCol = undefined;
    } else if (newSeriesCol) {
      next.seriesGroupCol = newSeriesCol;
    }
  } else {
    const newLabelColumn = rebind.resolve(config.labelColumn);
    if (newLabelColumn === null) {
      structuralBroken = true;
      warnings.push(`Chart label column (source column ${config.labelColumn}) was removed or renamed; the chart needs reconfiguration.`);
    } else {
      next.labelColumn = newLabelColumn;
    }

    const newDataColumns: string[] = [];
    for (const dataColumn of config.dataColumns) {
      const resolved = rebind.resolve(dataColumn);
      if (resolved === null) {
        warnings.push(`Dropped chart series (source column ${dataColumn}) — it was removed or renamed.`);
        continue;
      }
      newDataColumns.push(resolved);
    }
    next.dataColumns = newDataColumns;
    if (newDataColumns.length === 0 && !structuralBroken) {
      structuralBroken = true;
      warnings.push('All chart series were removed from the source; the chart needs reconfiguration.');
    }
  }

  if (config.rightAxisColumns) {
    next.rightAxisColumns = config.rightAxisColumns
      .map(col => rebind.resolve(col))
      .filter((col): col is string => col !== null);
  }

  next.seriesTypes = rebindColumnKeyedRecord(config.seriesTypes, rebind);
  next.seriesDisplayNames = rebindColumnKeyedRecord(config.seriesDisplayNames, rebind);

  return { config: next, warnings, structuralBroken };
};
