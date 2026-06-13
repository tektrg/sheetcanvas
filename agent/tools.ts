import { z } from 'zod';

export const A1RangeSchema = z
  .string()
  .regex(/^[A-Z]+\d+(:[A-Z]+\d+)?$/, 'Range must be A1 notation like "A1" or "A1:B10"');

// Shared optional visual decoration usable on any format type. `sparkline`
// renders an in-cell mini line chart over the column's numeric values;
// `bar`/`bar-row` render value-proportional bars; `heatmap`/`heatmap-row`
// shade the cell background. `heatmapColor` only applies to heatmap visuals.
const CellVisualEnum = z.enum(['bar', 'bar-row', 'heatmap', 'heatmap-row', 'sparkline']);
const HeatmapColorEnum = z.enum(['red', 'green', 'yellow']);

export const CellFormatSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('number'),
    decimals: z.number().int().min(0).max(10).optional(),
    visual: CellVisualEnum.optional(),
    heatmapColor: HeatmapColorEnum.optional(),
  }),
  z.object({
    type: z.literal('currency'),
    symbol: z.string().max(4).optional(),
    decimals: z.number().int().min(0).max(10).optional(),
    visual: CellVisualEnum.optional(),
    heatmapColor: HeatmapColorEnum.optional(),
  }),
  z.object({
    type: z.literal('percent'),
    decimals: z.number().int().min(0).max(10).optional(),
    visual: CellVisualEnum.optional(),
    heatmapColor: HeatmapColorEnum.optional(),
  }),
  z.object({
    type: z.literal('date'),
    dateFormat: z.string().max(40).optional(),
    visual: CellVisualEnum.optional(),
    heatmapColor: HeatmapColorEnum.optional(),
  }),
  z.object({
    type: z.literal('text'),
    visual: CellVisualEnum.optional(),
    heatmapColor: HeatmapColorEnum.optional(),
  }),
]);

const ColumnIdSchema = z.string().regex(/^[A-Z]+$/, 'columnId must be a column letter like "A"');

const TextFilterConditionSchema = z.object({
  columnId: ColumnIdSchema,
  type: z.literal('text'),
  operator: z.enum(['contains', 'equals', 'startsWith', 'endsWith']),
  value: z.string(),
});

const NumberFilterConditionSchema = z.discriminatedUnion('operator', [
  z.object({
    columnId: ColumnIdSchema,
    type: z.literal('number'),
    operator: z.enum(['gt', 'lt', 'eq', 'neq']),
    value: z.number(),
  }),
  z.object({
    columnId: ColumnIdSchema,
    type: z.literal('number'),
    operator: z.literal('range'),
    value: z.array(z.number()).length(2),
  }),
]);

const DateFilterConditionSchema = z.discriminatedUnion('operator', [
  z.object({
    columnId: ColumnIdSchema,
    type: z.literal('date'),
    operator: z.enum(['before', 'after', 'on']),
    value: z.string(),
  }),
  z.object({
    columnId: ColumnIdSchema,
    type: z.literal('date'),
    operator: z.literal('range'),
    value: z.array(z.string()).length(2),
  }),
]);

export const FilterConditionSchema = z.union([
  TextFilterConditionSchema,
  NumberFilterConditionSchema,
  DateFilterConditionSchema,
]);

export const SortConfigSchema = z.object({
  columnId: z.string().regex(/^[A-Z]+$/),
  direction: z.enum(['asc', 'desc']),
});

export const ChartTypeEnum = z.enum(['line', 'bar', 'pie', 'area', 'scatter', 'treemap']);
export const PivotOpEnum = z.enum(['SUM', 'COUNT', 'AVG', 'MIN', 'MAX']);
export const TimeGranularityEnum = z.enum(['day', 'week', 'month', 'quarter', 'year']);

const PivotValueSchema = z
  .object({
    column: ColumnIdSchema.optional(),
    operation: PivotOpEnum,
    label: z.string().min(1).max(80).optional(),
    conditions: z.array(FilterConditionSchema).optional(),
    countRows: z.boolean().optional(),
  })
  .refine(
    value => value.operation === 'COUNT' ? true : !!value.column,
    {
      message: 'column is required unless operation="COUNT"',
    }
  );

// ── Tool definitions ────────────────────────────────────────────────────────

export const toolDefs = {
  listSheets: {
    description:
      'List all sheets on the canvas with id, title, dimensions, compact columnIdSpan (for example A:BB), row-numbering convention, and column headers. Column ids like A, AU, or BB are spreadsheet column letters and may be used directly in tool inputs.',
    inputSchema: z.object({}),
  },

  describeSheet: {
    description:
      'Return the schema and a small sample of a sheet: compact columnIdSpan (for example A:BB), column ids/letters, header cells, data ranges, column headers, inferred types, row count, row-numbering convention, current filters and sort, and up to 5 sample rows with row numbers. If the user named specific column letters such as AU or BB, pass them in columnIds so they are echoed in requestedColumns even on wide sheets.',
    inputSchema: z.object({ sheetId: z.string(), columnIds: z.array(ColumnIdSchema).optional() }),
  },

  getSelection: {
    description:
      'Return what the user currently has selected. Includes the active sheet cell/range selection plus selectedCanvas.items for whole selected sheets, charts, and notes. Use first for requests like "this data", "selected chart", "current sheet", or "what I selected" before deciding which sheet/chart to inspect or mutate.',
    inputSchema: z.object({}),
  },

  getRange: {
    description: 'Read the raw and computed values of a specific A1 range on a sheet.',
    inputSchema: z.object({ sheetId: z.string(), range: A1RangeSchema }),
  },

  querySheet: {
    description:
      'Run a read-only SQL SELECT against a sheet. The sheet is exposed as table "t" with columns named exactly as returned in schema.sqlName; always inspect the returned schema because names are sanitized from headers and may be compact like hostname or sessionsource. Use this to explore, validate, filter, or preview aggregates before writing. Results are temporary and cannot be charted directly; when the user wants an aggregated chart from an existing sheet, prefer creating a persistent summary with createPivot and then call createChart on that pivot. Only SELECT is allowed.',
    inputSchema: z.object({
      sheetId: z.string(),
      sql: z.string().min(6, 'SQL too short'),
      limit: z.number().int().min(1).max(1000).optional(),
    }),
  },

  setCells: {
    description:
      'Write cells on a sheet. Pass A1-keyed map of { raw } values. Use "=FORMULA(...)" for formulas. Will overwrite existing cells.',
    inputSchema: z.object({
      sheetId: z.string(),
      cells: z.record(
        z.string().regex(/^[A-Z]+\d+$/),
        z.object({ raw: z.string() })
      ),
    }),
  },

  applyFilter: {
    description: 'Replace filters on a sheet. Pass an empty array to clear filters.',
    inputSchema: z.object({
      sheetId: z.string(),
      filters: z.array(FilterConditionSchema),
    }),
  },

  applySort: {
    description: 'Set or clear the sort on a sheet. Pass null to clear.',
    inputSchema: z.object({
      sheetId: z.string(),
      sort: SortConfigSchema.nullable(),
    }),
  },

  applyFormat: {
    description: 'Apply a cell format (number/currency/percent/date/text) to every cell in an A1 range.',
    inputSchema: z.object({
      sheetId: z.string(),
      range: A1RangeSchema,
      format: CellFormatSchema,
    }),
  },

  createChart: {
    description:
      'Create a chart from a persistent source sheet. For the cleanest visual answer to a simple grouped question, use mode:"group" with groupCol, valueCol, optional seriesGroupCol, and operation so the chart aggregates directly like the chart button. For complex multi-step logic, reusable summaries, conditional metrics, or cases where the user needs an inspectable analytical trail, createPivot first and chart the pivot. In metrics mode, labelColumn is the X-axis column and dataColumns are Y series columns. For time-series charts, provide the intended timeRange and timeGranularity when needed; if the user did not specify them and no safe default was requested, ask before charting. Duplicate labels on line/area/scatter metrics charts usually mean the source grain is too detailed; use group mode, create a pivot/summary, or explicitly allow duplicate labels. Prefer chart inputs whose series headers are human-readable; the renderer will compact noisy source names, but the first view should optimize for immediate insight over raw implementation labels.',
    inputSchema: z.object({
      sheetId: z.string(),
      type: ChartTypeEnum,
      mode: z
        .enum(['metrics', 'group'])
        .optional()
        .describe('Use group for chart-only aggregation over row-level data; metrics charts already-aggregated columns directly.'),
      labelColumn: z.string().regex(/^[A-Z]+$/),
      dataColumns: z.array(z.string().regex(/^[A-Z]+$/)).min(1),
      groupCol: z
        .string()
        .regex(/^[A-Z]+$/)
        .optional()
        .describe('For mode:"group", the X-axis grouping column. Usually the same as labelColumn for compatibility.'),
      seriesGroupCol: z
        .string()
        .regex(/^[A-Z]+$/)
        .optional()
        .describe('For mode:"group", optional column that splits the aggregate into series.'),
      valueCol: z
        .string()
        .regex(/^[A-Z]+$/)
        .optional()
        .describe('For mode:"group", the numeric value column to aggregate. Usually the first dataColumns entry for compatibility.'),
      operation: PivotOpEnum.optional().describe('For mode:"group", how to aggregate valueCol values in the chart.'),
      title: z.string().optional(),
      timeRange: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe('Required for time-series charts. Examples: "2026-05-01 to 2026-06-11", "last 30 days", or "full available range".'),
      timeGranularity: TimeGranularityEnum.optional().describe('Required for time-series charts when the label column is date-like.'),
      aggregation: PivotOpEnum.optional().describe('The analysis aggregation represented by this chart, such as SUM or COUNT. Use operation for chart-only group mode.'),
      sourceGrain: z
        .enum(['raw_rows', 'already_aggregated', 'pivot_summary', 'unknown'])
        .optional()
        .describe('Declare whether the source sheet already matches the chart grain, or raw_rows when mode:"group" will aggregate directly.'),
      allowDuplicateLabels: z
        .boolean()
        .optional()
        .describe('Only set true when the user explicitly wants multiple plotted rows with the same label in metrics mode. Otherwise use group mode or create a pivot/summary first.'),
      analysisNotes: z
        .string()
        .min(1)
        .max(300)
        .optional()
        .describe('Briefly state the chart grain/assumption when using an explicit default or override.'),
    }),
  },

  createPivot: {
    description:
      'Create a pivot-table sheet derived from a source sheet. The new sheet recomputes automatically when the source changes. `rowLabelCol` is the row-grouping column letter; `colLabelCol` (optional) splits into columns for a true 2-D pivot; `values` is one or more metric cards. Each metric supports operation, optional label, optional row-count semantics for COUNT, and optional AND-only conditions for SUMIF/COUNTIF-style metrics. As a data-analysis best practice, prefer this when the user wants a chartable aggregation from row-level sheet data: build the persistent pivot first, then call createChart on the pivot. For exploration or validation where no persistent output is needed, querySheet is fine.',
    inputSchema: z.object({
      sheetId: z.string(),
      rowLabelCol: z.string().regex(/^[A-Z]+$/),
      colLabelCol: z.string().regex(/^[A-Z]+$/).optional(),
      values: z
        .array(PivotValueSchema)
        .min(1),
      showRowTotals: z.boolean().optional(),
      showColTotals: z.boolean().optional(),
      title: z.string().optional(),
    }),
  },

  createSparkline: {
    description:
      'Create a sparkline-table sheet derived from a source sheet — each row is one metric/group and shows a mini trend line over `dateCol`. `mode:"metrics"` charts each of `dataCols` as its own row; `mode:"group"` pivots `groupCol` into rows and aggregates `valueCol` with `operation`. `compareMode` controls the delta column (default `vs_avg`). For an in-cell sparkline decoration on an existing column instead, use `applyFormat` with `visual:"sparkline"`.',
    inputSchema: z
      .object({
        sheetId: z.string(),
        dateCol: z.string().regex(/^[A-Z]+$/),
        mode: z.enum(['metrics', 'group']),
        compareMode: z.enum(['vs_prev', 'vs_avg', 'vs_first']).optional(),
        dataCols: z.array(z.string().regex(/^[A-Z]+$/)).optional(),
        groupCol: z.string().regex(/^[A-Z]+$/).optional(),
        valueCol: z.string().regex(/^[A-Z]+$/).optional(),
        operation: PivotOpEnum.optional(),
        title: z.string().optional(),
      })
      .refine(
        (v) =>
          v.mode === 'metrics'
            ? Array.isArray(v.dataCols) && v.dataCols.length > 0
            : !!v.groupCol && !!v.valueCol && !!v.operation,
        {
          message:
            'mode="metrics" requires dataCols; mode="group" requires groupCol, valueCol, and operation',
        }
      ),
  },
  listConnections: {
    description:
      'List all configured data connections (ClickHouse, Google Analytics, Google Sheets). Returns connectionId, type, name, duplicate-name hints, best-effort health, GA property hints, sheets using each connection, plus selectedCanvas context. Call first before querying external data.',
    inputSchema: z.object({}),
  },

  listConnectionProperties: {
    description:
      'List selectable properties/resources for one data connection. Google Analytics returns a bounded properties[] page with propertyId, displayName, accountDisplayName, nextPageToken, truncated. Call after choosing a GA connection and before describeConnection.',
    inputSchema: z.object({
      connectionId: z.string().min(1),
      pageToken: z.string().min(1).optional(),
      pageSize: z.number().int().min(1).max(50).optional(),
    }),
  },

  describeConnection: {
    description:
      'Describe a data connection and return a schemaToken required by createQuerySheet. ClickHouse without table returns tables[] only; with table returns columns[] and schemaToken. Google Analytics requires propertyId and returns a bounded dimensions[]/metrics[] catalog. Google Sheets returns read-only URL/ID and range requirements.',
    inputSchema: z.object({
      connectionId: z.string().min(1),
      table: z.string().min(1).optional(),
      propertyId: z.string().min(1).optional(),
      search: z.string().min(1).max(80).optional(),
      limit: z.number().int().min(1).max(50).optional(),
      includeDescriptions: z.boolean().optional(),
    }),
  },

  createQuerySheet: {
    description:
      'Create a new sheet by querying a previously described data connection. Pass schemaToken from describeConnection. ClickHouse: provide sql using the real database-qualified table name from describeConnection, not the in-app sheet alias "t". Google Analytics: provide propertyId and report. Google Sheets: provide spreadsheetIdOrUrl and optional A1 range. Always provide derivation. Returns sheetId + headers for immediate createChart use.',
    inputSchema: z.object({
      connectionId: z.string().min(1),
      schemaToken: z.string().min(8),
      type: z.enum(['clickhouse', 'google-analytics', 'google-sheets']),
      sql: z.string().min(1).optional(),
      propertyId: z.string().min(1).optional(),
      report: z.record(z.string(), z.unknown()).optional(),
      spreadsheetIdOrUrl: z.string().min(1).optional(),
      range: z.string().min(1).optional(),
      derivation: z.string().min(1),
      title: z.string().optional(),
    }),
  },

  createGaTrendBySource: {
    description:
      'Create a Google Analytics daily trend-by-source workflow in one step: queries date + hostName + source + medium + metric, creates the raw connected sheet, then creates a grouped sparkline trend table by source. Requires a schemaToken from describeConnection for the same GA connection/property. If the report returns no rows, no sheet is created and the response includes diagnostics such as propertyId, date range, host filter, and best-effort top hostnames.',
    inputSchema: z.object({
      connectionId: z.string().min(1),
      schemaToken: z.string().min(8),
      propertyId: z.string().min(1),
      startDate: z.string().min(1).max(40).describe('GA date such as "30daysAgo" or "2026-05-14".'),
      endDate: z.string().min(1).max(40).describe('GA date such as "today" or "2026-06-13".'),
      hostName: z.string().min(1).max(160).optional(),
      sourceDimension: z.enum(['sessionSource', 'firstUserSource']).optional(),
      metric: z.enum(['sessions', 'activeUsers', 'totalUsers', 'newUsers', 'screenPageViews', 'eventCount']).optional(),
      title: z.string().min(1).max(120).optional(),
    }),
  },
} as const;

export type ToolName = keyof typeof toolDefs;

export const TOOL_NAMES = Object.keys(toolDefs) as ToolName[];
