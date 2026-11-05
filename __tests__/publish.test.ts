import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CellFormat, ChartData, NoteData, SheetData } from '../types';
import { buildPublishSnapshot, createDebouncedRunner, hashSnapshot, toPublishedFormat } from '../utils/publish';
import { DEFAULT_CHART_COLOR_SETTINGS } from '../utils/chartColorSchemes';
import { publishSnapshotSchema } from '../shared/publishSnapshot';

const sheet: SheetData = {
  id: 's1', title: 'Sales', position: { x: 0, y: 0 }, size: { width: 2, height: 3 },
  cells: {
    A1: { raw: 'Month', value: 'Month' }, B1: { raw: 'Revenue', value: 'Revenue' },
    A2: { raw: 'Jan', value: 'Jan' }, B2: { raw: '10', value: 10 },
    A3: { raw: 'Feb', value: 'Feb' }, B3: { raw: '25', value: 25 },
  },
};

const chart: ChartData = {
  id: 'c1', sourceSheetId: 's1', position: { x: 0, y: 0 }, size: { width: 300, height: 200 }, title: 'Revenue by month',
  config: { labelColumn: 'A', dataColumns: ['B'], color: '#4f46e5', highlightIndex: -1, animation: false, type: 'bar' },
};

const note = (overrides: Partial<NoteData> = {}): NoteData => ({
  id: 'n1', position: { x: 0, y: 0 }, size: { width: 300, height: 200 }, color: 'yellow', format: 'markdown',
  title: 'Q1 report', tags: ['finance'], createdAt: 1, updatedAt: 1,
  content: 'Revenue hit <CellValue sheet="s1" cell="B3" /> in Feb.\n\n<CanvasChart id="c1" />',
  ...overrides,
});

const source = { charts: { c1: chart }, sheets: { s1: sheet } };

describe('buildPublishSnapshot', () => {
  it('freezes the note with resolved chart rows and inlined cell values', () => {
    const snapshot = buildPublishSnapshot(note(), source, DEFAULT_CHART_COLOR_SETTINGS);
    expect(publishSnapshotSchema.parse(snapshot)).toBeTruthy();
    expect(snapshot.title).toBe('Q1 report');
    expect(snapshot.content).toContain('Revenue hit 25 in Feb.');
    expect(snapshot.content).toContain('<CanvasChart id="c1" />');
    expect(snapshot.charts).toHaveLength(1);
    expect(snapshot.charts[0].series[0].label).toBe('Revenue');
    expect(snapshot.charts[0].rows).toEqual([{ label: 'Jan', values: [10] }, { label: 'Feb', values: [25] }]);
  });

  it('applies per-chart hideData and skips charts that no longer exist', () => {
    const snapshot = buildPublishSnapshot(
      note({ content: '<CanvasChart id="c1"/> <CanvasChart id="gone"/>', publish: { hideData: { c1: true } } }),
      source,
      DEFAULT_CHART_COLOR_SETTINGS,
    );
    expect(snapshot.charts.map(c => c.id)).toEqual(['c1']);
    expect(snapshot.charts[0].hideData).toBe(true);
  });
});

describe('hashSnapshot', () => {
  it('is stable for identical content and changes when data changes', async () => {
    const a = await hashSnapshot(buildPublishSnapshot(note(), source, DEFAULT_CHART_COLOR_SETTINGS));
    const b = await hashSnapshot(buildPublishSnapshot(note(), source, DEFAULT_CHART_COLOR_SETTINGS));
    expect(a).toBe(b);
    const editedSheet = { ...sheet, cells: { ...sheet.cells, B3: { raw: '99', value: 99 } } };
    const c = await hashSnapshot(buildPublishSnapshot(note(), { ...source, sheets: { s1: editedSheet } }, DEFAULT_CHART_COLOR_SETTINGS));
    expect(c).not.toBe(a);
    // Publish metadata (e.g. pause) does not change the snapshot.
    const d = await hashSnapshot(buildPublishSnapshot(note({ publish: { paused: true } }), source, DEFAULT_CHART_COLOR_SETTINGS));
    expect(d).toBe(a);
  });
});

describe('createDebouncedRunner', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs once after the quiet period, restarting on each schedule', async () => {
    const run = vi.fn(async () => {});
    const runner = createDebouncedRunner(30_000, run);
    runner.schedule('n1');
    await vi.advanceTimersByTimeAsync(20_000);
    runner.schedule('n1');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('n1');
  });

  it('keeps keys independent and cancel drops a pending run', async () => {
    const run = vi.fn(async () => {});
    const runner = createDebouncedRunner(1000, run);
    runner.schedule('a');
    runner.schedule('b');
    runner.cancel('b');
    await vi.advanceTimersByTimeAsync(1000);
    expect(run.mock.calls).toEqual([['a']]);
  });

  it('queues one follow-up when scheduled during a run', async () => {
    let release!: () => void;
    const run = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const runner = createDebouncedRunner(100, run);
    runner.schedule('a');
    await vi.advanceTimersByTimeAsync(100);
    runner.schedule('a');
    await vi.advanceTimersByTimeAsync(100); // fires while first run in flight → deferred
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('buildPublishSnapshot — AEO fields', () => {
  it('includes the reviewed answer box, dropping blanks', () => {
    const snapshot = buildPublishSnapshot(note({ publish: { answerBox: {
      summary: '  Feb doubled Jan.  ',
      faq: [{ q: 'How much in Feb?', a: '25.' }, { q: ' ', a: 'orphan answer' }],
    } } }), source, DEFAULT_CHART_COLOR_SETTINGS);
    expect(snapshot.summary).toBe('Feb doubled Jan.');
    expect(snapshot.faq).toEqual([{ q: 'How much in Feb?', a: '25.' }]);
    expect(publishSnapshotSchema.parse(snapshot)).toBeTruthy();
    const plain = buildPublishSnapshot(note(), source, DEFAULT_CHART_COLOR_SETTINGS);
    expect('summary' in plain || 'faq' in plain).toBe(false);
  });

  it('stamps connector charts with their last refresh time only', () => {
    const plain = buildPublishSnapshot(note(), source, DEFAULT_CHART_COLOR_SETTINGS);
    expect(plain.charts[0].dataAsOf).toBeUndefined();
    const connected = { ...sheet, connectorConfig: { lastRefreshedAt: 1_760_000_000_000 } } as unknown as SheetData;
    const live = buildPublishSnapshot(note(), { ...source, sheets: { s1: connected } }, DEFAULT_CHART_COLOR_SETTINGS);
    expect(live.charts[0].dataAsOf).toBe(1_760_000_000_000);
  });
});

describe('buildPublishSnapshot — chart parity fields', () => {
  const wide: SheetData = {
    ...sheet,
    size: { width: 3, height: 3 },
    cells: {
      A1: { raw: 'Month', value: 'Month' }, B1: { raw: 'Revenue', value: 'Revenue' }, C1: { raw: 'Rate', value: 'Rate' },
      A2: { raw: 'Jan', value: 'Jan' }, B2: { raw: '48000', value: 48000, format: { type: 'currency', decimals: 0 } }, C2: { raw: '0.02', value: 0.02, format: { type: 'percent', decimals: 1 } },
      A3: { raw: 'Feb', value: 'Feb' }, B3: { raw: '61000', value: 61000 }, C3: { raw: '0.03', value: 0.03 },
    },
  };
  const build = (config: Partial<ChartData['config']>, sheets: Record<string, SheetData> = { s1: wide }) => {
    const c: ChartData = { ...chart, config: { ...chart.config, dataColumns: ['B', 'C'], ...config } };
    const snapshot = buildPublishSnapshot(note(), { charts: { c1: c }, sheets }, DEFAULT_CHART_COLOR_SETTINGS);
    expect(publishSnapshotSchema.parse(snapshot)).toBeTruthy();
    return snapshot.charts[0];
  };

  it('a chart that uses none of the new features keeps its exact old shape (hash unchanged)', () => {
    const published = buildPublishSnapshot(note(), source, DEFAULT_CHART_COLOR_SETTINGS).charts[0];
    expect(Object.keys(published).sort()).toEqual(['id', 'rows', 'series', 'title', 'type']);
    expect(Object.keys(published.series[0]).sort()).toEqual(['color', 'key', 'label']);
  });

  it('carries right-axis series and per-axis number formats', () => {
    const published = build({ rightAxisColumns: ['C'], seriesTypes: { C: 'line' } });
    expect(published.series.map(s => s.axis)).toEqual([undefined, 'right']);
    expect(published.axisFormats).toEqual({ left: { type: 'currency', decimals: 0 }, right: { type: 'percent', decimals: 1 } });
  });

  it('ignores right-axis columns in group mode and on pie/treemap (the renderer draws one scale there)', () => {
    expect(build({ type: 'pie', rightAxisColumns: ['C'] }).series.every(s => s.axis === undefined)).toBe(true);
  });

  it('emits showLabels / highlightIndex only when they apply', () => {
    const plain = build({});
    expect(plain).not.toHaveProperty('showLabels');
    expect(plain).not.toHaveProperty('highlightIndex');
    expect(build({ highlightIndex: 5 })).not.toHaveProperty('highlightIndex'); // beyond the last row
    const on = build({ showLabels: true, highlightIndex: 1 });
    expect(on.showLabels).toBe(true);
    expect(on.highlightIndex).toBe(1);
  });

  it('pie and treemap carry the canvas palette; mono bars use the ramp', () => {
    const pie = build({ type: 'pie', dataColumns: ['B'] });
    expect(pie.categoryColors?.length).toBeGreaterThan(1);
    expect(pie.categoryColors?.[0]).toBe(pie.series[0].color);
    expect(build({ type: 'treemap', dataColumns: ['B'] }).categoryColors).toBeTruthy();
    const c: ChartData = { ...chart, config: { ...chart.config, dataColumns: ['B', 'C'], colorScheme: 'mono' } };
    const [first, second] = buildPublishSnapshot(note(), { charts: { c1: c }, sheets: { s1: wide } }, DEFAULT_CHART_COLOR_SETTINGS).charts[0].series.map(s => s.color);
    expect(first).toBe('#000000'); // ramp: base colour first, then lightening
    expect(second).toBe('#d9d9d9');
  });

  it('maps cell formats to the small wire format (numeric only, bounded)', () => {
    expect(toPublishedFormat({ type: 'currency', decimals: 0 })).toEqual({ type: 'currency', decimals: 0 });
    expect(toPublishedFormat({ type: 'percent', decimals: 99 })).toEqual({ type: 'percent', decimals: 10 });
    expect(toPublishedFormat({ type: 'number', d3Format: ',.1f' } as CellFormat)).toEqual({ type: 'number', d3Format: ',.1f' });
    expect(toPublishedFormat({ type: 'text', d3Format: '.2s' } as CellFormat)).toEqual({ type: 'number', d3Format: '.2s' });
    // generic / non-numeric / invalid => no descriptor (compact numbers), so snapshots stay small and stable
    expect(toPublishedFormat(undefined)).toBeUndefined();
    expect(toPublishedFormat({ type: 'number' })).toBeUndefined();
    expect(toPublishedFormat({ type: 'date' })).toBeUndefined();
    expect(toPublishedFormat({ type: 'number', d3Format: 'zzz' } as CellFormat)).toBeUndefined();
  });
});
