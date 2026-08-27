import { describe, expect, it } from 'vitest';
import { buildErrorMessage, shapeSuccess, WEBMCP_OUTPUT_BUDGET } from '../webmcp/toolResultShaping';

// ── Fixture builders ───────────────────────────────────────────────────────
// These mirror the ACTUAL return shapes read from clientToolExecutor.ts,
// querySheetTools.ts, and gaMcpTools.ts — not guessed field names.

function columnLetterFromIndex(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function parseA1(ref: string): { col: number; row: number } {
  const m = /^([A-Z]+)([0-9]+)$/.exec(ref);
  if (!m) throw new Error(`bad ref ${ref}`);
  let col = 0;
  for (let i = 0; i < m[1].length; i++) col = col * 26 + (m[1].charCodeAt(i) - 64);
  return { col: col - 1, row: parseInt(m[2], 10) - 1 };
}

// 57-column sheet, as returned by describeSheet (summarizeSheet + describeColumn
// + requestedColumns + sampleRows in clientToolExecutor.ts).
function buildWideDescribeSheetResult(columnCount = 57, rowCount = 500) {
  const columns = Array.from({ length: columnCount }, (_, i) => {
    const columnId = columnLetterFromIndex(i);
    return {
      columnId,
      headerCell: `${columnId}1`,
      dataRange: `${columnId}2:${columnId}${rowCount}`,
      header: `Metric Header Number ${i}`,
      inferredType: i % 3 === 0 ? 'number' : i % 3 === 1 ? 'date' : 'text',
      samples: [`sample-a-${i}`, `sample-b-${i}`, `sample-c-${i}`],
    };
  });
  const sampleRows = Array.from({ length: 5 }, (_, r) => {
    const row: Record<string, unknown> = { rowNumber: r + 2 };
    for (const c of columns) row[c.columnId] = `${c.columnId}-row${r}-value`;
    return row;
  });
  return {
    ok: true,
    sheetId: 'sheet-wide-1',
    title: 'Wide 57-column sheet',
    rowCount,
    columnCount,
    columnIdSpan: `A:${columns[columns.length - 1].columnId}`,
    rowNumbering: '1-based; row 1 is headers, data starts at row 2',
    filters: [],
    sort: null,
    connector: null,
    columns,
    requestedColumns: [],
    sampleRows,
  };
}

// Same 57-column sheet as buildWideDescribeSheetResult, but with a large
// `columnIds` request (e.g. "describe columns A through T") echoed back in
// `requestedColumns` — the field agent/tools.ts's columnIds schema leaves
// unbounded (`z.array(ColumnIdSchema).optional()`, no `.max()`).
function buildDescribeSheetResultWithManyRequestedColumns(requestedCount = 20, columnCount = 57, rowCount = 500) {
  const base = buildWideDescribeSheetResult(columnCount, rowCount);
  const requestedColumns = base.columns.slice(0, requestedCount).map((c) => ({
    exists: true,
    columnId: c.columnId,
    headerCell: c.headerCell,
    dataRange: c.dataRange,
    header: c.header,
    inferredType: c.inferredType,
    samples: c.samples,
  }));
  return { ...base, requestedColumns };
}

// A1:BB500 range, as returned by getRange in clientToolExecutor.ts
// (`{ ok, sheetId, range, cells: Record<cellId, {raw,value}> }`).
function buildLargeRangeResult(range = 'A1:BB500') {
  const [startRef, endRef] = range.split(':');
  const start = parseA1(startRef);
  const end = parseA1(endRef);
  const cells: Record<string, { raw: string; value: unknown }> = {};
  for (let r = start.row; r <= end.row; r++) {
    for (let c = start.col; c <= end.col; c++) {
      const id = `${columnLetterFromIndex(c)}${r + 1}`;
      cells[id] = { raw: String(r * 1000 + c), value: r * 1000 + c };
    }
  }
  return { ok: true, sheetId: 'sheet-big-range', range, cells };
}

// 200-row querySheet result: `{ ok, schema, columns, rows, rowCount, truncated }`.
function buildQuerySheetResult(rowCount = 200, colCount = 6) {
  const schema = Array.from({ length: colCount }, (_, i) => ({
    columnLetter: columnLetterFromIndex(i),
    headerCell: `${columnLetterFromIndex(i)}1`,
    header: `Header ${i}`,
    sqlName: i === 2 ? 'hostname' : `col_${i}`,
    sampleValue: i,
  }));
  const columns = schema.map((s) => s.sqlName);
  const rows = Array.from({ length: rowCount }, (_, r) => columns.map((_, c) => `row${r}-col${c}-value`));
  return { ok: true, schema, columns, rows, rowCount, truncated: false };
}

function buildQuerySheetError() {
  const schema = Array.from({ length: 8 }, (_, i) => ({
    columnLetter: columnLetterFromIndex(i),
    headerCell: `${columnLetterFromIndex(i)}1`,
    header: `Header ${i}`,
    sqlName: i === 2 ? 'hostname' : `col_${i}`,
    sampleValue: null,
  }));
  return {
    ok: false,
    error: "Query error: no such column 'host_name'",
    schema,
    sqlGuidance:
      'Use table "t" and the exact schema.sqlName values returned here; header-derived names may be compacted (for example hostname or sessionsource), not snake_case.',
  };
}

// GA describeConnection with 50 dims + 50 metrics, as returned by
// clientToolExecutor.ts's describeConnection google-analytics branch.
const GA_PAYLOAD_SCHEMA = [
  '{ propertyId: string, report: {',
  '  dateRanges?: [{ startDate: string, endDate: string }],   // GA dates: "YYYY-MM-DD", "30daysAgo", "today", "yesterday".',
  '  // The backend normalizes legacy variants like "10weeksAgo" to "70daysAgo".',
  '  dimensions?: [{ name: string }],   // GA4 dimension apiNames, e.g. { name: "date" }, { name: "sessionSource" }',
  '  metrics?: [{ name: string }],      // GA4 metric apiNames, e.g. { name: "activeUsers" }, { name: "sessions" }',
  '  dimensionFilter?: object,          // GA4 FilterExpression (optional)',
  '  metricFilter?: object,             // GA4 FilterExpression (optional)',
  '  orderBys?: [object],               // e.g. [{ dimension: { dimensionName: "date" } }]',
  '  limit?: number',
  '} }',
].join('\n');

function buildGaDescribeConnectionResult(dimCount = 50, metricCount = 50) {
  const dimensions = Array.from({ length: dimCount }, (_, i) => ({
    apiName: `dimension_${i}`,
    displayName: `Dimension Display Name Number ${i} With Extra Wording`,
    description: `A moderately long description of dimension number ${i} to simulate the real GA metadata catalog payload size.`,
  }));
  const metrics = Array.from({ length: metricCount }, (_, i) => ({
    apiName: `metric_${i}`,
    displayName: `Metric Display Name Number ${i} With Extra Wording`,
    description: `A moderately long description of metric number ${i} to simulate the real GA metadata catalog payload size.`,
  }));
  return {
    ok: true,
    connectionId: 'conn-ga-1',
    type: 'google-analytics',
    propertyId: '123456789',
    schemaToken: 'schema_abcdef123456ghijkl',
    queryShape: {
      type: 'google-analytics',
      summary: 'A Google Analytics query is a GA4 runReport spec: a propertyId plus a nested report object.',
      payloadSchema: GA_PAYLOAD_SCHEMA,
      requiredFields: ['propertyId', 'report'],
      examples: [
        {
          propertyId: '123456789',
          report: {
            dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
            dimensions: [{ name: 'date' }, { name: 'sessionSource' }],
            metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
            orderBys: [{ dimension: { dimensionName: 'date' } }],
            limit: 1000,
          },
        },
        {
          propertyId: '123456789',
          report: {
            dateRanges: [{ startDate: '2026-01-01', endDate: '2026-01-31' }],
            dimensions: [{ name: 'pagePath' }],
            metrics: [{ name: 'screenPageViews' }],
            limit: 500,
          },
        },
      ],
    },
    search: null,
    dimensions,
    metrics,
    dimensionsTotal: dimCount,
    metricsTotal: metricCount,
  };
}

function buildConnectorSuccessResult() {
  const headers = Array.from({ length: 15 }, (_, i) => ({ columnId: columnLetterFromIndex(i), header: `Header ${i}` }));
  const inferredTypes = headers.map((_, i) => (i % 2 === 0 ? 'number' : 'text'));
  const sampleRows = Array.from({ length: 5 }, (_, r) => {
    const row: Record<string, unknown> = { rowNumber: r + 2 };
    for (const h of headers) row[h.columnId] = `${h.columnId}-row${r}`;
    return row;
  });
  return {
    ok: true,
    sheetId: 'sheet-conn-1',
    title: 'ClickHouse: sales summary',
    rowCount: 1000,
    truncated: false,
    headers,
    inferredTypes,
    sampleRows,
    derivation: 'Aggregated sales by month and loyalty tier',
    brief: {
      logic: 'Sums total_profit grouped by month and loyalty_tier from hq_report.sales for May 2026.',
      scope: ['May 2026 transactions', 'Grouped by month and loyalty tier'],
      sources: ['hq_report.sales'],
      judgmentNotes: ['Only reflects rows included by the query filters and limits.'],
    },
  };
}

function buildConnectorEmptyResultError() {
  return {
    ok: false,
    error: 'Query returned no data rows. No private result, sheet, or chart was created; explain the empty result and stop.',
    queryDiagnostics: {
      propertyId: '123456789',
      dateRanges: [{ startDate: '2026-05-01', endDate: '2026-05-31' }],
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'sessions' }],
      dimensionFilter: { filter: { fieldName: 'hostName', stringFilter: { matchType: 'EXACT', value: 'example.com' } } },
      hostNameFilter: 'example.com',
      topHostnames: [
        { hostName: 'a.example.com', metricValue: '120' },
        { hostName: 'b.example.com', metricValue: '80' },
      ],
    },
  };
}

function buildCreateChartResult() {
  return {
    ok: true,
    chartId: 'chart-1',
    sheetId: 'sheet-1',
    resolvedColumns: {
      labelColumn: { columnId: 'A', header: 'Date' },
      dataColumns: [
        { columnId: 'B', header: 'Sessions' },
        { columnId: 'C', header: 'Revenue' },
      ],
      groupCol: null,
      seriesGroupCol: null,
      valueCol: null,
    },
    analysisIntent: {
      chartMode: 'metrics',
      timeRange: 'last 30 days',
      timeGranularity: 'day',
      aggregation: null,
      sourceGrain: 'raw_rows',
      analysisNotes: null,
    },
    formDecisions: {
      appliedType: 'line',
      usedSmartDefaults: true,
      firedRules: ['single-series-line', 'time-x-axis', 'extra-rule-should-be-capped'],
      warnings: [],
      rightAxisColumns: [],
      seriesTypes: {},
      topNSuggestion: null,
      horizontalRecommended: false,
    },
    labelSummary: {
      columnId: 'A',
      header: 'Date',
      labelCount: 30,
      uniqueLabelCount: 30,
      duplicateLabels: [],
      dateLikeCount: 30,
      isDateLike: true,
      availableTimeRange: { startDate: '2026-05-01', endDate: '2026-05-30' },
    },
  };
}

function buildCreateChartError() {
  return {
    ok: false,
    error: 'Chart needs more analysis intent before it can be created without risking a misleading visualization.',
    missingParameters: ['timeRange', 'timeGranularity'],
    labelSummary: {
      columnId: 'A',
      header: 'Date',
      labelCount: 30,
      uniqueLabelCount: 5,
      duplicateLabels: [{ label: '2026-05-01', count: 6 }],
      dateLikeCount: 30,
      isDateLike: true,
      availableTimeRange: { startDate: '2026-05-01', endDate: '2026-05-30' },
    },
    guidance: [
      'Column A (Date) is date-like, so ask the user for the intended date range and time granularity before charting.',
      'If the user wants the full available range, pass timeRange="full available range" explicitly.',
      'This third guidance line should be dropped — only the first two survive.',
    ],
    suggestedNextTools: ['createChart', 'createPivot'],
  };
}

function buildListSheetsResult(sheetCount = 30, headerCount = 40) {
  const sheets = Array.from({ length: sheetCount }, (_, s) => ({
    sheetId: `sheet-${s}`,
    title: `Sheet ${s}`,
    rowCount: 100,
    columnCount: headerCount,
    columnIdSpan: `A:${columnLetterFromIndex(headerCount - 1)}`,
    rowNumbering: '1-based; row 1 is headers, data starts at row 2',
    headers: Array.from({ length: headerCount }, (_, c) => ({
      columnId: columnLetterFromIndex(c),
      headerCell: `${columnLetterFromIndex(c)}1`,
      header: `Column Header ${c}`,
    })),
  }));
  return { ok: true, sheets };
}

function buildListConnectionsResult(count = 8) {
  const connections = Array.from({ length: count }, (_, i) => ({
    connectionId: `conn-${i}`,
    type: i % 2 === 0 ? 'google-analytics' : 'clickhouse',
    name: `Connection ${i}`,
    duplicateName: false,
    health: { status: 'ok', checkedAt: Date.now(), message: 'Reachable.' },
    propertyHints: Array.from({ length: 6 }, (_, p) => ({
      propertyId: `prop-${i}-${p}`,
      displayName: `Property ${i}-${p}`,
      accountDisplayName: 'Account',
    })),
    propertiesTruncated: false,
    usedBySheets: [],
  }));
  return {
    ok: true,
    connections,
    selectedCanvas: { items: Array.from({ length: 5 }, (_, i) => ({ type: 'sheet', sheetId: `sel-${i}`, title: `Sel ${i}` })) },
  };
}

function buildGetSelectionResult(itemCount = 20) {
  const items = Array.from({ length: itemCount }, (_, i) => ({
    type: i % 3 === 0 ? 'chart' : i % 3 === 1 ? 'note' : 'sheet',
    sheetId: i % 3 === 2 ? `sheet-${i}` : undefined,
    chartId: i % 3 === 0 ? `chart-${i}` : undefined,
    noteId: i % 3 === 1 ? `note-${i}` : undefined,
    title: `Selected item ${i}`,
    preview: `Preview text for item ${i}`,
  }));
  return {
    ok: true,
    selection: { sheetId: 'sheet-1', cellId: 'A1', range: null },
    selectedCanvas: { items },
  };
}

function buildReadNoteResult(contentChars = 5000) {
  return {
    ok: true,
    noteId: 'note-1',
    title: 'Long note',
    content: 'x'.repeat(contentChars),
    color: 'yellow',
    format: 'markdown',
  };
}

function buildListNotesResult(count = 40) {
  const notes = Array.from({ length: count }, (_, i) => ({
    noteId: `note-${i}`,
    title: `Note ${i}`,
    preview: `Preview text for note number ${i} that runs a bit long to simulate real note previews`.repeat(2),
    color: 'yellow',
    format: 'markdown',
  }));
  return { ok: true, notes };
}

function buildApplyFormatResult(decisionCount = 20) {
  const formatDecisions = Array.from({ length: decisionCount }, (_, i) => ({
    cell: `${columnLetterFromIndex(i)}2`,
    preset: 'currency',
    reason: `Formatted cell ${i} as currency because it looked like a monetary metric`,
  }));
  return {
    ok: true,
    sheetId: 'sheet-1',
    range: 'A1:T50',
    cellsFormatted: 980,
    persistedOutputOverride: true,
    formatDecisions,
  };
}

function buildListConnectionPropertiesResult(count = 50) {
  const properties = Array.from({ length: count }, (_, i) => ({
    propertyId: `prop-${i}`,
    displayName: `Property Display Name ${i}`,
    accountDisplayName: `Account ${i}`,
  }));
  return { ok: true, connectionId: 'conn-1', type: 'google-analytics', properties, nextPageToken: 'token-2', truncated: true };
}

function buildCreateGaTrendBySourceError() {
  return {
    ok: false,
    error: 'Google Analytics trend returned no data rows. No sheet or sparkline was created.',
    queryDiagnostics: {
      propertyId: '123456789',
      dateRanges: [{ startDate: '2026-05-01', endDate: '2026-05-31' }],
      dimensions: [{ name: 'date' }, { name: 'hostName' }],
      metrics: [{ name: 'sessions' }],
      dimensionFilter: null,
      hostNameFilter: 'example.com',
      topHostnames: [{ hostName: 'a.example.com', metricValue: '10' }],
    },
  };
}

// ── Generic helpers for assertions ──────────────────────────────────────

function jsonSize(value: unknown): number {
  return JSON.stringify(value).length;
}

function deepFreeze<T>(value: T, seen = new Set<unknown>()): T {
  if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v, seen);
    Object.freeze(value);
  }
  return value;
}

function containsEllipsisSentinel(value: unknown): boolean {
  if (typeof value === 'string') return value.trim() === '...' || /^\.{3,}$/.test(value.trim());
  if (Array.isArray(value)) return value.some(containsEllipsisSentinel);
  if (value && typeof value === 'object') return Object.values(value).some(containsEllipsisSentinel);
  return false;
}

function collectOmittedNotes(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) collectOmittedNotes(v, out);
  } else if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (key === '_omitted' && typeof v === 'string') out.push(v);
      collectOmittedNotes(v, out);
    }
  }
  return out;
}

// ── Success-path fixtures used by the budget sweep ──────────────────────

const SUCCESS_CASES: Array<{ tool: string; result: Record<string, unknown> }> = [
  { tool: 'describeSheet', result: buildWideDescribeSheetResult() },
  { tool: 'getRange', result: buildLargeRangeResult() },
  { tool: 'querySheet', result: buildQuerySheetResult() },
  { tool: 'listSheets', result: buildListSheetsResult() },
  { tool: 'listConnections', result: buildListConnectionsResult() },
  { tool: 'getSelection', result: buildGetSelectionResult() },
  { tool: 'queryConnection', result: buildConnectorSuccessResult() },
  { tool: 'createQuerySheet', result: buildConnectorSuccessResult() },
  { tool: 'createQuerySheetFromResult', result: buildConnectorSuccessResult() },
  { tool: 'updateQuerySheet', result: buildConnectorSuccessResult() },
  { tool: 'describeConnection', result: buildGaDescribeConnectionResult() },
  { tool: 'readNote', result: buildReadNoteResult() },
  { tool: 'listNotes', result: buildListNotesResult() },
  { tool: 'createChart', result: buildCreateChartResult() },
  { tool: 'applyFormat', result: buildApplyFormatResult() },
  { tool: 'listConnectionProperties', result: buildListConnectionPropertiesResult() },
];

const ERROR_CASES: Array<{ tool: string; result: Record<string, unknown> }> = [
  { tool: 'querySheet', result: buildQuerySheetError() },
  { tool: 'queryConnection', result: buildConnectorEmptyResultError() },
  { tool: 'createQuerySheet', result: buildConnectorEmptyResultError() },
  { tool: 'createChart', result: buildCreateChartError() },
  { tool: 'createGaTrendBySource', result: buildCreateGaTrendBySourceError() },
];

describe('shapeSuccess: every shaped output fits the WebMCP budget', () => {
  for (const { tool, result } of SUCCESS_CASES) {
    it(`${tool} success result is <= ${WEBMCP_OUTPUT_BUDGET} chars`, () => {
      const frozenInput = deepFreeze(structuredClone(result));
      const shaped = shapeSuccess(tool, frozenInput);
      expect(jsonSize(shaped)).toBeLessThanOrEqual(WEBMCP_OUTPUT_BUDGET);
    });
  }
});

describe('buildErrorMessage: every error message fits its budget', () => {
  for (const { tool, result } of ERROR_CASES) {
    it(`${tool} error message is <= 600 chars`, () => {
      const frozenInput = deepFreeze(structuredClone(result));
      const message = buildErrorMessage(tool, frozenInput);
      expect(typeof message).toBe('string');
      expect(message.length).toBeLessThanOrEqual(600);
    });
  }
});

describe('Layer 2 backstop', () => {
  it('gets an absurd ~3MB blob under budget without throwing, on a tool with no Layer 1 shaper', () => {
    const huge = {
      ok: true,
      sheetId: 'sheet-1',
      updatedCount: 1,
      garbageArray: Array.from({ length: 50_000 }, (_, i) => ({ a: i, b: 'y'.repeat(50) })),
    };
    expect(jsonSize(huge)).toBeGreaterThan(1_000_000);
    let shaped: Record<string, unknown> | undefined;
    expect(() => {
      shaped = shapeSuccess('setCells', huge);
    }).not.toThrow();
    expect(jsonSize(shaped)).toBeLessThanOrEqual(WEBMCP_OUTPUT_BUDGET);
    expect(shaped?.ok).toBe(true);
  });

  it('clips a single huge string field down under budget', () => {
    const huge = { ok: true, sheetId: 'sheet-1', garbage: 'z'.repeat(1_000_000) };
    const shaped = shapeSuccess('setCells', huge);
    expect(jsonSize(shaped)).toBeLessThanOrEqual(WEBMCP_OUTPUT_BUDGET);
  });
});

describe('describeConnection retains schemaToken', () => {
  it('keeps schemaToken verbatim even under heavy GA metadata shaping', () => {
    const result = buildGaDescribeConnectionResult();
    const shaped = shapeSuccess('describeConnection', result);
    expect(shaped.schemaToken).toBe(result.schemaToken);
    expect(jsonSize(shaped)).toBeLessThanOrEqual(WEBMCP_OUTPUT_BUDGET);
  });
});

describe('describeSheet caps requestedColumns instead of dropping it', () => {
  it('keeps requestedColumns present and non-empty when 20 columns are requested, within budget', () => {
    const result = buildDescribeSheetResultWithManyRequestedColumns(20);
    const shaped = shapeSuccess('describeSheet', result);
    expect(jsonSize(shaped)).toBeLessThanOrEqual(WEBMCP_OUTPUT_BUDGET);
    expect(Array.isArray(shaped.requestedColumns)).toBe(true);
    expect((shaped.requestedColumns as unknown[]).length).toBeGreaterThan(0);
  });
});

describe('querySheet retains a usable compacted schema', () => {
  it('shapes schema into letter=sqlName pairs on success', () => {
    const shaped = shapeSuccess('querySheet', buildQuerySheetResult());
    expect(typeof shaped.schema).toBe('string');
    expect(shaped.schema).toContain('C=hostname');
    expect(shaped.schema).toContain('A=col_0');
  });
});

describe('createChart shaper drops resolvedColumns and labelSummary', () => {
  it('omits both echo-prone fields from the shaped success result', () => {
    const shaped = shapeSuccess('createChart', buildCreateChartResult());
    expect(shaped).not.toHaveProperty('resolvedColumns');
    expect(shaped).not.toHaveProperty('labelSummary');
    // Sanity: the useful, non-echoing fields are still present.
    expect(shaped.chartId).toBe('chart-1');
    expect(shaped.appliedType).toBe('line');
    expect(Array.isArray(shaped.firedRules)).toBe(true);
    expect((shaped.firedRules as unknown[]).length).toBeLessThanOrEqual(3);
  });
});

describe('connector shaper drops brief', () => {
  for (const tool of ['queryConnection', 'createQuerySheet', 'createQuerySheetFromResult', 'updateQuerySheet']) {
    it(`${tool} omits brief from the shaped success result`, () => {
      const shaped = shapeSuccess(tool, buildConnectorSuccessResult());
      expect(shaped).not.toHaveProperty('brief');
    });
  }
});

describe('_omitted budget and no per-row ellipsis sentinels', () => {
  it('never exceeds 80 chars across every fixture, and no sentinel "..." rows appear', () => {
    for (const { tool, result } of [...SUCCESS_CASES]) {
      const shaped = shapeSuccess(tool, result);
      const notes = collectOmittedNotes(shaped);
      for (const note of notes) {
        expect(note.length, `${tool}._omitted too long: "${note}"`).toBeLessThanOrEqual(80);
      }
      expect(containsEllipsisSentinel(shaped), `${tool} shaped output contains a "..." sentinel`).toBe(false);
    }
  });
});

describe('buildErrorMessage: querySheet', () => {
  it('includes both schema and sqlGuidance and stays within 600 chars', () => {
    const message = buildErrorMessage('querySheet', buildQuerySheetError());
    expect(message).toContain('schema:');
    expect(message).toContain('C=hostname');
    expect(message).toContain('sqlGuidance:');
    expect(message).toContain('schema.sqlName');
    expect(message.length).toBeLessThanOrEqual(600);
  });
});

describe('createChart error path preserves guidance', () => {
  it('keeps missingParameters, first 2 guidance lines, and suggestedNextTools', () => {
    const message = buildErrorMessage('createChart', buildCreateChartError());
    expect(message).toContain('missingParameters: timeRange, timeGranularity');
    expect(message).toContain('date-like');
    expect(message).toContain('full available range');
    expect(message).not.toContain('This third guidance line should be dropped');
    expect(message).toContain('suggestedNextTools: createChart, createPivot');
    expect(message.length).toBeLessThanOrEqual(600);
  });
});

describe('connector empty-result error path', () => {
  it('folds error + queryDiagnostics (clipped to 200 chars) into the message', () => {
    const message = buildErrorMessage('queryConnection', buildConnectorEmptyResultError());
    expect(message).toContain('Query returned no data rows');
    expect(message).toContain('queryDiagnostics:');
    expect(message.length).toBeLessThanOrEqual(600);
  });
});

describe('getRange reshapes to row-major display values with a returnedRange', () => {
  it('drops the {raw,value} pair, clips rows to budget, and reports what was returned', () => {
    const shaped = shapeSuccess('getRange', buildLargeRangeResult());
    expect(Array.isArray(shaped.rows)).toBe(true);
    const rows = shaped.rows as unknown[];
    expect(rows.length).toBeGreaterThan(0);
    expect(Array.isArray(rows[0])).toBe(true);
    // Row entries are plain display-value strings, not {raw,value} objects.
    expect(typeof (rows[0] as unknown[])[0]).toBe('string');
    expect(typeof shaped.returnedRange).toBe('string');
    expect(shaped.rowCount).toBe(500);
    expect(jsonSize(shaped)).toBeLessThanOrEqual(WEBMCP_OUTPUT_BUDGET);
  });
});

describe('shapers are pure', () => {
  it('shapeSuccess never mutates the input result object', () => {
    for (const { tool, result } of SUCCESS_CASES) {
      const snapshot = structuredClone(result);
      const frozen = deepFreeze(structuredClone(result));
      expect(() => shapeSuccess(tool, frozen)).not.toThrow();
      expect(frozen).toEqual(snapshot);
    }
  });

  it('buildErrorMessage never mutates the input result object', () => {
    for (const { tool, result } of ERROR_CASES) {
      const snapshot = structuredClone(result);
      const frozen = deepFreeze(structuredClone(result));
      expect(() => buildErrorMessage(tool, frozen)).not.toThrow();
      expect(frozen).toEqual(snapshot);
    }
  });
});
