import { describe, expect, it } from 'vitest';
import { serializeSheetSelection } from '../sheetClipboard';
import { CellData } from '../../types';

const cell = (value: string | number | null): CellData => ({
  raw: value === null ? '' : String(value),
  value,
});

describe('serializeSheetSelection', () => {
  it('serializes a regular selection as tab-separated rows', () => {
    const cells: Record<string, CellData> = {
      A1: cell('Name'),
      B1: cell('Revenue'),
      A2: cell('Ada'),
      B2: cell(42),
    };

    expect(
      serializeSheetSelection(cells, {
        start: { col: 0, row: 0 },
        end: { col: 1, row: 1 },
      })
    ).toBe('Name\tRevenue\nAda\t42');
  });

  it('keeps empty cells in the copied rectangle', () => {
    const cells: Record<string, CellData> = {
      A1: cell('Name'),
      C1: cell('Revenue'),
    };

    expect(
      serializeSheetSelection(cells, {
        start: { col: 0, row: 0 },
        end: { col: 2, row: 0 },
      })
    ).toBe('Name\t\tRevenue');
  });

  it('copies rows in visible order when the sheet is filtered or sorted', () => {
    const cells: Record<string, CellData> = {
      A1: cell('Name'),
      B1: cell('Revenue'),
      A2: cell('Ada'),
      B2: cell(42),
      A4: cell('Grace'),
      B4: cell(84),
    };
    const visibleRowIndices = [0, 3, 1];
    const displayRowByActualRow = new Map([
      [0, 0],
      [3, 1],
      [1, 2],
    ]);

    expect(
      serializeSheetSelection(
        cells,
        {
          start: { col: 0, row: 0 },
          end: { col: 1, row: 1 },
        },
        visibleRowIndices,
        displayRowByActualRow
      )
    ).toBe('Name\tRevenue\nGrace\t84\nAda\t42');
  });
});
