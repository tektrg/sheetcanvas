import type { CellData, CellFormat, SheetFormatRule } from '../types';
import { getCellId, parseCellId } from './formulas';

export interface ParsedA1Range {
  startCol: number;
  startRow: number;
  endCol: number;
  endRow: number;
}

export const parseA1Range = (range: string): ParsedA1Range | null => {
  const [a, b] = range.split(':');
  const start = parseCellId(a);
  const end = parseCellId(b ?? a);
  if (!start || !end) return null;

  return {
    startCol: Math.min(start.col, end.col),
    endCol: Math.max(start.col, end.col),
    startRow: Math.min(start.row, end.row),
    endRow: Math.max(start.row, end.row),
  };
};

export const formatCellsInRange = (
  cells: Record<string, CellData>,
  range: ParsedA1Range,
  format: CellFormat,
  options: { includeMissingCells: boolean },
) => {
  const updates: Record<string, CellData> = {};

  for (let row = range.startRow; row <= range.endRow; row++) {
    for (let col = range.startCol; col <= range.endCol; col++) {
      const cellId = getCellId(col, row);
      const existing = cells[cellId];
      if (!existing && !options.includeMissingCells) continue;
      updates[cellId] = { ...(existing ?? { raw: '', value: null }), format };
    }
  }

  return {
    cells: { ...cells, ...updates },
    formattedCellIds: Object.keys(updates),
  };
};

export const upsertFormatRule = (
  rules: SheetFormatRule[] | undefined,
  nextRule: SheetFormatRule,
): SheetFormatRule[] => {
  const retainedRules = (rules ?? []).filter(rule => rule.range !== nextRule.range);
  return [...retainedRules, nextRule];
};

// A rule applied to the pivot's full data column previously reached down to the
// last data row (excluding a trailing grand-total row, which bar/heatmap formats
// commonly skip). On refresh the pivot may have grown; stretch that rule's endRow
// to match so new rows keep the same formatting instead of being skipped.
export const extendFormatRulesToNewHeight = (
  rules: SheetFormatRule[] | undefined,
  oldHeight: number,
  newHeight: number,
  hasTrailingTotalRow: boolean,
): SheetFormatRule[] | undefined => {
  if (!rules?.length || newHeight <= oldHeight) return rules;

  // Pivot sizing reserves one trailing blank row beyond the last used row
  // (see desiredHeight = maxRowIndex + 2 in computePivotCells), so the last
  // used row index is height - 2, not height - 1.
  const totalRowOffset = hasTrailingTotalRow ? 1 : 0;
  const oldLastDataRow = oldHeight - 2 - totalRowOffset;

  return rules.map(rule => {
    const range = parseA1Range(rule.range);
    if (!range || range.endRow < oldLastDataRow) return rule;

    const newLastDataRow = newHeight - 2 - totalRowOffset;
    const grownRange = getCellId(range.startCol, range.startRow) + ':' + getCellId(range.endCol, newLastDataRow);
    return { ...rule, range: grownRange };
  });
};

export const applyFormatRulesToCells = (
  cells: Record<string, CellData>,
  rules: SheetFormatRule[] | undefined,
): Record<string, CellData> => {
  if (!rules?.length) return cells;

  return rules.reduce((currentCells, rule) => {
    const range = parseA1Range(rule.range);
    if (!range) return currentCells;
    return formatCellsInRange(currentCells, range, rule.format, { includeMissingCells: false }).cells;
  }, cells);
};
