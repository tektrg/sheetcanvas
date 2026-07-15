import { describe, expect, it } from 'vitest';
import { computeSparklineCells, inferGoodDirection } from '../utils/sparklineHelpers';
import type { SheetData, SparklineConfig } from '../types';

// Minimal sheet: A = date, B = Revenue, C = Bounce Rate.
function makeSheet(): SheetData {
  const cells: SheetData['cells'] = {
    A1: { raw: 'Date', value: 'Date' },
    B1: { raw: 'Revenue', value: 'Revenue' },
    C1: { raw: 'Bounce Rate', value: 'Bounce Rate' },
  };
  const dates = ['2026-01-01', '2026-01-02', '2026-01-03'];
  const rev = [100, 120, 150];
  const bounce = [0.5, 0.45, 0.4];
  dates.forEach((d, i) => {
    const r = i + 2;
    cells[`A${r}`] = { raw: d, value: d };
    cells[`B${r}`] = { raw: String(rev[i]), value: rev[i] };
    cells[`C${r}`] = { raw: String(bounce[i]), value: bounce[i] };
  });
  return {
    id: 's1', title: 'Src', position: { x: 0, y: 0 }, size: { width: 3, height: 4 }, cells,
  };
}

describe('inferGoodDirection (S2)', () => {
  it('cost/churn/bounce → down is good', () => {
    expect(inferGoodDirection('Total Cost')).toBe('down');
    expect(inferGoodDirection('Churn Rate')).toBe('down');
    expect(inferGoodDirection('Bounce Rate')).toBe('down');
  });
  it('revenue/signups → up is good', () => {
    expect(inferGoodDirection('Revenue')).toBe('up');
    expect(inferGoodDirection('New Signups')).toBe('up');
  });
  it('ambiguous → unknown', () => {
    expect(inferGoodDirection('Widget Index')).toBe('unknown');
  });
});

describe('computeSparklineCells — direction-of-good heatmap (S2)', () => {
  const config: SparklineConfig = {
    sourceSheetId: 's1', dateCol: 'A', mode: 'metrics', dataCols: ['B', 'C'], compareMode: 'vs_first',
  };
  const { cells } = computeSparklineCells(makeSheet(), config);

  it('Change column uses a heatmap visual', () => {
    // Row 1 = Revenue, row 2 = Bounce Rate; Change is column D (index 3).
    expect(cells['D2']?.format?.visual).toBe('heatmap');
    expect(cells['D3']?.format?.visual).toBe('heatmap');
  });
  it('up-is-good metric uses diverging without flip', () => {
    expect(cells['D2']?.format).toMatchObject({ heatmapColor: 'diverging', heatmapFlip: false });
  });
  it('down-is-good metric (bounce) flips the diverging polarity', () => {
    expect(cells['D3']?.format).toMatchObject({ heatmapColor: 'diverging', heatmapFlip: true });
  });
});

describe('computeSparklineCells — summary columns (S1)', () => {
  const config: SparklineConfig = {
    sourceSheetId: 's1', dateCol: 'A', mode: 'metrics', dataCols: ['B'],
    compareMode: 'vs_first', summaryColumns: ['avg', 'minmax', 'share'],
  };
  const { cells, width } = computeSparklineCells(makeSheet(), config);

  it('appends Avg, Min, Max, Share headers after Change', () => {
    expect(cells['E1']?.value).toBe('Avg');
    expect(cells['F1']?.value).toBe('Min');
    expect(cells['G1']?.value).toBe('Max');
    expect(cells['H1']?.value).toBe('Share');
    expect(width).toBe(8);
  });
  it('share column renders as an in-cell bar', () => {
    expect(cells['H2']?.format).toMatchObject({ type: 'percent', visual: 'bar' });
  });
  it('avg/min/max compute correctly', () => {
    expect(cells['E2']?.value).toBeCloseTo((100 + 120 + 150) / 3);
    expect(cells['F2']?.value).toBe(100);
    expect(cells['G2']?.value).toBe(150);
  });
});
