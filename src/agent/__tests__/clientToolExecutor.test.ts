import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChartData, NoteData, SheetData } from '../../../types';
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

function makeGaDailySourceSheet(): SheetData {
  const cells: SheetData['cells'] = {
    A1: { raw: 'date', value: 'date' },
    B1: { raw: 'hostName', value: 'hostName' },
    C1: { raw: 'sessionSource', value: 'sessionSource' },
    D1: { raw: 'sessionMedium', value: 'sessionMedium' },
    E1: { raw: 'sessions', value: 'sessions' },
    A2: { raw: '2026-06-01', value: '2026-06-01' },
    B2: { raw: 'theindie.app', value: 'theindie.app' },
    C2: { raw: 't.co', value: 't.co' },
    D2: { raw: 'referral', value: 'referral' },
    E2: { raw: '10', value: 10 },
    A3: { raw: '2026-06-01', value: '2026-06-01' },
    B3: { raw: 'theindie.app', value: 'theindie.app' },
    C3: { raw: 't.co', value: 't.co' },
    D3: { raw: 'referral', value: 'referral' },
    E3: { raw: '5', value: 5 },
    A4: { raw: '2026-06-01', value: '2026-06-01' },
    B4: { raw: 'theindie.app', value: 'theindie.app' },
    C4: { raw: '(direct)', value: '(direct)' },
    D4: { raw: '(none)', value: '(none)' },
    E4: { raw: '7', value: 7 },
    A5: { raw: '2026-06-02', value: '2026-06-02' },
    B5: { raw: 'theindie.app', value: 'theindie.app' },
    C5: { raw: 't.co', value: 't.co' },
    D5: { raw: 'referral', value: 'referral' },
    E5: { raw: '12', value: 12 },
  };

  return {
    id: 'ga-daily-source',
    title: 'GA daily source',
    position: { x: 0, y: 0 },
    size: { width: 5, height: 5 },
    cells,
  };
}

const initialState = useStore.getState();
const emptySelectionResolver = {
  getSelection: () => ({ sheetId: null, cellId: null, range: null }),
};

afterEach(() => {
  useStore.setState({
    sheets: initialState.sheets,
    sheetIds: initialState.sheetIds,
    charts: initialState.charts,
    chartIds: initialState.chartIds,
    notes: initialState.notes,
    noteIds: initialState.noteIds,
    selectedIds: initialState.selectedIds,
    transform: initialState.transform,
    history: initialState.history,
    future: initialState.future,
    connections: initialState.connections,
    gaMetadataCache: initialState.gaMetadataCache,
    connectionSchemaTokens: initialState.connectionSchemaTokens,
  });
  vi.unstubAllGlobals();
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

  it('includes connector provenance and query details for connected sheets', async () => {
    const sheet = makeDateSeriesSheet(['2026-06-01']);
    sheet.connectorConfig = {
      type: 'google-analytics',
      name: 'TheIndie GA trend',
      connectionId: 'ga-conn-1',
      query: {
        version: 1,
        payload: {
          propertyId: '123456789',
          report: {
            dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
            dimensions: [{ name: 'date' }, { name: 'sessionSource' }],
            metrics: [{ name: 'sessions' }],
          },
        },
      },
      derivation: 'ga4',
      lastRefreshedAt: 1781329403243,
      truncated: false,
      lastError: '',
    };
    useStore.setState({
      sheets: { [sheet.id]: sheet },
      sheetIds: [sheet.id],
    });

    const result = await executeClientTool(
      'describeSheet',
      { sheetId: sheet.id },
      { getSelection: () => ({}) },
    );

    expect(result.ok).toBe(true);
    expect(result.connector).toEqual(
      expect.objectContaining({
        type: 'google-analytics',
        connectionId: 'ga-conn-1',
        derivation: 'ga4',
        query: expect.objectContaining({ payload: expect.objectContaining({ propertyId: '123456789' }) }),
      }),
    );
  });

  it('returns actual SQL schema names when querySheet fails', async () => {
    const sheet: SheetData = {
      id: 'ga-hosts',
      title: 'GA hosts',
      position: { x: 0, y: 0 },
      size: { width: 2, height: 2 },
      cells: {
        A1: { raw: 'hostName', value: 'hostName' },
        B1: { raw: 'sessionSource', value: 'sessionSource' },
        A2: { raw: 'theindie.app', value: 'theindie.app' },
        B2: { raw: 't.co', value: 't.co' },
      },
    };
    useStore.setState({
      sheets: { [sheet.id]: sheet },
      sheetIds: [sheet.id],
    });

    const result = await executeClientTool(
      'querySheet',
      { sheetId: sheet.id, sql: 'DELETE FROM t' },
      { getSelection: () => ({}) },
    );

    expect(result.ok).toBe(false);
    expect(result.schema).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ header: 'hostName', sqlName: 'hostname' }),
        expect.objectContaining({ header: 'sessionSource', sqlName: 'sessionsource' }),
      ]),
    );
    expect(result.sqlGuidance).toContain('hostname');
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
    expect(chart.config.showLabels).toBe(false);
    expect(chart.config.seriesDisplayNames).toEqual({
      AU: 'Interview Status',
      BB: 'Admission Status',
    });
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
    expect(blocked.suggestedNextTools).toEqual(['createChart', 'createPivot']);
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

  it('creates chart-only grouped aggregates without adding a pivot sheet', async () => {
    const sheet = makeGaDailySourceSheet();
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
        mode: 'group',
        labelColumn: 'A',
        dataColumns: ['E'],
        groupCol: 'A',
        seriesGroupCol: 'C',
        valueCol: 'E',
        operation: 'SUM',
        sourceGrain: 'raw_rows',
        title: 'Daily sessions by source',
      },
      { getSelection: () => ({}) },
    );

    expect(result.ok).toBe(true);
    expect(useStore.getState().sheetIds).toEqual([sheet.id]);
    expect(useStore.getState().chartIds).toHaveLength(1);

    const chart = Object.values(useStore.getState().charts)[0];
    expect(chart.config).toEqual(
      expect.objectContaining({
        mode: 'group',
        groupCol: 'A',
        seriesGroupCol: 'C',
        valueCol: 'E',
        operation: 'SUM',
        labelColumn: 'A',
        dataColumns: ['E'],
      }),
    );
    expect(result.analysisIntent).toEqual(
      expect.objectContaining({
        chartMode: 'group',
        aggregation: 'SUM',
        sourceGrain: 'raw_rows',
      }),
    );
    expect(result.labelSummary.duplicateLabels).toEqual([
      expect.objectContaining({ label: '2026-06-01', count: 3 }),
    ]);
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

  it('applies format presets to derived pivots and persists them across source refreshes', async () => {
    const sheet = makeDateSeriesSheet(['2026-06-01', '2026-06-02']);
    useStore.setState({
      sheets: { [sheet.id]: sheet },
      sheetIds: [sheet.id],
      charts: {},
      chartIds: [],
    });

    const pivotResult = await executeClientTool(
      'createPivot',
      {
        sheetId: sheet.id,
        rowLabelCol: 'A',
        values: [{ column: 'B', operation: 'SUM', label: 'Revenue' }],
        showColTotals: false,
        title: 'Daily revenue',
      },
      emptySelectionResolver,
    );

    expect(pivotResult.ok).toBe(true);
    const pivotSheetId = pivotResult.sheetId as string;

    const formatResult = await executeClientTool(
      'applyFormat',
      {
        sheetId: pivotSheetId,
        range: 'B2:B10',
        preset: { preset: 'compactCurrency', visual: 'bar' },
        reason: 'primary revenue comparison metric',
      },
      emptySelectionResolver,
    );

    expect(formatResult.ok).toBe(true);
    expect(formatResult.persistedOutputOverride).toBe(true);
    expect(formatResult.formatDecisions).toEqual([
      expect.objectContaining({
        sheetId: pivotSheetId,
        columnId: 'B',
        header: 'Revenue',
        preset: 'compactCurrency',
        visual: 'bar',
        persistedOutputOverride: true,
        reason: 'primary revenue comparison metric',
      }),
    ]);
    expect(useStore.getState().sheets[pivotSheetId].formatRules).toEqual([
      expect.objectContaining({ range: 'B2:B10', reason: 'primary revenue comparison metric' }),
    ]);

    await executeClientTool(
      'setCells',
      {
        sheetId: sheet.id,
        cells: {
          A4: { raw: '2026-06-03' },
          B4: { raw: '300' },
        },
      },
      emptySelectionResolver,
    );

    const refreshedPivot = useStore.getState().sheets[pivotSheetId];
    expect(refreshedPivot.cells.B4.format).toEqual(
      expect.objectContaining({ type: 'currency', d3Format: '$.2s', visual: 'bar' }),
    );
  });

  it('applies format presets to derived sparklines without blocking', async () => {
    const sheet = makeDateSeriesSheet(['2026-06-01', '2026-06-02']);
    useStore.setState({
      sheets: { [sheet.id]: sheet },
      sheetIds: [sheet.id],
      charts: {},
      chartIds: [],
    });

    const sparklineResult = await executeClientTool(
      'createSparkline',
      {
        sheetId: sheet.id,
        dateCol: 'A',
        mode: 'metrics',
        dataCols: ['B'],
        title: 'Revenue trend',
      },
      emptySelectionResolver,
    );

    expect(sparklineResult.ok).toBe(true);
    const sparklineSheetId = sparklineResult.sheetId as string;

    const formatResult = await executeClientTool(
      'applyFormat',
      {
        sheetId: sparklineSheetId,
        range: 'B2:B10',
        preset: { preset: 'compactNumber', visual: 'bar' },
      },
      emptySelectionResolver,
    );

    expect(formatResult.ok).toBe(true);
    expect(formatResult.persistedOutputOverride).toBe(true);
    expect(useStore.getState().sheets[sparklineSheetId].formatRules).toEqual([
      expect.objectContaining({
        range: 'B2:B10',
        format: expect.objectContaining({ type: 'number', d3Format: '.2s', visual: 'bar' }),
      }),
    ]);
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

describe('executeClientTool selected canvas context', () => {
  it('returns an empty selectedCanvas list when no canvas nodes are selected', async () => {
    useStore.setState({
      sheets: {},
      sheetIds: [],
      charts: {},
      chartIds: [],
      notes: {},
      noteIds: [],
      selectedIds: new Set(),
    });

    const result = await executeClientTool(
      'getSelection',
      {},
      { getSelection: () => ({ sheetId: null, cellId: null, range: null }) },
    );

    expect(result.ok).toBe(true);
    expect(result.selectedCanvas).toEqual({ items: [] });
  });

  it('returns selected sheet summary without full cell data', async () => {
    const sheet = makeDateSeriesSheet(['2026-06-01', '2026-06-02']);
    useStore.setState({
      sheets: { [sheet.id]: sheet },
      sheetIds: [sheet.id],
      charts: {},
      chartIds: [],
      notes: {},
      noteIds: [],
      selectedIds: new Set([sheet.id]),
    });

    const result = await executeClientTool(
      'getSelection',
      {},
      {
        getSelection: () => ({
          sheetId: sheet.id,
          cellId: 'A2',
          range: { start: { col: 0, row: 1 }, end: { col: 1, row: 2 } },
        }),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.selection).toEqual(
      expect.objectContaining({
        sheetId: sheet.id,
        cellId: 'A2',
        range: { start: { col: 0, row: 1 }, end: { col: 1, row: 2 } },
      }),
    );
    expect(result.selectedCanvas).toEqual({
      items: [
        expect.objectContaining({
          type: 'sheet',
          sheetId: sheet.id,
          title: 'Date series',
          rowCount: 3,
          columnCount: 2,
          columnIdSpan: 'A:B',
          headers: [
            { columnId: 'A', headerCell: 'A1', header: 'Date' },
            { columnId: 'B', headerCell: 'B1', header: 'Revenue' },
          ],
          hasFilters: false,
          hasSort: false,
        }),
      ],
    });
    expect((result.selectedCanvas as any).items[0]).not.toHaveProperty('cells');
  });

  it('returns selected chart summary with source sheet context', async () => {
    const sheet = makeDateSeriesSheet(['2026-06-01', '2026-06-02']);
    const chart: ChartData = {
      id: 'chart-1',
      title: 'Revenue chart',
      sourceSheetId: sheet.id,
      position: { x: 300, y: 0 },
      size: { width: 400, height: 300 },
      config: {
        type: 'line',
        mode: 'metrics',
        labelColumn: 'A',
        dataColumns: ['B'],
        color: '#14b8a6',
        highlightIndex: -1,
        animation: true,
        timeGranularity: 'day',
      },
    };

    useStore.setState({
      sheets: { [sheet.id]: sheet },
      sheetIds: [sheet.id],
      charts: { [chart.id]: chart },
      chartIds: [chart.id],
      notes: {},
      noteIds: [],
      selectedIds: new Set([chart.id]),
    });

    const result = await executeClientTool(
      'getSelection',
      {},
      { getSelection: () => ({ sheetId: null, cellId: null, range: null }) },
    );

    expect(result.ok).toBe(true);
    expect(result.selectedCanvas).toEqual({
      items: [
        expect.objectContaining({
          type: 'chart',
          chartId: chart.id,
          title: 'Revenue chart',
          sourceSheetId: sheet.id,
          sourceSheetTitle: 'Date series',
          chartType: 'line',
          mode: 'metrics',
          labelColumn: 'A',
          dataColumns: ['B'],
          timeGranularity: 'day',
        }),
      ],
    });
  });

  it('returns selected note previews', async () => {
    const note: NoteData = {
      id: 'note-1',
      position: { x: 0, y: 0 },
      size: { width: 200, height: 100 },
      color: 'gray',
      content: 'Use this segment for the next analysis.',
    };

    useStore.setState({
      sheets: {},
      sheetIds: [],
      charts: {},
      chartIds: [],
      notes: { [note.id]: note },
      noteIds: [note.id],
      selectedIds: new Set([note.id]),
    });

    const result = await executeClientTool(
      'getSelection',
      {},
      { getSelection: () => ({ sheetId: null, cellId: null, range: null }) },
    );

    expect(result.ok).toBe(true);
    expect(result.selectedCanvas).toEqual({
      items: [
        {
          type: 'note',
          noteId: note.id,
          preview: 'Use this segment for the next analysis.',
        },
      ],
    });
  });

  it('includes selectedCanvas and diagnostics in listConnections', async () => {
    const sheet = makeDateSeriesSheet(['2026-06-01']);
    sheet.connectorConfig = {
      type: 'google-analytics',
      name: 'GA4',
      connectionId: 'conn-1',
      query: {
        version: 1,
        payload: {
          propertyId: '537587042',
          report: { dimensions: [{ name: 'date' }], metrics: [{ name: 'sessions' }] },
        },
      },
      derivation: 'ga4',
    };
    useStore.setState({
      sheets: { [sheet.id]: sheet },
      sheetIds: [sheet.id],
      charts: {},
      chartIds: [],
      notes: {},
      noteIds: [],
      selectedIds: new Set([sheet.id]),
      connections: [],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/api/connectors')) {
          return {
            ok: true,
            json: async () => ({
              connectors: [
                { id: 'conn-1', type: 'google-analytics', name: 'GA4' },
                { id: 'conn-2', type: 'google-analytics', name: 'GA4' },
              ],
            }),
          };
        }
        if (url.endsWith('/api/connectors/google-analytics/properties')) {
          return {
            ok: true,
            json: async () => ({
              properties: [{ propertyId: '537587042', displayName: 'TheIndie', accountDisplayName: 'Apps' }],
              truncated: false,
            }),
          };
        }
        throw new Error(`Unexpected fetch ${url}`);
      }),
    );

    const result = await executeClientTool(
      'listConnections',
      {},
      { getSelection: () => ({ sheetId: null, cellId: null, range: null }) },
    );

    expect(result.ok).toBe(true);
    expect(result.connections).toEqual([
      expect.objectContaining({
        connectionId: 'conn-1',
        type: 'google-analytics',
        name: 'GA4',
        duplicateName: true,
        health: expect.objectContaining({ status: 'ok' }),
        propertyHints: [expect.objectContaining({ propertyId: '537587042', displayName: 'TheIndie' })],
        usedBySheets: [expect.objectContaining({ sheetId: sheet.id, query: expect.objectContaining({ payload: expect.objectContaining({ propertyId: '537587042' }) }) })],
      }),
      expect.objectContaining({
        connectionId: 'conn-2',
        duplicateName: true,
      }),
    ]);
    expect(result.selectedCanvas).toEqual({
      items: [expect.objectContaining({ type: 'sheet', sheetId: sheet.id })],
    });
    expect(useStore.getState().connections).toEqual([
      { connectionId: 'conn-1', type: 'google-analytics', name: 'GA4' },
      { connectionId: 'conn-2', type: 'google-analytics', name: 'GA4' },
    ]);
  });

  it('creates a GA trend-by-source sheet and grouped sparkline table', async () => {
    useStore.setState({
      sheets: {},
      sheetIds: [],
      charts: {},
      chartIds: [],
      connectionSchemaTokens: {
        token12345: {
          connectionId: 'ga-conn-1',
          type: 'google-analytics',
          propertyId: '123456789',
          createdAt: Date.now(),
        },
      },
    });
    vi.stubGlobal('window', { innerWidth: 1400, innerHeight: 900 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/api/query/google-analytics')) {
          return {
            ok: true,
            json: async () => ({
              columns: [
                { name: 'date', type: 'dimension' },
                { name: 'hostName', type: 'dimension' },
                { name: 'sessionSource', type: 'dimension' },
                { name: 'sessionMedium', type: 'dimension' },
                { name: 'sessions', type: 'TYPE_INTEGER' },
              ],
              rows: [
                ['20260601', 'theindie.app', '(direct)', '(none)', '4'],
                ['20260602', 'theindie.app', 't.co', 'referral', '2'],
              ],
              rowCount: 2,
              truncated: false,
            }),
          };
        }
        throw new Error(`Unexpected fetch ${url}`);
      }),
    );

    const result = await executeClientTool(
      'createGaTrendBySource',
      {
        connectionId: 'ga-conn-1',
        schemaToken: 'token12345',
        propertyId: '123456789',
        startDate: '30daysAgo',
        endDate: 'today',
        hostName: 'theindie.app',
        brief: {
          logic: 'Trends daily GA sessions by source and medium for the selected host.',
          scope: ['30daysAgo to today', 'Filtered to theindie.app'],
          sources: ['GA property 123456789'],
          judgmentNotes: ['The sparkline summary depends on the raw GA rows returned by source and medium.'],
        },
        title: 'TheIndie daily source trend',
      },
      { getSelection: () => ({}) },
    );

    expect(result.ok).toBe(true);
    const state = useStore.getState();
    expect(state.sheetIds).toHaveLength(2);
    const sourceSheet = state.sheets[result.sheetId as string];
    const sparklineSheet = state.sheets[result.sparklineSheetId as string];
    expect(sourceSheet.connectorConfig).toEqual(
      expect.objectContaining({
        connectionId: 'ga-conn-1',
        derivation: 'ga4-trend-by-source',
        brief: expect.objectContaining({
          logic: 'Trends daily GA sessions by source and medium for the selected host.',
          status: 'current',
        }),
        query: expect.objectContaining({ payload: expect.objectContaining({ propertyId: '123456789' }) }),
      }),
    );
    expect(sourceSheet.cells.A2.value).toBe('2026-06-01');
    expect(sparklineSheet.sparklineConfig).toEqual(
      expect.objectContaining({
        sourceSheetId: sourceSheet.id,
        dateCol: 'A',
        groupCol: 'C',
        valueCol: 'E',
        operation: 'SUM',
      }),
    );
  });

  it('returns GA trend diagnostics without creating sheets when host data is empty', async () => {
    useStore.setState({
      sheets: {},
      sheetIds: [],
      charts: {},
      chartIds: [],
      connectionSchemaTokens: {
        token12345: {
          connectionId: 'ga-conn-1',
          type: 'google-analytics',
          propertyId: '123456789',
          createdAt: Date.now(),
        },
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/api/query/google-analytics')) {
          return {
            ok: true,
            json: async () => ({
              columns: [
                { name: 'hostName', type: 'dimension' },
                { name: 'sessions', type: 'TYPE_INTEGER' },
              ],
              rows: [],
              rowCount: 0,
              truncated: false,
            }),
          };
        }
        throw new Error(`Unexpected fetch ${url}`);
      }),
    );

    const result = await executeClientTool(
      'createGaTrendBySource',
      {
        connectionId: 'ga-conn-1',
        schemaToken: 'token12345',
        propertyId: '123456789',
        startDate: '2026-05-14',
        endDate: '2026-06-13',
        hostName: 'theindie.app',
        brief: {
          logic: 'Attempts to trend GA sessions by source for the selected host.',
          scope: ['2026-05-14 to 2026-06-13', 'Filtered to theindie.app'],
          sources: ['GA property 123456789'],
          judgmentNotes: ['No sheet should be created if GA returns no rows.'],
        },
      },
      { getSelection: () => ({}) },
    );

    expect(result.ok).toBe(false);
    expect(result.queryDiagnostics).toEqual(
      expect.objectContaining({
        propertyId: '123456789',
        dateRanges: [{ startDate: '2026-05-14', endDate: '2026-06-13' }],
        hostNameFilter: 'theindie.app',
        dimensionFilter: expect.objectContaining({
          filter: expect.objectContaining({
            fieldName: 'hostName',
            stringFilter: expect.objectContaining({
              matchType: 'EXACT',
              value: 'theindie.app',
            }),
          }),
        }),
        topHostnames: [],
      }),
    );
    expect(useStore.getState().sheetIds).toEqual([]);
  });
});
