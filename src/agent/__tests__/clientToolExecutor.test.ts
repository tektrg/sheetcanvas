import { afterEach, describe, expect, it } from 'vitest';
import type { SheetData } from '../../../types';
import { getCellId } from '../../../utils/formulas';
import { useStore } from '../../../store';
import { centerCanvasOnSheet, executeClientTool, rewriteClickhouseSqlForDescribedTable } from '../clientToolExecutor';

function makeViewportConstrainedWideSheet(): SheetData {
  const cells: SheetData['cells'] = {};
  for (let col = 0; col < 54; col += 1) {
    const columnId = getCellId(col, 0).replace(/\d+$/, '');
    cells[`${columnId}1`] = { raw: `Header ${columnId}`, value: `Header ${columnId}` };
  }
  cells.AU1 = { raw: 'Interview Status', value: 'Interview Status' };
  cells.BB1 = { raw: 'Admission Status', value: 'Admission Status' };
  cells.AU2 = { raw: '[1] Đã hẹn phỏng vấn', value: '[1] Đã hẹn phỏng vấn' };
  cells.BB2 = { raw: '[1] Trúng tuyển', value: '[1] Trúng tuyển' };

  return {
    id: 'hr-base',
    title: 'HR base',
    position: { x: 0, y: 0 },
    size: { width: 8, height: 1 },
    cells,
  };
}

function makeDateSeriesSheet(dates: string[]): SheetData {
  const cells: SheetData['cells'] = {
    A1: { raw: 'Date', value: 'Date' },
    B1: { raw: 'Revenue', value: 'Revenue' },
  };

  dates.forEach((date, index) => {
    const rowNumber = index + 2;
    cells[`A${rowNumber}`] = { raw: date, value: date };
    cells[`B${rowNumber}`] = { raw: String((index + 1) * 100), value: (index + 1) * 100 };
  });

  return {
    id: 'date-series',
    title: 'Date series',
    position: { x: 0, y: 0 },
    size: { width: 2, height: dates.length + 1 },
    cells,
  };
}

const initialState = useStore.getState();

afterEach(() => {
  useStore.setState({
    sheets: initialState.sheets,
    sheetIds: initialState.sheetIds,
    charts: initialState.charts,
    chartIds: initialState.chartIds,
    selectedIds: initialState.selectedIds,
    transform: initialState.transform,
    history: initialState.history,
    future: initialState.future,
  });
});

describe('executeClientTool describeSheet', () => {
  it('rewrites the described ClickHouse table alias used by connector query sheets', () => {
    expect(
      rewriteClickhouseSqlForDescribedTable(
        'SELECT * FROM t LIMIT 3',
        'demo.monthly_report',
      ),
    ).toBe('SELECT * FROM demo.monthly_report LIMIT 3');

    expect(
      rewriteClickhouseSqlForDescribedTable(
        'SELECT a.id FROM t a JOIN t b ON a.id = b.id',
        'demo.monthly_report',
      ),
    ).toBe(
      'SELECT a.id FROM demo.monthly_report a JOIN demo.monthly_report b ON a.id = b.id',
    );
  });

  it('centers the canvas on newly created connector sheets', () => {
    const sheet: SheetData = {
      id: 'query-sheet',
      title: 'ClickHouse Query',
      position: { x: 1200, y: 800 },
      size: { width: 4, height: 6 },
      cells: {},
    };

    useStore.setState({
      transform: { scale: 1, offset: { x: 0, y: 0 } },
    });

    centerCanvasOnSheet(sheet, { innerWidth: 800, innerHeight: 600 });

    expect(useStore.getState().transform.offset.x).toBeLessThan(0);
    expect(useStore.getState().transform.offset.y).toBeLessThan(0);
  });

  it('returns occupied wide columns even when sheet size is viewport constrained', async () => {
    const sheet = makeViewportConstrainedWideSheet();
    useStore.setState({
      sheets: { [sheet.id]: sheet },
      sheetIds: [sheet.id],
    });

    const result = await executeClientTool(
      'describeSheet',
      { sheetId: sheet.id, columnIds: ['BB', 'AU'] },
      { getSelection: () => ({}) },
    );

    expect(result.ok).toBe(true);
    expect(result.columnCount).toBe(54);
    expect(result.columnIdSpan).toBe('A:BB');
    expect(result.requestedColumns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exists: true,
          columnId: 'AU',
          headerCell: 'AU1',
          samples: ['[1] Đã hẹn phỏng vấn'],
        }),
        expect.objectContaining({
          exists: true,
          columnId: 'BB',
          headerCell: 'BB1',
          samples: ['[1] Trúng tuyển'],
        }),
      ]),
    );
    expect(result.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          columnId: 'AU',
          headerCell: 'AU1',
          dataRange: 'AU2:AU2',
          header: 'Interview Status',
          samples: ['[1] Đã hẹn phỏng vấn'],
        }),
        expect.objectContaining({
          columnId: 'BB',
          headerCell: 'BB1',
          dataRange: 'BB2:BB2',
          header: 'Admission Status',
          samples: ['[1] Trúng tuyển'],
        }),
      ]),
    );
    expect(result.sampleRows).toEqual([
      expect.objectContaining({
        rowNumber: 2,
        AU: '[1] Đã hẹn phỏng vấn',
        BB: '[1] Trúng tuyển',
      }),
    ]);
  });

  it('reports requested wide column letters as outside the occupied span only when absent', async () => {
    const sheet = makeViewportConstrainedWideSheet();
    useStore.setState({
      sheets: { [sheet.id]: sheet },
      sheetIds: [sheet.id],
    });

    const result = await executeClientTool(
      'describeSheet',
      { sheetId: sheet.id, columnIds: ['BC'] },
      { getSelection: () => ({}) },
    );

    expect(result.ok).toBe(true);
    expect(result.requestedColumns).toEqual([
      expect.objectContaining({
        columnId: 'BC',
        exists: false,
        columnIdSpan: 'A:BB',
      }),
    ]);
  });

  it('creates charts from occupied wide columns beyond sheet size', async () => {
    const sheet = makeViewportConstrainedWideSheet();
    useStore.setState({
      sheets: { [sheet.id]: sheet },
      sheetIds: [sheet.id],
      charts: {},
      chartIds: [],
    });

    const result = await executeClientTool(
      'createChart',
      {
        sheetId: sheet.id,
        type: 'line',
        labelColumn: 'A',
        dataColumns: ['AU', 'BB'],
        title: 'Applicant status',
      },
      { getSelection: () => ({}) },
    );

    expect(result.ok).toBe(true);
    const chart = Object.values(useStore.getState().charts)[0];
    expect(chart.config.dataColumns).toEqual(['AU', 'BB']);
  });

  it('requires explicit time intent before creating a date-like line chart', async () => {
    const sheet = makeDateSeriesSheet(['2026-06-01', '2026-06-02']);
    useStore.setState({
      sheets: { [sheet.id]: sheet },
      sheetIds: [sheet.id],
      charts: {},
      chartIds: [],
    });

    const result = await executeClientTool(
      'createChart',
      {
        sheetId: sheet.id,
        type: 'line',
        labelColumn: 'A',
        dataColumns: ['B'],
        title: 'Revenue trend',
      },
      { getSelection: () => ({}) },
    );

    expect(result.ok).toBe(false);
    expect(result.missingParameters).toEqual(['timeRange', 'timeGranularity']);
    expect(result.guidance).toEqual(
      expect.arrayContaining([expect.stringContaining('ask the user for the intended date range')]),
    );
    expect(useStore.getState().chartIds).toEqual([]);
  });

  it('blocks duplicate date labels unless the caller explicitly confirms that grain', async () => {
    const sheet = makeDateSeriesSheet(['2026-06-01', '2026-06-01', '2026-06-02']);
    useStore.setState({
      sheets: { [sheet.id]: sheet },
      sheetIds: [sheet.id],
      charts: {},
      chartIds: [],
    });

    const blocked = await executeClientTool(
      'createChart',
      {
        sheetId: sheet.id,
        type: 'line',
        labelColumn: 'A',
        dataColumns: ['B'],
        timeRange: 'full available range',
        timeGranularity: 'day',
        title: 'Revenue trend',
      },
      { getSelection: () => ({}) },
    );

    expect(blocked.ok).toBe(false);
    expect(blocked.suggestedNextTools).toEqual(['createPivot']);
    expect(blocked.labelSummary).toEqual(
      expect.objectContaining({
        duplicateLabels: [expect.objectContaining({ label: '2026-06-01', count: 2 })],
      }),
    );
    expect(useStore.getState().chartIds).toEqual([]);

    const confirmed = await executeClientTool(
      'createChart',
      {
        sheetId: sheet.id,
        type: 'line',
        labelColumn: 'A',
        dataColumns: ['B'],
        timeRange: 'full available range',
        timeGranularity: 'day',
        allowDuplicateLabels: true,
        analysisNotes: 'User explicitly wants row-level daily points.',
        title: 'Revenue row-level trend',
      },
      { getSelection: () => ({}) },
    );

    expect(confirmed.ok).toBe(true);
    expect(confirmed.analysisIntent).toEqual(
      expect.objectContaining({
        timeRange: 'full available range',
        timeGranularity: 'day',
      }),
    );
    expect(useStore.getState().chartIds).toHaveLength(1);
  });

  it('creates conditional pivots that reference occupied wide columns beyond sheet size', async () => {
    const sheet = makeViewportConstrainedWideSheet();
    useStore.setState({
      sheets: { [sheet.id]: sheet },
      sheetIds: [sheet.id],
      charts: {},
      chartIds: [],
    });

    const result = await executeClientTool(
      'createPivot',
      {
        sheetId: sheet.id,
        rowLabelCol: 'A',
        values: [
          {
            operation: 'COUNT',
            label: 'Admitted',
            conditions: [{ columnId: 'BB', type: 'text', operator: 'equals', value: '[1] Trúng tuyển' }],
          },
          {
            operation: 'COUNT',
            label: 'Interview scheduled',
            conditions: [{ columnId: 'AU', type: 'text', operator: 'equals', value: '[1] Đã hẹn phỏng vấn' }],
          },
        ],
        title: 'Applicant status counts',
      },
      { getSelection: () => ({}) },
    );

    expect(result.ok).toBe(true);
    const createdSheet = useStore.getState().sheets[result.sheetId as string];
    expect(createdSheet.pivotConfig?.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Admitted',
          countRows: true,
          conditions: [expect.objectContaining({ columnId: 'BB' })],
        }),
        expect.objectContaining({
          label: 'Interview scheduled',
          countRows: true,
          conditions: [expect.objectContaining({ columnId: 'AU' })],
        }),
      ]),
    );
  });

  it('creates sparklines from occupied wide columns beyond sheet size', async () => {
    const sheet = makeViewportConstrainedWideSheet();
    useStore.setState({
      sheets: { [sheet.id]: sheet },
      sheetIds: [sheet.id],
      charts: {},
      chartIds: [],
    });

    const result = await executeClientTool(
      'createSparkline',
      {
        sheetId: sheet.id,
        dateCol: 'A',
        mode: 'metrics',
        dataCols: ['AU', 'BB'],
        title: 'Applicant status trends',
      },
      { getSelection: () => ({}) },
    );

    expect(result.ok).toBe(true);
    const createdSheet = useStore.getState().sheets[result.sheetId as string];
    expect(createdSheet.sparklineConfig?.dataCols).toEqual(['AU', 'BB']);
  });
});
