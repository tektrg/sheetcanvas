import { describe, expect, it } from 'vitest';
import { extractChartData } from '../utils/chartHelpers';
import type { SheetData, ChartConfig } from '../types';

// Build a sheet from a header row + data rows (array of arrays).
function sheetFrom(rows: (string | number)[][]): SheetData {
  const cells: SheetData['cells'] = {};
  const colLetter = (i: number) => String.fromCharCode(65 + i);
  rows.forEach((row, r) => {
    row.forEach((val, c) => {
      cells[`${colLetter(c)}${r + 1}`] = { raw: String(val), value: val };
    });
  });
  return {
    id: 's', title: 'S', position: { x: 0, y: 0 },
    size: { width: rows[0].length, height: rows.length }, cells,
  };
}

const groupConfig = (over: Partial<ChartConfig> = {}): ChartConfig => ({
  mode: 'group', labelColumn: 'A', dataColumns: ['B'], groupCol: 'A', valueCol: 'B',
  operation: 'SUM', color: '#000', highlightIndex: -1, animation: false, type: 'bar', ...over,
});

describe('extractChartData — F7 categorical value sort', () => {
  it('categorical groups are sorted by value descending', () => {
    const sheet = sheetFrom([
      ['Browser', 'Sessions'],
      ['Chrome', 30],
      ['Safari', 90],
      ['Firefox', 60],
    ]);
    const data = extractChartData(sheet, groupConfig());
    expect(data.map(d => d.name)).toEqual(['Safari', 'Firefox', 'Chrome']);
  });

  it('TRAP: ordinal (month) groups keep source order, not value/alpha sort', () => {
    const sheet = sheetFrom([
      ['Month', 'Sales'],
      ['Jan', 10],
      ['Feb', 90],
      ['Mar', 50],
    ]);
    const data = extractChartData(sheet, groupConfig());
    expect(data.map(d => d.name)).toEqual(['Jan', 'Feb', 'Mar']);
  });
});

describe('extractChartData — F5 top-N + Other consolidation', () => {
  it('folds low-share series into a single Other series', () => {
    // 8 series across 2 periods; A-dominant, tail is tiny.
    const header = ['Period', 'Value', 'Series'];
    const rows: (string | number)[][] = [header];
    const bigSeries = ['s1', 's2', 's3', 's4', 's5'];
    const tailSeries = ['s6', 's7', 's8'];
    // Big series carry most of the weight.
    bigSeries.forEach((s, i) => {
      rows.push(['P1', 1000 - i * 10, s]);
      rows.push(['P2', 1000 - i * 10, s]);
    });
    tailSeries.forEach((s) => {
      rows.push(['P1', 2, s]);
      rows.push(['P2', 2, s]);
    });
    const sheet = sheetFrom(rows);
    const config = groupConfig({ seriesGroupCol: 'C', groupCol: 'A', valueCol: 'B', labelColumn: 'A' });
    const data = extractChartData(sheet, config);
    const seriesKeys = new Set<string>();
    data.forEach(row => Object.keys(row).forEach(k => { if (k !== 'name' && k !== 'x_raw') seriesKeys.add(k); }));
    expect(seriesKeys.has('Other')).toBe(true);
    // Kept series + Other should be far fewer than the original 8.
    expect(seriesKeys.size).toBeLessThan(8);
    expect(seriesKeys.has('s8')).toBe(false); // tail folded away
  });

  it('does not consolidate when series count is under the threshold', () => {
    const rows: (string | number)[][] = [['Period', 'Value', 'Series']];
    ['s1', 's2', 's3'].forEach(s => { rows.push(['P1', 10, s]); });
    const sheet = sheetFrom(rows);
    const data = extractChartData(sheet, groupConfig({ seriesGroupCol: 'C' }));
    const seriesKeys = new Set<string>();
    data.forEach(row => Object.keys(row).forEach(k => { if (k !== 'name' && k !== 'x_raw') seriesKeys.add(k); }));
    expect(seriesKeys.has('Other')).toBe(false);
    expect(seriesKeys.size).toBe(3);
  });
});
