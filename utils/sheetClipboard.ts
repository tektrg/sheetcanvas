import { CellCoordinate, CellData } from '../types';
import { getCellId } from './formulas';
import { formatValue } from './formatting';

export interface SheetSelectionRange {
  start: CellCoordinate;
  end: CellCoordinate;
}

const getSelectedRows = (
  range: SheetSelectionRange,
  visibleRowIndices?: number[] | null,
  displayRowByActualRow?: Map<number, number> | null
): number[] => {
  if (!visibleRowIndices || !displayRowByActualRow) {
    const minRow = Math.min(range.start.row, range.end.row);
    const maxRow = Math.max(range.start.row, range.end.row);
    return Array.from({ length: maxRow - minRow + 1 }, (_, index) => minRow + index);
  }

  const startDisplay = displayRowByActualRow.get(range.start.row);
  const endDisplay = displayRowByActualRow.get(range.end.row);
  const minDisplay = Math.min(startDisplay ?? 0, endDisplay ?? 0);
  const maxDisplay = Math.max(
    startDisplay ?? (visibleRowIndices.length - 1),
    endDisplay ?? (visibleRowIndices.length - 1)
  );

  return visibleRowIndices.slice(minDisplay, maxDisplay + 1);
};

export const serializeSheetSelection = (
  cells: Record<string, CellData>,
  range: SheetSelectionRange,
  visibleRowIndices?: number[] | null,
  displayRowByActualRow?: Map<number, number> | null
): string => {
  const minCol = Math.min(range.start.col, range.end.col);
  const maxCol = Math.max(range.start.col, range.end.col);
  const selectedRows = getSelectedRows(range, visibleRowIndices, displayRowByActualRow);

  return selectedRows
    .map((row) => {
      const values: string[] = [];
      for (let col = minCol; col <= maxCol; col++) {
        const cell = cells[getCellId(col, row)];
        values.push(formatValue(cell?.value, cell?.format));
      }
      return values.join('\t');
    })
    .join('\n');
};
