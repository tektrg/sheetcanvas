import { describe, expect, it } from 'vitest';
import { SheetData } from '../../types';
import { refreshPivotTable } from '../pivotHelpers';

const sourceSheet = (): SheetData => ({
  id: 'source',
  title: 'Deals',
  position: { x: 0, y: 0 },
  size: { width: 4, height: 6 },
  cells: {
    A1: { raw: 'Region', value: 'Region' },
    B1: { raw: 'Status', value: 'Status' },
    C1: { raw: 'Revenue', value: 'Revenue' },
    D1: { raw: 'Channel', value: 'Channel' },
    A2: { raw: 'NA', value: 'NA' },
    B2: { raw: 'paid', value: 'paid' },
    C2: { raw: '100', value: 100 },
    D2: { raw: 'ads', value: 'ads' },
    A3: { raw: 'NA', value: 'NA' },
    B3: { raw: 'lost', value: 'lost' },
    C3: { raw: '50', value: 50 },
    D3: { raw: 'organic', value: 'organic' },
    A4: { raw: 'EU', value: 'EU' },
    B4: { raw: 'paid', value: 'paid' },
    C4: { raw: 'bad', value: 'bad' },
    D4: { raw: 'ads', value: 'ads' },
    A5: { raw: 'EU', value: 'EU' },
    B5: { raw: 'paid', value: 'paid' },
    C5: { raw: '200', value: 200 },
    D5: { raw: 'organic', value: 'organic' },
    A6: { raw: 'APAC', value: 'APAC' },
    B6: { raw: '', value: '' },
    C6: { raw: '300', value: 300 },
    D6: { raw: 'ads', value: 'ads' },
  },
});

const pivotShell = (source: SheetData, overrides: Partial<SheetData['pivotConfig']>): SheetData => ({
  id: 'pivot',
  title: 'Pivot: Deals',
  position: { x: 0, y: 0 },
  size: { width: 4, height: 12 },
  cells: {},
  pivotConfig: {
    sourceSheetId: source.id,
    rowLabelCol: 'A',
    values: [],
    ...overrides,
  },
});

describe('refreshPivotTable conditional metrics', () => {
  it('preserves legacy unconditioned SUM behavior', () => {
    const source = sourceSheet();
    const pivot = refreshPivotTable(pivotShell(source, {
      values: [{ column: 'C', operation: 'SUM' }],
    }), source);

    expect(pivot.cells.B1.value).toBe('Sum of Revenue');
    expect(pivot.cells.A2.value).toBe('APAC');
    expect(pivot.cells.B2.value).toBe(300);
    expect(pivot.cells.A3.value).toBe('EU');
    expect(pivot.cells.B3.value).toBe(200);
    expect(pivot.cells.A4.value).toBe('NA');
    expect(pivot.cells.B4.value).toBe(150);
    expect(pivot.cells.B5.value).toBe(650);
    expect(pivot.pivotWarnings).toEqual([]);
  });

  it('preserves legacy unconditioned matrix headers for multiple metrics', () => {
    const source = sourceSheet();
    const pivot = refreshPivotTable(pivotShell(source, {
      colLabelCol: 'D',
      values: [
        { column: 'C', operation: 'SUM' },
        { column: 'C', operation: 'COUNT' },
      ],
    }), source);

    expect(pivot.cells.B1.value).toBe('ads (Sum Revenue)');
    expect(pivot.cells.C1.value).toBe('ads (Count Revenue)');
    expect(pivot.cells.F1.value).toBe('Total Sum Revenue');
    expect(pivot.cells.G1.value).toBe('Total Count Revenue');
  });

  it('sums only rows matching a metric condition and warns about ignored non-numeric values', () => {
    const source = sourceSheet();
    const pivot = refreshPivotTable(pivotShell(source, {
      values: [{
        column: 'C',
        operation: 'SUM',
        label: 'Paid revenue',
        conditions: [{ columnId: 'B', type: 'text', operator: 'equals', value: 'paid' }],
      }],
    }), source);

    expect(pivot.cells.B1.value).toBe('Paid revenue');
    expect(pivot.cells.B2.value).toBe(0);
    expect(pivot.cells.B3.value).toBe(200);
    expect(pivot.cells.B4.value).toBe(100);
    expect(pivot.cells.B5.value).toBe(300);
    expect(pivot.pivotWarnings).toEqual([
      '1 blank/non-numeric Revenue value ignored in Paid revenue.',
    ]);
  });

  it('uses readable fallback labels for conditional operators', () => {
    const source = sourceSheet();
    const pivot = refreshPivotTable(pivotShell(source, {
      values: [{
        column: 'C',
        operation: 'SUM',
        conditions: [{ columnId: 'C', type: 'number', operator: 'gt', value: 100 }],
      }],
    }), source);

    expect(pivot.cells.B1.value).toBe('SUMIF of Revenue where Revenue greater than 100');
  });

  it('counts source rows matching multiple AND conditions', () => {
    const source = sourceSheet();
    const pivot = refreshPivotTable(pivotShell(source, {
      values: [{
        operation: 'COUNT',
        countRows: true,
        label: 'Paid ads',
        conditions: [
          { columnId: 'B', type: 'text', operator: 'equals', value: 'paid' },
          { columnId: 'D', type: 'text', operator: 'equals', value: 'ads' },
        ],
      }],
    }), source);

    expect(pivot.cells.B1.value).toBe('Paid ads');
    expect(pivot.cells.B2.value).toBe(0);
    expect(pivot.cells.B3.value).toBe(1);
    expect(pivot.cells.B4.value).toBe(1);
    expect(pivot.cells.B5.value).toBe(2);
  });

  it('applies source sheet filters before metric conditions', () => {
    const source: SheetData = {
      ...sourceSheet(),
      filters: [{
        id: 'ads-only',
        columnId: 'D',
        type: 'text',
        operator: 'equals',
        value: 'ads',
      }],
    };
    const pivot = refreshPivotTable(pivotShell(source, {
      values: [{
        column: 'C',
        operation: 'SUM',
        label: 'Paid revenue',
        conditions: [{ columnId: 'B', type: 'text', operator: 'equals', value: 'paid' }],
      }],
    }), source);

    expect(pivot.cells.B2.value).toBe(0);
    expect(pivot.cells.B3.value).toBe(0);
    expect(pivot.cells.B4.value).toBe(100);
    expect(pivot.cells.B5.value).toBe(100);
  });

  it('recomputes row totals, column totals, and grand totals for conditional matrix pivots', () => {
    const source = sourceSheet();
    const pivot = refreshPivotTable(pivotShell(source, {
      colLabelCol: 'D',
      values: [{
        column: 'C',
        operation: 'SUM',
        label: 'Paid revenue',
        conditions: [{ columnId: 'B', type: 'text', operator: 'equals', value: 'paid' }],
      }],
    }), source);

    expect(pivot.cells.B1.value).toBe('ads (Paid revenue)');
    expect(pivot.cells.C1.value).toBe('organic (Paid revenue)');
    expect(pivot.cells.D1.value).toBe('Total Paid revenue');
    expect(pivot.cells.B2.value).toBe(0);
    expect(pivot.cells.C2).toBeUndefined();
    expect(pivot.cells.D2.value).toBe(0);
    expect(pivot.cells.B3.value).toBe(0);
    expect(pivot.cells.C3.value).toBe(200);
    expect(pivot.cells.D3.value).toBe(200);
    expect(pivot.cells.B4.value).toBe(100);
    expect(pivot.cells.D4.value).toBe(100);
    expect(pivot.cells.B5.value).toBe(100);
    expect(pivot.cells.C5.value).toBe(200);
    expect(pivot.cells.D5.value).toBe(300);
  });
});
