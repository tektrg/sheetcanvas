import { describe, expect, it } from 'vitest';
import { SheetData, ChartData } from '../../types';
import {
  collectDependentSheetIdsTopo,
  collectDependentChartIds,
  propagateDerivedRefresh,
  getSourceSheetId,
} from '../propagateRefresh';

const dateColSource = (id: string, clicks: number[], costs: number[]): SheetData => {
  const cells: SheetData['cells'] = {
    A1: { raw: 'Date', value: 'Date' },
    B1: { raw: 'Clicks', value: 'Clicks' },
    C1: { raw: 'Cost', value: 'Cost' },
  };
  clicks.forEach((clickValue, index) => {
    const row = index + 2;
    cells[`A${row}`] = { raw: `2026-01-0${index + 1}`, value: `2026-01-0${index + 1}` };
    cells[`B${row}`] = { raw: String(clickValue), value: clickValue };
    cells[`C${row}`] = { raw: String(costs[index]), value: costs[index] };
  });
  return {
    id,
    title: id,
    position: { x: 0, y: 0 },
    size: { width: 3, height: clicks.length + 1 },
    cells,
  };
};

const pivotSheet = (id: string, sourceId: string): SheetData => ({
  id,
  title: id,
  position: { x: 0, y: 0 },
  size: { width: 2, height: 2 },
  cells: {},
  pivotConfig: { sourceSheetId: sourceId, rowLabelCol: 'A', values: [{ column: 'B', operation: 'SUM' }] },
});

describe('dependency graph', () => {
  it('orders transitive dependents parent-before-child', () => {
    const sheets: Record<string, SheetData> = {
      origin: dateColSource('origin', [1], [1]),
      p1: pivotSheet('p1', 'origin'),
      p2: { ...pivotSheet('p2', 'p1') },
    };
    const order = collectDependentSheetIdsTopo('origin', sheets);
    expect(order).toEqual(['p1', 'p2']);
  });

  it('excludes setup-required sheets', () => {
    const sheets: Record<string, SheetData> = {
      origin: dateColSource('origin', [1], [1]),
      p1: { ...pivotSheet('p1', 'origin'), setupRequired: true },
    };
    expect(collectDependentSheetIdsTopo('origin', sheets)).toEqual([]);
  });

  it('does not loop forever on an accidental source cycle', () => {
    const sheets: Record<string, SheetData> = {
      a: pivotSheet('a', 'b'),
      b: pivotSheet('b', 'a'),
    };
    // Should terminate; a depends on b which depends on a — visited guard stops it.
    const order = collectDependentSheetIdsTopo('a', sheets);
    expect(order.length).toBeLessThanOrEqual(2);
  });

  it('finds charts whose source is in the affected set', () => {
    const charts: Record<string, ChartData> = {
      c1: {
        id: 'c1', sourceSheetId: 'origin', position: { x: 0, y: 0 }, size: { width: 1, height: 1 },
        title: 'c1', config: { labelColumn: 'A', dataColumns: ['B'], color: '#000', highlightIndex: -1, animation: true, type: 'bar' },
      },
      c2: {
        id: 'c2', sourceSheetId: 'other', position: { x: 0, y: 0 }, size: { width: 1, height: 1 },
        title: 'c2', config: { labelColumn: 'A', dataColumns: ['B'], color: '#000', highlightIndex: -1, animation: true, type: 'bar' },
      },
    };
    expect(collectDependentChartIds(new Set(['origin']), charts)).toEqual(['c1']);
  });

  it('getSourceSheetId reads pivot and sparkline sources', () => {
    expect(getSourceSheetId(pivotSheet('p', 'src'))).toBe('src');
    expect(getSourceSheetId(dateColSource('o', [1], [1]))).toBeUndefined();
  });
});

describe('propagateDerivedRefresh', () => {
  it('recomputes a pivot when the origin values change', () => {
    const before = dateColSource('origin', [10], [1]);
    const sheets = { origin: before, p1: pivotSheet('p1', 'origin') };
    // Materialize p1 once against the original values.
    const seeded = propagateDerivedRefresh({ sheets, charts: {}, rootId: 'origin', rootSheet: before });
    const p1Seeded = seeded.sheets.p1;

    const after = dateColSource('origin', [10, 25], [1, 2]); // added a row → new sum
    const result = propagateDerivedRefresh({
      sheets: { origin: before, p1: p1Seeded },
      charts: {},
      rootId: 'origin',
      rootSheet: after,
    });
    expect(result.changedSheetIds).toContain('p1');
    // Pivot SUM of Clicks should reflect the new data (10 + 25 = 35).
    const cellValues = Object.values(result.sheets.p1.cells).map(cell => cell.value);
    expect(cellValues).toContain(35);
  });

  it('propagates through a two-level chain (origin → p1 → p2)', () => {
    const before = dateColSource('origin', [10], [1]);
    const sheets: Record<string, SheetData> = {
      origin: before,
      p1: pivotSheet('p1', 'origin'),
      p2: pivotSheet('p2', 'p1'),
    };
    const result = propagateDerivedRefresh({
      sheets,
      charts: {},
      rootId: 'origin',
      rootSheet: dateColSource('origin', [10, 20], [1, 2]),
    });
    expect(result.changedSheetIds).toEqual(['p1', 'p2']);
  });

  it('rewrites a chart config when the origin reorders columns', () => {
    const before = dateColSource('origin', [10], [1]);
    const charts: Record<string, ChartData> = {
      c1: {
        id: 'c1', sourceSheetId: 'origin', position: { x: 0, y: 0 }, size: { width: 1, height: 1 },
        title: 'c1',
        config: { mode: 'metrics', labelColumn: 'A', dataColumns: ['B'], color: '#000', highlightIndex: -1, animation: true, type: 'bar' },
      },
    };
    // Reorder: swap Clicks (B) and Cost (C).
    const reordered: SheetData = {
      ...before,
      cells: {
        ...before.cells,
        B1: { raw: 'Cost', value: 'Cost' },
        C1: { raw: 'Clicks', value: 'Clicks' },
      },
    };
    const result = propagateDerivedRefresh({
      sheets: { origin: before }, charts, rootId: 'origin', rootSheet: reordered,
    });
    expect(result.changedChartIds).toContain('c1');
    // Clicks moved B → C, so the chart series must now point at C.
    expect(result.charts.c1.config.dataColumns).toEqual(['C']);
  });

  it('drops a chart series and warns when the origin removes its column', () => {
    const before = dateColSource('origin', [10], [1]);
    const charts: Record<string, ChartData> = {
      c1: {
        id: 'c1', sourceSheetId: 'origin', position: { x: 0, y: 0 }, size: { width: 1, height: 1 },
        title: 'c1',
        config: { mode: 'metrics', labelColumn: 'A', dataColumns: ['B', 'C'], color: '#000', highlightIndex: -1, animation: true, type: 'bar' },
      },
    };
    const withoutCost: SheetData = {
      ...before,
      size: { width: 2, height: 2 },
      cells: { A1: before.cells.A1, B1: before.cells.B1, A2: before.cells.A2, B2: before.cells.B2 },
    };
    const result = propagateDerivedRefresh({
      sheets: { origin: before }, charts, rootId: 'origin', rootSheet: withoutCost,
    });
    expect(result.charts.c1.config.dataColumns).toEqual(['B']);
    expect(result.charts.c1.refreshWarnings?.length).toBeGreaterThan(0);
  });

  it('blanks a chart (no wrong-number render) when its label axis is structurally broken', () => {
    const before = dateColSource('origin', [10], [1]);
    const charts: Record<string, ChartData> = {
      c1: {
        id: 'c1', sourceSheetId: 'origin', position: { x: 0, y: 0 }, size: { width: 1, height: 1 },
        title: 'c1',
        config: { mode: 'metrics', labelColumn: 'A', dataColumns: ['B'], color: '#000', highlightIndex: -1, animation: true, type: 'bar' },
      },
    };
    // Rename the label column (A "Date") so it can't be matched by name.
    const renamedLabel: SheetData = {
      ...before,
      cells: { ...before.cells, A1: { raw: 'Timestamp', value: 'Timestamp' } },
    };
    const result = propagateDerivedRefresh({
      sheets: { origin: before }, charts, rootId: 'origin', rootSheet: renamedLabel,
    });
    // Data-bearing fields cleared → chart renders empty rather than plotting a
    // stale/wrong column, and it is flagged.
    expect(result.charts.c1.config.dataColumns).toEqual([]);
    expect(result.charts.c1.refreshWarnings?.length).toBeGreaterThan(0);
  });
});
