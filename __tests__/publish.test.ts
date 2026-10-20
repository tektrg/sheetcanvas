import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartData, NoteData, SheetData } from '../types';
import { buildPublishSnapshot, createDebouncedRunner, hashSnapshot } from '../utils/publish';
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
