import type { SheetData } from '../../types';
import { getCellId, parseCellId } from '../../utils/formulas';

export interface SheetDataBounds {
  width: number;
  height: number;
}

export function getSheetDataBounds(sheet: SheetData): SheetDataBounds {
  let width = sheet.size.width;
  let height = sheet.size.height;

  for (const cellId of Object.keys(sheet.cells)) {
    const parsed = parseCellId(cellId);
    if (!parsed) continue;
    width = Math.max(width, parsed.col + 1);
    height = Math.max(height, parsed.row + 1);
  }

  return { width, height };
}

export function getColumnIdForIndex(colIndex: number): string {
  return getCellId(colIndex, 0).replace(/\d+$/, '');
}

export function getColumnIdSpan(columnCount: number): string | null {
  if (columnCount <= 0) return null;
  return `A:${getColumnIdForIndex(columnCount - 1)}`;
}
