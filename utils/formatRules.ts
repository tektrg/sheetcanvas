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
