import { describe, expect, it } from 'vitest';
import { SheetData, PivotConfig, SparklineConfig, ChartConfig } from '../../types';
import {
  buildColumnRebind,
  rebindPivotConfig,
  rebindSparklineConfig,
  rebindChartConfig,
} from '../columnRebind';

// Build a one-header-row sheet from an ordered list of header labels. An empty
// string means a blank header cell (no value).
const sheetWithHeaders = (labels: string[]): SheetData => {
  const cells: SheetData['cells'] = {};
  labels.forEach((label, index) => {
    const colLetter = String.fromCharCode(65 + index);
    if (label !== '') cells[`${colLetter}1`] = { raw: label, value: label };
  });
  return {
    id: 'src',
    title: 'Source',
    position: { x: 0, y: 0 },
    size: { width: labels.length, height: 1 },
    cells,
  };
};

describe('buildColumnRebind — shape change detection', () => {
  it('reports no change when headers are identical', () => {
    const rebind = buildColumnRebind(
      sheetWithHeaders(['Region', 'Revenue']),
      sheetWithHeaders(['Region', 'Revenue']),
    );
    expect(rebind.shapeChanged).toBe(false);
  });

  it('detects reorder as a shape change and remaps by header name', () => {
    const rebind = buildColumnRebind(
      sheetWithHeaders(['Region', 'Revenue', 'Cost']),
      sheetWithHeaders(['Region', 'Cost', 'Revenue']),
    );
    expect(rebind.shapeChanged).toBe(true);
    expect(rebind.resolve('B')).toBe('C'); // Revenue moved B → C
    expect(rebind.resolve('C')).toBe('B'); // Cost moved C → B
    expect(rebind.resolve('A')).toBe('A');
  });

  it('follows a named column when a new column is inserted before it', () => {
    const rebind = buildColumnRebind(
      sheetWithHeaders(['Region', 'Revenue']),
      sheetWithHeaders(['Region', 'Segment', 'Revenue']),
    );
    expect(rebind.resolve('B')).toBe('C');
  });
});

describe('buildColumnRebind — drop vs position fallback', () => {
  it('drops a named column that was removed rather than repointing by position', () => {
    // Revenue (B) removed; Cost shifts into position B. Resolving Revenue must NOT
    // return B (which is now Cost) — it must drop.
    const rebind = buildColumnRebind(
      sheetWithHeaders(['Region', 'Revenue', 'Cost']),
      sheetWithHeaders(['Region', 'Cost']),
    );
    expect(rebind.resolve('B')).toBeNull();
    expect(rebind.resolve('C')).toBe('B'); // Cost still resolvable by name
  });

  it('treats an in-place rename as a drop (never a silent repoint)', () => {
    const rebind = buildColumnRebind(
      sheetWithHeaders(['Region', 'Revenue']),
      sheetWithHeaders(['Region', 'Net Revenue']),
    );
    expect(rebind.resolve('B')).toBeNull();
  });

  it('drops on ambiguous (duplicate) header names', () => {
    const rebind = buildColumnRebind(
      sheetWithHeaders(['Region', 'Revenue']),
      sheetWithHeaders(['Region', 'Revenue', 'Revenue']),
    );
    expect(rebind.resolve('B')).toBeNull();
  });

  it('falls back to position for empty-header columns', () => {
    const rebind = buildColumnRebind(
      sheetWithHeaders(['Region', '']),
      sheetWithHeaders(['Region', '']),
    );
    expect(rebind.resolve('B')).toBe('B');
  });
});

describe('rebindPivotConfig', () => {
  const base: PivotConfig = {
    sourceSheetId: 'src',
    rowLabelCol: 'A',
    values: [{ column: 'B', operation: 'SUM', label: 'Sum of Revenue' }],
  };

  it('remaps metric column on reorder', () => {
    const rebind = buildColumnRebind(
      sheetWithHeaders(['Region', 'Revenue']),
      sheetWithHeaders(['Region', 'X', 'Revenue']),
    );
    const result = rebindPivotConfig(base, rebind);
    expect(result.structuralBroken).toBe(false);
    expect(result.config.values[0].column).toBe('C');
    expect(result.warnings).toHaveLength(0);
  });

  it('drops a metric whose column was removed and warns', () => {
    const rebind = buildColumnRebind(
      sheetWithHeaders(['Region', 'Revenue']),
      sheetWithHeaders(['Region']),
    );
    const result = rebindPivotConfig(base, rebind);
    expect(result.config.values).toHaveLength(0);
    expect(result.structuralBroken).toBe(true); // no metrics left
    expect(result.warnings.join(' ')).toContain('Revenue');
  });

  it('marks structural break when the row dimension disappears', () => {
    const rebind = buildColumnRebind(
      sheetWithHeaders(['Region', 'Revenue']),
      sheetWithHeaders(['Segment', 'Revenue']),
    );
    const result = rebindPivotConfig(base, rebind);
    expect(result.structuralBroken).toBe(true);
  });
});

describe('rebindSparklineConfig', () => {
  it('drops a single metric but keeps the table when others remain', () => {
    const config: SparklineConfig = {
      sourceSheetId: 'src',
      dateCol: 'A',
      mode: 'metrics',
      dataCols: ['B', 'C'],
    };
    const rebind = buildColumnRebind(
      sheetWithHeaders(['Date', 'Clicks', 'Cost']),
      sheetWithHeaders(['Date', 'Clicks']),
    );
    const result = rebindSparklineConfig(config, rebind);
    expect(result.structuralBroken).toBe(false);
    expect(result.config.dataCols).toEqual(['B']);
    expect(result.warnings).toHaveLength(1);
  });
});

describe('rebindChartConfig', () => {
  const config: ChartConfig = {
    mode: 'metrics',
    labelColumn: 'A',
    dataColumns: ['B', 'C'],
    color: '#000',
    highlightIndex: -1,
    animation: true,
    type: 'bar',
  };

  it('remaps series on reorder', () => {
    const rebind = buildColumnRebind(
      sheetWithHeaders(['Month', 'Clicks', 'Cost']),
      sheetWithHeaders(['Month', 'Cost', 'Clicks']),
    );
    const result = rebindChartConfig(config, rebind);
    expect(result.config.dataColumns).toEqual(['C', 'B']); // Clicks B→C, Cost C→B
    expect(result.structuralBroken).toBe(false);
  });

  it('drops a removed series and keeps the rest', () => {
    const rebind = buildColumnRebind(
      sheetWithHeaders(['Month', 'Clicks', 'Cost']),
      sheetWithHeaders(['Month', 'Clicks']),
    );
    const result = rebindChartConfig(config, rebind);
    expect(result.config.dataColumns).toEqual(['B']);
    expect(result.warnings).toHaveLength(1);
  });
});
