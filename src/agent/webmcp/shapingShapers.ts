// Per-tool shapers: the table of "which fields are the answer, which are
// bulk" knowledge for every WebMCP tool that needs shaping. Each tool's
// success and error shaper are kept adjacent in one SHAPERS[name] entry so
// they can't drift apart — see toolResultShaping.ts for how this table is
// used (Layer 1) and backstopped (Layer 2).
//
// Return shapes below were read from the actual tool implementations, not
// guessed: src/agent/clientToolExecutor.ts, src/agent/querySheetTools.ts,
// src/agent/gaMcpTools.ts.
import type { ToolName } from '../../../agent/tools';
import { getCellId } from '../../../utils/formulas';
import { getColumnIdForIndex } from '../sheetBounds';
import {
  capMessage,
  clipRowsToBudget,
  ERROR_MESSAGE_MAX_CHARS,
  omittedNote,
  parseRangeRef,
  pick,
  QUERY_DIAGNOSTICS_MAX_CHARS,
  ROW_BUDGET_RESERVE_CHARS,
  WEBMCP_OUTPUT_BUDGET,
} from './shapingHelpers';

// ── Per-tool caps ────────────────────────────────────────────────────────
// Static, generous-but-safe caps applied before the budget-aware backstop.
// Keeping them named/grouped (rather than inlined magic numbers) is what lets
// a future tuning pass find and adjust them without re-reading every shaper.
const DESCRIBE_SHEET_MAX_COLUMNS = 40;
const DESCRIBE_SHEET_SAMPLE_ROWS = 2;
const DESCRIBE_SHEET_SAMPLE_COLS = 12;
// requestedColumns is caller-bounded in COUNT (the model picked these
// letters) but not in SIZE: agent/tools.ts's columnIds has no `.max()`, so
// an agent can legally ask for 20+ columns at once. Cap it like every other
// bulk field here so a wide request can't blow the whole budget by itself.
const DESCRIBE_SHEET_MAX_REQUESTED_COLUMNS = 7;
const DESCRIBE_SHEET_REQUESTED_COLUMN_SAMPLES = 2;
const LIST_SHEETS_MAX_SHEETS = 20;
const LIST_SHEETS_HEADER_LINE_MAX = 200;
const CONNECTOR_SAMPLE_ROWS = 2;
const CONNECTOR_SAMPLE_COLS = 10;
const LIST_CONNECTIONS_PROPERTY_HINTS = 3;
const GET_SELECTION_MAX_ITEMS = 10;
const DESCRIBE_CONNECTION_MAX_DIMS = 20;
const DESCRIBE_CONNECTION_MAX_METRICS = 20;
// ClickHouse table/column counts aren't specced by name anywhere upstream;
// these are a defensive cap so a very wide warehouse table can't alone blow
// the budget. Not load-bearing like the GA dims/metrics caps.
const DESCRIBE_CONNECTION_MAX_TABLES = 40;
const DESCRIBE_CONNECTION_MAX_CH_COLUMNS = 60;
const READ_NOTE_MAX_CONTENT_CHARS = 900;
const LIST_NOTES_MAX = 15;
const LIST_NOTES_PREVIEW_MAX = 80;
const CREATE_CHART_MAX_FIRED_RULES = 3;
const APPLY_FORMAT_MAX_DECISIONS = 3;
const LIST_CONNECTION_PROPERTIES_MAX = 15;
const GA_TREND_MAX_COLUMNS = 40;

export interface ToolShaper {
  success?: (result: Record<string, unknown>, budget: number) => Record<string, unknown>;
  error?: (result: Record<string, unknown>) => string;
}

// describeSheet ─────────────────────────────────────────────────────────

// Compacts one requestedColumns entry. Two shapes come out of
// clientToolExecutor.ts's describeColumn(): the normal
// {columnId, headerCell, dataRange, header, inferredType, samples} and the
// out-of-range {columnId, exists: false, columnIdSpan, message}. Keep the
// answer-bearing fields for each and drop the rest (headerCell is derivable
// from columnId, columnIdSpan duplicates the top-level field).
function compactRequestedColumn(column: Record<string, unknown>): Record<string, unknown> {
  if (column?.exists === false) {
    return { columnId: column.columnId, exists: false, message: column.message };
  }
  const samplesIn = Array.isArray(column?.samples) ? (column.samples as unknown[]) : [];
  return {
    columnId: column?.columnId,
    header: column?.header ?? null,
    inferredType: column?.inferredType ?? 'text',
    dataRange: column?.dataRange,
    samples: samplesIn.slice(0, DESCRIBE_SHEET_REQUESTED_COLUMN_SAMPLES),
  };
}

function shapeDescribeSheet(result: Record<string, unknown>): Record<string, unknown> {
  const columnsIn = Array.isArray(result.columns) ? (result.columns as any[]) : [];
  const columnsCapped = columnsIn.slice(0, DESCRIBE_SHEET_MAX_COLUMNS);
  const columnsCompact = columnsCapped
    .map((c) => `${c.columnId}=${c.header ?? '(no header)'}(${c.inferredType ?? 'text'})`)
    .join(' ');

  const sampleRowsIn = Array.isArray(result.sampleRows) ? (result.sampleRows as Record<string, unknown>[]) : [];
  const sampleRowsOut = sampleRowsIn.slice(0, DESCRIBE_SHEET_SAMPLE_ROWS).map((row) => {
    const cols = Object.keys(row)
      .filter((k) => k !== 'rowNumber')
      .slice(0, DESCRIBE_SHEET_SAMPLE_COLS);
    const out: Record<string, unknown> = { rowNumber: row.rowNumber };
    for (const col of cols) out[col] = row[col];
    return out;
  });

  const requestedColumnsIn = Array.isArray(result.requestedColumns) ? (result.requestedColumns as Record<string, unknown>[]) : [];
  const requestedColumnsOut = requestedColumnsIn
    .slice(0, DESCRIBE_SHEET_MAX_REQUESTED_COLUMNS)
    .map(compactRequestedColumn);

  const shaped: Record<string, unknown> = {
    ...pick(result, ['ok', 'sheetId', 'title', 'rowCount', 'columnCount', 'columnIdSpan', 'rowNumbering', 'filters', 'sort']),
    columnsCompact,
    // requestedColumns is the targeted answer to "what's in column AU/BB"
    // (this is what the tool description promises), so it's capped like
    // every other bulk field here rather than dropped wholesale by the
    // generic backstop when a caller asks about many columns at once.
    requestedColumns: requestedColumnsOut,
    sampleRows: sampleRowsOut,
  };

  const omitted = omittedNote([
    columnsIn.length > columnsCapped.length ? `cols ${columnsIn.length}→${columnsCapped.length}` : null,
    sampleRowsIn.length > sampleRowsOut.length ? `sampleRows ${sampleRowsIn.length}→${sampleRowsOut.length}` : null,
    requestedColumnsIn.length > requestedColumnsOut.length
      ? `requestedColumns ${requestedColumnsIn.length}→${requestedColumnsOut.length}`
      : null,
  ]);
  if (omitted) {
    shaped._truncated = true;
    shaped._omitted = omitted;
  }
  return shaped;
}

// getRange ──────────────────────────────────────────────────────────────

function shapeGetRange(result: Record<string, unknown>): Record<string, unknown> {
  const cellsIn = (result.cells ?? {}) as Record<string, { raw?: string; value?: unknown }>;
  const bounds = parseRangeRef(String(result.range ?? ''));
  if (!bounds) {
    // Can't safely reshape without a parseable range; hand the raw shape
    // back and let the generic backstop clip it if it's still too big.
    return pick(result, ['ok', 'sheetId', 'range', 'cells']);
  }

  const totalRows = bounds.endRow - bounds.startRow + 1;
  const totalCols = bounds.endCol - bounds.startCol + 1;
  const allRows: string[][] = [];
  for (let row = bounds.startRow; row <= bounds.endRow; row++) {
    const line: string[] = [];
    for (let col = bounds.startCol; col <= bounds.endCol; col++) {
      const cell = cellsIn[getCellId(col, row)];
      const display = cell ? cell.value ?? cell.raw : '';
      line.push(display === null || display === undefined ? '' : String(display));
    }
    allRows.push(line);
  }

  const rowBudget = WEBMCP_OUTPUT_BUDGET - ROW_BUDGET_RESERVE_CHARS;
  const { rows, truncated } = clipRowsToBudget(allRows, 0, rowBudget);
  const deliveredEndRow = bounds.startRow + Math.max(rows.length, 1) - 1;
  const returnedRange =
    rows.length > 0
      ? `${getColumnIdForIndex(bounds.startCol)}${bounds.startRow + 1}:${getColumnIdForIndex(bounds.endCol)}${deliveredEndRow + 1}`
      : String(result.range ?? '');

  const shaped: Record<string, unknown> = {
    ok: result.ok,
    sheetId: result.sheetId,
    range: result.range,
    returnedRange,
    rowCount: totalRows,
    columnCount: totalCols,
    rows,
  };
  if (truncated) {
    shaped._truncated = true;
    shaped._omitted = omittedNote([`rows ${totalRows}→${rows.length}`]);
  }
  return shaped;
}

// querySheet ────────────────────────────────────────────────────────────

function shapeQuerySheet(result: Record<string, unknown>): Record<string, unknown> {
  const schemaIn = Array.isArray(result.schema) ? (result.schema as any[]) : [];
  const schemaCompact = schemaIn.map((s) => `${s.columnLetter}=${s.sqlName}`).join(' ');
  const rowsIn = Array.isArray(result.rows) ? (result.rows as unknown[][]) : [];
  const rowBudget = WEBMCP_OUTPUT_BUDGET - ROW_BUDGET_RESERVE_CHARS;
  const { rows, truncated } = clipRowsToBudget(rowsIn, 0, rowBudget);

  const shaped: Record<string, unknown> = {
    ok: result.ok,
    schema: schemaCompact,
    columns: result.columns ?? [],
    rowCount: result.rowCount,
    columnCount: Array.isArray(result.columns) ? (result.columns as unknown[]).length : 0,
    rows,
    truncated: result.truncated ?? truncated,
  };
  if (truncated) {
    shaped._truncated = true;
    shaped._omitted = omittedNote([`rows ${rowsIn.length}→${rows.length}`]);
  }
  return shaped;
}

// This is the app's single most valuable error enrichment: it's what lets
// the model self-correct a bad column name against the sheet's real,
// sanitized SQL column names. It must survive shaping.
function querySheetErrorMessage(result: Record<string, unknown>): string {
  const schemaIn = Array.isArray(result.schema) ? (result.schema as any[]) : [];
  const schemaCompact = schemaIn.map((s) => `${s.columnLetter}=${s.sqlName}`).join(' ');
  const parts = [
    String(result.error ?? 'querySheet failed'),
    schemaCompact ? `schema: ${schemaCompact}` : '',
    typeof result.sqlGuidance === 'string' && result.sqlGuidance ? `sqlGuidance: ${result.sqlGuidance}` : '',
  ].filter(Boolean);
  return capMessage(parts.join('\n'), ERROR_MESSAGE_MAX_CHARS);
}

// listSheets ────────────────────────────────────────────────────────────

function shapeListSheets(result: Record<string, unknown>): Record<string, unknown> {
  const sheetsIn = Array.isArray(result.sheets) ? (result.sheets as any[]) : [];
  const sheets = sheetsIn.slice(0, LIST_SHEETS_MAX_SHEETS).map((s) => ({
    sheetId: s.sheetId,
    title: s.title,
    rowCount: s.rowCount,
    columnCount: s.columnCount,
    columnIdSpan: s.columnIdSpan,
    headerLine: (Array.isArray(s.headers) ? s.headers : [])
      .map((h: any) => `${h.columnId}=${h.header ?? ''}`)
      .join(' ')
      .slice(0, LIST_SHEETS_HEADER_LINE_MAX),
  }));
  const shaped: Record<string, unknown> = { ok: result.ok, sheets };
  if (sheetsIn.length > sheets.length) {
    shaped._truncated = true;
    shaped._omitted = omittedNote([`sheets ${sheetsIn.length}→${sheets.length}`]);
  }
  return shaped;
}

// getSelection ──────────────────────────────────────────────────────────

function shapeGetSelection(result: Record<string, unknown>): Record<string, unknown> {
  const canvas = (result.selectedCanvas ?? {}) as { items?: any[] };
  const itemsIn = Array.isArray(canvas.items) ? canvas.items : [];
  const items = itemsIn.slice(0, GET_SELECTION_MAX_ITEMS).map((item) => ({
    kind: item.type,
    id: item.sheetId ?? item.chartId ?? item.noteId ?? null,
    title: item.title ?? item.preview ?? null,
  }));
  const counts = itemsIn.reduce<Record<string, number>>((acc, item) => {
    const key = `${item.type}s`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const shaped: Record<string, unknown> = {
    ok: result.ok,
    selection: result.selection,
    selectedCanvas: { items, counts },
  };
  if (itemsIn.length > items.length) {
    shaped._truncated = true;
    shaped._omitted = omittedNote([`selectedItems ${itemsIn.length}→${items.length}`]);
  }
  return shaped;
}

// queryConnection / createQuerySheet / createQuerySheetFromResult /
// updateQuerySheet ──────────────────────────────────────────────────────
// All four spread `summarizeImportedMatrix` (querySheetTools.ts) and echo
// the agent-authored `brief` back. One shared shaper keeps their shape from
// drifting apart as tools are added/changed.

function connectorColumnsCompact(headers: any[], inferredTypes: any[]): string {
  return headers.map((h, i) => `${h.columnId}=${h.header}(${inferredTypes?.[i] ?? 'text'})`).join(' ');
}

const CONNECTOR_RESULT_KEYS = [
  'sheetId',
  'resultId',
  'title',
  'rowCount',
  'truncated',
  'visibleSheetCreated',
  'nextVisibleStep',
  'updatedExistingSheet',
] as const;

function shapeConnectorSuccess(result: Record<string, unknown>): Record<string, unknown> {
  const headersIn = Array.isArray(result.headers) ? (result.headers as any[]) : [];
  const inferredTypesIn = Array.isArray(result.inferredTypes) ? (result.inferredTypes as any[]) : [];
  const columnsCompact = connectorColumnsCompact(headersIn, inferredTypesIn);

  const sampleRowsIn = Array.isArray(result.sampleRows) ? (result.sampleRows as Record<string, unknown>[]) : [];
  const sampleRowsOut = sampleRowsIn.slice(0, CONNECTOR_SAMPLE_ROWS).map((row) => {
    const cols = Object.keys(row)
      .filter((k) => k !== 'rowNumber')
      .slice(0, CONNECTOR_SAMPLE_COLS);
    const out: Record<string, unknown> = { rowNumber: row.rowNumber };
    for (const col of cols) out[col] = row[col];
    return out;
  });

  const shaped: Record<string, unknown> = { ok: result.ok, ...pick(result, [...CONNECTOR_RESULT_KEYS]) };
  shaped.columnsCompact = columnsCompact;
  shaped.sampleRows = sampleRowsOut;
  // `brief` is deliberately dropped: the agent authored it in the same tool
  // call, so echoing it back is pure waste against the WebMCP budget.
  if (result.queryDiagnostics !== undefined) {
    shaped.queryDiagnostics = capMessage(JSON.stringify(result.queryDiagnostics), QUERY_DIAGNOSTICS_MAX_CHARS);
  }

  const omitted = omittedNote([
    sampleRowsIn.length > sampleRowsOut.length ? `sampleRows ${sampleRowsIn.length}→${sampleRowsOut.length}` : null,
    headersIn.length > CONNECTOR_SAMPLE_COLS ? `cols ${headersIn.length}→${CONNECTOR_SAMPLE_COLS}` : null,
  ]);
  if (omitted) {
    shaped._truncated = true;
    shaped._omitted = omitted;
  }
  return shaped;
}

// Connector empty-result error path (querySheetTools.ts): `error` +
// `queryDiagnostics` clipped to 200 chars. Shared error shaper for all four
// connector-result tools.
function connectorErrorMessage(result: Record<string, unknown>): string {
  const parts = [String(result.error ?? 'Query failed')];
  if (result.queryDiagnostics !== undefined) {
    parts.push(`queryDiagnostics: ${capMessage(JSON.stringify(result.queryDiagnostics), QUERY_DIAGNOSTICS_MAX_CHARS)}`);
  }
  return capMessage(parts.join('\n'), ERROR_MESSAGE_MAX_CHARS);
}

// listConnections ───────────────────────────────────────────────────────

function shapeListConnections(result: Record<string, unknown>): Record<string, unknown> {
  const connectionsIn = Array.isArray(result.connections) ? (result.connections as any[]) : [];
  const connections = connectionsIn.map((c) => ({
    connectionId: c.connectionId,
    type: c.type,
    name: c.name,
    health: c.health,
    propertyHints: Array.isArray(c.propertyHints) ? c.propertyHints.slice(0, LIST_CONNECTIONS_PROPERTY_HINTS) : [],
  }));
  // `selectedCanvas` is deliberately dropped: getSelection already exposes
  // it, so echoing it here would double the cost of the most-called
  // connector tool for information the agent can fetch on demand.
  return { ok: result.ok, connections };
}

// listConnectionProperties ──────────────────────────────────────────────

function shapeListConnectionProperties(result: Record<string, unknown>): Record<string, unknown> {
  const propertiesIn = Array.isArray(result.properties) ? (result.properties as any[]) : [];
  const properties = propertiesIn.slice(0, LIST_CONNECTION_PROPERTIES_MAX).map((p) => ({
    propertyId: p.propertyId,
    displayName: p.displayName,
  }));
  const shaped: Record<string, unknown> = {
    ok: result.ok,
    connectionId: result.connectionId,
    type: result.type,
    properties,
    nextPageToken: result.nextPageToken ?? null,
    truncated: result.truncated ?? false,
  };
  if (propertiesIn.length > properties.length) {
    shaped._truncated = true;
    shaped._omitted = omittedNote([`properties ${propertiesIn.length}→${properties.length}`]);
  }
  return shaped;
}

// describeConnection ────────────────────────────────────────────────────

function shapeQueryShape(queryShape: unknown): Record<string, unknown> | undefined {
  if (!queryShape || typeof queryShape !== 'object') return undefined;
  const shape = queryShape as Record<string, unknown>;
  const examples = Array.isArray(shape.examples) ? shape.examples.slice(0, 1) : undefined;
  const out: Record<string, unknown> = {};
  if (shape.type !== undefined) out.type = shape.type;
  if (shape.summary !== undefined) out.summary = shape.summary;
  if (shape.requiredFields !== undefined) out.requiredFields = shape.requiredFields;
  if (examples) out.examples = examples;
  // `payloadSchema` is deliberately dropped: it's the largest field, and
  // requiredFields + one worked example already teach the payload shape.
  return out;
}

function shapeDescribeConnection(result: Record<string, unknown>): Record<string, unknown> {
  const shaped: Record<string, unknown> = {
    ok: result.ok,
    connectionId: result.connectionId,
    type: result.type,
  };
  if (result.propertyId !== undefined) shaped.propertyId = result.propertyId;
  if (result.table !== undefined) shaped.table = result.table;
  // `schemaToken` is non-negotiable: the next call (queryConnection /
  // createQuerySheet) requires it verbatim.
  if (result.schemaToken !== undefined) shaped.schemaToken = result.schemaToken;

  const queryShape = shapeQueryShape(result.queryShape);
  if (queryShape) shaped.queryShape = queryShape;

  const omitted: Array<string | null> = [];

  if (Array.isArray(result.dimensions)) {
    const dims = result.dimensions as any[];
    const capped = dims.slice(0, DESCRIBE_CONNECTION_MAX_DIMS);
    shaped.dimensions = capped.map((d) => d.apiName);
    shaped.dimensionsTotal = result.dimensionsTotal ?? dims.length;
    if (dims.length > capped.length) omitted.push(`dims ${dims.length}→${capped.length}`);
  }
  if (Array.isArray(result.metrics)) {
    const metrics = result.metrics as any[];
    const capped = metrics.slice(0, DESCRIBE_CONNECTION_MAX_METRICS);
    shaped.metrics = capped.map((m) => m.apiName);
    shaped.metricsTotal = result.metricsTotal ?? metrics.length;
    if (metrics.length > capped.length) omitted.push(`metrics ${metrics.length}→${capped.length}`);
  }
  if (Array.isArray(result.tables)) {
    const tables = result.tables as any[];
    const capped = tables.slice(0, DESCRIBE_CONNECTION_MAX_TABLES);
    shaped.tables = capped;
    if (tables.length > capped.length) omitted.push(`tables ${tables.length}→${capped.length}`);
  }
  if (Array.isArray(result.columns)) {
    const columns = result.columns as any[];
    const capped = columns.slice(0, DESCRIBE_CONNECTION_MAX_CH_COLUMNS);
    shaped.columns = capped;
    if (columns.length > capped.length) omitted.push(`columns ${columns.length}→${capped.length}`);
  }
  // Google Sheets branch: small, fixed set of scalar fields — keep as-is.
  for (const key of ['spreadsheetIdOrUrlRequired', 'rangeOptional', 'defaultRange', 'readOnly'] as const) {
    if (result[key] !== undefined) shaped[key] = result[key];
  }

  const note = omittedNote(omitted);
  if (note) {
    shaped._truncated = true;
    shaped._omitted = note;
  }
  return shaped;
}

// readNote ──────────────────────────────────────────────────────────────

function shapeReadNote(result: Record<string, unknown>): Record<string, unknown> {
  const content = typeof result.content === 'string' ? result.content : '';
  const clipped = content.length > READ_NOTE_MAX_CONTENT_CHARS;
  const shaped: Record<string, unknown> = {
    ok: result.ok,
    noteId: result.noteId,
    title: result.title,
    content: clipped ? content.slice(0, READ_NOTE_MAX_CONTENT_CHARS) : content,
    contentChars: content.length,
    color: result.color,
    format: result.format,
  };
  if (clipped) {
    shaped._truncated = true;
    shaped._omitted = omittedNote([`content ${content.length}→${READ_NOTE_MAX_CONTENT_CHARS} chars`]);
  }
  return shaped;
}

// listNotes ─────────────────────────────────────────────────────────────

function shapeListNotes(result: Record<string, unknown>): Record<string, unknown> {
  const notesIn = Array.isArray(result.notes) ? (result.notes as any[]) : [];
  const notes = notesIn.slice(0, LIST_NOTES_MAX).map((n) => ({
    noteId: n.noteId,
    title: n.title,
    preview: String(n.preview ?? '').slice(0, LIST_NOTES_PREVIEW_MAX),
    color: n.color,
    format: n.format,
  }));
  const shaped: Record<string, unknown> = { ok: result.ok, notes };
  if (notesIn.length > notes.length) {
    shaped._truncated = true;
    shaped._omitted = omittedNote([`notes ${notesIn.length}→${notes.length}`]);
  }
  return shaped;
}

// createChart ───────────────────────────────────────────────────────────

function summarizeAnalysisIntentLine(intent: Record<string, unknown>): string {
  return Object.entries(intent)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(' ');
}

function shapeCreateChart(result: Record<string, unknown>): Record<string, unknown> {
  const formDecisions = (result.formDecisions ?? {}) as {
    appliedType?: unknown;
    usedSmartDefaults?: unknown;
    firedRules?: unknown[];
  };
  const firedRulesIn = Array.isArray(formDecisions.firedRules) ? formDecisions.firedRules : [];
  const analysisIntent = (result.analysisIntent ?? {}) as Record<string, unknown>;

  // SECURITY NOTE — do not add these back without revisiting the
  // untrustedContentHint annotation for createChart elsewhere in the WebMCP
  // tool surface: `resolvedColumns` echoes sheet header text and
  // `labelSummary` echoes cell values (duplicate labels, header text, date
  // ranges) straight out of sheet data. Dropping both here is the only
  // reason createChart can omit that annotation. See
  // toolResultShaping.test.ts for the guard assertion.
  return {
    ok: result.ok,
    chartId: result.chartId,
    sheetId: result.sheetId,
    appliedType: formDecisions.appliedType,
    usedSmartDefaults: formDecisions.usedSmartDefaults,
    firedRules: firedRulesIn.slice(0, CREATE_CHART_MAX_FIRED_RULES),
    analysisIntent: summarizeAnalysisIntentLine(analysisIntent),
  };
}

// `guidance` is an intentional "ask the user" signal, not a bug: losing a
// line would make the agent retry blindly instead of asking for the missing
// timeRange/timeGranularity or offering group mode / a pivot. Each guidance
// line comes from an independent condition in validateChartAnalysisIntent
// (clientToolExecutor.ts) — e.g. "date-like column, no timeRange" and
// "duplicate labels need aggregation" can both fire at once — so a
// *positional* cap (slice(0, N)) silently drops whichever condition happened
// to push last, even when the message has budget to spare. Cap by character
// budget instead, so every guidance line survives whenever it fits.
//
// Drop order when it doesn't all fit: `suggestedNextTools` goes first. Its
// entries (tool names like 'createChart', 'createPivot') are near-redundant
// with what the guidance text right above it already says to do, whereas
// each guidance line is the only place its specific blocking reason is
// explained. If guidance itself is still too long even alone, keep whole
// lines up to the budget (in the order the validator pushed them) rather
// than truncating a line mid-sentence — a half-explanation isn't actionable
// either.
function joinNonEmpty(parts: string[]): string {
  return parts.filter(Boolean).join('\n');
}

function createChartErrorMessage(result: Record<string, unknown>): string {
  const missing = Array.isArray(result.missingParameters) ? (result.missingParameters as string[]).join(', ') : '';
  const guidanceIn = Array.isArray(result.guidance) ? (result.guidance as string[]) : [];
  const suggested = Array.isArray(result.suggestedNextTools) ? (result.suggestedNextTools as string[]).join(', ') : '';

  const base = [String(result.error ?? 'createChart failed'), missing ? `missingParameters: ${missing}` : ''];
  const guidanceLines = guidanceIn.map((g) => `guidance: ${g}`);
  const suggestedLine = suggested ? `suggestedNextTools: ${suggested}` : '';

  let message = joinNonEmpty([...base, ...guidanceLines, suggestedLine]);
  if (message.length > ERROR_MESSAGE_MAX_CHARS) {
    message = joinNonEmpty([...base, ...guidanceLines]);
  }
  if (message.length > ERROR_MESSAGE_MAX_CHARS) {
    const kept = [...base];
    for (const line of guidanceLines) {
      const withLine = joinNonEmpty([...kept, line]);
      if (withLine.length > ERROR_MESSAGE_MAX_CHARS) break;
      kept.push(line);
    }
    message = joinNonEmpty(kept);
  }
  return capMessage(message, ERROR_MESSAGE_MAX_CHARS);
}

// applyFormat ───────────────────────────────────────────────────────────

function shapeApplyFormat(result: Record<string, unknown>): Record<string, unknown> {
  const decisionsIn = Array.isArray(result.formatDecisions) ? (result.formatDecisions as unknown[]) : [];
  const decisions = decisionsIn.slice(0, APPLY_FORMAT_MAX_DECISIONS);
  const shaped: Record<string, unknown> = {
    ok: result.ok,
    sheetId: result.sheetId,
    range: result.range,
    cellsFormatted: result.cellsFormatted,
    persistedOutputOverride: result.persistedOutputOverride,
    formatDecisions: decisions,
  };
  if (decisionsIn.length > decisions.length) {
    shaped._truncated = true;
    shaped._omitted = omittedNote([`formatDecisions ${decisionsIn.length}→${decisions.length}`]);
  }
  return shaped;
}

// createGaTrendBySource ─────────────────────────────────────────────────

function shapeCreateGaTrendBySource(result: Record<string, unknown>): Record<string, unknown> {
  const columnsIn = Array.isArray(result.columns) ? (result.columns as unknown[]) : [];
  return {
    ok: result.ok,
    sheetId: result.sheetId,
    sparklineSheetId: result.sparklineSheetId,
    propertyId: result.propertyId,
    hostName: result.hostName,
    dateRange: result.dateRange,
    sourceDimension: result.sourceDimension,
    metric: result.metric,
    rowCount: result.rawRowCount,
    truncated: result.truncated,
    columns: columnsIn.slice(0, GA_TREND_MAX_COLUMNS),
  };
}

function createGaTrendBySourceErrorMessage(result: Record<string, unknown>): string {
  const parts = [String(result.error ?? 'createGaTrendBySource failed')];
  if (result.queryDiagnostics !== undefined) {
    parts.push(`queryDiagnostics: ${capMessage(JSON.stringify(result.queryDiagnostics), QUERY_DIAGNOSTICS_MAX_CHARS)}`);
  }
  return capMessage(parts.join('\n'), ERROR_MESSAGE_MAX_CHARS);
}

// ── Registry ──────────────────────────────────────────────────────────────
// The 9 tools NOT listed below (setCells, createSheet, applyFilter,
// applySort, createPivot, createSparkline, createNote, updateNote,
// deleteNote) return a handful of scalar/id fields each — verified by
// reading their `return` statements in clientToolExecutor.ts. None can
// plausibly cross the budget, so they're intentionally absent here; the
// generic backstop in toolResultShaping.ts is a no-op for them.
export const SHAPERS: Partial<Record<ToolName, ToolShaper>> = {
  describeSheet: { success: shapeDescribeSheet },
  getRange: { success: shapeGetRange },
  querySheet: { success: shapeQuerySheet, error: querySheetErrorMessage },
  listSheets: { success: shapeListSheets },
  getSelection: { success: shapeGetSelection },
  queryConnection: { success: shapeConnectorSuccess, error: connectorErrorMessage },
  createQuerySheet: { success: shapeConnectorSuccess, error: connectorErrorMessage },
  createQuerySheetFromResult: { success: shapeConnectorSuccess, error: connectorErrorMessage },
  updateQuerySheet: { success: shapeConnectorSuccess, error: connectorErrorMessage },
  listConnections: { success: shapeListConnections },
  listConnectionProperties: { success: shapeListConnectionProperties },
  describeConnection: { success: shapeDescribeConnection },
  readNote: { success: shapeReadNote },
  listNotes: { success: shapeListNotes },
  createChart: { success: shapeCreateChart, error: createChartErrorMessage },
  applyFormat: { success: shapeApplyFormat },
  createGaTrendBySource: { success: shapeCreateGaTrendBySource, error: createGaTrendBySourceErrorMessage },
};
