import type { ToolName } from '../../../agent/tools';
import type { WebMcpAnnotations } from './modelContext';

// WebMCP tool copy, budgeted for a general-purpose model with no SheetCanvas
// system prompt and no priors about this app — unlike the descriptions in
// `agent/tools.ts`, which are written for the in-app Copilot (Gemini, with a
// long system prompt) and are read by three other consumers (the MCP server,
// the eval harness, and the Copilot itself). We deliberately do NOT edit
// `agent/tools.ts` here; this file is a second, shorter set of copy for the
// same 26 tools, kept in sync by the `Record<ToolName, ...>` type below (not
// `Partial` — adding a 27th tool to `toolDefs` makes this a compile error
// until it's covered here too).
//
// OpenAI enforces hard character budgets on WebMCP tools: name <=30, tool
// description <=500, per-parameter description <=150. Values below are
// hand-trimmed to fit; `webmcpDescriptors.ts` also truncates any input-schema
// description that slips through without an override.

export interface ShortToolCopy {
  /** Tool name exposed over WebMCP. <=30 chars, /^[A-Za-z0-9_.-]+$/. Omit to use the registry key. */
  name?: string;
  /** Shown in the agent's tool picker. <=64 chars. */
  title: string;
  /** <=500 chars, written for a model with no SheetCanvas priors. */
  description: string;
  /** Per-top-level-input-property override, keyed by property name. <=150 chars each. */
  params?: Record<string, string>;
}

export const SHORT_TOOL_COPY: Record<ToolName, ShortToolCopy> = {
  // ── Read-only discovery ─────────────────────────────────────────────────
  listSheets: {
    title: 'List Sheets',
    description:
      'Use this first to discover what is on the canvas: lists all sheets with id, title, dimensions, compact columnIdSpan (for example A:BB), row-numbering convention, and column headers. Column ids like A, AU, or BB are spreadsheet column letters and may be used directly in tool inputs.',
  },

  describeSheet: {
    title: 'Describe Sheet',
    description:
      'Use this to inspect one sheet before querying or mutating it. Returns the schema and a small sample: compact columnIdSpan (for example A:BB), column ids/letters, header cells, data ranges, column headers, inferred types, row count, row-numbering convention, current filters and sort, and up to 5 sample rows with row numbers. If the user named specific column letters such as AU or BB, pass them in columnIds so they are echoed in requestedColumns even on wide sheets.',
  },

  getSelection: {
    title: 'Get Current Selection',
    description:
      'Use this first for requests like "this data", "selected chart", "current sheet", or "what I selected", before deciding which sheet/chart to inspect or mutate. Returns what the user currently has selected: the active sheet cell/range selection plus selectedCanvas.items for whole selected sheets, charts, and notes.',
  },

  getRange: {
    title: 'Get Cell Range',
    description: 'Read the raw and computed values of a specific A1 range on a sheet.',
  },

  querySheet: {
    title: 'Query Sheet (Read-Only SQL)',
    description:
      'Runs a read-only SQL SELECT against one sheet for exploration, validation, filtering, or previewing aggregates before writing anything. Results are temporary, not chartable — to chart an aggregate, build a summary with createPivot first, then createChart on it. The sheet is table "t"; column names come from schema.sqlName (sanitized, e.g. hostname) — inspect schema first. For a trend, pull ~8+ periods; for a comparison, also pull the seasonality-correct baseline. Only SELECT is allowed.',
  },

  // ── Sheet mutation ───────────────────────────────────────────────────────
  setCells: {
    title: 'Set Cell Values',
    description:
      'Write cells on a sheet. Pass A1-keyed map of { raw } values. Use "=FORMULA(...)" for formulas. Will overwrite existing cells.',
  },

  createSheet: {
    title: 'Create Sheet',
    description:
      'Creates a new standalone sheet for manual, scratch, or agent-computed data (an assembled table, fill-in template, or derived summary). data is optional: rows of raw cell strings, row 1 is the header; a cell may be a literal or "=FORMULA(...)". Omit data for a blank grid. Has NO data source and does not auto-refresh — for connector data (ClickHouse, Google Analytics, Google Sheets) use createQuerySheet instead to keep lineage/refreshability. Returns sheetId and dimensions.',
    params: {
      data: 'Rows of raw cell strings; row 1 is the header. Each cell is a literal or "=FORMULA(...)". Omit for a blank sheet.',
    },
  },

  applyFilter: {
    title: 'Apply Sheet Filter',
    description: 'Replace filters on a sheet. Pass an empty array to clear filters.',
  },

  applySort: {
    title: 'Apply Sheet Sort',
    description: 'Set or clear the sort on a sheet. Pass null to clear.',
  },

  applyFormat: {
    title: 'Apply Cell Format',
    description:
      'Applies presentation formatting (units, decimals, dates, in-cell visuals) to an A1 range without changing values; works on normal and derived sheets. Pass exactly one of format or preset, not both. preset is a shortcut (integer, decimal, compactNumber, currency, compactCurrency, percent, date, datetime, duration, text, customD3); customD3 needs d3Format. Use visual:"bar" for a primary metric; use heatmapColor:"diverging" for values around zero, heatmapFlip:true when lower is better.',
  },

  // ── Charts and pivots ────────────────────────────────────────────────────
  createChart: {
    title: 'Create Chart',
    description:
      'Creates a chart from a source sheet; response includes formDecisions. mode:"group" aggregates row-level data via groupCol/valueCol/operation. mode:"metrics" charts aggregated columns: labelColumn is X-axis, dataColumns are Y series. Time-series charts need timeRange and timeGranularity. Duplicate X labels in metrics mode mean data is too granular — use mode:"group" or createPivot first. For "does X drive Y" use type:"scatter" (one point per entity), not dual-axis lines.',
    params: {
      seriesTypes:
        'Per-series chart type override keyed by dataColumns letter, e.g. {"B":"bar","C":"line"}. Metrics mode only. Omit to auto-select.',
      rightAxisColumns:
        'dataColumns letters plotted on a second Y-axis, e.g. a rate paired with volumes. Metrics mode only. Omit to auto-gate the dual axis.',
    },
  },

  createPivot: {
    title: 'Create Pivot Table',
    description:
      'Creates a pivot-table sheet derived from a source sheet; recomputes when the source changes. Use for chartable aggregation or a reusable summary from row-level data — build the pivot, then createChart on it (for one-off exploration with no persistent output, use querySheet instead). rowLabelCol groups rows; colLabelCol (optional) splits into columns for a 2-D pivot; values is one or more metric cards with operation, optional label, COUNT semantics, and AND-only SUMIF/COUNTIF conditions.',
  },

  createSparkline: {
    title: 'Create Sparkline KPI Table',
    description:
      'Creates a compact KPI table: one row per metric/group with a mini trend line over dateCol, a current value, and a Change cell colored by direction-of-good (green=better, red=worse). Good default for "overview" requests. mode:"metrics" charts each dataCols entry as a row (dataCols required). mode:"group" pivots groupCol into rows, aggregating valueCol with operation (all required). compareMode sets the delta column (default vs_avg). In-cell sparkline: use applyFormat visual:"sparkline".',
    params: {
      goodDirections:
        'Per-metric direction of good, keyed by label. "up"=higher better (revenue); "down"=lower better (cost, churn). Inferred if omitted.',
    },
  },

  // ── Notes ────────────────────────────────────────────────────────────────
  createNote: {
    title: 'Create Report Note',
    description:
      'Creates a live report note: Markdown that can embed data-bound components staying live as sheets change. Embed up to three self-closing tags — <CellValue sheet="ID" cell="B4" format="currency"/>, <CanvasChart id="ID" height="240"/>, <Sparkline sheet="ID" range="B2:B12"/>; any other tag renders as inert text. sheet/id values MUST be real ids from earlier results (createQuerySheet, createPivot, createChart) or listSheets/describeSheet — a wrong id shows "not found".',
    params: {
      content:
        'Markdown body; may embed <CellValue>, <CanvasChart>, <Sparkline> tags (see tool description for their exact attributes).',
    },
  },

  listNotes: {
    title: 'List Notes',
    description:
      "Use this to discover note ids before reading or updating a note — it lists all report notes currently on the canvas. Returns each note's noteId, a derived title (first heading/line), a short text preview, color, and format. Returns an empty list if there are no notes.",
  },

  readNote: {
    title: 'Read Note',
    description:
      'Use this before updateNote so you edit against the real current text rather than guessing — it reads one report note by id. Returns its full raw Markdown source (content, exactly as stored — including any <CellValue>/<CanvasChart>/<Sparkline> tags), plus color and format. Errors if the noteId does not exist (get ids from listNotes or a prior createNote).',
  },

  updateNote: {
    title: 'Update Note',
    description:
      'Updates an existing report note in place — revise wording, add/remove a section, or swap a chart. Requires noteId plus at least one of content or color. content REPLACES the entire Markdown body; there is no append/patch mode — read the note first with readNote, edit the full text, then send it back. Supports the same three live tags as createNote (<CellValue>, <CanvasChart>, <Sparkline>); unknown ids render inert. Errors if noteId does not exist.',
  },

  deleteNote: {
    title: 'Delete Note',
    description:
      'Permanently delete a report note from the canvas by id. This is destructive and cannot be undone by the agent (the user can still undo in-app). Only delete a note you created or the user explicitly asked to remove. Errors if the noteId does not exist.',
  },

  // ── Connectors ───────────────────────────────────────────────────────────
  listConnections: {
    title: 'List Data Connections',
    description:
      'Use this first before querying external data — it lists all configured data connections (ClickHouse, Google Analytics, Google Sheets). Returns connectionId, type, name, duplicate-name hints, best-effort health, GA property hints, sheets using each connection, plus selectedCanvas context.',
  },

  listConnectionProperties: {
    title: 'List Connection Properties',
    description:
      'Use this after choosing a GA connection and before describeConnection — it lists selectable properties/resources for one data connection. Google Analytics returns a bounded properties[] page with propertyId, displayName, accountDisplayName, nextPageToken, truncated.',
  },

  describeConnection: {
    title: 'Describe Data Connection',
    description:
      "Describes one data connection and returns the schemaToken needed by queryConnection/createQuerySheet/updateQuerySheet, plus a queryShape (payloadSchema, requiredFields, examples) for building queryPayload — read it before any connector query. ClickHouse without table returns tables[] only; with table returns columns[] and schemaToken. Google Analytics needs propertyId, returns a dimensions[]/metrics[] catalog. Google Sheets returns URL/ID and range requirements.",
  },

  createQuerySheet: {
    title: 'Create Query Sheet',
    description:
      "Creates a visible sheet by querying a described data connection — use only when the result should be shown, inspected as a table, or used as chart lineage. For private exploration use queryConnection instead. Requires schemaToken from describeConnection. queryPayload is connector-specific — match describeConnection's queryShape (payloadSchema, requiredFields, examples); do not guess it. Include derivation and a brief (logic, scope, sources) without raw data. Returns sheetId and headers.",
    params: {
      queryPayload:
        'Connector-specific query body. Must match the queryShape (payloadSchema + examples) returned by describeConnection for this connector.',
    },
  },

  queryConnection: {
    title: 'Query Connection (Private)',
    description:
      "Runs a query against a described data connection privately, for exploration, validation, follow-up math, or answer-only analytics — does NOT create a visible sheet, chart, or table. Requires schemaToken and a queryPayload matching describeConnection's queryShape, plus derivation and a brief. For a trend, request ~8+ periods; for a comparison, also fetch the seasonality baseline. Returns resultId, headers, sampleRows, rowCount. Use createQuerySheetFromResult to make it visible.",
    params: {
      queryPayload:
        'Connector-specific query body. Must match the queryShape (payloadSchema + examples) returned by describeConnection for this connector.',
    },
  },

  createQuerySheetFromResult: {
    title: 'Create Sheet From Query Result',
    description:
      'Use this when hidden analysis should become a user-visible table or needs visible sheet lineage before creating a chart or derived table — it creates a visible connector sheet from a previous private queryConnection result. Use resultId from the queryConnection response or from context.privateQueryResults. Does not re-query the connector; it materializes the stored private result as a normal connector sheet.',
  },

  updateQuerySheet: {
    title: 'Update Query Sheet',
    description:
      "Updates an existing connector query sheet in place, refreshing its data while preserving sheetId — use to edit or add columns to an existing query sheet instead of creating a new one. Connector type is inferred from the sheet; queryPayload is the FULL replacement query (not a diff), matching describeConnection's queryShape for that type. Include a fresh brief describing the new logic/scope/sources. On a query error, old cells are preserved and lastError is recorded.",
    params: {
      queryPayload:
        'Full replacement query (not a diff) matching describeConnection queryShape for this sheet connector type.',
    },
  },

  createGaTrendBySource: {
    title: 'Create GA Trend By Source',
    description:
      'Runs a full Google Analytics daily-trend-by-source workflow in one step: queries date + hostName + source + medium + one metric, creates the raw connected sheet, then a grouped sparkline trend table by source. Requires schemaToken from describeConnection for the same GA connection/property, plus a structured brief for the raw sheet. If the report returns no rows, no sheet is created and the response includes diagnostics (propertyId, date range, host filter, top hostnames) to adjust and retry.',
  },
};

// WebMCP has exactly two annotation hints: `readOnlyHint` and
// `untrustedContentHint`. There is no `destructiveHint` in the spec — do not
// add one.
//
// `readOnlyHint: true` — the tool makes no observable change to canvas state.
// `describeConnection` and `queryConnection` look read-only but are
// DELIBERATELY EXCLUDED: `describeConnection` mutates the store
// (`setConnectionSchemaToken`/`setGaMetadata`, see
// `src/agent/clientToolExecutor.ts:1025,1036-1038`) and `queryConnection`
// calls `store.addPrivateQueryResult` (`src/agent/querySheetTools.ts:216`).
// The next tool in the connector flow (queryConnection/createQuerySheet)
// depends on that mutation having happened, so a client that treats these as
// read-only and caches/dedupes/replays them would silently break the flow.
//
// `untrustedContentHint: true` — the tool's result can carry text authored by
// a user or a third-party warehouse (imported CSV values, typed cell/note
// content, or rows returned from ClickHouse/GA/Google Sheets) that could
// smuggle instructions ("ignore previous instructions...") into a model's
// context when the result is read back. Applies to every read tool plus the
// connector tools whose payload is warehouse-controlled data.
export const TOOL_ANNOTATIONS: Record<ToolName, WebMcpAnnotations> = {
  listSheets: { readOnlyHint: true, untrustedContentHint: true },
  describeSheet: { readOnlyHint: true, untrustedContentHint: true },
  getSelection: { readOnlyHint: true, untrustedContentHint: true },
  getRange: { readOnlyHint: true, untrustedContentHint: true },
  querySheet: { readOnlyHint: true, untrustedContentHint: true },
  setCells: {},
  createSheet: {},
  applyFilter: {},
  applySort: {},
  applyFormat: {},
  createChart: {},
  createPivot: {},
  createSparkline: {},
  createNote: {},
  listNotes: { readOnlyHint: true, untrustedContentHint: true },
  readNote: { readOnlyHint: true, untrustedContentHint: true },
  updateNote: {},
  deleteNote: {},
  listConnections: { readOnlyHint: true, untrustedContentHint: true },
  listConnectionProperties: { readOnlyHint: true, untrustedContentHint: true },
  // Mutates store state as a side effect — see comment above. Not read-only.
  describeConnection: { untrustedContentHint: true },
  createQuerySheet: { untrustedContentHint: true },
  // Mutates store state as a side effect (addPrivateQueryResult) — see comment above. Not read-only.
  queryConnection: { untrustedContentHint: true },
  createQuerySheetFromResult: { untrustedContentHint: true },
  updateQuerySheet: { untrustedContentHint: true },
  createGaTrendBySource: { untrustedContentHint: true },
};
