import { z } from 'zod';

export const A1RangeSchema = z
  .string()
  .regex(/^[A-Z]+\d+(:[A-Z]+\d+)?$/, 'Range must be A1 notation like "A1" or "A1:B10"');

// Shared optional visual decoration usable on any format type. `sparkline`
// renders an in-cell mini line chart over the column's numeric values;
// `bar`/`bar-row` render value-proportional bars; `heatmap`/`heatmap-row`
// shade the cell background. `heatmapColor` only applies to heatmap visuals:
// single hues ('red'|'green'|'yellow') shade by rank; 'diverging' is sign-aware
// (zero neutral, negatives red, positives green, each side scaled independently).
// `heatmapFlip` swaps the diverging polarity (green negative / red positive) for
// metrics where lower is better; it only applies when heatmapColor is 'diverging'.
const CellVisualEnum = z.enum(['bar', 'bar-row', 'heatmap', 'heatmap-row', 'sparkline']);
const HeatmapColorEnum = z.enum(['red', 'green', 'yellow', 'diverging']);
const FormatPresetEnum = z.enum([
  'integer',
  'decimal',
  'compactNumber',
  'currency',
  'compactCurrency',
  'percent',
  'date',
  'datetime',
  'duration',
  'text',
  'customD3',
]);

export const CellFormatSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('number'),
    decimals: z.number().int().min(0).max(10).optional(),
    d3Format: z.string().min(1).max(40).optional(),
    visual: CellVisualEnum.optional(),
    heatmapColor: HeatmapColorEnum.optional(),
    heatmapFlip: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('currency'),
    symbol: z.string().max(4).optional(),
    decimals: z.number().int().min(0).max(10).optional(),
    d3Format: z.string().min(1).max(40).optional(),
    visual: CellVisualEnum.optional(),
    heatmapColor: HeatmapColorEnum.optional(),
    heatmapFlip: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('percent'),
    decimals: z.number().int().min(0).max(10).optional(),
    d3Format: z.string().min(1).max(40).optional(),
    visual: CellVisualEnum.optional(),
    heatmapColor: HeatmapColorEnum.optional(),
    heatmapFlip: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('date'),
    dateFormat: z.string().max(40).optional(),
    visual: CellVisualEnum.optional(),
    heatmapColor: HeatmapColorEnum.optional(),
    heatmapFlip: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('text'),
    visual: CellVisualEnum.optional(),
    heatmapColor: HeatmapColorEnum.optional(),
    heatmapFlip: z.boolean().optional(),
  }),
]);

const FormatPresetSchema = z
  .object({
    preset: FormatPresetEnum,
    decimals: z.number().int().min(0).max(10).optional(),
    symbol: z.string().max(4).optional(),
    d3Format: z.string().min(1).max(40).optional(),
    dateFormat: z.string().max(40).optional(),
    visual: CellVisualEnum.optional(),
    heatmapColor: HeatmapColorEnum.optional(),
    heatmapFlip: z.boolean().optional(),
  })
  .refine(value => value.preset !== 'customD3' || !!value.d3Format, {
    message: 'customD3 preset requires d3Format',
    path: ['d3Format'],
  });

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

const QueryBriefSchema = z.object({
  logic: z
    .string()
    .min(1)
    .max(500)
    .describe('Plain-English summary of the query logic. Do not paste raw rows or long SQL.'),
  scope: z
    .array(z.string().min(1).max(180))
    .min(1)
    .max(6)
    .describe('Important scope boundaries such as time range, included segments, excluded filters, limits, or sampling.'),
  sources: z
    .array(z.string().min(1).max(160))
    .min(1)
    .max(6)
    .describe('Data source names, table names, GA property, or spreadsheet/range names used. Keep these concise.'),
  judgmentNotes: z
    .array(z.string().min(1).max(220))
    .min(1)
    .max(6)
    .describe('The most important caveats that affect user judgment, especially exclusions or ambiguous definitions.'),
});

// ── Tool definitions ────────────────────────────────────────────────────────

export const toolDefs = {
  listSheets: {
    description:
      'Use this first to discover what is on the canvas: lists all sheets with id, title, dimensions, compact columnIdSpan (for example A:BB), row-numbering convention, and column headers. Column ids like A, AU, or BB are spreadsheet column letters and may be used directly in tool inputs.',
    inputSchema: z.object({}),
  },

  describeSheet: {
    description:
      'Use this to inspect one sheet before querying or mutating it. Returns the schema and a small sample: compact columnIdSpan (for example A:BB), column ids/letters, header cells, data ranges, column headers, inferred types, row count, row-numbering convention, current filters and sort, and up to 5 sample rows with row numbers. If the user named specific column letters such as AU or BB, pass them in columnIds so they are echoed in requestedColumns even on wide sheets.',
    inputSchema: z.object({ sheetId: z.string(), columnIds: z.array(ColumnIdSchema).optional() }),
  },

  getSelection: {
    description:
      'Use this first for requests like "this data", "selected chart", "current sheet", or "what I selected", before deciding which sheet/chart to inspect or mutate. Returns what the user currently has selected: the active sheet cell/range selection plus selectedCanvas.items for whole selected sheets, charts, and notes.',
    inputSchema: z.object({}),
  },

  getRange: {
    description: 'Read the raw and computed values of a specific A1 range on a sheet.',
    inputSchema: z.object({ sheetId: z.string(), range: A1RangeSchema }),
  },

  querySheet: {
    description:
      'Use this to explore, validate, filter, or preview aggregates on an existing sheet before writing anything — it runs a read-only SQL SELECT against the sheet. Results are temporary and cannot be charted directly; when the user wants an aggregated chart from an existing sheet, prefer creating a persistent summary with createPivot and then call createChart on that pivot. The sheet is exposed as table "t" with columns named exactly as returned in schema.sqlName; always inspect the returned schema because names are sanitized from headers and may be compact like hostname or sessionsource. Only SELECT is allowed.',
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

  createSheet: {
    description:
      'Use this to create a NEW standalone sheet on the canvas for manual, scratch, or agent-computed data — for example a small table you assembled yourself, a template for the user to fill in, or a summary you derived from earlier steps. Optionally pass `data` as an array of rows (row 1 is treated as the header row by convention); each cell is a raw string, so "=FORMULA(...)" works exactly like typing into a cell. Omit `data` to create a blank grid the user can fill in. IMPORTANT: a sheet created this way has NO data source and does NOT auto-refresh. For anything coming from a connector or external source (ClickHouse, Google Analytics, Google Sheets) use createQuerySheet instead, so the sheet keeps its query, lineage, and refreshability — never query externally and paste the results in here. Returns sheetId plus dimensions so you can immediately createChart, createPivot, applyFormat, or setCells on it.',
    inputSchema: z.object({
      title: z.string().min(1).max(120).optional(),
      data: z
        .array(z.array(z.string()).max(256, 'A row may have at most 256 columns'))
        .max(5000, 'A sheet may have at most 5000 rows')
        .optional()
        .describe(
          'Rows of raw cell strings; row 1 is the header row by convention. Each cell may be a literal value or an "=FORMULA(...)". Omit to create a blank sheet.'
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
    description:
      'Use this when cells should be presented differently (units, decimals, dates, in-cell visuals) without changing their values — it applies presentation formatting to every cell in an A1 range. Works on normal sheets and derived pivot/sparkline sheets; derived sheets persist output-format overrides so refreshes keep the presentation. Prefer first-class presets (integer, decimal, compactNumber, currency, compactCurrency, percent, date, datetime, duration, text) and use customD3 only when a named preset is not expressive enough. For meaningful numeric metrics, consider visual:"bar": use bars for a single primary metric and only main comparison metrics in multi-metric outputs; avoid bars for IDs, dates, labels, tiny flags, and secondary support metrics. For metrics that swing above and below zero (variance, deltas, profit/loss, MoM change), prefer visual:"heatmap" with heatmapColor:"diverging" so negatives shade red and positives green from a zero midpoint; set heatmapFlip:true when lower is better (cost, churn) to swap the colors. Returns formatDecisions explaining what was formatted and why.',
    inputSchema: z
      .object({
        sheetId: z.string(),
        range: A1RangeSchema,
        format: CellFormatSchema.optional(),
        preset: FormatPresetSchema.optional(),
        reason: z.string().min(1).max(160).optional(),
      })
      .refine(value => !!value.format || !!value.preset, {
        message: 'Pass either format or preset',
      })
      .refine(value => !(value.format && value.preset), {
        message: 'Pass format or preset, not both',
      }),
  },

  createChart: {
    description:
      'Use this when the user wants a chart — it creates one from a persistent source sheet. Choosing a mode: for the cleanest visual answer to a simple grouped question, use mode:"group" with groupCol, valueCol, optional seriesGroupCol, and operation so the chart aggregates directly like the chart button; for complex multi-step logic, reusable summaries, conditional metrics, or cases where the user needs an inspectable analytical trail, createPivot first and chart the pivot. In metrics mode, labelColumn is the X-axis column and dataColumns are Y series columns. Guardrails: for time-series charts, provide the intended timeRange and timeGranularity when needed — if the user did not specify them and no safe default was requested, ask before charting. Duplicate labels on line/area/scatter metrics charts usually mean the source grain is too detailed; use group mode, create a pivot/summary, or explicitly allow duplicate labels. Prefer chart inputs whose series headers are human-readable; the renderer will compact noisy source names, but the first view should optimize for immediate insight over raw implementation labels.',
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
      'Use this when the user wants a chartable aggregation or reusable summary from row-level sheet data — as a data-analysis best practice, build the persistent pivot first, then call createChart on the pivot. (For exploration or validation where no persistent output is needed, querySheet is fine.) Creates a pivot-table sheet derived from a source sheet; the new sheet recomputes automatically when the source changes. `rowLabelCol` is the row-grouping column letter; `colLabelCol` (optional) splits into columns for a true 2-D pivot; `values` is one or more metric cards. Each metric supports operation, optional label, optional row-count semantics for COUNT, and optional AND-only conditions for SUMIF/COUNTIF-style metrics.',
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
      'Use this when the user wants a compact trend overview as its own table — it creates a sparkline-table sheet derived from a source sheet, where each row is one metric/group and shows a mini trend line over `dateCol`. (For an in-cell sparkline decoration on an existing column instead, use `applyFormat` with `visual:"sparkline"`.) `mode:"metrics"` charts each of `dataCols` as its own row; `mode:"group"` pivots `groupCol` into rows and aggregates `valueCol` with `operation`. `compareMode` controls the delta column (default `vs_avg`).',
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
  createNote: {
    description:
      'Use this to deliver a formatted analytical write-up — narrative + live numbers + charts — as one editable object. Creates a live report note on the canvas: Markdown text with optional inline, data-bound components that stay current as the underlying sheets change.\n\n' +
      "Pass `content` as Markdown. Standard Markdown works (headings, **bold**, lists, tables, links). You may embed exactly these THREE live components as self-closing tags; no user code ever runs and any other component-like tag renders as inert text:\n" +
      '- <CellValue sheet="SHEET_ID" cell="B4" format="currency"/> — one live value from a cell. `format` is optional, one of: currency | percent | number | date | text (defaults to the cell\'s own format).\n' +
      '- <CanvasChart id="CHART_ID" height="240"/> — renders an existing canvas chart inline (create it first with createChart).\n' +
      '- <Sparkline sheet="SHEET_ID" range="B2:B12"/> — a tiny inline trend line over a range.\n\n' +
      'CRITICAL: SHEET_ID and CHART_ID must be real ids returned by earlier tool calls (createQuerySheet/createPivot/createSparkline return a sheet id; createChart returns a chart id) or discovered via listSheets/describeSheet. Never invent ids — a wrong id renders as an inert "not found" marker. Reference cells/ranges by their A1 address within the named sheet (there is no cross-sheet address syntax).',
    inputSchema: z.object({
      content: z
        .string()
        .min(1)
        .describe('Markdown body of the note, optionally embedding <CellValue>, <CanvasChart>, and <Sparkline> tags.'),
      title: z
        .string()
        .max(120)
        .optional()
        .describe('Optional short title, added as an H1 heading if the content does not already start with a heading.'),
      color: z
        .enum(['yellow', 'blue', 'green', 'pink', 'purple', 'gray'])
        .optional()
        .describe('Note background color. Defaults to yellow.'),
    }),
  },

  listNotes: {
    description:
      'Use this to discover note ids before reading or updating a note — it lists all report notes currently on the canvas. Returns each note\'s noteId, a derived title (first heading/line), a short text preview, color, and format. Returns an empty list if there are no notes.',
    inputSchema: z.object({}),
  },

  readNote: {
    description:
      'Use this before updateNote so you edit against the real current text rather than guessing — it reads one report note by id. Returns its full raw Markdown source (`content`, exactly as stored — including any <CellValue>/<CanvasChart>/<Sparkline> tags), plus color and format. Errors if the noteId does not exist (get ids from listNotes or a prior createNote).',
    inputSchema: z.object({
      noteId: z.string().min(1).describe('Id of the note to read, as returned by createNote or listNotes.'),
    }),
  },

  updateNote: {
    description:
      'Use this to revise wording, add/remove a section, or swap a chart in a note you already created — it updates an existing report note in place. Provide `noteId` plus at least one of `content` or `color`. `content` REPLACES the entire Markdown body (read the note first with readNote, edit the whole text, then send it back — there is no append/patch mode). The same three live components are supported: <CellValue>, <CanvasChart>, <Sparkline>; unknown ids render inert. Errors if the noteId does not exist.',
    inputSchema: z
      .object({
        noteId: z.string().min(1).describe('Id of the note to update.'),
        content: z
          .string()
          .min(1)
          .optional()
          .describe('New full Markdown body. Replaces the existing content entirely.'),
        color: z
          .enum(['yellow', 'blue', 'green', 'pink', 'purple', 'gray'])
          .optional()
          .describe('New note background color.'),
      })
      .refine((v) => v.content !== undefined || v.color !== undefined, {
        message: 'Provide at least one of content or color to update.',
      }),
  },

  deleteNote: {
    description:
      'Permanently delete a report note from the canvas by id. This is destructive and cannot be undone by the agent (the user can still undo in-app). Only delete a note you created or the user explicitly asked to remove. Errors if the noteId does not exist.',
    inputSchema: z.object({
      noteId: z.string().min(1).describe('Id of the note to delete.'),
    }),
  },

  listConnections: {
    description:
      'Use this first before querying external data — it lists all configured data connections (ClickHouse, Google Analytics, Google Sheets). Returns connectionId, type, name, duplicate-name hints, best-effort health, GA property hints, sheets using each connection, plus selectedCanvas context.',
    inputSchema: z.object({}),
  },

  listConnectionProperties: {
    description:
      'Use this after choosing a GA connection and before describeConnection — it lists selectable properties/resources for one data connection. Google Analytics returns a bounded properties[] page with propertyId, displayName, accountDisplayName, nextPageToken, truncated.',
    inputSchema: z.object({
      connectionId: z.string().min(1),
      pageToken: z.string().min(1).optional(),
      pageSize: z.number().int().min(1).max(50).optional(),
    }),
  },

  describeConnection: {
    description:
      'Use this before building any connector query — it describes a data connection and returns the schemaToken required by queryConnection or createQuerySheet, plus a queryShape describing the exact queryPayload to build (payloadSchema, requiredFields, worked examples). ClickHouse without table returns tables[] only; with table returns columns[] and schemaToken. Google Analytics requires propertyId and returns a bounded dimensions[]/metrics[] catalog. Google Sheets returns read-only URL/ID and range requirements. Always read queryShape before constructing queryPayload.',
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
      'Use this only when a connector query result should be shown to the user, inspected as a table, or used as visible lineage for charts/derived tables — it creates a visible sheet by querying a previously described data connection. For private exploration or answer-only analytics, prefer queryConnection first. Pass schemaToken from describeConnection. The connector-specific query goes in queryPayload, whose exact shape, required fields, and worked examples come from describeConnection\'s queryShape — build the payload to match it rather than guessing. Always provide derivation and a structured brief that summarizes query logic, data scope, sources/tables, and judgment caveats without raw data. Returns sheetId + headers for immediate createChart use.',
    inputSchema: z.object({
      connectionId: z.string().min(1),
      schemaToken: z.string().min(8),
      type: z.enum(['clickhouse', 'google-analytics', 'google-sheets']),
      queryPayload: z
        .record(z.string(), z.unknown())
        .describe('Connector-owned query payload. Build it to match the queryShape returned by describeConnection (payloadSchema + examples) for this connector type.'),
      derivation: z.string().min(1),
      brief: QueryBriefSchema,
      title: z.string().optional(),
    }),
  },

  queryConnection: {
    description:
      'Use this for exploration, validation, follow-up calculations, and answer-only analytics — it runs a connector query privately for agent analysis without creating a visible sheet, chart, or derived table. Pass schemaToken from describeConnection and a queryPayload that matches queryShape. Always provide derivation and a structured brief. Returns resultId, headers, sampleRows, inferredTypes, and rowCount. Hidden results are not valid chart/table lineage; if the result should become user-visible or feed a visible chart/table, call createQuerySheetFromResult.',
    inputSchema: z.object({
      connectionId: z.string().min(1),
      schemaToken: z.string().min(8),
      type: z.enum(['clickhouse', 'google-analytics', 'google-sheets']),
      queryPayload: z
        .record(z.string(), z.unknown())
        .describe('Connector-owned query payload. Build it to match the queryShape returned by describeConnection (payloadSchema + examples) for this connector type.'),
      derivation: z.string().min(1),
      brief: QueryBriefSchema,
      title: z.string().optional(),
    }),
  },

  createQuerySheetFromResult: {
    description:
      'Use this when hidden analysis should become a user-visible table or needs visible sheet lineage before creating a chart or derived table — it creates a visible connector sheet from a previous private queryConnection result. Use resultId from the queryConnection response or from context.privateQueryResults. Does not re-query the connector; it materializes the stored private result as a normal connector sheet.',
    inputSchema: z.object({
      resultId: z.string().min(1),
      title: z.string().optional(),
    }),
  },

  updateQuerySheet: {
    description:
      'Use this when the user asks to edit, revise, or add columns to the query of a selected/current query sheet instead of creating a replacement sheet — it updates an existing connector query sheet in place and refreshes its data while preserving the sheetId. The connector type is inferred from the sheet; pass the full replacement query in queryPayload plus a fresh structured brief for the new logic/scope/sources/judgment caveats. Use describeConnection\'s queryShape for the exact payload shape and examples for that connector type (ClickHouse, Google Analytics, or Google Sheets). On query errors, the old cells are preserved and the sheet records lastError.',
    inputSchema: z.object({
      sheetId: z.string().min(1),
      queryPayload: z
        .record(z.string(), z.unknown())
        .describe('Full replacement query matching the sheet connector type. Build it to match describeConnection\'s queryShape (payloadSchema + examples) for that type.'),
      derivation: z.string().min(1).optional(),
      brief: QueryBriefSchema,
      title: z.string().optional(),
    }),
  },

  createGaTrendBySource: {
    description:
      'Use this when the user wants a Google Analytics daily trend-by-source overview — it runs the whole workflow in one step: queries date + hostName + source + medium + metric, creates the raw connected sheet, then creates a grouped sparkline trend table by source. Requires a schemaToken from describeConnection for the same GA connection/property and a structured brief for the raw connected sheet. If the report returns no rows, no sheet is created and the response includes diagnostics such as propertyId, date range, host filter, and best-effort top hostnames.',
    inputSchema: z.object({
      connectionId: z.string().min(1),
      schemaToken: z.string().min(8),
      propertyId: z.string().min(1),
      startDate: z.string().min(1).max(40).describe('GA date such as "30daysAgo" or "2026-05-14".'),
      endDate: z.string().min(1).max(40).describe('GA date such as "today" or "2026-06-13".'),
      hostName: z.string().min(1).max(160).optional(),
      sourceDimension: z.enum(['sessionSource', 'firstUserSource']).optional(),
      metric: z.enum(['sessions', 'activeUsers', 'totalUsers', 'newUsers', 'screenPageViews', 'eventCount']).optional(),
      brief: QueryBriefSchema,
      title: z.string().min(1).max(120).optional(),
    }),
  },
} as const;

export type ToolName = keyof typeof toolDefs;

export const TOOL_NAMES = Object.keys(toolDefs) as ToolName[];
