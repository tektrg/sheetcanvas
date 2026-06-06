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

export const FilterConditionSchema = z.discriminatedUnion('type', [
  z.object({
    columnId: ColumnIdSchema,
    type: z.literal('text'),
    operator: z.enum(['contains', 'equals', 'startsWith', 'endsWith']),
    value: z.string(),
  }),
  z.object({
    columnId: ColumnIdSchema,
    type: z.literal('number'),
    operator: z.enum(['gt', 'lt', 'eq', 'neq', 'range']),
    // For 'range': pass [min, max] as a 2-element array. For others: a 1-element array.
    value: z.array(z.number()).min(1).max(2),
  }),
  z.object({
    columnId: ColumnIdSchema,
    type: z.literal('date'),
    operator: z.enum(['before', 'after', 'on', 'range']),
    // ISO date strings. For 'range': [start, end]. For others: 1-element array.
    value: z.array(z.string()).min(1).max(2),
  }),
]);

export const SortConfigSchema = z.object({
  columnId: z.string().regex(/^[A-Z]+$/),
  direction: z.enum(['asc', 'desc']),
});

export const ChartTypeEnum = z.enum(['line', 'bar', 'pie', 'area', 'scatter', 'treemap']);
export const PivotOpEnum = z.enum(['SUM', 'COUNT', 'AVG', 'MIN', 'MAX']);

// ── Tool definitions ────────────────────────────────────────────────────────

export const toolDefs = {
  listSheets: {
    description:
      'List all sheets on the canvas with id, title, dimensions, and column headers. Call this first if you do not know what sheets exist.',
    inputSchema: z.object({}),
  },

  describeSheet: {
    description:
      'Return the schema and a small sample of a sheet: column headers, inferred types, row count, current filters and sort, and up to 5 sample rows.',
    inputSchema: z.object({ sheetId: z.string() }),
  },

  getSelection: {
    description: "Return what the user currently has selected (sheetId, cellId, range). Empty if nothing is selected.",
    inputSchema: z.object({}),
  },

  getRange: {
    description: 'Read the raw and computed values of a specific A1 range on a sheet.',
    inputSchema: z.object({ sheetId: z.string(), range: A1RangeSchema }),
  },

  querySheet: {
    description:
      'Run a read-only SQL SELECT against a sheet. The sheet is exposed as a table named "t" with columns named by header (sanitized to snake_case). Use this to filter, aggregate, or inspect data before writing. Only SELECT is allowed.',
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
      'Create a chart from a source sheet. labelColumn is the X-axis column letter; dataColumns is the array of Y series column letters.',
    inputSchema: z.object({
      sheetId: z.string(),
      type: ChartTypeEnum,
      labelColumn: z.string().regex(/^[A-Z]+$/),
      dataColumns: z.array(z.string().regex(/^[A-Z]+$/)).min(1),
      title: z.string().optional(),
    }),
  },

  createPivot: {
    description:
      'Create a pivot-table sheet derived from a source sheet. The new sheet recomputes automatically when the source changes. `rowLabelCol` is the row-grouping column letter; `colLabelCol` (optional) splits into columns for a true 2-D pivot; `values` is one or more aggregations (column + op). Use when the user wants a persistent, reactive tabular summary — for one-off aggregates prefer `querySheet`.',
    inputSchema: z.object({
      sheetId: z.string(),
      rowLabelCol: z.string().regex(/^[A-Z]+$/),
      colLabelCol: z.string().regex(/^[A-Z]+$/).optional(),
      values: z
        .array(
          z.object({
            column: z.string().regex(/^[A-Z]+$/),
            operation: PivotOpEnum,
          })
        )
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
      'List all configured data connections (ClickHouse, Google Analytics, Google Sheets). Returns connectionId, type, name. Call first before querying external data.',
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
      'Create a new sheet by querying a previously described data connection. Pass schemaToken from describeConnection. ClickHouse: provide sql. Google Analytics: provide propertyId and report. Google Sheets: provide spreadsheetIdOrUrl and optional A1 range. Always provide derivation. Returns sheetId + headers for immediate createChart use.',
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
} as const;

export type ToolName = keyof typeof toolDefs;

export const TOOL_NAMES = Object.keys(toolDefs) as ToolName[];
